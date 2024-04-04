// Copyright 2023 Zinc Labs Inc.
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

use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use arrow_schema::{DataType, Field, Schema};
use config::{
    meta::stream::{PartitionTimeLevel, StreamType},
    utils::{
        json::{estimate_json_bytes, Map, Value},
        schema_ext::SchemaExt,
    },
    CONFIG,
};

use super::ingestion::{get_string_value, TriggerAlertData};
use crate::{
    common::meta::{
        alerts::Alert,
        ingestion::RecordStatus,
        stream::{SchemaRecords, StreamPartition},
    },
    service::{
        ingestion::get_wal_time_key,
        schema::{check_for_schema, SchemaCache},
        stream::unwrap_partition_time_level,
    },
};

pub mod bulk;
pub mod ingest;
pub mod multi;
pub mod otlp_grpc;
pub mod otlp_http;
pub mod syslog;

static BULK_OPERATORS: [&str; 3] = ["create", "index", "update"];

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

pub fn cast_to_type(
    value: &mut Map<String, Value>,
    delta: Vec<Field>,
) -> Result<(), anyhow::Error> {
    let mut parse_error = String::new();
    for field in delta {
        let field_name = field.name().clone();
        let Some(val) = value.get(&field_name) else {
            continue;
        };
        if val.is_null() {
            value.insert(field_name, Value::Null);
            continue;
        }
        match field.data_type() {
            DataType::Utf8 => {
                if val.is_string() {
                    continue;
                }
                value.insert(field_name, Value::String(get_string_value(val)));
            }
            DataType::Int64 | DataType::Int32 | DataType::Int16 | DataType::Int8 => {
                if val.is_i64() {
                    continue;
                }
                let val = get_string_value(val);
                match val.parse::<i64>() {
                    Ok(val) => {
                        value.insert(field_name, Value::Number(val.into()));
                    }
                    Err(_) => set_parsing_error(&mut parse_error, &field),
                };
            }
            DataType::UInt64 | DataType::UInt32 | DataType::UInt16 | DataType::UInt8 => {
                if val.is_u64() {
                    continue;
                }
                let val = get_string_value(val);
                match val.parse::<u64>() {
                    Ok(val) => {
                        value.insert(field_name, Value::Number(val.into()));
                    }
                    Err(_) => set_parsing_error(&mut parse_error, &field),
                };
            }
            DataType::Float64 | DataType::Float32 | DataType::Float16 => {
                if val.is_f64() {
                    continue;
                }
                let val = get_string_value(val);
                match val.parse::<f64>() {
                    Ok(val) => {
                        value.insert(
                            field_name,
                            Value::Number(serde_json::Number::from_f64(val).unwrap()),
                        );
                    }
                    Err(_) => set_parsing_error(&mut parse_error, &field),
                };
            }
            DataType::Boolean => {
                if val.is_boolean() {
                    continue;
                }
                let val = get_string_value(val);
                match val.parse::<bool>() {
                    Ok(val) => {
                        value.insert(field_name, Value::Bool(val));
                    }
                    Err(_) => set_parsing_error(&mut parse_error, &field),
                };
            }
            _ => set_parsing_error(&mut parse_error, &field),
        };
    }
    if !parse_error.is_empty() {
        Err(anyhow::Error::msg(parse_error))
    } else {
        Ok(())
    }
}

pub fn cast_to_schema_v1(
    value: &mut Map<String, Value>,
    schema_map: &HashMap<&String, &DataType>,
) -> Result<(), anyhow::Error> {
    let mut parse_error = String::new();
    for (field_name, data_type) in schema_map {
        let field_name_str = field_name.to_owned().to_owned();
        // let field_name = field_name_str.to_owned();
        let Some(val) = value.get(&field_name_str) else {
            continue;
        };
        if val.is_null() {
            value.insert(field_name_str, Value::Null);
            continue;
        }
        match data_type {
            DataType::Utf8 => {
                if val.is_string() {
                    continue;
                }
                value.insert(field_name_str, Value::String(get_string_value(val)));
            }
            DataType::Int64 | DataType::Int32 | DataType::Int16 | DataType::Int8 => {
                if val.is_i64() {
                    continue;
                }
                if val.is_boolean() {
                    value.insert(
                        field_name_str,
                        Value::Number(bool_to_serde_json_number(val.as_bool().unwrap())),
                    );
                    continue;
                }
                let val = get_string_value(val);
                match val.parse::<i64>() {
                    Ok(val) => {
                        value.insert(field_name_str, Value::Number(val.into()));
                    }
                    Err(_) => set_parsing_error_v1(&mut parse_error, &field_name_str, data_type),
                };
            }
            DataType::UInt64 | DataType::UInt32 | DataType::UInt16 | DataType::UInt8 => {
                if val.is_u64() {
                    continue;
                }
                if val.is_boolean() {
                    value.insert(
                        field_name_str,
                        Value::Number(bool_to_serde_json_number(val.as_bool().unwrap())),
                    );
                    continue;
                }
                let val = get_string_value(val);
                match val.parse::<u64>() {
                    Ok(val) => {
                        value.insert(field_name_str, Value::Number(val.into()));
                    }
                    Err(_) => set_parsing_error_v1(&mut parse_error, &field_name_str, data_type),
                };
            }
            DataType::Float64 | DataType::Float32 | DataType::Float16 => {
                if val.is_f64() {
                    continue;
                }
                if val.is_boolean() {
                    value.insert(
                        field_name_str,
                        Value::Number(bool_to_serde_json_number(val.as_bool().unwrap())),
                    );
                    continue;
                }
                let val = get_string_value(val);
                match val.parse::<f64>() {
                    Ok(val) => {
                        value.insert(
                            field_name_str,
                            Value::Number(serde_json::Number::from_f64(val).unwrap()),
                        );
                    }
                    Err(_) => set_parsing_error_v1(&mut parse_error, &field_name_str, data_type),
                };
            }
            DataType::Boolean => {
                if val.is_boolean() {
                    continue;
                }
                let val = get_string_value(val);
                match val.parse::<bool>() {
                    Ok(val) => {
                        value.insert(field_name_str, Value::Bool(val));
                    }
                    Err(_) => set_parsing_error_v1(&mut parse_error, &field_name_str, data_type),
                };
            }
            _ => set_parsing_error_v1(&mut parse_error, &field_name_str, data_type),
        };
    }
    if !parse_error.is_empty() {
        Err(anyhow::Error::msg(parse_error))
    } else {
        Ok(())
    }
}

async fn add_valid_record(
    stream_meta: &StreamMeta<'_>,
    stream_schema_map: &mut HashMap<String, SchemaCache>,
    status: &mut RecordStatus,
    write_buf: &mut HashMap<String, SchemaRecords>,
    mut record_val: Map<String, Value>,
    need_trigger: bool,
) -> Result<Option<TriggerAlertData>> {
    let mut trigger: TriggerAlertData = Vec::new();
    let timestamp: i64 = record_val
        .get(&CONFIG.common.column_timestamp)
        .unwrap()
        .as_i64()
        .unwrap();

    // check schema
    let (schema_evolution, _) = check_for_schema(
        &stream_meta.org_id,
        &stream_meta.stream_name,
        StreamType::Logs,
        stream_schema_map,
        vec![&record_val],
        timestamp,
    )
    .await?;

    // get schema
    let rec_schema = stream_schema_map.get(&stream_meta.stream_name).unwrap();
    let schema_key = rec_schema.hash_key();

    // get hour key
    let hour_key = get_wal_time_key(
        timestamp,
        stream_meta.partition_keys,
        unwrap_partition_time_level(*stream_meta.partition_time_level, StreamType::Logs),
        &record_val,
        Some(schema_key),
    );

    if !schema_evolution.schema_compatible {
        status.failed += 1;
        return Ok(None);
    }

    let valid_record = match schema_evolution.types_delta {
        None => true,
        Some(delta) => {
            let ret_val = if !CONFIG.common.widening_schema_evolution
                || !schema_evolution.is_schema_changed
            {
                cast_to_type(&mut record_val, delta)
            } else {
                let local_delta = delta
                    .into_iter()
                    .filter(|x| x.metadata().contains_key("zo_cast"))
                    .collect::<Vec<_>>();
                if !local_delta.is_empty() {
                    cast_to_type(&mut record_val, local_delta)
                } else {
                    Ok(())
                }
            };
            match ret_val {
                Ok(_) => true,
                Err(e) => {
                    status.failed += 1;
                    status.error = e.to_string();
                    false
                }
            }
        }
    };
    if !valid_record {
        return Ok(None);
    }

    if need_trigger && !stream_meta.stream_alerts_map.is_empty() {
        // Start check for alert trigger
        let key = format!(
            "{}/{}/{}",
            &stream_meta.org_id,
            StreamType::Logs,
            &stream_meta.stream_name
        );
        if let Some(alerts) = stream_meta.stream_alerts_map.get(&key) {
            for alert in alerts {
                if let Ok(Some(v)) = alert.evaluate(Some(&record_val)).await {
                    trigger.push((alert.clone(), v));
                }
            }
        }
        // End check for alert trigger
    }

    let hour_buf = write_buf.entry(hour_key).or_insert_with(|| {
        let schema = Arc::new(rec_schema.schema().clone().with_metadata(HashMap::new()));
        let schema_key = schema.hash_key();
        SchemaRecords {
            schema_key,
            schema,
            records: vec![],
            records_size: 0,
        }
    });
    let record_val = Value::Object(record_val);
    let record_size = estimate_json_bytes(&record_val);
    hour_buf.records.push(Arc::new(record_val));
    hour_buf.records_size += record_size;
    status.successful += 1;

    if trigger.is_empty() {
        Ok(None)
    } else {
        Ok(Some(trigger))
    }
}

fn set_parsing_error(parse_error: &mut String, field: &Field) {
    parse_error.push_str(&format!(
        "Failed to cast {} to type {} ",
        field.name(),
        field.data_type()
    ));
}

fn set_parsing_error_v1(parse_error: &mut String, field_name: &str, field_data_type: &DataType) {
    parse_error.push_str(&format!(
        "Failed to cast {} to type {} ",
        field_name, field_data_type
    ));
}

async fn add_record(
    stream_meta: &StreamMeta<'_>,
    write_buf: &mut HashMap<String, SchemaRecords>,
    record_val: Map<String, Value>,
) -> Result<()> {
    let timestamp: i64 = record_val
        .get(&CONFIG.common.column_timestamp)
        .unwrap()
        .as_i64()
        .unwrap();
    // get hour key
    let hour_key = get_wal_time_key(
        timestamp,
        stream_meta.partition_keys,
        unwrap_partition_time_level(*stream_meta.partition_time_level, StreamType::Logs),
        &record_val,
        None,
    );

    let hour_buf = write_buf.entry(hour_key).or_insert_with(|| {
        let schema = Arc::new(Schema::empty());
        let schema_key = schema.hash_key();
        SchemaRecords {
            schema_key,
            schema,
            records: vec![],
            records_size: 0,
        }
    });
    let record_value = Value::Object(record_val.clone());
    hour_buf.records.push(Arc::new(record_value));
    Ok(())
}

fn bool_to_serde_json_number(value: bool) -> serde_json::Number {
    let num = value as i64;
    serde_json::Number::from(num)
}

struct StreamMeta<'a> {
    org_id: String,
    stream_name: String,
    partition_keys: &'a Vec<StreamPartition>,
    partition_time_level: &'a Option<PartitionTimeLevel>,
    stream_alerts_map: &'a HashMap<String, Vec<Alert>>,
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
        let ret_val = cast_to_type(&mut local_val, delta);
        assert!(ret_val.is_ok());
    }
}
