use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, Socket, Type};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;

type Tx = futures_util::stream::SplitSink<
    tokio_tungstenite::WebSocketStream<tokio::net::TcpStream>,
    Message,
>;

#[derive(Clone)]
pub struct WsState {
    clients: Arc<Mutex<HashMap<usize, ClientEntry>>>,
    next_id: Arc<Mutex<usize>>,
}

struct ClientEntry {
    tx: Tx,
    instance_id: Option<String>,
}

impl WsState {
    pub fn new() -> Self {
        Self {
            clients: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(0)),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct WsMessage {
    #[serde(rename = "type")]
    msg_type: String,
    #[serde(default)]
    payload: Option<serde_json::Value>,
}

pub async fn start_ws_server(port: u16, app: AppHandle, state: WsState) -> bool {
    let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
    let socket = Socket::new(Domain::IPV4, Type::STREAM, Some(Protocol::TCP)).unwrap();
    socket.set_reuse_address(true).unwrap();
    socket.set_nonblocking(true).unwrap();
    if let Err(e) = socket.bind(&addr.into()) {
        eprintln!(
            "Port {} already in use (another instance running?): {}",
            port, e
        );
        return false;
    }
    socket.listen(128).unwrap();
    let listener = TcpListener::from_std(std::net::TcpListener::from(socket)).unwrap();

    while let Ok((stream, _)) = listener.accept().await {
        let app = app.clone();
        let state = state.clone();
        tokio::spawn(handle_connection(stream, app, state));
    }

    true
}

async fn handle_connection(stream: tokio::net::TcpStream, app: AppHandle, state: WsState) {
    let ws_stream = match tokio_tungstenite::accept_async(stream).await {
        Ok(ws) => ws,
        Err(_) => return,
    };

    let (tx, mut rx) = ws_stream.split();

    let id = {
        let mut next = state.next_id.lock().await;
        let cid = *next;
        *next += 1;
        cid
    };

    state.clients.lock().await.insert(
        id,
        ClientEntry {
            tx,
            instance_id: None,
        },
    );

    let mut registered_instance: Option<String> = None;

    while let Some(Ok(msg)) = rx.next().await {
        if let Message::Text(text) = msg {
            if let Ok(data) = serde_json::from_str::<WsMessage>(&text) {
                match data.msg_type.as_str() {
                    "register" => {
                        if let Some(payload) = &data.payload {
                            if let Some(iid) =
                                payload.get("instanceId").and_then(|v| v.as_str())
                            {
                                registered_instance = Some(iid.to_string());
                                let mut clients = state.clients.lock().await;
                                if let Some(entry) = clients.get_mut(&id) {
                                    entry.instance_id = Some(iid.to_string());
                                }
                            }
                        }
                        let _ = app.emit("ws-register", text.to_string());
                    }
                    "feedback_request" => {
                        let _ = app.emit("ws-feedback-request", text.to_string());
                    }
                    "show_window" => {
                        let _ = app.emit("ws-show-window", ());
                    }
                    _ => {}
                }
            }
        }
    }

    if let Some(instance_id) = registered_instance {
        let _ = app.emit("ws-client-disconnected", instance_id);
    }
    state.clients.lock().await.remove(&id);
}

/// Send a message to a specific MCP instance (by instanceId).
/// Falls back to broadcast if no target specified.
pub async fn send_to_instance(state: &WsState, message: &str, target_instance: Option<&str>) {
    let mut clients = state.clients.lock().await;
    let mut dead = Vec::new();

    for (&cid, entry) in clients.iter_mut() {
        let should_send = match target_instance {
            Some(target) => entry.instance_id.as_deref() == Some(target),
            None => true,
        };
        if should_send {
            if entry.tx.send(Message::Text(message.into())).await.is_err() {
                dead.push(cid);
            }
        }
    }

    for cid in dead {
        clients.remove(&cid);
    }
}

