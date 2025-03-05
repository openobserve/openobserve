// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::{cell::RefCell, rc::Rc, str::FromStr, sync::Arc};

use actix_web::{Error, HttpRequest, HttpResponse, rt, web};
use actix_ws::{CloseCode, CloseReason, Message, Session};
use config::get_config;
use futures::stream::{SplitSink, SplitStream};
use futures_util::{SinkExt, StreamExt};
use hex;
use reqwest::header::{HeaderName, HeaderValue};
use tokio::{net::TcpStream, sync::Mutex};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async, tungstenite};
use url::Url;

/// WebSocket proxy that manages bidirectional communication using two concurrent tasks.
///
/// # Architecture Overview
/// ```text
/// +--------+     +-----------------Router Process----------------+     +---------+
/// |        |     |  +-------------+        +-------------+       |     |         |
/// |        |     |  |    Task 1   |        |    Task 2   |       |     |         |
/// |Client  |<--->|  |client_to_bkd|  <-->  |backend_to_cl|       |<--->| Backend |
/// |        |     |  +-------------+        +-------------+       |     |         |
/// +--------+     +-----------------------------------------------+     +---------+
/// ```
///
/// # Close Sequence Flows
/// ```text
/// 1. Client Initiates Close:
///    Client -> Task1 -> Backend
///                    -> Send Close Frame
///                    -> Break Task1
///    Backend -> Task2 -> Client
///                    -> Send Close Ack to Backend
///                    -> Close Sink
///                    -> Break Task2
///
/// 2. Backend Initiates Close:
///    Backend -> Task2 -> Client
///                    -> Send Close Ack to Backend
///                    -> Close Sink
///                    -> Break Task2
///    Client -> Task1 -> Break Task1
/// ```
///
/// # Implementation Details
/// - Uses Arc<Mutex> for shared sink access between tasks
/// - Each task handles one direction of message flow
/// - Close sequence ensures proper WebSocket protocol shutdown
/// - Automatic resource cleanup when tasks complete
///
/// # Error Handling
/// - Connection errors trigger cleanup in both directions
/// - Timeouts prevent resource leaks
/// - Automatic task termination on connection close
///
/// # Message Flow Example
/// ```text
/// Normal Message:
///   Client -> Task1 -> convert format -> send to Backend
///   Backend -> Task2 -> convert format -> send to Client
///
/// Close Message:
///   1. Receive close frame
///   2. Forward to other endpoint
///   3. Send acknowledgment
///   4. Clean up resources
/// ```
/// Represents a WebSocket proxy session between client and backend
struct WsProxySession {
    client_session: Session,
    msg_stream: Rc<RefCell<actix_ws::MessageStream>>,
    c2r_sink:
        Arc<Mutex<SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, tungstenite::Message>>>,
    r2q_sink:
        Arc<Mutex<SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, tungstenite::Message>>>,
    r2q_stream: Arc<Mutex<SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>>>,
}

impl WsProxySession {
    /// Create a new proxy session
    async fn new(
        req: HttpRequest,
        payload: web::Payload,
        ws_base_url: &str,
    ) -> Result<(Self, HttpResponse), Error> {
        let cfg = get_config();
        let node_role = cfg.common.node_role.clone();
        let (response, client_session, client_msg_stream) = actix_ws::handle(&req, payload)?;

        let ws_req = convert_actix_to_tungstenite_request(&req, ws_base_url)?;
        let (backend_stream, _) = connect_async(ws_req)
            .await
            .map_err(|e| {
                log::error!(
                    "[WS_PROXY] Node Role: {} Failed to connect to backend WebSocket service, error: {:?}",
                    node_role,
                    e
                );
                actix_web::error::ErrorInternalServerError(e.to_string())
            })?;

        log::info!(
            "[WS_PROXY] Node Role:{} Client -> Router -> Backend connection established",
            node_role
        );
        // Split the stream and wrap sink in Arc<Mutex>
        let (backend_ws_sink, backend_ws_stream) = backend_stream.split();
        // Create a new sink for task 1
        let backend_ws_sink: Arc<
            Mutex<SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, tungstenite::Message>>,
        > = Arc::new(Mutex::new(backend_ws_sink));
        // Create a new sink for task 2
        let backend_ws_sink2: Arc<
            Mutex<SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, tungstenite::Message>>,
        > = backend_ws_sink.clone();

        Ok((
            Self {
                client_session,
                msg_stream: Rc::new(RefCell::new(client_msg_stream)),
                c2r_sink: backend_ws_sink,
                r2q_sink: backend_ws_sink2,
                r2q_stream: Arc::new(Mutex::new(backend_ws_stream)),
            },
            response,
        ))
    }

    /// Start proxying messages between client and backend
    async fn start(self) {
        let start_time = std::time::Instant::now();

        let client_session = self.client_session.clone();
        let msg_stream = Rc::clone(&self.msg_stream);
        let r2q_stream = Arc::clone(&self.r2q_stream);
        let c2r_sink = Arc::clone(&self.c2r_sink);
        let r2q_sink = Arc::clone(&self.r2q_sink);

        // Task 1: Client -> Router
        let client_to_backend = {
            async move {
                // Box the stream itself instead of individual futures
                let mut stream = Box::pin({
                    let stream_guard = msg_stream.borrow_mut();
                    stream_guard
                });

                while let Some(msg_result) = stream.next().await {
                    match msg_result {
                        Ok(msg) => {
                            let ws_msg = from_actix_message(msg);
                            match ws_msg {
                                tungstenite::protocol::Message::Close(reason) => {
                                    let mut sink = c2r_sink.lock().await;
                                    let close_msg =
                                        tungstenite::protocol::Message::Close(reason.clone());
                                    if let Err(e) = sink.send(close_msg).await {
                                        log::error!("[WS_PROXY] Failed to forward close: {}", e);
                                    }
                                    break;
                                }
                                _ => {
                                    let mut sink = c2r_sink.lock().await;
                                    if sink.send(ws_msg).await.is_err() {
                                        break;
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("[WS_PROXY] Client->Backend error: {:?}", e);
                            break;
                        }
                    }
                }
                log::info!("[WS_PROXY] Client->Backend task completed");
            }
        };

        // Task 2: Router -> Backend
        let backend_to_client = {
            let mut session = client_session.clone();
            async move {
                while let Some(msg_result) = r2q_stream.lock().await.next().await {
                    match msg_result {
                        Ok(msg) => {
                            let ws_msg = from_tungstenite_msg_to_actix_msg(msg);
                            match ws_msg {
                                Message::Text(text) => {
                                    log_frame_details("Sending Text Frame ->", &text, false);
                                    if let Err(e) = session.text(text).await {
                                        log::error!("[WS_PROXY] Failed to send message: {}", e);
                                        break;
                                    }
                                }
                                Message::Close(reason) => {
                                    log::info!("[WS_PROXY] Backend -> Router close {:?}", reason);

                                    // Debug incoming close frame
                                    debug_ws_message(
                                        "Received from backend",
                                        &Message::Close(reason.clone()),
                                    );

                                    // Create clean close
                                    let clean_close = CloseReason {
                                        code: reason
                                            .as_ref()
                                            .map(|r| r.code)
                                            .unwrap_or(CloseCode::Normal),
                                        // Skip description to avoid frame mixing
                                        description: None,
                                    };

                                    // Debug outgoing close frame
                                    debug_ws_message(
                                        "Sending to client",
                                        &Message::Close(Some(clean_close.clone())),
                                    );

                                    // First close client
                                    if let Err(e) = session.close(Some(clean_close)).await {
                                        log::error!("[WS_PROXY] Failed to close client: {}", e);
                                    }

                                    // Close backend sink
                                    let mut sink = r2q_sink.lock().await;
                                    if let Err(e) = sink.close().await {
                                        log::error!(
                                            "[WS_PROXY] Failed to close backend sink: {}",
                                            e
                                        );
                                    }
                                    break;
                                }
                                Message::Binary(bin) => {
                                    if session.binary(bin).await.is_err() {
                                        break;
                                    }
                                }
                                Message::Ping(ping) => {
                                    if session.ping(&ping).await.is_err() {
                                        break;
                                    }
                                }
                                Message::Pong(pong) => {
                                    if session.pong(&pong).await.is_err() {
                                        break;
                                    }
                                }
                                _ => {
                                    log::warn!("[WS_PROXY] Unsupported message type: {:?}", ws_msg)
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("[WS_PROXY] Backend error: {:?}", e);
                            break;
                        }
                    }
                }
                log::info!("[WS_PROXY] Backend->Client task completed");
            }
        };

        // Wait for both tasks to complete
        let tasks = tokio::join!(rt::spawn(client_to_backend), rt::spawn(backend_to_client));

        let elapsed = start_time.elapsed();
        log::info!("[WS_PROXY] Full session completed in {:?}", elapsed);

        if let (Err(e1), Err(e2)) = tasks {
            log::error!("[WS_PROXY] Tasks failed: {}, {}", e1, e2);
        }
    }
}

impl Drop for WsProxySession {
    fn drop(&mut self) {
        // Just log and rely on Arc/Mutex cleanup
        log::info!("[WS_PROXY] Session dropped");
    }
}

/// Convert actix-web WebSocket message to tungstenite message format
fn from_actix_message(msg: Message) -> tungstenite::protocol::Message {
    match msg {
        Message::Text(text) => tungstenite::protocol::Message::Text(text.to_string()),
        Message::Binary(bin) => tungstenite::protocol::Message::Binary(bin.to_vec()),
        Message::Ping(msg) => tungstenite::protocol::Message::Ping(msg.to_vec()),
        Message::Pong(msg) => tungstenite::protocol::Message::Pong(msg.to_vec()),
        Message::Close(reason) => {
            log::info!(
                "[WS_PROXY] Received a Message::Close with reason: {:#?}, closing connection to proxied server",
                reason
            );
            tungstenite::protocol::Message::Close(reason.map(|r| {
                tungstenite::protocol::CloseFrame {
                    code: u16::from(r.code).into(),
                    reason: r.description.unwrap_or_default().into(),
                }
            }))
        }
        _ => {
            log::info!("[WS_PROXY] Unsupported message type {:?}", msg);
            tungstenite::protocol::Message::Close(None)
        }
    }
}

/// Convert tungstenite WebSocket message to actix-web message format
fn from_tungstenite_msg_to_actix_msg(msg: tungstenite::protocol::Message) -> Message {
    match msg {
        tungstenite::protocol::Message::Text(text) => {
            log_frame_details("Converting Text ->", &text, false);
            Message::Text(text.into())
        }
        tungstenite::protocol::Message::Binary(bin) => Message::Binary(bin.into()),
        tungstenite::protocol::Message::Ping(msg) => Message::Ping(msg.into()),
        tungstenite::protocol::Message::Pong(msg) => Message::Pong(msg.into()),
        tungstenite::protocol::Message::Close(reason) => {
            if let Some(r) = &reason {
                log_frame_details("Converting Close ->", &r.reason, true);
            }
            Message::Close(reason.map(|r| actix_ws::CloseReason {
                code: u16::from(r.code).into(),
                description: if r.reason.is_empty() {
                    None
                } else {
                    Some(r.reason.to_string())
                },
            }))
        }
        _ => {
            log::info!("[WS_PROXY] Unsupported message type {:?}", msg);
            Message::Close(None)
        }
    }
}

/// Helper function to convert an HTTP/HTTPS URL to a WebSocket URL
pub fn convert_to_websocket_url(url_str: &str) -> Result<String, String> {
    let mut parsed_url = match Url::parse(url_str) {
        Ok(url) => url,
        Err(e) => {
            return Err(format!("Failed to parse URL: {}", e));
        }
    };

    // Check the scheme and update it accordingly
    match parsed_url.scheme() {
        "http" => {
            parsed_url
                .set_scheme("ws")
                .map_err(|_| "Failed to set scheme to ws")?;
        }
        "https" => {
            parsed_url
                .set_scheme("wss")
                .map_err(|_| "Failed to set scheme to wss")?;
        }
        _ => {
            return Err(format!("Unsupported URL scheme: {}", parsed_url.scheme()));
        }
    }

    Ok(parsed_url.to_string())
}

/// Helper function to convert an Actix HttpRequest to a Tungstenite WebSocket Request
pub fn convert_actix_to_tungstenite_request(
    actix_req: &HttpRequest,
    ws_base_url: &str,
) -> Result<tungstenite::http::Request<()>, Box<dyn std::error::Error>> {
    let mut url = Url::parse(ws_base_url)?;
    let query_string = actix_req.query_string();
    if !query_string.is_empty() {
        url.set_query(Some(query_string));
    }

    let uri: tungstenite::http::Uri = url.as_str().parse()?;

    let method = reqwest::Method::from_str(actix_req.method().as_str()).unwrap();
    let mut headers = tokio_tungstenite::tungstenite::http::HeaderMap::new();
    for (key, value) in actix_req.headers().iter() {
        if let Ok(header_str) = value.to_str() {
            if let Ok(header_name) = HeaderName::from_str(key.as_str()) {
                if let Ok(header_value) = HeaderValue::from_str(header_str) {
                    headers.insert(header_name, header_value);
                }
            }
        }
    }

    // insert headers for websockets, connection upgrade and upgrade to websocket
    headers.insert(
        HeaderName::from_static("connection"),
        HeaderValue::from_static("upgrade"),
    );
    headers.insert(
        HeaderName::from_static("upgrade"),
        HeaderValue::from_static("websocket"),
    );

    // Build the WebSocket request using the extracted method, URI, and headers
    let mut request_builder = tungstenite::http::Request::builder()
        .method(method)
        .uri(uri);

    for (key, value) in headers.iter() {
        request_builder = request_builder.header(key, value);
    }

    let ws_request = request_builder.body(())?;

    Ok(ws_request)
}

/// Add this helper function
fn log_frame_details(prefix: &str, text: &str, is_close: bool) {
    // 7b is '{' in JSON
    log::debug!(
        "[WS_FRAME] {} Length: {}, First 50 bytes: {}, Is close: {}",
        prefix,
        text.len(),
        hex::encode(&text.as_bytes()[..std::cmp::min(50, text.len())]),
        is_close
    );
}

// Add helper function to debug frame details
fn debug_ws_message(prefix: &str, msg: &Message) {
    match msg {
        Message::Text(text) => {
            log::debug!(
                "[WS_PROXY] {} Text frame: len={}, content_start='{}'",
                prefix,
                text.len(),
                &text[..text.len().min(50)]
            );
        }
        Message::Close(reason) => {
            if let Some(r) = reason {
                log::debug!(
                    "[WS_PROXY] {} Close frame: code={:?}, desc={:?}, desc_len={}",
                    prefix,
                    r.code,
                    r.description,
                    r.description.as_ref().map(|d| d.len()).unwrap_or(0)
                );
            } else {
                log::debug!("[WS_PROXY] {} Close frame: no reason", prefix);
            }
        }
        _ => log::debug!("[WS_PROXY] {} Other frame type: {:?}", prefix, msg),
    }
}

pub async fn ws_proxy(
    req: HttpRequest,
    payload: web::Payload,
    ws_base_url: &str,
) -> Result<HttpResponse, Error> {
    let (session, response) = WsProxySession::new(req, payload, ws_base_url).await?;
    rt::spawn(session.start());
    Ok(response)
}
