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
use chrono::{TimeZone, Utc};
#[cfg(feature = "zo_functions")]
use mlua::{Function, Lua, LuaSerdeExt, Value as LuaValue};

#[cfg(feature = "zo_functions")]
use crate::infra::config::STREAM_FUNCTIONS;
#[cfg(feature = "zo_functions")]
use crate::meta::functions::Transform;
use crate::{
    common::notification::send_notification,
    infra::config::STREAM_ALERTS,
    meta::alert::{Alert, Trigger},
};

use super::triggers;

#[cfg(feature = "zo_functions")]
pub fn load_lua_transform(lua: &Lua, js_func: String) -> Option<Function> {
    let ret = lua.load(&js_func).eval();

    if ret.is_err() {
        None
    } else {
        Some(ret.unwrap())
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
            row.clone()
        }
    }
}
#[cfg(feature = "zo_functions")]
pub async fn get_stream_transforms<'a>(
    key: String,
    stream_name: String,
    stream_tansform_map: &mut AHashMap<String, Vec<Transform>>,
    stream_lua_map: &mut AHashMap<String, Function<'a>>,
    lua: &'a Lua,
) {
    if stream_tansform_map.contains_key(&key) {
        return;
    }
    let transforms = STREAM_FUNCTIONS.get(&key);
    if transforms.is_none() {
        return;
    }

    let mut func: Option<Function>;
    let mut local_tans: Vec<Transform> = (*transforms.unwrap().list).to_vec();
    local_tans.sort_by(|a, b| a.order.cmp(&b.order));
    for trans in &local_tans {
        let func_key = format!("{}/{}", &stream_name, trans.name);
        func = load_lua_transform(lua, trans.function.clone());
        if func.is_some() {
            stream_lua_map.insert(func_key, func.unwrap().to_owned());
        }
    }
    stream_tansform_map.insert(key, local_tans.clone());
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
    println!(
        "Sending notification for alert {} {}",
        alert.name, alert.stream
    );
    let _ = send_notification(&alert, &trigger.clone()).await;
    trigger.last_sent_at = Utc::now().timestamp_micros();
    trigger.count += 1;
    let _ = triggers::save_trigger(trigger.alert_name.clone(), trigger.clone()).await;
}
