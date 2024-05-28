use std::{collections::HashMap, sync::Arc};

use actix_web::web;
use chrono::{Duration, Utc};
use config::{
    cluster,
    meta::stream::{PartitionTimeLevel, StreamPartition, StreamType},
    utils::{flatten, json, schema_ext::SchemaExt},
    CONFIG, DISTINCT_FIELDS,
};
use infra::{
    errors::BufferWriteError,
    schema::{unwrap_partition_time_level, SchemaCache},
};
use opentelemetry::trace::{SpanId, TraceId};
use opentelemetry_proto::tonic::collector::trace::v1::ExportTraceServiceRequest;

use crate::{
    common::meta::{
        alerts::Alert,
        stream::{SchemaRecords, StreamParams},
        traces::{Event, ExportTracePartialSuccess, Span, SpanRefType},
    },
    service::{
        db, format_stream_name,
        ingestion::{
            grpc::{get_val, get_val_for_attr},
            TriggerAlertData,
        },
        metadata::{distinct_values::DvItem, trace_list_index::TraceListItem, MetadataItem},
        schema::{check_for_schema, stream_schema_exists},
        traces::{
            get_span_status, BLOCK_FIELDS, PARENT_SPAN_ID, PARENT_TRACE_ID, REF_TYPE, SERVICE,
            SERVICE_NAME,
        },
    },
};

fn basic_check(org_id: &str) -> Result<(), BufferWriteError> {
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Err(BufferWriteError::InternalServerError);
    }

    if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id) {
        return Err(BufferWriteError::HttpForbidden(format!(
            "Quota exceeded for this organization [{}]",
            org_id
        )));
    }

    // check memtable
    if let Err(e) = ingester::check_memtable_size() {
        return Err(BufferWriteError::HttpServiceUnavailable(e.to_string()));
    }

    Ok(())
}

async fn get_partition_keys(
    org_id: &str,
    traces_stream_name: &str,
    traces_schema_map: &mut HashMap<String, SchemaCache>,
) -> (Vec<StreamPartition>, PartitionTimeLevel) {
    let stream_schema = stream_schema_exists(
        org_id,
        traces_stream_name,
        StreamType::Traces,
        traces_schema_map,
    )
    .await;

    let mut partition_keys: Vec<StreamPartition> = vec![];
    let mut partition_time_level =
        PartitionTimeLevel::from(CONFIG.limit.traces_file_retention.as_str());
    if stream_schema.has_partition_keys {
        let partition_det = crate::service::ingestion::get_stream_partition_keys(
            org_id,
            &StreamType::Traces,
            traces_stream_name,
        )
        .await;
        partition_keys = partition_det.partition_keys;
        partition_time_level =
            unwrap_partition_time_level(partition_det.partition_time_level, StreamType::Traces);
    }
    if partition_keys.is_empty() {
        partition_keys.push(StreamPartition::new("service_name"));
    }

    (partition_keys, partition_time_level)
}
pub async fn validate_trace_request(
    org_id: &str,
    request: ExportTraceServiceRequest,
    in_stream_name: Option<&str>,
) -> Result<
    (
        HashMap<String, SchemaRecords>,
        Option<TriggerAlertData>,
        Vec<MetadataItem>,
        Vec<MetadataItem>,
        ExportTracePartialSuccess,
    ),
    BufferWriteError,
> {
    basic_check(org_id)?;

    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let mut traces_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    let mut distinct_values = Vec::with_capacity(16);

    let traces_stream_name = match in_stream_name {
        Some(name) => format_stream_name(name),
        None => "default".to_owned(),
    };

    let (partition_keys, partition_time_level) =
        get_partition_keys(org_id, traces_stream_name.as_str(), &mut traces_schema_map).await;
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

    let min_ts = (Utc::now() - Duration::try_hours(CONFIG.limit.ingest_allowed_upto).unwrap())
        .timestamp_micros();
    let mut partial_success = ExportTracePartialSuccess::default();

    let mut data_buf: HashMap<String, SchemaRecords> = HashMap::new();

    let mut service_name: String = traces_stream_name.to_string();
    let res_spans = request.resource_spans;
    let mut trace_index = Vec::with_capacity(res_spans.len());
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
        let mut record_id = 1;
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
                    let mut key = span_att.key;
                    if BLOCK_FIELDS.contains(&key.as_str()) {
                        key = format!("attr_{}", key);
                    }
                    span_att_map.insert(key, get_val(&span_att.value.as_ref()));
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
                // let span_status_for_metrics = local_val.span_status.clone();
                let value: json::Value = json::to_value(local_val).unwrap();

                // JSON Flattening
                let mut value = flatten::flatten(value)
                    .map_err(|e| BufferWriteError::IoError(e.to_string()))?;

                if !local_trans.is_empty() {
                    value = crate::service::ingestion::apply_stream_functions(
                        &local_trans,
                        value,
                        &stream_vrl_map,
                        &traces_stream_name,
                        &mut runtime,
                    )
                    .map_err(|e| BufferWriteError::IoError(e.to_string()))?;
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
                            distinct_values.push(MetadataItem::DistinctValues(DvItem {
                                stream_type: StreamType::Traces,
                                stream_name: traces_stream_name.to_string(),
                                field_name: field.to_string(),
                                field_value: val.to_string(),
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
                let hour_key = crate::service::ingestion::get_wal_time_key(
                    timestamp.try_into().unwrap(),
                    &partition_keys,
                    partition_time_level,
                    &record_val,
                    Some(&schema_key),
                );

                let hour_buf = data_buf.entry(hour_key).or_insert_with(|| SchemaRecords {
                    record_id,
                    schema_key,
                    schema: Arc::new(rec_schema),
                    records: vec![],
                    records_size: 0,
                });
                record_id += 1;
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

    Ok((
        data_buf,
        trigger,
        distinct_values,
        trace_index,
        partial_success,
    ))
}

pub async fn validate_json_trace_request(
    org_id: &str,
    body: web::Bytes,
    in_stream_name: Option<&str>,
) -> Result<
    (
        HashMap<String, SchemaRecords>,
        Option<TriggerAlertData>,
        Vec<MetadataItem>,
        Vec<MetadataItem>,
        ExportTracePartialSuccess,
    ),
    BufferWriteError,
> {
    basic_check(org_id)?;

    let mut runtime = crate::service::ingestion::init_functions_runtime();
    let mut traces_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    let mut distinct_values = Vec::with_capacity(16);

    let traces_stream_name = match in_stream_name {
        Some(name) => format_stream_name(name),
        None => "default".to_string(),
    };

    let (partition_keys, partition_time_level) =
        get_partition_keys(org_id, traces_stream_name.as_str(), &mut traces_schema_map).await;
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
    let min_ts = (Utc::now() - Duration::try_hours(CONFIG.limit.ingest_allowed_upto).unwrap())
        .timestamp_micros();
    let mut partial_success = crate::common::meta::traces::ExportTracePartialSuccess::default();

    let mut data_buf: HashMap<String, SchemaRecords> = HashMap::new();

    let mut service_name: String = traces_stream_name.to_string();
    // let export_req: ExportTraceServiceRequest =
    // json::from_slice(body.as_ref()).unwrap();
    let body: json::Value = match json::from_slice(body.as_ref()) {
        Ok(v) => v,
        Err(e) => {
            return Err(BufferWriteError::HttpBadRequest(format!(
                "Invalid json: {}",
                e
            )));
        }
    };
    let spans = match body.get("resourceSpans") {
        Some(json::Value::Array(v)) => v,
        _ => {
            return Err(BufferWriteError::HttpBadRequest(
                "Invalid json: the structure must be {{\"resourceSpans\":[]}}".to_string(),
            ));
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

        let mut record_id = 1;
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
                    value = flatten::flatten(value)
                        .map_err(|e| BufferWriteError::IoError(e.to_string()))?;

                    if !local_trans.is_empty() {
                        value = crate::service::ingestion::apply_stream_functions(
                            &local_trans,
                            value,
                            &stream_vrl_map,
                            &traces_stream_name,
                            &mut runtime,
                        )
                        .map_err(|e| BufferWriteError::IoError(e.to_string()))?;
                    }
                    // End row based transform */
                    // get json object
                    let mut record_val = match value.take() {
                        json::Value::Object(v) => v,
                        _ => unreachable!(),
                    };

                    record_val.insert(
                        CONFIG.common.column_timestamp.clone(),
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
                        record_id,
                        schema_key,
                        schema: Arc::new(rec_schema),
                        records: vec![],
                        records_size: 0,
                    });
                    record_id += 1;

                    // let record_val = record_val.to_owned();
                    let record_val = json::Value::Object(record_val);
                    let record_size = json::estimate_json_bytes(&record_val);
                    hour_buf.records.push(Arc::new(record_val));
                    hour_buf.records_size += record_size;
                }
            }
        }
    }

    Ok((
        data_buf,
        trigger,
        distinct_values,
        trace_index,
        partial_success,
    ))
}
