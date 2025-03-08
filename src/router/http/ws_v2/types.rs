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

use chrono::{DateTime, Utc};
use config::meta::websocket::SearchEventReq;
use serde::{Deserialize, Serialize};
use tokio_tungstenite::tungstenite;

use crate::service::websocket_events::{TimeOffset, WsClientEvents, WsServerEvents};

pub type SessionId = String;
pub type ClientId = String;
pub type QuerierName = String;
pub type TraceId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamMessage {
    pub trace_id: String,
    pub message_type: StreamMessageType,
    pub payload: serde_json::Value,
    #[serde(skip)]
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamMessageType {
    Search(Box<SearchEventReq>),
    #[cfg(feature = "enterprise")]
    Cancel,
    Benchmark,
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
    },
    End {
        trace_id: Option<String>,
    },
}

impl StreamMessage {
    pub fn new(
        trace_id: String,
        message_type: StreamMessageType,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            trace_id,
            message_type,
            payload,
            timestamp: Utc::now().timestamp_micros(),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }
}

impl From<WsClientEvents> for StreamMessage {
    fn from(event: WsClientEvents) -> Self {
        match event {
            WsClientEvents::Search(req) => {
                let trace_id = req.trace_id.clone();
                let payload = serde_json::to_value(&req).unwrap_or_default();
                Self::new(trace_id, StreamMessageType::Search(req), payload)
            }
            #[cfg(feature = "enterprise")]
            WsClientEvents::Cancel { trace_id, org_id } => {
                let payload: serde_json::Value = if let Some(org_id) = org_id {
                    serde_json::json!({"trace_id": trace_id, "org_id": org_id})
                } else {
                    serde_json::json!({"trace_id": trace_id})
                };
                Self::new(trace_id, StreamMessageType::Cancel, payload)
            }
            WsClientEvents::Benchmark { id } => Self::new(
                id.clone(),
                StreamMessageType::Benchmark,
                serde_json::json!({"id": id}),
            ),
        }
    }
}

impl From<WsServerEvents> for StreamMessage {
    fn from(event: WsServerEvents) -> Self {
        match event {
            WsServerEvents::SearchResponse {
                trace_id,
                results,
                time_offset,
                streaming_aggs,
            } => {
                let payload = serde_json::to_value(&results).unwrap_or_default();
                Self::new(
                    trace_id.clone(),
                    StreamMessageType::SearchResponse {
                        trace_id,
                        results,
                        time_offset,
                        streaming_aggs,
                    },
                    payload,
                )
            }
            #[cfg(feature = "enterprise")]
            WsServerEvents::CancelResponse {
                trace_id,
                is_success,
            } => {
                let payload = serde_json::json!({"trace_id": trace_id, "is_success": is_success});
                Self::new(
                    trace_id.clone(),
                    StreamMessageType::CancelResponse {
                        trace_id,
                        is_success,
                    },
                    payload,
                )
            }
            WsServerEvents::Error {
                code,
                message,
                error_detail,
                trace_id,
                request_id,
            } => {
                let trace_id = trace_id.unwrap_or_default();
                let payload = serde_json::json!({"code": code, "message": message, "error_detail": error_detail, "trace_id": trace_id, "request_id": request_id});
                Self::new(
                    trace_id.clone(),
                    StreamMessageType::Error {
                        code,
                        message,
                        error_detail,
                        trace_id: Some(trace_id),
                        request_id,
                    },
                    payload,
                )
            }
            WsServerEvents::End { trace_id } => {
                let trace_id = trace_id.unwrap_or_default();
                let payload = serde_json::json!({"trace_id": trace_id.clone()});
                Self::new(
                    trace_id.clone(),
                    StreamMessageType::End {
                        trace_id: Some(trace_id),
                    },
                    payload,
                )
            }
        }
    }
}

impl TryFrom<tungstenite::protocol::Message> for StreamMessage {
    type Error = String;

    fn try_from(value: tungstenite::protocol::Message) -> Result<Self, Self::Error> {
        match value {
            tungstenite::protocol::Message::Text(text) => {
                let payload =
                    serde_json::from_str::<serde_json::Value>(&text).map_err(|e| e.to_string())?;
                let event: WsServerEvents = payload.try_into()?;
                Ok(Self::from(event))
            }
            _ => {
                todo!("Convert `tungstenite::protocol::Message` to `StreamMessage`")
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct ErrorPayload {
    code: u16,
    message: String,
    error_detail: Option<String>,
    trace_id: Option<String>,
    request_id: Option<String>,
}
