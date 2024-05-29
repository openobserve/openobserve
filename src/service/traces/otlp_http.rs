// Copyright 2024 Zinc Labs Inc.
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

use actix_web::{http, web, HttpResponse};
use chrono::{Duration, Utc};
use config::{
    cluster, get_config,
    meta::{
        stream::{PartitionTimeLevel, StreamPartition, StreamType},
        usage::UsageType,
    },
    metrics,
    utils::{flatten, json, schema_ext::SchemaExt},
    DISTINCT_FIELDS,
};
use infra::schema::{unwrap_partition_time_level, SchemaCache};
use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;
use prost::Message;

use super::BLOCK_FIELDS;
use crate::{
    common::meta::{
        alerts::Alert,
        http::HttpResponse as MetaHttpResponse,
        stream::{SchemaRecords, StreamParams},
        traces::{Event, ExportTracePartialSuccess, ExportTraceServiceResponse, Span, SpanRefType},
    },
    service::{
        db, format_stream_name,
        ingestion::{evaluate_trigger, grpc::get_val_for_attr, write_file, TriggerAlertData},
        metadata::{
            distinct_values::DvItem, trace_list_index::TraceListItem, write, MetadataItem,
            MetadataType,
        },
        schema::{check_for_schema, stream_schema_exists},
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
    let start = std::time::Instant::now();

    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(MetaHttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }

    if !db::file_list::BLOCKED_ORGS.is_empty()
        && db::file_list::BLOCKED_ORGS.contains(&org_id.to_string())
    {
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

    let cfg = get_config();
    let min_ts = (Utc::now() - Duration::try_hours(cfg.limit.ingest_allowed_upto).unwrap())
        .timestamp_micros();
    let mut partial_success = ExportTracePartialSuccess::default();
    let mut data_buf: HashMap<String, SchemaRecords> = HashMap::new();

    let traces_stream_name = match in_stream_name {
        Some(name) => format_stream_name(name),
        None => "default".to_string(),
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
        PartitionTimeLevel::from(cfg.limit.traces_file_retention.as_str());
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
        &[StreamParams {
            org_id: org_id.to_owned().into(),
            stream_name: traces_stream_name.to_owned().into(),
            stream_type: StreamType::Traces,
        }],
        &mut stream_alerts_map,
    )
    .await;
    // End get stream alert

    // Start Register Transforms for stream
    let (local_trans, stream_vrl_map) = crate::service::ingestion::register_stream_functions(
        org_id,
        &StreamType::Traces,
        &traces_stream_name,
    );
    // End Register Transforms for stream

    let mut trigger: Option<TriggerAlertData> = None;

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
        Some(json::Value::Array(v)) => v,
        _ => {
            return Ok(HttpResponse::BadRequest().json(MetaHttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "Invalid json: the structure must be {{\"resourceSpans\":[]}}".to_string(),
            )));
        }
    };
    let mut trace_index = Vec::with_capacity(spans.len());
    for res_span in spans.iter() {
        let mut service_att_map: HashMap<String, json::Value> = HashMap::new();
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

                    let mut span_ref = HashMap::new();
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

                    let start_time = json::get_uint_value(span.get("startTimeUnixNano").unwrap());
                    let end_time = json::get_uint_value(span.get("endTimeUnixNano").unwrap());
                    let mut span_att_map: HashMap<String, json::Value> = HashMap::new();
                    let attributes = span.get("attributes").unwrap().as_array().unwrap();
                    for span_att in attributes {
                        let mut key = span_att.get("key").unwrap().as_str().unwrap().to_string();
                        if BLOCK_FIELDS.contains(&key.as_str()) {
                            key = format!("attr_{}", key);
                        }
                        span_att_map.insert(
                            key,
                            get_val_for_attr(span_att.get("value").unwrap().clone()),
                        );
                    }

                    let mut events = vec![];
                    let mut event_att_map: HashMap<String, json::Value> = HashMap::new();

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
                            _timestamp: json::get_uint_value(event.get("timeUnixNano").unwrap()),
                            attributes: event_att_map.clone(),
                        })
                    }

                    let timestamp = start_time / 1000;
                    let local_val = Span {
                        trace_id: trace_id.clone(),
                        span_id,
                        span_kind: span.get("kind").unwrap().to_string(),
                        span_status: json::get_string_value(
                            span.get("status")
                                .unwrap_or(&json::Value::String("UNSET".to_string())),
                        ),
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
                    value = flatten::flatten(value).map_err(|e| {
                        std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string())
                    })?;

                    if !local_trans.is_empty() {
                        value = crate::service::ingestion::apply_stream_functions(
                            &local_trans,
                            value,
                            &stream_vrl_map,
                            org_id,
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
                        _ => unreachable!(),
                    };

                    record_val.insert(
                        cfg.common.column_timestamp.clone(),
                        json::Value::Number(timestamp.into()),
                    );

                    // get distinct_value item
                    for field in DISTINCT_FIELDS.iter() {
                        if let Some(val) = record_val.get(field) {
                            if !val.is_null() {
                                let (filter_name, filter_value) = if field == "operation_name" {
                                    ("service_name".to_string(), service_name.clone())
                                } else {
                                    ("".to_string(), "".to_string())
                                };
                                distinct_values.push(MetadataItem::DistinctValues(DvItem {
                                    stream_type: StreamType::Traces,
                                    stream_name: traces_stream_name.to_string(),
                                    field_name: field.to_string(),
                                    field_value: val.as_str().unwrap().to_string(),
                                    filter_name,
                                    filter_value,
                                }));
                            }
                        }
                    }

                    // build trace metadata
                    trace_index.push(MetadataItem::TraceListIndexer(TraceListItem {
                        stream_name: traces_stream_name.to_string(),
                        service_name: service_name.clone(),
                        trace_id,
                        _timestamp: start_time / 1000,
                    }));

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
                        let key =
                            format!("{}/{}/{}", &org_id, StreamType::Traces, traces_stream_name);
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
                    let hour_key = crate::service::ingestion::get_wal_time_key(
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
        if let Err(e) = write(org_id, MetadataType::DistinctValues, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    // send trace metadata
    if !trace_index.is_empty() {
        if let Err(e) = write(org_id, MetadataType::TraceListIndexer, trace_index).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/api/org/v1/traces",
            "200",
            org_id,
            &traces_stream_name,
            StreamType::Traces.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/api/org/v1/traces",
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
