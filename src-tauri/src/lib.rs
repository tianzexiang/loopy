mod cursor_usage;
mod ws_server;

use tauri::Manager;

const DEFAULT_WS_PORT: u16 = 9399;

fn parse_ws_port() -> u16 {
    std::env::args()
        .find(|a| a.starts_with("--ws-port="))
        .and_then(|a| a.strip_prefix("--ws-port=").unwrap().parse().ok())
        .unwrap_or(DEFAULT_WS_PORT)
}

#[tauri::command]
async fn send_ws_message(
    message: String,
    target_instance: Option<String>,
    state: tauri::State<'_, ws_server::WsState>,
) -> Result<(), String> {
    ws_server::send_to_instance(&state, &message, target_instance.as_deref()).await;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ws_port = parse_ws_port();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ws_server::WsState::new())
        .invoke_handler(tauri::generate_handler![
            send_ws_message,
            cursor_usage::get_cursor_usage,
            cursor_usage::refresh_cursor_usage,
        ])
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_shadow(false);
            }

            let handle = app.handle().clone();
            let ws_state = app.state::<ws_server::WsState>().inner().clone();
            let app_handle_for_exit = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let ok = ws_server::start_ws_server(ws_port, handle, ws_state).await;
                if !ok {
                    eprintln!("Another instance is already running. Exiting.");
                    app_handle_for_exit.exit(0);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
