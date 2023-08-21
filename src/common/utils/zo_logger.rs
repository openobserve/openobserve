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

use cloudevents::{Event, EventBuilder, EventBuilderV10};
use log::{Metadata, Record};
use once_cell::sync::Lazy;
use reqwest::Client;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::common::infra::{config::CONFIG, ider::generate};
use crate::common::utils::json;

pub static EVENT_SENDER: Lazy<broadcast::Sender<Event>> = Lazy::new(|| {
    let (tx, _) = broadcast::channel(1024);
    tx
});

pub static LOGS: Lazy<Arc<RwLock<Vec<Event>>>> = Lazy::new(|| Arc::new(RwLock::new(vec![])));

pub struct ZoLogger {
    pub sender: broadcast::Sender<Event>,
}

impl log::Log for ZoLogger {
    fn enabled(&self, _metadata: &Metadata) -> bool {
        CONFIG.log.events_enabled
    }

    fn log(self: &ZoLogger, record: &Record) {
        if self.enabled(record.metadata()) {
            let ts = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
            let level = record.level();
            let file = record.file().unwrap_or("").replace('/', ":");
            let line = record.line().unwrap_or(0);
            let message = record.args();
            println!("[{ts} {level} {file}]:{line} {message}");

            let payload = json::json!({
                "ts": ts,
                "level": level.to_string(),
                "file": file,
                "line": line,
                "message": message,

            });

            let event = EventBuilderV10::new()
                .id(generate())
                .ty("debug_log")
                .source(CONFIG.common.instance_name.clone())
                .data("application/json", payload)
                .build()
                .unwrap();

            let _ = self.sender.send(event);
        }
    }
    fn flush(&self) {}
}

pub async fn send_logs() {
    let mut event_receiver_rx = EVENT_SENDER.subscribe();
    let cl = Arc::new(Client::builder().build().unwrap());

    while let Ok(val) = event_receiver_rx.recv().await {
        let mut logs = LOGS.write().await;
        logs.push(val);

        if logs.len() >= CONFIG.log.events_batch_size {
            let old_logs = std::mem::take(&mut *logs);
            let url = url::Url::parse(&CONFIG.log.events_url).unwrap();
            let auth = format!("Basic {}", &CONFIG.log.events_auth);
            let cl = Arc::clone(&cl);
            tokio::task::spawn(async move {
                let _ = cl
                    .post(url)
                    .header("Content-Type", "application/cloudevents+json")
                    .header(reqwest::header::AUTHORIZATION, auth)
                    .json(&old_logs)
                    .send()
                    .await;
            });
        }
    }
}
