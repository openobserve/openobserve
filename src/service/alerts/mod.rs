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

use std::collections::{HashMap, HashSet};

use actix_web::http;
use arrow_schema::DataType;
use boa_engine::{property::Attribute, Context, JsValue, NativeFunction, Source};
use chrono::{Duration, Local, TimeZone, Utc};
use config::{
    ider,
    meta::stream::StreamType,
    utils::{
        base64,
        json::{Map, Value},
    },
    CONFIG,
};
use futures::future::join;
use serde_json::json;

use super::promql;
use crate::{
    common::{
        meta::{
            alerts::{
                destinations::{DestinationWithTemplate, HTTPType},
                scripts::Script,
                AggFunction, Alert, Condition, Operator, QueryCondition, QueryType,
            },
            authz::Authz,
            search,
        },
        utils::auth::{remove_ownership, set_ownership},
    },
    service::{db, search as SearchService},
};

pub mod alert_manager;
pub mod destinations;
pub mod js_vm;
pub mod scripts;
pub mod templates;
pub mod triggers;

pub async fn save(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
    mut alert: Alert,
) -> Result<(), anyhow::Error> {
    if !name.is_empty() {
        alert.name = name.trim().to_string();
    }
    alert.org_id = org_id.to_string();
    alert.stream_type = stream_type;
    alert.stream_name = stream_name.to_string();
    alert.row_template = alert.row_template.trim().to_string();

    if alert.name.is_empty() || alert.stream_name.is_empty() {
        return Err(anyhow::anyhow!("Alert name is required"));
    }
    if alert.name.contains('/') {
        return Err(anyhow::anyhow!("Alert name cannot contain '/'"));
    }

    // before saving alert check alert destinations and scripts
    if alert.destinations.is_empty() && alert.scripts.is_empty() {
        return Err(anyhow::anyhow!(
            "Atleast one destination/script is required"
        ));
    }
    for dest in alert.destinations.iter() {
        if db::alerts::destinations::get(org_id, dest).await.is_err() {
            return Err(anyhow::anyhow!("Alert destination {dest} not found"));
        };
    }
    for script in alert.scripts.iter() {
        if db::alerts::scripts::get(org_id, script).await.is_err() {
            return Err(anyhow::anyhow!("Alert script {script} not found"));
        };
    }

    // before saving alert check alert context attributes
    if alert.context_attributes.is_some() {
        let attrs = alert.context_attributes.as_ref().unwrap();
        let mut new_attrs = HashMap::with_capacity(attrs.len());
        for key in attrs.keys() {
            let new_key = key.trim().to_string();
            if !new_key.is_empty() {
                new_attrs.insert(new_key, attrs.get(key).unwrap().to_string());
            }
        }
    }

    // before saving alert check column type to decide numeric condition
    let schema = db::schema::get(org_id, stream_name, stream_type).await?;
    if stream_name.is_empty() || schema.fields().is_empty() {
        return Err(anyhow::anyhow!("Stream {stream_name} not found"));
    }

    if alert.is_real_time && alert.query_condition.query_type != QueryType::Custom {
        return Err(anyhow::anyhow!(
            "Realtime alert should use Custom query type"
        ));
    }

    match alert.query_condition.query_type {
        QueryType::Custom => {
            if alert.query_condition.aggregation.is_some() {
                // if it has result we should fire the alert when enable aggregation
                alert.trigger_condition.operator = Operator::GreaterThanEquals;
                alert.trigger_condition.threshold = 1;
            }
        }
        QueryType::SQL => {
            if alert.query_condition.sql.is_none()
                || alert.query_condition.sql.as_ref().unwrap().is_empty()
            {
                return Err(anyhow::anyhow!("Alert with SQL mode should have a query"));
            }
        }
        QueryType::PromQL => {
            if alert.query_condition.promql.is_none()
                || alert.query_condition.promql.as_ref().unwrap().is_empty()
                || alert.query_condition.promql_condition.is_none()
            {
                return Err(anyhow::anyhow!(
                    "Alert with PromQL mode should have a query"
                ));
            }
        }
    }

    // test the alert
    _ = &alert.evaluate(None).await?;

    // calulate the trigger frequency
    // alert.trigger_condition.frequency = std::cmp::max(
    //     1,
    //     alert.trigger_condition.period / alert.trigger_condition.threshold,
    // );
    alert.trigger_condition.frequency = std::cmp::max(10, CONFIG.limit.alert_schedule_interval);

    // save the alert
    match db::alerts::set(org_id, stream_type, stream_name, &alert).await {
        Ok(_) => {
            if name.is_empty() {
                set_ownership(org_id, "alerts", Authz::new(&alert.name)).await;
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
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
    match db::alerts::delete(org_id, stream_type, stream_name, name).await {
        Ok(_) => {
            remove_ownership(org_id, "alerts", Authz::new(name)).await;
            Ok(())
        }
        Err(e) => Err((http::StatusCode::INTERNAL_SERVER_ERROR, e)),
    }
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
    db::alerts::set(org_id, stream_type, stream_name, &alert)
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
        .take_action(&[])
        .await
        .map_err(|e| (http::StatusCode::INTERNAL_SERVER_ERROR, e))
}

impl Alert {
    pub async fn evaluate(
        &self,
        row: Option<&Map<String, Value>>,
    ) -> Result<Option<Vec<Map<String, Value>>>, anyhow::Error> {
        if self.is_real_time {
            self.query_condition.evaluate_realtime(row).await
        } else {
            self.query_condition.evaluate_scheduled(self).await
        }
    }

    pub async fn execute_scripts(&self, rows: &[Map<String, Value>]) -> Result<(), anyhow::Error> {
        for script in self.scripts.iter() {
            let script = scripts::get(&self.org_id, script).await?;
            if let Err(e) = execute_script(self, &script, rows).await {
                log::error!(
                    "Error running script {} for {}/{}/{}/{} err: {}",
                    script.name,
                    self.org_id,
                    self.stream_type,
                    self.stream_name,
                    self.name,
                    e
                );
            }
        }
        Ok(())
    }

    pub async fn send_notification(
        &self,
        rows: &[Map<String, Value>],
    ) -> Result<(), anyhow::Error> {
        for dest in self.destinations.iter() {
            let dest = destinations::get_with_template(&self.org_id, dest).await?;
            if let Err(e) = send_notification(self, &dest, rows).await {
                log::error!(
                    "Error sending notification for {}/{}/{}/{} err: {}",
                    self.org_id,
                    self.stream_type,
                    self.stream_name,
                    self.name,
                    e
                );
            }
        }
        Ok(())
    }

    pub async fn take_action(&self, rows: &[Map<String, Value>]) -> Result<(), anyhow::Error> {
        let notify = self.send_notification(rows);
        let execute = self.execute_scripts(rows);

        match join(notify, execute).await {
            (Ok(_), Err(e)) => Err(anyhow::anyhow!(
                "Alert notifications sent successfully, but scripts execution failed: {e}"
            )),
            (Err(e), Ok(_)) => Err(anyhow::anyhow!(
                "Alert scripts executed successfully, but notifications could not be sent: {e}"
            )),
            (Err(notify_e), Err(exec_e)) => Err(anyhow::anyhow!(
                "Failed to send alert notifications and execute scripts: {notify_e};{exec_e}"
            )),
            _ => Ok(()),
        }
    }
}

impl QueryCondition {
    pub async fn evaluate_realtime(
        &self,
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

    pub async fn evaluate_scheduled(
        &self,
        alert: &Alert,
    ) -> Result<Option<Vec<Map<String, Value>>>, anyhow::Error> {
        let now = Utc::now().timestamp_micros();
        let sql = match self.query_type {
            QueryType::Custom => {
                let Some(v) = self.conditions.as_ref() else {
                    return Ok(None);
                };
                build_sql(alert, v).await?
            }
            QueryType::SQL => {
                let Some(v) = self.sql.as_ref() else {
                    return Ok(None);
                };
                if v.is_empty() {
                    return Ok(None);
                } else {
                    v.to_string()
                }
            }
            QueryType::PromQL => {
                let Some(v) = self.promql.as_ref() else {
                    return Ok(None);
                };
                if v.is_empty() {
                    return Ok(None);
                }
                let start = now
                    - Duration::minutes(alert.trigger_condition.period)
                        .num_microseconds()
                        .unwrap();
                let end = now;
                let condition = self.promql_condition.as_ref().unwrap();
                let req = promql::MetricsQueryRequest {
                    query: format!(
                        "({}) {} {}",
                        v,
                        match &condition.operator {
                            &Operator::EqualTo => "==".to_string(),
                            _ => condition.operator.to_string(),
                        },
                        to_float(&condition.value)
                    ),
                    start,
                    end,
                    step: std::cmp::max(
                        promql::micros(promql::MINIMAL_INTERVAL),
                        (end - start) / promql::MAX_DATA_POINTS,
                    ),
                };
                let resp = match promql::search::search(&alert.org_id, &req, 0, "").await {
                    Ok(v) => v,
                    Err(_) => {
                        return Ok(None);
                    }
                };
                let promql::value::Value::Matrix(value) = resp else {
                    log::warn!(
                        "Alert evaluate: PromQL query {} returned unexpected response: {:?}",
                        v,
                        resp
                    );
                    return Ok(None);
                };
                // TODO calculate the sample in a row, suddenly a sample can be ignored
                let value = value
                    .into_iter()
                    .filter(|f| f.samples.len() >= alert.trigger_condition.threshold as usize)
                    .collect::<Vec<_>>();
                return if value.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(
                        value
                            .iter()
                            .map(|v| {
                                let mut val = Map::with_capacity(v.labels.len() + 2);
                                for label in v.labels.iter() {
                                    val.insert(
                                        label.name.to_string(),
                                        label.value.to_string().into(),
                                    );
                                }
                                let last_sample = v.samples.last().unwrap();
                                val.insert("_timestamp".to_string(), last_sample.timestamp.into());
                                val.insert("value".to_string(), last_sample.value.into());
                                val
                            })
                            .collect(),
                    ))
                };
            }
        };

        // fire the query
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
        let session_id = ider::uuid();
        let resp = match SearchService::search(&session_id, &alert.org_id, alert.stream_type, &req)
            .await
        {
            Ok(v) => v,
            Err(_) => {
                return Ok(None);
            }
        };
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
                let con_val = if self.value.is_number() {
                    self.value.as_f64().unwrap_or_default()
                } else {
                    self.value
                        .as_str()
                        .unwrap_or_default()
                        .parse()
                        .unwrap_or_default()
                };
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
                let con_val = if self.value.is_boolean() {
                    self.value.as_bool().unwrap_or_default()
                } else {
                    self.value
                        .as_str()
                        .unwrap_or_default()
                        .parse()
                        .unwrap_or_default()
                };
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
                ));
            }
        };
        let expr = build_expr(cond, "", data_type)?;
        wheres.push(expr);
    }
    let where_sql = if !wheres.is_empty() {
        format!("WHERE {}", wheres.join(" AND "))
    } else {
        String::new()
    };
    if alert.query_condition.aggregation.is_none() {
        return Ok(format!(
            "SELECT * FROM \"{}\" {}",
            alert.stream_name, where_sql
        ));
    }

    // handle aggregation
    let mut sql = String::new();
    let agg = alert.query_condition.aggregation.as_ref().unwrap();
    let having_expr = {
        let data_type = match schema.field_with_name(&agg.having.column) {
            Ok(field) => field.data_type(),
            Err(_) => {
                return Err(anyhow::anyhow!(
                    "Aggregation column {} not found on stream {}",
                    &agg.having.column,
                    &alert.stream_name
                ));
            }
        };
        build_expr(&agg.having, "alert_agg_value", data_type)?
    };

    let func_expr = match agg.function {
        AggFunction::Avg => format!("AVG(\"{}\")", agg.having.column),
        AggFunction::Max => format!("MAX(\"{}\")", agg.having.column),
        AggFunction::Min => format!("MIN(\"{}\")", agg.having.column),
        AggFunction::Sum => format!("SUM(\"{}\")", agg.having.column),
        AggFunction::Count => format!("COUNT(\"{}\")", agg.having.column),
        AggFunction::P50 => format!("approx_percentile_cont(\"{}\", 0.5)", agg.having.column),
        AggFunction::P75 => format!("approx_percentile_cont(\"{}\", 0.75)", agg.having.column),
        AggFunction::P90 => format!("approx_percentile_cont(\"{}\", 0.9)", agg.having.column),
        AggFunction::P95 => format!("approx_percentile_cont(\"{}\", 0.95)", agg.having.column),
        AggFunction::P99 => format!("approx_percentile_cont(\"{}\", 0.99)", agg.having.column),
    };

    if let Some(group) = agg.group_by.as_ref() {
        if !group.is_empty() {
            sql = format!(
                "SELECT {}, {} AS alert_agg_value, MIN({}) as zo_sql_min_time, MAX({}) AS zo_sql_max_time FROM \"{}\" {} GROUP BY {} HAVING {}",
                group.join(", "),
                func_expr,
                CONFIG.common.column_timestamp,
                CONFIG.common.column_timestamp,
                alert.stream_name,
                where_sql,
                group.join(", "),
                having_expr
            );
        }
    }
    if sql.is_empty() {
        sql = format!(
            "SELECT {} AS alert_agg_value, MIN({}) as zo_sql_min_time, MAX({}) AS zo_sql_max_time FROM \"{}\" {} HAVING {}",
            func_expr,
            CONFIG.common.column_timestamp,
            CONFIG.common.column_timestamp,
            alert.stream_name,
            where_sql,
            having_expr
        );
    }
    Ok(sql)
}

fn build_expr(
    cond: &Condition,
    field_alias: &str,
    field_type: &DataType,
) -> Result<String, anyhow::Error> {
    let field_alias = if !field_alias.is_empty() {
        field_alias
    } else {
        cond.column.as_str()
    };
    let expr = match field_type {
        DataType::Utf8 => {
            let val = if cond.value.is_string() {
                cond.value.as_str().unwrap_or_default().to_string()
            } else {
                cond.value.to_string()
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{}\" {} '{}'", field_alias, "=", val),
                Operator::NotEqualTo => format!("\"{}\" {} '{}'", field_alias, "!=", val),
                Operator::GreaterThan => format!("\"{}\" {} '{}'", field_alias, ">", val),
                Operator::GreaterThanEquals => {
                    format!("\"{}\" {} '{}'", field_alias, ">=", val)
                }
                Operator::LessThan => format!("\"{}\" {} '{}'", field_alias, "<", val),
                Operator::LessThanEquals => format!("\"{}\" {} '{}'", field_alias, "<=", val),
                Operator::Contains => format!("\"{}\" {} '%{}%'", field_alias, "LIKE", val),
                Operator::NotContains => {
                    format!("\"{}\" {} '%{}%'", field_alias, "NOT LIKE", val)
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
                            field_type,
                            cond.value,
                            e
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{}\" {} {}", field_alias, "=", val),
                Operator::NotEqualTo => format!("\"{}\" {} {}", field_alias, "!=", val),
                Operator::GreaterThan => format!("\"{}\" {} {}", field_alias, ">", val),
                Operator::GreaterThanEquals => {
                    format!("\"{}\" {} {}", field_alias, ">=", val)
                }
                Operator::LessThan => format!("\"{}\" {} {}", field_alias, "<", val),
                Operator::LessThanEquals => {
                    format!("\"{}\" {} {}", field_alias, "<=", val)
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{}] and it does not supported operator [{:?}]",
                        cond.column,
                        field_type,
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
                            field_type,
                            cond.value,
                            e
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{}\" {} {}", field_alias, "=", val),
                Operator::NotEqualTo => format!("\"{}\" {} {}", field_alias, "!=", val),
                Operator::GreaterThan => format!("\"{}\" {} {}", field_alias, ">", val),
                Operator::GreaterThanEquals => {
                    format!("\"{}\" {} {}", field_alias, ">=", val)
                }
                Operator::LessThan => format!("\"{}\" {} {}", field_alias, "<", val),
                Operator::LessThanEquals => {
                    format!("\"{}\" {} {}", field_alias, "<=", val)
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{}] and it does not supported operator [{:?}]",
                        cond.column,
                        field_type,
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
                            field_type,
                            cond.value,
                            e
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{}\" {} {}", field_alias, "=", val),
                Operator::NotEqualTo => format!("\"{}\" {} {}", field_alias, "!=", val),
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{}] and it does not supported operator [{:?}]",
                        cond.column,
                        field_type,
                        cond.operator
                    ));
                }
            }
        }
        _ => {
            return Err(anyhow::anyhow!(
                "Column {} has data_type [{}] and it does not supported by alert, if you think this is a bug please report it to us",
                cond.column,
                field_type
            ));
        }
    };
    Ok(expr)
}

pub async fn execute_script(
    alert: &Alert,
    script: &Script,
    rows: &[Map<String, Value>],
) -> Result<(), anyhow::Error> {
    let alert_type = get_alert_type(alert.is_real_time);
    let alert_count = rows.len();
    let mut alert_start_time = 0;
    let mut alert_end_time = 0;

    // Don't instantiate `boa_engine::Context` here, as `Context` is not `Send`,
    // it will not work across the `.await` calls. So, as a workaround, first
    // convert `rows` and `alert.context_attributes` into `serde_json::Value` arrays
    // and in the final step while registering `alert` global object into boa `Context`,
    // convert `serde_json::Value` into `boa_engine::JsValue`.
    let mut script_rows = vec![];

    for row in rows.iter() {
        script_rows.push({
            let mut alert_row_start_time = 0;
            let mut alert_row_end_time = 0;
            let mut script_row = Map::<String, Value>::new();
            for (key, value) in row.iter() {
                let value = if value.is_string() {
                    value.as_str().unwrap_or_default().to_string()
                } else if value.is_f64() {
                    format!("{:.2}", value.as_f64().unwrap_or_default())
                } else {
                    value.to_string()
                };

                // calculate start and end time for the row
                if key == &CONFIG.common.column_timestamp {
                    let val = value.parse::<i64>().unwrap_or_default();
                    if alert_row_start_time == 0 || val < alert_row_start_time {
                        alert_row_start_time = val;
                    }
                    if alert_row_end_time == 0 || val > alert_row_end_time {
                        alert_row_end_time = val;
                    }
                }
                if key == "zo_sql_min_time" {
                    let val = value.parse::<i64>().unwrap_or_default();
                    if alert_row_start_time == 0 || val < alert_row_start_time {
                        alert_row_start_time = val;
                    }
                }
                if key == "zo_sql_max_time" {
                    let val = value.parse::<i64>().unwrap_or_default();
                    if alert_row_end_time == 0 || val > alert_row_end_time {
                        alert_row_end_time = val;
                    }
                }

                script_row.insert(key.to_string(), value.into());
            }

            // calculate start and end time for the alert
            if alert_start_time == 0 || alert_row_start_time < alert_start_time {
                alert_start_time = alert_row_start_time;
            }

            if alert_end_time == 0 || alert_row_end_time > alert_end_time {
                alert_end_time = alert_row_end_time;
            }

            let alert_row_start_time = format_timestamp(alert_row_start_time);
            let alert_row_end_time = format_timestamp(alert_row_end_time);

            script_row.insert("alertStartTime".to_string(), alert_row_start_time.into());
            script_row.insert("alertEndTime".to_string(), alert_row_end_time.into());
            script_row
        });
    }

    let script_rows = json!(script_rows);
    let alert_url = get_alert_url(alert, alert_start_time, alert_end_time).await;
    let alert_start_time = format_timestamp(alert_start_time);
    let alert_end_time = format_timestamp(alert_end_time);

    let mut script_alert_context = Map::<String, Value>::new();
    if let Some(attrs) = &alert.context_attributes {
        for (key, value) in attrs.iter() {
            script_alert_context.insert(key.to_string(), value.to_string().into());
        }
    }
    let script_alert_context = json!(script_alert_context);

    // alert: {
    //     orgName: string,
    //     streamType: string,
    //     streamName: string,
    //     alertName: string,
    //     alertType: string,
    //     alertPeriod: number,
    //     alertOperator: string,
    //     alertThreshold: number,
    //     alertCount: number,
    //     alertStartTime: string,
    //     alertEndTime: string,
    //     alertUrl: string,
    //     rows: Array<{
    //         alertStartTime: string,
    //         alertEndTime: string,
    //         [key: string]: string,
    //     }>,
    //     context: {
    //         [key: string]: string,
    //     }
    // }
    //
    // In the Alert JS script, `alert` can be directly accessed as a global object.
    let script_alert_obj = json!({
        "orgName": &alert.org_id,
        "streamType": &alert.stream_type,
        "streamName": &alert.stream_name,
        "alertName": &alert.name,
        "alertType": alert_type,
        "alertPeriod": alert.trigger_condition.period,
        "alertOperator": alert.trigger_condition.operator.to_string(),
        "alertThreshold": alert.trigger_condition.threshold,
        "alertCount": alert_count,
        "alertStartTime": alert_start_time,
        "alertEndTime": alert_end_time,
        "alertUrl": alert_url,
        "rows": script_rows,
        "context": script_alert_context
    });

    let mut context = Context::default();
    let script_alert_obj = match JsValue::from_json(&script_alert_obj, &mut context) {
        Ok(js_obj) => js_obj,
        Err(e) => return Err(anyhow::anyhow!("Script execution error: {}", e.to_string())),
    };
    if let Err(e) = context.register_global_property(
        "alert",
        script_alert_obj,
        Attribute::ENUMERABLE | Attribute::READONLY,
    ) {
        return Err(anyhow::anyhow!("Script execution error: {}", e.to_string()));
    }
    if let Err(e) = context.register_global_builtin_callable(
        "fetch",
        1,
        NativeFunction::from_async_fn(js_vm::fetch),
    ) {
        return Err(anyhow::anyhow!("Script execution error: {}", e.to_string()));
    }
    if let Err(e) = context.register_global_builtin_callable(
        "toJson",
        1,
        NativeFunction::from_fn_ptr(js_vm::to_json),
    ) {
        return Err(anyhow::anyhow!("Script execution error: {}", e.to_string()));
    }
    match context.eval(Source::from_bytes(script.script.as_str())) {
        Ok(_) => {
            context.run_jobs();
            drop(context);
        }
        Err(e) => return Err(anyhow::anyhow!("Script execution error: {}", e.to_string())),
    };

    Ok(())
}

pub async fn send_notification(
    alert: &Alert,
    dest: &DestinationWithTemplate,
    rows: &[Map<String, Value>],
) -> Result<(), anyhow::Error> {
    let rows_tpl_val = if alert.row_template.is_empty() {
        vec!["".to_string()]
    } else {
        process_row_template(&alert.row_template, alert, rows)
    };
    let msg = process_dest_template(&dest.template.body, alert, rows, &rows_tpl_val).await;
    let client = if dest.skip_tls_verify {
        reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()?
    } else {
        reqwest::Client::new()
    };
    let url = url::Url::parse(&dest.url)?;
    let mut req = match dest.method {
        HTTPType::POST => client.post(url),
        HTTPType::PUT => client.put(url),
        HTTPType::GET => client.get(url),
    };

    // Add additional headers if any from destination description
    let mut has_context_type = false;
    if let Some(headers) = &dest.headers {
        for (key, value) in headers.iter() {
            if !key.is_empty() && !value.is_empty() {
                if key.to_lowercase().trim() == "content-type" {
                    has_context_type = true;
                }
                req = req.header(key, value);
            }
        }
    };
    // set default content type
    if !has_context_type {
        req = req.header("Content-type", "application/json");
    }

    let resp = req.body(msg.clone()).send().await?;
    if !resp.status().is_success() {
        log::error!("Alert body: {}", msg);
        return Err(anyhow::anyhow!("sent error: {:?}", resp.bytes().await));
    }

    Ok(())
}

fn process_row_template(tpl: &String, alert: &Alert, rows: &[Map<String, Value>]) -> Vec<String> {
    let alert_type = get_alert_type(alert.is_real_time);
    let alert_count = rows.len();
    let mut rows_tpl = Vec::with_capacity(rows.len());
    for row in rows.iter() {
        let mut resp = tpl.to_string();
        let mut alert_start_time = 0;
        let mut alert_end_time = 0;
        for (key, value) in row.iter() {
            let value = if value.is_string() {
                value.as_str().unwrap_or_default().to_string()
            } else if value.is_f64() {
                format!("{:.2}", value.as_f64().unwrap_or_default())
            } else {
                value.to_string()
            };
            process_variable_replace(&mut resp, key, &VarValue::Str(&value));

            // calculate start and end time
            if key == &CONFIG.common.column_timestamp {
                let val = value.parse::<i64>().unwrap_or_default();
                if alert_start_time == 0 || val < alert_start_time {
                    alert_start_time = val;
                }
                if alert_end_time == 0 || val > alert_end_time {
                    alert_end_time = val;
                }
            }
            if key == "zo_sql_min_time" {
                let val = value.parse::<i64>().unwrap_or_default();
                if alert_start_time == 0 || val < alert_start_time {
                    alert_start_time = val;
                }
            }
            if key == "zo_sql_max_time" {
                let val = value.parse::<i64>().unwrap_or_default();
                if alert_end_time == 0 || val > alert_end_time {
                    alert_end_time = val;
                }
            }
        }
        let alert_start_time_str = format_timestamp(alert_start_time);
        let alert_end_time_str = format_timestamp(alert_end_time);

        resp = resp
            .replace("{org_name}", &alert.org_id)
            .replace("{stream_type}", &alert.stream_type.to_string())
            .replace("{stream_name}", &alert.stream_name)
            .replace("{alert_name}", &alert.name)
            .replace("{alert_type}", alert_type)
            .replace(
                "{alert_period}",
                &alert.trigger_condition.period.to_string(),
            )
            .replace(
                "{alert_operator}",
                &alert.trigger_condition.operator.to_string(),
            )
            .replace(
                "{alert_threshold}",
                &alert.trigger_condition.threshold.to_string(),
            )
            .replace("{alert_count}", &alert_count.to_string())
            .replace("{alert_start_time}", &alert_start_time_str)
            .replace("{alert_end_time}", &alert_end_time_str);

        if let Some(attrs) = &alert.context_attributes {
            for (key, value) in attrs.iter() {
                process_variable_replace(&mut resp, key, &VarValue::Str(value));
            }
        }

        rows_tpl.push(resp);
    }

    rows_tpl
}

async fn process_dest_template(
    tpl: &str,
    alert: &Alert,
    rows: &[Map<String, Value>],
    rows_tpl_val: &[String],
) -> String {
    // format values
    let alert_count = rows.len();
    let mut vars = HashMap::with_capacity(rows.len());
    for row in rows.iter() {
        for (key, value) in row.iter() {
            let value = if value.is_string() {
                value.as_str().unwrap_or_default().to_string()
            } else if value.is_f64() {
                format!("{:.2}", value.as_f64().unwrap_or_default())
            } else {
                value.to_string()
            };
            let entry = vars.entry(key.to_string()).or_insert_with(HashSet::new);
            entry.insert(value);
        }
    }

    // calculate start and end time
    let mut alert_start_time = 0;
    let mut alert_end_time = 0;
    if let Some(values) = vars.get(&CONFIG.common.column_timestamp) {
        for val in values {
            let val = val.parse::<i64>().unwrap_or_default();
            if alert_start_time == 0 || val < alert_start_time {
                alert_start_time = val;
            }
            if alert_end_time == 0 || val > alert_end_time {
                alert_end_time = val;
            }
        }
    }
    if let Some(values) = vars.get("zo_sql_min_time") {
        for val in values {
            let val = val.parse::<i64>().unwrap_or_default();
            if alert_start_time == 0 || val < alert_start_time {
                alert_start_time = val;
            }
        }
    }
    if let Some(values) = vars.get("zo_sql_max_time") {
        for val in values {
            let val = val.parse::<i64>().unwrap_or_default();
            if alert_end_time == 0 || val > alert_end_time {
                alert_end_time = val;
            }
        }
    }
    let alert_start_time_str = format_timestamp(alert_start_time);
    let alert_end_time_str = format_timestamp(alert_end_time);

    let alert_type = get_alert_type(alert.is_real_time);

    let alert_url = get_alert_url(alert, alert_start_time, alert_end_time).await;

    let mut resp = tpl
        .replace("{org_name}", &alert.org_id)
        .replace("{stream_type}", &alert.stream_type.to_string())
        .replace("{stream_name}", &alert.stream_name)
        .replace("{alert_name}", &alert.name)
        .replace("{alert_type}", alert_type)
        .replace(
            "{alert_period}",
            &alert.trigger_condition.period.to_string(),
        )
        .replace(
            "{alert_operator}",
            &alert.trigger_condition.operator.to_string(),
        )
        .replace(
            "{alert_threshold}",
            &alert.trigger_condition.threshold.to_string(),
        )
        .replace("{alert_count}", &alert_count.to_string())
        .replace("{alert_start_time}", &alert_start_time_str)
        .replace("{alert_end_time}", &alert_end_time_str)
        .replace("{alert_url}", &alert_url);
    process_variable_replace(&mut resp, "rows", &VarValue::Vector(rows_tpl_val));
    for (key, value) in vars.iter() {
        if resp.contains(&format!("{{{key}}}")) {
            let val = value.iter().cloned().collect::<Vec<_>>();
            process_variable_replace(&mut resp, key, &VarValue::Str(&val.join(", ")));
        }
    }
    if let Some(attrs) = &alert.context_attributes {
        for (key, value) in attrs.iter() {
            process_variable_replace(&mut resp, key, &VarValue::Str(value));
        }
    }

    resp
}

async fn get_alert_url(
    alert: &Alert,
    mut alert_start_time: i64,
    mut alert_end_time: i64,
) -> String {
    // Hack time range for alert url
    alert_end_time = if alert_end_time == 0 {
        Utc::now().timestamp_micros()
    } else {
        // the frontend will drop the second, so we add 1 minute to the end time
        alert_end_time + Duration::minutes(1).num_microseconds().unwrap()
    };
    if alert_start_time == 0 {
        alert_start_time = alert_end_time
            - Duration::minutes(alert.trigger_condition.period)
                .num_microseconds()
                .unwrap();
    }
    if alert_end_time - alert_start_time < Duration::minutes(1).num_microseconds().unwrap() {
        alert_start_time = alert_end_time
            - Duration::minutes(alert.trigger_condition.period)
                .num_microseconds()
                .unwrap();
    }

    let mut alert_query = String::new();
    if alert.query_condition.query_type == QueryType::PromQL {
        if let Some(promql) = &alert.query_condition.promql {
            let condition = alert.query_condition.promql_condition.as_ref().unwrap();
            alert_query = format!(
                "({}) {} {}",
                promql,
                match condition.operator {
                    Operator::EqualTo => "==".to_string(),
                    _ => condition.operator.to_string(),
                },
                to_float(&condition.value)
            );
        }
        // http://localhost:5080/web/metrics?stream=zo_http_response_time_bucket&from=1705248000000000&to=1705334340000000&query=em9faHR0cF9yZXNwb25zZV90aW1lX2J1Y2tldHt9&org_identifier=default
        format!(
            "{}{}/web/metrics?stream_type={}&stream={}&from={}&to={}&query={}&org_identifier={}",
            CONFIG.common.web_url,
            CONFIG.common.base_uri,
            alert.stream_type,
            alert.stream_name,
            alert_start_time,
            alert_end_time,
            base64::encode(&alert_query).replace('+', "%2B"),
            alert.org_id,
        )
    } else {
        if let Some(conditions) = &alert.query_condition.conditions {
            if let Ok(v) = build_sql(alert, conditions).await {
                alert_query = v;
            }
        }
        // http://localhost:5080/web/logs?stream_type=logs&stream=default&from=1705248000000000&to=1705334340000000&sql_mode=true&query=U0VMRUNUICogRlJPTSAiZGVmYXVsdCIg&org_identifier=default
        format!(
            "{}{}/web/logs?stream_type={}&stream={}&from={}&to={}&sql_mode=true&query={}&org_identifier={}",
            CONFIG.common.web_url,
            CONFIG.common.base_uri,
            alert.stream_type,
            alert.stream_name,
            alert_start_time,
            alert_end_time,
            base64::encode(&alert_query).replace('+', "%2B"),
            alert.org_id,
        )
    }
}

fn get_alert_type(is_real_time: bool) -> &'static str {
    if is_real_time {
        "realtime"
    } else {
        "scheduled"
    }
}

fn format_timestamp(alert_time: i64) -> String {
    if alert_time > 0 {
        Local
            .timestamp_nanos(alert_time * 1000)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string()
    } else {
        String::from("N/A")
    }
}

fn process_variable_replace(tpl: &mut String, var_name: &str, var_val: &VarValue) {
    let pattern = "{".to_owned() + var_name + "}";
    if tpl.contains(&pattern) {
        *tpl = tpl.replace(&pattern, &var_val.to_string_with_length(0));
        return;
    }
    let pattern = "{".to_owned() + var_name + ":";
    if let Some(start) = tpl.find(&pattern) {
        // find } start from position v
        let p = start + pattern.len();
        if let Some(end) = tpl[p..].find('}') {
            let len = tpl[p..p + end].parse::<usize>().unwrap_or_default();
            if len > 0 {
                *tpl = tpl.replace(
                    &tpl[start..p + end + 1],
                    &var_val.to_string_with_length(len),
                );
            }
        }
    }
}

fn format_variable_value(val: String) -> String {
    val.replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\"', "\\\"")
}

fn to_float(val: &Value) -> f64 {
    if val.is_number() {
        val.as_f64().unwrap_or_default()
    } else {
        val.as_str().unwrap_or_default().parse().unwrap_or_default()
    }
}

enum VarValue<'a> {
    Str(&'a str),
    Vector(&'a [String]),
}

impl<'a> VarValue<'a> {
    fn len(&self) -> usize {
        match self {
            VarValue::Str(v) => v.chars().count(),
            VarValue::Vector(v) => v.len(),
        }
    }

    fn to_string_with_length(&self, n: usize) -> String {
        let n = if n > 0 && n < self.len() {
            n
        } else {
            self.len()
        };
        match self {
            VarValue::Str(v) => format_variable_value(v.chars().take(n).collect()),
            VarValue::Vector(v) => v[0..n].join("\\n"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_alert_save() {
        let org_id = "default";
        let stream_type = StreamType::Logs;
        let stream_name = "default";
        let alert_name = "abc/alert";
        let alert = Alert {
            name: alert_name.to_string(),
            ..Default::default()
        };
        let ret = save(org_id, stream_type, stream_name, alert_name, alert).await;
        // alert name should not contain /
        assert!(ret.is_err());
    }
}
