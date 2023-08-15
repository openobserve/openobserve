use std::sync::Arc;

use cloudevents::{Event, EventBuilder, EventBuilderV10};

use log::{Metadata, Record};
use once_cell::sync::Lazy;
use reqwest::Client;
use tokio::sync::broadcast;
use tokio::sync::RwLock;

use crate::common::{
    infra::{config::CONFIG, ider::generate},
    json,
};

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
