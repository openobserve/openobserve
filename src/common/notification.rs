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

use std::error::Error as StdError;

use serde_json::json;

use crate::meta::alert::{self, AlertDestination};

pub async fn send_notification(
    alert_destinations: &Vec<AlertDestination>,
    trigger: &alert::Trigger,
) -> Result<(), Box<dyn StdError>> {
    let client = reqwest::Client::new();

    let alert_type = match &trigger.is_ingest_time {
        true => "Real time",
        false => "Scheduled",
    };

    for dest in alert_destinations {
        let msg = json!({
            "text":
                format!(
                    "For stream {} of organization {} alert {} of type {} is active",
                    &trigger.stream, &trigger.org, &trigger.alert_name, alert_type
                )
        });

        /* match dest.dest_type {
            alert::AlertDestType::Slack => match url::Url::parse(&dest.url) {
                Ok(dest_url) => {
                    //Invoke Webhook

                    let req = client
                        .post(dest_url)
                        .header("Content-type", "application/json")
                        .json(&msg);

                    let _ = req.send().await.unwrap();
                }
                Err(_) => log::info!("Error parsing notification url"),
            },
            alert::AlertDestType::AlertManager => match url::Url::parse(&dest.url) {
                Ok(dest_url) => {
                    let curr_ts = chrono::Utc::now().timestamp_micros();
                    let prom_alert = serde_json::json!([{
                      "labels": {
                        "alertname": &trigger.alert_name,
                        "stream": &trigger.stream,
                        "organization": &trigger.org,
                        "alerttype":alert_type,
                        "severity":"critical"
                        },
                      "annotations": {
                        "message": &msg,
                        "timestamp": curr_ts
                      }
                    }]);

                    let req = client
                        .post(dest_url)
                        .header("Content-type", "application/json")
                        .json(&prom_alert);

                    let resp = req.send().await;
                    match resp {
                        Ok(_) => log::info!("Notification Sent"),
                        Err(err) => log::info!("Error sending data to alert manager {:?}", err),
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
    use crate::meta::alert::{AlertDestType, Trigger};

    use super::*;

    #[actix_web::test]
    async fn test_send_notification() {
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
