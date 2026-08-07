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

use std::{
    collections::HashMap,
    io::{BufReader, Error},
    sync::Arc,
};

use axum::{
    Json, http,
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
    common::meta::{authz::Authz, http::HttpResponse as MetaHttpResponse, stream::SchemaRecords},
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

fn map_otlp_handler_error(
    org_id: &str,
    kind: &str,
    err: ProfilesExportError,
) -> Result<HttpResponse, std::io::Error> {
    log::error!(
        "[PROFILES:OTLP] Error while handling {kind} request: org_id: {org_id}, error: {err}"
    );
    match err {
        ProfilesExportError::TrialPeriodExpired(msg) => {
            Ok(MetaHttpResponse::too_many_requests(msg))
        }
        ProfilesExportError::Unavailable(msg) => Ok((
            http::StatusCode::SERVICE_UNAVAILABLE,
            Json(MetaHttpResponse::error(
                http::StatusCode::SERVICE_UNAVAILABLE,
                msg,
            )),
        )
            .into_response()),
        ProfilesExportError::Internal(inner) => {
            let error_msg = inner.to_string();
            if error_msg.contains("ZO_COLS_PER_RECORD_LIMIT") {
                return Ok(MetaHttpResponse::bad_request(error_msg));
            }
            Err(Error::other(inner))
        }
    }
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
            return Ok(MetaHttpResponse::bad_request(format!("Invalid proto: {e}")));
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
        Err(e) => map_otlp_handler_error(org_id, "protobuf", e),
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
            return Ok(MetaHttpResponse::bad_request(format!("Invalid json: {e}")));
        }
    };
    otlp_json_compat::normalize(&mut body_json);
    let request = match serde_json::from_value::<ExportProfilesServiceRequest>(body_json) {
        Ok(req) => req,
        Err(e) => {
            log::error!("[PROFILES:OTLP] Invalid json: org_id: {org_id}, error: {e}");
            return Ok(MetaHttpResponse::bad_request(format!("Invalid json: {e}")));
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
        Err(e) => map_otlp_handler_error(org_id, "json", e),
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
                partial_success.rejected_profiles +=
                    rejected_profile_count(records.len(), rejected_samples);
                for record in records {
                    append_record(
                        org_id,
                        &stream_name,
                        record,
                        &partition_keys,
                        partition_time_level,
                        &mut write_buf,
                        &mut stream_schema_map,
                    )
                    .await
                    .map_err(ProfilesExportError::Internal)?;
                }
            }
        }
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
    let ep = match req_type {
        OtlpRequestType::Grpc => "/grpc/profiles",
        OtlpRequestType::HttpJson => "/api/org/v1/profiles/json",
        OtlpRequestType::HttpProtobuf => "/api/org/v1/profiles/proto",
    };
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[ep, "200", org_id, StreamType::Profiles.as_str(), "", ""])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[ep, "200", org_id, StreamType::Profiles.as_str(), "", ""])
        .inc();

    Ok(export_service_response(partial_success))
}

async fn append_record(
    org_id: &str,
    stream_name: &str,
    record: json::Map<String, json::Value>,
    partition_keys: &Vec<config::meta::stream::StreamPartition>,
    partition_time_level: config::meta::stream::PartitionTimeLevel,
    write_buf: &mut HashMap<String, SchemaRecords>,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
) -> Result<(), anyhow::Error> {
    let timestamp = record
        .get(TIMESTAMP_COL_NAME)
        .and_then(json::Value::as_i64)
        .unwrap_or_else(now_micros);
    let record_str = json::to_string(&record).unwrap();

    if !stream_schema_map.contains_key(stream_name) {
        let mut schema = infra::schema::get(org_id, stream_name, StreamType::Profiles).await?;
        if schema.fields().is_empty() {
            let mut schema_reader = BufReader::new(record_str.as_bytes());
            let inferred_schema =
                infer_json_schema(&mut schema_reader, None, StreamType::Profiles)?;
            schema = inferred_schema;
            db::schema::merge(
                org_id,
                stream_name,
                StreamType::Profiles,
                &schema,
                Some(timestamp),
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

    let (_schema_evolution, _infer_schema) = check_for_schema(
        org_id,
        stream_name,
        StreamType::Profiles,
        stream_schema_map,
        vec![&record],
        timestamp,
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
    let hour_key = get_write_partition_key(
        timestamp,
        partition_keys,
        partition_time_level,
        &record,
        Some(&schema_key),
    );
    let hour_buf = write_buf.entry(hour_key).or_insert_with(|| SchemaRecords {
        schema_key,
        schema: Arc::new(schema),
        records: vec![],
        records_size: 0,
    });
    hour_buf.records.push(Arc::new(json::Value::Object(record)));
    hour_buf.records_size += record_str.len();
    Ok(())
}

/// `rejected_profiles` counts whole OTLP Profile messages, not flattened samples.
fn rejected_profile_count(accepted_records: usize, rejected_samples: i64) -> i64 {
    if accepted_records == 0 && rejected_samples > 0 {
        1
    } else {
        0
    }
}

fn export_service_response(
    mut partial_success: ExportProfilesPartialSuccess,
) -> ExportProfilesServiceResponse {
    if partial_success.rejected_profiles <= 0 {
        return ExportProfilesServiceResponse::default();
    }
    partial_success.error_message =
        "Some profiles were rejected due to exceeding the allowed retention period".to_string();
    ExportProfilesServiceResponse {
        partial_success: Some(partial_success),
    }
}

fn format_http_response(
    res: ExportProfilesServiceResponse,
    req_type: OtlpRequestType,
) -> HttpResponse {
    match req_type {
        OtlpRequestType::HttpJson => MetaHttpResponse::json(res),
        _ => {
            let mut out = BytesMut::with_capacity(res.encoded_len());
            res.encode(&mut out).expect("Out of memory");
            (
                http::StatusCode::OK,
                [(http::header::CONTENT_TYPE, "application/x-protobuf")],
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

    let profile_timestamp = if profile.time_unix_nano > 0 {
        (profile.time_unix_nano / 1000) as i64
    } else {
        now_micros()
    };
    base.insert(
        "duration_nanos".to_string(),
        json::Value::Number((profile.duration_nano as i64).into()),
    );
    base.insert(
        "period_nanos".to_string(),
        json::Value::Number(profile.period.into()),
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
        let (thread_id, thread_name) = resolve_thread_attrs(sample, dictionary);

        for (obs_idx, (timestamp, value)) in sample_observations(sample, profile_timestamp)
            .into_iter()
            .enumerate()
        {
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
/// populated they are index-paired; timestamps-only implies value `1` per point;
/// values-only is an aggregate at profile time.
fn sample_observations(sample: &Sample, profile_timestamp: i64) -> Vec<(i64, i64)> {
    let values = &sample.values;
    let timestamps = &sample.timestamps_unix_nano;

    if !values.is_empty() && !timestamps.is_empty() {
        let n = values.len().min(timestamps.len());
        return (0..n)
            .map(|i| {
                (
                    nano_to_micros_or(timestamps[i], profile_timestamp),
                    values[i],
                )
            })
            .collect();
    }

    if !timestamps.is_empty() {
        return timestamps
            .iter()
            .map(|&ts| (nano_to_micros_or(ts, profile_timestamp), 1_i64))
            .collect();
    }

    if !values.is_empty() {
        let value = values.iter().fold(0_i64, |acc, v| acc.saturating_add(*v));
        return vec![(profile_timestamp, value)];
    }

    Vec::new()
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

    if location.lines.is_empty() {
        if location.address != 0 {
            return vec![format!("0x{:x}", location.address)];
        }
        return vec![];
    }

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
    frames
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

fn resolve_thread_attrs(
    sample: &Sample,
    dictionary: Option<&ProfilesDictionary>,
) -> (Option<String>, Option<String>) {
    let Some(dictionary) = dictionary else {
        return (None, None);
    };

    let mut thread_id = None;
    let mut thread_name = None;
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
        match key.as_str() {
            "thread.id" | "thread_id" | "os.thread.id" => {
                thread_id = Some(string_value);
            }
            "thread.name" | "thread_name" => {
                thread_name = Some(string_value);
            }
            _ => {}
        }
    }
    (thread_id, thread_name)
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
        profiles::v1development::{Function, KeyValueAndUnit, Link, Location, Sample, Stack},
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
            vec![(2_000_000, 2), (3_000_000, 3)]
        );
        assert_eq!(
            sample_observations(
                &Sample {
                    timestamps_unix_nano: vec![1_000_000_000, 2_000_000_000, 3_000_000_000],
                    ..Default::default()
                },
                profile_ts
            ),
            vec![(1_000_000, 1), (2_000_000, 1), (3_000_000, 1)]
        );
        assert_eq!(
            sample_observations(
                &Sample {
                    values: vec![2, 3],
                    ..Default::default()
                },
                profile_ts
            ),
            vec![(profile_ts, 5)]
        );
        assert!(sample_observations(&Sample::default(), profile_ts).is_empty());
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
    fn build_sample_records_flattens_with_link_and_thread() {
        let dictionary = ProfilesDictionary {
            string_table: vec![
                "".to_string(),
                "cpu".to_string(),
                "nanoseconds".to_string(),
                "main".to_string(),
                "thread.id".to_string(),
                "thread.name".to_string(),
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
            ],
            ..Default::default()
        };

        let profile = Profile {
            sample_type: Some(ValueType {
                type_strindex: 1,
                unit_strindex: 2,
            }),
            time_unix_nano: 1_700_000_000_000_000_000,
            duration_nano: 30_000_000_000,
            period: 10_000_000,
            profile_id: vec![0xaa; 16],
            samples: vec![Sample {
                stack_index: 1,
                link_index: 1,
                attribute_indices: vec![1, 2],
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
            Some("cpu")
        );
        assert_eq!(
            row.get("profile_unit").and_then(|v| v.as_str()),
            Some("nanoseconds")
        );
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
    fn resolve_thread_attrs_supports_string_value_strindex() {
        let dictionary = ProfilesDictionary {
            string_table: vec![
                "".to_string(),
                "thread.name".to_string(),
                "worker-strindex".to_string(),
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
            ],
            ..Default::default()
        };
        let sample = Sample {
            attribute_indices: vec![1],
            ..Default::default()
        };
        let (_id, name) = resolve_thread_attrs(&sample, Some(&dictionary));
        assert_eq!(name.as_deref(), Some("worker-strindex"));
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
            "json",
            ProfilesExportError::TrialPeriodExpired("trial expired".into()),
        )
        .expect("trial maps to HTTP response");
        assert_eq!(trial.status(), http::StatusCode::TOO_MANY_REQUESTS);

        let unavailable = map_otlp_handler_error(
            "default",
            "json",
            ProfilesExportError::Unavailable("not an ingester".into()),
        )
        .expect("unavailable maps to HTTP response");
        assert_eq!(unavailable.status(), http::StatusCode::SERVICE_UNAVAILABLE);
    }

    #[test]
    fn rejected_profile_count_is_per_profile_not_per_sample() {
        assert_eq!(rejected_profile_count(3, 2), 0);
        assert_eq!(rejected_profile_count(0, 3), 1);
        assert_eq!(rejected_profile_count(1, 0), 0);
        assert_eq!(rejected_profile_count(0, 0), 0);
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
}
