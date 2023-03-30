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
use arrow_schema::{DataType, Field};
use datafusion::arrow::datatypes::Schema;

use crate::common;
use crate::common::json::{Map, Value};
use crate::infra::config::CONFIG;
use crate::meta::alert::{Alert, Evaluate, Trigger};
use crate::meta::ingestion::RecordStatus;
use crate::meta::StreamType;
use crate::service::schema::check_for_schema;

pub mod bulk;
pub mod json;
pub mod multi;

pub(crate) fn get_upto_discard_error() -> String {
    format!(
        "too old data, by default only last {} hours data can be ingested. Data discarded.",
        CONFIG.limit.ingest_allowed_upto
    )
}

fn get_stream_name(v: &Value) -> String {
    let local_val = v.as_object().unwrap();
    if local_val.contains_key("index") {
        String::from(
            local_val
                .get("index")
                .unwrap()
                .as_object()
                .unwrap()
                .get("_index")
                .unwrap()
                .as_str()
                .unwrap(),
        )
    } else {
        String::from(
            local_val
                .get("create")
                .unwrap()
                .as_object()
                .unwrap()
                .get("_index")
                .unwrap()
                .as_str()
                .unwrap(),
        )
    }
}

// generate partition key for query
pub fn get_partition_key_query(s: &str) -> String {
    let mut s = s.replace(['/', '.'], "_");
    s.truncate(100);
    s
}

pub fn cast_to_type(mut value: Value, delta: Vec<Field>) -> Option<String> {
    let local_map = value.as_object_mut().unwrap();
    let mut parse_error = false;
    for field in delta {
        let field_map = local_map.get(field.name());
        if let Some(val) = field_map {
            if val.is_null() {
                local_map.insert(field.name().clone(), val.clone());
                continue;
            }
            let local_val = get_value(val);
            match field.data_type() {
                DataType::Boolean => {
                    match local_val.parse::<bool>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::Int8 => {
                    match local_val.parse::<i8>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::Int16 => {
                    match local_val.parse::<i16>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::Int32 => {
                    match local_val.parse::<i32>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::Int64 => {
                    match local_val.parse::<i64>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::UInt8 => {
                    match local_val.parse::<u8>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::UInt16 => {
                    match local_val.parse::<u16>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::UInt32 => {
                    match local_val.parse::<u32>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::UInt64 => {
                    match local_val.parse::<u64>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::Float16 => {
                    match local_val.parse::<f32>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::Float32 => {
                    match local_val.parse::<f32>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::Float64 => {
                    match local_val.parse::<f64>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                DataType::Utf8 => {
                    match local_val.parse::<String>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => parse_error = true,
                    };
                }
                _ => println!("{local_val:?}"),
            };
        }
    }
    if !parse_error {
        Some(common::json::to_string(&local_map).unwrap())
    } else {
        None
    }
}

pub fn get_value(value: &Value) -> String {
    if value.is_boolean() {
        value.as_bool().unwrap().to_string()
    } else if value.is_f64() {
        value.as_f64().unwrap().to_string()
    } else if value.is_i64() {
        value.as_i64().unwrap().to_string()
    } else if value.is_u64() {
        value.as_u64().unwrap().to_string()
    } else if value.is_string() {
        value.as_str().unwrap().to_string()
    } else {
        "".to_string()
    }
}

async fn add_valid_record(
    stream_meta: StreamMeta,
    stream_schema_map: &mut AHashMap<String, Schema>,
    status: &mut RecordStatus,
    buf: &mut AHashMap<String, Vec<String>>,
    local_val: &mut Map<String, Value>,
) -> Option<Trigger> {
    let mut trigger: Option<Trigger> = None;
    let timestamp: i64 = local_val
        .get(&CONFIG.common.time_stamp_col.clone())
        .unwrap()
        .as_i64()
        .unwrap();
    // get hour key
    let hour_key =
        super::ingestion::get_hour_key(timestamp, stream_meta.partition_keys, local_val.clone());
    let hour_buf = buf.entry(hour_key.clone()).or_default();

    let mut value_str = common::json::to_string(&local_val).unwrap();
    // check schema
    let (schema_conformance, delta_fields) = check_for_schema(
        &stream_meta.org_id,
        &stream_meta.stream_name,
        StreamType::Logs,
        &value_str,
        stream_schema_map,
        timestamp,
    )
    .await;

    if schema_conformance {
        let valid_record = if delta_fields.is_some() {
            let delta = delta_fields.unwrap();
            let loc_value: Value = common::json::from_slice(value_str.as_bytes()).unwrap();
            let ret_val = cast_to_type(loc_value, delta);
            if ret_val.is_some() {
                value_str = ret_val.unwrap();
                true
            } else {
                status.failed += 1;
                false
            }
        } else {
            true
        };

        if valid_record {
            if !stream_meta.stream_alerts_map.is_empty() {
                // Start check for alert trigger
                let key = format!(
                    "{}/{}/{}",
                    &stream_meta.org_id,
                    StreamType::Logs,
                    &stream_meta.stream_name
                );
                if let Some(alerts) = stream_meta.stream_alerts_map.get(&key) {
                    for alert in alerts {
                        if alert.is_real_time {
                            let set_trigger = alert.condition.evaluate(local_val.clone());
                            if set_trigger {
                                // let _ = triggers::save_trigger(alert.name.clone(), trigger).await;
                                trigger = Some(Trigger {
                                    timestamp,
                                    is_valid: true,
                                    alert_name: alert.name.clone(),
                                    stream: stream_meta.stream_name.to_string(),
                                    org: stream_meta.org_id.to_string(),
                                    stream_type: StreamType::Logs,
                                    last_sent_at: 0,
                                    count: 0,
                                    is_ingest_time: true,
                                });
                            }
                        }
                    }
                }
                // End check for alert trigger
            }
            hour_buf.push(value_str);
            status.successful += 1;
        };
    } else {
        status.failed += 1;
    }
    trigger
}

struct StreamMeta {
    org_id: String,
    stream_name: String,
    partition_keys: Vec<String>,
    stream_alerts_map: AHashMap<String, Vec<Alert>>,
}
