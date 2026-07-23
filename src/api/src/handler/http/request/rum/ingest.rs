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
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    common::{
        meta::{
            http::HttpResponse as MetaHttpResponse,
            ingestion::{IngestUser, IngestionRequest},
            middleware_data::RumExtraData,
        },
        utils::auth::UserEmail,
    },
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
        // 202 Accepted: the RUM SDKs treat any non-202 intake response as an unexpected error
        // and drop the batch instead of retrying, so the status must be 202 even though the
        // body still carries `code: 200` from the shared ingestion response.
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
        // 202 Accepted: the RUM SDKs treat any non-202 intake response as an unexpected error
        // and drop the batch instead of retrying, so the status must be 202 even though the
        // body still carries `code: 200` from the shared ingestion response.
        Ok(v) => (StatusCode::ACCEPTED, Json(v)).into_response(),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// Maximum number of `segment` parts accepted in a single replay upload.
const MAX_SEGMENTS: usize = 200;
/// Maximum decompressed size of a single replay segment. Bounds a decompression bomb.
const MAX_DECOMPRESSED_SEGMENT_BYTES: usize = 16 * 1024 * 1024; // 16 MB per segment

/// Parses the `event` part of a session-replay upload.
///
/// The mobile SDKs send a JSON array with one entry per segment; the browser SDK sends a single
/// JSON object. An array is tried first, falling back to a single object.
fn parse_replay_events(event_bytes: &[u8]) -> Result<Vec<Event>, &'static str> {
    if let Ok(events) = json::from_slice::<Vec<Event>>(event_bytes) {
        return Ok(events);
    }
    match json::from_slice::<Event>(event_bytes) {
        Ok(single) => Ok(vec![single]),
        Err(_) => Err("Failed to parse event data"),
    }
}

/// Pairs each zlib-compressed segment with its metadata and builds the NDJSON ingestion body —
/// one `_sessionreplay` row per segment, so they ingest via `IngestionData::Multi`.
///
/// `events` must either hold one entry per segment (mobile) or exactly one entry shared by every
/// segment (browser); any other count is rejected. Each segment is decompressed under a bounded
/// reader so an oversized payload is refused rather than buffered.
fn build_replay_rows(segments: &[Vec<u8>], events: &[Event]) -> Result<Vec<u8>, &'static str> {
    if segments.is_empty() {
        return Err("Missing 'segment' field in multipart form");
    }
    if events.len() != segments.len() && events.len() != 1 {
        return Err("Mismatched 'segment' and 'event' counts in replay upload");
    }

    let mut body_lines: Vec<u8> = Vec::new();
    for (i, seg) in segments.iter().enumerate() {
        let mut buf = Vec::new();
        if ZlibDecoder::new(&seg[..])
            .take((MAX_DECOMPRESSED_SEGMENT_BYTES + 1) as u64)
            .read_to_end(&mut buf)
            .is_err()
        {
            return Err("Failed to decompress the incoming payload");
        }
        if buf.len() > MAX_DECOMPRESSED_SEGMENT_BYTES {
            return Err("Replay segment exceeds the maximum size");
        }
        let segment_payload =
            String::from_utf8(buf).map_err(|_| "Replay segment is not valid UTF-8")?;

        // `events.len()` is either == `segments.len()` or exactly 1 (validated above), so a
        // single shared event fans out across every segment.
        let event = events
            .get(i)
            .or_else(|| events.first())
            .cloned()
            .unwrap_or_default();
        let row = SegmentEventSerde {
            segment: segment_payload,
            event,
        };
        let mut encoded =
            json::to_vec(&row).map_err(|_| "Failed to serialize ingestion payload")?;
        // NDJSON: newline separator BETWEEN rows only (no trailing newline).
        if !body_lines.is_empty() {
            body_lines.push(b'\n');
        }
        body_lines.append(&mut encoded);
    }

    Ok(body_lines)
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
    //   - mobile:  N `segment` parts + one `event` JSON ARRAY (one entry per segment)
    // In both cases the multipart field *name* is always `segment`; the mobile SDK only varies
    // the per-part `filename` (file0..fileN), which is not used for routing here.
    // The gzip `content-encoding` of the mobile body is already handled by
    // RequestDecompressionLayer.
    let mut segments: Vec<Vec<u8>> = Vec::new();
    let mut event_data: Option<Vec<u8>> = None;

    while let Ok(Some(field)) = payload.next_field().await {
        let name = field.name().map(|s| s.to_string());
        match name.as_deref() {
            Some("segment") => {
                if segments.len() >= MAX_SEGMENTS {
                    return MetaHttpResponse::bad_request(
                        "Too many segment parts in replay upload",
                    );
                }
                match field.bytes().await {
                    Ok(data) => segments.push(data.to_vec()),
                    // Surface the read failure rather than dropping the part, which would
                    // otherwise resurface later as a confusing segment/event count mismatch.
                    Err(_) => {
                        return MetaHttpResponse::bad_request("Failed to read 'segment' field");
                    }
                }
            }
            Some("event") => match field.bytes().await {
                Ok(data) => event_data = Some(data.to_vec()),
                Err(_) => return MetaHttpResponse::bad_request("Failed to read 'event' field"),
            },
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

    let events = match parse_replay_events(&event_bytes) {
        Ok(events) => events,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };
    let body_lines = match build_replay_rows(&segments, &events) {
        Ok(body) => body,
        Err(e) => return MetaHttpResponse::bad_request(e),
    };

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
        // 202 Accepted: the RUM SDKs treat any non-202 intake response as an unexpected error
        // and drop the batch instead of retrying, so the status must be 202 even though the
        // body still carries `code: 200` from the shared ingestion response.
        Ok(v) => (StatusCode::ACCEPTED, Json(v)).into_response(),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

#[cfg(test)]
mod tests {
    use flate2::{Compression, write::ZlibEncoder};

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
        // Browser replay sends a single event object. `parse_replay_events` tries an array
        // first, then falls back to a single object — this asserts that fallback path.
        let browser = br#"{"application":{"id":"app"},"session":{"id":"s"},"view":{"id":"v"},
            "start":1,"end":2,"creation_reason":"init","records_count":3,"has_full_snapshot":true,
            "index_in_view":0,"source":"browser","raw_segment_size":100,"compressed_segment_size":50}"#;

        let events = parse_replay_events(browser).expect("browser object parses");

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].source, "browser");
        assert_eq!(events[0].creation_reason, "init");
        assert_eq!(events[0].records_count, 3);
    }

    #[test]
    fn parse_replay_events_rejects_malformed_json() {
        assert_eq!(
            parse_replay_events(b"not json"),
            Err("Failed to parse event data")
        );
    }

    // ----- build_replay_rows -----

    fn zlib_compress(data: &[u8]) -> Vec<u8> {
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).expect("compress writes");
        encoder.finish().expect("compress finishes")
    }

    fn event_with_source(source: &str) -> Event {
        Event {
            source: source.to_string(),
            ..Default::default()
        }
    }

    /// Decodes an NDJSON body back into the rows it encodes.
    fn decode_rows(body: &[u8]) -> Vec<SegmentEventSerde> {
        std::str::from_utf8(body)
            .expect("body is utf-8")
            .split('\n')
            .map(|line| serde_json::from_str(line).expect("row parses"))
            .collect()
    }

    #[test]
    fn build_replay_rows_emits_one_row_per_segment_paired_in_order() {
        // Mobile: N segments + N events, paired by index.
        let segments = vec![zlib_compress(b"seg-one"), zlib_compress(b"seg-two")];
        let events = vec![event_with_source("first"), event_with_source("second")];

        let body = build_replay_rows(&segments, &events).expect("rows build");

        let rows = decode_rows(&body);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].segment, "seg-one");
        assert_eq!(rows[0].event.source, "first");
        assert_eq!(rows[1].segment, "seg-two");
        assert_eq!(rows[1].event.source, "second");
    }

    #[test]
    fn build_replay_rows_separates_rows_without_a_trailing_newline() {
        let segments = vec![zlib_compress(b"a"), zlib_compress(b"b")];
        let events = vec![event_with_source("x"), event_with_source("y")];

        let body = build_replay_rows(&segments, &events).expect("rows build");

        assert_eq!(body.iter().filter(|b| **b == b'\n').count(), 1);
        assert_ne!(body.last(), Some(&b'\n'));
    }

    #[test]
    fn build_replay_rows_fans_a_single_shared_event_across_every_segment() {
        // Browser: one event object shared by every segment.
        let segments = vec![
            zlib_compress(b"one"),
            zlib_compress(b"two"),
            zlib_compress(b"three"),
        ];
        let events = vec![event_with_source("browser")];

        let body = build_replay_rows(&segments, &events).expect("rows build");

        let rows = decode_rows(&body);
        assert_eq!(rows.len(), 3);
        assert!(rows.iter().all(|r| r.event.source == "browser"));
        assert_eq!(rows[2].segment, "three");
    }

    #[test]
    fn build_replay_rows_preserves_a_segments_trailing_newline() {
        // The mobile SDK appends "\n" to each segment before compressing. It must survive as
        // escaped JSON inside the row rather than splitting the NDJSON body.
        let segments = vec![zlib_compress(b"{\"records\":[]}\n")];
        let events = vec![event_with_source("react-native")];

        let body = build_replay_rows(&segments, &events).expect("rows build");

        let rows = decode_rows(&body);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].segment, "{\"records\":[]}\n");
    }

    #[test]
    fn build_replay_rows_rejects_mismatched_segment_and_event_counts() {
        let segments = vec![
            zlib_compress(b"a"),
            zlib_compress(b"b"),
            zlib_compress(b"c"),
        ];
        let events = vec![event_with_source("x"), event_with_source("y")];

        assert_eq!(
            build_replay_rows(&segments, &events),
            Err("Mismatched 'segment' and 'event' counts in replay upload")
        );
    }

    #[test]
    fn build_replay_rows_rejects_an_empty_segment_list() {
        assert_eq!(
            build_replay_rows(&[], &[event_with_source("x")]),
            Err("Missing 'segment' field in multipart form")
        );
    }

    #[test]
    fn build_replay_rows_rejects_a_segment_that_is_not_valid_zlib() {
        let segments = vec![b"this is not zlib data".to_vec()];

        assert_eq!(
            build_replay_rows(&segments, &[event_with_source("x")]),
            Err("Failed to decompress the incoming payload")
        );
    }

    #[test]
    fn build_replay_rows_rejects_a_segment_exceeding_the_decompressed_size_cap() {
        // A decompression bomb: highly compressible input that expands past the cap.
        let oversized = vec![b'a'; MAX_DECOMPRESSED_SEGMENT_BYTES + 1];
        let segments = vec![zlib_compress(&oversized)];

        assert_eq!(
            build_replay_rows(&segments, &[event_with_source("x")]),
            Err("Replay segment exceeds the maximum size")
        );
    }

    #[test]
    fn build_replay_rows_accepts_a_segment_exactly_at_the_size_cap() {
        // Boundary: the cap itself must pass, only one byte beyond it fails.
        let at_cap = vec![b'a'; MAX_DECOMPRESSED_SEGMENT_BYTES];
        let segments = vec![zlib_compress(&at_cap)];

        let body = build_replay_rows(&segments, &[event_with_source("x")]).expect("rows build");

        assert_eq!(
            decode_rows(&body)[0].segment.len(),
            MAX_DECOMPRESSED_SEGMENT_BYTES
        );
    }

    #[test]
    fn build_replay_rows_rejects_a_segment_that_is_not_valid_utf8() {
        let segments = vec![zlib_compress(&[0xff, 0xfe, 0xfd])];

        assert_eq!(
            build_replay_rows(&segments, &[event_with_source("x")]),
            Err("Replay segment is not valid UTF-8")
        );
    }
}
