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
    collections::{HashMap, HashSet},
    io::Write,
    sync::Arc,
};

use anyhow::Result;
use arrow_schema::{DataType, Field};
use config::{
    get_config,
    meta::{
        stream::{PartitionTimeLevel, StreamPartition, StreamType},
        usage::RequestStats,
    },
    utils::{
        json::{estimate_json_bytes, get_string_value, pickup_string_value, Map, Number, Value},
        schema_ext::SchemaExt,
    },
    DISTINCT_FIELDS,
};
use infra::schema::{unwrap_partition_time_level, SchemaCache};

use super::{
    ingestion::{evaluate_trigger, write_file, TriggerAlertData},
    metadata::{distinct_values::DvItem, write, MetadataItem, MetadataType},
    schema::stream_schema_exists,
};
use crate::{
    common::meta::{
        alerts::Alert,
        ingestion::IngestionStatus,
        stream::{SchemaRecords, StreamParams},
    },
    service::{ingestion::get_wal_time_key, schema::check_for_schema},
};

pub mod bulk;
pub mod ingest;
pub mod otlp_grpc;
pub mod otlp_http;
pub mod syslog;

static BULK_OPERATORS: [&str; 3] = ["create", "index", "update"];

fn parse_bulk_index(v: &Value) -> Option<(String, String, Option<String>)> {
    let local_val = v.as_object().unwrap();
    for action in BULK_OPERATORS {
        if local_val.contains_key(action) {
            let local_val = local_val.get(action).unwrap().as_object().unwrap();
            let index = match local_val.get("_index") {
                Some(v) => v.as_str().unwrap().to_string(),
                None => return None,
            };
            let doc_id = local_val
                .get("_id")
                .map(|v| v.as_str().unwrap().to_string());
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
    let mut errors = Vec::new();
    for (key, val) in value.iter_mut() {
        if val.is_null() {
            continue;
        }
        let Some(data_type) = schema_map.get(key) else {
            continue;
        };
        match data_type {
            DataType::Utf8 => {
                if val.is_string() {
                    continue;
                }
                *val = Value::String(get_string_value(val));
            }
            DataType::Int64 | DataType::Int32 | DataType::Int16 | DataType::Int8 => {
                if val.is_i64() {
                    continue;
                }
                if val.is_u64() {
                    continue;
                }
                if val.is_f64() {
                    *val = Value::Number((val.as_f64().unwrap() as i64).into());
                    continue;
                }
                if val.is_boolean() {
                    *val = Value::Number((val.as_bool().unwrap() as i64).into());
                    continue;
                }
                let local_val = get_string_value(val);
                match local_val.parse::<i64>() {
                    Ok(v) => {
                        *val = Value::Number(v.into());
                    }
                    Err(_) => errors.push((key, *data_type)),
                };
            }
            DataType::UInt64 | DataType::UInt32 | DataType::UInt16 | DataType::UInt8 => {
                if val.is_i64() {
                    continue;
                }
                if val.is_u64() {
                    continue;
                }
                if val.is_f64() {
                    *val = Value::Number((val.as_f64().unwrap() as u64).into());
                    continue;
                }
                if val.is_boolean() {
                    *val = Value::Number((val.as_bool().unwrap() as u64).into());
                    continue;
                }
                let local_val = get_string_value(val);
                match local_val.parse::<u64>() {
                    Ok(v) => {
                        *val = Value::Number(v.into());
                    }
                    Err(_) => errors.push((key, *data_type)),
                };
            }
            DataType::Float64 | DataType::Float32 | DataType::Float16 => {
                if val.is_f64() {
                    continue;
                }
                if val.is_i64() {
                    *val = Value::Number(Number::from_f64(val.as_i64().unwrap() as f64).unwrap());
                    continue;
                }
                if val.is_u64() {
                    *val = Value::Number(Number::from_f64(val.as_u64().unwrap() as f64).unwrap());
                    continue;
                }
                if val.is_boolean() {
                    *val = Value::Number(
                        Number::from_f64((val.as_bool().unwrap() as i64) as f64).unwrap(),
                    );
                    continue;
                }
                let local_val = get_string_value(val);
                match local_val.parse::<f64>() {
                    Ok(local_val) => {
                        *val = Value::Number(serde_json::Number::from_f64(local_val).unwrap());
                    }
                    Err(_) => errors.push((key, *data_type)),
                };
            }
            DataType::Boolean => {
                if val.is_boolean() {
                    continue;
                }
                if val.is_i64() {
                    *val = Value::Bool(val.as_i64().unwrap() > 0);
                    continue;
                }
                if val.is_u64() {
                    *val = Value::Bool(val.as_u64().unwrap() > 0);
                    continue;
                }
                if val.is_f64() {
                    *val = Value::Bool(val.as_f64().unwrap() > 0.0);
                    continue;
                }
                let local_val: String = get_string_value(val);
                match local_val.parse::<bool>() {
                    Ok(local_val) => {
                        *val = Value::Bool(local_val);
                    }
                    Err(_) => errors.push((key, *data_type)),
                };
            }
            _ => errors.push((key, *data_type)),
        };
    }
    if !errors.is_empty() {
        let error_message = errors
            .iter()
            .map(|(field, dt)| format!("Failed to cast Field: {}, DataType: {:?}", field, dt))
            .collect::<Vec<_>>()
            .join(", ");
        Err(anyhow::Error::msg(error_message))
    } else {
        Ok(())
    }
}

fn set_parsing_error(parse_error: &mut String, field: &Field) {
    parse_error.push_str(&format!(
        "Failed to cast {} to type {} ",
        field.name(),
        field.data_type()
    ));
}

async fn write_logs(
    org_id: &str,
    stream_name: &str,
    status: &mut IngestionStatus,
    json_data: Vec<(i64, Map<String, Value>)>,
) -> Result<RequestStats> {
    let cfg = get_config();
    // get schema and stream settings
    let mut stream_schema_map: HashMap<String, SchemaCache> = HashMap::new();
    let stream_schema = stream_schema_exists(
        org_id,
        stream_name,
        StreamType::Logs,
        &mut stream_schema_map,
    )
    .await;

    let mut partition_keys: Vec<StreamPartition> = vec![];
    let mut partition_time_level = PartitionTimeLevel::from(cfg.limit.logs_file_retention.as_str());
    if stream_schema.has_partition_keys {
        let partition_det = crate::service::ingestion::get_stream_partition_keys(
            org_id,
            &StreamType::Logs,
            stream_name,
        )
        .await;
        partition_keys = partition_det.partition_keys;
        partition_time_level =
            unwrap_partition_time_level(partition_det.partition_time_level, StreamType::Logs);
    }

    // Start get stream alerts
    let mut stream_alerts_map: HashMap<String, Vec<Alert>> = HashMap::new();
    let mut trigger: Option<TriggerAlertData> = None;
    crate::service::ingestion::get_stream_alerts(
        &[StreamParams {
            org_id: org_id.to_owned().into(),
            stream_name: stream_name.to_owned().into(),
            stream_type: StreamType::Logs,
        }],
        &mut stream_alerts_map,
    )
    .await;
    // End get stream alert

    // start check for schema
    let min_timestamp = json_data.iter().map(|(ts, _)| ts).min().unwrap();
    let schema_evolution = check_for_schema(
        org_id,
        stream_name,
        StreamType::Logs,
        &mut stream_schema_map,
        json_data.iter().map(|(_, v)| v).collect(),
        *min_timestamp,
    )
    .await?;

    // get schema
    let rec_schema = stream_schema_map
        .get(stream_name)
        .unwrap()
        .schema()
        .clone()
        .with_metadata(HashMap::new());
    let rec_schema = Arc::new(rec_schema);
    let schema_key = rec_schema.hash_key();

    let mut distinct_values = Vec::with_capacity(16);

    let mut write_buf: HashMap<String, SchemaRecords> = HashMap::new();

    for (timestamp, mut record_val) in json_data {
        let doc_id = record_val
            .get("_id")
            .map(|v| v.as_str().unwrap().to_string());

        // validate record
        if let Some(delta) = schema_evolution.types_delta.as_ref() {
            let ret_val =
                if !cfg.common.widening_schema_evolution || !schema_evolution.is_schema_changed {
                    cast_to_type(&mut record_val, delta.to_owned())
                } else {
                    let local_delta = delta
                        .iter()
                        .filter_map(|x| {
                            if x.metadata().contains_key("zo_cast") {
                                Some(x.to_owned())
                            } else {
                                None
                            }
                        })
                        .collect::<Vec<_>>();
                    if !local_delta.is_empty() {
                        cast_to_type(&mut record_val, local_delta)
                    } else {
                        Ok(())
                    }
                };
            if let Err(e) = ret_val {
                // update status(fail)
                match status {
                    IngestionStatus::Record(status) => {
                        status.failed += 1;
                        status.error = e.to_string();
                    }
                    IngestionStatus::Bulk(bulk_res) => {
                        bulk_res.errors = true;
                        bulk::add_record_status(
                            stream_name.to_string(),
                            &doc_id,
                            "".to_string(),
                            Some(Value::Object(record_val.clone())),
                            bulk_res,
                            Some(bulk::SCHEMA_CONFORMANCE_FAILED.to_string()),
                            Some(e.to_string()),
                        );
                    }
                }
                continue;
            }
        }

        // start check for alert trigger
        if trigger.is_none() && !stream_alerts_map.is_empty() {
            let key = format!("{}/{}/{}", &org_id, StreamType::Logs, &stream_name);
            if let Some(alerts) = stream_alerts_map.get(&key) {
                let mut trigger_alerts: TriggerAlertData = Vec::new();
                for alert in alerts {
                    if let Ok(Some(v)) = alert.evaluate(Some(&record_val)).await {
                        trigger_alerts.push((alert.clone(), v));
                    }
                }
                trigger = Some(trigger_alerts);
            }
        }
        // end check for alert triggers

        // get distinct_value items
        let mut to_add_distinct_values = vec![];
        for field in DISTINCT_FIELDS.iter() {
            if let Some(val) = record_val.get(field) {
                to_add_distinct_values.push(MetadataItem::DistinctValues(DvItem {
                    stream_type: StreamType::Logs,
                    stream_name: stream_name.to_string(),
                    field_name: field.to_string(),
                    field_value: val.as_str().unwrap().to_string(),
                    filter_name: "".to_string(),
                    filter_value: "".to_string(),
                }));
            }
        }

        // get hour key
        let hour_key = get_wal_time_key(
            timestamp,
            &partition_keys,
            partition_time_level,
            &record_val,
            Some(&schema_key),
        );

        let hour_buf = write_buf.entry(hour_key).or_insert_with(|| SchemaRecords {
            schema_key: schema_key.clone(),
            schema: rec_schema.clone(),
            records: vec![],
            records_size: 0,
        });
        let record_val = Value::Object(record_val);
        let record_size = estimate_json_bytes(&record_val);
        hour_buf.records.push(Arc::new(record_val));
        hour_buf.records_size += record_size;

        // update status(success)
        match status {
            IngestionStatus::Record(status) => {
                status.successful += 1;
            }
            IngestionStatus::Bulk(bulk_res) => {
                bulk::add_record_status(
                    stream_name.to_string(),
                    &doc_id,
                    "".to_string(),
                    None,
                    bulk_res,
                    None,
                    None,
                );
            }
        }

        // add distinct values
        distinct_values.extend(to_add_distinct_values);
    }

    // write data to wal
    let writer = ingester::get_writer(org_id, &StreamType::Logs.to_string(), stream_name).await;
    let req_stats = write_file(&writer, stream_name, write_buf).await;
    if let Err(e) = writer.sync().await {
        log::error!("ingestion error while syncing writer: {}", e);
    }

    // send distinct_values
    if !distinct_values.is_empty() {
        if let Err(e) = write(org_id, MetadataType::DistinctValues, distinct_values).await {
            log::error!("Error while writing distinct values: {}", e);
        }
    }

    // only one trigger per request
    evaluate_trigger(trigger).await;

    Ok(req_stats)
}

pub fn refactor_map(
    original_map: Map<String, Value>,
    defined_schema_keys: &HashSet<String>,
) -> Map<String, Value> {
    let mut new_map = Map::with_capacity(defined_schema_keys.len() + 2);
    let mut non_schema_map = Vec::with_capacity(1024); // 1KB

    let mut has_elements = false;
    non_schema_map.write_all(b"{").unwrap();
    for (key, value) in original_map {
        if defined_schema_keys.contains(&key) {
            new_map.insert(key, value);
        } else {
            if has_elements {
                non_schema_map.write_all(b",").unwrap();
            } else {
                has_elements = true;
            }
            non_schema_map.write_all(b"\"").unwrap();
            non_schema_map.write_all(key.as_bytes()).unwrap();
            non_schema_map.write_all(b"\":\"").unwrap();
            non_schema_map
                .write_all(pickup_string_value(value).as_bytes())
                .unwrap();
            non_schema_map.write_all(b"\"").unwrap();
        }
    }
    non_schema_map.write_all(b"}").unwrap();

    if has_elements {
        new_map.insert(
            get_config().common.column_all.to_string(),
            Value::String(String::from_utf8(non_schema_map).unwrap()),
        );
    }

    new_map
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
