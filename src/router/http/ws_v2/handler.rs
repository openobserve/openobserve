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
use crate::{
    common::utils::auth::extract_auth_str,
    service::websocket_events::{WsClientEvents, WsServerEvents},
};

pub type SessionId = String;
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
        // Client -> Router connection
        let (response, mut ws_session, mut msg_stream) = actix_ws::handle(&req, stream)?;

        let cfg = get_config();

        // Create session by registering the client & extract the user_id from the auth
        #[cfg(feature = "enterprise")]
        let auth_str = extract_auth_str(&req);
        #[cfg(feature = "enterprise")]
        let (mut cookie_expiry, user_id) = extract_auth_expiry_and_user_id(&auth_str).await;

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
        // TODO: decide the buffer size for the channel
        let (response_tx, mut response_rx) = tokio::sync::mpsc::channel::<WsServerEvents>(32);
        let (error_tx, mut error_rx) = tokio::sync::mpsc::channel::<Option<ErrorMessage>>(1);
        let session_manager = self.session_manager.clone();
        let connection_pool = self.connection_pool.clone();

        // Spawn message handling tasks between client and router
        actix_web::rt::spawn(async move {
            // Handle incoming messages from client
            let handle_incoming = async {
                while let Some(msg) = msg_stream.next().await {
                    match msg {
                        Err(e) => {
                            log::error!(
                                "[WS::Router::Handler] error receiving websocket message from client {e}"
                            );
                            let err_msg = ErrorMessage::new(e.into(), None, None);
                            let should_disconnect = err_msg.should_disconnect;
                            if let Err(e) = error_tx.send(Some(err_msg)).await {
                                log::error!(
                                    "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                );
                            };
                            if should_disconnect {
                                break;
                            }
                        }
                        Ok(msg) => {
                            match msg {
                                actix_ws::Message::Text(text) => {
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
                                            if let Err(e) = error_tx.send(Some(err_msg)).await {
                                                log::error!(
                                                    "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                                );
                                            }
                                            if should_disconnect {
                                                break;
                                            }
                                        }
                                        Ok(mut message) => {
                                            // check if cookie is valid for each client event only
                                            // for enterprise
                                            #[cfg(feature = "enterprise")]
                                            if cfg.websocket.check_cookie_expiry
                                                && !session_manager
                                                    .is_client_cookie_valid(&client_id)
                                                    .await
                                            {
                                                log::info!(
                                                    "[WS::Router::Handler] Client cookie expired. Disconnect..."
                                                );
                                                let error_msg = ErrorMessage::new_unauthorized(
                                                    Some(message.get_trace_id()),
                                                );
                                                if let Err(e) = error_tx.send(Some(error_msg)).await
                                                {
                                                    log::error!(
                                                        "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                                    );
                                                };
                                                log::info!(
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
                                                    let err_msg =
                                                        ErrorMessage::new(e, Some(trace_id), None);
                                                    let should_disconnect =
                                                        err_msg.should_disconnect;
                                                    if let Err(e) =
                                                        error_tx.send(Some(err_msg)).await
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
                                                let err_msg =
                                                    ErrorMessage::new(e, Some(trace_id), None);
                                                let should_disconnect = err_msg.should_disconnect;
                                                if let Err(e) = error_tx.send(Some(err_msg)).await {
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
                                        }
                                    }
                                }
                                actix_ws::Message::Close(_) => {
                                    log::info!(
                                        "[WS::Router::Handler] disconnect signal received from client."
                                    );
                                    if let Err(e) = error_tx.send(None).await {
                                        log::error!(
                                            "[WS::Router::Handler] Error informing handle_outgoing to stop: {e}"
                                        );
                                    };
                                    log::info!("[WS::Router::Handler] Stop handle_incoming");
                                    break;
                                }
                                // TODO: other message types?
                                _ => {}
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
                            let Ok(message_str) = serde_json::to_string(&message) else {
                                log::error!(
                                    "[WS::Handler]: error convert WsServerEvents to string before sending back to client "
                                );
                                continue;
                            };
                            if let Err(e) = ws_session.text(message_str).await {
                                log::error!("Error sending message to client: {}", e);
                                break;
                            }
                        }
                        // interruption from handling_incoming thread
                        Some(msg) = error_rx.recv() => {
                            match msg {
                                None => {
                                    // proper disconnecting
                                    log::debug!(
                                        "[WS::Handler]: disconnect signal received from client. handle_outgoing stopped"
                                    );
                                    break;
                                }
                                Some(err_msg) => {
                                    _ = ws_session.text(err_msg.ws_server_events.to_json()).await;
                                    if err_msg.should_disconnect {
                                        // TODO: special handling for unauthorized error message
                                        // shouldn't close directly but wait for all ongoing requests to finish
                                        if let Err(e) = ws_session.close(Some(CloseReason::from(CloseCode::Normal))).await {
                                            log::error!("Error closing websocket session: {}", e);
                                        };
                                        return Ok(());
                                    }
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

    pub async fn remove_querier_connection(&self, querier_name: &QuerierName) {
        self.connection_pool
            .remove_querier_connection(querier_name)
            .await;
        self.session_manager
            .remove_querier_connection(querier_name)
            .await;
    }

    pub async fn _shutdown(&self) {
        // just need to disconnect all the ws_conns in connection_pool
        self.connection_pool.shutdown().await;
    }
}

pub async fn get_querier_connection(
    session_manager: Arc<SessionManager>,
    connection_pool: Arc<QuerierConnectionPool>,
    client_id: &ClientId,
    trace_id: &TraceId,
    role_group: Option<RoleGroup>,
) -> WsResult<Arc<QuerierConnection>> {
    // TODO: better handle of this retries?
    // Retry max of 3 times to get a valid querier connection
    let max_retries = 1;
    let mut retries = 0;
    loop {
        // Get or assign querier for this trace_id included in message
        let querier_name = match session_manager
            .get_querier_for_trace(client_id, trace_id)
            .await?
        {
            Some(querier_name) => querier_name,
            None => {
                // loop exited directly when this function fails
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
            Err(_) => {
                session_manager
                    .remove_querier_connection(&querier_name)
                    .await;
                retries += 1;
                if retries >= max_retries {
                    return Err(WsError::QuerierNotAvailable(format!(
                        "No querier connection available after {} retries",
                        max_retries
                    )));
                }
            }
        }
    }
}

// TODO: potentially where load balancing can be applied to select least busy querier
async fn select_querier(trace_id: &str, role_group: Option<RoleGroup>) -> WsResult<QuerierName> {
    use crate::common::infra::cluster;

    // use consistent hashing to select querier
    // CONFIRM: map all messages with the same trace_id to the same querier
    // CONFIRM: is it too expensive to call for every single request?
    // CONFIRM: can multiple queriers have the same node?
    let node = cluster::get_node_from_consistent_hash(
        trace_id,
        &config::meta::cluster::Role::Querier,
        role_group,
    )
    .await
    .ok_or_else(|| {
        WsError::QuerierNotAvailable(format!(
            "No querier node returned from consistent hash for trace_id {}",
            trace_id
        ))
    })?;
    Ok(node)
}
