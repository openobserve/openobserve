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

use std::error::Error as StdError;

use crate::common::meta::alerts::Alert;

pub async fn send_notification(
    _alert: &Alert,
    _data: Vec<super::json::Map<String, super::json::Value>>,
) -> Result<(), Box<dyn StdError>> {
    // let alert_type = match &trigger.is_ingest_time {
    //     true => "Real time",
    //     false => "Scheduled",
    // };
    // let curr_ts = chrono::Utc::now().timestamp_micros();
    // let local_dest = match db::alerts::destinations::get(&trigger.org, &alert.destinations[0]).await
    // {
    //     Ok(v) => v,
    //     Err(_) => {
    //         log::error!("Destination Not found: {}", &alert.destinations[0]);
    //         return Ok(());
    //     }
    // };

    // let body = local_dest.template.body;
    // let resp_str = json::to_string(&body).unwrap();

    // let mut resp = resp_str
    //     .replace("{stream_name}", &trigger.stream)
    //     .replace("{org_name}", &trigger.org)
    //     .replace("{alert_name}", &trigger.alert_name)
    //     .replace("{alert_type}", alert_type)
    //     .replace("{timestamp}", &curr_ts.to_string());

    // // Replace contextual information with values if any from alert
    // if alert.context_attributes.is_some() {
    //     for (key, value) in alert.context_attributes.as_ref().unwrap() {
    //         resp = resp.replace(&format!("{{{key}}}"), value)
    //     }
    // }

    // let msg: Value = json::from_str(&resp).unwrap();
    // let msg: Value = match &msg {
    //     Value::String(obj) => match json::from_str(obj) {
    //         Ok(obj) => obj,
    //         Err(_) => msg,
    //     },
    //     _ => msg,
    // };
    // let client = if local_dest.skip_tls_verify {
    //     reqwest::Client::builder()
    //         .danger_accept_invalid_certs(true)
    //         .build()?
    // } else {
    //     reqwest::Client::new()
    // };
    // match url::Url::parse(&local_dest.url) {
    //     Ok(url) => {
    //         let mut req = match local_dest.method {
    //             alerts::AlertHTTPType::POST => client.post(url),
    //             alerts::AlertHTTPType::PUT => client.put(url),
    //             alerts::AlertHTTPType::GET => client.get(url),
    //         }
    //         .header("Content-type", "application/json");

    //         // Add additional headers if any from destination description
    //         if local_dest.headers.is_some() {
    //             for (key, value) in local_dest.headers.unwrap() {
    //                 if !key.is_empty() && !value.is_empty() {
    //                     req = req.header(key, value);
    //                 }
    //             }
    //         };

    //         let resp = req.json(&msg).send().await;
    //         match resp {
    //             Ok(resp) => {
    //                 if !resp.status().is_success() {
    //                     log::error!("Notification sent error: {:?}", resp.bytes().await);
    //                 }
    //             }
    //             Err(err) => log::error!("Notification sending error {:?}", err),
    //         }
    //     }
    //     Err(err) => {
    //         log::error!("Notification sending error {:?}", err);
    //     }
    // }

    Ok(())
}
