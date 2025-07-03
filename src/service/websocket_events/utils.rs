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
    search::TimeOffset,
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
                let http_response = map_error_to_http_response(err, trace_id.clone());
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
