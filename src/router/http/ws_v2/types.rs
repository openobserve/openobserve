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
    pub timestamp: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamMessageType {
    Search(Box<SearchEventReq>),
    SearchResponse,
    #[cfg(feature = "enterprise")]
    Cancel,
    #[cfg(feature = "enterprise")]
    CancelResponse,
    Error,
    End,
    Benchmark,
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
            timestamp: Utc::now(),
        }
    }

    pub fn from_client_event(event: WsClientEvents) -> Self {
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

    pub fn to_server_event(&self) -> Option<WsServerEvents> {
        match self.message_type {
            StreamMessageType::SearchResponse => {
                let response: Box<config::meta::search::Response> =
                    serde_json::from_value(self.payload.clone()).ok()?;
                Some(WsServerEvents::SearchResponse {
                    trace_id: self.trace_id.clone(),
                    results: response,
                    time_offset: TimeOffset {
                        start_time: 0,
                        end_time: 0,
                    },
                    streaming_aggs: false,
                })
            }
            StreamMessageType::Error => {
                let error: ErrorPayload = serde_json::from_value(self.payload.clone()).ok()?;
                Some(WsServerEvents::Error {
                    code: error.code,
                    message: error.message,
                    error_detail: error.error_detail,
                    trace_id: Some(self.trace_id.clone()),
                    request_id: None,
                })
            }
            StreamMessageType::End => Some(WsServerEvents::End {
                trace_id: Some(self.trace_id.clone()),
            }),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct ErrorPayload {
    code: u16,
    message: String,
    error_detail: Option<String>,
}
