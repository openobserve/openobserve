// Copyright 2025 OpenObserve Inc.
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

use std::sync::Arc;

use cloudevents::{Event, EventBuilder, EventBuilderV10};
use config::{get_config, ider, utils::json};
use log::{Metadata, Record};
use once_cell::sync::Lazy;
use reqwest::Client;
use tokio::sync::{RwLock, broadcast};

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
        get_config().log.events_enabled
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
                .id(ider::generate())
                .ty("debug_log")
                .source(get_config().common.instance_name.clone())
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

        let cfg = get_config();
        if logs.len() >= cfg.log.events_batch_size {
            let old_logs = std::mem::take(&mut *logs);
            let url = url::Url::parse(&cfg.log.events_url).unwrap();
            let auth = format!("Basic {}", &cfg.log.events_auth);
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

#[cfg(test)]
mod tests {
    use cloudevents::AttributesReader;
    use log::{Level, Log, MetadataBuilder};
    use tokio::sync::broadcast;

    use super::*;

    #[test]
    fn test_zo_logger_enabled() {
        let logger = ZoLogger {
            sender: EVENT_SENDER.clone(),
        };
        let metadata = MetadataBuilder::new()
            .level(Level::Info)
            .target("test")
            .build();
        assert_eq!(logger.enabled(&metadata), get_config().log.events_enabled);
    }

    #[test]
    fn test_zo_logger_log() {
        let (tx, mut rx) = broadcast::channel(1024);
        let logger = ZoLogger { sender: tx };
        let metadata = MetadataBuilder::new()
            .level(Level::Info)
            .target("test")
            .build();
        let record = Record::builder()
            .metadata(metadata)
            .args(format_args!("test message"))
            .file(Some("test.rs"))
            .line(Some(42))
            .build();

        logger.log(&record);

        // Verify the event was sent
        let event = rx.try_recv().unwrap();
        assert_eq!(event.ty(), "debug_log");
        assert_eq!(
            event.source().to_string(),
            get_config().common.instance_name.to_string()
        );
    }

    #[test]
    fn test_zo_logger_log_without_file_line() {
        let (tx, mut rx) = broadcast::channel(1024);
        let logger = ZoLogger { sender: tx };
        let metadata = MetadataBuilder::new()
            .level(Level::Info)
            .target("test")
            .build();
        let record = Record::builder()
            .metadata(metadata)
            .args(format_args!("test message"))
            .build();

        logger.log(&record);

        // Verify the event was sent
        let event = rx.try_recv().unwrap();
        let data: serde_json::Value =
            serde_json::from_str(event.data().unwrap().to_string().as_str()).unwrap();
        assert_eq!(data["file"], "");
        assert_eq!(data["line"], 0);
    }

    #[tokio::test]
    async fn test_send_logs() {
        let (tx, _) = broadcast::channel(1024);
        let logger = ZoLogger { sender: tx.clone() };
        let metadata = MetadataBuilder::new()
            .level(Level::Info)
            .target("test")
            .build();

        // Send enough logs to trigger a batch
        for _ in 0..get_config().log.events_batch_size {
            let record = Record::builder()
                .metadata(metadata.clone())
                .args(format_args!("test message"))
                .build();
            logger.log(&record);
        }

        // Verify logs were stored
        let logs = LOGS.read().await;
        assert_eq!(logs.len(), get_config().log.events_batch_size);
    }

    #[test]
    fn test_zo_logger_flush() {
        let logger = ZoLogger {
            sender: EVENT_SENDER.clone(),
        };
        // Flush should not panic
        logger.flush();
    }

    #[test]
    fn test_event_sender_initialization() {
        let sender = EVENT_SENDER.clone();
        assert_eq!(sender.receiver_count(), 0);
    }

    #[test]
    fn test_logs_initialization() {
        let logs = LOGS.clone();
        assert_eq!(logs.blocking_read().len(), 0);
    }
}
