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
    Extension,
    body::Bytes,
    extract::{Multipart, Path},
    response::Response,
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
#[serde(rename_all = "camelCase")]
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
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
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
        Ok(v) => MetaHttpResponse::json(v),
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
        (status = 200, description = "Success", content_type = "application/json", body = Object, example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]})),
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
        Ok(v) => MetaHttpResponse::json(v),
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
        (status = 200, description = "Success", content_type = "application/json",
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
    // Extract segment and event from multipart form
    let mut segment_data: Option<Vec<u8>> = None;
    let mut event_data: Option<Vec<u8>> = None;

    while let Ok(Some(field)) = payload.next_field().await {
        let name = field.name().map(|s| s.to_string());
        if let Ok(data) = field.bytes().await {
            match name.as_deref() {
                Some("segment") => segment_data = Some(data.to_vec()),
                Some("event") => event_data = Some(data.to_vec()),
                _ => {}
            }
        }
    }

    let segment_bytes = match segment_data {
        Some(data) => data,
        None => {
            return MetaHttpResponse::bad_request("Missing 'segment' field in multipart form");
        }
    };

    let event_bytes = match event_data {
        Some(data) => data,
        None => {
            return MetaHttpResponse::bad_request("Missing 'event' field in multipart form");
        }
    };

    let mut segment_payload = String::new();
    if ZlibDecoder::new(&segment_bytes[..])
        .read_to_string(&mut segment_payload)
        .is_err()
    {
        return MetaHttpResponse::bad_request("Failed to decompress the incoming payload");
    }

    let event: Event = match json::from_slice(&event_bytes[..]) {
        Ok(e) => e,
        Err(_) => {
            return MetaHttpResponse::bad_request("Failed to parse event data");
        }
    };

    let ingestion_payload = SegmentEventSerde {
        segment: segment_payload,
        event,
    };

    let body = match json::to_vec(&ingestion_payload) {
        Ok(b) => b,
        Err(_) => {
            return MetaHttpResponse::bad_request("Failed to serialize ingestion payload");
        }
    };

    let extend_json = &rum_query_data.data;
    let user_email = &user_email.user_id;
    match logs::ingest::ingest(
        0,
        &org_id,
        RUM_SESSION_REPLAY_STREAM,
        IngestionRequest::RUM(body.into()),
        IngestUser::from_user_email(user_email.clone()),
        Some(extend_json),
        false,
    )
    .await
    {
        Ok(v) => MetaHttpResponse::json(v),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}
