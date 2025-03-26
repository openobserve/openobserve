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
    atomic::{AtomicBool, Ordering},
};

use actix_http::StatusCode;
use async_trait::async_trait;
use config::{RwAHashMap, get_config, utils::json};
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
    router::http::ws_v2::{
        error::*,
        handler::{QuerierName, TraceId},
    },
    service::websocket_events::{WsClientEvents, WsServerEvents},
};

type WsStreamType = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[async_trait]
pub trait Connection: Send + Sync {
    async fn connect(node_name: &str, http_url: &str) -> WsResult<Arc<Self>>;
    async fn disconnect(&self);
    async fn send_message(&self, message: WsClientEvents) -> WsResult<()>;
    async fn is_connected(&self) -> bool;
}

#[derive(Debug)]
pub struct QuerierConnection {
    querier_name: QuerierName,
    write: Arc<Mutex<Option<SplitSink<WsStreamType, WsMessage>>>>,
    shutdown_tx: Sender<()>,
    response_router: Arc<ResponseRouter>,
    is_connected: Arc<AtomicBool>,
}

impl Drop for QuerierConnection {
    fn drop(&mut self) {
        log::info!(
            "[WS::QuerierConnection] connection to querier {} closed",
            self.querier_name
        );
    }
}

#[derive(Debug, Default)]
pub struct ResponseRouter {
    routes: RwAHashMap<TraceId, Sender<WsServerEvents>>,
}

impl Drop for ResponseRouter {
    fn drop(&mut self) {
        log::info!("[WS::ResponseRouter] shutting down. Stop routing responses from querier");
    }
}

impl ResponseRouter {
    pub async fn flush(&self) {
        let mut count = 0;
        for (trace_id, sender) in self.routes.write().await.drain() {
            // Send error response to client
            let _ = sender
                .send(WsServerEvents::Error {
                    code: StatusCode::SERVICE_UNAVAILABLE.into(),
                    message: "Querier connection closed".to_string(),
                    error_detail: None,
                    trace_id: Some(trace_id),
                    request_id: None,
                    should_client_retry: true, /* Indicate client should retry since the querier
                                                * connection is closed */
                })
                .await;
            count += 1;
        }

        log::info!("[WS::QuerierConnection::ResponseRouter] flushed {count} routes",);
    }
}

pub async fn create_connection(querier_name: &QuerierName) -> WsResult<Arc<QuerierConnection>> {
    // Get querier info from cluster
    let node = cluster::get_cached_node_by_name(querier_name)
        .await
        .ok_or_else(|| WsError::QuerierNotAvailable(querier_name.to_string()))?;

    let conn = QuerierConnection::connect(&node.name, &node.http_addr).await?;
    Ok(conn)
}

impl QuerierConnection {
    pub async fn register_request(&self, trace_id: TraceId, response_tx: Sender<WsServerEvents>) {
        self.response_router
            .routes
            .write()
            .await
            .insert(trace_id, response_tx);
    }

    pub async fn unregister_request(&self, trace_id: &TraceId) {
        let mut write_guard = self.response_router.routes.write().await;
        write_guard.remove(trace_id);
        write_guard.shrink_to_fit();
        log::debug!("[WS::Connection] removed trace_id {trace_id} from response_router-routes");
    }

    async fn listen_to_querier_response(
        &self,
        mut read: SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
        mut shutdown_rx: tokio::sync::mpsc::Receiver<()>,
    ) {
        loop {
            // Handle incoming messages from querier to router
            tokio::select! {
                Some(msg) = read.next() => {
                    match msg {
                        Ok(msg) => {
                            match msg {
                                tungstenite::protocol::Message::Close(reason) => {
                                    log::debug!("[WS::Router::QuerierConnection] received close message: {:?}", reason);
                                    break;
                                }
                                tungstenite::protocol::Message::Ping(ping) => {
                                    log::debug!("[WS::Router::QuerierConnection] received ping message: {:?}", ping);
                                    let pong = tungstenite::protocol::Message::Pong(ping);
                                    let write_clone = self.write.clone();
                                    let mut write_guard = write_clone.lock().await;
                                    if let Some(write) = write_guard.as_mut() {
                                        let _ = write.send(pong).await;
                                    }
                                }
                                tungstenite::protocol::Message::Pong(pong) => {
                                    log::debug!("[WS::Router::QuerierConnection] received pong message: {:?}", pong);
                                }
                                tungstenite::protocol::Message::Binary(binary) => {
                                    log::debug!("[WS::Router::QuerierConnection] received binary message: {:?}", binary);
                                }
                                tungstenite::protocol::Message::Frame(frame) => {
                                    log::debug!("[WS::Router::QuerierConnection] received raw frame from querier: {:?}", frame);
                                }
                                tungstenite::protocol::Message::Text(text) => {
                                    let svr_event = match json::from_str::<WsServerEvents>(&text) {
                                        Ok(event) => event,
                                        Err(e) => {
                                            log::error!(
                                                "[WS::Router::QuerierConnection] Error parsing message received from querier: {}. Trying to get trace_id",
                                                e
                                            );
                                            match json::from_str::<json::Value>(&text).map(|val| val.get("trace_id").map(ToString::to_string)) {
                                                Err(e) => {
                                                    log::error!(
                                                        "[WS::Router::QuerierConnection] Error parsing trace_id from message received from querier: {}. Drop the message",
                                                        e
                                                    );
                                                    // scenario 1 where the trace_id & sender are not cleaned up -> left for clean job
                                                    continue;
                                                }
                                                Ok(trace_id) => {
                                                    WsServerEvents::Error {
                                                        code: StatusCode::INTERNAL_SERVER_ERROR.into(),
                                                        message: "Failed to parse event received from querier".to_string(),
                                                        error_detail: None,
                                                        trace_id,
                                                        request_id: None,
                                                        should_client_retry: true,
                                                    }
                                                }
                                            }
                                        }
                                    };
                                    let remove_trace_id = svr_event.should_clean_trace_id();
                                    if let Err(e) = self.response_router.route_response(svr_event).await {
                                        // scenario 2 where the trace_id & sender are not cleaned up -> left for clean job
                                        log::error!(
                                            "[WS::Router::QuerierConnection] Error routing response from querier back to client socket: {}",
                                            e
                                        );
                                    }
                                    if let Some(trace_id) = remove_trace_id {
                                        self.unregister_request(&trace_id).await;
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("[WS::Router::QuerierConnection] Read error: {}, Querier: {}", e, self.querier_name);
                            break;
                        }
                    }
                }
                _ = shutdown_rx.recv() => {
                    log::info!("[WS::Router::QuerierConnection] shutting down. Stop listening from the querier {}", self.querier_name);
                    break;
                }
            }
        }

        // reaches here when connection is closed/error from the querier side
        // mark the connection disconnected and exist
        self.is_connected.store(false, Ordering::SeqCst);
        // flush in case of any remaining trace_ids
        self.response_router.flush().await;
    }

    async fn health_check(&self) {
        let cfg = get_config();
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
            cfg.websocket.health_check_interval as _,
        ));

        loop {
            interval.tick().await;
            let mut write_guard = self.write.lock().await;
            match write_guard.as_mut() {
                None => {
                    break;
                }
                Some(w) => {
                    if w.send(WsMessage::Ping(vec![])).await.is_err() {
                        break;
                    }
                }
            }
        }

        // mark the connection disconnected and exist
        self.is_connected.store(false, Ordering::SeqCst);
        // flush in case of any remaining trace_ids
        self.response_router.flush().await;
    }

    pub async fn is_active_trace_id(&self, trace_id: &TraceId) -> bool {
        self.response_router
            .routes
            .read()
            .await
            .contains_key(trace_id)
    }
}

impl ResponseRouter {
    pub fn new() -> Arc<Self> {
        let response_router = Arc::new(Self {
            routes: Default::default(),
        });

        // Spawn cleanup task
        let response_router_cp = response_router.clone();
        tokio::spawn(async move {
            response_router_cp.spawn_cleanup_task().await;
        });

        response_router
    }

    /// Ideally all the registered request should be removed from the routes after done
    /// The only
    async fn spawn_cleanup_task(&self) {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            let mut write_guard = self.routes.write().await;
            write_guard.retain(|trace_id, response_tx| {
                if response_tx.is_closed() {
                    log::debug!("[WS::QuerierConnection] channel closed for trace_id {trace_id}. Removed from routes");
                    false
                } else {
                    true
                }
            });
            write_guard.shrink_to_fit();
        }
    }

    pub async fn route_response(&self, message: WsServerEvents) -> WsResult<()> {
        let trace_id = message.get_trace_id();

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
        });

        // Spawn task to listen to querier responses
        let conn_t1 = conn.clone();
        tokio::spawn(async move {
            let _ = conn_t1.listen_to_querier_response(read, shutdown_rx).await;
            if !conn_t1.is_connected().await {
                log::info!(
                    "[WS::QuerierConnection] connection to querier {} closed",
                    conn_t1.querier_name
                );
            }
        });

        // Spawn health check task
        let conn_t2 = conn.clone();
        tokio::spawn(async move {
            let _ = conn_t2.health_check().await;
            if !conn_t2.is_connected().await {
                log::info!(
                    "[WS::QuerierConnection] connection to querier {} closed",
                    conn_t2.querier_name
                );
            }
        });

        Ok(conn)
    }

    async fn disconnect(&self) {
        let mut write_guard = self.write.lock().await;
        if let Some(write) = write_guard.as_mut() {
            let close_frame = tungstenite::protocol::Message::Close(None);
            let _ = write.send(close_frame).await;
            _ = write.close().await;
            *write_guard = None;
        }
        _ = self.shutdown_tx.send(()).await;
    }

    async fn send_message(&self, message: WsClientEvents) -> WsResult<()> {
        let mut write_guard = self.write.lock().await;
        if let Some(write) = write_guard.as_mut() {
            let trace_id = message.get_trace_id();
            // Convert `WsClientEvents` to `tungstenite::protocol::Message`
            let message = tungstenite::protocol::Message::from(message);
            match write.send(message).await {
                Ok(_) => {
                    log::info!(
                        "[WS::QuerierConnection] request w/ trace_id {} successfully forwarded to querier {}",
                        trace_id,
                        self.querier_name
                    );
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
        if self.write.lock().await.is_some() {
            self.is_connected.load(Ordering::SeqCst)
        } else {
            false
        }
    }
}

/// Helper function to create a mock request used to establish websocket connection with querier
fn get_default_querier_request(http_url: &str) -> WsResult<tungstenite::http::Request<()>> {
    let mut parsed_url = match url::Url::parse(http_url) {
        Ok(url) => url,
        Err(e) => return Err(WsError::QuerierUrlInvalid(e.to_string())),
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

    // TODO: v2 ws endpoint should be agnostic from `org` and `12345678`
    let parsed_url = parsed_url.to_string() + "api/default/ws/v2/12345678";

    let mut ws_req = parsed_url
        .into_client_request()
        .map_err(|e| WsError::ConnectionError(e.to_string()))?;

    // additional headers to the req
    let token = get_config().grpc.internal_grpc_token.clone();
    ws_req.headers_mut().insert(
        HeaderName::from_static("authorization"),
        HeaderValue::from_str(&token).map_err(|e| WsError::ConnectionError(e.to_string()))?,
    );
    // Add hearder upgrade websocket
    ws_req.headers_mut().insert(
        HeaderName::from_static("upgrade"),
        HeaderValue::from_str("websocket").map_err(|e| WsError::ConnectionError(e.to_string()))?,
    );

    Ok(ws_req)
}
