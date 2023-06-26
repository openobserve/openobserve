use chrono::{Datelike, Timelike, Utc};
use once_cell::sync::Lazy;
use reqwest::Client;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::{
    infra::{config::CONFIG, metrics},
    meta::{
        usage::{RequestStats, UsageData, UsageEvent, UsageType},
        StreamType,
    },
};

pub static USAGE_DATA: Lazy<Arc<RwLock<Vec<UsageData>>>> =
    Lazy::new(|| Arc::new(RwLock::new(vec![])));

pub async fn report_usage_stats(
    stats: RequestStats,
    org_id: &str,
    stream_type: StreamType,
    event: UsageType,
    num_functions: u16,
) {
    if !CONFIG.common.usage_enabled {
        return;
    }
    let local_stream_type = stream_type.to_string();
    // metrics
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[&event.to_string(), "200", org_id, "", &local_stream_type])
        .observe(stats.response_time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[&event.to_string(), "200", org_id, "", &local_stream_type])
        .inc();
    let request_body = stats.request_body.unwrap_or(event.to_string());
    let now = Utc::now();
    let mut usage = vec![UsageData {
        event: event.into(),
        day: now.day(),
        hour: now.hour(),
        month: now.month(),
        year: now.year(),
        organization_identifier: org_id.to_owned(),
        request_body: request_body.to_owned(),
        size: stats.size,
        unit: "MB".to_owned(),
        user_email: "".to_owned(),
        response_time: stats.response_time,
        num_records: stats.records,
        stream_type,
    }];

    if num_functions > 0 {
        usage.push(UsageData {
            event: UsageEvent::Functions,
            day: now.day(),
            hour: now.hour(),
            month: now.month(),
            year: now.year(),
            organization_identifier: org_id.to_owned(),
            request_body,
            size: stats.size,
            unit: "MB".to_owned(),
            user_email: "".to_owned(),
            response_time: stats.response_time,
            num_records: stats.records * num_functions as u64,
            stream_type,
        })
    }
    publish_usage(usage).await;
}

pub async fn publish_usage(mut usage: Vec<UsageData>) {
    let mut usages = USAGE_DATA.write().await;
    usages.append(&mut usage);

    if usages.len() >= CONFIG.common.usage_batch_size {
        let cl = Arc::new(Client::builder().build().unwrap());
        let curr_usage = std::mem::take(&mut *usages);
        let url = url::Url::parse(&CONFIG.common.usage_url).unwrap();
        let auth = format!("Basic {}", &CONFIG.common.usage_auth);
        let cl = Arc::clone(&cl);
        tokio::task::spawn(async move {
            let _ = cl
                .post(url)
                .header("Content-Type", "application/json")
                .header(reqwest::header::AUTHORIZATION, auth)
                .json(&curr_usage)
                .send()
                .await;
        });
    }
}
