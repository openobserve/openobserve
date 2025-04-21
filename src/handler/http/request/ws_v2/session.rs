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
use actix_ws::{AggregatedMessageStream, Session};
use config::{
    get_config,
    meta::websocket::{SearchEventReq, SearchResultType, ValuesEventReq},
    utils::time::now_micros,
};
use futures::StreamExt;
use infra::errors::{self, Error};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::{
    auditor::{AuditMessage, Protocol, ResponseMeta},
    infra::config::get_config as get_o2_config,
};
use rand::prelude::SliceRandom;
use tokio::sync::mpsc;
use tracing::{Instrument, instrument};

#[cfg(feature = "enterprise")]
use crate::common::infra::cluster::get_cached_online_router_nodes;
#[cfg(feature = "enterprise")]
use crate::handler::http::request::search::error_utils::map_error_to_http_response;
#[cfg(feature = "enterprise")]
use crate::service::{
    self_reporting::audit,
    websocket_events::{handle_cancel, search_registry_utils},
};
use crate::{
    common::{
        infra::config::WS_SEARCH_REGISTRY, utils::websocket::get_ping_interval_secs_with_jitter,
    },
    service::websocket_events::{
        WsClientEvents, WsServerEvents, handle_search_request, handle_values_request,
        search_registry_utils::SearchState, sessions_cache_utils,
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
        let now = now_micros();
        Self {
            inner: Some(inner),
            last_activity_ts: now,
            created_ts: now,
            cookie_expiry,
        }
    }

    pub fn update_activity(&mut self) {
        self.last_activity_ts = now_micros();
    }

    pub fn is_expired(&self) -> bool {
        let cfg = get_config();
        let now = now_micros();
        let idle_timeout_micros = cfg.websocket.session_idle_timeout_secs * 1_000_000;
        let max_lifetime_micros = cfg.websocket.session_max_lifetime_secs * 1_000_000;

        // 1. if the session has been idle for too long
        // 2. if the session has exceeded the max lifetime
        (now - self.last_activity_ts) > idle_timeout_micros
            || (now - self.created_ts) > max_lifetime_micros
    }

    pub fn is_client_cookie_valid(&self) -> bool {
        let now = now_micros();
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

#[instrument(
    skip_all,
    fields(req_id = %req_id, path = %path),
    level = "info"
)]
pub async fn run(
    mut msg_stream: AggregatedMessageStream,
    user_id: String,
    req_id: String,
    path: String,
) {
    let cfg = get_config();
    log::info!(
        "[WS_HANDLER]: Starting WebSocket session for req_id: {}, path: {}, querier: {}",
        req_id,
        path,
        cfg.common.instance_name
    );

    let mut ping_interval = tokio::time::interval(Duration::from_secs(
        get_ping_interval_secs_with_jitter() as _,
    ));
    let mut close_reason: Option<CloseReason> = None;

    loop {
        tokio::select! {
            Some(msg) = msg_stream.next() => {
                // Update activity and check cookie_expiry on any message
                if let Some(session) = sessions_cache_utils::get_session(&req_id).await {
                    let mut session = session.write().await;
                    session.update_activity();
                    if !session.is_client_cookie_valid() {
                        log::error!("[WS_HANDLER]: Session cookie expired for req_id: {}, querier: {}", req_id, cfg.common.instance_name);
                        drop(session);
                        break;
                    }
                    drop(session);
                }

                match msg {
                    Ok(actix_ws::AggregatedMessage::Ping(bytes)) => {
                        // Create a span for ping handling
                        let ping_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
                            tracing::info_span!("ws:ping", req_id = req_id.as_str())
                        } else {
                            tracing::Span::none()
                        };
                        let _ping_guard = ping_span.enter();

                        log::debug!(
                            "[WS_HANDLER]: Received ping from client for req_id: {}, querier: {}",
                            req_id,
                            cfg.common.instance_name
                        );
                        if let Some(session) = sessions_cache_utils::get_session(&req_id).await {
                            let mut session = session.write().await;
                            if let Err(e) = session.pong(&bytes).await {
                                log::error!(
                                    "[WS_HANDLER]: Failed to send pong to client for req_id: {}, querier: {}, error: {}",
                                    req_id,
                                    cfg.common.instance_name,
                                    e
                                );
                                drop(session);
                                break;
                            }
                            drop(session);
                        } else {
                            log::error!("[WS_HANDLER]: Session not found for ping response, req_id: {}, querier: {}", req_id, cfg.common.instance_name);
                            break;
                        }
                    }
                    Ok(actix_ws::AggregatedMessage::Pong(_)) => {
                        // Create a span for pong message
                        let pong_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
                            tracing::info_span!("ws:pong", req_id = req_id.as_str())
                        } else {
                            tracing::Span::none()
                        };
                        let _pong_guard = pong_span.enter();

                        log::debug!(
                            "[WS_HANDLER]: Received pong from client for req_id: {}, querier: {}",
                            req_id,
                            cfg.common.instance_name
                        );
                    }
                    Ok(actix_ws::AggregatedMessage::Text(msg)) => {
                        // Create a span for text message handling
                        let text_msg_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
                            tracing::info_span!("ws:text_message", req_id = req_id.as_str())
                        } else {
                            tracing::Span::none()
                        };
                        let _text_msg_guard = text_msg_span.enter();

                        log::debug!("[WS_HANDLER]: Request Id: {} Node Role: {}, querier: {}, Received message: {}",
                            req_id,
                            cfg.common.node_role,
                            cfg.common.instance_name,
                            msg
                        );
                        handle_text_message(&user_id, &req_id, msg.to_string(), path.clone()).await;
                    }
                    Ok(actix_ws::AggregatedMessage::Close(reason)) => {
                        // Create a span for close message
                        let close_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
                            tracing::info_span!("ws:close", req_id = req_id.as_str())
                        } else {
                            tracing::Span::none()
                        };
                        let _close_guard = close_span.enter();

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
                    Err(e) => {
                        // Create a span for error handling
                        let error_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
                            tracing::info_span!("ws:error", req_id = req_id.as_str(), error = e.to_string().as_str())
                        } else {
                            tracing::Span::none()
                        };
                        let _error_guard = error_span.enter();

                        log::error!("[WS_HANDLER]: Error in handling message for req_id: {}, node: {}, error: {}", req_id, get_config().common.instance_name, e);
                        break;
                    }
                    _ => {
                        // Create a span for unknown message
                        let unknown_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
                            tracing::info_span!("ws:unknown_message", req_id = req_id.as_str())
                        } else {
                            tracing::Span::none()
                        };
                        let _unknown_guard = unknown_span.enter();

                        log::error!("[WS_HANDLER]: Error in handling message for req_id: {}, node: {}, error: {}", req_id, get_config().common.instance_name, "Unknown error");
                        break;
                    }
                }
            }
            // Heartbeat to keep the connection alive
            _ = ping_interval.tick() => {
                // Create a span for heartbeat ping
                let heartbeat_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
                    tracing::info_span!("ws:heartbeat", req_id = req_id.as_str())
                } else {
                    tracing::Span::none()
                };
                let _heartbeat_guard = heartbeat_span.enter();

                if let Some(session) = sessions_cache_utils::get_session(&req_id).await {
                    log::debug!(
                        "[WS_HANDLER]: Sending heartbeat ping to client for req_id: {}, querier: {}",
                        req_id,
                        cfg.common.instance_name
                    );
                    let mut session = session.write().await;
                    if let Err(e) = session.ping(&[]).await {
                        log::error!(
                            "[WS_HANDLER]: Failed to send ping to client for req_id: {}, querier: {}, error: {}. Connection will be closed.",
                            req_id,
                            cfg.common.instance_name,
                            e
                        );
                        drop(session);
                        break;
                    }
                    drop(session);
                } else {
                    log::warn!(
                        "[WS_HANDLER]: Session not found for req_id: {}, querier: {} during heartbeat. Connection will be closed.",
                        req_id,
                        cfg.common.instance_name
                    );
                    break;
                }
            }
        }
    }

    // Cleanup span is now handled by the instrument macro on cleanup_and_close_session
    cleanup_and_close_session(&req_id, close_reason).await;
}

/// Resolves user ID based on the execution mode and request data
///
/// # Parameters
/// * `default_user_id` - Default user ID from the HTTP request
/// * `user_id_from_event` - Optional user ID from the event
///
/// # Returns
/// * `Option<String>` - Resolved user ID if successful, None otherwise
#[cfg(feature = "enterprise")]
async fn resolve_enterprise_user_id(
    default_user_id: &str,
    user_id_from_event: Option<&String>,
) -> Option<String> {
    if get_config().common.local_mode {
        // Single node mode, use user_id from the HTTP request header
        Some(default_user_id.to_string())
    } else {
        // Cluster mode, try to determine user ID
        // First check if we're running without router nodes
        let router_nodes = get_cached_online_router_nodes().await;
        if let Some(nodes) = router_nodes {
            if nodes.is_empty() {
                // Single node enterprise deployment
                return Some(default_user_id.to_string());
            }
        }

        // Next, try to use user_id from the event
        if let Some(id) = user_id_from_event {
            return Some(id.clone());
        }
        None
    }
}

/// Handle the incoming text message
/// Text message is parsed into `WsClientEvents` and processed accordingly
/// Depending on each event type, audit must be done
/// Currently audit is done only for the search event
#[instrument(
    skip_all,
    fields(req_id = %req_id),
    level = "info"
)]
pub async fn handle_text_message(user_id: &str, req_id: &str, msg: String, path: String) {
    let cfg = get_config();

    // Early parse to extract trace_id for tracing
    let trace_id = match serde_json::from_str::<WsClientEvents>(&msg) {
        Ok(client_msg) => match client_msg {
            WsClientEvents::Search(ref search_req) => Some(search_req.trace_id.clone()),
            WsClientEvents::Values(ref values_req) => Some(values_req.trace_id.clone()),
            #[cfg(feature = "enterprise")]
            WsClientEvents::Cancel { ref trace_id, .. } => Some(trace_id.clone()),
            _ => None,
        },
        Err(_) => None,
    };

    // Add trace_id to the current span if available
    if let Some(trace_id) = trace_id.as_ref() {
        tracing::Span::current().record("trace_id", trace_id);
    }

    match serde_json::from_str::<WsClientEvents>(&msg) {
        Ok(client_msg) => {
            // Validate the events
            if !client_msg.is_valid() {
                log::error!("[WS_HANDLER]: Invalid event: {:?}", client_msg);
                let err_res = WsServerEvents::error_response(
                    &errors::Error::Message("Invalid event".to_string()),
                    Some(req_id.to_string()),
                    None,
                    Default::default(),
                );
                let _ =
                    send_message(req_id, err_res.to_json(), Some(client_msg.get_trace_id())).await;
                return;
            }

            match client_msg {
                WsClientEvents::Search(ref search_req) => {
                    #[allow(unused_mut)]
                    let mut user_id = user_id.to_string();
                    // Create a span for the search operation
                    let ws_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled
                    {
                        let org_id = &search_req.org_id;
                        tracing::info_span!(
                            "ws::session::handle_text_message::search",
                            trace_id = search_req.trace_id.as_str(),
                            org_id = org_id.as_str(),
                            req_id = req_id,
                        )
                    } else {
                        tracing::Span::none()
                    };

                    // verify user_id for handling stream permissions
                    #[cfg(feature = "enterprise")]
                    {
                        let resolve_span = tracing::info_span!(
                            "ws::session::resolve_enterprise_user_id",
                            trace_id = search_req.trace_id.as_str()
                        );

                        let _guard = resolve_span.enter();
                        user_id =
                            match resolve_enterprise_user_id(&user_id, search_req.user_id.as_ref())
                                .await
                            {
                                Some(id) => id,
                                None => {
                                    log::error!(
                                        "[WS_HANDLER]: User id not found in search request"
                                    );
                                    let err_res = WsServerEvents::error_response(
                                        &errors::Error::Message(
                                            "User id not found in search request".to_string(),
                                        ),
                                        Some(req_id.to_string()),
                                        Some(search_req.trace_id.to_string()),
                                        Default::default(),
                                    );
                                    let trace_id = if err_res.get_trace_id().is_empty() {
                                        None
                                    } else {
                                        Some(err_res.get_trace_id())
                                    };
                                    let _ = send_message(req_id, err_res.to_json(), trace_id).await;
                                    return;
                                }
                            };
                    }

                    handle_search_event(
                        search_req,
                        &search_req.org_id,
                        &user_id,
                        req_id,
                        path.clone(),
                    )
                    .instrument(ws_span)
                    .await;
                }
                WsClientEvents::Values(ref values_req) => {
                    #[allow(unused_mut)]
                    let mut user_id = user_id.to_string();
                    // Create a span for the values operation
                    let ws_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled
                    {
                        let org_id = &values_req.org_id;
                        tracing::info_span!(
                            "ws::session::handle_text_message::values",
                            trace_id = values_req.trace_id.as_str(),
                            org_id = org_id.as_str(),
                            req_id = req_id,
                        )
                    } else {
                        tracing::Span::none()
                    };

                    // verify user_id for handling stream permissions
                    #[cfg(feature = "enterprise")]
                    {
                        let resolve_span = tracing::info_span!(
                            "ws::session::resolve_enterprise_user_id",
                            trace_id = values_req.trace_id.as_str()
                        );

                        let _guard = resolve_span.enter();
                        user_id =
                            match resolve_enterprise_user_id(&user_id, values_req.user_id.as_ref())
                                .await
                            {
                                Some(id) => id,
                                None => {
                                    log::error!(
                                        "[WS_HANDLER]: User id not found in values request"
                                    );
                                    let err_res = WsServerEvents::error_response(
                                        &errors::Error::Message(
                                            "User id not found in values request".to_string(),
                                        ),
                                        Some(req_id.to_string()),
                                        Some(values_req.trace_id.to_string()),
                                        Default::default(),
                                    );
                                    let _ = send_message(
                                        req_id,
                                        err_res.to_json(),
                                        Some(values_req.trace_id.to_string()),
                                    )
                                    .await;
                                    return;
                                }
                            };
                    }

                    handle_values_event(
                        values_req,
                        &values_req.org_id,
                        &user_id,
                        req_id,
                        path.clone(),
                    )
                    .instrument(ws_span)
                    .await;
                }
                #[cfg(feature = "enterprise")]
                WsClientEvents::Cancel {
                    trace_id, org_id, ..
                } => {
                    // Create a span for the cancel operation
                    let ws_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled
                    {
                        tracing::info_span!(
                            "ws::session::handle_text_message::cancel",
                            trace_id = trace_id.as_str(),
                            org_id = org_id.as_str(),
                            req_id = req_id,
                        )
                    } else {
                        tracing::Span::none()
                    };

                    let _span_guard = ws_span.enter();

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
                        search_registry_utils::is_cancelled(&trace_id).await
                    );

                    let res = handle_cancel(&trace_id, &org_id).await;
                    let _ = send_message(req_id, res.to_json(), Some(trace_id.to_string())).await;

                    // Only used for audit
                    #[cfg(feature = "enterprise")]
                    let client_msg = WsClientEvents::Cancel {
                        trace_id: trace_id.to_string(),
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
                            protocol: Protocol::Ws,
                            response_meta: ResponseMeta {
                                http_method: "".to_string(),
                                http_path: path.clone(),
                                http_query_params: "".to_string(),
                                http_body: client_msg.to_json(),
                                http_response_code: 200,
                                error_msg: None,
                                trace_id: Some(trace_id.to_string()),
                            },
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
                    let _ = send_message(req_id, response.to_string(), Some(id.to_string())).await;
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
                &e.into(),
                Some(req_id.to_string()),
                None,
                Default::default(),
            );
            let trace_id = if err_res.get_trace_id().is_empty() {
                None
            } else {
                Some(err_res.get_trace_id())
            };
            let _ = send_message(req_id, err_res.to_json(), trace_id).await;
            let close_reason = Some(CloseReason {
                code: CloseCode::Error,
                description: None,
            });
            let session = if let Some(session) = sessions_cache_utils::get_session(req_id).await {
                session
            } else {
                log::error!("[WS_HANDLER]: req_id: {} session not found", req_id);
                return;
            };
            let mut session = session.write().await;
            let _ = session.close(close_reason).await;
            drop(session);
        }
    }
}

#[instrument(
    skip_all,
    fields(req_id = %req_id, trace_id = ?trace_id),
    level = "debug"
)]
pub async fn send_message(
    req_id: &str,
    msg: String,
    trace_id: Option<String>,
) -> Result<(), Error> {
    let session = if let Some(session) = sessions_cache_utils::get_session(req_id).await {
        session
    } else {
        return Err(Error::Message(format!(
            "[req_id {}] session not found",
            req_id
        )));
    };

    log::debug!("[WS_HANDLER]: req_id: {} sending message: {}", req_id, msg);

    let mut session = session.write().await;
    let _ = session.text(msg).await.map_err(|e| {
        log::error!("[WS_HANDLER]: Failed to send message: {:?}", e);
        Error::Message(e.to_string())
    });
    drop(session);
    Ok(())
}

#[instrument(
    skip_all,
    fields(req_id = %req_id),
    level = "info"
)]
async fn cleanup_and_close_session(req_id: &str, close_reason: Option<CloseReason>) {
    let cfg = get_config();
    log::info!(
        "[WS_HANDLER]: Beginning cleanup for req_id: {}, close_reason: {:?}, querier: {}",
        req_id,
        close_reason,
        cfg.common.instance_name
    );

    if let Some(session) = sessions_cache_utils::get_session(req_id).await {
        if let Some(reason) = close_reason.as_ref() {
            log::debug!(
                "[WS_HANDLER]: req_id: {}, querier: {}, Closing session with reason: {:?}",
                req_id,
                cfg.common.instance_name,
                reason
            );
        }

        let mut session = session.write().await;
        // Attempt to close the session
        if let Err(e) = session.close(close_reason).await {
            log::error!(
                "[WS_HANDLER]: req_id: {}, querier: {}, Failed to close session gracefully: {:?}",
                req_id,
                cfg.common.instance_name,
                e
            );
        }
        drop(session);
    }

    // Remove the session from the cache
    sessions_cache_utils::remove_session(req_id).await;
    log::info!(
        "[WS_HANDLER]: req_id: {}, querier: {}, Session cleanup completed. Remaining sessions: {}",
        req_id,
        cfg.common.instance_name,
        sessions_cache_utils::len_sessions().await
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

    // Create a span for the search task that will be spawned
    let cfg = get_config();
    let task_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
        tracing::info_span!(
            "ws::session::handle_search_event",
            trace_id = trace_id.as_str(),
            org_id = org_id.as_str(),
            req_id = req_id.as_str(),
        )
    } else {
        tracing::Span::none()
    };

    #[cfg(feature = "enterprise")]
    let is_audit_enabled = get_o2_config().common.audit_enabled;

    #[cfg(feature = "enterprise")]
    let client_msg = WsClientEvents::Search(Box::new(search_req.clone()));

    // Register running search BEFORE spawning the search task
    let mut w = WS_SEARCH_REGISTRY.write().await;
    w.insert(
        trace_id.clone(),
        SearchState::Running {
            cancel_tx,
            req_id: req_id.to_string(),
        },
    );
    drop(w);

    // Spawn the search task with the task span
    tokio::spawn(
        async move {
            // Handle the search request
            // If search is cancelled, the task will exit
            // Otherwise, the task will complete and the results will be sent to the client
            // The task will also update the search state to completed
            // The task will also close the session
            // The task will also cleanup the search resources
            tokio::select! {
                search_result = {
                    let search_span = tracing::info_span!(
                        "ws::session::handle_search_request", 
                        trace_id = %trace_id,
                        org_id = %org_id
                    );
                    let _guard = search_span.enter();
                    handle_search_request(
                        &req_id,
                        &mut accumulated_results,
                        &org_id,
                        &user_id,
                        search_req.clone(),
                    )
                } => {
                    match search_result {
                        Ok(_) => {
                            let mut w = WS_SEARCH_REGISTRY.write().await;
                            if let Some(state) = w.get_mut(&trace_id_for_task) {
                                *state = SearchState::Completed {
                                    req_id: req_id.to_string(),
                                };
                            }
                            drop(w);

                            // Add audit before closing
                            #[cfg(feature = "enterprise")]
                            if is_audit_enabled {
                                audit(AuditMessage {
                                    user_email: user_id,
                                    org_id,
                                    _timestamp: chrono::Utc::now().timestamp(),
                                    protocol: Protocol::Ws,
                                    response_meta: ResponseMeta {
                                        http_method: "".to_string(),
                                        http_path: path.clone(),
                                        http_query_params: "".to_string(),
                                        http_body: client_msg.to_json(),
                                        http_response_code: 200,
                                        error_msg: None,
                                        trace_id: Some(trace_id.to_string()),
                                    },
                                })
                                .await;
                            }

                            cleanup_search_resources(&trace_id_for_task).await;
                        }
                        Err(e) => {
                            let _ = handle_search_error(&e, &req_id, &trace_id_for_task).await;

                            #[cfg(feature = "enterprise")]
                            let http_response_code: u16;
                            #[cfg(feature = "enterprise")]
                            {
                                let http_response = map_error_to_http_response(&e, trace_id.to_string());
                                http_response_code = http_response.status().into();
                            }
                            // Add audit before closing
                            #[cfg(feature = "enterprise")]
                            if is_audit_enabled {
                              audit(AuditMessage {
                                      user_email: user_id,
                                      org_id,
                                      _timestamp: chrono::Utc::now().timestamp(),
                                      protocol: Protocol::Ws,
                                      response_meta: ResponseMeta {
                                          http_method: "".to_string(),
                                          http_path: path.clone(),
                                          http_query_params: "".to_string(),
                                          http_body: client_msg.to_json(),
                                          http_response_code,
                                          error_msg: Some(e.to_string()),
                                          trace_id: Some(trace_id.to_string()),
                                      },
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
        }
        .instrument(task_span)
    );
}

// Cancel handler
#[cfg(feature = "enterprise")]
#[instrument(
    skip_all,
    fields(trace_id = %trace_id),
    level = "info"
)]
async fn handle_cancel_event(trace_id: &str) -> Result<(), anyhow::Error> {
    let mut w = WS_SEARCH_REGISTRY.write().await;
    if let Some(state) = w.get_mut(trace_id) {
        let cancel_tx = match state {
            SearchState::Running { cancel_tx, .. } => cancel_tx.clone(),
            state => {
                let err_msg = format!("Cannot cancel search in state: {:?}", state);
                log::warn!("[WS_HANDLER]: {}", err_msg);
                drop(w);
                return Err(anyhow::anyhow!(err_msg));
            }
        };

        *state = SearchState::Cancelled {
            req_id: trace_id.to_string(),
        };

        if let Err(e) = cancel_tx.send(()).await {
            log::error!("[WS_HANDLER]: Failed to send cancel signal: {}", e);
        }

        log::info!("[WS_HANDLER]: Search cancelled for trace_id: {}", trace_id);
    }
    drop(w);

    Ok(())
}

#[instrument(
    skip_all,
    fields(trace_id = %trace_id, req_id = %req_id),
    level = "info"
)]
async fn handle_search_error(e: &Error, req_id: &str, trace_id: &str) -> Option<CloseReason> {
    // if the error is due to search cancellation, return.
    // the cancel handler will close the session
    if let errors::Error::ErrorCode(errors::ErrorCodes::SearchCancelQuery(_)) = e {
        log::info!(
            "[WS_HANDLER]: trace_id: {}, Return from search handler, search canceled",
            trace_id
        );
        // Update state to cancelled before returning
        let mut w = WS_SEARCH_REGISTRY.write().await;
        if let Some(state) = w.get_mut(trace_id) {
            *state = SearchState::Cancelled {
                req_id: req_id.to_string(),
            };
        }
        drop(w);
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
    let _ = send_message(req_id, err_res.to_json(), Some(trace_id.to_string())).await;

    // Close with error
    let close_reason = CloseReason {
        code: CloseCode::Normal,
        description: None,
    };

    // Update registry state
    let mut w = WS_SEARCH_REGISTRY.write().await;
    w.entry(trace_id.to_string())
        .and_modify(|state| {
            *state = SearchState::Completed {
                req_id: trace_id.to_string(),
            }
        })
        .or_insert(SearchState::Completed {
            req_id: trace_id.to_string(),
        });
    drop(w);

    Some(close_reason)
}

// Add cleanup function
#[instrument(
    skip_all,
    fields(trace_id = %trace_id),
    level = "info"
)]
async fn cleanup_search_resources(trace_id: &str) {
    let mut w = WS_SEARCH_REGISTRY.write().await;
    w.remove(trace_id);
    drop(w);
    log::debug!("[WS_HANDLER]: trace_id: {}, Resources cleaned up", trace_id);
}

// Main values handler
#[instrument(
    skip_all,
    fields(trace_id = %values_req.trace_id, org_id = %org_id, req_id = %req_id),
    level = "info"
)]
async fn handle_values_event(
    values_req: &ValuesEventReq,
    org_id: &str,
    user_id: &str,
    req_id: &str,
    #[allow(unused_variables)] path: String,
) {
    let (cancel_tx, mut cancel_rx) = mpsc::channel(1);

    let org_id = org_id.to_string();
    let user_id = user_id.to_string();
    let req_id = req_id.to_string();
    let trace_id = values_req.trace_id.clone();
    let trace_id_for_task = trace_id.clone();
    let values_req = values_req.clone();

    // Create a span for the values task that will be spawned
    let cfg = get_config();
    let task_span = if cfg.common.tracing_search_enabled || cfg.common.tracing_enabled {
        tracing::info_span!(
            "ws::session::handle_values_event",
            trace_id = trace_id.as_str(),
            org_id = org_id.as_str(),
            req_id = req_id.as_str(),
        )
    } else {
        tracing::Span::none()
    };

    #[cfg(feature = "enterprise")]
    let is_audit_enabled = get_o2_config().common.audit_enabled;

    #[cfg(feature = "enterprise")]
    let client_msg = WsClientEvents::Values(Box::new(values_req.clone()));

    // Register running values search BEFORE spawning the values task
    let mut w = WS_SEARCH_REGISTRY.write().await;
    w.insert(
        trace_id.clone(),
        SearchState::Running {
            cancel_tx,
            req_id: req_id.to_string(),
        },
    );
    drop(w);

    // Create a vector to accumulate results
    let mut accumulated_results: Vec<SearchResultType> = Vec::new();

    // Spawn the values task with the task span
    tokio::spawn(
        async move {
            // Handle the values request
            // If values search is cancelled, the task will exit
            // Otherwise, the task will complete and the results will be sent to the client
            // The task will also update the values state to completed
            // The task will also cleanup the values search resources
            tokio::select! {
                values_result = {
                    let values_span = tracing::info_span!(
                        "ws::session::handle_values_request", 
                        trace_id = %trace_id,
                        org_id = %org_id
                    );
                    let _guard = values_span.enter();
                    handle_values_request(
                        &org_id,
                        &user_id,
                        &req_id,
                        values_req.clone(),
                        &mut accumulated_results,
                    )
                } => {
                    match values_result {
                        Ok(_) => {
                            let mut w = WS_SEARCH_REGISTRY.write().await;
                            if let Some(state) = w.get_mut(&trace_id_for_task) {
                                *state = SearchState::Completed {
                                    req_id: req_id.to_string(),
                                };
                            }
                            drop(w);

                            // Add audit before closing
                            #[cfg(feature = "enterprise")]
                            if is_audit_enabled {
                                audit(AuditMessage {
                                    user_email: user_id,
                                    org_id,
                                    _timestamp: chrono::Utc::now().timestamp(),
                                    protocol: Protocol::Ws,
                                    response_meta: ResponseMeta {
                                        http_method: "".to_string(),
                                        http_path: path.clone(),
                                        http_query_params: "".to_string(),
                                        http_body: client_msg.to_json(),
                                        http_response_code: 200,
                                        error_msg: None,
                                        trace_id: Some(trace_id.to_string()),
                                    },
                                })
                                .await;
                            }

                            cleanup_search_resources(&trace_id_for_task).await;
                        }
                        Err(e) => {
                            // Convert anyhow::Error to our Error type
                            let error = Error::Message(e.to_string());
                            let _ = handle_search_error(&error, &req_id, &trace_id_for_task).await;

                            #[cfg(feature = "enterprise")]
                            let http_response_code: u16;
                            #[cfg(feature = "enterprise")]
                            {
                                let http_response = map_error_to_http_response(&error, trace_id.to_string());
                                http_response_code = http_response.status().into();
                            }
                            // Add audit before closing
                            #[cfg(feature = "enterprise")]
                            if is_audit_enabled {
                              audit(AuditMessage {
                                      user_email: user_id,
                                      org_id,
                                      _timestamp: chrono::Utc::now().timestamp(),
                                      protocol: Protocol::Ws,
                                      response_meta: ResponseMeta {
                                          http_method: "".to_string(),
                                          http_path: path.clone(),
                                          http_query_params: "".to_string(),
                                          http_body: client_msg.to_json(),
                                          http_response_code,
                                          error_msg: Some(e.to_string()),
                                          trace_id: Some(trace_id.to_string()),
                                      },
                                  })
                                  .await;
                            }

                            // Even if the values search is cancelled, we need to cleanup the resources
                            cleanup_search_resources(&trace_id_for_task).await;
                        }
                    }
                }
                _ = cancel_rx.recv() => {
                    // if values search is cancelled, update the state
                    // the cancel handler will close the session

                    // Just cleanup resources when cancelled
                    cleanup_search_resources(&trace_id_for_task).await;
                }
            }
        }
        .instrument(task_span)
    );
}
