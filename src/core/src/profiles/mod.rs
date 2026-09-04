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

use std::{collections::HashMap, io::BufReader, sync::Arc};

use axum::{
    http,
    response::{IntoResponse, Response as HttpResponse},
};
use bytes::{Bytes, BytesMut};
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{otlp::OtlpRequestType, self_reporting::usage::UsageType, stream::StreamType},
    metrics,
    utils::{
        json,
        schema::{format_stream_name, infer_json_schema},
        schema_ext::SchemaExt,
        time::now_micros,
    },
};
use db;
use infra::schema::{SchemaCache, get_partition_time_level};
use ingestion_common::IngestUser;
use opentelemetry_proto::tonic::{
    collector::profiles::v1development::{
        ExportProfilesPartialSuccess, ExportProfilesServiceRequest, ExportProfilesServiceResponse,
    },
    profiles::v1development::{
        Profile, ProfilesDictionary, ResourceProfiles, Sample, ScopeProfiles, ValueType,
    },
};
use prost::Message;
use schema::check_for_schema;

use crate::{
    common::meta::{
        authz::Authz,
        http::{CONTENT_TYPE_JSON, CONTENT_TYPE_PROTO},
        stream::SchemaRecords,
    },
    ingestion::{
        check_ingestion_allowed, get_stream_partition_keys, get_thread_id, get_write_partition_key,
        write_file,
    },
};

mod otlp_json_compat;

/// Transport-neutral failure from profile ingestion. HTTP and gRPC map this
/// separately so a gate/circuit-breaker reject is not acknowledged as success.
#[derive(Debug)]
pub enum ProfilesExportError {
    TrialPeriodExpired(String),
    Unavailable(String),
    Internal(anyhow::Error),
}

impl std::fmt::Display for ProfilesExportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TrialPeriodExpired(msg) | Self::Unavailable(msg) => write!(f, "{msg}"),
            Self::Internal(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for ProfilesExportError {}

fn ingestion_gate_error(err: infra::errors::Error) -> ProfilesExportError {
    if matches!(err, infra::errors::Error::TrialPeriodExpired) {
        ProfilesExportError::TrialPeriodExpired(err.to_string())
    } else {
        ProfilesExportError::Unavailable(err.to_string())
    }
}

/// Minimal `google.rpc.Status` for OTLP/HTTP failure bodies.
#[derive(Clone, PartialEq, Message)]
struct GoogleRpcStatus {
    #[prost(int32, tag = "1")]
    code: i32,
    #[prost(string, tag = "2")]
    message: String,
}

/// Format an OTLP/HTTP error response, preserving the request Content-Type.
///
/// JSON requests get a ProtoJSON `google.rpc.Status`; protobuf requests get a
/// binary-encoded Status with `application/x-protobuf`.
pub fn otlp_error_response(
    req_type: OtlpRequestType,
    status: http::StatusCode,
    rpc_code: i32,
    message: impl Into<String>,
) -> HttpResponse {
    let message = message.into();
    match req_type {
        OtlpRequestType::HttpJson => {
            let body = json::json!({
                "code": rpc_code,
                "message": message,
            });
            (
                status,
                [(http::header::CONTENT_TYPE, CONTENT_TYPE_JSON)],
                json::to_vec(&body).unwrap_or_default(),
            )
                .into_response()
        }
        _ => {
            let rpc = GoogleRpcStatus {
                code: rpc_code,
                message,
            };
            let mut out = BytesMut::with_capacity(rpc.encoded_len());
            rpc.encode(&mut out).expect("Out of memory");
            (
                status,
                [(http::header::CONTENT_TYPE, CONTENT_TYPE_PROTO)],
                out.to_vec(),
            )
                .into_response()
        }
    }
}

fn profiles_http_endpoint(req_type: OtlpRequestType) -> &'static str {
    match req_type {
        OtlpRequestType::Grpc => "/grpc/profiles",
        OtlpRequestType::HttpJson => "/api/org/v1/profiles/json",
        OtlpRequestType::HttpProtobuf => "/api/org/v1/profiles/proto",
    }
}

fn record_profiles_http_metrics(
    org_id: &str,
    req_type: OtlpRequestType,
    status: &str,
    took_secs: f64,
) {
    let ep = profiles_http_endpoint(req_type);
    let labels = [ep, status, org_id, StreamType::Profiles.as_str(), "", ""];
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&labels)
        .observe(took_secs);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&labels)
        .inc();
}

/// Map a transport-neutral ingestion failure to an OTLP/HTTP Status response.
/// Always returns an HTTP response (never `Err`) so callers do not fall back to
/// OpenObserve JSON error envelopes.
fn map_otlp_handler_error(
    org_id: &str,
    req_type: OtlpRequestType,
    err: ProfilesExportError,
) -> HttpResponse {
    let kind = match req_type {
        OtlpRequestType::HttpJson => "json",
        OtlpRequestType::HttpProtobuf => "protobuf",
        OtlpRequestType::Grpc => "grpc",
    };
    log::error!(
        "[PROFILES:OTLP] Error while handling {kind} request: org_id: {org_id}, error: {err}"
    );
    let (status, rpc_code, msg) = match err {
        ProfilesExportError::TrialPeriodExpired(msg) => {
            (http::StatusCode::TOO_MANY_REQUESTS, 8, msg) // RESOURCE_EXHAUSTED
        }
        ProfilesExportError::Unavailable(msg) => {
            (http::StatusCode::SERVICE_UNAVAILABLE, 14, msg) // UNAVAILABLE
        }
        ProfilesExportError::Internal(inner) => {
            let error_msg = inner.to_string();
            if error_msg.contains("ZO_COLS_PER_RECORD_LIMIT") {
                (http::StatusCode::BAD_REQUEST, 3, error_msg) // INVALID_ARGUMENT
            } else {
                (http::StatusCode::INTERNAL_SERVER_ERROR, 13, error_msg) // INTERNAL
            }
        }
    };
    record_profiles_http_metrics(org_id, req_type, status.as_str(), 0.0);
    otlp_error_response(req_type, status, rpc_code, msg)
}

const EXTRACTOR_VERSION: &str = "v1";
/// Resource attributes promoted to fixed columns (hot query dimensions).
const HOT_RESOURCE_ATTRS: &[(&str, &str)] = &[
    ("service.name", "service_name"),
    ("host.name", "host_name"),
    ("deployment.environment", "deployment_environment"),
    ("process.pid", "process_pid"),
    ("process.executable.name", "process_executable_name"),
];
/// Well-known Resource attributes stored under `tags` with stable snake_case keys.
const TAG_RESOURCE_ATTR_ALIASES: &[(&str, &str)] = &[
    ("service.namespace", "service_namespace"),
    ("service.instance.id", "service_instance_id"),
    ("k8s.namespace.name", "k8s_namespace_name"),
    ("k8s.pod.name", "k8s_pod_name"),
    ("k8s.container.name", "k8s_container_name"),
];
/// Sample attributes promoted to fixed columns; remaining attrs go to `sample_tags`.
const HOT_SAMPLE_ATTRS: &[(&str, &str)] = &[
    ("thread.id", "thread_id"),
    ("thread_id", "thread_id"),
    ("os.thread.id", "thread_id"),
    ("thread.name", "thread_name"),
    ("thread_name", "thread_name"),
    ("cpu.logical_number", "cpu_logical_number"),
];
/// Mapping attribute keys preferred as stable native-frame identity (eBPF order).
const MAPPING_ID_ATTR_KEYS: &[&str] = &[
    "process.executable.build_id.htlhash",
    "process.executable.build_id.gnu",
    "process.executable.build_id.go",
];
const PROFILE_FRAME_TYPE_ATTR: &str = "profile.frame.type";

pub async fn otlp_proto(
    org_id: &str,
    body: Bytes,
    in_stream_name: Option<&str>,
    user: IngestUser,
) -> Result<HttpResponse, std::io::Error> {
    let request = match ExportProfilesServiceRequest::decode(body) {
        Ok(v) => v,
        Err(e) => {
            log::error!("[PROFILES:OTLP] Invalid proto: org_id: {org_id}, error: {e}");
            record_profiles_http_metrics(org_id, OtlpRequestType::HttpProtobuf, "400", 0.0);
            return Ok(otlp_error_response(
                OtlpRequestType::HttpProtobuf,
                http::StatusCode::BAD_REQUEST,
                3, // INVALID_ARGUMENT
                format!("Invalid proto: {e}"),
            ));
        }
    };
    match handle_otlp_request(
        org_id,
        request,
        OtlpRequestType::HttpProtobuf,
        in_stream_name,
        user,
    )
    .await
    {
        Ok(v) => Ok(format_http_response(v, OtlpRequestType::HttpProtobuf)),
        Err(e) => Ok(map_otlp_handler_error(
            org_id,
            OtlpRequestType::HttpProtobuf,
            e,
        )),
    }
}

pub async fn otlp_json(
    org_id: &str,
    body: Bytes,
    in_stream_name: Option<&str>,
    user: IngestUser,
) -> Result<HttpResponse, std::io::Error> {
    let mut body_json = match serde_json::from_slice::<json::Value>(body.as_ref()) {
        Ok(v) => v,
        Err(e) => {
            log::error!("[PROFILES:OTLP] Invalid json: org_id: {org_id}, error: {e}");
            record_profiles_http_metrics(org_id, OtlpRequestType::HttpJson, "400", 0.0);
            return Ok(otlp_error_response(
                OtlpRequestType::HttpJson,
                http::StatusCode::BAD_REQUEST,
                3, // INVALID_ARGUMENT
                format!("Invalid json: {e}"),
            ));
        }
    };
    otlp_json_compat::normalize(&mut body_json);
    let request = match serde_json::from_value::<ExportProfilesServiceRequest>(body_json) {
        Ok(req) => req,
        Err(e) => {
            log::error!("[PROFILES:OTLP] Invalid json: org_id: {org_id}, error: {e}");
            record_profiles_http_metrics(org_id, OtlpRequestType::HttpJson, "400", 0.0);
            return Ok(otlp_error_response(
                OtlpRequestType::HttpJson,
                http::StatusCode::BAD_REQUEST,
                3, // INVALID_ARGUMENT
                format!("Invalid json: {e}"),
            ));
        }
    };
    match handle_otlp_request(
        org_id,
        request,
        OtlpRequestType::HttpJson,
        in_stream_name,
        user,
    )
    .await
    {
        Ok(v) => Ok(format_http_response(v, OtlpRequestType::HttpJson)),
        Err(e) => Ok(map_otlp_handler_error(org_id, OtlpRequestType::HttpJson, e)),
    }
}

pub async fn handle_otlp_request(
    org_id: &str,
    request: ExportProfilesServiceRequest,
    req_type: OtlpRequestType,
    in_stream_name: Option<&str>,
    user: IngestUser,
) -> Result<ExportProfilesServiceResponse, ProfilesExportError> {
    let stream_name = format_stream_name(in_stream_name.unwrap_or("default").to_string());
    // Pass the resolved stream name so deleting-stream ingestion is rejected.
    if let Err(e) = check_ingestion_allowed(org_id, StreamType::Profiles, Some(&stream_name)).await
    {
        if !matches!(e, infra::errors::Error::TrialPeriodExpired) {
            log::error!("[PROFILES:OTLP] ingestion error: {e}");
        }
        return Err(ingestion_gate_error(e));
    }

    let start = std::time::Instant::now();
    let started_at = now_micros();
    let cfg = get_config();
    let now = now_micros();
    let min_ts = now - cfg.limit.ingest_allowed_upto_micro;
    let max_ts = now + cfg.limit.ingest_allowed_in_future_micro;

    let partition_keys =
        get_stream_partition_keys(org_id, &StreamType::Profiles, &stream_name).await;
    let partition_time_level = get_partition_time_level(StreamType::Profiles);

    let mut write_buf: HashMap<String, SchemaRecords> = HashMap::new();
    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut partial_success = ExportProfilesPartialSuccess::default();
    let mut all_records: Vec<json::Map<String, json::Value>> = Vec::new();

    let dictionary = request.dictionary.as_ref();
    for resource_profile in &request.resource_profiles {
        for scope_profile in &resource_profile.scope_profiles {
            for profile in &scope_profile.profiles {
                let (records, rejected_samples) = build_sample_records(
                    org_id,
                    &stream_name,
                    resource_profile,
                    scope_profile,
                    profile,
                    dictionary,
                    min_ts,
                    max_ts,
                );
                partial_success.rejected_profiles += rejected_profile_count(rejected_samples);
                all_records.extend(records);
            }
        }
    }

    if !all_records.is_empty() {
        buffer_records(
            org_id,
            &stream_name,
            all_records,
            &partition_keys,
            partition_time_level,
            &mut write_buf,
            &mut stream_schema_map,
        )
        .await
        .map_err(ProfilesExportError::Internal)?;
    }

    if !write_buf.is_empty() {
        let writer = ingester::get_writer(
            get_thread_id(),
            org_id,
            StreamType::Profiles.as_str(),
            &stream_name,
        )
        .await;
        let mut req_stats = write_file(&writer, org_id, &stream_name, write_buf, false)
            .await
            .map_err(|e| ProfilesExportError::Internal(e.into()))?;
        req_stats.response_time = start.elapsed().as_secs_f64();
        let email_str = user.to_email();
        req_stats.user_email = if email_str.is_empty() {
            None
        } else {
            Some(email_str)
        };
        usage_reporting::report_request_usage_stats(
            req_stats,
            org_id,
            &stream_name,
            StreamType::Profiles,
            UsageType::Profiles,
            0,
            started_at,
        )
        .await;
    }

    let time = start.elapsed().as_secs_f64();
    record_profiles_http_metrics(org_id, req_type, "200", time);

    Ok(export_service_response(partial_success))
}

/// Flatten the batch, run one schema check for the stream, then partition rows.
async fn buffer_records(
    org_id: &str,
    stream_name: &str,
    records: Vec<json::Map<String, json::Value>>,
    partition_keys: &Vec<config::meta::stream::StreamPartition>,
    partition_time_level: config::meta::stream::PartitionTimeLevel,
    write_buf: &mut HashMap<String, SchemaRecords>,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
) -> Result<(), anyhow::Error> {
    if records.is_empty() {
        return Ok(());
    }

    let min_timestamp = records
        .iter()
        .filter_map(|r| r.get(TIMESTAMP_COL_NAME).and_then(json::Value::as_i64))
        .min()
        .unwrap_or_else(now_micros);

    if !stream_schema_map.contains_key(stream_name) {
        let mut schema = infra::schema::get(org_id, stream_name, StreamType::Profiles).await?;
        if schema.fields().is_empty() {
            let first_str = json::to_string(&records[0]).unwrap();
            let mut schema_reader = BufReader::new(first_str.as_bytes());
            let inferred_schema =
                infer_json_schema(&mut schema_reader, None, StreamType::Profiles)?;
            schema = inferred_schema;
            db::schema::merge(
                org_id,
                stream_name,
                StreamType::Profiles,
                &schema,
                Some(min_timestamp),
            )
            .await?;
            db::authz::set_ownership(
                org_id,
                StreamType::Profiles.as_str(),
                Authz::new(stream_name),
            )
            .await;
        }
        stream_schema_map.insert(stream_name.to_string(), SchemaCache::new(schema));
    }

    let record_refs: Vec<&json::Map<String, json::Value>> = records.iter().collect();
    let (_schema_evolution, _infer_schema) = check_for_schema(
        org_id,
        stream_name,
        StreamType::Profiles,
        stream_schema_map,
        record_refs,
        min_timestamp,
        false,
    )
    .await?;

    let schema = stream_schema_map
        .get(stream_name)
        .unwrap()
        .schema()
        .as_ref()
        .clone()
        .with_metadata(HashMap::new());
    let schema_key = schema.hash_key();
    let schema = Arc::new(schema);

    for record in records {
        let timestamp = record
            .get(TIMESTAMP_COL_NAME)
            .and_then(json::Value::as_i64)
            .unwrap_or(min_timestamp);
        let record_str_len = json::to_string(&record).map(|s| s.len()).unwrap_or(0);
        let hour_key = get_write_partition_key(
            timestamp,
            partition_keys,
            partition_time_level,
            &record,
            Some(&schema_key),
        );
        let hour_buf = write_buf.entry(hour_key).or_insert_with(|| SchemaRecords {
            schema_key: schema_key.clone(),
            schema: schema.clone(),
            records: vec![],
            records_size: 0,
        });
        hour_buf.records.push(Arc::new(json::Value::Object(record)));
        hour_buf.records_size += record_str_len;
    }
    Ok(())
}

/// `rejected_profiles` counts whole OTLP Profile messages, not flattened samples.
///
/// Any dropped observation marks the containing Profile as rejected so the
/// response includes `partial_success` instead of looking like full success.
/// Accepted records from that Profile are still written.
fn rejected_profile_count(rejected_samples: i64) -> i64 {
    if rejected_samples > 0 { 1 } else { 0 }
}

fn export_service_response(
    mut partial_success: ExportProfilesPartialSuccess,
) -> ExportProfilesServiceResponse {
    if partial_success.rejected_profiles <= 0 {
        return ExportProfilesServiceResponse::default();
    }
    partial_success.error_message = "Some profiles were rejected due to out-of-window timestamps, malformed samples, or empty samples".to_string();
    ExportProfilesServiceResponse {
        partial_success: Some(partial_success),
    }
}

/// Serialize an export response using ProtoJSON rules (int64 as decimal string).
fn export_response_to_proto_json(res: &ExportProfilesServiceResponse) -> json::Value {
    match &res.partial_success {
        Some(ps) if ps.rejected_profiles != 0 || !ps.error_message.is_empty() => {
            let mut partial = json::Map::new();
            if ps.rejected_profiles != 0 {
                partial.insert(
                    "rejectedProfiles".to_string(),
                    json::Value::String(ps.rejected_profiles.to_string()),
                );
            }
            if !ps.error_message.is_empty() {
                partial.insert(
                    "errorMessage".to_string(),
                    json::Value::String(ps.error_message.clone()),
                );
            }
            json::json!({ "partialSuccess": partial })
        }
        _ => json::json!({}),
    }
}

fn format_http_response(
    res: ExportProfilesServiceResponse,
    req_type: OtlpRequestType,
) -> HttpResponse {
    match req_type {
        OtlpRequestType::HttpJson => (
            http::StatusCode::OK,
            [(http::header::CONTENT_TYPE, CONTENT_TYPE_JSON)],
            json::to_vec(&export_response_to_proto_json(&res)).expect("serialize response"),
        )
            .into_response(),
        _ => {
            let mut out = BytesMut::with_capacity(res.encoded_len());
            res.encode(&mut out).expect("Out of memory");
            (
                http::StatusCode::OK,
                [(http::header::CONTENT_TYPE, CONTENT_TYPE_PROTO)],
                out.to_vec(),
            )
                .into_response()
        }
    }
}

/// Flatten one OTLP Profile into JSON rows.
///
/// Each Sample observation becomes one row. OTLP Sample shapes:
/// - `values` + `timestamps_unix_nano` (equal length) → one row per index pair
/// - only timestamps → one row per timestamp with value `1`
/// - only values → one aggregated row at profile time
///
/// Observations whose `_timestamp` falls outside `[min_ts, max_ts]` (microseconds)
/// are skipped; the returned `rejected` count mirrors traces' retention filter.
#[allow(clippy::too_many_arguments)]
fn build_sample_records(
    org_id: &str,
    stream_name: &str,
    resource_profile: &ResourceProfiles,
    scope_profile: &ScopeProfiles,
    profile: &Profile,
    dictionary: Option<&ProfilesDictionary>,
    min_ts: i64,
    max_ts: i64,
) -> (Vec<json::Map<String, json::Value>>, i64) {
    if profile.samples.is_empty() {
        return (vec![], 0);
    }

    let mut base = json::Map::new();

    let profile_type_unit = get_profile_type_unit(profile.sample_type.as_ref(), dictionary);
    if let Some(profile_type) = profile_type_unit.0 {
        base.insert(
            "profile_type".to_string(),
            json::Value::String(profile_type),
        );
    }
    if let Some(profile_unit) = profile_type_unit.1 {
        base.insert(
            "profile_unit".to_string(),
            json::Value::String(profile_unit),
        );
    }

    let period_type_unit = get_profile_type_unit(profile.period_type.as_ref(), dictionary);
    if let Some(period_type) = period_type_unit.0 {
        base.insert("period_type".to_string(), json::Value::String(period_type));
    }
    if let Some(period_unit) = period_type_unit.1.clone() {
        base.insert("period_unit".to_string(), json::Value::String(period_unit));
    }
    // Only use a unit-specific field after validating the declared unit.
    let period_field = match period_type_unit.1.as_deref() {
        Some(u) if is_nanoseconds_unit(u) => "period_nanos",
        _ => "period",
    };
    base.insert(
        period_field.to_string(),
        json::Value::Number(profile.period.into()),
    );

    let profile_timestamp = if profile.time_unix_nano > 0 {
        (profile.time_unix_nano / 1000) as i64
    } else {
        now_micros()
    };
    base.insert(
        "duration_nanos".to_string(),
        json::Value::Number((profile.duration_nano as i64).into()),
    );

    let profile_id = if is_zero_bytes(&profile.profile_id) {
        String::new()
    } else {
        to_hex(&profile.profile_id)
    };
    if !profile_id.is_empty() {
        base.insert(
            "profile_id".to_string(),
            json::Value::String(profile_id.clone()),
        );
    }

    if let Some(scope) = &scope_profile.scope {
        if !scope.name.is_empty() {
            base.insert(
                "otel_scope_name".to_string(),
                json::Value::String(scope.name.clone()),
            );
        }
        if !scope.version.is_empty() {
            base.insert(
                "otel_scope_version".to_string(),
                json::Value::String(scope.version.clone()),
            );
        }
    }

    if let Some(resource) = &resource_profile.resource {
        let mut tags = json::Map::new();
        for attr in &resource.attributes {
            let Some(key) = resolve_key_value_key(attr, dictionary) else {
                continue;
            };
            let Some(string_value) = resolve_key_value_string(attr, dictionary) else {
                continue;
            };
            if string_value.is_empty() {
                continue;
            }

            if let Some((_, field_name)) = HOT_RESOURCE_ATTRS.iter().find(|(src, _)| *src == key) {
                base.insert((*field_name).to_string(), json::Value::String(string_value));
            } else {
                tags.insert(
                    resource_attr_tag_key(&key),
                    json::Value::String(string_value),
                );
            }
        }
        if !tags.is_empty() {
            // Store as JSON string: O2 schema inference rejects nested objects.
            base.insert(
                "tags".to_string(),
                json::Value::String(json::to_string(&json::Value::Object(tags)).unwrap()),
            );
        }
    }

    base.insert(
        "extractor_version".to_string(),
        json::Value::String(EXTRACTOR_VERSION.to_string()),
    );

    let mut records = Vec::with_capacity(profile.samples.len());
    let mut rejected = 0_i64;
    for (sample_idx, sample) in profile.samples.iter().enumerate() {
        let (stack, frame_count) = resolve_stack(sample.stack_index, dictionary);
        let (trace_id, span_id) = resolve_link(sample.link_index, dictionary);
        let (thread_id, thread_name, cpu_logical_number, sample_tags) =
            resolve_sample_attrs(sample, dictionary);

        let Some(observations) = sample_observations(sample, profile_timestamp) else {
            // Malformed paired series: reject the whole sample.
            rejected += sample
                .values
                .len()
                .max(sample.timestamps_unix_nano.len())
                .max(1) as i64;
            continue;
        };

        for (obs_idx, (timestamp, value)) in observations.into_iter().enumerate() {
            if timestamp < min_ts {
                log::error!(
                    "[PROFILES:OTLP] skipping observation with timestamp older than allowed retention period, profile_id: {profile_id}"
                );
                rejected += 1;
                continue;
            }
            if timestamp > max_ts {
                log::error!(
                    "[PROFILES:OTLP] skipping observation with timestamp newer than allowed retention period, profile_id: {profile_id}"
                );
                rejected += 1;
                continue;
            }

            let mut record = base.clone();
            record.insert(
                TIMESTAMP_COL_NAME.to_string(),
                json::Value::Number(timestamp.into()),
            );
            record.insert("stack".to_string(), json::Value::String(stack.clone()));
            record.insert(
                "frame_count".to_string(),
                json::Value::Number(frame_count.into()),
            );
            record.insert("value".to_string(), json::Value::Number(value.into()));

            if let Some(trace_id) = &trace_id {
                record.insert(
                    "trace_id".to_string(),
                    json::Value::String(trace_id.clone()),
                );
            }
            if let Some(span_id) = &span_id {
                record.insert("span_id".to_string(), json::Value::String(span_id.clone()));
            }
            if let Some(thread_id) = &thread_id {
                record.insert(
                    "thread_id".to_string(),
                    json::Value::String(thread_id.clone()),
                );
            }
            if let Some(thread_name) = &thread_name {
                record.insert(
                    "thread_name".to_string(),
                    json::Value::String(thread_name.clone()),
                );
            }
            if let Some(cpu_logical_number) = &cpu_logical_number {
                record.insert(
                    "cpu_logical_number".to_string(),
                    json::Value::String(cpu_logical_number.clone()),
                );
            }
            if !sample_tags.is_empty() {
                record.insert(
                    "sample_tags".to_string(),
                    json::Value::String(
                        json::to_string(&json::Value::Object(sample_tags.clone())).unwrap(),
                    ),
                );
            }

            let event_id = format!(
                "{:x}",
                md5::compute(format!(
                    "{org_id}/{stream_name}/{timestamp}/{profile_id}/{sample_idx}/{obs_idx}/{stack}/{value}"
                ))
            );
            record.insert("event_id".to_string(), json::Value::String(event_id));

            records.push(record);
        }
    }
    (records, rejected)
}

/// Expand one OTLP Sample into `(timestamp_micros, value)` observations.
///
/// Per the profiles proto: when both `values` and `timestamps_unix_nano` are
/// populated they are index-paired and MUST have equal length; timestamps-only
/// implies value `1` per point; values-only is an aggregate at profile time.
///
/// Returns `None` when both arrays are non-empty but lengths differ (invalid).
fn sample_observations(sample: &Sample, profile_timestamp: i64) -> Option<Vec<(i64, i64)>> {
    let values = &sample.values;
    let timestamps = &sample.timestamps_unix_nano;

    if !values.is_empty() && !timestamps.is_empty() {
        if values.len() != timestamps.len() {
            log::error!(
                "[PROFILES:OTLP] sample values ({}) and timestamps_unix_nano ({}) length mismatch; rejecting sample",
                values.len(),
                timestamps.len()
            );
            return None;
        }
        return Some(
            (0..values.len())
                .map(|i| {
                    (
                        nano_to_micros_or(timestamps[i], profile_timestamp),
                        values[i],
                    )
                })
                .collect(),
        );
    }

    if !timestamps.is_empty() {
        return Some(
            timestamps
                .iter()
                .map(|&ts| (nano_to_micros_or(ts, profile_timestamp), 1_i64))
                .collect(),
        );
    }

    if !values.is_empty() {
        let value = values.iter().fold(0_i64, |acc, v| acc.saturating_add(*v));
        return Some(vec![(profile_timestamp, value)]);
    }

    // OTLP Profiles: a Sample MUST have at least one values or timestamps entry.
    log::error!(
        "[PROFILES:OTLP] sample has empty values and timestamps_unix_nano; rejecting sample"
    );
    None
}

fn nano_to_micros_or(ts_nano: u64, fallback_micros: i64) -> i64 {
    if ts_nano > 0 {
        (ts_nano / 1000) as i64
    } else {
        fallback_micros
    }
}

fn resolve_stack(stack_index: i32, dictionary: Option<&ProfilesDictionary>) -> (String, i64) {
    let Some(dictionary) = dictionary else {
        return (String::new(), 0);
    };
    if stack_index <= 0 {
        return (String::new(), 0);
    }
    let Some(stack) = dictionary.stack_table.get(stack_index as usize) else {
        return (String::new(), 0);
    };

    let mut frames = Vec::new();
    for &location_index in &stack.location_indices {
        frames.extend(format_location_frames(location_index, dictionary));
    }
    let frame_count = frames.len() as i64;
    (frames.join(";"), frame_count)
}

fn format_location_frames(location_index: i32, dictionary: &ProfilesDictionary) -> Vec<String> {
    if location_index <= 0 {
        return vec![];
    }
    let Some(location) = dictionary.location_table.get(location_index as usize) else {
        return vec![];
    };

    if !location.lines.is_empty() {
        let mut frames = Vec::with_capacity(location.lines.len());
        for line in &location.lines {
            if line.function_index <= 0 {
                continue;
            }
            let Some(function) = dictionary.function_table.get(line.function_index as usize) else {
                continue;
            };
            if let Some(name) = lookup_string(&dictionary.string_table, function.name_strindex)
                .or_else(|| lookup_string(&dictionary.string_table, function.system_name_strindex))
            {
                frames.push(name);
            }
        }
        if !frames.is_empty() {
            return frames;
        }
        // eBPF may emit a Line when only SourceFile is set (no FunctionName). Fall
        // through so mapping/address identity is not dropped as an empty stack.
    }

    match format_unsymbolized_frame(location, dictionary) {
        Some(frame) => vec![frame],
        None => vec![],
    }
}

/// Format an unsymbolized location as `{mapping_id}+0x{rel}` (+ optional `/{frame_type}`).
///
/// eBPF native frames omit Line/Function and expect backends to retain mapping metadata
/// for later symbolization. Bare `0x{va}` collapses frames across different binaries.
fn format_unsymbolized_frame(
    location: &opentelemetry_proto::tonic::profiles::v1development::Location,
    dictionary: &ProfilesDictionary,
) -> Option<String> {
    let mapping_id = resolve_mapping_identity(location.mapping_index, dictionary);
    let rel = relative_file_offset(location, dictionary);
    let frame = match (mapping_id.as_deref(), rel, location.address) {
        (Some(id), Some(off), _) => format!("{id}+0x{off:x}"),
        (Some(id), None, addr) if addr != 0 => format!("{id}+0x{addr:x}"),
        (None, _, addr) if addr != 0 => format!("0x{addr:x}"),
        _ => return None,
    };
    match location_frame_type(location, dictionary) {
        Some(ft) if !ft.is_empty() => Some(format!("{frame}/{ft}")),
        _ => Some(frame),
    }
}

fn relative_file_offset(
    location: &opentelemetry_proto::tonic::profiles::v1development::Location,
    dictionary: &ProfilesDictionary,
) -> Option<u64> {
    if location.address == 0 {
        return None;
    }
    let mapping = mapping_at(location.mapping_index, dictionary)?;
    if mapping.memory_start == 0 || location.address < mapping.memory_start {
        return None;
    }
    Some(location.address - mapping.memory_start + mapping.file_offset)
}

fn resolve_mapping_identity(mapping_index: i32, dictionary: &ProfilesDictionary) -> Option<String> {
    let mapping = mapping_at(mapping_index, dictionary)?;
    for &attr_index in &mapping.attribute_indices {
        if attr_index <= 0 {
            continue;
        }
        let Some(attr) = dictionary.attribute_table.get(attr_index as usize) else {
            continue;
        };
        let Some(key) = lookup_string(&dictionary.string_table, attr.key_strindex) else {
            continue;
        };
        if !MAPPING_ID_ATTR_KEYS.contains(&key.as_str()) {
            continue;
        }
        if let Some(value) = resolve_any_value_string(attr.value.as_ref(), Some(dictionary))
            && !value.is_empty()
        {
            return Some(value);
        }
    }
    lookup_string(&dictionary.string_table, mapping.filename_strindex).map(|path| {
        std::path::Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.to_string())
            .unwrap_or(path)
    })
}

fn location_frame_type(
    location: &opentelemetry_proto::tonic::profiles::v1development::Location,
    dictionary: &ProfilesDictionary,
) -> Option<String> {
    for &attr_index in &location.attribute_indices {
        if attr_index <= 0 {
            continue;
        }
        let Some(attr) = dictionary.attribute_table.get(attr_index as usize) else {
            continue;
        };
        let Some(key) = lookup_string(&dictionary.string_table, attr.key_strindex) else {
            continue;
        };
        if key != PROFILE_FRAME_TYPE_ATTR {
            continue;
        }
        return resolve_any_value_string(attr.value.as_ref(), Some(dictionary));
    }
    None
}

fn mapping_at(
    mapping_index: i32,
    dictionary: &ProfilesDictionary,
) -> Option<&opentelemetry_proto::tonic::profiles::v1development::Mapping> {
    if mapping_index <= 0 {
        return None;
    }
    dictionary.mapping_table.get(mapping_index as usize)
}

fn resolve_link(
    link_index: i32,
    dictionary: Option<&ProfilesDictionary>,
) -> (Option<String>, Option<String>) {
    let Some(dictionary) = dictionary else {
        return (None, None);
    };
    if link_index <= 0 {
        return (None, None);
    }
    let Some(link) = dictionary.link_table.get(link_index as usize) else {
        return (None, None);
    };

    let trace_id = if is_zero_bytes(&link.trace_id) {
        None
    } else {
        Some(to_hex(&link.trace_id))
    };
    let span_id = if is_zero_bytes(&link.span_id) {
        None
    } else {
        Some(to_hex(&link.span_id))
    };
    (trace_id, span_id)
}

fn resolve_sample_attrs(
    sample: &Sample,
    dictionary: Option<&ProfilesDictionary>,
) -> (
    Option<String>,
    Option<String>,
    Option<String>,
    json::Map<String, json::Value>,
) {
    let mut thread_id = None;
    let mut thread_name = None;
    let mut cpu_logical_number = None;
    let mut sample_tags = json::Map::new();

    let Some(dictionary) = dictionary else {
        return (None, None, None, sample_tags);
    };

    for &attr_index in &sample.attribute_indices {
        if attr_index <= 0 {
            continue;
        }
        let Some(attr) = dictionary.attribute_table.get(attr_index as usize) else {
            continue;
        };
        let Some(key) = lookup_string(&dictionary.string_table, attr.key_strindex) else {
            continue;
        };
        let Some(string_value) = resolve_any_value_string(attr.value.as_ref(), Some(dictionary))
        else {
            continue;
        };
        if let Some((_, field)) = HOT_SAMPLE_ATTRS.iter().find(|(src, _)| *src == key) {
            match *field {
                "thread_id" => thread_id = Some(string_value),
                "thread_name" => thread_name = Some(string_value),
                "cpu_logical_number" => cpu_logical_number = Some(string_value),
                _ => {}
            }
        } else {
            sample_tags.insert(key.replace('.', "_"), json::Value::String(string_value));
        }
    }
    (thread_id, thread_name, cpu_logical_number, sample_tags)
}

fn is_nanoseconds_unit(unit: &str) -> bool {
    matches!(
        unit.to_ascii_lowercase().as_str(),
        "nanoseconds" | "nanosecond" | "ns" | "nanos"
    )
}

fn resolve_key_value_key(
    attr: &opentelemetry_proto::tonic::common::v1::KeyValue,
    dictionary: Option<&ProfilesDictionary>,
) -> Option<String> {
    if !attr.key.is_empty() {
        return Some(attr.key.clone());
    }
    lookup_string(
        dictionary.map(|d| d.string_table.as_slice()).unwrap_or(&[]),
        attr.key_strindex,
    )
}

fn resolve_key_value_string(
    attr: &opentelemetry_proto::tonic::common::v1::KeyValue,
    dictionary: Option<&ProfilesDictionary>,
) -> Option<String> {
    resolve_any_value_string(attr.value.as_ref(), dictionary)
}

fn resolve_any_value_string(
    value: Option<&opentelemetry_proto::tonic::common::v1::AnyValue>,
    dictionary: Option<&ProfilesDictionary>,
) -> Option<String> {
    let value = value?;
    match value.value.as_ref() {
        Some(opentelemetry_proto::tonic::common::v1::any_value::Value::StringValueStrindex(
            index,
        )) => lookup_string(
            dictionary.map(|d| d.string_table.as_slice()).unwrap_or(&[]),
            *index,
        ),
        _ => {
            let normalized = crate::ingestion::grpc::get_val_with_type_retained(&Some(value));
            let string_value = config::utils::json::get_string_value(&normalized);
            if string_value.is_empty() {
                None
            } else {
                Some(string_value)
            }
        }
    }
}

fn resource_attr_tag_key(otel_key: &str) -> String {
    if let Some((_, alias)) = TAG_RESOURCE_ATTR_ALIASES
        .iter()
        .find(|(src, _)| *src == otel_key)
    {
        return (*alias).to_string();
    }
    otel_key.replace('.', "_")
}

fn get_profile_type_unit(
    value_type: Option<&ValueType>,
    dictionary: Option<&ProfilesDictionary>,
) -> (Option<String>, Option<String>) {
    let Some(value_type) = value_type else {
        return (None, None);
    };
    let Some(dict) = dictionary else {
        return (None, None);
    };
    (
        lookup_string(&dict.string_table, value_type.type_strindex),
        lookup_string(&dict.string_table, value_type.unit_strindex),
    )
}

fn lookup_string(values: &[String], index: i32) -> Option<String> {
    if index <= 0 {
        return None;
    }
    values
        .get(index as usize)
        .cloned()
        .filter(|v| !v.is_empty())
}

fn is_zero_bytes(bytes: &[u8]) -> bool {
    bytes.is_empty() || bytes.iter().all(|b| *b == 0)
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use opentelemetry_proto::tonic::{
        common::v1::{AnyValue, any_value},
        profiles::v1development::{
            Function, KeyValueAndUnit, Link, Location, Mapping, Sample, Stack,
        },
    };

    use super::*;

    #[test]
    fn lookup_string_skips_zero_and_empty() {
        let table = vec!["".to_string(), "cpu".to_string(), "".to_string()];
        assert_eq!(lookup_string(&table, 0), None);
        assert_eq!(lookup_string(&table, 1), Some("cpu".to_string()));
        assert_eq!(lookup_string(&table, 2), None);
        assert_eq!(lookup_string(&table, 99), None);
    }

    #[test]
    fn sample_observations_expands_index_paired_series() {
        let profile_ts = 1_000_000i64;
        assert_eq!(
            sample_observations(
                &Sample {
                    values: vec![2, 3],
                    timestamps_unix_nano: vec![2_000_000_000, 3_000_000_000],
                    ..Default::default()
                },
                profile_ts
            ),
            Some(vec![(2_000_000, 2), (3_000_000, 3)])
        );
        assert_eq!(
            sample_observations(
                &Sample {
                    timestamps_unix_nano: vec![1_000_000_000, 2_000_000_000, 3_000_000_000],
                    ..Default::default()
                },
                profile_ts
            ),
            Some(vec![(1_000_000, 1), (2_000_000, 1), (3_000_000, 1)])
        );
        assert_eq!(
            sample_observations(
                &Sample {
                    values: vec![2, 3],
                    ..Default::default()
                },
                profile_ts
            ),
            Some(vec![(profile_ts, 5)])
        );
        assert_eq!(sample_observations(&Sample::default(), profile_ts), None);
        assert_eq!(
            sample_observations(
                &Sample {
                    values: vec![1, 2],
                    timestamps_unix_nano: vec![1_000_000_000],
                    ..Default::default()
                },
                profile_ts
            ),
            None
        );
    }

    #[test]
    fn build_sample_records_keeps_in_window_observations_from_paired_sample() {
        let dictionary = ProfilesDictionary {
            string_table: vec![
                "".to_string(),
                "samples".to_string(),
                "count".to_string(),
                "main".to_string(),
            ],
            function_table: vec![
                Function::default(),
                Function {
                    name_strindex: 3,
                    ..Default::default()
                },
            ],
            location_table: vec![
                Location::default(),
                Location {
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 1,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            stack_table: vec![
                Stack::default(),
                Stack {
                    location_indices: vec![1],
                },
            ],
            ..Default::default()
        };
        let now = now_micros();
        let ok_ts_nano = (now as u64).saturating_mul(1000);
        let old_ts_nano = ((now - 10 * 3600 * 1_000_000) as u64).saturating_mul(1000);
        let profile = Profile {
            sample_type: Some(ValueType {
                type_strindex: 1,
                unit_strindex: 2,
            }),
            time_unix_nano: ok_ts_nano,
            samples: vec![Sample {
                stack_index: 1,
                // First observation is out of window; later ones must still be kept.
                values: vec![1, 2, 3],
                timestamps_unix_nano: vec![old_ts_nano, ok_ts_nano, ok_ts_nano + 1_000_000],
                ..Default::default()
            }],
            ..Default::default()
        };
        let min_ts = now - 5 * 3600 * 1_000_000;
        let max_ts = now + 24 * 3600 * 1_000_000;
        let (records, rejected) = build_sample_records(
            "default",
            "default",
            &ResourceProfiles::default(),
            &ScopeProfiles::default(),
            &profile,
            Some(&dictionary),
            min_ts,
            max_ts,
        );
        assert_eq!(rejected, 1);
        assert_eq!(records.len(), 2);
        assert_eq!(records[0].get("value").and_then(|v| v.as_i64()), Some(2));
        assert_eq!(records[1].get("value").and_then(|v| v.as_i64()), Some(3));
        assert_eq!(
            records[0].get(TIMESTAMP_COL_NAME).and_then(|v| v.as_i64()),
            Some((ok_ts_nano / 1000) as i64)
        );
    }

    #[test]
    fn resolve_stack_joins_leaf_to_root() {
        let dictionary = ProfilesDictionary {
            string_table: vec![
                "".to_string(),
                "redis.get".to_string(),
                "OrderService.place".to_string(),
                "http.handler".to_string(),
                "main".to_string(),
            ],
            function_table: vec![
                Function::default(),
                Function {
                    name_strindex: 1,
                    ..Default::default()
                },
                Function {
                    name_strindex: 2,
                    ..Default::default()
                },
                Function {
                    name_strindex: 3,
                    ..Default::default()
                },
                Function {
                    name_strindex: 4,
                    ..Default::default()
                },
            ],
            location_table: vec![
                Location::default(),
                Location {
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 1,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                Location {
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 2,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                Location {
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 3,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
                Location {
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 4,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            stack_table: vec![
                Stack::default(),
                Stack {
                    location_indices: vec![1, 2, 3, 4],
                },
            ],
            ..Default::default()
        };

        let (stack, frame_count) = resolve_stack(1, Some(&dictionary));
        assert_eq!(stack, "redis.get;OrderService.place;http.handler;main");
        assert_eq!(frame_count, 4);
    }

    #[test]
    fn resolve_stack_keeps_mapping_identity_for_native_frames() {
        // Mirrors opentelemetry-ebpf-profiler TestGenerate_NativeFrame:
        // address + mapping metadata, empty function table / no Line entries.
        let dictionary = ProfilesDictionary {
            string_table: vec![
                "".to_string(),
                "/usr/lib/libexample.so".to_string(),
                "process.executable.build_id.htlhash".to_string(),
                "deadbeefcafebabe".to_string(),
                "profile.frame.type".to_string(),
                "native".to_string(),
                "/lib/x86_64-linux-gnu/libc.so.6".to_string(),
            ],
            function_table: vec![Function::default()],
            mapping_table: vec![
                Mapping::default(),
                Mapping {
                    memory_start: 0x1000,
                    memory_limit: 0x2000,
                    file_offset: 0x100,
                    filename_strindex: 1,
                    attribute_indices: vec![1],
                },
                Mapping {
                    memory_start: 0x1000,
                    memory_limit: 0x2000,
                    file_offset: 0x100,
                    filename_strindex: 6,
                    attribute_indices: vec![],
                },
            ],
            location_table: vec![
                Location::default(),
                Location {
                    mapping_index: 1,
                    address: 0x1000,
                    lines: vec![],
                    attribute_indices: vec![2],
                },
                Location {
                    mapping_index: 2,
                    address: 0x1000,
                    lines: vec![],
                    attribute_indices: vec![],
                },
            ],
            attribute_table: vec![
                KeyValueAndUnit::default(),
                KeyValueAndUnit {
                    key_strindex: 2,
                    value: Some(AnyValue {
                        value: Some(any_value::Value::StringValue(
                            "deadbeefcafebabe".to_string(),
                        )),
                    }),
                    ..Default::default()
                },
                KeyValueAndUnit {
                    key_strindex: 4,
                    value: Some(AnyValue {
                        value: Some(any_value::Value::StringValue("native".to_string())),
                    }),
                    ..Default::default()
                },
            ],
            stack_table: vec![
                Stack::default(),
                Stack {
                    location_indices: vec![1],
                },
                Stack {
                    // Same VA 0x1000 but different binary — must not collapse.
                    location_indices: vec![2],
                },
                Stack {
                    location_indices: vec![1, 2],
                },
            ],
            ..Default::default()
        };

        // rel = address - memory_start + file_offset = 0x1000 - 0x1000 + 0x100
        let (stack, frame_count) = resolve_stack(1, Some(&dictionary));
        assert_eq!(stack, "deadbeefcafebabe+0x100/native");
        assert_eq!(frame_count, 1);

        let (other, _) = resolve_stack(2, Some(&dictionary));
        assert_eq!(other, "libc.so.6+0x100");
        assert_ne!(stack, other);

        let (combined, combined_count) = resolve_stack(3, Some(&dictionary));
        assert_eq!(combined, "deadbeefcafebabe+0x100/native;libc.so.6+0x100");
        assert_eq!(combined_count, 2);
    }

    #[test]
    fn resolve_stack_symbolized_frames_still_use_function_names() {
        let dictionary = ProfilesDictionary {
            string_table: vec!["".to_string(), "main".to_string()],
            function_table: vec![
                Function::default(),
                Function {
                    name_strindex: 1,
                    ..Default::default()
                },
            ],
            mapping_table: vec![
                Mapping::default(),
                Mapping {
                    memory_start: 0x1000,
                    memory_limit: 0x2000,
                    file_offset: 0,
                    filename_strindex: 0,
                    attribute_indices: vec![],
                },
            ],
            location_table: vec![
                Location::default(),
                Location {
                    mapping_index: 1,
                    address: 0x1000,
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 1,
                        ..Default::default()
                    }],
                    attribute_indices: vec![],
                },
            ],
            stack_table: vec![
                Stack::default(),
                Stack {
                    location_indices: vec![1],
                },
            ],
            ..Default::default()
        };
        let (stack, frame_count) = resolve_stack(1, Some(&dictionary));
        assert_eq!(stack, "main");
        assert_eq!(frame_count, 1);
    }

    #[test]
    fn resolve_stack_falls_back_when_line_has_source_file_only() {
        // eBPF creates a Line when SourceFile is set even without FunctionName.
        let dictionary = ProfilesDictionary {
            string_table: vec![
                "".to_string(),
                "/usr/lib/libexample.so".to_string(),
                "process.executable.build_id.htlhash".to_string(),
                "deadbeefcafebabe".to_string(),
                "/src/runtime.c".to_string(),
            ],
            function_table: vec![
                Function::default(),
                Function {
                    name_strindex: 0,
                    system_name_strindex: 0,
                    filename_strindex: 4,
                    ..Default::default()
                },
            ],
            mapping_table: vec![
                Mapping::default(),
                Mapping {
                    memory_start: 0x1000,
                    memory_limit: 0x2000,
                    file_offset: 0x100,
                    filename_strindex: 1,
                    attribute_indices: vec![1],
                },
            ],
            location_table: vec![
                Location::default(),
                Location {
                    mapping_index: 1,
                    address: 0x1000,
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 1,
                        ..Default::default()
                    }],
                    attribute_indices: vec![],
                },
            ],
            attribute_table: vec![
                KeyValueAndUnit::default(),
                KeyValueAndUnit {
                    key_strindex: 2,
                    value: Some(AnyValue {
                        value: Some(any_value::Value::StringValue(
                            "deadbeefcafebabe".to_string(),
                        )),
                    }),
                    ..Default::default()
                },
            ],
            stack_table: vec![
                Stack::default(),
                Stack {
                    location_indices: vec![1],
                },
            ],
            ..Default::default()
        };

        let (stack, frame_count) = resolve_stack(1, Some(&dictionary));
        assert_eq!(stack, "deadbeefcafebabe+0x100");
        assert_eq!(frame_count, 1);
    }

    #[test]
    fn resolve_stack_falls_back_when_function_index_is_invalid() {
        let dictionary = ProfilesDictionary {
            string_table: vec!["".to_string(), "libc.so.6".to_string()],
            function_table: vec![Function::default()],
            mapping_table: vec![
                Mapping::default(),
                Mapping {
                    memory_start: 0x1000,
                    memory_limit: 0x2000,
                    file_offset: 0x40,
                    filename_strindex: 1,
                    attribute_indices: vec![],
                },
            ],
            location_table: vec![
                Location::default(),
                Location {
                    mapping_index: 1,
                    address: 0x1040,
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        // Points past function_table / zero-slot — no usable name.
                        function_index: 99,
                        ..Default::default()
                    }],
                    attribute_indices: vec![],
                },
                Location {
                    mapping_index: 1,
                    address: 0x1080,
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 0,
                        ..Default::default()
                    }],
                    attribute_indices: vec![],
                },
            ],
            stack_table: vec![
                Stack::default(),
                Stack {
                    location_indices: vec![1, 2],
                },
            ],
            ..Default::default()
        };

        // rel: 0x1040-0x1000+0x40=0x80, 0x1080-0x1000+0x40=0xc0
        let (stack, frame_count) = resolve_stack(1, Some(&dictionary));
        assert_eq!(stack, "libc.so.6+0x80;libc.so.6+0xc0");
        assert_eq!(frame_count, 2);
    }

    #[test]
    fn build_sample_records_flattens_with_link_and_thread() {
        let dictionary = ProfilesDictionary {
            string_table: vec![
                "".to_string(),
                "samples".to_string(),
                "count".to_string(),
                "main".to_string(),
                "thread.id".to_string(),
                "thread.name".to_string(),
                "cpu".to_string(),
                "nanoseconds".to_string(),
                "cpu.logical_number".to_string(),
                "process.context.label.request_id".to_string(),
            ],
            function_table: vec![
                Function::default(),
                Function {
                    name_strindex: 3,
                    ..Default::default()
                },
            ],
            location_table: vec![
                Location::default(),
                Location {
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 1,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            stack_table: vec![
                Stack::default(),
                Stack {
                    location_indices: vec![1],
                },
            ],
            link_table: vec![
                Link::default(),
                Link {
                    trace_id: vec![0x11; 16],
                    span_id: vec![0x22; 8],
                },
            ],
            attribute_table: vec![
                KeyValueAndUnit::default(),
                KeyValueAndUnit {
                    key_strindex: 4,
                    value: Some(AnyValue {
                        value: Some(any_value::Value::IntValue(7)),
                    }),
                    ..Default::default()
                },
                KeyValueAndUnit {
                    key_strindex: 5,
                    value: Some(AnyValue {
                        value: Some(any_value::Value::StringValue("worker-1".to_string())),
                    }),
                    ..Default::default()
                },
                KeyValueAndUnit {
                    key_strindex: 8,
                    value: Some(AnyValue {
                        value: Some(any_value::Value::IntValue(2)),
                    }),
                    ..Default::default()
                },
                KeyValueAndUnit {
                    key_strindex: 9,
                    value: Some(AnyValue {
                        value: Some(any_value::Value::StringValue("req-42".to_string())),
                    }),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let profile = Profile {
            sample_type: Some(ValueType {
                type_strindex: 1,
                unit_strindex: 2,
            }),
            period_type: Some(ValueType {
                type_strindex: 6,
                unit_strindex: 7,
            }),
            time_unix_nano: 1_700_000_000_000_000_000,
            duration_nano: 30_000_000_000,
            period: 10_000_000,
            profile_id: vec![0xaa; 16],
            samples: vec![Sample {
                stack_index: 1,
                link_index: 1,
                attribute_indices: vec![1, 2, 3, 4],
                values: vec![2],
                ..Default::default()
            }],
            ..Default::default()
        };

        let resource = ResourceProfiles {
            resource: Some(opentelemetry_proto::tonic::resource::v1::Resource {
                attributes: vec![
                    opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: "service.name".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("order-api".to_string())),
                        }),
                        ..Default::default()
                    },
                    opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: "host.name".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("node-1".to_string())),
                        }),
                        ..Default::default()
                    },
                    opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: "deployment.environment".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("prod".to_string())),
                        }),
                        ..Default::default()
                    },
                    opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: "process.pid".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::IntValue(4242)),
                        }),
                        ..Default::default()
                    },
                    opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: "process.executable.name".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("order-api.bin".to_string())),
                        }),
                        ..Default::default()
                    },
                    opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: "service.namespace".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("payments".to_string())),
                        }),
                        ..Default::default()
                    },
                    opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: "k8s.pod.name".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue(
                                "order-api-7f9c".to_string(),
                            )),
                        }),
                        ..Default::default()
                    },
                    opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: "cloud.region".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("us-west-2".to_string())),
                        }),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }),
            ..Default::default()
        };
        let scope = ScopeProfiles::default();
        let (records, rejected) = build_sample_records(
            "default",
            "default",
            &resource,
            &scope,
            &profile,
            Some(&dictionary),
            i64::MIN,
            i64::MAX,
        );
        assert_eq!(rejected, 0);
        assert_eq!(records.len(), 1);
        let row = &records[0];
        assert_eq!(row.get("stack").and_then(|v| v.as_str()), Some("main"));
        assert_eq!(row.get("value").and_then(|v| v.as_i64()), Some(2));
        assert_eq!(
            row.get("profile_type").and_then(|v| v.as_str()),
            Some("samples")
        );
        assert_eq!(
            row.get("profile_unit").and_then(|v| v.as_str()),
            Some("count")
        );
        assert_eq!(row.get("period_type").and_then(|v| v.as_str()), Some("cpu"));
        assert_eq!(
            row.get("period_unit").and_then(|v| v.as_str()),
            Some("nanoseconds")
        );
        assert_eq!(
            row.get("period_nanos").and_then(|v| v.as_i64()),
            Some(10_000_000)
        );
        assert!(row.get("period").is_none());
        assert_eq!(
            row.get("service_name").and_then(|v| v.as_str()),
            Some("order-api")
        );
        assert_eq!(
            row.get("host_name").and_then(|v| v.as_str()),
            Some("node-1")
        );
        assert_eq!(
            row.get("deployment_environment").and_then(|v| v.as_str()),
            Some("prod")
        );
        assert_eq!(
            row.get("process_pid").and_then(|v| v.as_str()),
            Some("4242")
        );
        assert_eq!(
            row.get("process_executable_name").and_then(|v| v.as_str()),
            Some("order-api.bin")
        );
        assert!(row.get("service_namespace").is_none());
        assert!(row.get("k8s_pod_name").is_none());
        let tags_raw = row
            .get("tags")
            .and_then(|v| v.as_str())
            .expect("tags string");
        let tags: json::Map<String, json::Value> =
            serde_json::from_str(tags_raw).expect("tags json");
        assert_eq!(
            tags.get("service_namespace").and_then(|v| v.as_str()),
            Some("payments")
        );
        assert_eq!(
            tags.get("k8s_pod_name").and_then(|v| v.as_str()),
            Some("order-api-7f9c")
        );
        assert_eq!(
            tags.get("cloud_region").and_then(|v| v.as_str()),
            Some("us-west-2")
        );
        assert_eq!(
            row.get("trace_id").and_then(|v| v.as_str()),
            Some("11111111111111111111111111111111")
        );
        assert_eq!(
            row.get("span_id").and_then(|v| v.as_str()),
            Some("2222222222222222")
        );
        assert_eq!(row.get("thread_id").and_then(|v| v.as_str()), Some("7"));
        assert_eq!(
            row.get("thread_name").and_then(|v| v.as_str()),
            Some("worker-1")
        );
        assert_eq!(
            row.get("cpu_logical_number").and_then(|v| v.as_str()),
            Some("2")
        );
        let sample_tags_raw = row
            .get("sample_tags")
            .and_then(|v| v.as_str())
            .expect("sample_tags string");
        let sample_tags: json::Map<String, json::Value> =
            serde_json::from_str(sample_tags_raw).expect("sample_tags json");
        assert_eq!(
            sample_tags
                .get("process_context_label_request_id")
                .and_then(|v| v.as_str()),
            Some("req-42")
        );
        assert!(row.get("profile_blob").is_none());
    }

    #[test]
    fn resource_attr_tag_key_uses_aliases_and_dot_replace() {
        assert_eq!(resource_attr_tag_key("k8s.pod.name"), "k8s_pod_name");
        assert_eq!(resource_attr_tag_key("cloud.region"), "cloud_region");
    }

    #[test]
    fn sample_record_with_tags_passes_schema_inference() {
        let dictionary = ProfilesDictionary {
            string_table: vec![
                "".to_string(),
                "samples".to_string(),
                "count".to_string(),
                "main".to_string(),
            ],
            function_table: vec![
                Function::default(),
                Function {
                    name_strindex: 3,
                    ..Default::default()
                },
            ],
            location_table: vec![
                Location::default(),
                Location {
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 1,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            stack_table: vec![
                Stack::default(),
                Stack {
                    location_indices: vec![1],
                },
            ],
            ..Default::default()
        };
        let profile = Profile {
            sample_type: Some(ValueType {
                type_strindex: 1,
                unit_strindex: 2,
            }),
            time_unix_nano: 1_700_000_000_000_000_000,
            samples: vec![Sample {
                stack_index: 1,
                values: vec![1],
                ..Default::default()
            }],
            ..Default::default()
        };
        let resource = ResourceProfiles {
            resource: Some(opentelemetry_proto::tonic::resource::v1::Resource {
                attributes: vec![
                    opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: "service.name".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("svc".to_string())),
                        }),
                        ..Default::default()
                    },
                    opentelemetry_proto::tonic::common::v1::KeyValue {
                        key: "k8s.pod.name".to_string(),
                        value: Some(AnyValue {
                            value: Some(any_value::Value::StringValue("pod-1".to_string())),
                        }),
                        ..Default::default()
                    },
                ],
                ..Default::default()
            }),
            ..Default::default()
        };

        let (records, rejected) = build_sample_records(
            "default",
            "default",
            &resource,
            &ScopeProfiles::default(),
            &profile,
            Some(&dictionary),
            i64::MIN,
            i64::MAX,
        );
        assert_eq!(rejected, 0);
        assert_eq!(records.len(), 1);
        assert!(records[0].get("tags").and_then(|v| v.as_str()).is_some());

        let schema = config::utils::schema::infer_json_schema_from_map(
            "default",
            StreamType::Profiles,
            records.iter(),
        )
        .expect("record with tags string must be schema-inferable");
        assert!(schema.field_with_name("tags").is_ok());
        assert!(schema.field_with_name("service_name").is_ok());
        assert!(schema.field_with_name("stack").is_ok());
        assert!(schema.field_with_name("value").is_ok());
    }

    #[test]
    fn build_sample_records_skips_out_of_window_timestamps() {
        let dictionary = ProfilesDictionary {
            string_table: vec![
                "".to_string(),
                "samples".to_string(),
                "count".to_string(),
                "main".to_string(),
            ],
            function_table: vec![
                Function::default(),
                Function {
                    name_strindex: 3,
                    ..Default::default()
                },
            ],
            location_table: vec![
                Location::default(),
                Location {
                    lines: vec![opentelemetry_proto::tonic::profiles::v1development::Line {
                        function_index: 1,
                        ..Default::default()
                    }],
                    ..Default::default()
                },
            ],
            stack_table: vec![
                Stack::default(),
                Stack {
                    location_indices: vec![1],
                },
            ],
            ..Default::default()
        };
        let now = now_micros();
        // profile.time_unix_nano is nanoseconds
        let ok_ts_nano = (now as u64).saturating_mul(1000);
        let old_ts_nano = ((now - 10 * 3600 * 1_000_000) as u64).saturating_mul(1000);
        let future_ts_nano = ((now + 48 * 3600 * 1_000_000) as u64).saturating_mul(1000);
        let profile = Profile {
            sample_type: Some(ValueType {
                type_strindex: 1,
                unit_strindex: 2,
            }),
            time_unix_nano: ok_ts_nano,
            samples: vec![
                Sample {
                    stack_index: 1,
                    values: vec![1],
                    timestamps_unix_nano: vec![ok_ts_nano],
                    ..Default::default()
                },
                Sample {
                    stack_index: 1,
                    values: vec![1],
                    timestamps_unix_nano: vec![old_ts_nano],
                    ..Default::default()
                },
                Sample {
                    stack_index: 1,
                    values: vec![1],
                    timestamps_unix_nano: vec![future_ts_nano],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let min_ts = now - 5 * 3600 * 1_000_000;
        let max_ts = now + 24 * 3600 * 1_000_000;
        let (records, rejected) = build_sample_records(
            "default",
            "default",
            &ResourceProfiles::default(),
            &ScopeProfiles::default(),
            &profile,
            Some(&dictionary),
            min_ts,
            max_ts,
        );
        assert_eq!(records.len(), 1);
        assert_eq!(rejected, 2);
        assert_eq!(
            records[0].get(TIMESTAMP_COL_NAME).and_then(|v| v.as_i64()),
            Some((ok_ts_nano / 1000) as i64)
        );
    }

    #[test]
    fn resolve_sample_attrs_supports_string_value_strindex_and_keeps_extra_attrs() {
        let dictionary = ProfilesDictionary {
            string_table: vec![
                "".to_string(),
                "thread.name".to_string(),
                "worker-strindex".to_string(),
                "cpu.logical_number".to_string(),
                "process.context.label.foo".to_string(),
            ],
            attribute_table: vec![
                KeyValueAndUnit::default(),
                KeyValueAndUnit {
                    key_strindex: 1,
                    value: Some(AnyValue {
                        value: Some(any_value::Value::StringValueStrindex(2)),
                    }),
                    ..Default::default()
                },
                KeyValueAndUnit {
                    key_strindex: 3,
                    value: Some(AnyValue {
                        value: Some(any_value::Value::IntValue(3)),
                    }),
                    ..Default::default()
                },
                KeyValueAndUnit {
                    key_strindex: 4,
                    value: Some(AnyValue {
                        value: Some(any_value::Value::StringValue("bar".to_string())),
                    }),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let sample = Sample {
            attribute_indices: vec![1, 2, 3],
            ..Default::default()
        };
        let (id, name, cpu, tags) = resolve_sample_attrs(&sample, Some(&dictionary));
        assert!(id.is_none());
        assert_eq!(name.as_deref(), Some("worker-strindex"));
        assert_eq!(cpu.as_deref(), Some("3"));
        assert_eq!(
            tags.get("process_context_label_foo")
                .and_then(|v| v.as_str()),
            Some("bar")
        );
    }

    #[test]
    fn period_field_uses_nanos_only_when_unit_is_nanoseconds() {
        assert!(is_nanoseconds_unit("nanoseconds"));
        assert!(is_nanoseconds_unit("ns"));
        assert!(!is_nanoseconds_unit("count"));
        assert!(!is_nanoseconds_unit("bytes"));
    }

    #[test]
    fn ingestion_gate_error_is_not_success() {
        let trial = ingestion_gate_error(infra::errors::Error::TrialPeriodExpired);
        assert!(matches!(trial, ProfilesExportError::TrialPeriodExpired(_)));

        let unavailable = ingestion_gate_error(infra::errors::Error::IngestionError(
            "not an ingester".into(),
        ));
        match unavailable {
            ProfilesExportError::Unavailable(msg) => {
                assert!(msg.contains("not an ingester"));
            }
            other => panic!("expected Unavailable, got {other}"),
        }

        let resource =
            ingestion_gate_error(infra::errors::Error::ResourceError("disk full".into()));
        assert!(matches!(resource, ProfilesExportError::Unavailable(_)));
    }

    #[test]
    fn map_otlp_handler_error_keeps_http_429_and_503() {
        let trial = map_otlp_handler_error(
            "default",
            OtlpRequestType::HttpJson,
            ProfilesExportError::TrialPeriodExpired("trial expired".into()),
        );
        assert_eq!(trial.status(), http::StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            trial.headers().get(http::header::CONTENT_TYPE).unwrap(),
            CONTENT_TYPE_JSON
        );

        let unavailable = map_otlp_handler_error(
            "default",
            OtlpRequestType::HttpProtobuf,
            ProfilesExportError::Unavailable("not an ingester".into()),
        );
        assert_eq!(unavailable.status(), http::StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            unavailable
                .headers()
                .get(http::header::CONTENT_TYPE)
                .unwrap(),
            CONTENT_TYPE_PROTO
        );

        let internal = map_otlp_handler_error(
            "default",
            OtlpRequestType::HttpProtobuf,
            ProfilesExportError::Internal(anyhow::anyhow!("write failed")),
        );
        assert_eq!(internal.status(), http::StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            internal.headers().get(http::header::CONTENT_TYPE).unwrap(),
            CONTENT_TYPE_PROTO
        );
    }

    #[test]
    fn rejected_profile_count_marks_profile_when_any_observation_dropped() {
        // Partial drop: accepted records remain written, but the Profile is rejected.
        assert_eq!(rejected_profile_count(2), 1);
        // Full drop.
        assert_eq!(rejected_profile_count(3), 1);
        // Full accept.
        assert_eq!(rejected_profile_count(0), 0);
    }

    #[test]
    fn format_http_response_uses_200_for_partial_success() {
        let res = export_service_response(ExportProfilesPartialSuccess {
            rejected_profiles: 1,
            error_message: String::new(),
        });
        assert_eq!(
            format_http_response(res.clone(), OtlpRequestType::HttpJson).status(),
            http::StatusCode::OK
        );
        assert_eq!(
            format_http_response(res, OtlpRequestType::HttpProtobuf).status(),
            http::StatusCode::OK
        );
    }

    #[test]
    fn format_http_response_emits_proto_json_rejected_profiles_string() {
        let res = export_service_response(ExportProfilesPartialSuccess {
            rejected_profiles: 1,
            error_message: String::new(),
        });
        let response = format_http_response(res.clone(), OtlpRequestType::HttpJson);
        assert_eq!(
            response.headers().get(http::header::CONTENT_TYPE).unwrap(),
            CONTENT_TYPE_JSON
        );
        let body = export_response_to_proto_json(&res);
        assert_eq!(
            body["partialSuccess"]["rejectedProfiles"],
            json::Value::String("1".into())
        );
        assert!(
            body["partialSuccess"]["errorMessage"]
                .as_str()
                .unwrap()
                .contains("rejected")
        );
    }
}
