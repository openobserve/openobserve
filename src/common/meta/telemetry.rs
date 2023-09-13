// Copyright 2023 Zinc Labs Inc.
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

use segment::{message::Track, Client, Message};
use std::collections::HashMap;
use sysinfo::SystemExt;

use crate::common::infra::db;
use crate::common::infra::{cache::stats, config::*};
use crate::common::utils::json;

#[derive(Clone, Debug, Default)]
pub struct Telemetry {
    pub instance_id: String,
    pub event: Track,
    pub base_info: HashMap<String, json::Value>,
}

impl Telemetry {
    pub fn new() -> Self {
        Telemetry {
            instance_id: "".to_string(),
            event: Track::default(),
            base_info: get_base_info(&mut HashMap::new()),
        }
    }

    pub fn add_event(&mut self, track: Track) {
        self.event = track;
    }

    pub async fn event(
        &mut self,
        event: &str,
        data: Option<HashMap<String, json::Value>>,
        send_zo_data: bool,
    ) {
        if !CONFIG.common.telemetry_enabled {
            return;
        }
        log::info!("sending event {}", event);
        let mut props = self.base_info.clone();
        if data.is_some() {
            for item in data.unwrap() {
                props.insert(item.0, item.1);
            }
        }
        if send_zo_data {
            props = add_zo_info(props).await;
        }
        self.add_event(Track {
            user: segment::message::User::UserId {
                user_id: segment::message::User::AnonymousId {
                    anonymous_id: INSTANCE_ID.get("instance_id").unwrap().to_string(),
                }
                .to_string(),
            },
            event: event.to_string(),
            properties: json::to_value(props).unwrap(),
            timestamp: Some(time::OffsetDateTime::now_utc()),
            ..Default::default()
        });

        let res = TELEMETRY_CLIENT
            .send(
                INSTANCE_ID.get("instance_id").unwrap().to_string(),
                Message::from(self.event.clone()),
            )
            .await;

        if res.is_err() {
            log::error!("Error sending event {}, {:?}", event, res);
        }
    }

    pub async fn heart_beat(&mut self, event: &str, data: Option<HashMap<String, json::Value>>) {
        self.event(event, data, true).await;
    }
}

pub fn get_base_info(data: &mut HashMap<String, json::Value>) -> HashMap<String, json::Value> {
    let system = sysinfo::System::new_all();
    data.insert("cpu_count".to_string(), system.cpus().len().into());
    data.insert("total_memory".to_string(), system.total_memory().into());
    data.insert("free_memory".to_string(), system.free_memory().into());
    data.insert("os".to_string(), system.name().into());
    data.insert("os_release".to_string(), system.os_version().into());
    data.insert(
        "time_zone".to_string(),
        chrono::Local::now().offset().local_minus_utc().into(),
    );
    data.insert(
        "host_name".to_string(),
        CONFIG.common.instance_name.clone().into(),
    );

    data.insert("zo_version".to_string(), VERSION.to_owned().into());

    data.clone()
}

pub async fn add_zo_info(mut data: HashMap<String, json::Value>) -> HashMap<String, json::Value> {
    let db = &db::DEFAULT;
    let iter = STREAM_SCHEMAS.iter().clone();
    let mut num_streams = 0;
    let mut logs_streams = 0;
    let mut metrics_streams = 0;
    for item in iter {
        num_streams += item.value().len();
        let stream_type = item.key().split('/').collect::<Vec<&str>>();
        if stream_type.len() < 2 {
            continue;
        }
        match stream_type[1] {
            "logs" => logs_streams += 1,
            "metrics" => metrics_streams += 1,
            _ => (),
        }
    }
    data.insert("num_org".to_string(), STREAM_SCHEMAS.len().into());
    data.insert("num_streams".to_string(), num_streams.into());
    data.insert("num_logs_streams".to_string(), logs_streams.into());
    data.insert("num_metrics_streams".to_string(), metrics_streams.into());
    data.insert("num_users".to_string(), USERS.len().into());
    data.insert(
        "is_local_mode".to_string(),
        json::Value::Bool(CONFIG.common.local_mode),
    );
    if CONFIG.common.local_mode {
        data.insert(
            "local_mode_storage".to_string(),
            CONFIG.common.local_mode_storage.clone().into(),
        );
    }
    match db.list_keys("/dashboard/").await {
        Ok(keys) => {
            data.insert("num_dashboards".to_string(), keys.len().into());
        }
        Err(e) => {
            log::error!("Error getting dashboards {}", e);
        }
    }

    let roles = crate::common::infra::cluster::load_local_node_role();
    if !crate::common::infra::cluster::is_single_node(&roles) {
        match crate::common::infra::cluster::get_cached_online_nodes() {
            Some(nodes) => {
                data.insert("is_HA_mode".to_string(), json::Value::Bool(true));
                data.insert("number_of_nodes".to_string(), nodes.len().into());
            }
            None => {
                data.insert("is_HA_mode".to_string(), json::Value::Bool(false));
            }
        }
    }
    let mut streams_orig_size: f64 = 0.0;
    let mut streams_compressed_size: f64 = 0.0;
    let mut logs_orig_size: f64 = 0.0;
    let mut logs_compressed_size: f64 = 0.0;
    let mut metrics_orig_size: f64 = 0.0;
    let mut metrics_compressed_size: f64 = 0.0;
    let mut traces_orig_size: f64 = 0.0;
    let mut traces_compressed_size: f64 = 0.0;
    for stats in stats::get_stats().iter() {
        streams_orig_size += stats.storage_size;
        streams_compressed_size += stats.compressed_size;

        let stream_type = stats.key().split('/').collect::<Vec<&str>>();
        if stream_type.len() < 2 {
            continue;
        }
        match stream_type[1] {
            "logs" => {
                logs_orig_size += stats.storage_size;
                logs_compressed_size += stats.compressed_size;
            }
            "metrics" => {
                metrics_orig_size += stats.storage_size;
                metrics_compressed_size += stats.compressed_size;
            }
            "traces" => {
                traces_orig_size += stats.storage_size;
                traces_compressed_size += stats.compressed_size;
            }
            _ => (),
        }
    }
    data.insert(
        "streams_total_size_mb".to_string(),
        format!("{:.0}", (streams_orig_size / SIZE_IN_MB)).into(),
    );
    data.insert(
        "streams_compressed_size_mb".to_string(),
        format!("{:.0}", (streams_compressed_size / SIZE_IN_MB)).into(),
    );
    data.insert(
        "metrics_orig_size".to_string(),
        format!("{:.0}", (metrics_orig_size / SIZE_IN_MB)).into(),
    );
    data.insert(
        "metrics_compressed_size".to_string(),
        format!("{:.0}", (metrics_compressed_size / SIZE_IN_MB)).into(),
    );
    data.insert(
        "logs_orig_size".to_string(),
        format!("{:.0}", (logs_orig_size / SIZE_IN_MB)).into(),
    );
    data.insert(
        "logs_compressed_size".to_string(),
        format!("{:.0}", (logs_compressed_size / SIZE_IN_MB)).into(),
    );
    data.insert(
        "traces_orig_size".to_string(),
        format!("{:.0}", (traces_orig_size / SIZE_IN_MB)).into(),
    );
    data.insert(
        "traces_compressed_size".to_string(),
        format!("{:.0}", (traces_compressed_size / SIZE_IN_MB)).into(),
    );

    let iter = STREAM_FUNCTIONS.iter().clone();
    let mut ingest_functions = 0;
    for item in iter {
        ingest_functions += item.value().list.len()
    }
    data.insert("num_ingest_functions".to_string(), ingest_functions.into());
    data.insert(
        "num_query_functions".to_string(),
        QUERY_FUNCTIONS.len().into(),
    );

    let mut rt_alerts = 0;
    let mut scheduled_alerts = 0;
    let iter = STREAM_ALERTS.iter().clone();

    for item in iter {
        for alert in &item.value().list {
            if alert.is_real_time {
                rt_alerts += 1
            } else {
                scheduled_alerts += 1
            }
        }
    }
    data.insert("real_time_alerts".to_string(), rt_alerts.into());
    data.insert("scheduled_alerts".to_string(), scheduled_alerts.into());
    data
}

#[cfg(test)]
mod test_telemetry {
    use super::*;

    #[actix_web::test]
    async fn test_telemetry_new() {
        let tel = Telemetry::new();
        let props = tel.base_info.clone();
        add_zo_info(props).await;
        assert!(tel.base_info.len() > 0)
    }
}
