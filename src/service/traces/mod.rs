// Copyright 2023 Zinc Labs Inc.
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

use std::{collections::HashMap, io::Error, sync::Arc};

use actix_web::{http, HttpResponse};
use bytes::BytesMut;
use chrono::{Duration, Utc};
use config::{
    cluster,
    meta::{
        stream::{PartitionTimeLevel, StreamType},
        usage::UsageType,
    },
    metrics,
    utils::{flatten, json, schema_ext::SchemaExt},
    CONFIG, DISTINCT_FIELDS,
};
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::{
    collector::trace::v1::{
        ExportTracePartialSuccess, ExportTraceServiceRequest, ExportTraceServiceResponse,
    },
    trace::v1::{status::StatusCode, Status},
};
use prost::Message;

use crate::{
    common::meta::{
        alerts::Alert,
        http::HttpResponse as MetaHttpResponse,
        stream::{SchemaRecords, StreamPartition},
        traces::{Event, Span, SpanRefType},
    },
    service::{
        db, distinct_values, format_stream_name,
        ingestion::{evaluate_trigger, grpc::get_val, write_file, TriggerAlertData},
        schema::{check_for_schema, stream_schema_exists, SchemaCache},
        stream::unwrap_partition_time_level,
        usage::report_request_usage_stats,
    },
};

pub mod otlp_http;

const PARENT_SPAN_ID: &str = "reference.parent_span_id";
const PARENT_TRACE_ID: &str = "reference.parent_trace_id";
const REF_TYPE: &str = "reference.ref_type";
const SERVICE_NAME: &str = "service.name";
const SERVICE: &str = "service";

pub async fn handle_trace_request(
    org_id: &str,
    thread_id: usize,
    request: ExportTraceServiceRequest,
    is_grpc: bool,
    in_stream_name: Option<&str>,
) -> Result<HttpResponse, Error> {
    let start = std::time::Instant::now();

    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }

    if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id) {
        return Ok(HttpResponse::Forbidden().json(MetaHttpResponse::error(
            http::StatusCode::FORBIDDEN.into(),
            format!("Quota exceeded for this organization [{}]", org_id),
        )));
    }

    // check memtable
    if let Err(e) = ingester::check_memtable_size() {
        return Ok(
            HttpResponse::ServiceUnavailable().json(MetaHttpResponse::error(
                http::StatusCode::SERVICE_UNAVAILABLE.into(),
                e.to_string(),
            )),
        );
    }

    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let mut traces_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    let mut distinct_values = Vec::with_capacity(16);

    let traces_stream_name = match in_stream_name {
        Some(name) => format_stream_name(name),
        None => "default".to_owned(),
    };

    let stream_schema = stream_schema_exists(
        org_id,
        &traces_stream_name,
        StreamType::Traces,
        &mut traces_schema_map,
    )
    .await;

    let mut partition_keys: Vec<StreamPartition> = vec![];
    let mut partition_time_level =
        PartitionTimeLevel::from(CONFIG.limit.traces_file_retention.as_str());
    if stream_schema.has_partition_keys {
        let partition_det = crate::service::ingestion::get_stream_partition_keys(
            org_id,
            &StreamType::Traces,
            &traces_stream_name,
        )
        .await;
        partition_keys = partition_det.partition_keys;
        partition_time_level =
            unwrap_partition_time_level(partition_det.partition_time_level, StreamType::Traces);
    }
    if partition_keys.is_empty() {
        partition_keys.push(StreamPartition::new("service_name"));
    }

    // Start get stream alerts
    crate::service::ingestion::get_stream_alerts(
        org_id,
        &StreamType::Traces,
        &traces_stream_name,
        &mut stream_alerts_map,
    )
    .await;
    // End get stream alert

    // Start Register Transforms for stream
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        &StreamType::Traces,
        &traces_stream_name,
    );
    // End Register Transforms for stream

    let mut trigger: Option<TriggerAlertData> = None;

    let min_ts = (Utc::now() - Duration::try_hours(CONFIG.limit.ingest_allowed_upto).unwrap())
        .timestamp_micros();
    let mut partial_success = ExportTracePartialSuccess::default();

    let mut data_buf: HashMap<String, SchemaRecords> = HashMap::new();

    let mut service_name: String = traces_stream_name.to_string();
    let res_spans = request.resource_spans;
    for res_span in res_spans {
        let mut service_att_map: HashMap<String, json::Value> = HashMap::new();
        let resource = res_span.resource.unwrap();

        for res_attr in resource.attributes {
            if res_attr.key.eq(SERVICE_NAME) {
                let loc_service_name = get_val(&res_attr.value.as_ref());
                if let Some(name) = loc_service_name.as_str() {
                    service_name = name.to_string();
                    service_att_map.insert(res_attr.key, loc_service_name);
                }
            } else {
                service_att_map.insert(
                    format!("{}.{}", SERVICE, res_attr.key),
                    get_val(&res_attr.value.as_ref()),
                );
            }
        }
        let inst_resources = res_span.scope_spans;
        for inst_span in inst_resources {
            let spans = inst_span.spans;
            for span in spans {
                let span_id: String = SpanId::from_bytes(
                    span.span_id
                        .try_into()
                        .expect("slice with incorrect length"),
                )
                .to_string();
                let trace_id: String = TraceId::from_bytes(
                    span.trace_id
                        .try_into()
                        .expect("slice with incorrect length"),
                )
                .to_string();
                let mut span_ref = HashMap::new();
                if !span.parent_span_id.is_empty() {
                    span_ref.insert(PARENT_TRACE_ID.to_string(), trace_id.clone());
                    span_ref.insert(
                        PARENT_SPAN_ID.to_string(),
                        SpanId::from_bytes(
                            span.parent_span_id
                                .try_into()
                                .expect("slice with incorrect length"),
                        )
                        .to_string(),
                    );
                    span_ref.insert(REF_TYPE.to_string(), format!("{:?}", SpanRefType::ChildOf));
                }
                let start_time: u64 = span.start_time_unix_nano;
                let end_time: u64 = span.end_time_unix_nano;
                let mut span_att_map: HashMap<String, json::Value> = HashMap::new();
                for span_att in span.attributes {
                    span_att_map.insert(span_att.key, get_val(&span_att.value.as_ref()));
                }

                let mut events = vec![];
                let mut event_att_map: HashMap<String, json::Value> = HashMap::new();
                for event in span.events {
                    for event_att in event.attributes {
                        event_att_map.insert(event_att.key, get_val(&event_att.value.as_ref()));
                    }
                    events.push(Event {
                        name: event.name,
                        _timestamp: event.time_unix_nano,
                        attributes: event_att_map.clone(),
                    })
                }

                let timestamp = start_time / 1000;

                let local_val = Span {
                    trace_id: trace_id.clone(),
                    span_id,
                    span_kind: span.kind.to_string(),
                    span_status: get_span_status(span.status),
                    operation_name: span.name.clone(),
                    start_time,
                    end_time,
                    duration: (end_time - start_time) / 1000, // microseconds
                    reference: span_ref,
                    service_name: service_name.clone(),
                    attributes: span_att_map,
                    service: service_att_map.clone(),
                    flags: 1, // TODO add appropriate value
                    //_timestamp: timestamp,
                    events: json::to_string(&events).unwrap(),
                };

                let value: json::Value = json::to_value(local_val).unwrap();

                // JSON Flattening
                let mut value = flatten::flatten(value).map_err(|e| {
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
                })?;

                if !local_trans.is_empty() {
                    value = crate::service::ingestion::apply_stream_transform(
                        &local_trans,
                        value,
                        &stream_vrl_map,
                        &traces_stream_name,
                        &mut runtime,
                    )
                    .map_err(|e| {
                        std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
                    })?;
                }
                // End row based transform */
                // get json object
                let mut record_val = match value.take() {
                    json::Value::Object(v) => v,
                    _ => unreachable!(""),
                };

                record_val.insert(
                    CONFIG.common.column_timestamp.clone(),
                    json::Value::Number(timestamp.into()),
                );

                // get distinct_value item
                for field in DISTINCT_FIELDS.iter() {
                    if let Some(val) = record_val.get(field) {
                        if let Some(val) = val.as_str() {
                            let (filter_name, filter_value) = if field == "operation_name" {
                                ("service_name".to_string(), service_name.clone())
                            } else {
                                ("".to_string(), "".to_string())
                            };
                            distinct_values.push(distinct_values::DvItem {
                                stream_type: StreamType::Traces,
                                stream_name: traces_stream_name.to_string(),
                                field_name: field.to_string(),
                                field_value: val.to_string(),
                                filter_name,
                                filter_value,
                            });
                        }
                    }
                }

                // check schema
                let _ = check_for_schema(
                    org_id,
                    &traces_stream_name,
                    StreamType::Traces,
                    &mut traces_schema_map,
                    vec![&record_val],
                    timestamp.try_into().unwrap(),
                )
                .await;

                if trigger.is_none() && !stream_alerts_map.is_empty() {
                    // Start check for alert trigger
                    let key = format!("{}/{}/{}", &org_id, StreamType::Traces, traces_stream_name);
                    if let Some(alerts) = stream_alerts_map.get(&key) {
                        let mut trigger_alerts: TriggerAlertData = Vec::new();
                        for alert in alerts {
                            if let Ok(Some(v)) = alert.evaluate(Some(&record_val)).await {
                                trigger_alerts.push((alert.clone(), v));
                            }
                        }
                        trigger = Some(trigger_alerts);
                    }
                    // End check for alert trigger
                }

                // get hour key
                let rec_schema = traces_schema_map
                    .get(&traces_stream_name)
                    .unwrap()
                    .schema()
                    .clone()
                    .with_metadata(HashMap::new());
                let schema_key = rec_schema.hash_key();
                let hour_key = super::ingestion::get_wal_time_key(
                    timestamp.try_into().unwrap(),
                    &partition_keys,
                    partition_time_level,
                    &record_val,
                    Some(&schema_key),
                );

                let hour_buf = data_buf.entry(hour_key).or_insert_with(|| SchemaRecords {
                    schema_key,
                    schema: Arc::new(rec_schema),
                    records: vec![],
                    records_size: 0,
                });
                // let record_val = record_val.to_owned();
                let record_val = json::Value::Object(record_val);
                let record_size = json::estimate_json_bytes(&record_val);
                hour_buf.records.push(Arc::new(record_val));
                hour_buf.records_size += record_size;

                if timestamp < min_ts.try_into().unwrap() {
                    partial_success.rejected_spans += 1;
                    continue;
                }
            }
        }
    }

    // write data to wal
    let writer = ingester::get_writer(thread_id, org_id, &StreamType::Traces.to_string()).await;
    let mut req_stats = write_file(&writer, &traces_stream_name, data_buf).await;
    if let Err(e) = writer.sync().await {
        log::error!("ingestion error while syncing writer: {}", e);
    }

    let time = start.elapsed().as_secs_f64();
    req_stats.response_time = time;

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = distinct_values::write(org_id, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    let ep = if is_grpc {
        "/grpc/export/traces"
    } else {
        "/api/org/v1/traces"
    };
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            ep,
            "200",
            org_id,
            &traces_stream_name,
            StreamType::Traces.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            ep,
            "200",
            org_id,
            &traces_stream_name,
            StreamType::Traces.to_string().as_str(),
        ])
        .inc();

    // metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        &traces_stream_name,
        StreamType::Traces,
        UsageType::Traces,
        0,
    )
    .await;

    // only one trigger per request, as it updates etcd
    evaluate_trigger(trigger).await;

    let res = ExportTraceServiceResponse {
        partial_success: if partial_success.rejected_spans > 0 {
            partial_success.error_message =
                "Some spans were rejected due to exceeding the allowed retention period"
                    .to_string();
            Some(partial_success)
        } else {
            None
        },
    };
    let mut out = BytesMut::with_capacity(res.encoded_len());
    res.encode(&mut out).expect("Out of memory");

    return Ok(HttpResponse::Ok()
        .status(http::StatusCode::OK)
        .content_type("application/x-protobuf")
        .body(out));
}

fn get_span_status(status: Option<Status>) -> String {
    match status {
        Some(v) => match v.code() {
            StatusCode::Ok => "OK".to_string(),
            StatusCode::Error => "ERROR".to_string(),
            StatusCode::Unset => "UNSET".to_string(),
        },
        None => "".to_string(),
    }
}
