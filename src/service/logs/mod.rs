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
use crate::common::hasher::get_fields_key_xxh3;
use crate::common::json::{Map, Value};
use crate::infra::config::CONFIG;
use crate::meta::alert::{Alert, Evaluate, Trigger};
use crate::meta::ingestion::RecordStatus;
use crate::meta::StreamType;
use crate::service::schema::check_for_schema;

pub mod bulk;
pub mod gcs_pub_sub;
pub mod json;
pub mod kinesis_firehose;
pub mod multi;
pub mod syslog;

static BULK_OPERATORS: [&str; 3] = ["create", "index", "update"];

pub(crate) fn get_upto_discard_error() -> String {
    format!(
        "Too old data, only last {} hours data can be ingested. Data discarded. You can adjust ingestion max time by setting the environment variable ZO_INGEST_ALLOWED_UPTO=<max_hours>",
        CONFIG.limit.ingest_allowed_upto
    )
}

fn parse_bulk_index(v: &Value) -> Option<(String, String, String)> {
    let local_val = v.as_object().unwrap();
    for action in BULK_OPERATORS {
        if local_val.contains_key(action) {
            let local_val = local_val.get(action).unwrap().as_object().unwrap();
            let index = match local_val.get("_index") {
                Some(v) => v.as_str().unwrap().to_string(),
                None => return None,
            };
            let doc_id = match local_val.get("_id") {
                Some(v) => v.as_str().unwrap().to_string(),
                None => String::from(""),
            };
            return Some((action.to_string(), index, doc_id));
        };
    }
    None
}

pub fn cast_to_type(mut value: Value, delta: Vec<Field>) -> (Option<String>, Option<String>) {
    let local_map = value.as_object_mut().unwrap();
    //let mut error_msg = String::new();
    let mut parse_error = String::new();
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
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::Int8 => {
                    match local_val.parse::<i8>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::Int16 => {
                    match local_val.parse::<i16>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::Int32 => {
                    match local_val.parse::<i32>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::Int64 => {
                    match local_val.parse::<i64>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::UInt8 => {
                    match local_val.parse::<u8>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::UInt16 => {
                    match local_val.parse::<u16>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::UInt32 => {
                    match local_val.parse::<u32>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::UInt64 => {
                    match local_val.parse::<u64>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::Float16 => {
                    match local_val.parse::<f32>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::Float32 => {
                    match local_val.parse::<f32>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::Float64 => {
                    match local_val.parse::<f64>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                DataType::Utf8 => {
                    match local_val.parse::<String>() {
                        Ok(val) => {
                            local_map.insert(field.name().clone(), val.into());
                        }
                        Err(_) => set_parsing_error(&mut parse_error, &field),
                    };
                }
                _ => println!("{local_val:?}"),
            };
        }
    }
    if parse_error.is_empty() {
        (Some(common::json::to_string(&local_map).unwrap()), None)
    } else {
        (None, Some(parse_error))
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
        .get(&CONFIG.common.column_timestamp)
        .unwrap()
        .as_i64()
        .unwrap();

    let mut value_str = common::json::to_string(&local_val).unwrap();
    // check schema
    let schema_evolution = check_for_schema(
        &stream_meta.org_id,
        &stream_meta.stream_name,
        StreamType::Logs,
        &value_str,
        stream_schema_map,
        timestamp,
    )
    .await;

    // get hour key
    let schema_key = get_fields_key_xxh3(&schema_evolution.schema_fields);
    let hour_key = super::ingestion::get_hour_key(
        timestamp,
        stream_meta.partition_keys,
        local_val,
        Some(&schema_key),
    );
    let hour_buf = buf.entry(hour_key).or_default();

    if schema_evolution.schema_compatible {
        let valid_record = if schema_evolution.types_delta.is_some() {
            let delta = schema_evolution.types_delta.unwrap();
            let loc_value: Value = common::json::from_slice(value_str.as_bytes()).unwrap();
            let (ret_val, error) = if !CONFIG.common.widening_schema_evolution {
                cast_to_type(loc_value, delta)
            } else if schema_evolution.is_schema_changed {
                let local_delta = delta
                    .into_iter()
                    .filter(|x| x.metadata().contains_key("zo_cast"))
                    .collect::<Vec<_>>();

                if local_delta.is_empty() {
                    (Some(value_str.clone()), None)
                } else {
                    cast_to_type(loc_value, local_delta)
                }
            } else {
                cast_to_type(loc_value, delta)
            };
            if ret_val.is_some() {
                value_str = ret_val.unwrap();
                true
            } else {
                status.failed += 1;
                status.error = error.unwrap();
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

fn set_parsing_error(parse_error: &mut String, field: &Field) {
    parse_error.push_str(&format!(
        "Failed to cast {} to type {} ",
        field.name(),
        field.data_type()
    ));
}

async fn evaluate_trigger(
    trigger: Option<Trigger>,
    stream_alerts_map: AHashMap<String, Vec<Alert>>,
) {
    if trigger.is_some() {
        let val = trigger.unwrap();
        let mut alerts = stream_alerts_map
            .get(&format!("{}/{}/{}", val.org, StreamType::Logs, val.stream))
            .unwrap()
            .clone();

        alerts.retain(|alert| alert.name.eq(&val.alert_name));
        if !alerts.is_empty() {
            crate::service::ingestion::send_ingest_notification(
                val,
                alerts.first().unwrap().clone(),
            )
            .await;
        }
    }
}

struct StreamMeta {
    org_id: String,
    stream_name: String,
    partition_keys: Vec<String>,
    stream_alerts_map: AHashMap<String, Vec<Alert>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_parsing_error() {
        let mut parse_error = String::new();
        set_parsing_error(&mut parse_error, &Field::new("test", DataType::Utf8, true));
        assert!(!parse_error.is_empty());
    }

    #[test]
    fn test_cast_to_type() {
        let mut local_val = Map::new();
        local_val.insert("test".to_string(), Value::from("test13212"));
        let delta = vec![Field::new("test", DataType::Utf8, true)];
        let (ret_val, error) = cast_to_type(Value::from(local_val), delta);
        assert!(ret_val.is_some());
        assert!(error.is_none());
    }
}
