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

pub mod session;

use actix_web::{Error, HttpRequest, HttpResponse, get, web};
use actix_ws::{CloseCode, CloseReason};
use config::get_config;
use futures::StreamExt;
use session::handle_text_message;

use crate::{
    router::http::ws::error::DisconnectMessage, service::websocket_events::WsServerEvents,
};

#[get("{org_id}/ws/v2/{router_id}")]
pub async fn websocket(
    path_params: web::Path<(String, String)>,
    req: HttpRequest,
    stream: web::Payload,
    in_req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let cfg = get_config();

    if !cfg.websocket.enabled {
        log::info!(
            "[WS_HANDLER]: Node Role: {} Websocket is disabled",
            cfg.common.node_role
        );
        return Ok(HttpResponse::NotFound().body("WebSocket is disabled"));
    }

    let (_, router_id) = path_params.into_inner();

    let prefix = format!("{}/api/", get_config().common.base_uri);
    let path = req.path().strip_prefix(&prefix).unwrap().to_string();

    let user_id = in_req
        .headers()
        .get("user_id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let (res, mut ws_session, msg_stream) = actix_ws::handle(&req, stream)?;

    // increase the maximum allowed frame size to 1MB actix-ws and
    // aggregate continuation frames
    let mut msg_stream = msg_stream
        .max_frame_size(cfg.websocket.max_frame_size * 1024 * 1024)
        .aggregate_continuations()
        .max_continuation_size(cfg.websocket.max_continuation_size * 1024 * 1024);

    log::info!(
        "[WS_HANDLER]: Node Role: {} Got websocket request for router_id: {}, querier: {}",
        cfg.common.node_role,
        router_id,
        cfg.common.instance_name
    );

    let req_id = router_id.clone();
    // channel between incoming_thread <----> outgoing thread
    let (response_tx, mut response_rx) =
        tokio::sync::mpsc::channel::<WsServerEvents>(cfg.websocket.max_channel_buffer_size);
    let (disconnect_tx, mut disconnect_rx) =
        tokio::sync::mpsc::channel::<Option<DisconnectMessage>>(10);

    // Spawn message handling tasks between router and querier
    let response_tx_clone = response_tx.clone();
    let disconnect_tx_clone = disconnect_tx.clone();
    actix_web::rt::spawn(async move {
        // Handle incoming messages from client
        let handle_incoming = async {
            loop {
                if let Some(msg) = msg_stream.next().await {
                    match msg {
                        Ok(actix_ws::AggregatedMessage::Ping(ping)) => {
                            log::debug!(
                                "[WS_HANDLER]: Received ping from client for req_id: {}, querier: {}",
                                req_id,
                                cfg.common.instance_name
                            );
                            let _ = response_tx_clone
                                .clone()
                                .send(WsServerEvents::Ping(ping.to_vec()))
                                .await;
                        }
                        Ok(actix_ws::AggregatedMessage::Pong(_)) => {
                            log::debug!(
                                "[WS_HANDLER]: Received pong from client for req_id: {}, querier: {}",
                                req_id,
                                cfg.common.instance_name
                            );
                        }
                        Ok(actix_ws::AggregatedMessage::Text(msg)) => {
                            log::info!(
                                "[WS_HANDLER]: Received text message for req_id: {}, querier: {}",
                                req_id,
                                cfg.common.instance_name,
                            );
                            handle_text_message(
                                &user_id,
                                &req_id,
                                msg.to_string(),
                                path.clone(),
                                response_tx_clone.clone(),
                            )
                            .await;
                        }
                        Ok(actix_ws::AggregatedMessage::Close(reason)) => {
                            let mut close_reason = None;
                            if let Some(reason) = reason.as_ref() {
                                match reason.code {
                                    CloseCode::Normal | CloseCode::Error => {
                                        log::info!(
                                            "[WS_HANDLER]: Request Id: {} Node Role: {} Closing connection with reason: {:?}",
                                            req_id,
                                            get_config().common.node_role,
                                            reason
                                        );
                                    }
                                    _ => {
                                        log::error!(
                                            "[WS_HANDLER]: Request Id: {} Node Role: {} Abnormal closure with reason: {:?}",
                                            req_id,
                                            get_config().common.node_role,
                                            reason
                                        );
                                    }
                                }
                                close_reason = Some(reason.clone());
                            }
                            if let Err(e) = disconnect_tx_clone
                                .send(Some(DisconnectMessage::Close(close_reason)))
                                .await
                            {
                                log::error!(
                                    "[WS_HANDLER]: Error sending disconnect message for request_id: {}, error: {}",
                                    req_id,
                                    e
                                );
                            }
                            break;
                        }
                        Err(e) => {
                            log::error!(
                                "[WS_HANDLER]: Error in handling message for req_id: {}, node: {}, error: {}",
                                req_id,
                                get_config().common.instance_name,
                                e
                            );
                            if let Err(e) = disconnect_tx_clone.send(None).await {
                                log::error!(
                                    "[WS_HANDLER]: Error sending disconnect message for request_id: {}, error: {}",
                                    req_id,
                                    e
                                );
                            }
                            break;
                        }
                        _ => {
                            log::error!(
                                "[WS_HANDLER]: Error in handling message for req_id: {}, node: {}, error: {}",
                                req_id,
                                get_config().common.instance_name,
                                "Unknown error"
                            );
                            if let Err(e) = disconnect_tx_clone.send(None).await {
                                log::error!(
                                    "[WS_HANDLER]: Error sending disconnect message for request_id: {}, error: {}",
                                    req_id,
                                    e
                                );
                            }
                            break;
                        }
                    }
                }
            }
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
                                log::debug!("[WS::Querier::Handler]: sending pong to request_id: {}, msg: {:?}", req_id, String::from_utf8_lossy(&ping));
                                if let Err(e) = ws_session.pong(&ping).await {
                                    close_conn = true;
                                    log::error!("[WS::Querier::Handler]: Error sending pong to client: {}, request_id: {}", e, req_id);
                                }

                                if close_conn {
                                    log::debug!("[WS::Querier::Handler]: closing websocket session due to ping-pong failure request_id: {}", req_id);
                                    if let Err(e) = ws_session.close(Some(CloseReason::from(CloseCode::Normal))).await {
                                        log::error!("[WS::Querier::Handler]: Error closing websocket session request_id: {}, error: {}", req_id, e);
                                    };
                                    return Ok(());
                                }
                            }
                            WsServerEvents::Pong(pong) => {
                                log::debug!("[WS::Querier::Handler]: Pong received from client : {:?}", pong);
                            }
                            _ => {
                                let Ok(message_str) = serde_json::to_string(&message) else {
                                    log::error!(
                                        "[WS::Querier::Handler]: error convert WsServerEvents to string before sending back to client for request_id: {}", req_id
                                    );
                                    continue;
                                };
                                log::info!("[WS::Querier::Handler] received message from router-querier task for request_id: {}, trace_id: {}", req_id, message.get_trace_id());
                                if let Err(e) = ws_session.text(message_str).await {
                                    log::error!("[WS::Querier::Handler] Error sending message to request_id: {}, trace_id: {}, error: {}", req_id, message.get_trace_id(), e);
                                    break;
                                }
                            }
                        }
                    }
                    Some(msg) = disconnect_rx.recv() => {
                        log::info!("[WS::Querier::Handler] disconnect signal received from request_id: {}, msg: {:?}", req_id, msg);
                        match msg {
                            None => {
                                // proper disconnecting
                                log::debug!(
                                    "[WS::Querier::Handler] disconnect signal received from request_id: {}, handle_outgoing stopped", req_id
                                );
                                break;
                            }
                            Some(DisconnectMessage::Error(err_msg)) => {
                                // send error message to client first
                                if let Err(e) = ws_session.text(err_msg.ws_server_events.to_json()).await {
                                    log::error!("[WS::Querier::Handler]: Failed to send error message to client: {}", e);
                                }
                                if err_msg.should_disconnect {
                                    log::debug!("[WS::Querier::Handler]: disconnecting client for request_id: {}", req_id);
                                    break;
                                }
                            }
                            Some(DisconnectMessage::Close(close_reason)) => {
                                if let Err(e) = ws_session.close(close_reason).await {
                                    log::error!("[WS::Querier::Handler]: Error closing websocket session request_id: {}, error: {}", req_id, e);
                                };
                                return Ok(());
                            }
                        }
                    }
                }
            }

            if let Err(e) = ws_session
                .close(Some(CloseReason::from(CloseCode::Normal)))
                .await
            {
                log::error!(
                    "[WS::Querier::Handler]: Error closing websocket session request_id: {}, error: {}",
                    req_id,
                    e
                );
            }
            log::info!("[WS::Querier::Handler]: client ws closed: {}", req_id);
            Ok::<_, Error>(())
        };

        // Run both tasks concurrently
        let _ = tokio::join!(handle_incoming, handle_outgoing);
    });

    Ok(res)
}
