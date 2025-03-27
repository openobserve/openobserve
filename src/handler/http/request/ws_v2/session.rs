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

use std::time::Duration;

use actix_http::ws::{CloseCode, CloseReason};
use actix_ws::{MessageStream, Session};
use config::{
    get_config,
    meta::websocket::{SearchEventReq, SearchResultType},
};
use futures::StreamExt;
use infra::errors::{self, Error};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::{
    auditor::{AuditMessage, Protocol, WsMeta},
    infra::config::get_config as get_o2_config,
};
use rand::prelude::SliceRandom;
use tokio::sync::mpsc;

#[cfg(feature = "enterprise")]
use crate::service::{
    self_reporting::audit,
    websocket_events::{handle_cancel, search_registry_utils},
};
use crate::{
    common::infra::config::WS_SEARCH_REGISTRY,
    // router::http::ws_v2::types::StreamMessage,
    service::websocket_events::{
        WsClientEvents, WsServerEvents, handle_search_request, search_registry_utils::SearchState,
        sessions_cache_utils,
    },
};

// Do not clone the session, instead use a reference to the session
pub struct WsSession {
    inner: Option<Session>,
    // Utc timestamp in microseconds
    last_activity_ts: i64,
    // Utc timestamp in microseconds
    created_ts: i64,
    // Utc timestamp in microseconds
    cookie_expiry: Option<i64>,
}

impl WsSession {
    pub fn new(inner: Session, cookie_expiry: Option<i64>) -> Self {
        let now = chrono::Utc::now().timestamp_micros();
        Self {
            inner: Some(inner),
            last_activity_ts: now,
            created_ts: now,
            cookie_expiry,
        }
    }

    pub fn update_activity(&mut self) {
        self.last_activity_ts = chrono::Utc::now().timestamp_micros();
    }

    pub fn is_expired(&self) -> bool {
        let cfg = get_config();
        let now = chrono::Utc::now().timestamp_micros();
        let idle_timeout_micros = cfg.websocket.session_idle_timeout_secs * 1_000_000;
        let max_lifetime_micros = cfg.websocket.session_max_lifetime_secs * 1_000_000;

        // 1. if the session has been idle for too long
        // 2. if the session has exceeded the max lifetime
        (now - self.last_activity_ts) > idle_timeout_micros
            || (now - self.created_ts) > max_lifetime_micros
    }

    pub fn is_client_cookie_valid(&self) -> bool {
        let now = chrono::Utc::now().timestamp_micros();
        self.cookie_expiry.is_none_or(|expiry| expiry > now)
    }

    /// Send a text message to the client
    pub async fn text(&mut self, msg: String) -> Result<(), actix_ws::Closed> {
        self.update_activity();
        if let Some(ref mut session) = self.inner {
            session.text(msg).await
        } else {
            Err(actix_ws::Closed)
        }
    }

    /// Close the session with a reason
    pub async fn close(&mut self, reason: Option<CloseReason>) -> Result<(), actix_ws::Closed> {
        self.update_activity();
        if let Some(session) = self.inner.take() {
            session.close(reason).await
        } else {
            Err(actix_ws::Closed)
        }
    }

    /// Send a pong response
    pub async fn pong(&mut self, payload: &[u8]) -> Result<(), actix_ws::Closed> {
        self.update_activity();
        if let Some(ref mut session) = self.inner {
            session.pong(payload).await
        } else {
            Err(actix_ws::Closed)
        }
    }

    /// Send a ping request
    pub async fn ping(&mut self, payload: &[u8]) -> Result<(), actix_ws::Closed> {
        self.update_activity();
        if let Some(ref mut session) = self.inner {
            session.ping(payload).await
        } else {
            Err(actix_ws::Closed)
        }
    }
}

pub async fn run(mut msg_stream: MessageStream, user_id: String, req_id: String, path: String) {
    let cfg = get_config();
    let mut ping_interval =
        tokio::time::interval(Duration::from_secs(cfg.websocket.ping_interval_secs as u64));
    let mut close_reason: Option<CloseReason> = None;

    loop {
        tokio::select! {
            Some(msg) = msg_stream.next() => {
                // Update activity and check cookie_expiry on any message
                if let Some(mut session) = sessions_cache_utils::get_mut_session(&req_id) {
                    session.update_activity();
                    if !session.is_client_cookie_valid() {
                        log::error!("[WS_HANDLER]: Session cookie expired");
                        break;
                    }
                }

                match msg {
                    Ok(actix_ws::Message::Ping(bytes)) => {
                        if let Some(mut session) = sessions_cache_utils::get_mut_session(&req_id) {
                            if let Err(e) = session.pong(&bytes).await {
                                log::error!("[WS_HANDLER]: Failed to send pong: {}", e);
                                break;
                            }
                        } else {
                            log::error!("[WS_HANDLER]: Session not found for ping response");
                            break;
                        }
                    }
                    Ok(actix_ws::Message::Pong(_)) => {
                        log::debug!("[WS_HANDLER] Received pong from {}", req_id);
                    }
                    Ok(actix_ws::Message::Text(msg)) => {
                        log::info!("[WS_HANDLER]: Request Id: {} Node Role: {} Received message: {}",
                            req_id,
                            get_config().common.node_role,
                            msg
                        );
                        handle_text_message(&user_id, &req_id, msg.to_string(), path.clone()).await;
                    }
                    Ok(actix_ws::Message::Close(reason)) => {
                        if let Some(reason) = reason.as_ref() {
                            match reason.code {
                                CloseCode::Normal | CloseCode::Error => {
                                    log::info!("[WS_HANDLER]: Request Id: {} Node Role: {} Closing connection with reason: {:?}",
                                        req_id,
                                        get_config().common.node_role,
                                        reason
                                    );
                                },
                                _ => {
                                    log::error!("[WS_HANDLER]: Request Id: {} Node Role: {} Abnormal closure with reason: {:?}",req_id,get_config().common.node_role,reason);
                                },
                            }
                        }
                        close_reason = reason;
                        break;
                    }
                    _ => ()
                }
            }
            // Heartbeat to keep the connection alive
            _ = ping_interval.tick() => {
                if let Some(mut session) = sessions_cache_utils::get_mut_session(&req_id) {
                    if let Err(e) = session.ping(&[]).await {
                        log::error!("[WS_HANDLER] Failed to send ping: {}", e);
                        break;
                    }
                }
            }
        }
    }
    cleanup_and_close_session(&req_id, close_reason).await;
}

/// Handle the incoming text message
/// Text message is parsed into `WsClientEvents` and processed accordingly
/// Depending on each event type, audit must be done
/// Currently audit is done only for the search event
pub async fn handle_text_message(user_id: &str, req_id: &str, msg: String, path: String) {
    match serde_json::from_str::<WsClientEvents>(&msg) {
        Ok(client_msg) => {
            // Validate the events
            if !client_msg.is_valid() {
                log::error!("[WS_HANDLER]: Invalid event: {:?}", client_msg);
                let err_res = WsServerEvents::error_response(
                    errors::Error::Message("Invalid event".to_string()),
                    Some(req_id.to_string()),
                    None,
                    Default::default(),
                );
                let _ = send_message(req_id, err_res.to_json()).await;
                return;
            }

            match client_msg {
                WsClientEvents::Search(ref search_req) => {
                    #[allow(unused_mut)]
                    let mut user_id = user_id;
                    // verify user_id for handling stream permissions
                    #[cfg(feature = "enterprise")]
                    {
                        user_id = if get_config().common.local_mode {
                            // single node mode, use user_id from the http request header
                            user_id
                        } else {
                            // cluster mode, use user_id from the ws event added by the router
                            if let Some(user_id) = &search_req.user_id {
                                user_id
                            } else {
                                log::error!("[WS_HANDLER]: User id not found in search request");
                                let err_res = WsServerEvents::error_response(
                                    errors::Error::Message(
                                        "User id not found in search request".to_string(),
                                    ),
                                    Some(req_id.to_string()),
                                    Some(search_req.trace_id.clone()),
                                    Default::default(),
                                );
                                let _ = send_message(req_id, err_res.to_json()).await;
                                return;
                            }
                        };
                    }
                    handle_search_event(
                        search_req,
                        &search_req.org_id,
                        user_id,
                        req_id,
                        path.clone(),
                    )
                    .await;
                }
                #[cfg(feature = "enterprise")]
                WsClientEvents::Cancel {
                    trace_id, org_id, ..
                } => {
                    if org_id.is_empty() {
                        log::error!(
                            "[WS_HANDLER]: Request Id: {} Node Role: {} Org id not found",
                            req_id,
                            get_config().common.node_role
                        );
                        return;
                    };

                    // First handle the cancel event
                    // send a cancel flag to the search task
                    if let Err(e) = handle_cancel_event(&trace_id).await {
                        log::warn!("[WS_HANDLER]: Error in cancelling : {}", e);
                        return;
                    }

                    log::info!(
                        "[WS_HANDLER]: trace_id: {}, Cancellation flag set to: {:?}",
                        trace_id,
                        search_registry_utils::is_cancelled(&trace_id)
                    );

                    let res = handle_cancel(&trace_id, &org_id).await;
                    let _ = send_message(req_id, res.to_json()).await;

                    // Only used for audit
                    #[cfg(feature = "enterprise")]
                    let client_msg = WsClientEvents::Cancel {
                        trace_id,
                        org_id: org_id.to_string(),
                        // setting user_id to None to handle PII
                        user_id: None,
                    };

                    // Add audit before closing
                    #[cfg(feature = "enterprise")]
                    let is_audit_enabled = get_o2_config().common.audit_enabled;

                    #[cfg(feature = "enterprise")]
                    if is_audit_enabled {
                        audit(AuditMessage {
                            user_email: user_id.to_string(),
                            org_id: org_id.to_string(),
                            _timestamp: chrono::Utc::now().timestamp(),
                            protocol: Protocol::Ws(WsMeta {
                                path: path.clone(),
                                message_type: client_msg.get_type(),
                                content: client_msg.to_json(),
                                close_reason: "".to_string(),
                            }),
                        })
                        .await;
                    }
                }
                WsClientEvents::Benchmark { id } => {
                    // simulate random delay for benchmarking by sleep for 10/20/30/60/90
                    // seconds
                    let delay: Vec<u64> = vec![10, 20, 30, 60, 90];
                    let delay = delay.choose(&mut rand::thread_rng()).unwrap();
                    log::info!(
                        "[WS_HANDLER]: Sleeping for benchmark, id: {}, delay: {}",
                        id,
                        delay
                    );
                    tokio::time::sleep(tokio::time::Duration::from_secs(*delay)).await;

                    let response = serde_json::json!({
                        "id": id,
                        "took": delay,
                    });
                    let _ = send_message(req_id, response.to_string()).await;
                    let close_reason = Some(CloseReason {
                        code: CloseCode::Normal,
                        description: None,
                    });
                    cleanup_and_close_session(req_id, close_reason).await;
                }
                WsClientEvents::TestAbnormalClose { req_id } => {
                    log::info!(
                        "[WS_HANDLER]: Request Id: {} Node Role: {} Test Abnormal Close",
                        req_id,
                        get_config().common.node_role
                    );
                    let close_reason = Some(CloseReason {
                        code: CloseCode::Error,
                        description: None,
                    });
                    cleanup_and_close_session(&req_id, close_reason).await;
                }
            }
        }
        Err(e) => {
            log::error!(
                "[WS_HANDLER]: Request id: {} Failed to parse message: {:?}, error: {:?}",
                req_id,
                msg,
                e
            );
            let err_res = WsServerEvents::error_response(
                e.into(),
                Some(req_id.to_string()),
                None,
                Default::default(),
            );
            let _ = send_message(req_id, err_res.to_json()).await;
            let close_reason = Some(CloseReason {
                code: CloseCode::Error,
                description: None,
            });
            let mut session = if let Some(session) = sessions_cache_utils::get_mut_session(req_id) {
                session
            } else {
                log::error!("[WS_HANDLER]: req_id: {} session not found", req_id);
                return;
            };
            let _ = session.close(close_reason).await;
        }
    }
}

pub async fn send_message(req_id: &str, msg: String) -> Result<(), Error> {
    let mut session = if let Some(session) = sessions_cache_utils::get_mut_session(req_id) {
        session
    } else {
        return Err(Error::Message(format!(
            "[req_id {}] session not found",
            req_id
        )));
    };

    log::debug!("[WS_HANDLER]: req_id: {} sending message: {}", req_id, msg);

    session.text(msg).await.map_err(|e| {
        log::error!("[WS_HANDLER]: Failed to send message: {:?}", e);
        Error::Message(e.to_string())
    })
}

async fn cleanup_and_close_session(req_id: &str, close_reason: Option<CloseReason>) {
    if let Some(mut session) = sessions_cache_utils::get_mut_session(req_id) {
        if let Some(reason) = close_reason.as_ref() {
            log::info!(
                "[WS_HANDLER]: req_id: {} Closing session with reason: {:?}",
                req_id,
                reason
            );
        }

        // Attempt to close the session
        if let Err(e) = session.close(close_reason).await {
            log::error!(
                "[WS_HANDLER]: req_id: {} Failed to close session gracefully: {:?}",
                req_id,
                e
            );
        }
    }

    // Remove the session from the cache
    sessions_cache_utils::remove_session(req_id);
    log::info!(
        "[WS_HANDLER]: req_id: {} Session removed from cache. Remaining sessions: {}",
        req_id,
        sessions_cache_utils::len_sessions()
    );
}

// Main search handler
async fn handle_search_event(
    search_req: &SearchEventReq,
    org_id: &str,
    user_id: &str,
    req_id: &str,
    #[allow(unused_variables)] path: String,
) {
    let (cancel_tx, mut cancel_rx) = mpsc::channel(1);
    let mut accumulated_results: Vec<SearchResultType> = Vec::new();

    let org_id = org_id.to_string();
    let user_id = user_id.to_string();
    let req_id = req_id.to_string();
    let trace_id = search_req.trace_id.clone();
    let trace_id_for_task = trace_id.clone();
    let search_req = search_req.clone();

    #[cfg(feature = "enterprise")]
    let is_audit_enabled = get_o2_config().common.audit_enabled;

    #[cfg(feature = "enterprise")]
    let client_msg = WsClientEvents::Search(Box::new(search_req.clone()));

    // Register running search BEFORE spawning the search task
    WS_SEARCH_REGISTRY.insert(
        trace_id.clone(),
        SearchState::Running {
            cancel_tx,
            req_id: req_id.to_string(),
        },
    );

    // Spawn the search task
    tokio::spawn(async move {
        // Handle the search request
        // If search is cancelled, the task will exit
        // Otherwise, the task will complete and the results will be sent to the client
        // The task will also update the search state to completed
        // The task will also close the session
        // The task will also cleanup the search resources
        tokio::select! {
            search_result = handle_search_request(
                &req_id,
                &mut accumulated_results,
                &org_id,
                &user_id,
                search_req.clone(),
            ) => {
                match search_result {
                    Ok(_) => {
                        if let Some(mut state) = WS_SEARCH_REGISTRY.get_mut(&trace_id_for_task) {
                            *state = SearchState::Completed {
                                req_id: req_id.to_string(),
                            };
                        }

                        // Add audit before closing
                        #[cfg(feature = "enterprise")]
                        if is_audit_enabled {
                            audit(AuditMessage {
                                user_email: user_id,
                                org_id,
                                _timestamp: chrono::Utc::now().timestamp(),
                                protocol: Protocol::Ws(WsMeta {
                                    path: path.clone(),
                                    message_type: client_msg.get_type(),
                                    content: client_msg.to_json(),
                                    close_reason: "".to_string(),
                                }),
                            })
                            .await;
                        }

                        cleanup_search_resources(&trace_id_for_task).await;
                    }
                    Err(e) => {
                        let _ = handle_search_error(e, &req_id, &trace_id_for_task).await;
                        // Add audit before closing
                        #[cfg(feature = "enterprise")]
                        if is_audit_enabled {
                          audit(AuditMessage {
                                  user_email: user_id,
                                  org_id,
                                  _timestamp: chrono::Utc::now().timestamp(),
                                  protocol: Protocol::Ws(WsMeta {
                                      path: path.clone(),
                                      message_type: client_msg.get_type(),
                                      content: client_msg.to_json(),
                                      close_reason: "".to_string(),
                                  }),
                              })
                              .await;
                        }

                        // Even if the search is cancelled, we need to cleanup the resources
                        cleanup_search_resources(&trace_id_for_task).await;
                    }
                }
            }
            _ = cancel_rx.recv() => {
                // if search is cancelled, update the state
                // the cancel handler will close the session

                // Just cleanup resources when cancelled
                cleanup_search_resources(&trace_id_for_task).await;
            }
        }
    });
}

// Cancel handler
#[cfg(feature = "enterprise")]
async fn handle_cancel_event(trace_id: &str) -> Result<(), anyhow::Error> {
    if let Some(mut entry) = WS_SEARCH_REGISTRY.get_mut(trace_id) {
        let state = entry.value_mut();
        let cancel_tx = match state {
            SearchState::Running { cancel_tx, .. } => cancel_tx.clone(),
            state => {
                let err_msg = format!("Cannot cancel search in state: {:?}", state);
                log::warn!("[WS_HANDLER]: {}", err_msg);
                return Err(anyhow::anyhow!(err_msg));
            }
        };

        *entry.value_mut() = SearchState::Cancelled {
            req_id: trace_id.to_string(),
        };

        if let Err(e) = cancel_tx.send(()).await {
            log::error!("[WS_HANDLER]: Failed to send cancel signal: {}", e);
        }

        log::info!("[WS_HANDLER]: Search cancelled for trace_id: {}", trace_id);
    }
    Ok(())
}

async fn handle_search_error(e: Error, req_id: &str, trace_id: &str) -> Option<CloseReason> {
    // if the error is due to search cancellation, return.
    // the cancel handler will close the session
    if let errors::Error::ErrorCode(errors::ErrorCodes::SearchCancelQuery(_)) = e {
        log::info!(
            "[WS_HANDLER]: trace_id: {}, Return from search handler, search canceled",
            trace_id
        );
        // Update state to cancelled before returning
        if let Some(mut state) = WS_SEARCH_REGISTRY.get_mut(trace_id) {
            *state = SearchState::Cancelled {
                req_id: trace_id.to_string(),
            };
        }
        return None;
    }

    log::error!("[WS_HANDLER]: trace_id: {} Search error: {}", trace_id, e);
    // Send error response
    let err_res = WsServerEvents::error_response(
        e,
        Some(req_id.to_string()),
        Some(trace_id.to_string()),
        Default::default(),
    );
    let _ = send_message(req_id, err_res.to_json()).await;

    // Close with error
    let close_reason = CloseReason {
        code: CloseCode::Normal,
        description: None,
    };

    // Update registry state
    if let Some(mut state) = WS_SEARCH_REGISTRY.get_mut(trace_id) {
        *state = SearchState::Completed {
            req_id: trace_id.to_string(),
        };
    }

    Some(close_reason)
}

// Add cleanup function
async fn cleanup_search_resources(trace_id: &str) {
    WS_SEARCH_REGISTRY.remove(trace_id);
    log::debug!("[WS_HANDLER]: trace_id: {}, Resources cleaned up", trace_id);
}
