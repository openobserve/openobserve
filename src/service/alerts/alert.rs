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
    str::FromStr,
};

use actix_web::http;
use chrono::{Duration, Local, TimeZone, Timelike, Utc};
use config::{
    get_config,
    meta::stream::StreamType,
    utils::{
        base64,
        json::{Map, Value},
    },
    SMTP_CLIENT,
};
use cron::Schedule;
use lettre::{message::SinglePart, AsyncTransport, Message};

use crate::{
    common::{
        meta::{
            alerts::{
                alert::Alert,
                destinations::{DestinationType, DestinationWithTemplate, HTTPType},
                FrequencyType, Operator, QueryType,
            },
            authz::Authz,
            stream::StreamParams,
        },
        utils::auth::{is_ofga_unsupported, remove_ownership, set_ownership},
    },
    service::{
        alerts::{build_sql, destinations},
        db,
        search::sql::RE_ONLY_SELECT,
    },
};

pub async fn save(
    org_id: &str,
    stream_name: &str,
    name: &str,
    mut alert: Alert,
    create: bool,
) -> Result<(), anyhow::Error> {
    if !name.is_empty() {
        alert.name = name.to_string();
    }
    alert.name = alert.name.trim().to_string();

    // Don't allow the characters not supported by ofga
    if is_ofga_unsupported(&alert.name) {
        return Err(anyhow::anyhow!(
            "Alert name cannot contain ':', '#', '?', '&', '%', quotes and space characters"
        ));
    }
    alert.org_id = org_id.to_string();
    let stream_type = alert.stream_type;
    alert.stream_name = stream_name.to_string();
    alert.row_template = alert.row_template.trim().to_string();

    match db::alerts::alert::get(org_id, stream_type, stream_name, &alert.name).await {
        Ok(Some(old_alert)) => {
            if create {
                return Err(anyhow::anyhow!("Alert already exists"));
            }
            alert.last_triggered_at = old_alert.last_triggered_at;
            alert.owner = old_alert.owner;
        }
        Ok(None) => {
            if !create {
                return Err(anyhow::anyhow!("Alert not found"));
            }
        }
        Err(e) => {
            return Err(e);
        }
    }

    if alert.trigger_condition.frequency_type == FrequencyType::Cron {
        let cron_exp = alert.trigger_condition.cron.clone();
        if cron_exp.starts_with("* ") {
            let (_, rest) = cron_exp.split_once(" ").unwrap();
            let now = Utc::now().second().to_string();
            alert.trigger_condition.cron = format!("{now} {rest}");
            log::debug!(
                "New cron expression for alert {}: {}",
                alert.name,
                alert.trigger_condition.cron
            );
        }
        // Check the cron expression
        Schedule::from_str(&alert.trigger_condition.cron)?;
    } else if alert.trigger_condition.frequency == 0 {
        // default frequency is 60 seconds
        alert.trigger_condition.frequency =
            std::cmp::max(10, get_config().limit.alert_schedule_interval);
    }

    if alert.name.is_empty() || alert.stream_name.is_empty() {
        return Err(anyhow::anyhow!("Alert name is required"));
    }
    if alert.name.contains('/') {
        return Err(anyhow::anyhow!("Alert name cannot contain '/'"));
    }

    if let Some(vrl) = alert.query_condition.vrl_function.as_ref() {
        match base64::decode_url(vrl) {
            Ok(vrl) => {
                let vrl = vrl.trim().to_owned();
                if !vrl.is_empty() && !vrl.ends_with('.') {
                    let vrl = base64::encode_url(&format!("{vrl} \n ."));
                    alert.query_condition.vrl_function = Some(vrl);
                } else if vrl.is_empty() {
                    alert.query_condition.vrl_function = None;
                }
            }
            Err(e) => {
                return Err(anyhow::anyhow!(
                    "Error decoding vrl function for alert: {e}"
                ));
            }
        }
    }

    // before saving alert check alert destination
    if alert.destinations.is_empty() {
        return Err(anyhow::anyhow!("Alert destinations is required"));
    }
    for dest in alert.destinations.iter() {
        if db::alerts::destinations::get(org_id, dest).await.is_err() {
            return Err(anyhow::anyhow!("Alert destination {dest} not found"));
        };
    }

    // before saving alert check alert context attributes
    if alert.context_attributes.is_some() {
        let attrs = alert.context_attributes.as_ref().unwrap();
        let mut new_attrs = hashbrown::HashMap::with_capacity(attrs.len());
        for key in attrs.keys() {
            let new_key = key.trim().to_string();
            if !new_key.is_empty() {
                new_attrs.insert(new_key, attrs.get(key).unwrap().to_string());
            }
        }
        alert.context_attributes = Some(new_attrs);
    }

    // before saving alert check column type to decide numeric condition
    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
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
            if alert.query_condition.sql.is_some()
                && RE_ONLY_SELECT.is_match(alert.query_condition.sql.as_ref().unwrap())
            {
                return Err(anyhow::anyhow!(
                    "Alert with SQL can not contain SELECT * in the SQL query"
                ));
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
    if let Err(e) = &alert.evaluate(None).await {
        return Err(anyhow::anyhow!("Alert test failed: {}", e));
    }

    // save the alert
    match db::alerts::alert::set(org_id, stream_type, stream_name, &alert, create).await {
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
    db::alerts::alert::get(org_id, stream_type, stream_name, name).await
}

pub async fn list(
    org_id: &str,
    stream_type: Option<StreamType>,
    stream_name: Option<&str>,
    permitted: Option<Vec<String>>,
) -> Result<Vec<Alert>, anyhow::Error> {
    match db::alerts::alert::list(org_id, stream_type, stream_name).await {
        Ok(alerts) => {
            let mut result = Vec::new();
            for alert in alerts {
                if permitted.is_none()
                    || permitted
                        .as_ref()
                        .unwrap()
                        .contains(&format!("alert:{}", alert.name))
                    || permitted
                        .as_ref()
                        .unwrap()
                        .contains(&format!("alert:_all_{}", org_id))
                {
                    result.push(alert);
                }
            }
            Ok(result)
        }
        Err(e) => Err(e),
    }
}

pub async fn delete(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<(), (http::StatusCode, anyhow::Error)> {
    if db::alerts::alert::get(org_id, stream_type, stream_name, name)
        .await
        .is_err()
    {
        return Err((
            http::StatusCode::NOT_FOUND,
            anyhow::anyhow!("Alert not found"),
        ));
    }
    match db::alerts::alert::delete(org_id, stream_type, stream_name, name).await {
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
    let mut alert = match db::alerts::alert::get(org_id, stream_type, stream_name, name).await {
        Ok(Some(alert)) => alert,
        _ => {
            return Err((
                http::StatusCode::NOT_FOUND,
                anyhow::anyhow!("Alert not found"),
            ));
        }
    };
    alert.enabled = value;
    db::alerts::alert::set(org_id, stream_type, stream_name, &alert, false)
        .await
        .map_err(|e| (http::StatusCode::INTERNAL_SERVER_ERROR, e))
}

pub async fn trigger(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    name: &str,
) -> Result<(bool, String), (http::StatusCode, anyhow::Error)> {
    let alert = match db::alerts::alert::get(org_id, stream_type, stream_name, name).await {
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
    /// Returns the evaluated row data and the end time of the search timerange,
    /// for realtime this is 0
    pub async fn evaluate(
        &self,
        row: Option<&Map<String, Value>>,
    ) -> Result<(Option<Vec<Map<String, Value>>>, i64), anyhow::Error> {
        if self.is_real_time {
            self.query_condition.evaluate_realtime(row).await
        } else {
            self.query_condition
                .evaluate_scheduled(
                    &self.get_stream_params(),
                    &self.trigger_condition,
                    &self.query_condition,
                    None,
                )
                .await
        }
    }

    /// Returns a tuple containing a boolean - if all the send notification jobs succeeded
    /// and the error message if any
    pub async fn send_notification(
        &self,
        rows: &[Map<String, Value>],
    ) -> Result<(bool, String), anyhow::Error> {
        let mut message = "".to_string();
        let mut no_of_error = 0;
        for dest in self.destinations.iter() {
            let dest = destinations::get_with_template(&self.org_id, dest).await?;
            if let Err(e) = send_notification(self, &dest, rows).await {
                log::error!(
                    "Error sending notification for {}/{}/{}/{} for destination {} err: {}",
                    self.org_id,
                    self.stream_type,
                    self.stream_name,
                    self.name,
                    dest.name,
                    e
                );
                no_of_error += 1;
                message = format!(
                    "{message} Error sending notification for destination {} err: {e};",
                    dest.name
                );
            }
        }
        if no_of_error == self.destinations.len() {
            Err(anyhow::anyhow!(message))
        } else if no_of_error != 0 {
            // Some send notification job failed
            Ok((false, message))
        } else {
            Ok((true, "".to_owned()))
        }
    }

    pub fn get_stream_params(&self) -> StreamParams {
        StreamParams {
            org_id: self.org_id.clone().into(),
            stream_name: self.stream_name.clone().into(),
            stream_type: self.stream_type,
        }
    }
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
    let msg: String = process_dest_template(&dest.template.body, alert, rows, &rows_tpl_val).await;

    match dest.destination_type {
        DestinationType::Http => send_http_notification(dest, msg.clone()).await,
        DestinationType::Email => send_email_notification(&alert.name, dest, msg).await,
    }
}

pub async fn send_http_notification(
    dest: &DestinationWithTemplate,
    msg: String,
) -> Result<(), anyhow::Error> {
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
        return Err(anyhow::anyhow!(
            "sent error status: {}, err: {:?}",
            resp.status(),
            resp.bytes().await
        ));
    }

    Ok(())
}

pub async fn send_email_notification(
    alert_name: &str,
    dest: &DestinationWithTemplate,
    msg: String,
) -> Result<(), anyhow::Error> {
    let cfg = get_config();
    if !cfg.smtp.smtp_enabled {
        return Err(anyhow::anyhow!("SMTP configuration not enabled"));
    }

    let mut recepients = vec![];
    for recepient in &dest.emails {
        recepients.push(recepient);
    }

    let mut email = Message::builder()
        .from(cfg.smtp.smtp_from_email.parse()?)
        .subject(format!("Openobserve Alert - {}", alert_name));

    for recepient in recepients {
        email = email.to(recepient.parse()?);
    }

    if !cfg.smtp.smtp_reply_to.is_empty() {
        email = email.reply_to(cfg.smtp.smtp_reply_to.parse()?);
    }

    let email = email.singlepart(SinglePart::html(msg)).unwrap();

    // Send the email
    match SMTP_CLIENT.as_ref().unwrap().send(email).await {
        Ok(_) => Ok(()),
        Err(e) => Err(anyhow::anyhow!("Error sending email: {e}")),
    }
}

fn process_row_template(tpl: &String, alert: &Alert, rows: &[Map<String, Value>]) -> Vec<String> {
    let alert_type = if alert.is_real_time {
        "realtime"
    } else {
        "scheduled"
    };
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
            if key == &get_config().common.column_timestamp {
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
        let alert_start_time_str = if alert_start_time > 0 {
            Local
                .timestamp_nanos(alert_start_time * 1000)
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string()
        } else {
            String::from("N/A")
        };
        let alert_end_time_str = if alert_end_time > 0 {
            Local
                .timestamp_nanos(alert_end_time * 1000)
                .format("%Y-%m-%dT%H:%M:%S")
                .to_string()
        } else {
            String::from("N/A")
        };

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

        if let Some(contidion) = &alert.query_condition.promql_condition {
            resp = resp
                .replace("{alert_promql_operator}", &contidion.operator.to_string())
                .replace("{alert_promql_value}", &contidion.value.to_string());
        }

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
    let cfg = get_config();
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
    let (alert_start_time, alert_end_time) =
        get_alert_start_end_time(&vars, alert.trigger_condition.period);

    let alert_start_time_str = if alert_start_time > 0 {
        Local
            .timestamp_nanos(alert_start_time * 1000)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string()
    } else {
        String::from("N/A")
    };
    let alert_end_time_str = if alert_end_time > 0 {
        Local
            .timestamp_nanos(alert_end_time * 1000)
            .format("%Y-%m-%dT%H:%M:%S")
            .to_string()
    } else {
        String::from("N/A")
    };

    let alert_type = if alert.is_real_time {
        "realtime"
    } else {
        "scheduled"
    };

    let mut alert_query = String::new();
    let function_content = if alert.query_condition.vrl_function.is_none() {
        "".to_owned()
    } else {
        format!(
            "&functionContent={}",
            alert
                .query_condition
                .vrl_function
                .as_ref()
                .unwrap()
                .replace('+', "%2B")
        )
    };
    let alert_url = if alert.query_condition.query_type == QueryType::PromQL {
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
            "{}{}/web/metrics?stream_type={}&stream={}&stream_value={}&from={}&to={}&query={}&org_identifier={}{}",
            cfg.common.web_url,
            cfg.common.base_uri,
            alert.stream_type,
            alert.stream_name,
            alert.stream_name,
            alert_start_time,
            alert_end_time,
            base64::encode_url(&alert_query).replace('+', "%2B"),
            alert.org_id,
            function_content,
        )
    } else {
        match alert.query_condition.query_type {
            QueryType::SQL => {
                if let Some(sql) = &alert.query_condition.sql {
                    alert_query = sql.clone();
                }
            }
            QueryType::Custom => {
                if let Some(conditions) = &alert.query_condition.conditions {
                    if let Ok(v) = build_sql(
                        &alert.get_stream_params(),
                        &alert.query_condition,
                        conditions,
                    )
                    .await
                    {
                        alert_query = v;
                    }
                }
            }
            _ => unreachable!(),
        };
        // http://localhost:5080/web/logs?stream_type=logs&stream=test&from=1708416534519324&to=1708416597898186&sql_mode=true&query=U0VMRUNUICogRlJPTSAidGVzdCIgd2hlcmUgbGV2ZWwgPSAnaW5mbyc=&org_identifier=default
        format!(
            "{}{}/web/logs?stream_type={}&stream={}&stream_value={}&from={}&to={}&sql_mode=true&query={}&org_identifier={}{}",
            cfg.common.web_url,
            cfg.common.base_uri,
            alert.stream_type,
            alert.stream_name,
            alert.stream_name,
            alert_start_time,
            alert_end_time,
            base64::encode_url(&alert_query),
            alert.org_id,
            function_content,
        )
    };

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

    if let Some(contidion) = &alert.query_condition.promql_condition {
        resp = resp
            .replace("{alert_promql_operator}", &contidion.operator.to_string())
            .replace("{alert_promql_value}", &contidion.value.to_string());
    }

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

pub fn get_row_column_map(rows: &[Map<String, Value>]) -> HashMap<String, HashSet<String>> {
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
    vars
}

pub fn get_alert_start_end_time(
    vars: &HashMap<String, HashSet<String>>,
    period: i64,
) -> (i64, i64) {
    let cfg = get_config();

    // calculate start and end time
    let mut alert_start_time = 0;
    let mut alert_end_time = 0;
    if let Some(values) = vars.get(&cfg.common.column_timestamp) {
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

    // Hack time range for alert url
    alert_end_time = if alert_end_time == 0 {
        Utc::now().timestamp_micros()
    } else {
        // the frontend will drop the second, so we add 1 minute to the end time
        alert_end_time
            + Duration::try_minutes(1)
                .unwrap()
                .num_microseconds()
                .unwrap()
    };
    if alert_start_time == 0 {
        alert_start_time = alert_end_time
            - Duration::try_minutes(period)
                .unwrap()
                .num_microseconds()
                .unwrap();
    }
    if alert_end_time - alert_start_time
        < Duration::try_minutes(1)
            .unwrap()
            .num_microseconds()
            .unwrap()
    {
        alert_start_time = alert_end_time
            - Duration::try_minutes(period)
                .unwrap()
                .num_microseconds()
                .unwrap();
    }
    (alert_start_time, alert_end_time)
}

fn format_variable_value(val: String) -> String {
    val.replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('\"', "\\\"")
}

pub(super) fn to_float(val: &Value) -> f64 {
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
    async fn test_alert_create() {
        let org_id = "default";
        let stream_name = "default";
        let alert_name = "abc/alert";
        let alert = Alert {
            name: alert_name.to_string(),
            ..Default::default()
        };
        let ret = save(org_id, stream_name, alert_name, alert, true).await;
        // alert name should not contain /
        assert!(ret.is_err());
    }
}
