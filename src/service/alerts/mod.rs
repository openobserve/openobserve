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

use actix_web::http;
use arrow_schema::DataType;
use chrono::{Duration, Utc};
use std::collections::HashMap;

use crate::common::{
    meta::{
        alerts::{triggers::Trigger, Alert, Condition, Operator, QueryCondition},
        search, StreamType,
    },
    utils::{
        json::{Map, Value},
        schema_ext::SchemaExt,
    },
};
use crate::service::{db, search as SearchService};

pub mod alert_manager;
pub mod destinations;
pub mod templates;
pub mod triggers;

pub async fn save(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
    mut alert: Alert,
) -> Result<(), anyhow::Error> {
    alert.name = name.to_string();
    alert.org_id = org_id.to_string();
    alert.stream_type = stream_type;
    alert.stream_name = stream_name.to_string();

    if alert.name.is_empty() {
        return Err(anyhow::anyhow!("Alert name is required"));
    }

    // before saving alert check alert destination
    for dest in alert.destinations.iter() {
        if db::alerts::destinations::get(org_id, dest).await.is_err() {
            return Err(anyhow::anyhow!("Alert destination {dest} not found"));
        };
    }

    // before saving alert check column type to decide numeric condition
    let schema = db::schema::get(org_id, stream_name, stream_type).await?;
    let fields = schema.to_cloned_fields();
    if stream_name.is_empty() || fields.is_empty() {
        return Err(anyhow::anyhow!("Stream {stream_name} not found"));
    }

    if alert.is_real_time
        && (alert.query_condition.conditions.is_none()
            || alert
                .query_condition
                .conditions
                .as_ref()
                .unwrap()
                .is_empty())
    {
        return Err(anyhow::anyhow!(
            "Realtime alert must have at least one condition"
        ));
    }

    if (alert.query_condition.sql.is_none()
        || alert.query_condition.sql.as_ref().unwrap().is_empty())
        && (alert.query_condition.conditions.is_none()
            || alert
                .query_condition
                .conditions
                .as_ref()
                .unwrap()
                .is_empty())
    {
        return Err(anyhow::anyhow!("Alert must have at least one condition"));
    }

    // test the alert
    _ = &alert.evaluate(None).await?;

    // save the alert
    db::alerts::set(org_id, stream_type, stream_name, name, alert).await
}

pub async fn get(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<Option<Alert>, anyhow::Error> {
    db::alerts::get(org_id, stream_type, stream_name, name).await
}

pub async fn list(
    org_id: &str,
    stream_type: Option<StreamType>,
    stream_name: Option<&str>,
) -> Result<Vec<Alert>, anyhow::Error> {
    db::alerts::list(org_id, stream_type, stream_name).await
}

pub async fn delete(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<(), (http::StatusCode, anyhow::Error)> {
    if db::alerts::get(org_id, stream_type, stream_name, name)
        .await
        .is_err()
    {
        return Err((
            http::StatusCode::NOT_FOUND,
            anyhow::anyhow!("Alert not found"),
        ));
    }
    db::alerts::delete(org_id, stream_type, stream_name, name)
        .await
        .map_err(|e| (http::StatusCode::INTERNAL_SERVER_ERROR, e))
}

pub async fn enable(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
    value: bool,
) -> Result<(), (http::StatusCode, anyhow::Error)> {
    let mut alert = match db::alerts::get(org_id, stream_type, stream_name, name).await {
        Ok(Some(alert)) => alert,
        _ => {
            return Err((
                http::StatusCode::NOT_FOUND,
                anyhow::anyhow!("Alert not found"),
            ));
        }
    };
    alert.enabled = value;
    db::alerts::set(org_id, stream_type, stream_name, name, alert)
        .await
        .map_err(|e| (http::StatusCode::INTERNAL_SERVER_ERROR, e))
}

pub async fn trigger(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<(), (http::StatusCode, anyhow::Error)> {
    let alert = match db::alerts::get(org_id, stream_type, stream_name, name).await {
        Ok(Some(alert)) => alert,
        _ => {
            return Err((
                http::StatusCode::NOT_FOUND,
                anyhow::anyhow!("Alert not found"),
            ));
        }
    };
    alert
        .send_notification(&[])
        .await
        .map_err(|e| (http::StatusCode::INTERNAL_SERVER_ERROR, e))
}

impl Alert {
    pub async fn evaluate(
        &self,
        row: Option<&Map<String, Value>>,
    ) -> Result<Option<Vec<Map<String, Value>>>, anyhow::Error> {
        if !self.enabled {
            return Ok(None);
        }
        if self.is_real_time {
            self.query_condition.evaluate_realtime(self, row).await
        } else {
            self.query_condition.evaluate_schedule(self).await
        }
    }

    pub async fn send_notification(
        &self,
        _row: &[Map<String, Value>],
    ) -> Result<(), anyhow::Error> {
        // TODO send the notification
        log::warn!("send notification for alert [{}]", self.name);

        // check the silence period
        if self.trigger_condition.silence > 0 {
            let trigger = Trigger {
                next_run_at: (Utc::now() + Duration::minutes(self.trigger_condition.silence))
                    .timestamp_micros(),
                is_realtime: self.is_real_time,
                is_silenced: true,
            };
            log::warn!(
                "alert [{}] is silenced for {} minutes",
                self.name,
                self.trigger_condition.silence
            );
            triggers::save(
                &self.org_id,
                self.stream_type,
                &self.stream_name,
                &self.name,
                &trigger,
            )
            .await?;
        }
        Ok(())
    }
}

impl QueryCondition {
    pub async fn evaluate_realtime(
        &self,
        _alert: &Alert,
        row: Option<&Map<String, Value>>,
    ) -> Result<Option<Vec<Map<String, Value>>>, anyhow::Error> {
        let row = match row {
            Some(row) => row,
            None => {
                return Ok(None);
            }
        };
        if self.conditions.is_none() {
            return Ok(None);
        }
        let conditions = self.conditions.as_ref().unwrap();
        if conditions.is_empty() {
            return Ok(None);
        }
        for condition in conditions.iter() {
            if !condition.evaluate(row).await {
                return Ok(None);
            }
        }
        Ok(Some(vec![row.to_owned()]))
    }

    pub async fn evaluate_schedule(
        &self,
        alert: &Alert,
    ) -> Result<Option<Vec<Map<String, Value>>>, anyhow::Error> {
        let sql = if self.sql.is_some() {
            self.sql.as_ref().unwrap().to_string()
        } else {
            let conditions = self.conditions.as_ref().unwrap();
            if conditions.is_empty() {
                return Ok(None);
            }
            build_sql(alert, conditions).await?
        };
        // fire the query
        log::warn!("evaluate schedule query: {}", sql);

        let now = Utc::now().timestamp_micros();
        let req = search::Request {
            query: search::Query {
                sql: sql.clone(),
                from: 0,
                size: 100,
                start_time: now
                    - Duration::minutes(alert.trigger_condition.period)
                        .num_microseconds()
                        .unwrap(),
                end_time: now,
                sort_by: None,
                sql_mode: "full".to_string(),
                query_type: "".to_string(),
                track_total_hits: false,
                uses_zo_fn: false,
                query_context: None,
                query_fn: None,
            },
            aggs: HashMap::new(),
            encoding: search::RequestEncoding::Empty,
            timeout: 0,
        };
        let session_id = uuid::Uuid::new_v4().to_string();
        let resp =
            SearchService::search(&session_id, &alert.org_id, alert.stream_type, &req).await?;
        if resp.total < alert.trigger_condition.threshold as usize {
            Ok(None)
        } else {
            Ok(Some(
                resp.hits
                    .iter()
                    .map(|hit| hit.as_object().unwrap().clone())
                    .collect(),
            ))
        }
    }
}

impl Condition {
    pub async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        let val = match row.get(&self.column) {
            Some(val) => val,
            None => {
                return false;
            }
        };
        match val {
            Value::String(v) => {
                let val = v.as_str();
                let con_val = self.value.as_str().unwrap_or_default();
                match self.operator {
                    Operator::EqualTo => val == con_val,
                    Operator::NotEqualTo => val != con_val,
                    Operator::GreaterThan => val > con_val,
                    Operator::GreaterThanEquals => val >= con_val,
                    Operator::LessThan => val < con_val,
                    Operator::LessThanEquals => val <= con_val,
                    Operator::Contains => val.contains(con_val),
                    Operator::NotContains => !val.contains(con_val),
                }
            }
            Value::Number(_) => {
                let val = val.as_f64().unwrap_or_default();
                let con_val = self.value.as_f64().unwrap_or_default();
                match self.operator {
                    Operator::EqualTo => val == con_val,
                    Operator::NotEqualTo => val != con_val,
                    Operator::GreaterThan => val > con_val,
                    Operator::GreaterThanEquals => val >= con_val,
                    Operator::LessThan => val < con_val,
                    Operator::LessThanEquals => val <= con_val,
                    _ => false,
                }
            }
            Value::Bool(v) => {
                let val = v.to_owned();
                let con_val = self.value.as_bool().unwrap_or_default();
                match self.operator {
                    Operator::EqualTo => val == con_val,
                    Operator::NotEqualTo => val != con_val,
                    _ => false,
                }
            }
            _ => false,
        }
    }
}

async fn build_sql(alert: &Alert, conditions: &[Condition]) -> Result<String, anyhow::Error> {
    let schema = db::schema::get(&alert.org_id, &alert.stream_name, alert.stream_type).await?;
    let mut wheres = Vec::with_capacity(conditions.len());
    for cond in conditions.iter() {
        let data_type = match schema.field_with_name(&cond.column) {
            Ok(field) => field.data_type(),
            Err(_) => {
                return Err(anyhow::anyhow!(
                    "Column {} not found on stream {}",
                    &cond.column,
                    &alert.stream_name
                ))
            }
        };
        let cond = match data_type {
            DataType::Utf8 => {
                let val = if cond.value.is_string() {
                    cond.value.as_str().unwrap_or_default().to_string()
                } else {
                    cond.value.to_string()
                };
                match cond.operator {
                    Operator::EqualTo => format!("\"{}\" {} '{}'", cond.column, "=", val),
                    Operator::NotEqualTo => format!("\"{}\" {} '{}'", cond.column, "!=", val),
                    Operator::GreaterThan => format!("\"{}\" {} '{}'", cond.column, ">", val),
                    Operator::GreaterThanEquals => {
                        format!("\"{}\" {} '{}'", cond.column, ">=", val)
                    }
                    Operator::LessThan => format!("\"{}\" {} '{}'", cond.column, "<", val),
                    Operator::LessThanEquals => format!("\"{}\" {} '{}'", cond.column, "<=", val),
                    Operator::Contains => format!("\"{}\" {} '%{}%'", cond.column, "LIKE", val),
                    Operator::NotContains => {
                        format!("\"{}\" {} '%{}%'", cond.column, "NOT LIKE", val)
                    }
                }
            }
            DataType::Int16 | DataType::Int32 | DataType::Int64 => {
                let val = if cond.value.is_number() {
                    cond.value.as_i64().unwrap_or_default()
                } else {
                    cond.value
                        .as_str()
                        .unwrap_or_default()
                        .parse()
                        .map_err(|e| {
                            anyhow::anyhow!(
                                "Column [{}] dataType is [{}] but value is [{}], err: {}",
                                cond.column,
                                data_type,
                                cond.value,
                                e
                            )
                        })?
                };
                match cond.operator {
                    Operator::EqualTo => format!("\"{}\" {} {}", cond.column, "=", val),
                    Operator::NotEqualTo => format!("\"{}\" {} {}", cond.column, "!=", val),
                    Operator::GreaterThan => format!("\"{}\" {} {}", cond.column, ">", val),
                    Operator::GreaterThanEquals => {
                        format!("\"{}\" {} {}", cond.column, ">=", val)
                    }
                    Operator::LessThan => format!("\"{}\" {} {}", cond.column, "<", val),
                    Operator::LessThanEquals => {
                        format!("\"{}\" {} {}", cond.column, "<=", val)
                    }
                    _ => {
                        return Err(anyhow::anyhow!(
                            "Column {} has data_type [{}] and it does not supported operator [{:?}]",
                            cond.column,
                            data_type,
                            cond.operator
                        ));
                    }
                }
            }
            DataType::Float32 | DataType::Float64 => {
                let val = if cond.value.is_number() {
                    cond.value.as_f64().unwrap_or_default()
                } else {
                    cond.value
                        .as_str()
                        .unwrap_or_default()
                        .parse()
                        .map_err(|e| {
                            anyhow::anyhow!(
                                "Column [{}] dataType is [{}] but value is [{}], err: {}",
                                cond.column,
                                data_type,
                                cond.value,
                                e
                            )
                        })?
                };
                match cond.operator {
                    Operator::EqualTo => format!("\"{}\" {} {}", cond.column, "=", val),
                    Operator::NotEqualTo => format!("\"{}\" {} {}", cond.column, "!=", val),
                    Operator::GreaterThan => format!("\"{}\" {} {}", cond.column, ">", val),
                    Operator::GreaterThanEquals => {
                        format!("\"{}\" {} {}", cond.column, ">=", val)
                    }
                    Operator::LessThan => format!("\"{}\" {} {}", cond.column, "<", val),
                    Operator::LessThanEquals => {
                        format!("\"{}\" {} {}", cond.column, "<=", val)
                    }
                    _ => {
                        return Err(anyhow::anyhow!(
                            "Column {} has data_type [{}] and it does not supported operator [{:?}]",
                            cond.column,
                            data_type,
                            cond.operator
                        ));
                    }
                }
            }
            DataType::Boolean => {
                let val = if cond.value.is_boolean() {
                    cond.value.as_bool().unwrap_or_default()
                } else {
                    cond.value
                        .as_str()
                        .unwrap_or_default()
                        .parse()
                        .map_err(|e| {
                            anyhow::anyhow!(
                                "Column [{}] dataType is [{}] but value is [{}], err: {}",
                                cond.column,
                                data_type,
                                cond.value,
                                e
                            )
                        })?
                };
                match cond.operator {
                    Operator::EqualTo => format!("\"{}\" {} {}", cond.column, "=", val),
                    Operator::NotEqualTo => format!("\"{}\" {} {}", cond.column, "!=", val),
                    _ => {
                        return Err(anyhow::anyhow!(
                        "Column {} has data_type [{}] and it does not supported operator [{:?}]",
                        cond.column,
                        data_type,
                        cond.operator
                    ));
                    }
                }
            }
            _ => {
                return Err(anyhow::anyhow!(
                    "Column {} has data_type [{}] and it does not supported by alert, if you think this is a bug please report it to us",
                    cond.column,
                    data_type
                ));
            }
        };
        wheres.push(cond);
    }
    let sql = format!(
        "SELECT * FROM \"{}\" WHERE {}",
        alert.stream_name,
        wheres.join(" AND ")
    );
    Ok(sql)
}
