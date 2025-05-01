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

use actix_web::http::StatusCode;
use config::meta::{
    sql::OrderBy,
    websocket::{SearchEventReq, ValuesEventReq},
};
use infra::errors;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::tungstenite;

use crate::handler::http::request::search::error_utils::map_error_to_http_response;

pub mod enterprise_utils {
    #[allow(unused_imports)]
    use config::meta::stream::StreamType;

    #[allow(unused_imports)]
    use crate::common::meta;

    #[cfg(feature = "enterprise")]
    pub async fn check_permissions(
        stream_name: &str,
        stream_type: StreamType,
        user_id: &str,
        org_id: &str,
    ) -> Result<(), String> {
        use o2_openfga::meta::mapping::OFGA_MODELS;

        use crate::common::{
            infra::config::USERS,
            utils::auth::{AuthExtractor, is_root_user},
        };

        // Check if the user is a root user (has all permissions)
        if is_root_user(user_id) {
            return Ok(());
        }

        // Get user details from the USERS cache
        let user: meta::user::User = USERS
            .get(&format!("{}/{}", org_id, user_id))
            .ok_or_else(|| "User not found".to_string())?
            .clone();

        // If the user is external, check permissions
        let stream_type_str = stream_type.as_str();
        let o2_type = format!(
            "{}:{}",
            OFGA_MODELS
                .get(stream_type_str)
                .map_or(stream_type_str, |model| model.key),
            stream_name
        );

        let auth_extractor = AuthExtractor {
            auth: "".to_string(),
            method: "GET".to_string(),
            o2_type,
            org_id: org_id.to_string(),
            bypass_check: false,
            parent_id: "".to_string(),
        };

        let has_permission = crate::handler::http::auth::validator::check_permissions(
            user_id,
            auth_extractor,
            user.role,
            user.is_external,
        )
        .await;

        if !has_permission {
            return Err("Unauthorized Access".to_string());
        };

        Ok(())
    }
}

pub mod sessions_cache_utils {
    use std::sync::Arc;

    use actix_ws::{CloseCode, CloseReason};
    use config::get_config;
    use futures::FutureExt;
    use tokio::sync::RwLock;

    use crate::{
        common::infra::config::WS_SESSIONS, handler::http::request::ws::session::WsSession,
    };

    pub async fn run_gc_ws_sessions() {
        log::debug!("[WS_GC] Running garbage collector for websocket sessions");
        let cfg = get_config();
        let interval_secs = cfg.websocket.session_gc_interval_secs;

        let mut interval =
            tokio::time::interval(std::time::Duration::from_secs(interval_secs as u64));

        tokio::spawn(async move {
            loop {
                interval.tick().await;
                log::debug!("[WS_GC] Running garbage collector for websocket sessions");

                // Use catch_unwind to prevent task from crashing
                if let Err(e) = std::panic::AssertUnwindSafe(cleanup_expired_sessions())
                    .catch_unwind()
                    .await
                {
                    log::error!("[WS_GC] Panic in cleanup: {:?}", e);
                    // Add delay before next attempt
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    continue;
                }

                // Add delay between runs if too many sessions
                let r = WS_SESSIONS.read().await;
                if r.len() > 1000 {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
                drop(r);
            }
        });
    }

    async fn cleanup_expired_sessions() {
        // get expired sessions
        let r = WS_SESSIONS.read().await;
        let session_ids: Vec<String> = r.keys().cloned().collect();
        let mut expired = Vec::new();

        for session_id in session_ids {
            if let Some(session) = r.get(&session_id) {
                let session_lock = session.read().await;
                if session_lock.is_expired() {
                    expired.push(session_id);
                }
                drop(session_lock);
            }
        }
        drop(r);

        // close and remove expired sessions
        for session_id in expired {
            // Close and remove session
            if let Some(session) = get_session(&session_id).await {
                log::info!("[WS_GC] Closing expired session: {}", session_id);

                let mut session = session.write().await;
                if let Err(e) = session
                    .close(Some(CloseReason {
                        code: CloseCode::Normal,
                        description: Some("Session expired".to_string()),
                    }))
                    .await
                {
                    log::warn!("[WS_GC] Error closing session {}: {}", session_id, e);
                }
                drop(session);
            }

            remove_session(&session_id).await;
            log::info!("[WS_GC] Removed expired session: {}", session_id);
        }

        log::info!(
            "[WS_GC] Remaining active sessions: {}",
            len_sessions().await
        );
    }

    /// Insert a new session into the cache
    pub async fn insert_session(session_id: &str, session: Arc<RwLock<WsSession>>) {
        let mut w = WS_SESSIONS.write().await;
        w.insert(session_id.to_string(), session);
        drop(w);
        log::debug!(
            "[WS::SessionCache] inserted session: {}, querier: {}",
            session_id,
            get_config().common.instance_name
        );
    }

    /// Remove a session from the cache
    pub async fn remove_session(session_id: &str) {
        let mut w = WS_SESSIONS.write().await;
        w.remove(session_id);
        drop(w);
        log::debug!(
            "[WS::SessionCache] removed session: {}, querier: {}",
            session_id,
            get_config().common.instance_name
        );
    }

    // Return a mutable reference to the session
    pub async fn get_session(session_id: &str) -> Option<Arc<RwLock<WsSession>>> {
        let r = WS_SESSIONS.read().await;
        let session = r.get(session_id).cloned();
        drop(r);
        session
    }

    /// Check if a session exists in the cache
    pub async fn contains_session(session_id: &str) -> bool {
        let r = WS_SESSIONS.read().await;
        let res = r.contains_key(session_id);
        drop(r);
        res
    }

    /// Get the number of sessions in the cache
    pub async fn len_sessions() -> usize {
        let r = WS_SESSIONS.read().await;
        let res = r.len();
        drop(r);
        res
    }
}

/// Represents the different types of WebSocket client messages that can be sent.
///
/// The `WSClientMessage` enum is used to represent the different types of messages that can be sent
/// from a WebSocket client to the server. It includes two variants:
///
/// - `Search`: Represents a request to search for data, containing a trace ID, a query payload, and
///   a query type.
/// - `Cancel`: Represents a request to cancel a previous search, containing a trace ID.
///
/// The `WSQueryPayload` struct is used to encapsulate the details of a search query, including the
/// SQL query, start time, and end time.
///
/// This enum is serialized and deserialized using the `serde` crate, with the `type` field
/// indicating the variant and the `content` field containing the associated data.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(
    tag = "type",
    content = "content",
    rename_all(serialize = "snake_case", deserialize = "snake_case")
)]
pub enum WsClientEvents {
    Search(Box<SearchEventReq>),
    Values(Box<ValuesEventReq>),
    #[cfg(feature = "enterprise")]
    Cancel {
        trace_id: String,
        // TODO: remove this once v1 is deprecated
        org_id: String,
        // TODO: is it PII safe?
        user_id: Option<String>,
    },
    Benchmark {
        id: String,
    },
    TestAbnormalClose {
        req_id: String,
    },
}

impl WsClientEvents {
    pub fn event_type(&self) -> &'static str {
        match self {
            WsClientEvents::Search(req) => req.event_type(),
            WsClientEvents::Values(req) => req.event_type(),
            #[cfg(feature = "enterprise")]
            WsClientEvents::Cancel { .. } => "cancel",
            WsClientEvents::Benchmark { .. } => "benchmark",
            WsClientEvents::TestAbnormalClose { .. } => "test_abnormal_close",
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("Failed to serialize WsClientEvents")
    }

    pub fn get_trace_id(&self) -> String {
        match &self {
            Self::Search(req) => req.trace_id.clone(),
            Self::Values(req) => req.trace_id.clone(),
            #[cfg(feature = "enterprise")]
            Self::Cancel { trace_id, .. } => trace_id.clone(),
            Self::Benchmark { id } => id.clone(),
            Self::TestAbnormalClose { req_id } => req_id.clone(),
        }
    }

    pub fn is_valid(&self) -> bool {
        match self {
            Self::Search(req) => req.is_valid(),
            Self::Values(req) => req.is_valid(),
            #[cfg(feature = "enterprise")]
            Self::Cancel {
                trace_id, org_id, ..
            } => !trace_id.is_empty() && !org_id.is_empty(),
            Self::Benchmark { id } => !id.is_empty(),
            Self::TestAbnormalClose { req_id } => !req_id.is_empty(),
        }
    }

    // Append `user_id` to the ws client events when run in cluster mode to handle stream
    // permissions
    #[cfg(feature = "enterprise")]
    pub fn append_user_id(&mut self, user_id: Option<String>) {
        match self {
            Self::Search(req) => req.user_id = user_id,
            Self::Values(req) => req.user_id = user_id,
            Self::Cancel { user_id: uid, .. } => *uid = user_id,
            _ => {}
        }
    }
}

/// To represent the query start and end time based of partition or cache
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TimeOffset {
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(
    tag = "type",
    content = "content",
    rename_all(serialize = "snake_case", deserialize = "snake_case")
)]
pub enum WsServerEvents {
    SearchResponse {
        trace_id: String,
        results: Box<config::meta::search::Response>,
        time_offset: TimeOffset,
        streaming_aggs: bool,
    },
    #[cfg(feature = "enterprise")]
    CancelResponse {
        trace_id: String,
        is_success: bool,
    },
    Error {
        code: u16,
        message: String,
        error_detail: Option<String>,
        trace_id: Option<String>,
        request_id: Option<String>,
        should_client_retry: bool,
    },
    End {
        trace_id: Option<String>,
    },
    EventProgress {
        trace_id: String,
        percent: usize,
        event_type: String,
    },
    Ping(Vec<u8>),
    Pong(Vec<u8>),
}

impl WsServerEvents {
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("Failed to serialize WsServerEvents")
    }

    pub fn error_response(
        err: &errors::Error,
        request_id: Option<String>,
        trace_id: Option<String>,
        should_client_retry: bool,
    ) -> Self {
        match err {
            errors::Error::ErrorCode(code) => {
                let message = code.get_message();
                let error_detail = code.get_error_detail();
                let http_response =
                    map_error_to_http_response(err, trace_id.clone().unwrap_or_default());
                WsServerEvents::Error {
                    code: http_response.status().into(),
                    message,
                    error_detail: Some(error_detail),
                    trace_id: trace_id.clone(),
                    request_id: request_id.clone(),
                    should_client_retry,
                }
            }
            _ => WsServerEvents::Error {
                code: StatusCode::INTERNAL_SERVER_ERROR.into(),
                message: err.to_string(),
                error_detail: None,
                trace_id,
                request_id,
                should_client_retry,
            },
        }
    }

    pub fn get_trace_id(&self) -> String {
        match self {
            Self::SearchResponse { trace_id, .. } => trace_id.to_string(),
            #[cfg(feature = "enterprise")]
            Self::CancelResponse { trace_id, .. } => trace_id.to_string(),
            Self::Error { trace_id, .. } => trace_id.clone().unwrap_or_default(),
            Self::End { trace_id } => trace_id.clone().unwrap_or_default(),
            Self::EventProgress { trace_id, .. } => trace_id.to_string(),
            Self::Ping(_) => "".to_string(),
            Self::Pong(_) => "".to_string(),
        }
    }

    pub fn should_clean_trace_id(&self) -> Option<String> {
        match self {
            #[cfg(feature = "enterprise")]
            Self::CancelResponse {
                trace_id,
                is_success,
            } if *is_success => Some(trace_id.to_owned()),
            Self::Error { trace_id, .. } => trace_id.to_owned(),
            Self::End { trace_id } => trace_id.to_owned(),
            _ => None,
        }
    }
}

impl From<WsClientEvents> for tungstenite::protocol::Message {
    fn from(event: WsClientEvents) -> Self {
        let payload = serde_json::to_value(&event).unwrap_or_default();
        tungstenite::protocol::Message::Text(payload.to_string())
    }
}

impl From<WsServerEvents> for tungstenite::protocol::Message {
    fn from(event: WsServerEvents) -> Self {
        let payload = serde_json::to_value(&event).unwrap_or_default();
        tungstenite::protocol::Message::Text(payload.to_string())
    }
}

impl TryFrom<serde_json::Value> for WsServerEvents {
    type Error = String;

    fn try_from(
        value: serde_json::Value,
    ) -> Result<Self, <Self as TryFrom<serde_json::Value>>::Error> {
        match value["type"].as_str() {
            Some("search_response") => serde_json::from_value(value).map_err(|e| e.to_string()),
            Some("cancel_response") => serde_json::from_value(value).map_err(|e| e.to_string()),
            Some("error") => serde_json::from_value(value).map_err(|e| e.to_string()),
            Some("end") => serde_json::from_value(value).map_err(|e| e.to_string()),
            _ => Err("Unknown message type".to_string()),
        }
    }
}

/// Calculate the progress percentage based on the search type and current partition
pub fn calculate_progress_percentage(
    partition_start_time: i64,
    partition_end_time: i64,
    req_start_time: i64,
    req_end_time: i64,
    partition_order_by: &OrderBy,
) -> usize {
    if req_end_time <= req_start_time {
        return 0;
    }

    let percentage = if *partition_order_by == OrderBy::Desc {
        // For dashboards/histograms partitions processed newest to oldest
        (req_end_time - partition_start_time) as f32 / (req_end_time - req_start_time) as f32
    } else {
        // For regular searches partitions processed oldest to newest
        (partition_end_time - req_start_time) as f32 / (req_end_time - req_start_time) as f32
    };
    if percentage < 0.5 {
        ((percentage * 100.0).ceil() as usize).min(100)
    } else {
        ((percentage * 100.0).floor() as usize).min(100)
    }
}
