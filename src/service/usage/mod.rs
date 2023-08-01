use ahash::AHashMap;
use chrono::{Datelike, Timelike, Utc};
use once_cell::sync::Lazy;
use reqwest::Client;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::common::meta::usage::USAGE_STREAM;
use crate::common::{
    infra::{config::CONFIG, metrics},
    meta::{
        usage::{AggregatedData, GroupKey, RequestStats, UsageData, UsageEvent, UsageType},
        StreamType,
    },
};

pub mod stats;

pub static USAGE_DATA: Lazy<Arc<RwLock<Vec<UsageData>>>> =
    Lazy::new(|| Arc::new(RwLock::new(vec![])));

pub async fn report_usage_stats(
    stats: RequestStats,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    event: UsageType,
    num_functions: u16,
) {
    metrics::INGEST_RECORDS
        .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
        .inc_by(stats.records);
    metrics::INGEST_BYTES
        .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
        .inc_by(stats.size as u64);

    if !CONFIG.common.usage_enabled || CONFIG.common.is_cloud_deployment {
        return;
    }
    let request_body = stats.request_body.unwrap_or(event.to_string());
    let now = Utc::now();
    let mut usage = vec![UsageData {
        event: event.into(),
        day: now.day(),
        hour: now.hour(),
        month: now.month(),
        year: now.year(),
        org_id: org_id.to_owned(),
        request_body: request_body.to_owned(),
        size: stats.size,
        unit: "MB".to_owned(),
        user_email: "".to_owned(),
        response_time: stats.response_time,
        num_records: stats.records,
        stream_type,
        stream_name: stream_name.to_owned(),
        min_ts: None,
        max_ts: None,
        compressed_size: None,
    }];

    if num_functions > 0 {
        usage.push(UsageData {
            event: UsageEvent::Functions,
            day: now.day(),
            hour: now.hour(),
            month: now.month(),
            year: now.year(),
            org_id: org_id.to_owned(),
            request_body,
            size: stats.size,
            unit: "MB".to_owned(),
            user_email: "".to_owned(),
            response_time: stats.response_time,
            num_records: stats.records * num_functions as u64,
            stream_type,
            stream_name: stream_name.to_owned(),
            min_ts: None,
            max_ts: None,
            compressed_size: None,
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

        let mut groups: AHashMap<GroupKey, AggregatedData> = AHashMap::new();

        for usage_data in curr_usage {
            let key = GroupKey {
                stream_name: usage_data.stream_name.clone(),
                org_id: usage_data.org_id.clone(),
                stream_type: usage_data.stream_type,
                day: usage_data.day,
                hour: usage_data.hour,
                event: usage_data.event,
            };

            let is_new = groups.contains_key(&key);

            let entry = groups.entry(key).or_insert_with(|| AggregatedData {
                count: 1,
                usage_data: usage_data.clone(),
            });
            if !is_new {
                continue;
            } else {
                entry.usage_data.num_records += usage_data.num_records;
                entry.usage_data.size += usage_data.size;
                entry.usage_data.response_time += usage_data.response_time;
                entry.count += 1;
            }
        }

        let mut report_data = vec![];
        for (_, data) in groups {
            let mut usage_data = data.usage_data;
            usage_data.response_time /= data.count as f64;
            report_data.push(usage_data);
        }

        let usage_url = if CONFIG.common.usage_ep.ends_with('/') {
            format!("{}{USAGE_STREAM}/_json", CONFIG.common.usage_ep)
        } else {
            format!("{}/{USAGE_STREAM}/_json", CONFIG.common.usage_ep)
        };
        let url = url::Url::parse(&usage_url).unwrap();
        let cl = Arc::clone(&cl);
        tokio::task::spawn(async move {
            let _ = cl
                .post(url)
                .header("Content-Type", "application/json")
                .header(reqwest::header::AUTHORIZATION, &CONFIG.common.usage_auth)
                .json(&report_data)
                .send()
                .await;
        });
    }
}
