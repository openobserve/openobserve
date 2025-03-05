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
use config::meta::cluster::RoleGroup;
use futures_util::StreamExt;
use tokio::sync::mpsc::Sender;

use super::{
    connection::{Connection, QuerierConnection},
    error::*,
    pool::QuerierConnectionPool,
    session::SessionManager,
    types::*,
};

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

        // Create session. maybe change to register client
        self.session_manager.register_client(&client_id).await;

        // Setup message channel
        let (response_tx, mut response_rx) = tokio::sync::mpsc::channel::<Message>(32);
        let session_manager = self.session_manager.clone();
        let connection_pool = self.connection_pool.clone();

        // Spawn message handling tasks
        actix_web::rt::spawn(async move {
            // Handle incoming messages
            let handle_incoming = async {
                while let Some(msg) = msg_stream.next().await {
                    match msg {
                        Err(e) => {
                            log::error!(
                                "[WS::Handler] error receiving websocket message from client {e}"
                            );
                            break;
                        }
                        Ok(msg) => match msg {
                            actix_ws::Message::Text(text) => {
                                if let Ok(message) = serde_json::from_str::<Message>(&text) {
                                    let querier_conn = match get_querier_connection(
                                        session_manager.clone(),
                                        connection_pool.clone(),
                                        &client_id,
                                        &message,
                                        &response_tx,
                                    )
                                    .await
                                    {
                                        Err(e) => {
                                            log::error!(
                                                "[WS::Handler] error getting querier_conn: {e}"
                                            );
                                            break;
                                        }
                                        Ok(querier_conn) => querier_conn,
                                    };
                                    if let Err(e) = querier_conn.send_message(message).await {
                                        log::error!(
                                            "[WS::Handler] error forwarding client message via selected querier connection: {e}"
                                        );
                                        // TODO: possibly need to disconnect and remove the
                                        // connection
                                        break;
                                    }
                                }
                            }
                            actix_ws::Message::Close(_) => break,
                            _ => {}
                        },
                    }
                }
                Ok::<_, Error>(())
            };

            // Handle outgoing messages
            let handle_outgoing = async {
                while let Some(message) = response_rx.recv().await {
                    if let Err(e) = ws_session.text(serde_json::to_string(&message)?).await {
                        log::error!("Error sending message to client: {}", e);
                        break;
                    }
                }
                Ok::<_, Error>(())
            };

            // Run both tasks concurrently
            let _ = tokio::join!(handle_incoming, handle_outgoing);

            // TODO: Cleanup
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

    pub async fn shutdown(&self) {
        // just need to disconnect all the ws_conns in connection_pool
        self.connection_pool.shutdown().await;
    }
}

pub async fn get_querier_connection(
    session_manager: Arc<SessionManager>,
    connection_pool: Arc<QuerierConnectionPool>,
    client_id: &ClientId,
    message: &Message,
    response_tx: &Sender<Message>,
) -> WsResult<Arc<QuerierConnection>> {
    // Get or assign querier for this trace_id included in message
    let querier_name = match session_manager
        .get_querier_for_trace(client_id, &message.trace_id)
        .await?
    {
        Some(querier_name) => querier_name,
        None => {
            let role_group = if let MessageType::Search(search_req) = &message.message_type {
                Some(RoleGroup::from(search_req.search_type.clone()))
            } else {
                None
            };

            // use consistent hashing to select querier
            let querier_name = select_querier(&message.trace_id, role_group).await?;
            session_manager
                .set_querier_for_trace(client_id, &message.trace_id, &querier_name)
                .await?;
            querier_name
        }
    };

    // Get connection for selected querier
    let conn = connection_pool
        .get_or_create_connection(&querier_name, response_tx)
        .await?;

    Ok(conn)
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
