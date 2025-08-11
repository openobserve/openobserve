use config::{META_ORG_ID, meta::stream::StreamType, utils::json};
use o2_enterprise::enterprise::common::config::get_config;
use once_cell::sync::Lazy;
use proto::cluster_rpc;
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::service::ingestion::ingestion_service;

const CLOUD_EVENT_STREAM: &str = "cloud_events";

#[derive(Serialize, Deserialize, Debug, Hash)]
pub enum EventType {
    OrgCreated,
    OrgDeleted,
    UserJoined,
    CheckoutSessionCreated,
    SubscriptionCreated,
    SubscriptionChanged,
    SubscriptionDeleted,
    StreamCreated,
}

#[derive(Serialize, Deserialize, Debug, Hash)]
pub struct CloudEvent {
    pub org_id: String,
    pub org_name: String,
    pub org_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    pub event: EventType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_name: Option<String>,
}

pub(super) static CLOUD_EVENT_QUEUE: Lazy<Mutex<Vec<CloudEvent>>> =
    Lazy::new(|| Mutex::new(vec![]));

pub async fn enqueue_cloud_event(event: CloudEvent) {
    let mut q = CLOUD_EVENT_QUEUE.lock().await;
    q.push(event);
}

async fn _inner_flush() {
    let cfg = get_config();
    let mut q = CLOUD_EVENT_QUEUE.lock().await;
    let mut events = std::mem::take(&mut *q);
    // release the write lock
    drop(q);
    let mut json_events = vec![];
    for event in &events {
        json_events.push(json::to_value(event).unwrap());
    }

    let mut requeue = false;

    if &cfg.cloud.cloud_events_reporting_mode != "local"
        && !cfg.cloud.cloud_events_reporting_url.is_empty()
        && !cfg.cloud.cloud_events_reporting_creds.is_empty()
    {
        let url = url::Url::parse(&cfg.cloud.cloud_events_reporting_url).unwrap();
        let creds = if cfg.cloud.cloud_events_reporting_creds.starts_with("Basic") {
            cfg.cloud.cloud_events_reporting_creds.to_string()
        } else {
            format!("Basic {}", &cfg.cloud.cloud_events_reporting_creds)
        };
        match reqwest::Client::builder()
            .build()
            .unwrap()
            .post(url)
            .header("Content-Type", "application/json")
            .header(reqwest::header::AUTHORIZATION, creds)
            .json(&json_events)
            .send()
            .await
        {
            Ok(resp) => {
                let resp_status = resp.status();
                if !resp_status.is_success() {
                    log::error!(
                        "[SELF-REPORTING] Error in ingesting cloud events data to external URL: {}",
                        resp.text()
                            .await
                            .unwrap_or_else(|_| resp_status.to_string())
                    );
                    if &cfg.cloud.cloud_events_reporting_mode != "both" {
                        // on error in ingesting usage data, push back the data
                        requeue = true;
                    }
                }
            }
            Err(e) => {
                log::error!(
                    "[SELF-REPORTING] Error in ingesting cloud events data to external URL {:?}",
                    e
                );
                if &cfg.cloud.cloud_events_reporting_mode != "both" {
                    // on error in ingesting usage data, push back the data
                    requeue = true;
                }
            }
        }
    }

    if &cfg.cloud.cloud_events_reporting_mode != "remote" {
        let req = cluster_rpc::IngestionRequest {
            org_id: META_ORG_ID.to_owned(),
            stream_name: CLOUD_EVENT_STREAM.to_owned(),
            data: Some(cluster_rpc::IngestionData::from(json_events)),
            stream_type: StreamType::Logs.to_string(),
            ingestion_type: Some(cluster_rpc::IngestionType::Usage.into()),
            metadata: None,
        };

        match ingestion_service::ingest(req).await {
            Ok(_) => {}
            Err(e) => {
                log::error!("error in reporting cloud events :{e}");
                // re-queue events for next try
                requeue = true;
            }
        }
    }

    if requeue {
        let mut q = CLOUD_EVENT_QUEUE.lock().await;
        q.append(&mut events);
    }
}

pub async fn flush_cloud_events() {
    let cfg = get_config();

    let mut audit_interval = tokio::time::interval(tokio::time::Duration::from_secs(
        cfg.cloud.cloud_events_publish_interval.try_into().unwrap(),
    ));
    audit_interval.tick().await; // trigger the first run
    loop {
        log::debug!("cloud event ingestion loop running");
        audit_interval.tick().await;
        _inner_flush().await;
    }
}
