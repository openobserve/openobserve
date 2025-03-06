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

use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use config::{RwAHashMap, utils::json};
use futures_util::{SinkExt, StreamExt, stream::SplitSink};
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
    router::http::ws_v2::{error::*, types::*},
    service::websocket_events::{WsClientEvents, WsServerEvents},
};

type WsStreamType = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[async_trait]
pub trait Connection: Send + Sync {
    async fn connect(&self) -> WsResult<()>;
    async fn disconnect(&self);
    async fn send_message(&self, message: StreamMessage) -> WsResult<()>;
    async fn is_connected(&self) -> bool;
    fn get_name(&self) -> &QuerierName;
}

#[derive(Debug)]
pub struct QuerierConnection {
    querier_name: QuerierName,
    url: String,
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

impl QuerierConnection {
    pub async fn establish_connection(
        querier_name: QuerierName,
        url: String,
    ) -> WsResult<Arc<Self>> {
        // Connect to querier
        // FIXME: This needs req to call connect_async "ws://192.168.1.6:5070/"
        let url = format!("{}api/default/ws/v2/123456789", url);
        let mut req = match url.clone().into_client_request() {
            Ok(req) => req,
            Err(e) => return Err(WsError::ConnectionError(e.to_string())),
        };

        // Properly encode credentials
        let credentials = "root@example.com:Complexpass#123";
        let auth_header = format!("Basic {}", BASE64.encode(credentials));

        // Add auth header
        req.headers_mut().insert(
            HeaderName::from_static("authorization"),
            HeaderValue::from_str(&auth_header)
                .map_err(|e| WsError::ConnectionError(e.to_string()))?,
        );
        // Add hearder upgrade websocket
        req.headers_mut().insert(
            HeaderName::from_static("upgrade"),
            HeaderValue::from_str("websocket")
                .map_err(|e| WsError::ConnectionError(e.to_string()))?,
        );

        // Router -> Querier
        let (ws_stream, _) = connect_async(req).await.map_err(|e| {
            log::error!(
                "[WS::QuerierConnection] error connecting to querier {}: {}",
                url,
                e
            );
            WsError::ConnectionError(e.to_string())
        })?;
        let (write, mut read) = ws_stream.split();
        let write = Arc::new(Mutex::new(Some(write)));

        // Signal to shutdown
        let (shutdown_tx, mut shutdown_rx) = channel::<()>(1);

        // Setting up components needed for the two tasks
        let response_router = ResponseRouter::new();
        let is_connected = Arc::new(AtomicBool::new(true));
        let is_connected_health_task = is_connected.clone();
        let querier_name_cp_t1 = querier_name.clone();
        let querier_name_cp_t2 = querier_name.clone();

        let conn: Arc<QuerierConnection> = Arc::new(Self {
            querier_name,
            url: url.to_string(),
            write: write.clone(),
            shutdown_tx,
            response_router: response_router.clone(),
            is_connected: is_connected.clone(),
            last_active: std::sync::atomic::AtomicI64::new(chrono::Utc::now().timestamp_micros()),
        });

        // Receive messages from querier and route them to the client
        let conn_clone = conn.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(msg) = read.next() => {
                        match msg {
                            Ok(msg) => {
                                match msg {
                                    tungstenite::protocol::Message::Close(reason) => {
                                        log::info!("[WS::QuerierConnection] received close message: {:?}", reason);
                                    }
                                    tungstenite::protocol::Message::Ping(ping) => {
                                        log::info!("[WS::QuerierConnection] received ping message: {:?}", ping);
                                        let pong = tungstenite::protocol::Message::Pong(ping);
                                        let write_clone = write.clone();
                                        let mut write_guard = write_clone.lock().await;
                                        if let Some(write) = write_guard.as_mut() {
                                            let _ = write.send(pong).await;
                                        }
                                        conn_clone.update_last_active();
                                    }
                                    tungstenite::protocol::Message::Pong(pong) => {
                                        log::info!("[WS::QuerierConnection] received pong message: {:?}", pong);
                                    }
                                    tungstenite::protocol::Message::Binary(binary) => {
                                        log::info!("[WS::QuerierConnection] received binary message: {:?}", binary);
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
                                            match response_router.route_response(message).await {
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
                                is_connected.store(false, Ordering::SeqCst);
                                // TODO: cleanup resource

                                break;
                            }
                        }
                    }
                    _ = shutdown_rx.recv() => {
                        log::info!("[WS::QuerierConnection] shutting down. Stop listening from the querier");
                        // mark the connection disconnected
                        is_connected.store(false, Ordering::SeqCst);
                        // TODO: cleanup resource?

                        break;
                    }
                }
            }

            log::info!(
                "[WS::QuerierConnection] connection to querier {querier_name_cp_t1} response handler stopped."
            );
        });

        // Spawn health check task
        let conn_clone = conn.clone();
        tokio::spawn(async move {
            // TODO: configurable duration interval
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(10));

            loop {
                interval.tick().await;
                let mut write_guard = conn_clone.write.lock().await;
                match write_guard.as_mut() {
                    None => {
                        is_connected_health_task.store(false, Ordering::SeqCst);
                        break;
                    }
                    Some(w) => {
                        if w.send(WsMessage::Ping(vec![])).await.is_err() {
                            is_connected_health_task.store(false, Ordering::SeqCst);
                            break;
                        }
                    }
                }
            }

            log::warn!(
                "[WS:QuerierConnection] connection to querier {querier_name_cp_t2} health check failed, marked disconnected"
            );
        });

        Ok(conn)
    }

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
    async fn connect(&self) -> WsResult<()> {
        let mut write_guard = self.write.lock().await;
        if write_guard.is_none() {
            let (ws_stream, _) = connect_async(&self.url)
                .await
                .map_err(|e| WsError::ConnectionError(e.to_string()))?;
            let (write, _) = ws_stream.split();
            *write_guard = Some(write);
        }
        Ok(())
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
