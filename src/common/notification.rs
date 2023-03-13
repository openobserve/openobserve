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

use serde_json::Value;
use std::error::Error as StdError;

use crate::{
    meta::alert::{self, Alert},
    service::db,
};

pub async fn send_notification(
    alert: &Alert,
    trigger: &alert::Trigger,
) -> Result<(), Box<dyn StdError>> {
    let client = reqwest::Client::new();

    let alert_type = match &trigger.is_ingest_time {
        true => "Real time",
        false => "Scheduled",
    };

    let curr_ts = chrono::Utc::now().timestamp_micros();
    match db::alerts::destinations::get(&trigger.org, &alert.destination).await {
        Ok(dest) => match dest {
            Some(local_dest) => {
                let body = local_dest.template.unwrap().body;
                let resp_str = serde_json::to_string(&body).unwrap();

        /* match dest.dest_type {
            alert::AlertDestType::Slack => match url::Url::parse(&dest.url) {
                Ok(dest_url) => {
                    //Invoke Webhook

                // Replace contextual information with values if any from alert
                if alert.context_attributes.is_some() {
                    for (key, value) in alert.context_attributes.as_ref().unwrap() {
                        resp = resp.replace(&format!("{{{}}}", key), value)
                    }
                }
                Err(_) => log::info!("Error parsing notification url"),
            },
        } */
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::meta::{
        alert::{AlertDestination, Condition, DestinationTemplate, Trigger},
        search::Query,
    };

    use super::*;

    #[actix_web::test]
    async fn test_send_notification() {
        let template = DestinationTemplate {
            name: Some("testTemplate".to_string()),
            body: "Test Body".into(),
            is_default: Some(false),
        };
        let _ = db::alerts::templates::set("default", "testTemplate", template);

        let destination = AlertDestination {
            url: "http://dummy/alert".to_string(),
            method: alert::AlertHTTPType::POST,
            headers: None,
            template: "testTemplate".to_string(),
        };
        let _ = db::alerts::destinations::set("default", "testDest", destination);

        let obj: Trigger = Trigger {
            timestamp: chrono::Utc::now().timestamp_micros(),
            is_valid: true,
            alert_name: "Test Alert".to_string(),
            stream: "olympics".to_string(),
            org: "default".to_string(),
            last_sent_at: chrono::Utc::now().timestamp_micros(),
            count: 1,
            is_ingest_time: true,
        };
        let res = send_notification(
            &vec![
               /*  AlertDestination {
                    url: "https://httpbin.org/post".to_string(),
                    dest_type: AlertDestType::Slack,
                },
                AlertDestination {
                    url: "https://httpbin.org/post".to_string(),
                    dest_type: AlertDestType::AlertManager,
                }, */
            ],
            &obj,
        )
        .await;
        assert!(res.is_ok());
    }
}
