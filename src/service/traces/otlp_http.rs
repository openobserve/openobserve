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

use std::io::Error;

use actix_web::{http, web, HttpResponse};
use ahash::AHashMap;
use chrono::{Duration, Utc};
use datafusion::arrow::datatypes::Schema;
use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
use prost::Message;

use crate::{
    common::{
        infra::{
            cluster,
            config::{CONFIG, DISTINCT_FIELDS},
            metrics,
        },
        meta::{
            alerts::Alert,
            http::HttpResponse as MetaHttpResponse,
            stream::{PartitionTimeLevel, SchemaRecords, StreamParams},
            traces::{
                Event, ExportTracePartialSuccess, ExportTraceServiceResponse, Span, SpanRefType,
            },
            usage::UsageType,
            StreamType,
        },
        utils,
        utils::{flatten, hasher::get_fields_key_xxh3, json},
    },
    service::{
        db, distinct_values, format_partition_key, format_stream_name,
        ingestion::{evaluate_trigger, grpc::get_val_for_attr, write_file_arrow, TriggerAlertData},
        schema::{check_for_schema, stream_schema_exists},
        stream::unwrap_partition_time_level,
        usage::report_request_usage_stats,
    },
};

const PARENT_SPAN_ID: &str = "reference.parent_span_id";
const PARENT_TRACE_ID: &str = "reference.parent_trace_id";
const REF_TYPE: &str = "reference.ref_type";
const SERVICE_NAME: &str = "service.name";
const SERVICE: &str = "service";

pub async fn traces_proto(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
    in_stream_name: Option<&str>,
) -> Result<HttpResponse, Error> {
    let request = ExportTraceServiceRequest::decode(body).expect("Invalid protobuf");
    super::handle_trace_request(org_id, thread_id, request, false, in_stream_name).await
}

pub async fn traces_json(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
    in_stream_name: Option<&str>,
) -> Result<HttpResponse, Error> {
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
            "Quota exceeded for this organization".to_string(),
        )));
    }

    let start = std::time::Instant::now();
    let traces_stream_name = match in_stream_name {
        Some(name) => format_stream_name(name),
        None => "default".to_string(),
    };
    let traces_stream_name = &traces_stream_name;

    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let mut traces_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut distinct_values = Vec::with_capacity(16);

    let min_ts =
        (Utc::now() - Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();
    let mut partial_success = ExportTracePartialSuccess::default();
    let mut data_buf: AHashMap<String, SchemaRecords> = AHashMap::new();

    let stream_schema = stream_schema_exists(
        org_id,
        traces_stream_name,
        StreamType::Traces,
        &mut traces_schema_map,
    )
    .await;

    let mut partition_keys: Vec<String> = vec![];
    let mut partition_time_level =
        PartitionTimeLevel::from(CONFIG.limit.traces_file_retention.as_str());
    if stream_schema.has_partition_keys {
        let partition_det = crate::service::ingestion::get_stream_partition_keys(
            traces_stream_name,
            &traces_schema_map,
        )
        .await;
        partition_keys = partition_det.partition_keys;
        partition_time_level =
            unwrap_partition_time_level(partition_det.partition_time_level, StreamType::Traces);
    }

    // Start get stream alerts
    crate::service::ingestion::get_stream_alerts(
        org_id,
        StreamType::Traces,
        traces_stream_name,
        &mut stream_alerts_map,
    )
    .await;
    // End get stream alert

    // Start Register Transforms for stream
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_transforms(
        org_id,
        StreamType::Traces,
        traces_stream_name,
    );
    // End Register Transforms for stream

    let mut trigger: TriggerAlertData = None;

    let mut service_name: String = traces_stream_name.to_string();
    // let export_req: ExportTraceServiceRequest =
    // json::from_slice(body.as_ref()).unwrap();
    let body: json::Value = match json::from_slice(body.as_ref()) {
        Ok(v) => v,
        Err(e) => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                format!("Invalid json: {}", e),
            )));
        }
    };
    let spans = match body.get("resourceSpans") {
        Some(v) => match v.as_array() {
            Some(v) => v,
            None => {
                return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                    http::StatusCode::BAD_REQUEST.into(),
                    "Invalid json: the structure must be {{\"resourceSpans\":[]}}".to_string(),
                )));
            }
        },
        None => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "Invalid json: the structure must be {{\"resourceSpans\":[]}}".to_string(),
            )));
        }
    };
    for res_span in spans.iter() {
        let mut service_att_map: AHashMap<String, json::Value> = AHashMap::new();
        if res_span.get("resource").is_some() {
            let resource = res_span.get("resource").unwrap().as_object().unwrap();
            if resource.get("attributes").is_some() {
                let attributes = resource.get("attributes").unwrap().as_array().unwrap();
                for res_attr in attributes {
                    let local_attr = res_attr.as_object().unwrap();
                    if local_attr
                        .get("key")
                        .unwrap()
                        .as_str()
                        .unwrap()
                        .eq(SERVICE_NAME)
                    {
                        let loc_service_name =
                            local_attr.get("value").unwrap().as_object().unwrap();
                        for item in loc_service_name {
                            service_name = item.1.as_str().unwrap().to_string();
                            service_att_map.insert(SERVICE_NAME.to_string(), item.1.clone());
                        }
                    } else {
                        service_att_map.insert(
                            format!(
                                "{}.{}",
                                SERVICE,
                                local_attr.get("key").unwrap().as_str().unwrap()
                            ),
                            get_val_for_attr(local_attr.get("value").unwrap().clone()),
                        );
                    }
                }
            }
        }
        let scope_resources = res_span.get("scopeSpans");
        let inst_resources = if let Some(v) = scope_resources {
            v.as_array().unwrap()
        } else {
            res_span
                .get("instrumentationLibrarySpans")
                .unwrap()
                .as_array()
                .unwrap()
        };
        for inst_span in inst_resources {
            if inst_span.get("spans").is_some() {
                let spans = inst_span.get("spans").unwrap().as_array().unwrap();
                for span in spans {
                    let span_id: String = span.get("spanId").unwrap().as_str().unwrap().to_string();
                    let trace_id: String =
                        span.get("traceId").unwrap().as_str().unwrap().to_string();

                    let mut span_ref = AHashMap::new();
                    if span.get("parentSpanId").is_some() {
                        span_ref.insert(
                            PARENT_SPAN_ID.to_string(),
                            span.get("parentSpanId")
                                .unwrap()
                                .as_str()
                                .unwrap()
                                .to_string(),
                        );
                        span_ref.insert(PARENT_TRACE_ID.to_string(), trace_id.clone());
                        span_ref
                            .insert(REF_TYPE.to_string(), format!("{:?}", SpanRefType::ChildOf));
                    }

                    let start_time: u64 = span.get("startTimeUnixNano").unwrap().as_u64().unwrap();
                    let end_time: u64 = span.get("endTimeUnixNano").unwrap().as_u64().unwrap();
                    let mut span_att_map: AHashMap<String, json::Value> = AHashMap::new();
                    let attributes = span.get("attributes").unwrap().as_array().unwrap();
                    for span_att in attributes {
                        span_att_map.insert(
                            span_att.get("key").unwrap().as_str().unwrap().to_string(),
                            get_val_for_attr(span_att.get("value").unwrap().clone()),
                        );
                    }

                    let mut events = vec![];
                    let mut event_att_map: AHashMap<String, json::Value> = AHashMap::new();

                    let empty_vec = Vec::new();
                    let span_events = match span.get("events") {
                        Some(v) => v.as_array().unwrap(),
                        None => &empty_vec,
                    };
                    for event in span_events {
                        let attributes = event.get("attributes").unwrap().as_array().unwrap();
                        for event_att in attributes {
                            event_att_map.insert(
                                event_att.get("key").unwrap().as_str().unwrap().to_string(),
                                get_val_for_attr(event_att.get("value").unwrap().clone()),
                            );
                        }
                        events.push(Event {
                            name: event.get("name").unwrap().as_str().unwrap().to_string(),
                            _timestamp: event.get("timeUnixNano").unwrap().as_u64().unwrap(),
                            attributes: event_att_map.clone(),
                        })
                    }

                    let timestamp = start_time / 1000;
                    let local_val = Span {
                        trace_id: trace_id.clone(),
                        span_id,
                        span_kind: span.get("kind").unwrap().to_string(),
                        span_status: span
                            .get("status")
                            .unwrap_or(&json::Value::String("UNSET".to_string()))
                            .to_string(),
                        operation_name: span.get("name").unwrap().as_str().unwrap().to_string(),
                        start_time,
                        end_time,
                        duration: (end_time - start_time) / 1000, // microseconds
                        reference: span_ref,
                        service_name: service_name.clone(),
                        attributes: span_att_map,
                        service: service_att_map.clone(),
                        flags: 1, // TODO add appropriate value
                        events: json::to_string(&events).unwrap(),
                    };
                    if timestamp < min_ts.try_into().unwrap() {
                        partial_success.rejected_spans += 1;
                        continue;
                    }

                    let mut value: json::Value = json::to_value(local_val).unwrap();

                    // JSON Flattening
                    value = flatten::flatten(&value).unwrap();

                    if !local_trans.is_empty() {
                        value = crate::service::ingestion::apply_stream_transform(
                            &local_trans,
                            &value,
                            &stream_vrl_map,
                            traces_stream_name,
                            &mut runtime,
                        )
                        .unwrap_or(value);
                    }
                    // End row based transform */
                    // get json object
                    let val_map = value.as_object_mut().unwrap();

                    val_map.insert(
                        CONFIG.common.column_timestamp.clone(),
                        json::Value::Number(timestamp.into()),
                    );

                    // get distinct_value item
                    for field in DISTINCT_FIELDS.iter() {
                        if let Some(val) = val_map.get(field) {
                            if !val.is_null() {
                                let (filter_name, filter_value) = if field == "operation_name" {
                                    ("service_name".to_string(), service_name.clone())
                                } else {
                                    ("".to_string(), "".to_string())
                                };
                                distinct_values.push(distinct_values::DvItem {
                                    stream_type: StreamType::Traces,
                                    stream_name: traces_stream_name.to_string(),
                                    field_name: field.to_string(),
                                    field_value: val.as_str().unwrap().to_string(),
                                    filter_name,
                                    filter_value,
                                });
                            }
                        }
                    }

                    let value_str = crate::common::utils::json::to_string(&val_map).unwrap();

                    // check schema
                    let schema_evolution = check_for_schema(
                        org_id,
                        traces_stream_name,
                        StreamType::Traces,
                        &value_str,
                        &mut traces_schema_map,
                        timestamp.try_into().unwrap(),
                        true,
                    )
                    .await;

                    // get hour key
                    let schema_key = get_fields_key_xxh3(&schema_evolution.schema_fields);

                    // get hour key
                    let mut hour_key = crate::service::ingestion::get_wal_time_key(
                        timestamp.try_into().unwrap(),
                        &partition_keys,
                        partition_time_level,
                        val_map,
                        Some(&schema_key),
                    );

                    if trigger.is_none() && !stream_alerts_map.is_empty() {
                        // Start check for alert trigger
                        let key =
                            format!("{}/{}/{}", &org_id, StreamType::Traces, traces_stream_name);
                        if let Some(alerts) = stream_alerts_map.get(&key) {
                            let mut trigger_alerts: Vec<(
                                Alert,
                                Vec<json::Map<String, json::Value>>,
                            )> = Vec::new();
                            for alert in alerts {
                                if let Ok(Some(v)) = alert.evaluate(Some(val_map)).await {
                                    trigger_alerts.push((alert.clone(), v));
                                }
                            }
                            trigger = Some(trigger_alerts);
                        }
                        // End check for alert trigger
                    }

                    if partition_keys.is_empty() {
                        let partition_key = format!("service_name={}", service_name);
                        hour_key.push_str(&format!("/{}", format_partition_key(&partition_key)));
                    }

                    let rec_schema = traces_schema_map.get(traces_stream_name).unwrap();

                    let hour_buf = data_buf.entry(hour_key).or_insert(SchemaRecords {
                        schema: rec_schema
                            .clone()
                            .with_metadata(std::collections::HashMap::new()),
                        records: vec![],
                    });
                    let loc_value: utils::json::Value =
                        utils::json::from_slice(value_str.as_bytes()).unwrap();
                    hour_buf.records.push(loc_value);
                }
            }
        }
    }

    let mut traces_file_name = "".to_string();
    let mut req_stats = write_file_arrow(
        &data_buf,
        thread_id,
        &StreamParams::new(org_id, traces_stream_name, StreamType::Traces),
        &mut traces_file_name,
        None,
    )
    .await;
    let time = start.elapsed().as_secs_f64();
    req_stats.response_time = time;

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = distinct_values::write(org_id, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "http-json/api/org/traces",
            "200",
            org_id,
            traces_stream_name,
            StreamType::Traces.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "http-json/api/org/traces",
            "200",
            org_id,
            traces_stream_name,
            StreamType::Traces.to_string().as_str(),
        ])
        .inc();

    // metric + data usage
    report_request_usage_stats(
        req_stats,
        org_id,
        traces_stream_name,
        StreamType::Traces,
        UsageType::Traces,
        0,
    )
    .await;

    // only one trigger per request, as it updates etcd
    evaluate_trigger(trigger).await;

    let resp = if partial_success.rejected_spans > 0 {
        partial_success.error_message =
            "Some spans were rejected due to exceeding the allowed retention period".to_string();
        HttpResponse::PartialContent().json(ExportTraceServiceResponse {
            partial_success: Some(partial_success),
        })
    } else {
        HttpResponse::Ok().json(ExportTraceServiceResponse::default())
    };
    Ok(resp)
}

#[cfg(test)]
mod tests {
    use json::json;

    use super::*;

    #[test]
    fn test_get_val_for_attr() {
        let in_val = 10.00;
        let input = json!({ "key": in_val });
        let resp = get_val_for_attr(input);
        assert_eq!(resp.as_str().unwrap(), in_val.to_string());
    }
}
