use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, USER_AGENT};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tokio::sync::OnceCell;

// ---------------------------------------------------------------------------
//  Public types returned to the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageSnapshot {
    pub included_used: u32,
    pub included_limit: u32,
    pub on_demand_spent: f64,
    pub on_demand_limit: f64,
    pub start_of_month: String,
    pub events: Vec<UsageEvent>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEvent {
    pub timestamp: i64,
    pub model: String,
    pub kind: String,
    pub requests: f64,
    pub total_tokens: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub charged_cents: f64,
}

// ---------------------------------------------------------------------------
//  Credential cache
// ---------------------------------------------------------------------------

static HTTP_CLIENT: OnceCell<reqwest::Client> = OnceCell::const_new();

struct CachedCreds {
    user_id: String,
    access_token: String,
}

static CREDS_CACHE: Mutex<Option<CachedCreds>> = Mutex::new(None);

fn clear_creds_cache() {
    if let Ok(mut c) = CREDS_CACHE.lock() {
        *c = None;
    }
}

fn get_or_load_creds() -> Result<(String, String), String> {
    {
        let cache = CREDS_CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(c) = cache.as_ref() {
            return Ok((c.user_id.clone(), c.access_token.clone()));
        }
    }

    let user_id = resolve_user_id()?;
    let access_token = resolve_access_token()?;

    if let Ok(mut cache) = CREDS_CACHE.lock() {
        *cache = Some(CachedCreds {
            user_id: user_id.clone(),
            access_token: access_token.clone(),
        });
    }

    Ok((user_id, access_token))
}

// ---------------------------------------------------------------------------
//  Credential extraction — mirrors kso.cursor-usage-monitor logic
// ---------------------------------------------------------------------------

fn cursor_appdata_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .ok()
            .map(|p| PathBuf::from(p).join("Cursor"))
    }
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|h| h.join("Library/Application Support/Cursor"))
    }
    #[cfg(target_os = "linux")]
    {
        dirs::home_dir().map(|h| h.join(".config/Cursor"))
    }
}

fn state_vscdb_path() -> Option<PathBuf> {
    cursor_appdata_dir().map(|p| p.join("User").join("globalStorage").join("state.vscdb"))
}

fn query_db(key: &str) -> Option<String> {
    let db_path = state_vscdb_path()?;
    if !db_path.exists() {
        return None;
    }
    let conn = Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
    let mut stmt = conn.prepare("SELECT value FROM ItemTable WHERE key = ?1").ok()?;
    stmt.query_row([key], |row| row.get::<_, String>(0)).ok()
}

fn resolve_access_token() -> Result<String, String> {
    for key in &["cursorAuth/accessToken", "cursorAuth/refreshToken"] {
        if let Some(tok) = query_db(key) {
            if !tok.is_empty() {
                return Ok(tok);
            }
        }
    }
    Err("Failed to read access token from Cursor database".into())
}

fn resolve_user_id() -> Result<String, String> {
    let json_paths = get_userid_json_paths();
    for path in &json_paths {
        if let Some(uid) = extract_userid_from_json(path) {
            return Ok(uid);
        }
    }

    if let Some(uid) = query_db("cursorAuth/cachedSignUpId") {
        if uid.starts_with("user_") {
            return Ok(uid);
        }
    }

    Err("Failed to resolve Cursor user ID".into())
}

fn get_userid_json_paths() -> Vec<PathBuf> {
    let Some(base) = cursor_appdata_dir() else {
        return vec![];
    };
    vec![
        base.join("sentry").join("scope_v3.json"),
        base.join("sentry").join("session.json"),
        base.join("User").join("globalStorage").join("storage.json"),
    ]
}

fn extract_userid_from_json(path: &PathBuf) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let val: serde_json::Value = serde_json::from_str(&content).ok()?;
    find_user_id_recursive(&val)
}

fn find_user_id_recursive(val: &serde_json::Value) -> Option<String> {
    match val {
        serde_json::Value::String(s) => {
            if s.starts_with("user_") && s.len() > 20 {
                return Some(s.clone());
            }
            if s.contains('|') {
                if let Some(part) = s.split('|').find(|p| p.starts_with("user_")) {
                    return Some(part.to_string());
                }
            }
            None
        }
        serde_json::Value::Object(map) => {
            for v in map.values() {
                if let Some(uid) = find_user_id_recursive(v) {
                    return Some(uid);
                }
            }
            None
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                if let Some(uid) = find_user_id_recursive(v) {
                    return Some(uid);
                }
            }
            None
        }
        _ => None,
    }
}

// ---------------------------------------------------------------------------
//  HTTP helpers
// ---------------------------------------------------------------------------

async fn client() -> &'static reqwest::Client {
    HTTP_CLIENT
        .get_or_init(|| async {
            reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default()
        })
        .await
}

fn build_headers(cookie_value: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"));
    h.insert(ACCEPT, HeaderValue::from_static("*/*"));
    h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    h.insert(ORIGIN, HeaderValue::from_static("https://cursor.com"));
    h.insert(REFERER, HeaderValue::from_static("https://cursor.com/cn/dashboard/usage"));
    if let Ok(v) = HeaderValue::from_str(&format!("WorkosCursorSessionToken={cookie_value}")) {
        h.insert(COOKIE, v);
    }
    h
}

fn make_cookie(user_id: &str, token: &str) -> String {
    format!("{user_id}%3A%3A{token}")
}

// ---------------------------------------------------------------------------
//  Cursor API calls
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ApiUsageGpt4 {
    #[serde(rename = "maxRequestUsage")]
    max_request_usage: Option<u32>,
    #[serde(rename = "numRequests")]
    num_requests: Option<u32>,
}

#[derive(Deserialize)]
struct ApiUsageResponse {
    #[serde(rename = "startOfMonth")]
    start_of_month: Option<String>,
    #[serde(rename = "gpt-4")]
    gpt4: Option<ApiUsageGpt4>,
}

#[derive(Deserialize)]
struct ApiEventsResponse {
    #[serde(rename = "usageEventsDisplay")]
    usage_events_display: Option<Vec<ApiEventItem>>,
}

#[derive(Deserialize)]
struct ApiEventItem {
    timestamp: Option<String>,
    model: Option<String>,
    kind: Option<String>,
    #[serde(rename = "requestsCosts")]
    requests_costs: Option<f64>,
    #[serde(rename = "chargedCents")]
    charged_cents: Option<f64>,
    #[serde(rename = "tokenUsage")]
    token_usage: Option<ApiTokenUsage>,
}

#[derive(Deserialize)]
struct ApiTokenUsage {
    #[serde(rename = "inputTokens", default)]
    input_tokens: u64,
    #[serde(rename = "outputTokens", default)]
    output_tokens: u64,
    #[serde(rename = "cacheWriteTokens", default)]
    cache_write_tokens: u64,
    #[serde(rename = "cacheReadTokens", default)]
    cache_read_tokens: u64,
}

#[derive(Deserialize)]
struct ApiTeamsResponse {
    teams: Option<Vec<ApiTeam>>,
}

#[derive(Deserialize)]
struct ApiTeam {
    id: String,
}

#[derive(Deserialize)]
struct ApiMeResponse {
    id: Option<String>,
}

#[derive(Deserialize)]
struct ApiTeamSpendResponse {
    #[serde(rename = "teamMemberSpend")]
    team_member_spend: Option<Vec<ApiMemberSpend>>,
}

#[derive(Deserialize)]
struct ApiMemberSpend {
    #[serde(rename = "userId")]
    user_id: Option<String>,
    #[serde(rename = "spendCents")]
    spend_cents: Option<f64>,
    #[serde(rename = "hardLimitOverrideDollars")]
    hard_limit_override_dollars: Option<f64>,
    #[serde(rename = "effectivePerUserLimitDollars")]
    effective_per_user_limit_dollars: Option<f64>,
    #[serde(rename = "fastPremiumRequests")]
    fast_premium_requests: Option<u32>,
}

struct TeamSpendResult {
    spent_dollars: f64,
    limit_dollars: f64,
    fast_premium_requests: Option<u32>,
}

async fn fetch_usage_summary(cookie: &str, user_id: &str) -> Result<ApiUsageResponse, String> {
    let url = format!("https://cursor.com/api/usage?user={user_id}");
    let resp = client()
        .await
        .get(&url)
        .headers(build_headers(cookie))
        .send()
        .await
        .map_err(|e| format!("GET /api/usage failed: {e}"))?;

    if resp.status().as_u16() == 401 {
        return Err("401".into());
    }
    if !resp.status().is_success() {
        return Err(format!("GET /api/usage returned {}", resp.status()));
    }
    resp.json().await.map_err(|e| format!("Parse /api/usage: {e}"))
}

async fn fetch_events(cookie: &str, count: u32) -> Result<Vec<UsageEvent>, String> {
    let now = chrono_now_ms();
    let thirty_days_ago = now - 30 * 24 * 60 * 60 * 1000;
    let body = serde_json::json!({
        "startDate": thirty_days_ago,
        "endDate": now,
        "page": 1,
        "pageSize": count,
    });

    let resp = client()
        .await
        .post("https://cursor.com/api/dashboard/get-filtered-usage-events")
        .headers(build_headers(cookie))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("POST get-filtered-usage-events: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("get-filtered-usage-events returned {}", resp.status()));
    }

    let data: ApiEventsResponse = resp.json().await.map_err(|e| format!("Parse events: {e}"))?;
    let items = data.usage_events_display.unwrap_or_default();

    Ok(items
        .into_iter()
        .map(|e| {
            let tok = e.token_usage.as_ref();
            let input = tok.map_or(0, |t| t.input_tokens);
            let output = tok.map_or(0, |t| t.output_tokens);
            let cache_w = tok.map_or(0, |t| t.cache_write_tokens);
            let cache_r = tok.map_or(0, |t| t.cache_read_tokens);

            UsageEvent {
                timestamp: e
                    .timestamp
                    .as_deref()
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(0),
                model: e.model.unwrap_or_default(),
                kind: e.kind.unwrap_or_default(),
                requests: e.requests_costs.unwrap_or(0.0),
                total_tokens: input + output + cache_w + cache_r,
                input_tokens: input,
                output_tokens: output,
                charged_cents: e.charged_cents.unwrap_or(0.0),
            }
        })
        .collect())
}

async fn fetch_team_spend(cookie: &str) -> Option<TeamSpendResult> {
    let teams_resp = client()
        .await
        .post("https://cursor.com/api/dashboard/teams")
        .headers(build_headers(cookie))
        .json(&serde_json::json!({}))
        .send()
        .await
        .ok()?;
    if !teams_resp.status().is_success() {
        return None;
    }
    let teams: ApiTeamsResponse = teams_resp.json().await.ok()?;
    let team_id = teams.teams?.into_iter().next()?.id;

    let me_resp = client()
        .await
        .get("https://cursor.com/api/auth/me")
        .headers(build_headers(cookie))
        .send()
        .await
        .ok()?;
    let me: ApiMeResponse = me_resp.json().await.ok()?;
    let my_id = me.id?;

    let spend_resp = client()
        .await
        .post("https://cursor.com/api/dashboard/get-team-spend")
        .headers(build_headers(cookie))
        .json(&serde_json::json!({ "teamId": team_id }))
        .send()
        .await
        .ok()?;
    let spend: ApiTeamSpendResponse = spend_resp.json().await.ok()?;
    let my_spend = spend
        .team_member_spend?
        .into_iter()
        .find(|m| m.user_id.as_deref() == Some(&my_id))?;

    Some(TeamSpendResult {
        spent_dollars: my_spend.spend_cents.unwrap_or(0.0) / 100.0,
        limit_dollars: my_spend
            .hard_limit_override_dollars
            .or(my_spend.effective_per_user_limit_dollars)
            .unwrap_or(0.0),
        fast_premium_requests: my_spend.fast_premium_requests,
    })
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

// ---------------------------------------------------------------------------
//  Combined fetch — single entry point
// ---------------------------------------------------------------------------

async fn fetch_all(force_refresh: bool) -> UsageSnapshot {
    if force_refresh {
        clear_creds_cache();
    }

    let (user_id, access_token) = match get_or_load_creds() {
        Ok(c) => c,
        Err(e) => return UsageSnapshot { error: Some(e), ..Default::default() },
    };

    let cookie = make_cookie(&user_id, &access_token);

    let usage = match fetch_usage_summary(&cookie, &user_id).await {
        Ok(u) => u,
        Err(e) if e == "401" => {
            clear_creds_cache();
            let (uid2, tok2) = match get_or_load_creds() {
                Ok(c) => c,
                Err(e) => return UsageSnapshot { error: Some(e), ..Default::default() },
            };
            let cookie2 = make_cookie(&uid2, &tok2);
            match fetch_usage_summary(&cookie2, &uid2).await {
                Ok(u) => u,
                Err(e) => return UsageSnapshot { error: Some(format!("After retry: {e}")), ..Default::default() },
            }
        }
        Err(e) => return UsageSnapshot { error: Some(e), ..Default::default() },
    };

    let gpt4 = usage.gpt4.as_ref();
    let max_requests = gpt4.and_then(|g| g.max_request_usage).unwrap_or(500);
    let num_requests = gpt4.and_then(|g| g.num_requests).unwrap_or(0);

    let mut included_used = num_requests;
    let mut on_demand_spent = 0.0;
    let mut on_demand_limit = 0.0;

    if let Some(team) = fetch_team_spend(&cookie).await {
        on_demand_spent = team.spent_dollars;
        on_demand_limit = team.limit_dollars;
        if let Some(fp) = team.fast_premium_requests {
            included_used = fp;
        }
    }

    let events = fetch_events(&cookie, 10).await.unwrap_or_default();

    UsageSnapshot {
        included_used,
        included_limit: max_requests,
        on_demand_spent,
        on_demand_limit,
        start_of_month: usage.start_of_month.unwrap_or_default(),
        events,
        error: None,
    }
}

// ---------------------------------------------------------------------------
//  Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_cursor_usage() -> Result<UsageSnapshot, String> {
    Ok(fetch_all(false).await)
}

#[tauri::command]
pub async fn refresh_cursor_usage() -> Result<UsageSnapshot, String> {
    Ok(fetch_all(true).await)
}
