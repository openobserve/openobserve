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
#[cfg(feature = "enterprise")]
use {
    crate::common::utils::auth::extract_auth_expiry_and_user_id, actix_http::Method, infra::errors,
    std::str::FromStr,
};

use super::{
    connection::{Connection, QuerierConnection},
    error::*,
    pool::QuerierConnectionPool,
    session::SessionManager,
};
use crate::service::websocket_events::{WsClientEvents, WsServerEvents};

pub type ClientId = String;
pub type QuerierName = String;
pub type TraceId = String;

#[derive(Debug)]
pub struct WsHandler {
    pub session_manager: Arc<SessionManager>,
    pub connection_pool: Arc<QuerierConnectionPool>,
}

impl Drop for WsHandler {
    fn drop(&mut self) {
        log::debug!("[WS::Router::Handler] WsHandler dropped");
    }
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

        log::info!("[WS::Router::Handler] new client incoming: {}", client_id);

        // Client -> Router connection
        let (response, mut ws_session, msg_stream) = actix_ws::handle(&req, stream)?;
        // increase the maximum allowed frame size to 128KiB and aggregate continuation frames
        let mut msg_stream = msg_stream
            .max_frame_size(cfg.websocket.max_frame_size * 1024 * 1024)
            .aggregate_continuations()
            .max_continuation_size(cfg.websocket.max_continuation_size * 1024 * 1024);

        log::info!("[WS::Router::Handler] new client connected: {}", client_id);

        // Create session by registering the client & extract the user_id from the auth
        #[cfg(feature = "enterprise")]
        let (cookie_expiry, user_id) = extract_auth_expiry_and_user_id(&req).await;

        #[cfg(not(feature = "enterprise"))]
        let cookie_expiry = None;

        self.session_manager
            .register_client(&client_id, cookie_expiry)
            .await;

        // Setup message channels
        // TODO: add env variable for this for channel size
        let (response_tx, mut response_rx) =
            tokio::sync::mpsc::channel::<WsServerEvents>(cfg.websocket.max_channel_buffer_size);
        let (disconnect_tx, mut disconnect_rx) =
            tokio::sync::mpsc::channel::<Option<DisconnectMessage>>(10);
        let session_manager = self.session_manager.clone();
        let connection_pool = self.connection_pool.clone();
        let _client_id_clone = client_id.clone();

        // Before spawning the async task, clone the drain state
        let is_session_drain_state = session_manager.is_session_drain_state(&client_id).await;

        log::info!(
            "[WS::Router::Handler] starting async ws task for client_id: {}",
            client_id
        );

        // Spawn task to handle idle timeout
        let _session_manager_clone = session_manager.clone();
        let _cfg_clone = cfg.clone();
        let _disconnect_tx_clone2 = disconnect_tx.clone();
        // tokio::spawn(async move {
        //     let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
        //         cfg_clone.websocket.session_idle_timeout_secs as _,
        //     ));
        //     interval.tick().await;
        //     loop {
        //         interval.tick().await;
        //         log::info!(
        //             "[WS::Router::Handler] checking if MAX_IDLE_TIME reached for client_id: {}",
        //             client_id_clone
        //         );
        //         if session_manager_clone
        //             .reached_max_idle_time(&client_id_clone)
        //             .await
        //         {
        //             log::info!(
        //                 "[WS::Router::Handler]: MAX_IDLE_TIME reached. Normal shutdown client_id:
        // {}",                 client_id_clone
        //             );
        //             if let Err(e) = disconnect_tx_clone2.send(None).await {
        //                 log::error!(
        //                     "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
        //                 );
        //             }
        //             break;
        //         }
        //     }
        // });

        // Spawn message handling tasks between client and router
        let response_tx_clone = response_tx.clone();
        let disconnect_tx_clone = disconnect_tx.clone();
        actix_web::rt::spawn(async move {
            let mut count = 1;
            // Handle incoming messages from client
            let handle_incoming = async {
                loop {
                    if let Some(msg) = msg_stream.next().await {
                        match msg {
                            Err(e) => {
                                log::error!(
                                    "[WS::Router::Handler] error receiving websocket message from client_id: {}, error: {}",
                                    client_id,
                                    e
                                );
                                let err_msg = ErrorMessage::new(e.into(), None, None);
                                let should_disconnect = err_msg.should_disconnect;
                                if let Err(e) = disconnect_tx_clone
                                    .send(Some(DisconnectMessage::Error(err_msg)))
                                    .await
                                {
                                    log::error!(
                                        "[WS::Router::Handler] Error informing handle_outgoing to stop for client_id: {}, error: {}",
                                        client_id,
                                        e
                                    );
                                };
                                if should_disconnect {
                                    break;
                                }
                            }
                            Ok(actix_ws::AggregatedMessage::Text(text)) => {
                                match json::from_str::<WsClientEvents>(&text) {
                                    Err(e) => {
                                        log::error!(
                                            "[WS::Router::Handler] received invalid request message for client_id: {}, error: {}",
                                            client_id,
                                            e
                                        );
                                        let trace_id = json::from_str::<json::Value>(&text)
                                            .ok()
                                            .and_then(|val| val.get("trace_id").cloned())
                                            .map(|v| v.to_string());
                                        let err_msg = ErrorMessage::new(e.into(), trace_id, None);
                                        let should_disconnect = err_msg.should_disconnect;
                                        if let Err(e) = disconnect_tx_clone
                                            .send(Some(DisconnectMessage::Error(err_msg)))
                                            .await
                                        {
                                            log::error!(
                                                "[WS::Router::Handler] Error informing handle_outgoing to stop for client_id: {}, error: {}",
                                                client_id,
                                                e
                                            );
                                        }
                                        if should_disconnect {
                                            break;
                                        }
                                    }
                                    #[allow(unused_mut)]
                                    Ok(mut message) => {
                                        #[cfg(feature = "enterprise")]
                                        {
                                            let auth_str =
                                                crate::common::utils::auth::extract_auth_str(&req);
                                            if let Err(e) =
                                                ratelimit_check(&message, auth_str).await
                                            {
                                                let err_msg = WsServerEvents::error_response(
                                                    &e,
                                                    Some(client_id.clone()),
                                                    Some(message.get_trace_id()),
                                                    false,
                                                );
                                                if let Err(e) =
                                                    response_tx_clone.clone().send(err_msg).await
                                                {
                                                    log::error!(
                                                        "[WS::Router::Handler] Error sending error message to client_id: {}, error: {}",
                                                        client_id,
                                                        e
                                                    );
                                                }
                                                continue;
                                            }
                                        }

                                        // check if cookie is valid for each client event only
                                        // for enterprise
                                        if !is_session_drain_state.load(Ordering::SeqCst)
                                            && !session_manager
                                                .is_client_cookie_valid(&client_id)
                                                .await
                                        {
                                            is_session_drain_state.store(true, Ordering::SeqCst);
                                        }
                                        if is_session_drain_state.load(Ordering::SeqCst) {
                                            let err_msg = ErrorMessage::new_unauthorized(Some(
                                                message.get_trace_id(),
                                            ));
                                            if let Err(e) = disconnect_tx_clone
                                                .send(Some(DisconnectMessage::Error(err_msg)))
                                                .await
                                            {
                                                log::error!(
                                                    "[WS::Router::Handler] Error sending error message to client_id: {}, error: {}",
                                                    client_id,
                                                    e
                                                );
                                            }
                                            continue;
                                        }
                                        // end of cookie check

                                        // Append `user_id` to the ws client events when run in
                                        // cluster mode to handle stream permissions
                                        #[cfg(feature = "enterprise")]
                                        {
                                            message.append_user_id(user_id.clone());
                                        }

                                        log::info!(
                                            "[WS::Router::Handler] received message for client_id: {}, trace_id: {}, router: {}",
                                            client_id,
                                            message.get_trace_id(),
                                            cfg.common.instance_name,
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
                                                    "[WS::Router::Handler] error getting querier_conn for client_id: {}, trace_id: {}, error: {}",
                                                    client_id,
                                                    trace_id.clone(),
                                                    e
                                                );
                                                let err_msg = ErrorMessage::new(
                                                    e,
                                                    Some(trace_id.clone()),
                                                    None,
                                                );
                                                let should_disconnect = err_msg.should_disconnect;
                                                if let Err(e) = disconnect_tx_clone
                                                    .send(Some(DisconnectMessage::Error(err_msg)))
                                                    .await
                                                {
                                                    log::error!(
                                                        "[WS::Router::Handler] Error informing handle_outgoing to stop for client_id: {}, trace_id: {}, error: {}",
                                                        client_id,
                                                        trace_id.clone(),
                                                        e
                                                    );
                                                }
                                                if should_disconnect {
                                                    break;
                                                } else {
                                                    continue;
                                                }
                                            }
                                            Ok(querier_conn) => {
                                                log::info!(
                                                    "[WS::Router::Handler] got querier connection for client_id: {}, trace_id: {}, querier_name: {}",
                                                    client_id,
                                                    trace_id,
                                                    querier_conn.get_name()
                                                );
                                                querier_conn
                                            }
                                        };
                                        querier_conn
                                            .register_request(
                                                trace_id.clone(),
                                                response_tx_clone.clone(),
                                            )
                                            .await;

                                        if let Err(e) = querier_conn.send_message(message).await {
                                            log::error!(
                                                "[WS::Router::Handler] error forwarding client message via selected querier connection: {}, for client_id: {}, trace_id: {}, error: {}",
                                                querier_conn.get_name(),
                                                client_id,
                                                trace_id,
                                                e
                                            );
                                            let err_msg =
                                                ErrorMessage::new(e, Some(trace_id.clone()), None);
                                            let should_disconnect = err_msg.should_disconnect;
                                            if let Err(e) = disconnect_tx_clone
                                                .send(Some(DisconnectMessage::Error(err_msg)))
                                                .await
                                            {
                                                log::error!(
                                                    "[WS::Router::Handler] Error informing handle_outgoing to stop for client_id: {}, trace_id: {}, error: {}",
                                                    client_id,
                                                    trace_id.clone(),
                                                    e
                                                );
                                            }
                                            if should_disconnect {
                                                break;
                                            }
                                        }

                                        log::info!(
                                            "[WS::Router::Handler] processed message to querier: {}, for client_id: {}, trace_id: {}",
                                            querier_conn.get_name(),
                                            client_id,
                                            trace_id
                                        );
                                        count += 1;
                                    }
                                }
                            }
                            Ok(actix_ws::AggregatedMessage::Close(close_reason)) => {
                                log::info!(
                                    "[WS::Router::Handler] disconnect signal received from client_id: {}, close_reason: {:?}",
                                    client_id,
                                    close_reason
                                );
                                if let Err(e) = disconnect_tx_clone
                                    .send(Some(DisconnectMessage::Close(close_reason)))
                                    .await
                                {
                                    log::error!(
                                        "[WS::Router::Handler] Error informing handle_outgoing to stop for client_id: {}, error: {}",
                                        client_id,
                                        e
                                    );
                                };
                                log::debug!(
                                    "[WS::Router::Handler] Stop handle_incoming for client_id: {}",
                                    client_id
                                );
                                break;
                            }
                            Ok(actix_ws::AggregatedMessage::Ping(ping)) => {
                                log::info!(
                                    "[WS::Router::Handler] Ping received from client_id: {}, ping: {:?}",
                                    client_id,
                                    ping
                                );
                                let _ = response_tx_clone
                                    .clone()
                                    .send(WsServerEvents::Ping(ping.to_vec()))
                                    .await;
                            }
                            Ok(actix_ws::AggregatedMessage::Pong(pong)) => {
                                log::info!(
                                    "[WS::Router::Handler] Pong received from client_id: {}, pong: {:?}",
                                    client_id,
                                    pong
                                );
                            }
                            Ok(_) => {}
                        }
                    }
                }
                log::info!(
                    "[WS::Router::Handler] handle_incoming task stopped for client_id: {}",
                    client_id
                );
            };

            // Handle outgoing messages from router to client
            let handle_outgoing = async {
                loop {
                    tokio::select! {
                        // response from querier
                        Some(message) = response_rx.recv() => {
                            match message {
                                WsServerEvents::Ping(ping) => {
                                    let mut close_conn = false;
                                    log::debug!("[WS::Router::Handler]: sending pong to client_id: {}, msg: {:?}", client_id, String::from_utf8_lossy(&ping));
                                    if let Err(e) = ws_session.pong(&ping).await {
                                        close_conn = true;
                                        log::error!("[WS::Router::Handler]: Error sending pong to client: {}, client_id: {}", e, client_id);
                                    }

                                    if close_conn {
                                        log::debug!("[WS::Router::Handler]: closing websocket session due to ping-pong failure client_id: {}", client_id);
                                        if let Err(e) = ws_session.close(Some(CloseReason::from(CloseCode::Normal))).await {
                                            log::error!("[WS::Router::Handler]: Error closing websocket session client_id: {}, error: {}", client_id, e);
                                        };
                                        return Ok(());
                                    }
                                }
                                WsServerEvents::Pong(pong) => {
                                    log::debug!("[WS::Router::Handler]: Pong received from client : {:?}", pong);
                                }
                                _ => {
                                    let Ok(message_str) = serde_json::to_string(&message) else {
                                        log::error!(
                                            "[WS::Router::Handler]: error convert WsServerEvents to string before sending back to client for client_id: {}", client_id
                                        );
                                        continue;
                                    };
                                    log::info!("[WS::Router::Handler] received message from router-querier task for client_id: {}, trace_id: {}", client_id, message.get_trace_id());
                                    if let Err(e) = ws_session.text(message_str).await {
                                        log::error!("[WS::Router::Handler] Error sending message to client_id: {}, error: {}", client_id, e);
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
                            log::info!("[WS::Router::Handler] disconnect signal received from client_id: {}, msg: {:?}", client_id, msg);
                            match msg {
                                None => {
                                    // proper disconnecting
                                    log::debug!(
                                        "[WS::Handler] disconnect signal received from client_id: {}, handle_outgoing stopped", client_id
                                    );
                                    break;
                                }
                                Some(DisconnectMessage::Error(err_msg)) => {
                                    // send error message to client first
                                    _ = ws_session.text(err_msg.ws_server_events.to_json()).await;
                                    if err_msg.should_disconnect {
                                        break;
                                    }

                                    // then drain the session
                                    match err_msg.ws_server_events {
                                        WsServerEvents::Error { code, .. } if code == <actix_http::StatusCode as Into<u16>>::into(StatusCode::UNAUTHORIZED) => {
                                            let is_session_drain_complete = Arc::new(AtomicBool::new(false));
                                            let is_session_drain_complete_clone = is_session_drain_complete.clone();

                                            // Clone values before moving into spawn
                                            let session_manager = session_manager.clone();
                                            let session_manager_clone = session_manager.clone();
                                            let connection_pool = connection_pool.clone();
                                            let client_id = client_id.clone();
                                            let client_id_clone = client_id.clone();
                                            let cfg_clone = cfg.clone();

                                            // Set a flag to indicate we're in drain mode
                                            let is_draining = Arc::new(AtomicBool::new(true));
                                            let is_draining_clone = is_draining.clone();

                                            let _session_drain_task = tokio::spawn(async move {
                                                let querier_connections = session_manager_clone.get_querier_connections(&client_id_clone).await;
                                                let max_wait_time = cfg_clone.websocket.session_idle_timeout_secs as u64;
                                                let start_time = std::time::Instant::now();

                                                'outer: loop {
                                                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

                                                    if start_time.elapsed().as_secs() > max_wait_time {
                                                        log::warn!("[WS::Router::Handler]: Session drain timeout reached");
                                                        break;
                                                    }

                                                    let current_trace_ids = session_manager_clone.get_trace_ids(&client_id_clone).await;

                                                    // If all trace_ids are processed, we're done
                                                    if current_trace_ids.is_empty() {
                                                        is_session_drain_complete_clone.store(true, Ordering::Relaxed);
                                                        log::info!("[WS::Router::Handler]: All trace IDs drained successfully");
                                                        break;
                                                    }

                                                    // Log remaining trace IDs for debugging
                                                    log::debug!(
                                                        "[WS::Router::Handler]: Waiting for trace IDs to complete: {:?}",
                                                        current_trace_ids
                                                    );

                                                    // Check each querier connection for active trace IDs
                                                    for querier_name in &querier_connections {
                                                        let Some(active_connection) = connection_pool.get_active_connection(querier_name).await else {
                                                            continue;
                                                        };

                                                        for trace_id in &current_trace_ids {
                                                            if active_connection.is_active_trace_id(trace_id).await {
                                                                continue 'outer;
                                                            }
                                                        }
                                                    }
                                                }

                                                // Clear drain mode flag when complete
                                                is_draining_clone.store(false, Ordering::Relaxed);
                                            });

                                            // Continue processing messages while draining
                                            while !is_session_drain_complete.load(Ordering::Relaxed) {
                                                if let Some(message) = response_rx.recv().await {
                                                    // Forward all messages to client during drain
                                                    if let Ok(message_str) = serde_json::to_string(&message) {
                                                        if let Err(e) = ws_session.text(message_str).await {
                                                            log::error!("[WS::Router::Handler]: Error sending message during drain: {}", e);
                                                            break;
                                                        }

                                                        // Important: Process End messages and clean up trace_ids
                                                        if let Some(trace_id) = message.should_clean_trace_id() {
                                                            log::info!(
                                                                "[WS::Router::Handler] Cleaning up trace_id during drain: {}, message: {:?}",
                                                                trace_id,
                                                                message
                                                            );
                                                            session_manager.remove_trace_id(&client_id, &trace_id).await;

                                                            // Check if this was the last trace_id
                                                            let remaining_trace_ids = session_manager.get_trace_ids(&client_id).await;
                                                            if remaining_trace_ids.is_empty() {
                                                                is_session_drain_complete.store(true, Ordering::Relaxed);
                                                                // close the session
                                                                if let Err(e) = disconnect_tx_clone.clone().send(Some(DisconnectMessage::Close(Some(CloseReason::from(CloseCode::Normal))))).await {
                                                                    log::error!(
                                                                        "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                                                    );
                                                                }
                                                                log::info!("[WS::Router::Handler]: All trace IDs drained successfully");
                                                                break;
                                                            }
                                                        }
                                                    }
                                                } else {
                                                    // Channel closed, no more messages coming
                                                    log::warn!("[WS::Router::Handler]: Response channel closed during drain");
                                                    break;
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                Some(DisconnectMessage::Close(close_reason)) => {
                                    if let Err(e) = ws_session.close(close_reason).await {
                                        log::error!("[WS::Router::Handler]: Error closing websocket session client_id: {}, error: {}", client_id, e);
                                    };
                                    return Ok(());
                                }
                            }
                        }
                    }
                }
                log::info!(
                    "[WS::Router::Handler] handle_outgoing task stopped for client_id: {}",
                    client_id
                );

                _ = ws_session
                    .close(Some(CloseReason::from(CloseCode::Normal)))
                    .await;
                log::info!("[WS::Router::Handler]: client ws closed: {}", client_id);
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
    let mut consistent_hash_trace_id = trace_id.clone();
    // Retry max of 3 times to get a valid querier connection
    for try_num in 0..3 {
        // Get or assign querier for this trace_id included in message
        let querier_name = match session_manager
            .get_querier_for_trace(client_id, trace_id)
            .await?
        {
            Some(querier_name) => querier_name,
            None => {
                if try_num > 0 {
                    // to get a different querier for each retry
                    consistent_hash_trace_id.push_str(try_num.to_string().as_str());
                }
                let querier_name = select_querier(&consistent_hash_trace_id, role_group).await?;
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
            Ok(conn) => {
                log::info!(
                    "[WS::Router::Handler] get_or_create_connection: querier connection for client_id: {}, trace_id: {}, querier_name: {}",
                    client_id,
                    trace_id,
                    querier_name
                );
                return Ok(conn);
            }
            Err(e) => {
                log::error!(
                    "[WS::Router::Handler] error getting or creating querier connection for client_id: {}, error: {}, try number: {}, router_node: {}, querier_name: {}",
                    client_id,
                    e,
                    try_num,
                    get_config().common.instance_name,
                    querier_name
                );
                session_manager
                    .remove_querier_connection(&querier_name)
                    .await;
            }
        }
        tokio::time::sleep(interval).await;
    }

    Err(WsError::QuerierWsConnNotAvailable(
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
    .ok_or_else(|| WsError::QuerierWsConnNotAvailable(format!("for trace_id {trace_id}")))?;
    Ok(node)
}
#[cfg(feature = "enterprise")]
async fn ratelimit_check(event: &WsClientEvents, auth_str: String) -> Result<(), errors::Error> {
    let mut method = Method::GET;
    let path = match event {
        WsClientEvents::Search(s) => {
            let org_id = s.org_id.clone();
            let path = format!("/api/{org_id}/_search");
            method = Method::from_str("POST").unwrap();
            path
        }

        WsClientEvents::Values(s) => {
            let org_id = s.org_id.clone();
            let stream_name = s.payload.stream_name.clone();
            let path = format!("/api/{org_id}/{stream_name}/_values");
            path
        }

        _ => return Ok(()),
    };

    let trace_id = event.get_trace_id();
    if let Err(err) = crate::router::ratelimit::resource_extractor::ws_extractor(
        trace_id.as_str(),
        auth_str,
        path.clone(),
        &method,
    )
    .await
    {
        log::warn!(
            "[{trace_id}] Rate limit exceeded for path: {path}, err: {:?}",
            err
        );
        let blocked_err = if err.to_string().starts_with("TokenResult::Blocked: ") {
            o2_ratelimit::middleware::parse_blocked_err(&err.to_string())
        } else {
            None
        };

        let err = if let Some((blocked_err, rule)) = blocked_err {
            log::warn!(
                "block_msg: {}, rule_id: {}, threshold: {}, resource: {}",
                blocked_err.block_msg(),
                rule.id,
                rule.threshold,
                rule.resource
            );
            Err(errors::Error::ErrorCode(
                errors::ErrorCodes::RatelimitExceeded(format!(
                    "Request limit reached for {path}. Please try again in a few moments"
                )),
            ))
        } else {
            Err(errors::Error::ErrorCode(
                errors::ErrorCodes::RatelimitExceeded(err.to_string()),
            ))
        };

        return err;
    }

    Ok(())
}
