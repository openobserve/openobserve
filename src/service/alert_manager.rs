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

use chrono::Utc;
use std::collections::HashMap;
use tokio::time;

use crate::common::infra::config::{TRIGGERS, TRIGGERS_IN_PROCESS};
use crate::common::meta;
use crate::common::meta::alert::{Evaluate, Trigger, TriggerTimer};
use crate::common::meta::search::Request;
use crate::common::utils::notification::send_notification;
use crate::service::search as SearchService;
use crate::service::triggers;

#[cfg_attr(coverage_nightly, no_coverage)]
pub async fn run() -> Result<(), anyhow::Error> {
    for trigger in TRIGGERS.iter() {
        if !trigger.is_ingest_time {
            let trigger = trigger.clone();
            tokio::task::spawn(async move { handle_triggers(trigger).await });
        }
    }
    Ok(())
}

#[cfg_attr(coverage_nightly, no_coverage)]
pub async fn handle_triggers(trigger: Trigger) {
    match super::db::alerts::get(
        &trigger.org,
        &trigger.stream,
        trigger.stream_type,
        &trigger.alert_name,
    )
    .await
    {
        Err(_) => log::error!("[ALERT MANAGER] Error fetching alert"),
        Ok(result) => {
            let key = format!("{}/{}", &trigger.org, &trigger.alert_name);
            if let Some(alert) = result {
                if TRIGGERS_IN_PROCESS.clone().contains_key(&key) {
                    let mut curr_time = TRIGGERS_IN_PROCESS.get_mut(&key).unwrap();
                    let delay = trigger.timestamp - curr_time.updated_at;
                    if delay > 0 {
                        log::info!(
                            "Updating timeout for trigger to {}",
                            curr_time.expires_at + delay
                        );
                        curr_time.expires_at += delay;
                        curr_time.updated_at = trigger.timestamp;
                    }
                } else {
                    let expires_at =
                        Utc::now().timestamp_micros() + get_micros_from_min(alert.duration); // * 60 * 1000000;
                    log::info!("Setting timeout for trigger to {}", expires_at);
                    TRIGGERS_IN_PROCESS.insert(
                        key.to_owned(),
                        TriggerTimer {
                            updated_at: trigger.timestamp,
                            expires_at,
                        },
                    );
                    handle_trigger(&key, alert.frequency).await;
                }
            }
        }
    }
}

#[cfg_attr(coverage_nightly, no_coverage)]
async fn handle_trigger(alert_key: &str, frequency: i64) {
    let mut interval = time::interval(time::Duration::from_secs((frequency * 60) as _));

    loop {
        interval.tick().await;
        let loc_triggers = TRIGGERS.clone();
        let trigger = match loc_triggers.get(&alert_key.to_owned()) {
            Some(trigger) => trigger,
            None => {
                log::info!("Trigger {} not found", alert_key);
                break;
            }
        };
        if TRIGGERS_IN_PROCESS.clone().contains_key(alert_key) {
            let alert_resp = super::db::alerts::get(
                &trigger.org,
                &trigger.stream,
                trigger.stream_type,
                &trigger.alert_name,
            )
            .await;

            match alert_resp.unwrap_or(None) {
                Some(alert) => {
                    let mut query = alert.query.clone().unwrap();
                    let curr_ts = Utc::now().timestamp_micros();
                    query.end_time = curr_ts;
                    query.start_time = curr_ts - get_micros_from_min(alert.duration);
                    let req: meta::search::Request = Request {
                        query,
                        aggs: HashMap::new(),
                        encoding: meta::search::RequestEncoding::Empty,
                        timeout: 0,
                    };
                    // do search
                    match SearchService::search(&trigger.org, alert.stream_type.unwrap(), &req)
                        .await
                    {
                        Ok(res) => {
                            if !res.hits.is_empty() {
                                let record = res.hits.first().unwrap().as_object().unwrap();
                                if alert.condition.evaluate(record.clone()) {
                                    let curr_ts = Utc::now().timestamp_micros();
                                    let mut local_trigger = trigger.clone();

                                    if trigger.last_sent_at == 0
                                        || (trigger.last_sent_at > 0
                                            && curr_ts - trigger.last_sent_at
                                                > get_micros_from_min(alert.time_between_alerts))
                                    {
                                        let _ = send_notification(&alert, &trigger).await;
                                        local_trigger.last_sent_at = curr_ts;
                                    }
                                    //Update trigger for last sent

                                    local_trigger.count += 1;
                                    let _ =
                                        triggers::save_trigger(&alert.name, &local_trigger).await;
                                }
                            }
                        }
                        Err(err) => {
                            log::error!("alert_manager search error: {:?}", err);
                        }
                    }
                }
                None => log::error!("Error fetching alert "),
            }
        }
    }
}

fn get_micros_from_min(min: i64) -> i64 {
    min * 60 * 1000000
}
