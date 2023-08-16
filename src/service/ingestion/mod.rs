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

use ahash::AHashMap;
use arrow_schema::Schema;
use bytes::{BufMut, BytesMut};
use chrono::{TimeZone, Utc};
use datafusion::arrow::json::reader::infer_json_schema;
use std::{collections::BTreeMap, io::BufReader};
use vector_enrichment::TableRegistry;
use vrl::compiler::{runtime::Runtime, CompilationResult, TargetValueRef};
use vrl::prelude::state;

use crate::common::infra::{
    config::{CONFIG, STREAM_ALERTS, STREAM_FUNCTIONS},
    metrics,
    wal::get_or_create,
};
use crate::common::meta::{
    alert::{Alert, Trigger},
    functions::{StreamTransform, VRLRuntimeConfig},
    stream::{PartitionTimeLevel, PartitioningDetails, StreamParams},
    usage::RequestStats,
    StreamType,
};
use crate::common::{
    flatten,
    functions::get_vrl_compiler_config,
    json::{Map, Value},
    notification::send_notification,
};
use crate::service::{db, format_partition_key, stream::stream_settings, triggers};

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

pub fn apply_vrl_fn(runtime: &mut Runtime, vrl_runtime: &VRLRuntimeConfig, row: &Value) -> Value {
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
            Err(_) => row.clone(),
        },
        Err(err) => {
            log::error!("Error from vrl {:?}", err);
            row.clone()
        }
    }
}

pub async fn get_stream_transforms<'a>(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    stream_transform_map: &mut AHashMap<String, Vec<StreamTransform>>,
    stream_vrl_map: &mut AHashMap<String, VRLRuntimeConfig>,
) {
    let key = format!("{}/{}/{}", &org_id, stream_type, &stream_name);
    if stream_transform_map.contains_key(&key) {
        return;
    }
    let mut _local_trans: Vec<StreamTransform> = vec![];
    (_local_trans, *stream_vrl_map) =
        crate::service::ingestion::register_stream_transforms(org_id, stream_type, stream_name);
    stream_transform_map.insert(key, _local_trans);
}

pub async fn get_stream_partition_keys(
    stream_name: &str,
    stream_schema_map: &AHashMap<String, Schema>,
) -> PartitioningDetails {
    let schema = match stream_schema_map.get(stream_name) {
        Some(schema) => schema,
        None => return PartitioningDetails::default(),
    };

    let stream_settings = stream_settings(schema).unwrap_or_default();
    PartitioningDetails {
        partition_keys: stream_settings.partition_keys,
        partition_time_level: stream_settings.partition_time_level,
    }
}

pub async fn get_stream_alerts<'a>(
    key: String,
    stream_alerts_map: &mut AHashMap<String, Vec<Alert>>,
) {
    if stream_alerts_map.contains_key(&key) {
        return;
    }
    let alerts_list = STREAM_ALERTS.get(&key);
    if alerts_list.is_none() {
        return;
    }
    let mut alerts = alerts_list.unwrap().list.clone();
    alerts.retain(|alert| alert.is_real_time);
    stream_alerts_map.insert(key, alerts);
}

pub fn get_hour_key(
    timestamp: i64,
    partition_keys: &Vec<String>,
    local_val: &Map<String, Value>,
    suffix: Option<&str>,
) -> String {
    // get hour file name

    let mut hour_key = Utc
        .timestamp_nanos(timestamp * 1000)
        .format("%Y_%m_%d_%H")
        .to_string();
    if let Some(s) = suffix {
        hour_key.push_str(&format!("_{s}"));
    } else {
        hour_key.push_str("_keeping");
    }

    for key in partition_keys {
        match local_val.get(key) {
            Some(v) => {
                let val = if v.is_string() {
                    format!("{}={}", key, v.as_str().unwrap())
                } else {
                    format!("{}={}", key, v)
                };
                hour_key.push_str(&format!("_{}", format_partition_key(&val)));
            }
            None => continue,
        };
    }
    hour_key
}

pub fn get_wal_time_key(
    timestamp: i64,
    partition_keys: &Vec<String>,
    time_level: PartitionTimeLevel,
    local_val: &Map<String, Value>,
    suffix: Option<&str>,
) -> String {
    // get time file name
    let mut time_key = match time_level {
        PartitionTimeLevel::Unset | PartitionTimeLevel::Hourly => Utc
            .timestamp_nanos(timestamp * 1000)
            .format("%Y_%m_%d_%H")
            .to_string(),
        PartitionTimeLevel::Daily => Utc
            .timestamp_nanos(timestamp * 1000)
            .format("%Y_%m_%d_00")
            .to_string(),
    };
    if let Some(s) = suffix {
        time_key.push_str(&format!("_{s}"));
    } else {
        time_key.push_str("_keeping");
    }

    for key in partition_keys {
        match local_val.get(key) {
            Some(v) => {
                let val = if v.is_string() {
                    format!("{}={}", key, v.as_str().unwrap())
                } else {
                    format!("{}={}", key, v)
                };
                time_key.push_str(&format!("_{}", format_partition_key(&val)));
            }
            None => continue,
        };
    }
    time_key
}

pub async fn send_ingest_notification(trigger: Trigger, alert: Alert) {
    log::info!(
        "Sending notification for alert {} {}",
        alert.name,
        alert.stream
    );
    let _ = send_notification(&alert, &trigger).await;
    let trigger_to_save = Trigger {
        last_sent_at: Utc::now().timestamp_micros(),
        count: trigger.count + 1,
        ..trigger
    };
    let _ = triggers::save_trigger(&trigger_to_save.alert_name, &trigger_to_save).await;
}

pub fn register_stream_transforms(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> (Vec<StreamTransform>, AHashMap<String, VRLRuntimeConfig>) {
    let mut local_trans = vec![];
    let mut stream_vrl_map: AHashMap<String, VRLRuntimeConfig> = AHashMap::new();
    let key = format!("{}/{}/{}", &org_id, stream_type, &stream_name);

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
                stream_vrl_map.insert(func_key, vrl_runtime_config);
            }
        }
    }

    (local_trans, stream_vrl_map)
}

pub fn apply_stream_transform<'a>(
    local_trans: &Vec<StreamTransform>,
    value: &'a Value,
    stream_vrl_map: &'a AHashMap<String, VRLRuntimeConfig>,
    stream_name: &str,
    runtime: &mut Runtime,
) -> Result<Value, anyhow::Error> {
    let mut value = value.clone();
    for trans in local_trans {
        let func_key = format!("{stream_name}/{}", trans.transform.name);
        if stream_vrl_map.contains_key(&func_key) && !value.is_null() {
            let vrl_runtime = stream_vrl_map.get(&func_key).unwrap();
            value = apply_vrl_fn(runtime, vrl_runtime, &value);
        }
    }
    flatten::flatten(&value)
}

pub async fn chk_schema_by_record(
    stream_schema_map: &mut AHashMap<String, Schema>,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    record_ts: i64,
    record_val: &str,
) {
    let schema = if stream_schema_map.contains_key(stream_name) {
        stream_schema_map.get(stream_name).unwrap().clone()
    } else {
        let schema = db::schema::get(org_id, stream_name, stream_type)
            .await
            .unwrap();
        stream_schema_map.insert(stream_name.to_string(), schema.clone());
        schema
    };
    if !schema.fields().is_empty() {
        return;
    }

    let mut schema_reader = BufReader::new(record_val.as_bytes());
    let inferred_schema = infer_json_schema(&mut schema_reader, None).unwrap();
    let inferred_schema = inferred_schema.with_metadata(schema.metadata().clone());
    stream_schema_map.insert(stream_name.to_string(), inferred_schema.clone());
    db::schema::set(
        org_id,
        stream_name,
        stream_type,
        &inferred_schema,
        Some(record_ts),
        true,
    )
    .await
    .unwrap();
}

pub fn _write_file(
    buf: AHashMap<String, Vec<String>>,
    thread_id: usize,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
) {
    let mut write_buf = BytesMut::new();
    for (key, entry) in buf {
        if entry.is_empty() {
            continue;
        }
        let file = crate::common::infra::wal::get_or_create(
            thread_id,
            StreamParams {
                org_id,
                stream_name,
                stream_type,
            },
            None,
            &key,
            CONFIG.common.wal_memory_mode_enabled,
        );

        let mut write_size = 0;
        if CONFIG.common.wal_line_mode_enabled {
            for row in &entry {
                write_buf.clear();
                write_buf.put(row.as_bytes());
                write_buf.put("\n".as_bytes());
                file.write(write_buf.as_ref());
                write_size += write_buf.len() as u64
            }
        } else {
            write_buf.clear();
            for row in &entry {
                write_buf.put(row.as_bytes());
                write_buf.put("\n".as_bytes());
            }
            file.write(write_buf.as_ref());
            write_size += write_buf.len() as u64
        }

        // metrics
        metrics::INGEST_RECORDS
            .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
            .inc_by(entry.len() as u64);
        metrics::INGEST_BYTES
            .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
            .inc_by(write_size);
    }
}

pub fn init_functions_runtime() -> Runtime {
    crate::common::functions::init_vrl_runtime()
}

pub fn write_file(
    buf: AHashMap<String, Vec<String>>,
    thread_id: usize,
    stream_params: StreamParams,
    stream_file_name: &mut String,
    partition_time_level: Option<PartitionTimeLevel>,
) -> RequestStats {
    let mut write_buf = BytesMut::new();
    let mut req_stats = RequestStats::default();
    for (key, entry) in buf {
        if entry.is_empty() {
            continue;
        }
        write_buf.clear();
        for row in &entry {
            write_buf.put(row.as_bytes());
            write_buf.put("\n".as_bytes());
        }
        let file = get_or_create(
            thread_id,
            stream_params,
            partition_time_level,
            &key,
            CONFIG.common.wal_memory_mode_enabled,
        );
        if stream_file_name.is_empty() {
            *stream_file_name = file.full_name();
        }
        file.write(write_buf.as_ref());
        req_stats.size += write_buf.len() as f64 / (1024.0 * 1024.0);
        req_stats.records += entry.len() as u64;
    }
    req_stats
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_format_partition_key() {
        assert_eq!(format_partition_key("default/olympics"), "default.olympics");
    }
    #[test]
    fn test_get_hour_key() {
        let mut local_val = Map::new();
        local_val.insert("country".to_string(), Value::String("USA".to_string()));
        local_val.insert("sport".to_string(), Value::String("basketball".to_string()));
        assert_eq!(
            get_hour_key(
                1620000000,
                &vec!["country".to_string(), "sport".to_string()],
                &local_val,
                None
            ),
            "1970_01_01_00_keeping_country=USA_sport=basketball"
        );
    }

    #[test]
    fn test_get_hour_key_no_partition_keys() {
        let mut local_val = Map::new();
        local_val.insert("country".to_string(), Value::String("USA".to_string()));
        local_val.insert("sport".to_string(), Value::String("basketball".to_string()));
        assert_eq!(
            get_hour_key(1620000000, &vec![], &local_val, None),
            "1970_01_01_00_keeping"
        );
    }
    #[test]
    fn test_get_hour_key_no_partition_keys_no_local_val() {
        assert_eq!(
            get_hour_key(1620000000, &vec![], &Map::new(), None),
            "1970_01_01_00_keeping"
        );
    }
    #[actix_web::test]
    async fn test_get_stream_partition_keys() {
        let mut stream_schema_map = AHashMap::new();
        let mut meta = HashMap::new();
        meta.insert(
            "settings".to_string(),
            r#"{"partition_keys": {"country": "country", "sport": "sport"}}"#.to_string(),
        );
        let schema = Schema::empty().with_metadata(meta);
        stream_schema_map.insert("olympics".to_string(), schema);
        let keys = get_stream_partition_keys("olympics", &stream_schema_map).await;
        assert_eq!(
            keys.partition_keys,
            vec!["country".to_string(), "sport".to_string()]
        );
    }

    #[actix_web::test]

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
