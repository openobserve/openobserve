// Copyright 2023 Zinc Labs Inc.
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

use std::error::Error as StdError;

use crate::common::meta::alerts::{self, Alert};
use crate::common::utils::json::{self, Value};
use crate::service::db;

pub async fn send_notification(
    alert: &Alert,
    trigger: &alerts::Trigger,
) -> Result<(), Box<dyn StdError>> {
    let alert_type = match &trigger.is_ingest_time {
        true => "Real time",
        false => "Scheduled",
    };
    let curr_ts = chrono::Utc::now().timestamp_micros();
    let local_dest = match db::alerts::destinations::get(&trigger.org, &alert.destinations[0]).await
    {
        Ok(v) => v,
        Err(_) => {
            log::error!("Destination Not found: {}", &alert.destinations[0]);
            return Ok(());
        }
    };

    let body = local_dest.template.unwrap().body;
    let resp_str = json::to_string(&body).unwrap();

    let mut resp = resp_str
        .replace("{stream_name}", &trigger.stream)
        .replace("{org_name}", &trigger.org)
        .replace("{alert_name}", &trigger.alert_name)
        .replace("{alert_type}", alert_type)
        .replace("{timestamp}", &curr_ts.to_string());

    // Replace contextual information with values if any from alert
    if alert.context_attributes.is_some() {
        for (key, value) in alert.context_attributes.as_ref().unwrap() {
            resp = resp.replace(&format!("{{{key}}}"), value)
        }
    }

    let msg: Value = json::from_str(&resp).unwrap();
    let msg: Value = match &msg {
        Value::String(obj) => match json::from_str(obj) {
            Ok(obj) => obj,
            Err(_) => msg,
        },
        _ => msg,
    };
    let client = if local_dest.skip_tls_verify {
        reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()?
    } else {
        reqwest::Client::new()
    };
    match url::Url::parse(&local_dest.url) {
        Ok(url) => {
            let mut req = match local_dest.method {
                alerts::AlertHTTPType::POST => client.post(url),
                alerts::AlertHTTPType::PUT => client.put(url),
                alerts::AlertHTTPType::GET => client.get(url),
            }
            .header("Content-type", "application/json");

            // Add additional headers if any from destination description
            if local_dest.headers.is_some() {
                for (key, value) in local_dest.headers.unwrap() {
                    if !key.is_empty() && !value.is_empty() {
                        req = req.header(key, value);
                    }
                }
            };

            let resp = req.json(&msg).send().await;
            match resp {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        log::error!("Notification sent error: {:?}", resp.bytes().await);
                    }
                }
                Err(err) => log::error!("Notification sending error {:?}", err),
            }
        }
        Err(err) => {
            log::error!("Notification sending error {:?}", err);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::meta::alerts::{AlertDestination, Condition, DestinationTemplate, Trigger};
    use crate::common::meta::StreamType;

    #[actix_web::test]
    async fn test_send_notification() {
        let template = DestinationTemplate {
            name: Some("testTemplate".to_string()),
            body: "Test Body".into(),
            is_default: Some(false),
        };
        let _ = db::alerts::templates::set("default", "testTemplate", template).await;

        let destination = AlertDestination {
            url: "http://dummy/alert".to_string(),
            method: alerts::AlertHTTPType::POST,
            skip_tls_verify: false,
            headers: None,
            template: "testTemplate".to_string(),
            name: Some("test".to_string()),
        };
        let _ = db::alerts::destinations::set("default", "testDest", destination).await;

        let obj: Trigger = Trigger {
            timestamp: chrono::Utc::now().timestamp_micros(),
            is_valid: true,
            alert_name: "Test Alert".to_string(),
            stream: "olympics".to_string(),
            stream_type: StreamType::Logs,
            org: "default".to_string(),
            last_sent_at: chrono::Utc::now().timestamp_micros(),
            count: 1,
            is_ingest_time: true,
            parent_alert_deleted: false,
        };
        let alert = Alert {
            name: "testAlert".to_string(),
            stream: "olympics".to_string(),
            stream_type: StreamType::Logs,
            query_condition: alerts::QueryCondition {
                conditions: Some(vec![Condition {
                    column: "Country".to_string(),
                    operator: alerts::AllOperator::EqualTo,
                    ignore_case: Some(false),
                    value: json::Value::String("USA".to_string()),
                    is_numeric: Some(false),
                }]),
                sql: None,
                promql: None,
            },
            duration: 5,
            frequency: 1,
            threshold: 1,
            silence: 10,
            destinations: vec!["testDest".to_string()],
            is_real_time: true,
            context_attributes: None,
            enabled: true,
        };

        send_notification(&alert, &obj).await.unwrap();
    }
}
