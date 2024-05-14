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

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Arc,
};

use anyhow::{anyhow, Result};
use chrono::{Duration, TimeZone, Utc};
use config::{
    cluster,
    meta::{
        stream::{PartitionTimeLevel, PartitioningDetails, Routing, StreamPartition, StreamType},
        usage::{RequestStats, TriggerData, TriggerDataStatus, TriggerDataType},
    },
    utils::{flatten, json::*},
    CONFIG, SIZE_IN_MB,
};
use vector_enrichment::TableRegistry;
use vrl::{
    compiler::{runtime::Runtime, CompilationResult, TargetValueRef},
    prelude::state,
};

use super::usage::publish_triggers_usage;
use crate::{
    common::{
        infra::config::{
            REALTIME_ALERT_TRIGGERS, STREAM_ALERTS, STREAM_FUNCTIONS, STREAM_PIPELINES,
        },
        meta::{
            alerts::Alert,
            functions::{StreamTransform, VRLResultResolver, VRLRuntimeConfig},
            stream::{SchemaRecords, StreamParams},
        },
        utils::functions::get_vrl_compiler_config,
    },
    service::{db, format_partition_key},
};

pub mod grpc;

pub type TriggerAlertData = Vec<(Alert, Vec<Map<String, Value>>)>;

pub fn compile_vrl_function(func: &str, org_id: &str) -> Result<VRLRuntimeConfig, std::io::Error> {
    if func.contains("get_env_var") {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "get_env_var is not supported",
        ));
    }

    let external = state::ExternalEnv::default();
    let vrl_config = get_vrl_compiler_config(org_id);
    match vrl::compiler::compile_with_external(
        func,
        &vrl_config.functions,
        &external,
        vrl_config.config,
    ) {
        Ok(CompilationResult {
            program,
            warnings: _,
            config,
        }) => Ok(VRLRuntimeConfig {
            program,
            config,
            fields: vec![],
        }),
        Err(e) => Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            vrl::diagnostic::Formatter::new(func, e).to_string(),
        )),
    }
}

pub fn apply_vrl_fn(runtime: &mut Runtime, vrl_runtime: &VRLResultResolver, row: &Value) -> Value {
    let mut metadata = vrl::value::Value::from(BTreeMap::new());
    let mut target = TargetValueRef {
        value: &mut vrl::value::Value::from(row),
        metadata: &mut metadata,
        secrets: &mut vrl::value::Secrets::new(),
    };
    let timezone = vrl::compiler::TimeZone::Local;
    let result = match vrl::compiler::VrlRuntime::default() {
        vrl::compiler::VrlRuntime::Ast => {
            runtime.resolve(&mut target, &vrl_runtime.program, &timezone)
        }
    };
    match result {
        Ok(res) => match res.try_into() {
            Ok(val) => val,
            Err(err) => {
                log::error!("Returning original row , got error from vrl {:?}", err);
                row.clone()
            }
        },
        Err(err) => {
            log::error!("Returning original row , got error from vrl {:?}", err);
            row.clone()
        }
    }
}

pub async fn get_stream_functions<'a>(
    streams: &[StreamParams],
    stream_functions_map: &mut HashMap<String, Vec<StreamTransform>>,
    stream_vrl_map: &mut HashMap<String, VRLResultResolver>,
) {
    for stream in streams {
        let key = format!(
            "{}/{}/{}",
            stream.org_id, stream.stream_type, stream.stream_name
        );
        if stream_functions_map.contains_key(&key) {
            return;
        }
        //   let mut _local_trans: Vec<StreamTransform> = vec![];
        // let local_stream_vrl_map;
        let (_local_trans, local_stream_vrl_map) =
            crate::service::ingestion::register_stream_functions(
                &stream.org_id,
                &stream.stream_type,
                &stream.stream_name,
            );
        stream_vrl_map.extend(local_stream_vrl_map);

        stream_functions_map.insert(key, _local_trans);
    }
}

pub async fn get_stream_partition_keys(
    org_id: &str,
    stream_type: &StreamType,
    stream_name: &str,
) -> PartitioningDetails {
    let stream_settings = infra::schema::get_settings(org_id, stream_name, *stream_type)
        .await
        .unwrap_or_default();
    PartitioningDetails {
        partition_keys: stream_settings.partition_keys,
        partition_time_level: stream_settings.partition_time_level,
    }
}

pub async fn get_stream_alerts(
    streams: &[StreamParams],
    stream_alerts_map: &mut HashMap<String, Vec<Alert>>,
) {
    for stream in streams {
        let key = format!(
            "{}/{}/{}",
            stream.org_id, stream.stream_type, stream.stream_name
        );
        if stream_alerts_map.contains_key(&key) {
            return;
        }

        let alerts_cacher = STREAM_ALERTS.read().await;
        let alerts_list = alerts_cacher.get(&key);
        if alerts_list.is_none() {
            return;
        }
        let triggers_cache = REALTIME_ALERT_TRIGGERS.read().await;
        let alerts = alerts_list
            .unwrap()
            .iter()
            .filter(|alert| alert.enabled && alert.is_real_time)
            .filter(|alert| {
                let key = format!("{}/{}", key, alert.name);
                match triggers_cache.get(&key) {
                    Some(v) => !v.is_silenced,
                    None => true,
                }
            })
            .cloned()
            .collect::<Vec<_>>();

        stream_alerts_map.insert(key, alerts);
    }
}

pub async fn evaluate_trigger(trigger: Option<TriggerAlertData>) {
    if trigger.is_none() {
        return;
    }
    let trigger = trigger.unwrap();
    let mut trigger_usage_reports = vec![];
    for (alert, val) in trigger.iter() {
        let module_key = format!(
            "{}/{}/{}",
            &alert.stream_type, &alert.stream_name, &alert.name
        );
        let now = Utc::now().timestamp_micros();
        let mut trigger_data_stream = TriggerData {
            org: alert.org_id.to_string(),
            module: TriggerDataType::Alert,
            key: module_key.clone(),
            next_run_at: now,
            is_realtime: true,
            is_silenced: false,
            status: TriggerDataStatus::Completed,
            start_time: now,
            end_time: 0,
            retries: 0,
            error: None,
        };
        if let Err(e) = alert.send_notification(val).await {
            log::error!("Failed to send notification: {}", e);
            trigger_data_stream.status = TriggerDataStatus::Failed;
            trigger_data_stream.error = Some(format!("error sending notification for alert: {e}"));
        } else if alert.trigger_condition.silence > 0 {
            log::debug!(
                "Realtime alert {}/{}/{}/{} triggered successfully, hence applying silence period",
                &alert.org_id,
                &alert.stream_type,
                &alert.stream_name,
                &alert.name
            );

            let next_run_at = Utc::now().timestamp_micros()
                + Duration::try_minutes(alert.trigger_condition.silence)
                    .unwrap()
                    .num_microseconds()
                    .unwrap();
            // After the notification is sent successfully, we need to update
            // the silence period of the trigger
            if let Err(e) = db::scheduler::update_trigger(db::scheduler::Trigger {
                org: alert.org_id.to_string(),
                module: db::scheduler::TriggerModule::Alert,
                module_key,
                is_silenced: true,
                is_realtime: true,
                next_run_at,
                ..Default::default()
            })
            .await
            {
                log::error!("Failed to update trigger: {}", e);
            }
            trigger_data_stream.next_run_at = next_run_at;
        }
        trigger_data_stream.end_time = Utc::now().timestamp_micros();
        // Let all the alerts send notifications first
        trigger_usage_reports.push(trigger_data_stream);
    }

    for trigger_data_stream in trigger_usage_reports {
        publish_triggers_usage(trigger_data_stream).await;
    }
}

pub fn get_wal_time_key(
    timestamp: i64,
    partition_keys: &Vec<StreamPartition>,
    time_level: PartitionTimeLevel,
    local_val: &Map<String, Value>,
    suffix: Option<&str>,
) -> String {
    // get time file name
    let mut time_key = match time_level {
        PartitionTimeLevel::Unset | PartitionTimeLevel::Hourly => Utc
            .timestamp_nanos(timestamp * 1000)
            .format("%Y/%m/%d/%H")
            .to_string(),
        PartitionTimeLevel::Daily => Utc
            .timestamp_nanos(timestamp * 1000)
            .format("%Y/%m/%d/00")
            .to_string(),
    };
    if let Some(s) = suffix {
        time_key.push_str(&format!("/{s}"));
    } else {
        time_key.push_str("/default");
    }
    for key in partition_keys {
        if key.disabled {
            continue;
        }
        match local_val.get(&key.field) {
            Some(v) => {
                let val = get_string_value(v);
                let val = key.get_partition_key(&val);
                time_key.push_str(&format!("/{}", format_partition_key(&val)));
            }
            None => continue,
        };
    }
    time_key
}

pub fn register_stream_functions(
    org_id: &str,
    stream_type: &StreamType,
    stream_name: &str,
) -> (Vec<StreamTransform>, HashMap<String, VRLResultResolver>) {
    let mut local_trans = vec![];
    let mut stream_vrl_map: HashMap<String, VRLResultResolver> = HashMap::new();
    let key = format!("{}/{}/{}", org_id, stream_type, stream_name);

    if let Some(transforms) = STREAM_FUNCTIONS.get(&key) {
        local_trans = (*transforms.list).to_vec();
        local_trans.sort_by(|a, b| a.order.cmp(&b.order));
        for trans in &local_trans {
            let func_key = format!("{}/{}", &stream_name, trans.transform.name);
            if let Ok(vrl_runtime_config) = compile_vrl_function(&trans.transform.function, org_id)
            {
                let registry = vrl_runtime_config
                    .config
                    .get_custom::<TableRegistry>()
                    .unwrap();
                registry.finish_load();
                stream_vrl_map.insert(
                    func_key,
                    VRLResultResolver {
                        program: vrl_runtime_config.program,
                        fields: vrl_runtime_config.fields,
                    },
                );
            }
        }
    }

    (local_trans, stream_vrl_map)
}

pub fn apply_stream_functions(
    local_trans: &[StreamTransform],
    mut value: Value,
    stream_vrl_map: &HashMap<String, VRLResultResolver>,
    stream_name: &str,
    runtime: &mut Runtime,
) -> Result<Value> {
    for trans in local_trans {
        let func_key = format!("{stream_name}/{}", trans.transform.name);
        if stream_vrl_map.contains_key(&func_key) && !value.is_null() {
            let vrl_runtime = stream_vrl_map.get(&func_key).unwrap();
            value = apply_vrl_fn(runtime, vrl_runtime, &value);
        }
    }
    flatten::flatten_with_level(value, CONFIG.limit.ingest_flatten_level)
}

pub fn init_functions_runtime() -> Runtime {
    crate::common::utils::functions::init_vrl_runtime()
}

pub async fn write_file(
    writer: &Arc<ingester::Writer>,
    stream_name: &str,
    buf: HashMap<String, SchemaRecords>,
) -> RequestStats {
    let mut req_stats = RequestStats::default();
    for (hour_key, entry) in buf {
        if entry.records.is_empty() {
            continue;
        }
        let entry_records = entry.records.len();
        if let Err(e) = writer
            .write(
                entry.schema,
                ingester::Entry {
                    stream: Arc::from(stream_name),
                    schema_key: Arc::from(entry.schema_key.as_str()),
                    partition_key: Arc::from(hour_key.as_str()),
                    data: entry.records,
                    data_size: entry.records_size,
                },
                false,
            )
            .await
        {
            log::error!("ingestion write file error: {}", e);
        }

        req_stats.size += entry.records_size as f64 / SIZE_IN_MB;
        req_stats.records += entry_records as i64;
    }
    req_stats
}

pub fn check_ingestion_allowed(org_id: &str, stream_name: Option<&str>) -> Result<()> {
    if !cluster::is_ingester(&cluster::LOCAL_NODE_ROLE) {
        return Err(anyhow!("not an ingester"));
    }
    if !db::file_list::BLOCKED_ORGS.is_empty() && db::file_list::BLOCKED_ORGS.contains(&org_id) {
        return Err(anyhow!("Quota exceeded for this organization [{}]", org_id));
    }

    // check if we are allowed to ingest
    if let Some(stream_name) = stream_name {
        if db::compact::retention::is_deleting_stream(org_id, StreamType::Logs, stream_name, None) {
            return Err(anyhow!("stream [{stream_name}] is being deleted"));
        }
    };

    Ok(())
}

pub fn get_val_for_attr(attr_val: &Value) -> Value {
    let local_val = attr_val.as_object().unwrap();
    if let Some((key, value)) = local_val.into_iter().next() {
        match key.as_str() {
            "stringValue" | "string_value" => {
                return json!(get_string_value(value));
            }
            "boolValue" | "bool_value" => {
                return json!(value.as_bool().unwrap_or(false).to_string());
            }
            "intValue" | "int_value" => {
                return json!(get_int_value(value).to_string());
            }
            "doubleValue" | "double_value" => {
                return json!(get_float_value(value).to_string());
            }

            "bytesValue" | "bytes_value" => {
                return json!(value.as_str().unwrap_or("").to_string());
            }

            "arrayValue" | "array_value" => {
                let mut vals = vec![];
                for item in value
                    .get("values")
                    .unwrap()
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                {
                    vals.push(get_val_for_attr(item));
                }
                return json!(vals);
            }

            "kvlistValue" | "kvlist_value" => {
                let mut vals = Map::new();
                for item in value
                    .get("values")
                    .unwrap()
                    .as_array()
                    .unwrap_or(&vec![])
                    .iter()
                {
                    let mut key = item.get("key").unwrap().as_str().unwrap_or("").to_string();
                    flatten::format_key(&mut key);
                    let value = item.get("value").unwrap().clone();
                    vals.insert(key, get_val_for_attr(&value));
                }
                return json!(vals);
            }

            _ => {
                return json!(get_string_value(value));
            }
        }
    };
    attr_val.clone()
}

pub fn get_val_with_type_retained(val: &Value) -> Value {
    match val {
        Value::String(val) => {
            json!(val)
        }
        Value::Bool(val) => {
            json!(val)
        }
        Value::Number(val) => {
            json!(val)
        }
        Value::Array(val) => {
            json!(val)
        }
        Value::Object(val) => {
            json!(val)
        }
        Value::Null => Value::Null,
    }
}

pub async fn get_stream_routing(
    stream_params: StreamParams,
    stream_routing_map: &mut HashMap<String, Vec<Routing>>,
) {
    if let Some(pipeline) = STREAM_PIPELINES.get(&format!(
        "{}/{}/{}",
        &stream_params.org_id, stream_params.stream_type, &stream_params.stream_name,
    )) {
        let res: Vec<Routing> = pipeline
            .routing
            .as_ref()
            .unwrap()
            .iter()
            .map(|(k, v)| Routing {
                destination: k.to_string(),
                routing: v.clone(),
            })
            .collect();

        stream_routing_map.insert(stream_params.stream_name.to_string(), res);
    }
}

pub async fn get_user_defined_schema(
    streams: &[StreamParams],
    user_defined_schema_map: &mut HashMap<String, HashSet<String>>,
) {
    for stream in streams {
        let stream_settings =
            infra::schema::get_settings(&stream.org_id, &stream.stream_name, stream.stream_type)
                .await
                .unwrap_or_default();
        if let Some(fields) = stream_settings.defined_schema_fields {
            if !fields.is_empty() {
                let mut fields: HashSet<_> = fields.iter().cloned().collect();
                if !fields.contains(&CONFIG.common.column_timestamp) {
                    fields.insert(CONFIG.common.column_timestamp.to_string());
                }
                user_defined_schema_map.insert(stream.stream_name.to_string(), fields);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use infra::schema::{unwrap_stream_settings, STREAM_SETTINGS};

    use super::*;

    #[test]
    fn test_format_partition_key() {
        assert_eq!(format_partition_key("default/olympics"), "defaultolympics");
    }
    #[test]
    fn test_get_wal_time_key() {
        let mut local_val = Map::new();
        local_val.insert("country".to_string(), Value::String("USA".to_string()));
        local_val.insert("sport".to_string(), Value::String("basketball".to_string()));
        assert_eq!(
            get_wal_time_key(
                1620000000,
                &vec![
                    StreamPartition::new("country"),
                    StreamPartition::new("sport")
                ],
                PartitionTimeLevel::Hourly,
                &local_val,
                None
            ),
            "1970/01/01/00/default/country=USA/sport=basketball"
        );
    }

    #[test]
    fn test_get_wal_time_key_no_partition_keys() {
        let mut local_val = Map::new();
        local_val.insert("country".to_string(), Value::String("USA".to_string()));
        local_val.insert("sport".to_string(), Value::String("basketball".to_string()));
        assert_eq!(
            get_wal_time_key(
                1620000000,
                &vec![],
                PartitionTimeLevel::Hourly,
                &local_val,
                None
            ),
            "1970/01/01/00/default"
        );
    }
    #[test]
    fn test_get_wal_time_key_no_partition_keys_no_local_val() {
        assert_eq!(
            get_wal_time_key(
                1620000000,
                &vec![],
                PartitionTimeLevel::Hourly,
                &Map::new(),
                None
            ),
            "1970/01/01/00/default"
        );
    }
    #[tokio::test]
    async fn test_get_stream_partition_keys() {
        let mut meta = HashMap::new();
        meta.insert(
            "settings".to_string(),
            r#"{"partition_keys": {"country": "country", "sport": "sport"}}"#.to_string(),
        );
        let schema = arrow_schema::Schema::empty().with_metadata(meta);
        let settings = unwrap_stream_settings(&schema).unwrap();
        let mut w = STREAM_SETTINGS.write().await;
        w.insert("default/logs/olympics".to_string(), settings);
        drop(w);
        let keys = get_stream_partition_keys("default", &StreamType::Logs, "olympics").await;
        assert_eq!(
            keys.partition_keys,
            vec![
                StreamPartition::new("country"),
                StreamPartition::new("sport")
            ]
        );
    }

    #[tokio::test]
    async fn test_compile_vrl_function() {
        let result = compile_vrl_function(
            r#"if .country == "USA" {
                ..country = "United States"
            }"#,
            "default",
        );
        assert!(result.is_err())
    }
}
