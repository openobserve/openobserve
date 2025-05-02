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

use std::sync::Arc;

use actix_http::StatusCode;
use async_trait::async_trait;
use config::{RwAHashMap, get_config, meta::websocket::SERVER_HEALTH_CHECK_PING_MSG, utils::json};
use futures_util::{
    SinkExt, StreamExt,
    stream::{SplitSink, SplitStream},
};
use reqwest::header::{HeaderName, HeaderValue};
use tokio::{
    net::TcpStream,
    sync::{RwLock, mpsc::Sender},
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async_with_config,
    tungstenite::{
        self,
        client::IntoClientRequest,
        protocol::{Message as WsMessage, WebSocketConfig},
    },
};

use super::pool::QuerierConnectionPool;
use crate::{
    common::{infra::cluster, utils::websocket::get_ping_interval_secs_with_jitter},
    router::http::ws::{
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
}

#[derive(Debug)]
pub struct QuerierConnection {
    querier_name: QuerierName,
    write: Arc<RwLock<Option<SplitSink<WsStreamType, WsMessage>>>>,
    response_router: Arc<ResponseRouter>,
    id: String,
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
    pub async fn flush(
        &self,
        querier_name: &QuerierName,
        force_remove: bool,
        error: Option<String>,
    ) {
        let mut count = 0;
        let mut write_guard = self.routes.write().await;
        let removed = write_guard.drain().collect::<Vec<_>>();
        drop(write_guard);
        for (trace_id, sender) in removed.into_iter() {
            // Send error response to client
            let _ = sender
                .send(WsServerEvents::Error {
                    code: StatusCode::SERVICE_UNAVAILABLE.into(),
                    message: error
                        .clone()
                        .unwrap_or("Querier connection closed".to_string()),
                    error_detail: None,
                    trace_id: Some(trace_id.clone()),
                    request_id: None,
                    should_client_retry: true, /* Indicate client should retry since the querier
                                                * connection is closed */
                })
                .await;
            log::debug!(
                "[WS::QuerierConnection::ResponseRouter] flushed for trace_id: {}, querier_name: {}, force_remove: {}",
                trace_id,
                querier_name,
                force_remove
            );
            count += 1;
        }
        log::debug!(
            "[WS::QuerierConnection::ResponseRouter] flushed {count} routes for querier: {}, force_remove: {}",
            querier_name,
            force_remove
        );
    }
}

pub async fn create_connection(querier_name: &QuerierName) -> WsResult<Arc<QuerierConnection>> {
    // Get querier info from cluster
    let node = cluster::get_cached_node_by_name(querier_name)
        .await
        .ok_or_else(|| WsError::QuerierWsConnNotAvailable(querier_name.to_string()))?;

    let conn = QuerierConnection::connect(&node.name, &node.http_addr).await?;
    Ok(conn)
}

impl QuerierConnection {
    pub fn get_name(&self) -> &QuerierName {
        &self.querier_name
    }

    pub async fn register_request(&self, trace_id: TraceId, response_tx: Sender<WsServerEvents>) {
        let mut write_guard = self.response_router.routes.write().await;
        write_guard.insert(trace_id.clone(), response_tx);
        drop(write_guard);
        log::info!(
            "[WS::QuerierConnection] registered trace_id {trace_id} in response_router-routes"
        );
    }

    pub async fn unregister_request(&self, trace_id: &TraceId) {
        let mut write_guard = self.response_router.routes.write().await;
        write_guard.remove(trace_id);
        write_guard.shrink_to_fit();
        drop(write_guard);
        log::debug!(
            "[WS::Connection] removed trace_id {trace_id} from response_router-routes, router: {}, querier: {}",
            get_config().common.instance_name,
            self.querier_name
        );
    }

    async fn listen_to_querier_response(
        &self,
        mut read: SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>,
    ) {
        let mut querier_conn_error: Option<String> = None;
        loop {
            // Handle incoming messages from querier to router
            if let Some(msg) = read.next().await {
                match msg {
                    Ok(msg) => {
                        match msg {
                            tungstenite::protocol::Message::Close(reason) => {
                                log::debug!(
                                    "[WS::Router::QuerierConnection] received close message: {:?}, router conn id: {}, querier: {}",
                                    reason,
                                    self.id,
                                    self.querier_name
                                );
                                break;
                            }
                            tungstenite::protocol::Message::Ping(ping) => {
                                log::debug!(
                                    "[WS::Router::QuerierConnection] received ping message: {:?}, router conn id: {}, querier: {}",
                                    ping,
                                    self.id,
                                    self.querier_name
                                );
                                let pong = tungstenite::protocol::Message::Pong(ping);
                                let write_clone = self.write.clone();
                                let mut write_guard = write_clone.write().await;
                                if let Some(write) = write_guard.as_mut() {
                                    let _ = write.send(pong).await;
                                }
                                drop(write_guard);
                            }
                            tungstenite::protocol::Message::Pong(pong) => {
                                log::debug!(
                                    "[WS::Router::QuerierConnection] received pong message: {:?}, router conn id: {}, querier: {}",
                                    pong,
                                    self.id,
                                    self.querier_name
                                );
                            }
                            tungstenite::protocol::Message::Binary(binary) => {
                                log::debug!(
                                    "[WS::Router::QuerierConnection] received binary message: {:?}, router conn id: {}, querier: {}",
                                    binary,
                                    self.id,
                                    self.querier_name
                                );
                            }
                            tungstenite::protocol::Message::Frame(frame) => {
                                log::debug!(
                                    "[WS::Router::QuerierConnection] received raw frame from querier: {:?}, router conn id: {}, querier: {}",
                                    frame,
                                    self.id,
                                    self.querier_name
                                );
                            }
                            tungstenite::protocol::Message::Text(text) => {
                                let svr_event = match json::from_str::<WsServerEvents>(&text) {
                                    Ok(event) => {
                                        log::info!(
                                            "[WS::Router::QuerierConnection] router received message from querier for trace_id: {}, router conn id: {}, querier: {}",
                                            event.get_trace_id(),
                                            self.id,
                                            self.querier_name
                                        );
                                        event
                                    }
                                    Err(e) => {
                                        log::error!(
                                            "[WS::Router::QuerierConnection] Error parsing message received from querier: {}, router conn id: {}, querier: {}",
                                            e,
                                            self.id,
                                            self.querier_name
                                        );
                                        match json::from_str::<json::Value>(&text)
                                            .map(|val| val.get("trace_id").map(ToString::to_string))
                                        {
                                            Err(e) => {
                                                log::error!(
                                                    "[WS::Router::QuerierConnection] Error parsing trace_id from message received from querier: router conn id: {}, querier: {}, error: {}",
                                                    self.id,
                                                    self.querier_name,
                                                    e
                                                );
                                                // scenario 1 where the trace_id & sender are not
                                                // cleaned up -> left for clean job
                                                continue;
                                            }
                                            Ok(trace_id) => WsServerEvents::Error {
                                                code: StatusCode::INTERNAL_SERVER_ERROR.into(),
                                                message:
                                                    "Failed to parse event received from querier"
                                                        .to_string(),
                                                error_detail: None,
                                                trace_id,
                                                request_id: None,
                                                should_client_retry: true,
                                            },
                                        }
                                    }
                                };
                                let remove_trace_id = svr_event.should_clean_trace_id();
                                if let Err(e) =
                                    self.response_router.route_response(svr_event.clone()).await
                                {
                                    // scenario 2 where the trace_id & sender are not cleaned up ->
                                    // left for clean job
                                    log::warn!(
                                        "[WS::Router::QuerierConnection] Error routing response from querier back to client, trace_id: {}, socket: {}, router conn id: {}, querier: {}",
                                        svr_event.get_trace_id(),
                                        e,
                                        self.id,
                                        self.querier_name
                                    );
                                    self.unregister_request(&svr_event.get_trace_id()).await;
                                }
                                if let Some(trace_id) = remove_trace_id {
                                    log::info!(
                                        "[WS::Router::QuerierConnection] Unregistering trace_id: {}, svr_event: {:?}, router conn id: {}, querier: {}",
                                        trace_id,
                                        svr_event,
                                        self.id,
                                        self.querier_name
                                    );
                                    self.unregister_request(&trace_id).await;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "[WS::Router::QuerierConnection] Read error: {}, Querier: {}, router conn id: {}",
                            e,
                            self.querier_name,
                            self.id
                        );
                        querier_conn_error = Some(e.to_string());
                        break;
                    }
                }
            } else {
                log::warn!(
                    "[WS::Router::QuerierConnection] Read error: received no message from querier, Querier: {}, router conn id: {}",
                    self.querier_name,
                    self.id
                );
            }
        }

        log::info!(
            "[WS::Router::QuerierConnection] listen_to_querier_response task stopped for querier: {}, router conn id: {}",
            self.querier_name,
            self.id
        );

        // reaches here when connection is closed/error from the querier side
        self.clean_up(false, querier_conn_error).await;
    }

    async fn _health_check(&self) {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
            get_ping_interval_secs_with_jitter() as _,
        ));
        interval.tick().await;

        loop {
            interval.tick().await;
            let mut write_guard = self.write.write().await;
            match write_guard.as_mut() {
                None => {
                    drop(write_guard);
                    break;
                }
                Some(w) => {
                    if w.send(WsMessage::Ping(
                        SERVER_HEALTH_CHECK_PING_MSG.as_bytes().to_vec(),
                    ))
                    .await
                    .is_err()
                    {
                        log::error!(
                            "[WS::QuerierConnection] failed to send ping message to querier {}, router: {}",
                            self.querier_name,
                            get_config().common.instance_name
                        );
                        drop(write_guard);
                        break;
                    }
                }
            }
            drop(write_guard);
        }

        self.clean_up(
            true,
            Some("Router -> Querier health check failed".to_string()),
        )
        .await;
    }

    pub async fn is_active_trace_id(&self, trace_id: &TraceId) -> bool {
        let r = self.response_router.routes.read().await;
        let is_active = r.contains_key(trace_id);
        drop(r);
        is_active
    }

    pub async fn _send_ping(&self) -> WsResult<()> {
        let mut write_guard = self.write.write().await;
        if let Some(write) = write_guard.as_mut() {
            if let Err(e) = write.send(WsMessage::Ping(vec![])).await {
                drop(write_guard);
                return Err(WsError::ConnectionError(e.to_string()));
            }
        }
        drop(write_guard);
        Ok(())
    }

    async fn clean_up(&self, force_remove: bool, error: Option<String>) {
        // flush in case of any remaining trace_ids
        self.response_router
            .flush(&self.querier_name, force_remove, error)
            .await;

        log::info!(
            "[WS::QuerierConnection] cleaning up connection to querier {}: force_remove: {}",
            self.querier_name,
            force_remove
        );

        // Send close message to the querier for graceful shutdown
        let mut write_guard = self.write.write().await;
        if let Some(write) = write_guard.as_mut() {
            if let Err(e) = write.close().await {
                log::warn!(
                    "[WS::QuerierConnection] failed to send close frame to querier during cleanup: {}",
                    e
                );
            }
            *write_guard = None;
        }
        drop(write_guard);

        log::debug!(
            "[WS::QuerierConnection] removing connection from the pool: {}, force_remove: {}",
            self.querier_name,
            force_remove
        );

        // remove the connection from the pool
        QuerierConnectionPool::clean_up(&self.querier_name).await
    }
}

impl ResponseRouter {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            routes: Default::default(),
        })

        // Spawn cleanup task
        // let response_router_cp = response_router.clone();
        // tokio::spawn(async move {
        //     response_router_cp.spawn_cleanup_task().await;
        // });
    }

    // Ideally all the registered request should be removed from the routes after done
    // The only
    // async fn spawn_cleanup_task(&self) {
    //     let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
    //     interval.tick().await;
    //     loop {
    //         interval.tick().await;
    //         let mut write_guard = self.routes.write().await;
    //         write_guard.retain(|trace_id, response_tx| {
    //             if response_tx.is_closed() {
    //                 log::debug!("[WS::QuerierConnection] channel closed for trace_id {trace_id}.
    // Removed from routes");                 false
    //             } else {
    //                 true
    //             }
    //         });
    //         write_guard.shrink_to_fit();
    //         drop(write_guard);
    //     }
    // }

    pub async fn route_response(&self, message: WsServerEvents) -> WsResult<()> {
        let start = std::time::Instant::now();
        let trace_id = message.get_trace_id();
        let sender = {
            let r = self.routes.read().await;
            let sender = r.get(&trace_id).cloned();
            drop(r);
            sender
        };
        let Some(resp_sender) = sender else {
            log::warn!(
                "[WS::Router::QuerierConnection] response_channel for trace_id {} not found.",
                trace_id,
            );
            return Err(WsError::ResponseChannelNotFound(trace_id.clone()));
        };

        log::debug!(
            "[WS::Router::QuerierConnection] time took to find response channel for trace_id {}: {} secs",
            trace_id,
            start.elapsed().as_secs_f64()
        );

        if let Err(e) = resp_sender.clone().send(message).await {
            log::warn!(
                "[WS::Router::QuerierConnection] router-client task the route_response channel for trace_id: {} error: {}",
                trace_id,
                e
            );
            let mut write_guard = self.routes.write().await;
            write_guard.remove(&trace_id);
            write_guard.shrink_to_fit();
            drop(write_guard);
            return Err(WsError::ResponseChannelClosed(trace_id.clone()));
        }
        Ok(())
    }
}

#[async_trait]
impl Connection for QuerierConnection {
    async fn connect(node_name: &str, http_url: &str) -> WsResult<Arc<Self>> {
        let cfg = get_config();
        let (ws_req, id) = get_default_querier_request(http_url)?;
        let websocket_config = WebSocketConfig {
            max_message_size: Some(cfg.websocket.max_continuation_size * 1024 * 1024),
            max_frame_size: Some(cfg.websocket.max_continuation_size * 1024 * 1024),
            ..Default::default()
        };

        // Router -> Querier
        let (ws_stream, _) = connect_async_with_config(ws_req, Some(websocket_config), false)
            .await
            .map_err(|e| {
                log::error!(
                    "[WS::QuerierConnection] error connecting to querier {}: {}",
                    http_url,
                    e
                );
                WsError::ConnectionError(e.to_string())
            })?;
        let (write, read) = ws_stream.split();
        let write = Arc::new(RwLock::new(Some(write)));

        // Setting up components needed for the two tasks
        let response_router = ResponseRouter::new();

        let conn: Arc<QuerierConnection> = Arc::new(Self {
            querier_name: node_name.to_string(),
            write,
            response_router,
            id,
        });

        // Spawn task to listen to querier responses
        let conn_t1 = conn.clone();
        tokio::spawn(async move {
            let _ = conn_t1.listen_to_querier_response(read).await;
        });

        // Spawn health check task
        // let conn_t2 = conn.clone();
        // tokio::spawn(async move {
        //     let _ = conn_t2.health_check().await;
        // });

        Ok(conn)
    }

    async fn disconnect(&self) {
        let mut write_guard = self.write.write().await;
        if let Some(write) = write_guard.as_mut() {
            let close_frame = tungstenite::protocol::Message::Close(None);
            let _ = write.send(close_frame).await;
            _ = write.close().await;
            *write_guard = None;
        }
        drop(write_guard);
    }

    async fn send_message(&self, message: WsClientEvents) -> WsResult<()> {
        log::info!(
            "[WS::QuerierConnection] send_message -> attempt to send for trace_id: {}",
            message.get_trace_id()
        );
        let mut write_guard = self.write.write().await;
        if let Some(write) = write_guard.as_mut() {
            let trace_id = message.get_trace_id();
            // Convert `WsClientEvents` to `tungstenite::protocol::Message`
            let message = tungstenite::protocol::Message::from(message);
            match write.send(message).await {
                Ok(_) => {
                    log::info!(
                        "[WS::QuerierConnection] request w/ trace_id {} successfully forwarded to querier conn id: {}",
                        trace_id,
                        self.id,
                    );
                    drop(write_guard);
                    Ok(())
                }
                Err(e) => {
                    log::error!(
                        "[WS::QuerierConnection] trace_id: {}, error sending messages via querier conn id: {}, error: {}",
                        trace_id,
                        self.id,
                        e
                    );
                    drop(write_guard);
                    self.clean_up(true, Some(e.to_string())).await;
                    Err(WsError::ConnectionError(format!(
                        "[WS::QuerierConnection] trace_id: {}, error sending messages via querier conn id: {}, error: {}",
                        trace_id, self.id, e
                    )))
                }
            }
        } else {
            drop(write_guard);
            self.clean_up(true, Some("Not connected".into())).await;
            Err(WsError::ConnectionError("Not connected".into()))
        }
    }
}

/// Helper function to create a mock request used to establish websocket connection with querier
fn get_default_querier_request(
    http_url: &str,
) -> WsResult<(tungstenite::http::Request<()>, String)> {
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

    let instance_name = get_config().common.instance_name.clone();
    let id = format!(
        "{}-{}",
        instance_name,
        chrono::Utc::now().timestamp_micros()
    );
    let parsed_url = parsed_url.to_string() + "api/default/ws/v2/" + &id;

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

    Ok((ws_req, id))
}
