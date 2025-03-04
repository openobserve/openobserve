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
        let (response, ws_session, mut msg_stream) = actix_ws::handle(&req, stream)?;

        // Create session
        let session_info = self.session_manager.get_or_create_session(&client_id).await;

        // Setup message channel
        let (response_tx, mut response_rx) = tokio::sync::mpsc::channel::<Message>(32);
        let session_manager = self.session_manager.clone();
        let connection_pool = self.connection_pool.clone();
        let client_id_cp = client_id.clone();

        // Spawn message handling tasks
        actix_web::rt::spawn(async move {
            let mut ws_session = ws_session;

            // Handle incoming messages
            let handle_incoming = async {
                while let Some(msg) = msg_stream.next().await {
                    match msg {
                        Ok(actix_ws::Message::Text(text)) => {
                            if let Ok(message) = serde_json::from_str::<Message>(&text) {
                                let Ok(querier_conn) = get_querier_connection(
                                    session_manager.clone(),
                                    connection_pool.clone(),
                                    &client_id_cp,
                                    &message,
                                    &response_tx,
                                )
                                .await
                                else {
                                    log::error!(
                                        "[WS:Handler]: error getting querier for received message"
                                    );
                                    break;
                                };
                                if let Err(e) = querier_conn.send_message(message).await {
                                    log::error!(
                                        "[WS:Handler]: error forwarding message via selected querier connection: {e}"
                                    );
                                    break;
                                }
                            }
                        }
                        Ok(actix_ws::Message::Close(_)) => break,
                        _ => {}
                    }
                }
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
        });

        Ok(response)
    }

    // pub async fn shutdown(&self) -> WsResult<()> {
    //     for client in self.message_bus.get_all_clients().await {
    //         let message = Message::new(
    //             "system".into(),
    //             MessageType::Error,
    //             json!({ "error": "Server shutting down" }),
    //         );
    //         let _ = self.message_bus.forward_to_client(&client, message).await;
    //     }
    //     self.message_bus.close_all().await
    // }
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
                .set_querier_for_trace(client_id, message.trace_id.clone(), querier_name.clone())
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
    let node = cluster::get_node_from_consistent_hash(
        trace_id,
        &config::meta::cluster::Role::Querier,
        role_group,
    )
    .await
    .ok_or_else(|| {
        WsError::QuerierNotAvailable(format!(
            "[WS::Handler]: failed to select querier for trace_id: {}",
            trace_id
        ))
    })?;
    Ok(node)
}
