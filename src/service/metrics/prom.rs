// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::web;
use ahash::AHashMap;
use chrono::{Duration, TimeZone, Utc};
use datafusion::arrow::datatypes::Schema;
use promql_parser::{label::MatchOp, parser};
use prost::Message;
use std::collections::HashMap;

use crate::common::{json, time::parse_i64_to_timestamp_micros};
use crate::infra::{
    cache::stats,
    cluster,
    config::{CONFIG, METRIC_CLUSTER_LEADER, METRIC_CLUSTER_MAP},
    errors::{Error, Result},
    metrics,
};
use crate::meta::functions::StreamTransform;
use crate::meta::usage::{RequestStats, UsageType};
use crate::meta::{
    self,
    alert::{Alert, Trigger},
    prom::{self, HASH_LABEL, METADATA_LABEL, NAME_LABEL, VALUE_LABEL},
    StreamType,
};
use crate::service::usage::report_usage_stats;
use crate::service::{
    db,
    ingestion::{chk_schema_by_record, write_file},
    schema::{set_schema_metadata, stream_schema_exists},
    search as search_service,
};

pub(crate) mod prometheus {
    include!(concat!(env!("OUT_DIR"), "/prometheus.rs"));
}

pub async fn remote_write(
    org_id: &str,
    thread_id: usize,
    body: web::Bytes,
) -> std::result::Result<(), anyhow::Error> {
    let start = std::time::Instant::now();
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Err(anyhow::anyhow!("not an ingester"));
    }

    if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id) {
        return Err(anyhow::anyhow!("Quota exceeded for this organisation"));
    }

    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();
    let dedup_enabled = CONFIG.common.metrics_dedup_enabled;
    let election_interval = CONFIG.limit.metrics_leader_election_interval * 1000000;
    let mut last_received: i64 = 0;
    let mut has_entry = false;
    let mut accept_record = false;
    let mut cluster_name: String = String::new();
    let mut metric_data_map: AHashMap<String, AHashMap<String, Vec<String>>> = AHashMap::new();
    let mut metric_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut stream_trigger_map: AHashMap<String, Trigger> = AHashMap::new();
    let mut stream_transform_map: AHashMap<String, Vec<StreamTransform>> = AHashMap::new();
    let mut final_req_stats = RequestStats::default();

    let decoded = snap::raw::Decoder::new()
        .decompress_vec(&body)
        .map_err(|e| anyhow::anyhow!("Invalid snappy compressed data: {}", e.to_string()))?;
    let request = prometheus::WriteRequest::decode(bytes::Bytes::from(decoded))
        .map_err(|e| anyhow::anyhow!("Invalid protobuf: {}", e.to_string()))?;

    // parse metadata
    for item in request.metadata {
        let metric_name = item.metric_family_name.clone();
        let metadata = prom::Metadata {
            metric_family_name: item.metric_family_name.clone(),
            metric_type: item.r#type().into(),
            help: item.help.clone(),
            unit: item.unit.clone(),
        };
        let mut extra_metadata: AHashMap<String, String> = AHashMap::new();
        extra_metadata.insert(
            METADATA_LABEL.to_string(),
            json::to_string(&metadata).unwrap(),
        );
        set_schema_metadata(org_id, &metric_name, StreamType::Metrics, extra_metadata)
            .await
            .unwrap();
    }

    // maybe empty, we can return immediately
    if request.timeseries.is_empty() {
        return Ok(());
    }

    // parse timeseries
    let mut first_line = true;
    for event in request.timeseries {
        // get labels
        let mut replica_label = String::new();
        let metric_name = match labels_value(&event.labels, NAME_LABEL) {
            Some(v) => v,
            None => continue,
        };
        if !has_entry {
            if let Some(v) = labels_value(&event.labels, &CONFIG.prom.ha_replica_label) {
                replica_label = v;
            };
            if cluster_name.is_empty() {
                if let Some(v) = labels_value(&event.labels, &CONFIG.prom.ha_cluster_label) {
                    cluster_name = format!("{}/{}", org_id, v);
                }
            }
        }
        let labels: prom::FxIndexMap<String, String> = event
            .labels
            .iter()
            .filter(|label| {
                label.name != CONFIG.prom.ha_replica_label
                    && label.name != CONFIG.prom.ha_cluster_label
            })
            .map(|label| (label.name.clone(), label.value.clone()))
            .collect();

        let buf = metric_data_map.entry(metric_name.clone()).or_default();

        // parse samples
        for sample in event.samples {
            let mut sample_val = sample.value;
            // revisit in future
            if sample_val.is_infinite() {
                if sample_val == f64::INFINITY || sample_val > f64::MAX {
                    sample_val = f64::MAX;
                } else if sample_val == f64::NEG_INFINITY || sample_val < f64::MIN {
                    sample_val = f64::MIN;
                }
            } else if sample_val.is_nan() {
                // skip the entry from adding to store
                continue;
            }
            let metric = prom::Metric {
                labels: labels.clone(),
                value: sample_val,
            };

            let mut timestamp = parse_i64_to_timestamp_micros(sample.timestamp);
            if timestamp == 0 {
                timestamp = Utc::now().timestamp_micros();
            }
            if timestamp < min_ts {
                min_ts = timestamp;
            }

            if first_line && dedup_enabled {
                match METRIC_CLUSTER_LEADER.get(&cluster_name) {
                    Some(leader) => {
                        last_received = leader.last_received;
                        has_entry = true;
                    }
                    None => {
                        has_entry = false;
                    }
                }
                accept_record = prom_ha_handler(
                    has_entry,
                    cluster_name.clone(),
                    replica_label.clone(),
                    last_received,
                    election_interval,
                )
                .await;
                has_entry = true;
                first_line = false;
            }
            if !accept_record {
                //do not accept any entries for request
                return Ok(());
            }

            // get partition keys
            let stream_schema = stream_schema_exists(
                org_id,
                &metric_name,
                StreamType::Metrics,
                &mut metric_schema_map,
            )
            .await;
            let mut partition_keys: Vec<String> = vec![];
            if stream_schema.has_partition_keys {
                partition_keys = crate::service::ingestion::get_stream_partition_keys(
                    &metric_name,
                    &metric_schema_map,
                )
                .await;
            }

            // Start get stream alerts
            let key = format!(
                "{}/{}/{}",
                &org_id,
                StreamType::Metrics,
                metric_name.clone()
            );
            crate::service::ingestion::get_stream_alerts(key, &mut stream_alerts_map).await;
            // End get stream alert

            let mut runtime = crate::service::ingestion::init_functions_runtime();

            // Start Register Transforms for stream

            let (local_trans, stream_vrl_map) =
                crate::service::ingestion::register_stream_transforms(
                    org_id,
                    StreamType::Metrics,
                    &metric_name,
                );

            stream_transform_map.insert(metric_name.to_owned(), local_trans.clone());
            // End Register Transforms for stream

            let mut value: json::Value = json::to_value(&metric).unwrap();

            // Start row based transform

            value = crate::service::ingestion::apply_stream_transform(
                &local_trans,
                &value,
                &stream_vrl_map,
                &metric_name,
                &mut runtime,
            )?;

            // End row based transform

            // get json object
            let val_map = value.as_object_mut().unwrap();
            let hash = super::signature_without_labels(val_map, &[VALUE_LABEL]);
            val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
            val_map.insert(
                CONFIG.common.column_timestamp.clone(),
                json::Value::Number(timestamp.into()),
            );
            let value_str = crate::common::json::to_string(&val_map).unwrap();
            chk_schema_by_record(
                &mut metric_schema_map,
                org_id,
                StreamType::Metrics,
                &metric_name,
                timestamp,
                &value_str,
            )
            .await;

            // get hour key
            let hour_key = crate::service::ingestion::get_hour_key(
                timestamp,
                partition_keys.clone(),
                value.as_object().unwrap(),
                None,
            );
            let hour_buf = buf.entry(hour_key.clone()).or_default();
            hour_buf.push(value_str);

            // real time alert
            if !stream_alerts_map.is_empty() {
                // Start check for alert trigger
                let key = format!(
                    "{}/{}/{}",
                    &org_id,
                    StreamType::Metrics,
                    metric_name.clone()
                );
                if let Some(alerts) = stream_alerts_map.get(&key) {
                    for alert in alerts {
                        if alert.is_real_time {
                            let set_trigger = meta::alert::Evaluate::evaluate(
                                &alert.condition,
                                value.as_object().unwrap().clone(),
                            );
                            if set_trigger {
                                stream_trigger_map.insert(
                                    metric_name.clone(),
                                    Trigger {
                                        timestamp,
                                        is_valid: true,
                                        alert_name: alert.name.clone(),
                                        stream: metric_name.clone().to_string(),
                                        org: org_id.to_string(),
                                        stream_type: StreamType::Metrics,
                                        last_sent_at: 0,
                                        count: 0,
                                        is_ingest_time: true,
                                    },
                                );
                            }
                        }
                    }
                }
                // End check for alert trigger
            }
        }
    }

    for (stream_name, stream_data) in metric_data_map {
        // write to file
        let mut stream_file_name = "".to_string();

        // check if we are allowed to ingest
        if db::compact::retention::is_deleting_stream(
            org_id,
            &stream_name,
            StreamType::Metrics,
            None,
        ) {
            return Err(anyhow::anyhow!("stream [{stream_name}] is being deleted"));
        }

        let req_stats = write_file(
            stream_data,
            thread_id,
            org_id,
            &stream_name,
            &mut stream_file_name,
            StreamType::Metrics,
        );
        final_req_stats.size += req_stats.size;
        final_req_stats.records += req_stats.records;

        let _schema_exists = stream_schema_exists(
            org_id,
            &stream_name,
            StreamType::Metrics,
            &mut metric_schema_map,
        )
        .await;
    }

    // only one trigger per request, as it updates etcd
    for (_, entry) in &stream_trigger_map {
        let mut alerts = stream_alerts_map
            .get(&format!(
                "{}/{}/{}",
                entry.org,
                StreamType::Metrics,
                entry.stream
            ))
            .unwrap()
            .clone();

        alerts.retain(|alert| alert.name.eq(&entry.alert_name));
        if !alerts.is_empty() {
            crate::service::ingestion::send_ingest_notification(
                entry.clone(),
                alerts.first().unwrap().clone(),
            )
            .await;
        }
    }

    let time = start.elapsed().as_secs_f64();
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            "/prometheus/api/v1/write",
            "200",
            org_id,
            "",
            &StreamType::Metrics.to_string(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/prometheus/api/v1/write",
            "200",
            org_id,
            "",
            &StreamType::Metrics.to_string(),
        ])
        .inc();
    final_req_stats.response_time += time;
    //metric + data usage
    let fns_length: usize = stream_transform_map.values().map(|v| v.len()).sum();
    report_usage_stats(
        final_req_stats,
        org_id,
        StreamType::Metrics,
        UsageType::Metrics,
        fns_length as u16,
    )
    .await;

    Ok(())
}

pub(crate) async fn get_metadata(
    org_id: &str,
    req: prom::RequestMetadata,
) -> Result<prom::ResponseMetadata> {
    if req.limit == Some(0) {
        return Ok(AHashMap::new());
    }

    let stream_type = StreamType::Metrics;

    if let Some(metric_name) = req.metric {
        let schema = db::schema::get(org_id, &metric_name, stream_type)
            .await
            // `db::schema::get` never fails, so it's safe to unwrap
            .unwrap();
        let resp = if schema == Schema::empty() {
            AHashMap::new()
        } else {
            AHashMap::from([(
                metric_name,
                get_metadata_object(&schema).map_or_else(Vec::new, |obj| vec![obj]),
            )])
        };
        return Ok(resp);
    }

    match db::schema::list(org_id, Some(stream_type), true).await {
        Err(error) => {
            tracing::error!(%stream_type, ?error, "failed to get metrics' stream schemas");
            Err(Error::Message(format!(
                "failed to get metrics' stream schemas: {error}"
            )))
        }
        Ok(stream_schemas) => {
            let metric_names = stream_schemas.into_iter().filter_map(|schema| {
                get_metadata_object(&schema.schema).map(|meta| (schema.stream_name, vec![meta]))
            });
            Ok(match req.limit {
                None => metric_names.collect(),
                Some(limit) => metric_names.take(limit).collect(),
            })
        }
    }
}

// HACK: the implementation returns at most one metadata object per metric.
// This differs from Prometheus, which [supports] multiple metadata objects per metric.
//
// [supports]: https://prometheus.io/docs/prometheus/latest/querying/api/#querying-metric-metadata
fn get_metadata_object(schema: &Schema) -> Option<prom::MetadataObject> {
    schema.metadata.get(METADATA_LABEL).map(|s| {
        serde_json::from_str::<prom::Metadata>(s)
            .unwrap_or_else(|error| {
                tracing::error!(%error, input = ?s, "failed to parse metadata");
                panic!("BUG: failed to parse {METADATA_LABEL}")
            })
            .into()
    })
}

pub(crate) async fn get_series(
    org_id: &str,
    selector: Option<parser::VectorSelector>,
    start: i64,
    end: i64,
) -> Result<Vec<serde_json::Value>> {
    let metric_name = match selector.as_ref().and_then(try_into_metric_name) {
        Some(name) => name,
        None => {
            // HACK: in the ideal world we would have queried all the metric streams
            return Ok(vec![]);
        }
    };

    let schema = db::schema::get(org_id, &metric_name, StreamType::Metrics)
        .await
        // `db::schema::get` never fails, so it's safe to unwrap
        .unwrap();

    // Comma-separated list of label names
    let label_names = schema
        .fields()
        .iter()
        .map(|f| f.name().as_str())
        .filter(|&s| s != CONFIG.common.column_timestamp && s != VALUE_LABEL && s != HASH_LABEL)
        .collect::<Vec<_>>()
        .join(", ");
    if label_names.is_empty() {
        return Ok(vec![]);
    }

    let mut sql = format!("SELECT DISTINCT({HASH_LABEL}), {label_names} FROM {metric_name}");
    let mut sql_where = Vec::new();
    if let Some(selector) = selector {
        for mat in selector.matchers.matchers.iter() {
            if mat.name == CONFIG.common.column_timestamp
                || mat.name == VALUE_LABEL
                || schema.field_with_name(&mat.name).is_err()
            {
                continue;
            }
            match &mat.op {
                MatchOp::Equal => {
                    sql_where.push(format!("{} = '{}'", mat.name, mat.value));
                }
                MatchOp::NotEqual => {
                    sql_where.push(format!("{} != '{}'", mat.name, mat.value));
                }
                MatchOp::Re(_re) => {
                    sql_where.push(format!("re_match({}, '{}')", mat.name, mat.value));
                }
                MatchOp::NotRe(_re) => {
                    sql_where.push(format!("re_not_match({}, '{}')", mat.name, mat.value));
                }
            }
        }
        if !sql_where.is_empty() {
            sql.push_str(" WHERE ");
            sql.push_str(&sql_where.join(" AND "));
        }
    }

    let req = meta::search::Request {
        query: meta::search::Query {
            sql,
            from: 0,
            size: 1000,
            start_time: start,
            end_time: end,
            sql_mode: "full".to_string(),
            ..Default::default()
        },
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
    };
    let series = match search_service::search(org_id, StreamType::Metrics, &req).await {
        Err(err) => {
            log::error!("search series error: {err}");
            return Err(err);
        }
        Ok(resp) => resp
            .hits
            .into_iter()
            .map(|mut val| {
                if let Some(map) = val.as_object_mut() {
                    map.remove(HASH_LABEL);
                }
                val
            })
            .collect(),
    };
    Ok(series)
}

pub(crate) async fn get_labels(
    org_id: &str,
    selector: Option<parser::VectorSelector>,
    start: i64,
    end: i64,
) -> Result<Vec<String>> {
    let opt_metric_name = selector.as_ref().and_then(try_into_metric_name);
    let stream_schemas = match db::schema::list(org_id, Some(StreamType::Metrics), true).await {
        Err(_) => return Ok(vec![]),
        Ok(schemas) => schemas,
    };
    let mut label_names = ahash::HashSet::default();
    for schema in stream_schemas {
        if let Some(ref metric_name) = opt_metric_name {
            if *metric_name != schema.stream_name {
                // Client has requested a particular metric name, but this stream is
                // not it.
                continue;
            }
        }
        let stats = stats::get_stream_stats(org_id, &schema.stream_name, StreamType::Metrics);
        if stats.time_range_intersects(start, end) {
            let field_names = schema
                .schema
                .fields()
                .iter()
                .map(|f| f.name())
                .filter(|&s| {
                    s != &CONFIG.common.column_timestamp && s != VALUE_LABEL && s != HASH_LABEL
                })
                .cloned();
            label_names.extend(field_names);
        }
    }
    let mut label_names = label_names.into_iter().collect::<Vec<_>>();
    label_names.sort();
    Ok(label_names)
}

// XXX-TODO: filter the results in accordance with `selector.matchers`
pub(crate) async fn get_label_values(
    org_id: &str,
    label_name: String,
    selector: Option<parser::VectorSelector>,
    start: i64,
    end: i64,
) -> Result<Vec<String>> {
    let opt_metric_name = selector.as_ref().and_then(try_into_metric_name);
    let stream_type = StreamType::Metrics;

    if label_name == NAME_LABEL {
        // This special case doesn't require any SQL to be executed. All we have
        // to do is to collect stream names that satisfy selection criteria
        // (i.e., `selector` and `start`/`end`) and return them.
        let stream_schemas = db::schema::list(org_id, Some(stream_type), false)
            .await
            .unwrap_or_default();
        let mut label_values = Vec::with_capacity(stream_schemas.len());
        for schema in stream_schemas {
            if let Some(ref metric_name) = opt_metric_name {
                if *metric_name != schema.stream_name {
                    // Client has requested a particular metric name, but this stream is
                    // not it.
                    continue;
                }
            }
            let stats = stats::get_stream_stats(org_id, &schema.stream_name, stream_type);
            if stats.time_range_intersects(start, end) {
                label_values.push(schema.stream_name.clone())
            }
        }
        label_values.sort();
        return Ok(label_values);
    }

    let metric_name = match opt_metric_name {
        Some(name) => name,
        None => {
            // HACK: in the ideal world we would have queried all the metric streams
            // and collected label names from them.
            return Ok(vec![]);
        }
    };

    let schema = db::schema::get(org_id, &metric_name, stream_type)
        .await
        // `db::schema::get` never fails, so it's safe to unwrap
        .unwrap();
    if schema.fields().is_empty() {
        return Ok(vec![]);
    }
    if schema.field_with_name(&label_name).is_err() {
        return Ok(vec![]);
    }
    let req = meta::search::Request {
        query: meta::search::Query {
            sql: format!("SELECT DISTINCT({label_name}) FROM {metric_name}"),
            from: 0,
            size: 1000,
            start_time: start,
            end_time: end,
            sql_mode: "full".to_string(),
            ..Default::default()
        },
        aggs: HashMap::new(),
        encoding: meta::search::RequestEncoding::Empty,
    };
    let mut label_values = match search_service::search(org_id, stream_type, &req).await {
        Ok(resp) => resp
            .hits
            .iter()
            .filter_map(|v| v.as_object().unwrap().get(&label_name))
            .map(|v| v.as_str().unwrap().to_string())
            .collect::<Vec<_>>(),
        Err(err) => {
            log::error!("search values error: {:?}", err);
            return Err(err);
        }
    };
    label_values.sort();
    label_values.dedup();
    Ok(label_values)
}

fn try_into_metric_name(selector: &parser::VectorSelector) -> Option<String> {
    match &selector.name {
        Some(name) => {
            // `match[]` argument contains a metric name, e.g.
            // `match[]=zo_response_code{method="GET"}`
            Some(name.clone())
        }
        None => {
            // `match[]` argument does not contain a metric name.
            // Check if there is `__name__` among the matchers,
            // e.g. `match[]={__name__="zo_response_code",method="GET"}`
            let mut labels = selector.matchers.find_matchers(NAME_LABEL);
            labels.pop().map(|s| s.to_owned())
        }
    }
}

async fn prom_ha_handler(
    has_entry: bool,
    cluster_name: String,
    replica_label: String,
    last_received: i64,
    election_interval: i64,
) -> bool {
    let mut _accept_record = false;
    let curr_ts = Utc::now().timestamp_micros();
    if !has_entry {
        METRIC_CLUSTER_MAP.insert(cluster_name.clone(), vec![]);
        log::info!(
            "Making {} leader for {} ",
            replica_label.clone(),
            cluster_name.clone(),
        );
        METRIC_CLUSTER_LEADER.insert(
            cluster_name.clone(),
            prom::ClusterLeader {
                name: replica_label.clone(),
                last_received: curr_ts,
            },
        );
        _accept_record = true;
    } else {
        let mut leader = METRIC_CLUSTER_LEADER
            .get_mut(&cluster_name.clone())
            .unwrap();
        if replica_label.eq(&leader.name) {
            _accept_record = true;
            leader.last_received = curr_ts;
            // log::info!(  "Updating last received data for {} to {}", &leader.name, Utc.timestamp_nanos(last_received * 1000));
        } else if curr_ts - last_received > election_interval {
            //elect new leader as didnt receive data for last 30 secs
            log::info!(
                "Electing {} new leader for {} as last received data from {} at {} ",
                replica_label.clone(),
                cluster_name,
                &leader.name,
                Utc.timestamp_nanos(last_received * 1000)
            );
            leader.name = replica_label.clone();
            leader.last_received = curr_ts;
            _accept_record = true;
        } else {
            // log::info!(
            //     "Rejecting entry from {}  as leader is {}",
            //     replica_label,
            //     &leader.name,
            // );
            _accept_record = false;
        }
    }
    let mut replica_list = vec![];
    if METRIC_CLUSTER_MAP.contains_key(&cluster_name) {
        replica_list = METRIC_CLUSTER_MAP.get_mut(&cluster_name).unwrap().to_vec();
        if !replica_list.contains(&replica_label.clone()) {
            replica_list.push(replica_label.clone());
            METRIC_CLUSTER_MAP.insert(cluster_name.clone(), replica_list.clone());
            let _ = db::metrics::set_prom_cluster_info(&cluster_name, replica_list.to_vec()).await;
        }
    } else {
        replica_list.push(replica_label.clone());
        METRIC_CLUSTER_MAP.insert(cluster_name.clone(), replica_list.clone());
        let _ = db::metrics::set_prom_cluster_info(&cluster_name, replica_list.to_vec()).await;
    }

    _accept_record
}

fn labels_value(labels: &[prometheus::Label], name: &str) -> Option<String> {
    labels
        .binary_search_by_key(&name, |label| label.name.as_str())
        .ok()
        .map(|index| labels[index].value.clone())
}
