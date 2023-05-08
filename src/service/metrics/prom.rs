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

use actix_web::{http, HttpResponse};
use ahash::AHashMap;
use bytes::{BufMut, BytesMut};
use chrono::{Duration, TimeZone, Utc};
use datafusion::arrow::datatypes::Schema;
use prost::Message;
use std::time::Instant;
use std::{collections::HashMap, fs::OpenOptions, io::Error};
use tracing::info_span;

use crate::common::{json, time::parse_i64_to_timestamp_micros};
use crate::infra::config::{CONFIG, METRIC_CLUSTER_LEADER, METRIC_CLUSTER_MAP};
use crate::infra::file_lock;
use crate::infra::{cluster, metrics};
use crate::meta::alert::{Alert, Trigger};
use crate::meta::prom::*;
use crate::meta::{self, StreamType};
use crate::service::db;
use crate::service::schema::{add_stream_schema, set_schema_metadata, stream_schema_exists};

pub mod prometheus {
    include!(concat!(env!("OUT_DIR"), "/prometheus.rs"));
}

pub async fn remote_write(
    org_id: &str,
    thread_id: actix_web::web::Data<usize>,
    body: actix_web::web::Bytes,
) -> Result<HttpResponse, Error> {
    let start = Instant::now();
    let loc_span = info_span!("service:metrics::prom:remote_write");
    let _guard = loc_span.enter();
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Ok(
            HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                "not an ingester".to_string(),
            )),
        );
    }

    let mut min_ts =
        (Utc::now() + Duration::hours(CONFIG.limit.ingest_allowed_upto)).timestamp_micros();
    let dedup_enabled = CONFIG.common.metrics_dedup_enabled;
    let election_interval = CONFIG.limit.metrics_leader_election_interval * 1000000;
    let mut last_received: i64 = 0;
    let mut has_entry = false;
    let mut accept_record = false;
    let mut cluster_name: String = String::new();
    let mut metric_data_map: AHashMap<String, HashMap<String, Vec<String>>> = AHashMap::new();
    let mut metric_schema_map: AHashMap<String, Schema> = AHashMap::new();
    let mut stream_alerts_map: AHashMap<String, Vec<Alert>> = AHashMap::new();
    let mut stream_trigger_map: AHashMap<String, Trigger> = AHashMap::new();

    let decoded = snap::raw::Decoder::new()
        .decompress_vec(&body)
        .expect("Invalid snappy compressed data");
    let request =
        prometheus::WriteRequest::decode(bytes::Bytes::from(decoded)).expect("Invalid protobuf");

    // parse metadata
    for item in request.metadata {
        let metric_name = item.metric_family_name.clone();
        let metadata = Metadata {
            metric_family_name: item.metric_family_name.clone(),
            metric_type: item.r#type().as_str_name().into(),
            help: item.help.clone(),
            unit: item.unit.clone(),
        };
        let mut extra_metadata: AHashMap<String, String> = AHashMap::new();
        extra_metadata.insert(
            "prom_metadata".to_string(),
            json::to_string(&metadata).unwrap(),
        );
        set_schema_metadata(org_id, &metric_name, StreamType::Metrics, extra_metadata)
            .await
            .unwrap();
    }

    // maybe empty, we can return immediately
    if request.timeseries.is_empty() {
        return Ok(HttpResponse::Ok().into());
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
            if let Some(v) = labels_value(&event.labels, REPLICA_LABEL) {
                replica_label = v;
            };
            if cluster_name.is_empty() {
                if let Some(v) = labels_value(&event.labels, CLUSTER_LABEL) {
                    cluster_name = format!("{}/{}", org_id, v);
                }
            }
        }
        let labels: FxIndexMap<String, String> = event
            .labels
            .iter()
            .filter(|label| !label.name.eq(REPLICA_LABEL) && !label.name.eq(CLUSTER_LABEL))
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
            let metric = Metric {
                labels: labels.clone(),
                value: sample_val,
            };

            let mut timestamp = parse_i64_to_timestamp_micros(sample.timestamp).unwrap_or_default();
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
                return Ok(HttpResponse::Ok().into());
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
                    metric_name.clone(),
                    metric_schema_map.clone(),
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

            #[cfg(feature = "zo_functions")]
            let (lua, mut runtime) = crate::service::ingestion::init_functions_runtime();

            // Start Register Transforms for stream
            #[cfg(feature = "zo_functions")]
            let (local_tans, stream_lua_map, stream_vrl_map) =
                crate::service::ingestion::register_stream_transforms(
                    org_id,
                    &metric_name,
                    StreamType::Metrics,
                    &lua,
                );
            // End Register Transforms for stream

            #[cfg(not(feature = "zo_functions"))]
            let mut value: json::Value = json::to_value(&metric).unwrap();

            #[cfg(feature = "zo_functions")]
            let value: json::Value = json::to_value(&metric).unwrap();

            // Start row based transform
            #[cfg(feature = "zo_functions")]
            let mut value = crate::service::ingestion::apply_stream_transform(
                &local_tans,
                &value,
                &lua,
                &stream_lua_map,
                &stream_vrl_map,
                &metric_name,
                &mut runtime,
            );
            // End row based transform

            // get json object
            let val_map = value.as_object_mut().unwrap();
            let hash = super::signature_without_labels(val_map, &[VALUE_LABEL]);
            val_map.insert(HASH_LABEL.to_string(), json::Value::String(hash.into()));
            val_map.insert(
                CONFIG.common.time_stamp_col.clone(),
                json::Value::Number(timestamp.into()),
            );
            let value_str = crate::common::json::to_string(&val_map).unwrap();

            // get hour key
            let hour_key = crate::service::ingestion::get_hour_key(
                timestamp,
                partition_keys.clone(),
                value.as_object().unwrap().clone(),
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

    for (metric_name, metric_data) in metric_data_map {
        // write to file
        let mut metric_file_name = "".to_string();
        let mut write_buf = BytesMut::new();
        for (key, entry) in metric_data {
            if entry.is_empty() {
                continue;
            }

            // check if we are allowed to ingest
            if db::compact::delete::is_deleting_stream(
                org_id,
                &metric_name,
                StreamType::Metrics,
                None,
            ) {
                return Ok(HttpResponse::InternalServerError().json(
                    meta::http::HttpResponse::error(
                        http::StatusCode::INTERNAL_SERVER_ERROR.into(),
                        format!("stream [{metric_name}] is being deleted"),
                    ),
                ));
            }

            write_buf.clear();
            for row in &entry {
                write_buf.put(row.as_bytes());
                write_buf.put("\n".as_bytes());
            }
            let file = file_lock::get_or_create(
                *thread_id.as_ref(),
                org_id,
                &metric_name,
                StreamType::Metrics,
                &key,
                false,
            );
            if metric_file_name.is_empty() {
                metric_file_name = file.full_name();
            }
            file.write(write_buf.as_ref());

            // metrics
            metrics::INGEST_RECORDS
                .with_label_values(&[
                    org_id,
                    &metric_name,
                    StreamType::Metrics.to_string().as_str(),
                ])
                .inc_by(entry.len() as u64);
            metrics::INGEST_BYTES
                .with_label_values(&[
                    org_id,
                    &metric_name,
                    StreamType::Metrics.to_string().as_str(),
                ])
                .inc_by(write_buf.len() as u64);
        }

        let schema_exists = stream_schema_exists(
            org_id,
            &metric_name,
            StreamType::Metrics,
            &mut metric_schema_map,
        )
        .await;
        if !schema_exists.has_fields && !metric_file_name.is_empty() {
            let file = OpenOptions::new()
                .read(true)
                .open(&metric_file_name)
                .unwrap();
            add_stream_schema(
                org_id,
                &metric_name,
                StreamType::Metrics,
                &file,
                &mut metric_schema_map,
                min_ts,
            )
            .await;
        }
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
            "/prom/v1/write",
            "200",
            org_id,
            "",
            StreamType::Metrics.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            "/prom/v1/write",
            "200",
            org_id,
            "",
            StreamType::Metrics.to_string().as_str(),
        ])
        .inc();

    Ok(HttpResponse::Ok().into())
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
            ClusterLeader {
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
            log::info!(
                "Rejecting entry from {}  as leader is {}",
                replica_label,
                &leader.name,
            );
            _accept_record = false;
        }
    }
    let mut replica_list = vec![];
    if METRIC_CLUSTER_MAP.contains_key(&cluster_name) {
        replica_list = METRIC_CLUSTER_MAP.get_mut(&cluster_name).unwrap().to_vec();
        if !replica_list.contains(&replica_label.clone()) {
            replica_list.push(replica_label.clone());
            METRIC_CLUSTER_MAP.insert(cluster_name.clone(), replica_list.clone());
            let _ = db::set_prom_cluster_info(&cluster_name, replica_list.to_vec()).await;
        }
    } else {
        replica_list.push(replica_label.clone());
        METRIC_CLUSTER_MAP.insert(cluster_name.clone(), replica_list.clone());
        let _ = db::set_prom_cluster_info(&cluster_name, replica_list.to_vec()).await;
    }

    _accept_record
}

fn labels_value(labels: &[prometheus::Label], name: &str) -> Option<String> {
    labels
        .binary_search_by_key(&name, |label| label.name.as_str())
        .ok()
        .map(|index| labels[index].value.clone())
}
