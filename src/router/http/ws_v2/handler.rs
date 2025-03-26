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
use actix_web::{Error, HttpRequest, HttpResponse, web};
use actix_ws::{CloseCode, CloseReason};
use config::{get_config, meta::cluster::RoleGroup, utils::json};
use futures_util::StreamExt;

use super::{
    connection::{Connection, QuerierConnection},
    error::*,
    pool::QuerierConnectionPool,
    session::SessionManager,
};
#[cfg(feature = "enterprise")]
use crate::common::utils::auth::extract_auth_expiry_and_user_id;
use crate::service::websocket_events::{WsClientEvents, WsServerEvents};

pub type ClientId = String;
pub type QuerierName = String;
pub type TraceId = String;

#[derive(Debug)]
pub struct WsHandler {
    pub session_manager: Arc<SessionManager>,
    pub connection_pool: Arc<QuerierConnectionPool>,
}

impl WsHandler {
    pub fn new(
        session_manager: Arc<SessionManager>,
        connection_pool: Arc<QuerierConnectionPool>,
    ) -> Self {
        Self {
            session_manager,
            connection_pool,
        }
    }

    pub async fn handle_connection(
        &self,
        req: HttpRequest,
        stream: web::Payload,
        client_id: ClientId,
    ) -> Result<HttpResponse, Error> {
        let cfg = get_config();

        // Client -> Router connection
        let (response, mut ws_session, mut msg_stream) = actix_ws::handle(&req, stream)?;

        // Create session by registering the client & extract the user_id from the auth
        #[cfg(feature = "enterprise")]
        let (mut cookie_expiry, user_id) = extract_auth_expiry_and_user_id(&req).await;

        #[cfg(feature = "enterprise")]
        {
            if !cfg.websocket.check_cookie_expiry {
                cookie_expiry = None;
            }
        }

        #[cfg(not(feature = "enterprise"))]
        let cookie_expiry = None;

        self.session_manager
            .register_client(&client_id, cookie_expiry)
            .await;

        // Setup message channels
        // TODO: add env variable for this for channel size
        let (response_tx, mut response_rx) = tokio::sync::mpsc::channel::<WsServerEvents>(100);
        let (disconnect_tx, mut disconnect_rx) =
            tokio::sync::mpsc::channel::<Option<DisconnectMessage>>(10);
        let session_manager = self.session_manager.clone();
        let connection_pool = self.connection_pool.clone();

        // Spawn message handling tasks between client and router
        actix_web::rt::spawn(async move {
            let mut ping_interval = tokio::time::interval(tokio::time::Duration::from_secs(
                cfg.websocket.ping_interval_secs as _,
            ));
            ping_interval.tick().await; // first tick is immediate

            // Handle incoming messages from client
            let handle_incoming = async {
                loop {
                    tokio::select! {
                        _ = tokio::time::sleep(tokio::time::Duration::from_secs(cfg.websocket.session_idle_timeout_secs as _ )) => {
                            // check if last_active time is updated by the outgoing thread
                            if session_manager.reached_max_idle_time(&client_id).await {
                                log::info!("[WS::Router::Handler]: MAX_IDLE_TIME reached. Normal shutdown");
                                if let Err(e) = disconnect_tx.send(None).await {
                                    log::error!(
                                        "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                    );
                                };
                                break;
                            }
                        }
                        _ = ping_interval.tick() => {
                            if let Err(e) = response_tx.send(WsServerEvents::Ping(vec![])).await {
                                log::error!("[WS::Router::Handler] error sending ping to outgoing thread via response channel: {}", e);
                                _ = disconnect_tx.send(None).await;
                                break;
                            }
                        }
                        Some(msg) = msg_stream.next() => {
                            match msg {
                                Err(e) => {
                                    log::error!(
                                        "[WS::Router::Handler] error receiving websocket message from client {e}"
                                    );
                                    let err_msg = ErrorMessage::new(e.into(), None, None);
                                    let should_disconnect = err_msg.should_disconnect;
                                    if let Err(e) = disconnect_tx.send(Some(DisconnectMessage::Error(err_msg))).await {
                                        log::error!(
                                            "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                        );
                                    };
                                    if should_disconnect {
                                        break;
                                    }
                                }
                                Ok(actix_ws::Message::Text(text)) => {
                                    match json::from_str::<WsClientEvents>(&text) {
                                        Err(e) => {
                                            log::error!(
                                                "[WS::Router::Handler] received invalid request message: {:?}",
                                                e
                                            );
                                            let trace_id = json::from_str::<json::Value>(&text)
                                                .ok()
                                                .and_then(|val| val.get("trace_id").cloned())
                                                .map(|v| v.to_string());
                                            let err_msg =
                                                ErrorMessage::new(e.into(), trace_id, None);
                                            let should_disconnect = err_msg.should_disconnect;
                                            if let Err(e) = disconnect_tx.send(Some(DisconnectMessage::Error(err_msg))).await {
                                                log::error!(
                                                    "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                                );
                                            }
                                            if should_disconnect {
                                                break;
                                            }
                                        }
                                        #[allow(unused_mut)]
                                        Ok(mut message) => {
                                            // check if cookie is valid for each client event only
                                            // for enterprise
                                            if cfg.websocket.check_cookie_expiry
                                                && !session_manager.is_client_cookie_valid(&client_id).await
                                            {
                                                log::info!(
                                                    "[WS::Router::Handler] Client cookie expired. Disconnect..."
                                                );
                                                let err_msg = ErrorMessage::new_unauthorized(
                                                    Some(message.get_trace_id()),
                                                );
                                                if let Err(e) = disconnect_tx.send(Some(DisconnectMessage::Error(err_msg))).await
                                                {
                                                    log::error!(
                                                        "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                                    );
                                                };
                                                log::debug!(
                                                    "[WS::Router::Handler] Stop handle_incoming"
                                                );
                                                break;
                                            }
                                            // end of cookie check

                                            // Append `user_id` to the ws client events when run in
                                            // cluster mode to handle stream permissions
                                            #[cfg(feature = "enterprise")]
                                            {
                                                message.append_user_id(user_id.clone());
                                            }

                                            log::debug!(
                                                "[WS::Router::Handler] received message: {:?}",
                                                message
                                            );
                                            let trace_id = message.get_trace_id();
                                            let role_group =
                                                if let WsClientEvents::Search(req) = &message {
                                                    Some(RoleGroup::from(req.search_type))
                                                } else {
                                                    None
                                                };
                                            let querier_conn = match get_querier_connection(
                                                session_manager.clone(),
                                                connection_pool.clone(),
                                                &client_id,
                                                &trace_id,
                                                role_group,
                                            )
                                            .await
                                            {
                                                Err(e) => {
                                                    log::error!(
                                                        "[WS::Router::Handler] error getting querier_conn: {e}"
                                                    );
                                                    let err_msg = ErrorMessage::new(e, Some(trace_id), None);
                                                    let should_disconnect =
                                                        err_msg.should_disconnect;
                                                    if let Err(e) = disconnect_tx.send(Some(DisconnectMessage::Error(err_msg))).await
                                                    {
                                                        log::error!(
                                                            "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                                        );
                                                    }
                                                    if should_disconnect {
                                                        break;
                                                    } else {
                                                        continue;
                                                    }
                                                }
                                                Ok(querier_conn) => querier_conn,
                                            };
                                            querier_conn
                                                .register_request(
                                                    trace_id.clone(),
                                                    response_tx.clone(),
                                                )
                                                .await;

                                            if let Err(e) = querier_conn.send_message(message).await
                                            {
                                                log::error!(
                                                    "[WS::Router::Handler] error forwarding client message via selected querier connection: {e}"
                                                );
                                                let err_msg = ErrorMessage::new(e, Some(trace_id), None);
                                                let should_disconnect = err_msg.should_disconnect;
                                                if let Err(e) = disconnect_tx.send(Some(DisconnectMessage::Error(err_msg))).await {
                                                    log::error!(
                                                        "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                                    );
                                                }
                                                if should_disconnect {
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                                Ok(actix_ws::Message::Close(close_reason)) => {
                                    log::info!(
                                        "[WS::Router::Handler] disconnect signal received from client."
                                    );
                                    if let Err(e) = disconnect_tx.send(Some(DisconnectMessage::Close(close_reason))).await {
                                        log::error!(
                                            "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                        );
                                    };
                                    log::debug!("[WS::Router::Handler] Stop handle_incoming");
                                    break;
                                }
                                Ok(actix_ws::Message::Ping(ping)) => {
                                    let _ = response_tx.send(WsServerEvents::Ping(ping.to_vec())).await;
                                }
                                Ok(actix_ws::Message::Pong(pong)) => {
                                    log::debug!("[WS::Router::Handler]: Pong received from client : {:?}", pong);
                                }
                                Ok(_) => {}
                            }
                        }
                    }
                }
                Ok::<_, Error>(())
            };

            // Handle outgoing messages from router to client
            let handle_outgoing = async {
                loop {
                    tokio::select! {
                        // response from querier
                        Some(message) = response_rx.recv() => {
                            match message {
                                WsServerEvents::Ping(ping) => {
                                    log::debug!("[WS::Router::Handler]: pinging client");
                                    if let Err(e) = ws_session.pong(&ping).await {
                                        log::error!("[WS::Router::Handler]: Error sending pong: {}", e);
                                    }
                                }
                                WsServerEvents::Pong(pong) => {
                                    log::debug!("[WS::Router::Handler]: Pong received from client : {:?}", pong);
                                }
                                _ => {
                                    let Ok(message_str) = serde_json::to_string(&message) else {
                                        log::error!(
                                            "[WS::Router::Handler]: error convert WsServerEvents to string before sending back to client "
                                        );
                                        continue;
                                    };
                                    if let Err(e) = ws_session.text(message_str).await {
                                        log::error!("Error sending message to client: {}", e);
                                        break;
                                    }
                                    if let Some(trace_id) = message.should_clean_trace_id() {
                                        log::info!("[WS::Router::Handler] Unregistering trace_id: {}, message: {:?}", trace_id, message);
                                        session_manager.update_session_activity(&client_id).await;
                                        session_manager.remove_trace_id(&client_id, &trace_id).await;
                                    }
                                }
                            }
                        }
                        // interruption from handling_incoming thread
                        Some(msg) = disconnect_rx.recv() => {
                            match msg {
                                None => {
                                    // proper disconnecting
                                    log::debug!(
                                        "[WS::Handler]: disconnect signal received from client. handle_outgoing stopped"
                                    );
                                    break;
                                }
                                Some(DisconnectMessage::Error(err_msg)) => {
                                    // send error message to client first
                                    _ = ws_session.text(err_msg.ws_server_events.to_json()).await;
                                    // Experimental feature: `is_session_drain_enabled`
                                    if !cfg.websocket.is_session_drain_enabled && err_msg.should_disconnect {
                                        break;
                                    }

                                    // then drain the session
                                    if cfg.websocket.is_session_drain_enabled {
                                        match err_msg.ws_server_events {
                                            WsServerEvents::Error { code, .. } if code == <actix_http::StatusCode as Into<u16>>::into(StatusCode::UNAUTHORIZED) => {
                                                let is_session_drain_complete = Arc::new(AtomicBool::new(false));
                                            let is_session_drain_complete_clone = is_session_drain_complete.clone();

                                            // Clone values before moving into spawn
                                            let session_manager = session_manager.clone();
                                            let connection_pool = connection_pool.clone();
                                            let client_id = client_id.clone();
                                            let cfg_clone = cfg.clone();
                                            let cfg_clone2 = cfg_clone.clone();

                                            let session_drain_task = tokio::spawn(async move {
                                                let querier_connections = session_manager.get_querier_connections(&client_id).await;
                                                let trace_ids = session_manager.get_trace_ids(&client_id).await;
                                                let max_wait_time = cfg_clone.websocket.session_idle_timeout_secs as u64;
                                                let start_time = std::time::Instant::now();

                                                'outer: loop {
                                                    // Check if max wait time exceeded
                                                    if start_time.elapsed().as_secs() > max_wait_time {
                                                        log::warn!("[WS::Router::Handler]: Session drain timeout reached");
                                                        break;
                                                    }

                                                    let all_drained = true;

                                                    // Check each querier connection for active trace IDs
                                                    for querier_name in &querier_connections {
                                                        let Some(active_connection) = connection_pool.get_active_connection(querier_name).await else {
                                                            log::warn!("[WS::Router::Handler]: Connection not found for querier {}", querier_name);
                                                            continue;
                                                        };

                                                        for trace_id in &trace_ids {
                                                            if active_connection.is_active_trace_id(trace_id).await {
                                                                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                                                                continue 'outer;
                                                            }
                                                        }
                                                    }

                                                    if all_drained {
                                                        is_session_drain_complete_clone.store(true, Ordering::Relaxed);
                                                        log::info!("[WS::Router::Handler]: All trace IDs drained successfully");
                                                        break;
                                                    }
                                                }
                                            });

                                            // Wait for either task completion or timeout
                                            tokio::select! {
                                                _ = session_drain_task => {
                                                    if is_session_drain_complete.load(Ordering::Relaxed) {
                                                        log::info!("[WS::Router::Handler]: Session drain complete. Closing session");
                                                        break;
                                                    }
                                                }
                                                _ = tokio::time::sleep(tokio::time::Duration::from_secs(cfg_clone2.websocket.session_idle_timeout_secs as _)) => {
                                                    log::warn!("[WS::Router::Handler]: Session drain timeout while waiting for completion");
                                                    break;
                                                }
                                            }
                                        }
                                        _ => {}
                                        }
                                    }
                                }
                                Some(DisconnectMessage::Close(close_reason)) => {
                                    if let Err(e) = ws_session.close(close_reason).await {
                                        log::error!("[WS::Handler]: Error closing websocket session: {}", e);
                                    };
                                    return Ok(());
                                }
                            }
                        }
                    }
                }

                _ = ws_session
                    .close(Some(CloseReason::from(CloseCode::Normal)))
                    .await;
                log::debug!("[WS::Router::Handler]: client ws closed");
                Ok::<_, Error>(())
            };

            // Run both tasks concurrently
            let _ = tokio::join!(handle_incoming, handle_outgoing);

            // clean up resource related to this client
            session_manager.unregister_client(&client_id).await;
        });

        Ok(response)
    }

    pub async fn remove_querier_connection(&self, querier_name: &str) {
        self.connection_pool
            .remove_querier_connection(querier_name)
            .await;
        self.session_manager
            .remove_querier_connection(querier_name)
            .await;
    }

    pub async fn _shutdown(&self) {
        // just need to disconnect all the ws_conns in connection_pool
        self.connection_pool._shutdown().await;
    }
}

pub async fn get_querier_connection(
    session_manager: Arc<SessionManager>,
    connection_pool: Arc<QuerierConnectionPool>,
    client_id: &ClientId,
    trace_id: &TraceId,
    role_group: Option<RoleGroup>,
) -> WsResult<Arc<QuerierConnection>> {
    let interval = tokio::time::Duration::from_secs(1);
    // Retry max of 3 times to get a valid querier connection
    for try_num in 0..3 {
        // Get or assign querier for this trace_id included in message
        let querier_name = match session_manager
            .get_querier_for_trace(client_id, trace_id)
            .await?
        {
            Some(querier_name) => querier_name,
            None => {
                let querier_name = select_querier(trace_id, role_group).await?;
                session_manager
                    .set_querier_for_trace(client_id, trace_id, &querier_name)
                    .await?;
                querier_name
            }
        };

        // Get connection for selected querier
        match connection_pool
            .get_or_create_connection(&querier_name)
            .await
        {
            Ok(conn) => return Ok(conn),
            Err(e) => {
                log::error!(
                    "[WS::Router::Handler] error getting or creating querier connection: {e} try number: {}",
                    try_num
                );
                session_manager
                    .remove_querier_connection(&querier_name)
                    .await;
            }
        }
        tokio::time::sleep(interval).await;
    }

    Err(WsError::QuerierNotAvailable(
        "Reached maximum retries of 3".to_string(),
    ))
}

async fn select_querier(trace_id: &str, role_group: Option<RoleGroup>) -> WsResult<QuerierName> {
    use crate::common::infra::cluster;

    let node = cluster::get_node_from_consistent_hash(
        trace_id,
        &config::meta::cluster::Role::Querier,
        role_group,
    )
    .await
    .ok_or_else(|| WsError::QuerierNotAvailable(format!("for trace_id {}", trace_id)))?;
    Ok(node)
}
