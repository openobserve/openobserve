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

use crate::common::json::{Map, Value};
use ahash::AHashMap;
use arrow_schema::Schema;
use chrono::{SecondsFormat, TimeZone, Utc};
#[cfg(feature = "zo_functions")]
use mlua::{Function, Lua, LuaSerdeExt, Value as LuaValue};
#[cfg(feature = "zo_functions")]
use vrl::{prelude::BTreeMap, CompilationResult, Program, Runtime, TargetValueRef, VrlRuntime};

use super::triggers;
#[cfg(feature = "zo_functions")]
use vrl::{prelude::BTreeMap, CompilationResult, Program, Runtime, TargetValueRef, VrlRuntime};

#[cfg(feature = "zo_functions")]
use crate::infra::config::STREAM_FUNCTIONS;
#[cfg(feature = "zo_functions")]
use crate::meta::functions::Transform;
#[cfg(feature = "zo_functions")]
use crate::meta::StreamType;
use crate::{
    common::notification::send_notification,
    infra::config::STREAM_ALERTS,
    meta::alert::{Alert, Trigger},
};

#[cfg(feature = "zo_functions")]
pub fn load_lua_transform(lua: &Lua, js_func: String) -> Option<Function> {
    if let Ok(val) = lua.load(&js_func).eval() {
        val
    } else {
        None
    }
}

#[cfg(feature = "zo_functions")]
pub fn compile_vrl_function(func: &str) -> Option<Program> {
    let result = vrl::compile(func, &vrl_stdlib::all());

    match result {
        Ok(CompilationResult {
            program,
            warnings: _,
            config: _,
        }) => Some(program),
        Err(e) => {
            log::info!("Error compiling vrl {:?}", e);
            None
        }
    }
}
#[cfg(feature = "zo_functions")]
pub fn lua_transform(lua: &Lua, row: &Value, func: &Function) -> Value {
    let input = lua.to_value(&row).unwrap();
    let _res = func.call::<_, LuaValue>(input);
    match _res {
        Ok(res) => lua.from_value(res).unwrap(),
        Err(err) => {
            log::error!("Err from lua {:?}", err.to_string());
            //Value::Null
            row.clone()
        }
    }
}

#[cfg(feature = "zo_functions")]
pub fn apply_vrl_fn(runtime: &mut Runtime, program: vrl::Program, row: &Value) -> Value {
    let mut metadata = vrl_value::Value::from(BTreeMap::new());
    let mut target = TargetValueRef {
        value: &mut vrl_value::Value::from(row),
        metadata: &mut metadata,
        secrets: &mut vrl_value::Secrets::new(),
    };
    let timezone = vrl::TimeZone::Local;
    let result = match VrlRuntime::default() {
        VrlRuntime::Ast => runtime.resolve(&mut target, &program, &timezone),
    };
    match result {
        Ok(res) => match res.try_into() {
            Ok(val) => val,
            Err(_) => row.clone(),
        },
        Err(_) => row.clone(),
    }
}

#[cfg(feature = "zo_functions")]
pub async fn get_stream_transforms<'a>(
    stream_name: String,
    org_id: String,
    stream_type: StreamType,
    stream_transform_map: &mut AHashMap<String, Vec<Transform>>,
    stream_lua_map: &mut AHashMap<String, Function<'a>>,
    stream_vrl_map: &mut AHashMap<String, Program>,
    lua: &'a Lua,
) {
    let key = format!("{}/{}/{}", &org_id, stream_type, &stream_name);
    if stream_transform_map.contains_key(&key) {
        return;
    }
    let mut _local_tans: Vec<Transform> = vec![];
    (_local_tans, *stream_lua_map, *stream_vrl_map) =
        crate::service::ingestion::register_stream_transforms(
            &org_id,
            &stream_name,
            stream_type,
            lua,
        );
    stream_transform_map.insert(key, _local_tans);
}

pub async fn get_stream_partition_keys(
    stream_name: String,
    stream_schema_map: AHashMap<String, Schema>,
) -> Vec<String> {
    let mut keys: Vec<String> = vec![];
    if stream_schema_map.contains_key(&stream_name) {
        let schema = stream_schema_map.get(&stream_name).unwrap();
        let mut meta = schema.metadata().clone();
        meta.remove("created_at");

        let stream_settings = meta.get("settings");

        if let Some(value) = stream_settings {
            let settings: Value = crate::common::json::from_slice(value.as_bytes()).unwrap();
            let part_keys = settings.get("partition_keys");

            if let Some(value) = part_keys {
                let mut v: Vec<_> = value.as_object().unwrap().into_iter().collect();
                v.sort_by(|a, b| a.0.cmp(b.0));
                for (_, value) in v {
                    keys.push(value.as_str().unwrap().to_string());
                }
            }
        }
    }
    keys
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
    partition_keys: Vec<String>,
    local_val: Map<String, Value>,
) -> String {
    // get hour file name
    let mut hour_key = Utc
        .timestamp_nanos(timestamp * 1000)
        .format("%Y_%m_%d_%H")
        .to_string();

    for key in &partition_keys {
        match local_val.get(key) {
            Some(v) => {
                let val = if v.is_string() {
                    format!("{}={}", key, v.as_str().unwrap())
                } else {
                    format!("{}={}", key, v)
                };
                hour_key.push_str(&format!("_{}", get_partition_key_record(&val)));
            }
            None => continue,
        };
    }
    hour_key
}

// generate partition key for record
pub fn get_partition_key_record(s: &str) -> String {
    let s = s.replace(['/', '_'], ".");
    if s.len() > 100 {
        s[0..100].to_string()
    } else {
        s
    }
}

pub async fn send_ingest_notification(mut trigger: Trigger, alert: Alert) {
    log::info!(
        "Sending notification for alert {} {}",
        alert.name,
        alert.stream
    );
    let _ = send_notification(&alert, &trigger.clone()).await;
    trigger.last_sent_at = Utc::now().timestamp_micros();
    trigger.count += 1;
    let _ = triggers::save_trigger(trigger.alert_name.clone(), trigger.clone()).await;
}

#[cfg(feature = "zo_functions")]
pub fn register_stream_transforms<'a>(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    lua: &'a Lua,
) -> (
    Vec<Transform>,
    AHashMap<String, Function<'a>>,
    AHashMap<String, Program>,
) {
    let mut local_tans = vec![];
    let mut stream_lua_map: AHashMap<String, Function> = AHashMap::new();
    let mut stream_vrl_map: AHashMap<String, Program> = AHashMap::new();
    let key = format!("{}/{}/{}", &org_id, stream_type, &stream_name);

    if let Some(transforms) = STREAM_FUNCTIONS.get(&key) {
        local_tans = (*transforms.list).to_vec();
        local_tans.sort_by(|a, b| a.order.cmp(&b.order));
        for trans in &local_tans {
            let func_key = format!("{}/{}", &stream_name, trans.name);
            if trans.trans_type == 0 {
                if let Some(local_fn) = load_lua_transform(lua, trans.function.clone()) {
                    stream_lua_map.insert(func_key, local_fn.to_owned());
                }
            } else if let Some(program) = compile_vrl_function(&trans.function) {
                stream_vrl_map.insert(func_key, program.to_owned());
            }
        }
    }

    (local_tans, stream_lua_map, stream_vrl_map)
}

#[cfg(feature = "zo_functions")]
pub fn apply_stream_transform<'a>(
    local_tans: &Vec<Transform>,
    value: &'a Value,
    lua: &'a Lua,
    stream_lua_map: &'a AHashMap<String, Function>,
    stream_vrl_map: &'a AHashMap<String, Program>,
    stream_name: &str,
    runtime: &mut Runtime,
) -> Value {
    let mut value = value.clone();
    for trans in local_tans {
        let func_key = format!("{stream_name}/{}", trans.name);
        if stream_lua_map.contains_key(&func_key) {
            value = lua_transform(lua, &value, stream_lua_map.get(&func_key).unwrap());
        } else if stream_vrl_map.contains_key(&func_key) {
            value = apply_vrl_fn(
                runtime,
                stream_vrl_map.get(&func_key).unwrap().clone(),
                &value,
            );
        }
    }
    value
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn test_get_partition_key_record() {
        assert_eq!(
            get_partition_key_record("default/olympics"),
            "default.olympics"
        );
    }
    #[test]
    fn test_get_hour_key() {
        let mut local_val = Map::new();
        local_val.insert("country".to_string(), Value::String("USA".to_string()));
        local_val.insert("sport".to_string(), Value::String("basketball".to_string()));
        assert_eq!(
            get_hour_key(
                1620000000,
                vec!["country".to_string(), "sport".to_string()],
                local_val
            ),
            "1970_01_01_00_country=USA_sport=basketball"
        );
    }

    #[test]
    fn test_get_hour_key_no_partition_keys() {
        let mut local_val = Map::new();
        local_val.insert("country".to_string(), Value::String("USA".to_string()));
        local_val.insert("sport".to_string(), Value::String("basketball".to_string()));
        assert_eq!(get_hour_key(1620000000, vec![], local_val), "1970_01_01_00");
    }
    #[test]
    fn test_get_hour_key_no_partition_keys_no_local_val() {
        assert_eq!(
            get_hour_key(1620000000, vec![], Map::new()),
            "1970_01_01_00"
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
        let schema = Schema::new(vec![]).with_metadata(meta);
        stream_schema_map.insert("olympics".to_string(), schema);
        let keys = get_stream_partition_keys("olympics".to_string(), stream_schema_map).await;
        assert_eq!(keys, vec!["country".to_string(), "sport".to_string()]);
    }
}
