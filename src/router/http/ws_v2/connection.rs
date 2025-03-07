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

use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicI64, Ordering},
};

use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use config::{RwAHashMap, utils::json};
use futures_util::{
    SinkExt, StreamExt,
    stream::{SplitSink, SplitStream},
};
use reqwest::header::{HeaderName, HeaderValue};
use tokio::{
    net::TcpStream,
    sync::{
        Mutex,
        mpsc::{Sender, channel},
    },
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{self, client::IntoClientRequest, protocol::Message as WsMessage},
};

use crate::{
    common::infra::cluster,
    router::http::ws_v2::{error::*, types::*},
    service::websocket_events::{WsClientEvents, WsServerEvents},
};

type WsStreamType = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[async_trait]
pub trait Connection: Send + Sync {
    async fn connect(node_name: &str, http_url: &str) -> WsResult<Arc<Self>>;
    async fn disconnect(&self);
    async fn send_message(&self, message: StreamMessage) -> WsResult<()>;
    async fn is_connected(&self) -> bool;
    fn get_name(&self) -> &QuerierName;
}

#[derive(Debug)]
pub struct QuerierConnection {
    querier_name: QuerierName,
    write: Arc<Mutex<Option<SplitSink<WsStreamType, WsMessage>>>>,
    shutdown_tx: Sender<()>,
    response_router: Arc<ResponseRouter>,
    is_connected: Arc<AtomicBool>,
    last_active: std::sync::atomic::AtomicI64,
}

#[derive(Debug, Default)]
pub struct ResponseRouter {
    routes: RwAHashMap<TraceId, Sender<StreamMessage>>,
}

type SocketWriter = Arc<
    Mutex<
        Option<
            SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, tungstenite::protocol::Message>,
        >,
    >,
>;

pub async fn create_connection(querier_name: &QuerierName) -> WsResult<Arc<QuerierConnection>> {
    // Get querier info from cluster
    let node = cluster::get_cached_node_by_name(querier_name)
        .await
        .ok_or_else(|| WsError::QuerierNotAvailable(querier_name.clone()))?;

    let conn = QuerierConnection::connect(&node.name, &node.http_addr).await?;
    Ok(conn)
}

impl QuerierConnection {
    pub async fn register_request(&self, trace_id: TraceId, response_tx: Sender<StreamMessage>) {
        self.response_router
            .register_request(trace_id, response_tx)
            .await
    }

    fn update_last_active(&self) {
        self.last_active.store(
            chrono::Utc::now().timestamp_micros(),
            std::sync::atomic::Ordering::SeqCst,
        );
    }

    async fn listen_to_querier_response(
        &self,
        mut read: SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
        mut shutdown_rx: tokio::sync::mpsc::Receiver<()>,
    ) {
        loop {
            tokio::select! {
                Some(msg) = read.next() => {
                    match msg {
                        Ok(msg) => {
                            match msg {
                                tungstenite::protocol::Message::Close(reason) => {
                                    log::debug!("[WS::QuerierConnection] received close message: {:?}", reason);
                                }
                                tungstenite::protocol::Message::Ping(ping) => {
                                    log::debug!("[WS::QuerierConnection] received ping message: {:?}", ping);
                                    let pong = tungstenite::protocol::Message::Pong(ping);
                                    let write_clone = self.write.clone();
                                    let mut write_guard = write_clone.lock().await;
                                    if let Some(write) = write_guard.as_mut() {
                                        let _ = write.send(pong).await;
                                    }
                                    self.update_last_active();
                                }
                                tungstenite::protocol::Message::Pong(pong) => {
                                    log::debug!("[WS::QuerierConnection] received pong message: {:?}", pong);
                                }
                                tungstenite::protocol::Message::Binary(binary) => {
                                    log::debug!("[WS::QuerierConnection] received binary message: {:?}", binary);
                                }
                                msg => {
                                        log::debug!("[WS::QuerierConnection] received message: {:?}", msg);
                                        // Convert `tungstenite::protocol::Message` to `StreamMessage`
                                        let message: StreamMessage = match msg.try_into() {
                                            Ok(message) => message,
                                            Err(e) => {
                                                log::error!(
                                                    "[WS::QuerierConnection] Error converting message to StreamMessage: {}",
                                                    e
                                                );
                                                continue;
                                            }
                                        };
                                        match self.response_router.route_response(message).await {
                                            Err(e) => {
                                                log::error!(
                                                    "[WS::QuerierConnection] Error routing response from querier back to client socket: {}",
                                                    e
                                                );
                                            }
                                            Ok(_) => {
                                                log::debug!(
                                                "[WS::QuerierConnection] successfully rerouted response from querier back to client socket listener"
                                            );
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("[WS] Read error: {}", e);
                            // mark the connection disconnected
                            self.is_connected.store(false, Ordering::SeqCst);
                            // TODO: cleanup resource

                            break;
                        }
                    }
                }
                _ = shutdown_rx.recv() => {
                    log::info!("[WS::QuerierConnection] shutting down. Stop listening from the querier");
                    // mark the connection disconnected
                    self.is_connected.store(false, Ordering::SeqCst);
                    // TODO: cleanup resource?

                    break;
                }
            }
        }

        log::info!(
            "[WS::QuerierConnection] connection to querier {} response handler stopped.",
            self.querier_name
        );
    }

    async fn health_check(&self) {
        // TODO: configurable duration interval
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(10));

        loop {
            interval.tick().await;
            let mut write_guard = self.write.lock().await;
            match write_guard.as_mut() {
                None => {
                    self.is_connected.store(false, Ordering::SeqCst);
                    break;
                }
                Some(w) => {
                    if w.send(WsMessage::Ping(vec![])).await.is_err() {
                        self.is_connected.store(false, Ordering::SeqCst);
                        break;
                    }
                }
            }
        }

        log::warn!(
            "[WS:QuerierConnection] connection to querier {} health check failed, disconnecting...",
            self.querier_name
        );
    }
}

impl ResponseRouter {
    pub fn new() -> Arc<Self> {
        let response_router = Arc::new(Self {
            routes: Default::default(),
        });

        // Spawn cleanup task
        Self::spawn_cleanup_task(response_router.clone());

        response_router
    }

    fn spawn_cleanup_task(router: Arc<ResponseRouter>) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));

            loop {
                interval.tick().await;
                router.remove_completed_requests().await;
            }
        });
    }

    async fn register_request(&self, trace_id: TraceId, response_tx: Sender<StreamMessage>) {
        self.routes.write().await.insert(trace_id, response_tx);
    }

    async fn remove_completed_requests(&self) {
        self.routes
            .write()
            .await
            .retain(|_, response_tx| !response_tx.is_closed());
    }

    pub async fn route_response(&self, message: StreamMessage) -> WsResult<()> {
        let trace_id = message.trace_id.clone();

        match self.routes.read().await.get(&trace_id) {
            None => Err(WsError::ResponseChannelNotFound(trace_id.clone())),
            Some(resp_sender) => {
                resp_sender
                    .send(message)
                    .await
                    .map_err(|_| WsError::ResponseChannelClosed(trace_id.clone()))?;
                Ok(())
            }
        }
    }
}

#[async_trait]
impl Connection for QuerierConnection {
    async fn connect(node_name: &str, http_url: &str) -> WsResult<Arc<Self>> {
        let ws_req = get_default_querier_request(http_url)?;

        // Router -> Querier
        let (ws_stream, _) = connect_async(ws_req).await.map_err(|e| {
            log::error!(
                "[WS::QuerierConnection] error connecting to querier {}: {}",
                http_url,
                e
            );
            WsError::ConnectionError(e.to_string())
        })?;
        let (write, read) = ws_stream.split();
        let write = Arc::new(Mutex::new(Some(write)));

        // Signal to shutdown
        let (shutdown_tx, shutdown_rx) = channel::<()>(1);

        // Setting up components needed for the two tasks
        let response_router = ResponseRouter::new();
        let is_connected = Arc::new(AtomicBool::new(true));

        let conn: Arc<QuerierConnection> = Arc::new(Self {
            querier_name: node_name.to_string(),
            write,
            shutdown_tx,
            response_router,
            is_connected,
            last_active: AtomicI64::new(chrono::Utc::now().timestamp_micros()),
        });

        // Spawn task to listen to querier responses
        let conn_t1 = conn.clone();
        tokio::spawn(async move {
            conn_t1.listen_to_querier_response(read, shutdown_rx);
        });

        // Spawn health check task
        let conn_t2 = conn.clone();
        tokio::spawn(async move {
            conn_t2.health_check();
        });

        Ok(conn)
    }

    async fn disconnect(&self) {
        let mut write_guard = self.write.lock().await;
        if let Some(write) = write_guard.as_mut() {
            // TODO: when closing a websocket connection, is it okay to just close the sink side of
            // the connection? or we need to send close frame?

            // no need to concern/handle close error since it's being removed
            _ = write.close().await;
            *write_guard = None;
        }
        _ = self.shutdown_tx.send(()).await;
    }

    async fn send_message(&self, message: StreamMessage) -> WsResult<()> {
        let mut write_guard = self.write.lock().await;
        if let Some(write) = write_guard.as_mut() {
            let trace_id = message.trace_id.clone();
            // Send `WsClientEvents` to querier
            let message: WsClientEvents = message
                .try_into()
                .map_err(|e| WsError::ConnectionError(e))?;
            // Convert `WsClientEvents` to `tungstenite::protocol::Message`
            let message = message.into();
            match write.send(message).await {
                Ok(_) => {
                    log::info!(
                        "[WS::QuerierConnection] request w/ trace_id {} successfully forwarded to querier {}",
                        trace_id,
                        self.querier_name
                    );
                    self.update_last_active();
                    Ok(())
                }
                Err(e) => {
                    log::error!(
                        "[WS::QuerierConnection] error sending messages via connection {e}. Mark the connection disconnected"
                    );
                    self.is_connected.store(false, Ordering::SeqCst);
                    Err(WsError::ConnectionError(format!(
                        "[WS::QuerierConnection] error sending messages via connection {e}"
                    )))
                }
            }
        } else {
            Err(WsError::ConnectionError("Not connected".into()))
        }
    }

    async fn is_connected(&self) -> bool {
        self.is_connected.load(Ordering::SeqCst) && self.write.lock().await.is_some()
    }

    fn get_name(&self) -> &QuerierName {
        &self.querier_name
    }
}

/// Helper function to create a mock request used to establish websocket connection with querier
fn get_default_querier_request(http_url: &str) -> WsResult<tungstenite::http::Request<()>> {
    let mut parsed_url = match url::Url::parse(http_url) {
        Ok(url) => url,
        Err(e) => return Err(WsError::QuerierUrlInvalid(http_url.into())),
    };

    // Check the scheme and update it accordingly
    match parsed_url.scheme() {
        "http" => {
            parsed_url
                .set_scheme("ws")
                .map_err(|_| WsError::QuerierWSUrlError("Failed to set scheme to ws".into()))?;
        }
        "https" => {
            parsed_url
                .set_scheme("wss")
                .map_err(|_| WsError::QuerierWSUrlError("Failed to set scheme to wss".into()))?;
        }
        other_schema => {
            return Err(WsError::QuerierWSUrlError(format!(
                "Unsupported URL scheme: {}",
                other_schema
            )));
        }
    }

    let parsed_url = parsed_url.to_string() + "api/ws/v2";

    let mut ws_req = parsed_url
        .into_client_request()
        .map_err(|e| WsError::ConnectionError(e.to_string()))?;

    let cfg = config::get_config();
    // TODO: confirm it's okay use root user cred and can always be accepted by querier
    let credentials = format!(
        "{}:{}",
        &cfg.auth.root_user_email, &cfg.auth.root_user_password
    );
    let auth_header = format!("Basic {}", BASE64.encode(credentials));

    // additional headers to the req
    ws_req.headers_mut().insert(
        HeaderName::from_static("authorization"),
        HeaderValue::from_str(&auth_header).map_err(|e| WsError::ConnectionError(e.to_string()))?,
    );
    // Add hearder upgrade websocket
    ws_req.headers_mut().insert(
        HeaderName::from_static("upgrade"),
        HeaderValue::from_str("websocket").map_err(|e| WsError::ConnectionError(e.to_string()))?,
    );

    Ok(ws_req)
}
