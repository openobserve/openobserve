// Copyright 2026 OpenObserve Inc.
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

use std::io::prelude::*;

use axum::{
    Extension, Json,
    body::Bytes,
    extract::{Multipart, Path},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::utils::json;
use flate2::read::ZlibDecoder;
use openobserve_core::{
    auth::UserEmail,
    ingestion_types::{IngestUser, IngestionRequest},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    common::meta::{http::HttpResponse as MetaHttpResponse, middleware_data::RumExtraData},
    handler::http::extractors::Headers,
    service::logs,
};

pub const RUM_LOG_STREAM: &str = "_rumlog";
pub const RUM_SESSION_REPLAY_STREAM: &str = "_sessionreplay";
pub const RUM_DATA_STREAM: &str = "_rumdata";

/// Multipart form data being ingested in the form of session-replay
#[derive(ToSchema)]
pub struct SegmentEvent {
    #[schema(value_type = String, format = Binary)]
    pub segment: Vec<u8>,
    #[schema(value_type = String, format = Binary)]
    pub event: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
pub struct SegmentEventSerde {
    pub segment: String,
    #[serde(flatten)]
    pub event: Event,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
// `default` so both formats parse: mobile replay events omit `creation_reason` and
// `index_in_view` that the browser format includes.
#[serde(rename_all = "camelCase", default)]
pub struct Event {
    #[serde(rename = "raw_segment_size")]
    pub raw_segment_size: i64,
    #[serde(rename = "compressed_segment_size")]
    pub compressed_segment_size: i64,
    pub start: i64,
    pub end: i64,
    #[serde(rename = "creation_reason")]
    pub creation_reason: String,
    #[serde(rename = "records_count")]
    pub records_count: i64,
    #[serde(rename = "has_full_snapshot")]
    pub has_full_snapshot: bool,
    #[serde(rename = "index_in_view")]
    pub index_in_view: i64,
    pub source: String,
    pub application: Application,
    pub session: Session,
    pub view: View,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Application {
    pub id: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
}

#[derive(Default, Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: String,
}

/// Rum data ingestion API
#[utoipa::path(
    post,
    path = "/v1/{org_id}/rum",
    context_path = "/rum",
    tag = "Rum",
    operation_id = "RumIngestionMulti",
    summary = "Ingest RUM data events",
    description = "Ingests Real User Monitoring (RUM) data events in JSON format. Collects client-side performance \
                   metrics, user interactions, application errors, and user experience data for comprehensive web \
                   application monitoring. Data is automatically enriched with metadata and stored for analysis \
                   and dashboard visualization.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(content = String, description = "Ingest data (multiple line json)", content_type = "application/json"),
    responses(
        (status = 202, description = "Accepted", content_type = "application/json", body = Object, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn data(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Extension(rum_query_data): Extension<RumExtraData>,
    body: Bytes,
) -> Response {
    let extend_json = &rum_query_data.data;
    let user_email = &user_email.user_id;
    match logs::ingest::ingest(
        0,
        &org_id,
        RUM_DATA_STREAM,
        IngestionRequest::RUM(body),
        IngestUser::from_user_email(user_email.clone()),
        Some(extend_json),
        false,
    )
    .await
    {
        // 202 Accepted — the Datadog-family SDKs drop the batch on any non-202 (doc 02 §5.1).
        Ok(v) => (StatusCode::ACCEPTED, Json(v)).into_response(),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// Rum log ingestion API
#[utoipa::path(
    post,
    path = "/v1/{org_id}/logs",
    context_path = "/rum",
    tag = "Rum",
    operation_id = "LogIngestionJson",
    summary = "Ingest RUM log events",
    description = "Ingests Real User Monitoring (RUM) log events and client-side application logs in JSON array format. \
                   Captures browser console logs, application errors, debug information, and custom log messages \
                   generated by client-side JavaScript. Logs are enriched with browser and session context for \
                   comprehensive client-side debugging and monitoring.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(content = String, description = "Ingest data (json array)", content_type = "application/json", example = json!([{"Year": 1896, "City": "Athens", "Sport": "Aquatics", "Discipline": "Swimming", "Athlete": "Alfred", "Country": "HUN"},{"Year": 1896, "City": "Athens", "Sport": "Aquatics", "Discipline": "Swimming", "Athlete": "HERSCHMANN", "Country":"CHN"}])),
    responses(
        (status = 202, description = "Accepted", content_type = "application/json", body = Object, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn log(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Extension(rum_query_data): Extension<RumExtraData>,
    body: Bytes,
) -> Response {
    let extend_json = &rum_query_data.data;
    let user_email = &user_email.user_id;
    match logs::ingest::ingest(
        0,
        &org_id,
        RUM_LOG_STREAM,
        IngestionRequest::RUM(body),
        IngestUser::from_user_email(user_email.clone()),
        Some(extend_json),
        false,
    )
    .await
    {
        // 202 Accepted — the Datadog-family SDKs drop the batch on any non-202 (doc 02 §5.1).
        Ok(v) => (StatusCode::ACCEPTED, Json(v)).into_response(),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// Rum session-replay ingestion API
#[utoipa::path(
    post,
    path = "/v1/{org_id}/replay",
    context_path = "/rum",
    tag = "Rum",
    operation_id = "ReplayIngestionJson",
    summary = "Ingest session replay data",
    description = "Ingests Real User Monitoring (RUM) session replay data as compressed multipart form data. Captures \
                   user interactions, DOM snapshots, and browser events to enable complete session replay functionality. \
                   Data is compressed using zlib compression and includes session metadata such as timing, view \
                   information, and interaction sequences for comprehensive user experience analysis.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(
        content = inline(SegmentEvent), content_type = "multipart/form-data",
        description = "Multipart form data containing compressed session replay segment and event metadata"),
    responses(
        (status = 202, description = "Accepted", content_type = "application/json",
            body = Object, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]}),
    ),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn sessionreplay(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Extension(rum_query_data): Extension<RumExtraData>,
    mut payload: Multipart,
) -> Response {
    // Session replay uploads differ by SDK:
    //   - browser: one `segment` part + one `event` object
    //   - mobile:  N `segment` parts (file0..fileN) + one `event` JSON ARRAY (one per segment)
    // Both are handled here: collect every `segment` part and the single `event` part, then
    // pair each segment with its metadata and ingest one `_sessionreplay` row per segment.
    // The gzip `content-encoding` of the mobile body is already handled by RequestDecompressionLayer.

    // Guards against a decompression bomb / oversized upload.
    const MAX_SEGMENTS: usize = 200;
    const MAX_DECOMPRESSED_SEGMENT_BYTES: usize = 16 * 1024 * 1024; // 16 MB per segment

    let mut segments: Vec<Vec<u8>> = Vec::new();
    let mut event_data: Option<Vec<u8>> = None;

    while let Ok(Some(field)) = payload.next_field().await {
        let name = field.name().map(|s| s.to_string());
        match name.as_deref() {
            Some("segment") => {
                if segments.len() >= MAX_SEGMENTS {
                    return MetaHttpResponse::bad_request("Too many segment parts in replay upload");
                }
                if let Ok(data) = field.bytes().await {
                    segments.push(data.to_vec());
                }
            }
            Some("event") => {
                if let Ok(data) = field.bytes().await {
                    event_data = Some(data.to_vec());
                }
            }
            _ => {}
        }
    }

    if segments.is_empty() {
        return MetaHttpResponse::bad_request("Missing 'segment' field in multipart form");
    }
    let event_bytes = match event_data {
        Some(data) => data,
        None => {
            return MetaHttpResponse::bad_request("Missing 'event' field in multipart form");
        }
    };

    // Event metadata: mobile sends a JSON array (one per segment); browser sends a single object.
    let events: Vec<Event> = match json::from_slice::<Vec<Event>>(&event_bytes[..]) {
        Ok(arr) => arr,
        Err(_) => match json::from_slice::<Event>(&event_bytes[..]) {
            Ok(single) => vec![single],
            Err(_) => return MetaHttpResponse::bad_request("Failed to parse event data"),
        },
    };

    // Pair each segment with its metadata. Equal counts (mobile) or a single shared event.
    if events.len() != segments.len() && events.len() != 1 {
        return MetaHttpResponse::bad_request(
            "Mismatched 'segment' and 'event' counts in replay upload",
        );
    }

    // Decompress each segment (zlib, bounded) and build one NDJSON row per segment so they
    // ingest as multiple `_sessionreplay` records via `IngestionData::Multi`.
    let mut body_lines: Vec<u8> = Vec::new();
    for (i, seg) in segments.iter().enumerate() {
        let mut buf = Vec::new();
        if ZlibDecoder::new(&seg[..])
            .take((MAX_DECOMPRESSED_SEGMENT_BYTES + 1) as u64)
            .read_to_end(&mut buf)
            .is_err()
        {
            return MetaHttpResponse::bad_request("Failed to decompress the incoming payload");
        }
        if buf.len() > MAX_DECOMPRESSED_SEGMENT_BYTES {
            return MetaHttpResponse::bad_request("Replay segment exceeds the maximum size");
        }
        let segment_payload = match String::from_utf8(buf) {
            Ok(s) => s,
            Err(_) => return MetaHttpResponse::bad_request("Replay segment is not valid UTF-8"),
        };

        // events.len() is either == segments.len() or exactly 1 (validated above).
        let event = events.get(i).or_else(|| events.first()).cloned().unwrap_or_default();
        let row = SegmentEventSerde {
            segment: segment_payload,
            event,
        };
        match json::to_vec(&row) {
            Ok(mut b) => {
                // NDJSON: newline separator BETWEEN rows only (no trailing newline).
                if !body_lines.is_empty() {
                    body_lines.push(b'\n');
                }
                body_lines.append(&mut b);
            }
            Err(_) => {
                return MetaHttpResponse::bad_request("Failed to serialize ingestion payload");
            }
        }
    }

    let extend_json = &rum_query_data.data;
    let user_email = &user_email.user_id;
    match logs::ingest::ingest(
        0,
        &org_id,
        RUM_SESSION_REPLAY_STREAM,
        IngestionRequest::RUM(body_lines.into()),
        IngestUser::from_user_email(user_email.clone()),
        Some(extend_json),
        false,
    )
    .await
    {
        // 202 Accepted: the Datadog-family SDKs treat any non-202 as an unexpected error and
        // drop the batch (see doc 02 §5.1). The data is still ingested; 202 makes retry/queue
        // semantics correct for both browser and mobile clients.
        Ok(v) => (StatusCode::ACCEPTED, Json(v)).into_response(),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rum_stream_constants() {
        assert_eq!(RUM_LOG_STREAM, "_rumlog");
        assert_eq!(RUM_SESSION_REPLAY_STREAM, "_sessionreplay");
        assert_eq!(RUM_DATA_STREAM, "_rumdata");
    }

    #[test]
    fn test_event_default_values() {
        let e = Event::default();
        assert_eq!(e.raw_segment_size, 0);
        assert_eq!(e.compressed_segment_size, 0);
        assert_eq!(e.start, 0);
        assert_eq!(e.end, 0);
        assert!(e.creation_reason.is_empty());
        assert_eq!(e.records_count, 0);
        assert!(!e.has_full_snapshot);
        assert_eq!(e.index_in_view, 0);
        assert!(e.source.is_empty());
    }

    #[test]
    fn test_application_session_view_defaults() {
        let app = Application::default();
        let sess = Session::default();
        let view = View::default();
        assert!(app.id.is_empty());
        assert!(sess.id.is_empty());
        assert!(view.id.is_empty());
    }

    #[test]
    fn test_event_serde_roundtrip() {
        let e = Event {
            raw_segment_size: 100,
            compressed_segment_size: 50,
            start: 1000,
            end: 2000,
            creation_reason: "end".to_string(),
            records_count: 5,
            has_full_snapshot: true,
            index_in_view: 3,
            source: "browser".to_string(),
            application: Application {
                id: "app-1".to_string(),
            },
            session: Session {
                id: "sess-1".to_string(),
            },
            view: View {
                id: "view-1".to_string(),
            },
        };
        let json = serde_json::to_string(&e).unwrap();
        let back: Event = serde_json::from_str(&json).unwrap();
        assert_eq!(back.raw_segment_size, 100);
        assert_eq!(back.compressed_segment_size, 50);
        assert_eq!(back.records_count, 5);
        assert!(back.has_full_snapshot);
        assert_eq!(back.application.id, "app-1");
        assert_eq!(back.session.id, "sess-1");
        assert_eq!(back.view.id, "view-1");
    }

    #[test]
    fn test_segment_event_serde_construction() {
        let e = Event::default();
        let s = SegmentEventSerde {
            segment: "abc".to_string(),
            event: e.clone(),
        };
        assert_eq!(s.segment, "abc");
        assert_eq!(s.event, e);
    }

    #[test]
    fn test_event_equality() {
        let e1 = Event::default();
        let e2 = Event::default();
        assert_eq!(e1, e2);
    }

    #[test]
    fn parses_mobile_event_array_with_missing_fields() {
        // Mobile replay sends an ARRAY of events (one per segment) and omits
        // `creation_reason` / `index_in_view` that the browser format includes.
        let mobile = br#"[
            {"application":{"id":"app"},"session":{"id":"s"},"view":{"id":"v"},
             "start":1,"end":2,"records_count":1,"has_full_snapshot":false,
             "source":"react-native","records":[],"compressed_segment_size":212,"raw_segment_size":312},
            {"application":{"id":"app"},"session":{"id":"s"},"view":{"id":"v"},
             "start":3,"end":4,"records_count":2,"has_full_snapshot":true,
             "source":"react-native","compressed_segment_size":100,"raw_segment_size":400}
        ]"#;
        let events: Vec<Event> = serde_json::from_slice(mobile).expect("mobile array parses");
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].source, "react-native");
        assert_eq!(events[0].raw_segment_size, 312);
        assert_eq!(events[0].creation_reason, ""); // defaulted (serde default)
        assert_eq!(events[0].index_in_view, 0); // defaulted
        assert!(events[1].has_full_snapshot);
    }

    #[test]
    fn parses_browser_event_object_via_array_then_single_fallback() {
        // Browser replay sends a single event object. The handler tries an array first,
        // then falls back to a single object — this asserts that fallback path.
        let browser = br#"{"application":{"id":"app"},"session":{"id":"s"},"view":{"id":"v"},
            "start":1,"end":2,"creation_reason":"init","records_count":3,"has_full_snapshot":true,
            "index_in_view":0,"source":"browser","raw_segment_size":100,"compressed_segment_size":50}"#;
        let events: Vec<Event> = match serde_json::from_slice::<Vec<Event>>(browser) {
            Ok(arr) => arr,
            Err(_) => {
                vec![serde_json::from_slice::<Event>(browser).expect("browser object parses")]
            }
        };
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].source, "browser");
        assert_eq!(events[0].creation_reason, "init");
        assert_eq!(events[0].records_count, 3);
    }
}
