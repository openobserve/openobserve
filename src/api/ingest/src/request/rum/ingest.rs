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

use std::{collections::BTreeMap, io::prelude::*};

use axum::{
    Extension,
    body::Bytes,
    extract::{Multipart, Path},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{
    get_config,
    meta::stream::{RUM_REPLAY_RESOURCE_PREFIX, StreamType},
    utils::json,
};
use flate2::read::ZlibDecoder;
use futures::{StreamExt, TryStreamExt};
use infra::errors::Error;
use ingestion_common::{IngestUser, IngestionRequest};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{auth::UserEmail, ingestion::check_ingestion_allowed};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    common::meta::{http::HttpResponse as MetaHttpResponse, middleware_data::RumExtraData},
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

/// Binary image body of a replay resource download
#[derive(ToSchema)]
#[schema(value_type = String, format = Binary)]
#[allow(dead_code)]
struct ResourceImageBytes(Vec<u8>);

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
    description = "Ingests Real User Monitoring (RUM) data events as NDJSON, one JSON object per line. Collects \
                   client-side performance metrics, user interactions, application errors, and user experience data \
                   for comprehensive web application monitoring. Data is automatically enriched with metadata and \
                   stored for analysis and dashboard visualization.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(content = String, description = "Ingest data (NDJSON, one JSON object per line)", content_type = "text/plain", example = json!("{\"type\":\"view\",\"date\":1759222800000,\"view\":{\"url\":\"https://example.com/\"}}\n{\"type\":\"error\",\"date\":1759222801000,\"error\":{\"message\":\"Script error\"}}")),
    responses(
        (status = 202, description = "Accepted, empty body"),
        (status = 400, description = "Bad request: a line is not valid JSON or is not a JSON object", content_type = "application/json", body = Object, example = json!({"code": 400, "message": "Error# Failed processing: each line must be a JSON object"})),
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
        // and drop the batch instead of retrying, so the status must be 202. The body is empty:
        // the SDKs read only the status, and the shared ingestion response would show every
        // browser the internal stream names and counts.
        Ok(_) => StatusCode::ACCEPTED.into_response(),
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
    description = "Ingests Real User Monitoring (RUM) log events and client-side application logs as NDJSON, one \
                   JSON object per line, or as a single JSON array of objects (the format the native mobile SDKs send). Captures browser console logs, \
                   application errors, debug information, and custom log messages generated by client-side \
                   JavaScript. Logs are enriched with browser and session context for comprehensive \
                   client-side debugging and monitoring.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    request_body(content = String, description = "Ingest data (NDJSON, one JSON object per line, or a single JSON array of objects). An array must be the whole body with no trailing lines; an empty array is accepted with no records.", content_type = "text/plain", example = json!("{\"date\":1759222800000,\"status\":\"error\",\"message\":\"Uncaught TypeError\"}\n{\"date\":1759222801000,\"status\":\"info\",\"message\":\"Page loaded\"}")),
    responses(
        (status = 202, description = "Accepted, empty body"),
        (status = 400, description = "Bad request: a line is not valid JSON, or a line or array element is not a JSON object", content_type = "application/json", body = Object, example = json!({"code": 400, "message": "Error# Failed processing: each line must be a JSON object"})),
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
    let body = match normalize_logs_body(body) {
        Ok(body) => body,
        Err(e) => {
            log::error!("[RUM:LOGS] IngestionError: org_id: {org_id}, error: {e}");
            return MetaHttpResponse::bad_request(e);
        }
    };
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
        // and drop the batch instead of retrying, so the status must be 202. The body is empty:
        // the SDKs read only the status, and the shared ingestion response would show every
        // browser the internal stream names and counts.
        Ok(_) => StatusCode::ACCEPTED.into_response(),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// Maximum number of `segment` parts accepted in a single replay upload.
const MAX_SEGMENTS: usize = 200;
/// Maximum decompressed size of a single replay segment. Bounds a decompression bomb.
const MAX_DECOMPRESSED_SEGMENT_BYTES: usize = 16 * 1024 * 1024; // 16 MB per segment
/// Maximum size of a single replay resource image; the mobile SDK allows 10 MB per item.
const MAX_RESOURCE_IMAGE_BYTES: usize = 10 * 1024 * 1024;
/// Maximum `image` parts per replay resource upload; the mobile SDK batches up to 500 items.
const MAX_RESOURCE_IMAGES: usize = 500;
const MAX_APP_ID_BYTES: usize = 256;
const REPLAY_RESOURCE_ACCOUNT: &str = "default";

/// The parts of a replay multipart upload this handler routes on.
#[derive(Default)]
struct ReplayUpload {
    segments: Vec<Vec<u8>>,
    images: Vec<(String, Bytes)>,
    dropped_images: usize,
    event: Option<Vec<u8>>,
}

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

/// The app id is untrusted path input, so a resource event with a bad one is an `Err`.
fn parse_resource_event(event_bytes: &[u8]) -> Result<Option<String>, &'static str> {
    let Ok(value) = json::from_slice::<json::Value>(event_bytes) else {
        return Ok(None);
    };
    if value.get("type").and_then(|t| t.as_str()) != Some("resource") {
        return Ok(None);
    }
    let app_id = value
        .get("application")
        .and_then(|a| a.get("id"))
        .and_then(|id| id.as_str())
        .unwrap_or_default();
    validate_app_id(app_id)?;
    Ok(Some(app_id.to_string()))
}

/// Any non-empty app id is accepted; `replay_resource_key` encodes it into a safe path segment.
fn validate_app_id(app_id: &str) -> Result<(), &'static str> {
    if !app_id.is_empty() && app_id.len() <= MAX_APP_ID_BYTES && !app_id.contains('\0') {
        Ok(())
    } else {
        Err("Invalid application id in replay resource upload")
    }
}

/// A resource id is the 32-hex MD5 of the image.
fn validate_resource_id(resource_id: &str) -> Result<(), &'static str> {
    if resource_id.len() == 32 && resource_id.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("Invalid resource id: expected 32 hex characters")
    }
}

/// Detects the image type from leading magic bytes only; the client-sent type is never trusted.
fn detect_image_type(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// Escapes bytes outside `[A-Za-z0-9-]` as `_xx`, so a key never holds `%` or `.`.
fn encode_key_segment(id: &str) -> String {
    let mut out = String::with_capacity(id.len());
    for b in id.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' {
            out.push(b as char);
        } else {
            out.push_str(&format!("_{b:02x}"));
        }
    }
    out
}

/// Callers validate the ids first; lowercasing the resource id keeps one object per image.
fn replay_resource_key(org_id: &str, app_id: &str, resource_id: &str) -> String {
    let app_id = encode_key_segment(app_id);
    let resource_id = resource_id.to_ascii_lowercase();
    format!("{RUM_REPLAY_RESOURCE_PREFIX}/{org_id}/{app_id}/{resource_id}")
}

/// Why a resource image is not storable; the size check runs before any hashing.
fn resource_image_problem(resource_id: &str, data: &[u8]) -> Option<&'static str> {
    if data.len() > MAX_RESOURCE_IMAGE_BYTES {
        Some("image exceeds the maximum size")
    } else if detect_image_type(data).is_none() {
        Some("image type is not allowed")
    } else if validate_resource_id(resource_id).is_err() {
        Some("resource id is not 32 hex characters")
    } else if !format!("{:x}", md5::compute(data)).eq_ignore_ascii_case(resource_id) {
        Some("resource id does not match the image MD5")
    } else {
        None
    }
}

/// Keeps the storable images of an upload and counts the skipped ones per reason.
fn select_valid_images(
    images: Vec<(String, Bytes)>,
) -> (Vec<(String, Bytes)>, BTreeMap<&'static str, usize>) {
    let mut reasons = BTreeMap::new();
    let valid: Vec<_> = images
        .into_iter()
        .filter(
            |(resource_id, data)| match resource_image_problem(resource_id, data) {
                Some(reason) => {
                    *reasons.entry(reason).or_insert(0) += 1;
                    false
                }
                None => true,
            },
        )
        .collect();
    (valid, reasons)
}

/// Reads the `segment`, `image` and `event` parts; any other part is ignored.
async fn read_replay_upload(payload: &mut Multipart) -> Result<ReplayUpload, Response> {
    let mut upload = ReplayUpload::default();
    while let Ok(Some(field)) = payload.next_field().await {
        let name = field.name().map(|s| s.to_string());
        match name.as_deref() {
            Some("segment") => {
                if upload.segments.len() >= MAX_SEGMENTS {
                    return Err(MetaHttpResponse::bad_request(
                        "Too many segment parts in replay upload",
                    ));
                }
                match field.bytes().await {
                    Ok(data) => upload.segments.push(data.to_vec()),
                    // A dropped part would resurface later as a confusing count mismatch.
                    Err(_) => {
                        return Err(MetaHttpResponse::bad_request(
                            "Failed to read 'segment' field",
                        ));
                    }
                }
            }
            Some("image") => {
                if upload.images.len() >= MAX_RESOURCE_IMAGES {
                    upload.dropped_images += 1;
                    continue;
                }
                // The part filename is the image's resource id.
                let resource_id = field.file_name().unwrap_or_default().to_string();
                match field.bytes().await {
                    Ok(data) => upload.images.push((resource_id, data)),
                    Err(_) => upload.dropped_images += 1,
                }
            }
            Some("event") => match field.bytes().await {
                Ok(data) => upload.event = Some(data.to_vec()),
                Err(_) => {
                    return Err(MetaHttpResponse::bad_request(
                        "Failed to read 'event' field",
                    ));
                }
            },
            _ => {}
        }
    }
    Ok(upload)
}

/// Segments always win, so a segment upload never takes the resource path whatever its event type.
fn resource_app_id(upload: &ReplayUpload) -> Result<Option<String>, &'static str> {
    match &upload.event {
        Some(event_bytes) if upload.segments.is_empty() => parse_resource_event(event_bytes),
        _ => Ok(None),
    }
}

/// Skips each bad image instead of failing the batch because the SDK never retries a 4xx.
async fn store_resource_upload(org_id: &str, app_id: &str, upload: ReplayUpload) -> Response {
    if let Err(e) = check_ingestion_allowed(org_id, StreamType::Logs, None).await {
        return crate::request::ingestion_not_allowed_response(e);
    }
    if upload.images.is_empty() {
        return MetaHttpResponse::bad_request("Missing 'image' field in replay resource upload");
    }
    let (images, reasons) = select_valid_images(upload.images);
    let skipped: usize = reasons.values().sum();
    if skipped > 0 || upload.dropped_images > 0 {
        log::warn!(
            "[RUM] replay resource upload org={org_id} app={app_id:?} skipped={skipped} dropped={} reasons={reasons:?}",
            upload.dropped_images
        );
    }
    let stored = futures::stream::iter(images)
        .map(|(resource_id, data)| async move {
            let key = replay_resource_key(org_id, app_id, &resource_id);
            infra::storage::put(REPLAY_RESOURCE_ACCOUNT, &key, data)
                .await
                .inspect_err(|e| log::error!("[RUM] replay resource store failed for {key}: {e}"))
        })
        .buffer_unordered(get_config().limit.cpu_num.max(1))
        .try_collect::<Vec<()>>()
        .await;
    match stored {
        Ok(_) => StatusCode::ACCEPTED.into_response(),
        Err(_) => MetaHttpResponse::internal_error("Failed to store replay resource"),
    }
}

/// Rewrites a single JSON array body (mobile SDK batches) into NDJSON.
fn normalize_logs_body(body: Bytes) -> Result<Bytes, Error> {
    if body.trim_ascii_start().first() != Some(&b'[') {
        return Ok(body);
    }
    // Not exactly one array: the NDJSON path reports its own error.
    let Ok(items) = json::from_slice::<Vec<json::Value>>(&body) else {
        return Ok(body);
    };
    let mut ndjson = Vec::with_capacity(body.len());
    for (idx, item) in items.iter().enumerate() {
        if !item.is_object() {
            return Err(Error::IngestionError(format!(
                "Failed processing: each line must be a JSON object (array element at index {idx} is not an object)"
            )));
        }
        if !ndjson.is_empty() {
            ndjson.push(b'\n');
        }
        ndjson.extend(json::to_vec(item).map_err(|e| Error::IngestionError(e.to_string()))?);
    }
    Ok(Bytes::from(ndjson))
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
                   information, and interaction sequences for comprehensive user experience analysis. A resource upload \
                   (`image` parts plus an event of type resource, no segment) stores the images and is also accepted.",
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
        description = "Multipart form data containing compressed session replay segment and event metadata, or `image` parts and a resource event for a resource upload"),
    responses(
        (status = 202, description = "Accepted, empty body"),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    )
)]
pub async fn sessionreplay(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Extension(rum_query_data): Extension<RumExtraData>,
    mut payload: Multipart,
) -> Response {
    // Mobile gzip `content-encoding` is already handled by RequestDecompressionLayer.
    let upload = match read_replay_upload(&mut payload).await {
        Ok(upload) => upload,
        Err(resp) => return resp,
    };

    match resource_app_id(&upload) {
        Ok(Some(app_id)) => return store_resource_upload(&org_id, &app_id, upload).await,
        Ok(None) => {}
        Err(e) => return MetaHttpResponse::bad_request(e),
    }

    let ReplayUpload {
        segments,
        event: event_data,
        ..
    } = upload;
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
        // and drop the batch instead of retrying, so the status must be 202. The body is empty:
        // the SDKs read only the status, and the shared ingestion response would show every
        // browser the internal stream names and counts.
        Ok(_) => StatusCode::ACCEPTED.into_response(),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// Replay resource image download
#[utoipa::path(
    get,
    path = "/{org_id}/rum/replay_resources/{app_id}/{resource_id}",
    context_path = "/api",
    tag = "Rum",
    operation_id = "GetReplayResource",
    summary = "Download a session replay resource image",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("app_id" = String, Path, description = "RUM application id"),
        ("resource_id" = String, Path, description = "Resource id, the 32-hex MD5 of the image"),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    responses(
        (status = 200, description = "Image bytes", content((inline(ResourceImageBytes) = "image/png"), (inline(ResourceImageBytes) = "image/jpeg"), (inline(ResourceImageBytes) = "image/gif"), (inline(ResourceImageBytes) = "image/webp"))),
        (status = 400, description = "Invalid application or resource id", content_type = "application/json", body = Object),
        (status = 404, description = "Resource not found", content_type = "application/json", body = Object),
    )
)]
pub async fn get_replay_resource(
    Path((org_id, app_id, resource_id)): Path<(String, String, String)>,
) -> Response {
    if let Err(e) = validate_app_id(&app_id).and_then(|_| validate_resource_id(&resource_id)) {
        return MetaHttpResponse::bad_request(e);
    }
    let key = replay_resource_key(&org_id, &app_id, &resource_id);
    match infra::storage::get_bytes(REPLAY_RESOURCE_ACCOUNT, &key).await {
        Ok(bytes) => match detect_image_type(&bytes) {
            Some(content_type) => (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, content_type),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
                    (
                        header::CACHE_CONTROL,
                        "private, max-age=31536000, immutable",
                    ),
                ],
                bytes,
            )
                .into_response(),
            None => MetaHttpResponse::not_found("Replay resource not found"),
        },
        Err(object_store::Error::NotFound { .. }) => {
            MetaHttpResponse::not_found("Replay resource not found")
        }
        Err(e) => {
            log::error!("[RUM] replay resource read failed for {key}: {e}");
            MetaHttpResponse::internal_error("Failed to read replay resource")
        }
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
    fn test_rum_streams_are_system_streams() {
        for name in [RUM_LOG_STREAM, RUM_SESSION_REPLAY_STREAM, RUM_DATA_STREAM] {
            assert!(config::meta::self_reporting::usage::is_system_stream(
                "acme", name
            ));
        }
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

    fn norm(input: &str) -> Result<String, String> {
        normalize_logs_body(Bytes::from(input.to_owned()))
            .map(|b| String::from_utf8(b.to_vec()).unwrap())
            .map_err(|e| e.to_string())
    }

    const NOT_AN_OBJECT: &str = "each line must be a JSON object";

    #[test]
    fn logs_array_of_two_becomes_two_lines() {
        let out = norm(r#"[{"a":1},{"b":"x"}]"#).unwrap();
        assert_eq!(out, "{\"a\":1}\n{\"b\":\"x\"}");
    }

    #[test]
    fn logs_pretty_printed_array_is_compacted_to_one_line_per_element() {
        let out =
            norm("[\n  {\n    \"a\": 1,\n    \"c\": {\"d\": [1, 2]}\n  },\n  {\"b\": 2}\n]\n")
                .unwrap();
        assert_eq!(out, "{\"a\":1,\"c\":{\"d\":[1,2]}}\n{\"b\":2}");
    }

    #[test]
    fn logs_array_tolerates_leading_and_trailing_whitespace() {
        assert_eq!(norm(" \r\n\t [{\"a\":1}] \r\n\n ").unwrap(), "{\"a\":1}");
    }

    #[test]
    fn logs_empty_array_yields_empty_body() {
        assert_eq!(norm("[]").unwrap(), "");
        assert_eq!(norm("  [ ]  \n").unwrap(), "");
    }

    #[test]
    fn logs_array_with_a_non_object_element_is_refused() {
        for body in [
            "[1]",
            "[null]",
            r#"["s"]"#,
            "[true]",
            "[[1]]",
            r#"[{"a":1},2]"#,
            r#"[{"a":1},[{"b":2}]]"#,
            "[[]]",
        ] {
            let err = norm(body).unwrap_err();
            assert!(err.contains(NOT_AN_OBJECT), "{body}: {err}");
        }
    }

    #[test]
    fn logs_non_object_error_names_the_zero_based_element_index() {
        let err = norm(r#"[{"a":1},2]"#).unwrap_err();
        assert!(
            err.contains("(array element at index 1 is not an object)"),
            "{err}"
        );
        let err = norm("[null]").unwrap_err();
        assert!(
            err.contains("(array element at index 0 is not an object)"),
            "{err}"
        );
    }

    #[test]
    fn logs_array_preserves_large_integers() {
        let out = norm(r#"[{"a":9007199254740993,"b":18446744073709551616}]"#).unwrap();
        assert_eq!(out, r#"{"a":9007199254740993,"b":18446744073709551616}"#);
    }

    #[test]
    fn logs_malformed_array_falls_through_unchanged() {
        for body in [
            "[{\"a\":1},",
            "[{\"a\":1}",
            "[",
            "[{\"a\":1},]",
            "[{\"a\":1}] x",
        ] {
            assert_eq!(norm(body).unwrap(), body);
        }
    }

    #[test]
    fn logs_array_followed_by_more_lines_falls_through_unchanged() {
        for body in [
            "[{\"a\":1}]\n{\"b\":2}",
            "[{\"a\":1}]\n[{\"b\":2}]",
            "[{\"a\":1}] {\"b\":2}",
        ] {
            assert_eq!(norm(body).unwrap(), body);
        }
    }

    #[test]
    fn logs_ndjson_and_other_bodies_pass_through_unchanged() {
        for body in [
            "",
            "   ",
            "\n",
            "{\"a\":1}",
            "{\"a\":1}\n{\"b\":2}\n",
            "{\"a\":1}\r\n\r\n{\"b\":2}\r\n",
            "\n\n{\"a\":[1]}",
            "{\"a\":1}\n[1]",
            "123",
            "null",
        ] {
            assert_eq!(norm(body).unwrap(), body);
        }
    }

    #[test]
    fn logs_array_keeps_unicode_and_escapes_embedded_newlines() {
        let out = norm("[{\"m\":\"h\\u00e9llo \u{1F600} \\n line2\"},{\"k\":\"v\"}]").unwrap();
        assert_eq!(out.lines().count(), 2);
        let first: serde_json::Value = serde_json::from_str(out.lines().next().unwrap()).unwrap();
        assert_eq!(first["m"], "h\u{e9}llo \u{1F600} \n line2");
    }

    #[test]
    fn logs_body_with_bom_is_not_treated_as_an_array() {
        let body = "\u{feff}[{\"a\":1}]";
        assert_eq!(norm(body).unwrap(), body);
    }

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0];
    const HEX32: &str = "0123456789abcdef0123456789ABCDEF";

    fn image(id: &str, data: &[u8]) -> (String, Bytes) {
        (id.to_string(), Bytes::copy_from_slice(data))
    }

    fn image_of(data: &[u8]) -> (String, Bytes) {
        image(&format!("{:x}", md5::compute(data)), data)
    }

    #[test]
    fn parses_the_android_resource_event() {
        let event = br#"{"application":{"id":"app-1"},"type":"resource"}"#;
        assert_eq!(parse_resource_event(event), Ok(Some("app-1".to_string())));
    }

    #[test]
    fn segment_events_are_not_resource_events() {
        assert_eq!(parse_resource_event(br#"[{"source":"android"}]"#), Ok(None));
        assert_eq!(parse_resource_event(br#"{"source":"browser"}"#), Ok(None));
        assert_eq!(parse_resource_event(b"not json"), Ok(None));
    }

    #[test]
    fn resource_event_with_a_missing_or_empty_app_id_is_rejected() {
        assert!(parse_resource_event(br#"{"type":"resource"}"#).is_err());
        let empty = br#"{"application":{"id":""},"type":"resource"}"#;
        assert!(parse_resource_event(empty).is_err());
    }

    #[test]
    fn resource_event_accepts_an_odd_app_id() {
        let event = r#"{"application":{"id":"my app/../é"},"type":"resource"}"#.as_bytes();
        assert_eq!(
            parse_resource_event(event),
            Ok(Some("my app/../é".to_string()))
        );
    }

    #[test]
    fn resource_id_must_be_32_hex_chars() {
        assert!(validate_resource_id(HEX32).is_ok());
        for bad in [
            "",
            "abc",
            &HEX32[..31],
            "g123456789abcdef0123456789abcdef",
            &format!("{HEX32}0"),
            "../../etc/passwd",
        ] {
            assert!(validate_resource_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn app_id_accepts_any_non_empty_string_up_to_the_cap() {
        for ok in [
            "app",
            "a b",
            "a/b",
            "..",
            "é",
            &"a".repeat(MAX_APP_ID_BYTES),
        ] {
            assert!(validate_app_id(ok).is_ok(), "{ok}");
        }
        for bad in ["", "a\0b", &"a".repeat(MAX_APP_ID_BYTES + 1)] {
            assert!(validate_app_id(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn image_type_comes_only_from_magic_bytes() {
        assert_eq!(detect_image_type(PNG), Some("image/png"));
        assert_eq!(
            detect_image_type(&[0xFF, 0xD8, 0xFF, 0xE0]),
            Some("image/jpeg")
        );
        assert_eq!(detect_image_type(b"GIF89a.."), Some("image/gif"));
        assert_eq!(detect_image_type(b"GIF87a.."), Some("image/gif"));
        assert_eq!(
            detect_image_type(b"RIFF\0\0\0\0WEBPVP8 "),
            Some("image/webp")
        );
        assert_eq!(detect_image_type(b"RIFF\0\0\0\0WAVEfmt "), None);
        assert_eq!(
            detect_image_type(b"<svg xmlns='http://www.w3.org/2000/svg'/>"),
            None
        );
        assert_eq!(detect_image_type(b"<html><script>1</script>"), None);
        assert_eq!(detect_image_type(b""), None);
    }

    fn select(images: Vec<(String, Bytes)>) -> (Vec<String>, usize) {
        let (valid, reasons) = select_valid_images(images);
        (
            valid.into_iter().map(|(id, _)| id).collect(),
            reasons.values().sum(),
        )
    }

    #[test]
    fn valid_resource_images_are_all_kept() {
        let other = [PNG, &[1, 2, 3]].concat();
        let (kept, skipped) = select(vec![image_of(PNG), image_of(&other)]);
        assert_eq!((kept.len(), skipped), (2, 0));
    }

    #[test]
    fn resource_id_md5_match_ignores_case() {
        let (id, data) = image_of(PNG);
        let (kept, skipped) = select(vec![(id.to_uppercase(), data)]);
        assert_eq!((kept.len(), skipped), (1, 0));
    }

    #[test]
    fn a_mixed_batch_keeps_the_good_images_and_skips_each_bad_one() {
        let (good_id, good) = image_of(PNG);
        let other = [PNG, &[9, 9]].concat();
        let (other_id, other_data) = image_of(&other);
        let (svg_id, svg) = image_of(b"<svg/>");
        let mut big = PNG.to_vec();
        big.resize(MAX_RESOURCE_IMAGE_BYTES + 1, 0);
        let (big_id, big) = image_of(&big);
        let batch = vec![
            (good_id.clone(), good),
            (svg_id, svg),
            (HEX32.to_string(), Bytes::from_static(PNG)),
            (big_id, big),
            image("not-hex", PNG),
            (other_id.clone(), other_data),
        ];
        let (kept, skipped) = select(batch);
        assert_eq!(kept, vec![good_id, other_id]);
        assert_eq!(skipped, 4);
    }

    #[test]
    fn an_image_exactly_at_the_size_cap_is_kept() {
        let mut big = PNG.to_vec();
        big.resize(MAX_RESOURCE_IMAGE_BYTES, 0);
        let (kept, skipped) = select(vec![image_of(&big)]);
        assert_eq!((kept.len(), skipped), (1, 0));
    }

    #[test]
    fn an_oversize_image_is_refused_before_hashing() {
        let big = vec![0u8; MAX_RESOURCE_IMAGE_BYTES + 1];
        assert_eq!(
            resource_image_problem("not-hex", &big),
            Some("image exceeds the maximum size")
        );
    }

    #[test]
    fn resource_key_is_namespaced_by_org_and_app() {
        let upper = HEX32.to_uppercase();
        let lower = HEX32.to_lowercase();
        assert_eq!(
            replay_resource_key("o", "a", &upper),
            format!("rum_replay_resources/o/a/{lower}")
        );
        assert_eq!(
            replay_resource_key("o", "a", &upper),
            replay_resource_key("o", "a", &lower)
        );
    }

    #[test]
    fn odd_app_ids_map_to_one_safe_distinct_segment() {
        let ids = [
            "a b", "a/b", "é", "..", ".", "...", "a%2Fb", "a_b-c.d", "a~b", "a\\b", "a%b", "a_b",
            "a_20b",
        ];
        let mut seen = std::collections::HashSet::new();
        for id in ids {
            let seg = encode_key_segment(id);
            assert!(!seg.is_empty() && !seg.contains('/'), "{id} -> {seg}");
            assert!(!seg.contains(['%', '.']), "{id} -> {seg}");
            assert!(seen.insert(seg.clone()), "{id} collides: {seg}");
            let key = replay_resource_key("o", id, HEX32);
            assert_eq!(key.split('/').count(), 4, "{key}");
        }
        assert_eq!(encode_key_segment("a b"), "a_20b");
        assert_eq!(encode_key_segment("a_b-c.d"), "a_5fb-c_2ed");
        assert_eq!(encode_key_segment(".."), "_2e_2e");
        assert_eq!(encode_key_segment("."), "_2e");
        assert_ne!(encode_key_segment("a_b"), encode_key_segment("a b"));
    }

    fn sessionreplay_router() -> axum::Router {
        axum::Router::new()
            .route(
                "/{org_id}/rum/org/_sessionreplay",
                axum::routing::post(sessionreplay),
            )
            .route(
                "/{org_id}/rum/replay_resources/{app_id}/{resource_id}",
                axum::routing::get(get_replay_resource),
            )
            .layer(Extension(RumExtraData {
                data: Default::default(),
            }))
    }

    const BOUNDARY: &str = "XBOUNDARY";

    fn multipart_body(parts: &[(&str, Option<&str>, &[u8])]) -> Vec<u8> {
        let mut body = Vec::new();
        for (name, filename, data) in parts {
            body.extend_from_slice(format!("--{BOUNDARY}\r\n").as_bytes());
            let file = filename
                .map(|f| format!("; filename=\"{f}\""))
                .unwrap_or_default();
            body.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"{file}\r\n\r\n").as_bytes(),
            );
            body.extend_from_slice(data);
            body.extend_from_slice(b"\r\n");
        }
        body.extend_from_slice(format!("--{BOUNDARY}--\r\n").as_bytes());
        body
    }

    async fn send(method: &str, uri: &str, body: Option<Vec<u8>>) -> Response {
        use tower::ServiceExt;
        let mut req = axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .header("user_id", "root@example.com");
        if body.is_some() {
            req = req.header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={BOUNDARY}"),
            );
        }
        let body = axum::body::Body::from(body.unwrap_or_default());
        sessionreplay_router()
            .oneshot(req.body(body).unwrap())
            .await
            .unwrap()
    }

    async fn body_text(resp: Response) -> String {
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        String::from_utf8_lossy(&bytes).to_string()
    }

    fn resource_event(app: &str) -> Vec<u8> {
        format!(r#"{{"type":"resource","application":{{"id":"{app}"}}}}"#).into_bytes()
    }

    #[tokio::test]
    async fn a_resource_upload_is_stored_and_served_with_safe_headers() {
        let org = format!("rum_ingest_t_{}", config::utils::time::now_micros());
        let app = "my app/é";
        let (id, data) = image_of(PNG);
        let (svg_id, svg) = image_of(b"<svg/>");
        let body = multipart_body(&[
            ("event", None, &resource_event(app)),
            ("image", Some(&id), &data),
            ("image", Some(&svg_id), &svg),
        ]);
        let resp = send(
            "POST",
            &format!("/{org}/rum/org/_sessionreplay"),
            Some(body),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        assert_eq!(body_text(resp).await, "");

        let enc = urlencoding::encode(app).to_string();
        let resp = send(
            "GET",
            &format!("/{org}/rum/replay_resources/{enc}/{id}"),
            None,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::OK);
        let h = resp.headers();
        assert_eq!(h[header::CONTENT_TYPE], "image/png");
        assert_eq!(h[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(
            h[header::CACHE_CONTROL],
            "private, max-age=31536000, immutable"
        );
        let served = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(served.as_ref(), PNG);

        let resp = send(
            "GET",
            &format!("/{org}/rum/replay_resources/{enc}/{svg_id}"),
            None,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);

        let prefix = format!(
            "{}/{org}/",
            config::meta::stream::RUM_REPLAY_RESOURCE_PREFIX
        );
        infra::storage::del_org_prefix_strict(&org, &prefix)
            .await
            .unwrap();
        let resp = send(
            "GET",
            &format!("/{org}/rum/replay_resources/{enc}/{id}"),
            None,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
        assert!(infra::storage::list("", &prefix).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn an_absent_resource_is_not_found() {
        let org = format!("rum_ingest_t_{}", config::utils::time::now_micros());
        let uri = format!("/{org}/rum/replay_resources/app/{HEX32}");
        assert_eq!(
            send("GET", &uri, None).await.status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn an_upload_without_segments_or_event_is_refused() {
        let body = multipart_body(&[("other", None, b"x")]);
        let resp = send("POST", "/o/rum/org/_sessionreplay", Some(body)).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        assert!(body_text(resp).await.contains("Missing 'segment'"));
    }

    #[tokio::test]
    async fn a_resource_upload_with_only_bad_images_is_still_accepted() {
        let org = format!("rum_ingest_t_{}", config::utils::time::now_micros());
        let (svg_id, svg) = image_of(b"<svg/>");
        let body = multipart_body(&[
            ("event", None, &resource_event("app")),
            ("image", Some(&svg_id), &svg),
        ]);
        let resp = send(
            "POST",
            &format!("/{org}/rum/org/_sessionreplay"),
            Some(body),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
    }

    #[tokio::test]
    async fn a_resource_upload_without_an_image_part_is_refused() {
        let body = multipart_body(&[("event", None, &resource_event("app"))]);
        let resp = send("POST", "/o/rum/org/_sessionreplay", Some(body)).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn a_blocked_org_resource_upload_is_refused_and_nothing_is_stored() {
        let org = format!("rum_ingest_blocked_{}", config::utils::time::now_micros());
        common::infra::config::ORG_STATUS_CACHE.insert(
            org.clone(),
            common::meta::organization::OrgStatus::PendingDeletion,
        );
        let (id, data) = image_of(PNG);
        let body = multipart_body(&[
            ("event", None, &resource_event("app")),
            ("image", Some(&id), &data),
        ]);
        let resp = send(
            "POST",
            &format!("/{org}/rum/org/_sessionreplay"),
            Some(body),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::SERVICE_UNAVAILABLE);
        let prefix = format!(
            "{}/{org}/",
            config::meta::stream::RUM_REPLAY_RESOURCE_PREFIX
        );
        assert!(infra::storage::list("", &prefix).await.unwrap().is_empty());
        common::infra::config::ORG_STATUS_CACHE.remove(&org);
    }

    #[test]
    fn a_segment_upload_carrying_images_is_not_a_resource_upload() {
        let upload = ReplayUpload {
            segments: vec![vec![1]],
            images: vec![image_of(PNG)],
            dropped_images: 0,
            event: Some(br#"{"source":"android"}"#.to_vec()),
        };
        assert_eq!(resource_app_id(&upload), Ok(None));
    }

    #[test]
    fn a_resource_typed_event_with_a_segment_is_a_segment_upload() {
        let upload = ReplayUpload {
            segments: vec![vec![1]],
            images: vec![],
            dropped_images: 0,
            event: Some(resource_event("app")),
        };
        assert_eq!(resource_app_id(&upload), Ok(None));
        let upload = ReplayUpload {
            segments: vec![],
            ..upload
        };
        assert_eq!(resource_app_id(&upload), Ok(Some("app".to_string())));
    }

    async fn read_upload(body: Vec<u8>) -> Result<ReplayUpload, Response> {
        let req = axum::http::Request::builder()
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={BOUNDARY}"),
            )
            .body(axum::body::Body::from(body))
            .unwrap();
        let mut multipart = <Multipart as axum::extract::FromRequest<()>>::from_request(req, &())
            .await
            .unwrap();
        read_replay_upload(&mut multipart).await
    }

    fn distinct_png(n: usize) -> (String, Vec<u8>) {
        let mut data = PNG.to_vec();
        data.extend_from_slice(format!("{n:08}").as_bytes());
        (format!("{:x}", md5::compute(&data)), data)
    }

    #[tokio::test]
    async fn images_beyond_the_cap_are_counted_as_dropped() {
        let images: Vec<_> = (0..=MAX_RESOURCE_IMAGES).map(distinct_png).collect();
        let mut parts: Vec<(&str, Option<&str>, &[u8])> = Vec::new();
        for (id, data) in &images {
            parts.push(("image", Some(id), data));
        }
        match read_upload(multipart_body(&parts)).await {
            Ok(upload) => {
                assert_eq!(upload.images.len(), MAX_RESOURCE_IMAGES);
                assert_eq!(upload.dropped_images, 1);
            }
            Err(_) => panic!("an over-cap upload must not be refused"),
        }
    }

    #[tokio::test]
    async fn an_unreadable_image_part_is_skipped_not_refused() {
        let mut body = multipart_body(&[("segment", None, b"seg"), ("event", None, b"{}")]);
        let closing = format!("--{BOUNDARY}--\r\n");
        body.truncate(body.len() - closing.len());
        body.extend_from_slice(
            format!(
                "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"x\"\r\n\r\ntruncated"
            )
            .as_bytes(),
        );
        match read_upload(body).await {
            Ok(upload) => {
                assert_eq!(upload.segments.len(), 1);
                assert!(upload.images.is_empty());
            }
            Err(_) => panic!("a bad image part must not refuse the upload"),
        }
    }

    #[tokio::test]
    async fn only_the_first_image_cap_images_are_stored_and_the_rest_are_not_a_bad_request() {
        let org = format!("rum_ingest_t_{}", config::utils::time::now_micros());
        let event = resource_event("app");
        let images: Vec<_> = (0..=MAX_RESOURCE_IMAGES).map(distinct_png).collect();
        let mut parts: Vec<(&str, Option<&str>, &[u8])> = vec![("event", None, &event)];
        for (id, data) in &images {
            parts.push(("image", Some(id), data));
        }
        let resp = send(
            "POST",
            &format!("/{org}/rum/org/_sessionreplay"),
            Some(multipart_body(&parts)),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        for (i, (id, _)) in images.iter().enumerate() {
            let resp = send(
                "GET",
                &format!("/{org}/rum/replay_resources/app/{id}"),
                None,
            )
            .await;
            let expected = if i < MAX_RESOURCE_IMAGES {
                StatusCode::OK
            } else {
                StatusCode::NOT_FOUND
            };
            assert_eq!(resp.status(), expected, "image {i}");
        }
        let prefix = format!(
            "{}/{org}/",
            config::meta::stream::RUM_REPLAY_RESOURCE_PREFIX
        );
        infra::storage::del_org_prefix_strict(&org, &prefix)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_resource_image_without_a_filename_is_skipped() {
        let org = format!("rum_ingest_t_{}", config::utils::time::now_micros());
        let body = multipart_body(&[
            ("event", None, &resource_event("app")),
            ("image", None, PNG),
        ]);
        let resp = send(
            "POST",
            &format!("/{org}/rum/org/_sessionreplay"),
            Some(body),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::ACCEPTED);
        let prefix = format!(
            "{}/{org}/",
            config::meta::stream::RUM_REPLAY_RESOURCE_PREFIX
        );
        assert!(infra::storage::list("", &prefix).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn get_replay_resource_rejects_invalid_ids() {
        let resp = get_replay_resource(Path(("o".into(), "".into(), HEX32.into()))).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
        let resp = get_replay_resource(Path(("o".into(), "a".into(), "nothex".into()))).await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
