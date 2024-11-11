// Copyright 2024 OpenObserve Inc.
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

use chrono::{DateTime, Datelike, Timelike};
use config::{
    get_config,
    meta::{
        stream::StreamType,
        usage::{
            AggregatedData, GroupKey, RequestStats, TriggerData, UsageData, UsageEvent, UsageType,
            TRIGGERS_USAGE_STREAM, USAGE_STREAM,
        },
    },
    metrics,
    utils::json,
    SIZE_IN_MB,
};
use hashbrown::HashMap;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::auditor;
use once_cell::sync::Lazy;
use proto::cluster_rpc;
use reqwest::Client;
use tokio::{
    sync::{mpsc, oneshot, Mutex},
    time,
};

pub mod ingestion_service;

static USAGE_QUEUER: Lazy<Arc<UsageQueuer>> = Lazy::new(|| Arc::new(initialize_usage_queuer()));

fn initialize_usage_queuer() -> UsageQueuer {
    let cfg = get_config();
    let timeout = time::Duration::from_secs(cfg.common.usage_publish_interval.try_into().unwrap());
    let batch_size = cfg.common.usage_batch_size;

    let (msg_sender, msg_receiver) = mpsc::channel::<UsageMessage>(
        batch_size * std::cmp::max(2, cfg.limit.usage_reporting_thread_num),
    );
    let msg_receiver = Arc::new(Mutex::new(msg_receiver));

    // configurable number of threads for usage_reporting
    for thread_id in 0..cfg.limit.usage_reporting_thread_num {
        let msg_receiver = msg_receiver.clone();
        tokio::task::spawn(async move {
            ingest_usage_job(thread_id, msg_receiver, batch_size, timeout).await
        });
    }

    UsageQueuer::new(msg_sender)
}

pub async fn run() {
    let cfg = get_config();
    if !cfg.common.usage_enabled {
        return;
    }

    // Force initialization and wait for the background task to be ready
    let (ping_sender, ping_receiver) = oneshot::channel();
    if let Err(e) = USAGE_QUEUER
        .msg_sender
        .send(UsageMessage::Ping(ping_sender))
        .await
    {
        log::error!("[USAGE] Failed to initialize usage queuer: {e}");
        return;
    }

    if let Err(e) = ping_receiver.await {
        log::error!("[USAGE] Usage queuer initialization failed: {e}");
        return;
    }

    log::debug!("[USAGE] Usage queuer initialized successfully");
}

pub async fn report_request_usage_stats(
    stats: RequestStats,
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    usage_type: UsageType,
    num_functions: u16,
    timestamp: i64,
) {
    metrics::INGEST_RECORDS
        .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
        .inc_by(stats.records as u64);
    metrics::INGEST_BYTES
        .with_label_values(&[org_id, stream_name, stream_type.to_string().as_str()])
        .inc_by((stats.size as i64 * SIZE_IN_MB) as u64);
    let event: UsageEvent = usage_type.into();
    let now = DateTime::from_timestamp_micros(timestamp).unwrap();

    if !get_config().common.usage_enabled {
        return;
    }

    let request_body = stats.request_body.unwrap_or(usage_type.to_string());
    let user_email = stats.user_email.unwrap_or("".to_owned());

    let mut usage = vec![];

    if num_functions > 0 {
        usage.push(UsageData {
            _timestamp: timestamp,
            event: UsageEvent::Functions,
            day: now.day(),
            hour: now.hour(),
            month: now.month(),
            year: now.year(),
            event_time_hour: format!(
                "{:04}{:02}{:02}{:02}",
                now.year(),
                now.month(),
                now.day(),
                now.hour()
            ),
            org_id: org_id.to_owned(),
            request_body: request_body.to_owned(),
            function: None,
            size: stats.size,
            unit: "MB".to_owned(),
            user_email: user_email.to_owned(),
            response_time: stats.response_time,
            num_records: stats.records * num_functions as i64,
            dropped_records: stats.dropped_records,
            stream_type,
            stream_name: stream_name.to_owned(),
            min_ts: None,
            max_ts: None,
            cached_ratio: None,
            compressed_size: None,
            search_type: stats.search_type,
            search_event_context: stats.search_event_context.clone(),
            trace_id: None,
            took_wait_in_queue: stats.took_wait_in_queue,
            result_cache_ratio: None,
            is_partial: stats.is_partial,
            work_group: None,
        });
    };

    usage.push(UsageData {
        _timestamp: timestamp,
        event,
        day: now.day(),
        hour: now.hour(),
        month: now.month(),
        year: now.year(),
        event_time_hour: format!(
            "{:04}{:02}{:02}{:02}",
            now.year(),
            now.month(),
            now.day(),
            now.hour()
        ),
        org_id: org_id.to_owned(),
        request_body: request_body.to_owned(),
        size: stats.size,
        unit: "MB".to_owned(),
        user_email,
        response_time: stats.response_time,
        function: stats.function,
        num_records: stats.records,
        dropped_records: stats.dropped_records,
        stream_type,
        stream_name: stream_name.to_owned(),
        min_ts: stats.min_ts,
        max_ts: stats.max_ts,
        cached_ratio: stats.cached_ratio,
        compressed_size: None,
        search_type: stats.search_type,
        search_event_context: stats.search_event_context.clone(),
        trace_id: stats.trace_id,
        took_wait_in_queue: stats.took_wait_in_queue,
        result_cache_ratio: stats.result_cache_ratio,
        is_partial: stats.is_partial,
        work_group: stats.work_group,
    });
    if !usage.is_empty() {
        publish_usage(usage).await;
    }
}

async fn publish_usage(usage: Vec<UsageData>) {
    let cfg = get_config();
    if !cfg.common.usage_enabled {
        return;
    }

    if let Err(e) = USAGE_QUEUER
        .enqueue(
            usage
                .into_iter()
                .map(|item| UsageBuffer::Usage(Box::new(item)))
                .collect(),
        )
        .await
    {
        log::error!("[USAGE] Failed to send usage data to background ingesting job: {e}")
    };
}

pub async fn publish_triggers_usage(trigger: TriggerData) {
    let cfg = get_config();
    if !cfg.common.usage_enabled {
        return;
    }

    match USAGE_QUEUER
        .enqueue(vec![UsageBuffer::Trigger(Box::new(trigger))])
        .await
    {
        Err(e) => {
            log::error!(
                "[USAGE] Failed to send trigger usage data to background ingesting job: {e}"
            )
        }
        Ok(()) => {
            log::debug!("[USAGE] Successfully queued trigger usage data to be ingested")
        }
    }
}

pub async fn flush() {
    // flush audit data
    #[cfg(feature = "enterprise")]
    flush_audit().await;

    // shutdown usage_queuer
    for _ in 0..get_config().limit.usage_reporting_thread_num {
        let (res_sender, res_receiver) = oneshot::channel();
        if let Err(e) = USAGE_QUEUER.shutdown(res_sender).await {
            log::error!("[USAGE] Error shutting down USAGE_QUEUER: {e}");
        }
        // wait for flush ingestion job
        res_receiver.await.ok();
    }
}

async fn ingest_usages(curr_usages: Vec<UsageData>) {
    if curr_usages.is_empty() {
        log::info!("Returning as no usages reported ");
        return;
    }
    let mut groups: HashMap<GroupKey, AggregatedData> = HashMap::new();
    let mut search_events = vec![];
    for usage_data in &curr_usages {
        // Skip aggregation for usage_data with event "Search"
        if usage_data.event == UsageEvent::Search {
            search_events.push(usage_data.clone());
            continue;
        }

        let key = GroupKey {
            stream_name: usage_data.stream_name.clone(),
            org_id: usage_data.org_id.clone(),
            stream_type: usage_data.stream_type,
            day: usage_data.day,
            hour: usage_data.hour,
            event: usage_data.event,
            email: usage_data.user_email.clone(),
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
            entry.usage_data.dropped_records += usage_data.dropped_records;
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

    // Push all the search events
    report_data.append(&mut search_events);
    let cfg = get_config();
    if &cfg.common.usage_reporting_mode != "local"
        && !cfg.common.usage_reporting_url.is_empty()
        && !cfg.common.usage_reporting_creds.is_empty()
    {
        let url = url::Url::parse(&cfg.common.usage_reporting_url).unwrap();
        let creds = if cfg.common.usage_reporting_creds.starts_with("Basic") {
            cfg.common.usage_reporting_creds.to_string()
        } else {
            format!("Basic {}", &cfg.common.usage_reporting_creds)
        };
        match Client::builder()
            .build()
            .unwrap()
            .post(url)
            .header("Content-Type", "application/json")
            .header(reqwest::header::AUTHORIZATION, creds)
            .json(&report_data)
            .send()
            .await
        {
            Ok(resp) => {
                let resp_status = resp.status();
                if !resp_status.is_success() {
                    log::error!(
                        "Error in ingesting usage data to external URL: {}",
                        resp.text()
                            .await
                            .unwrap_or_else(|_| resp_status.to_string())
                    );
                    if &cfg.common.usage_reporting_mode != "both" {
                        // on error in ingesting usage data, push back the data
                        let curr_usages = curr_usages.clone();
                        if let Err(e) = USAGE_QUEUER
                            .enqueue(
                                curr_usages
                                    .into_iter()
                                    .map(|item| UsageBuffer::Usage(Box::new(item)))
                                    .collect(),
                            )
                            .await
                        {
                            log::error!(
                                "Error in pushing back un-ingested Usage data to UsageQueuer: {e}"
                            );
                        }
                    }
                }
            }
            Err(e) => {
                log::error!("Error in ingesting usage data to external URL {:?}", e);
                if &cfg.common.usage_reporting_mode != "both" {
                    // on error in ingesting usage data, push back the data
                    let curr_usages = curr_usages.clone();
                    if let Err(e) = USAGE_QUEUER
                        .enqueue(
                            curr_usages
                                .into_iter()
                                .map(|item| UsageBuffer::Usage(Box::new(item)))
                                .collect(),
                        )
                        .await
                    {
                        log::error!(
                            "Error in pushing back un-ingested Usage data to UsageQueuer: {e}"
                        );
                    }
                }
            }
        }
    }

    if &cfg.common.usage_reporting_mode != "remote" {
        let report_data = report_data
            .iter_mut()
            .map(|usage| json::to_value(usage).unwrap())
            .collect::<Vec<_>>();
        // report usage data
        let req = cluster_rpc::UsageRequest {
            stream_name: USAGE_STREAM.to_owned(),
            data: Some(cluster_rpc::UsageData::from(report_data)),
        };
        if let Err(e) = ingestion_service::ingest(&cfg.common.usage_org, req).await {
            log::error!("Error in ingesting usage data {:?}", e);
            // on error in ingesting usage data, push back the data
            if let Err(e) = USAGE_QUEUER
                .enqueue(
                    curr_usages
                        .into_iter()
                        .map(|item| UsageBuffer::Usage(Box::new(item)))
                        .collect(),
                )
                .await
            {
                log::error!("Error in pushing back un-ingested Usage data to UsageQueuer: {e}");
            }
        }
    }
}

async fn ingest_trigger_usages(curr_usages: Vec<TriggerData>) {
    if curr_usages.is_empty() {
        log::info!(" Returning as no triggers reported");
        return;
    }

    let mut json_triggers = vec![];
    for trigger_data in &curr_usages {
        json_triggers.push(json::to_value(trigger_data).unwrap());
    }

    // report trigger usage data
    let req = cluster_rpc::UsageRequest {
        stream_name: TRIGGERS_USAGE_STREAM.to_owned(),
        data: Some(cluster_rpc::UsageData::from(json_triggers)),
    };
    if let Err(e) = ingestion_service::ingest(&get_config().common.usage_org, req).await {
        log::error!("Error in ingesting triggers usage data {:?}", e);
        if let Err(e) = USAGE_QUEUER
            .enqueue(
                curr_usages
                    .into_iter()
                    .map(|item| UsageBuffer::Trigger(Box::new(item)))
                    .collect(),
            )
            .await
        {
            log::error!("Error in pushing back un-ingested Usage data to UsageQueuer: {e}");
        }
    }
}

#[derive(Debug)]
struct UsageQueuer {
    msg_sender: mpsc::Sender<UsageMessage>,
}

impl UsageQueuer {
    fn new(msg_sender: mpsc::Sender<UsageMessage>) -> Self {
        Self { msg_sender }
    }

    async fn enqueue(
        &self,
        usage_buf: Vec<UsageBuffer>,
    ) -> Result<(), mpsc::error::SendError<UsageMessage>> {
        self.msg_sender.send(UsageMessage::Data(usage_buf)).await
    }

    async fn shutdown(
        &self,
        res_sender: oneshot::Sender<()>,
    ) -> Result<(), mpsc::error::SendError<UsageMessage>> {
        self.msg_sender
            .send(UsageMessage::Shutdown(res_sender))
            .await
    }
}

#[derive(Debug)]
enum UsageMessage {
    Data(Vec<UsageBuffer>),
    Shutdown(oneshot::Sender<()>),
    Ping(oneshot::Sender<()>),
}

#[derive(Debug)]
enum UsageBuffer {
    Usage(Box<UsageData>),
    Trigger(Box<TriggerData>),
}

#[derive(Debug)]
struct UsageReportRunner {
    pending: Vec<UsageBuffer>,
    batch_size: usize,
    timeout: time::Duration,
    last_processed: time::Instant,
}

impl UsageReportRunner {
    fn new(batch_size: usize, timeout: time::Duration) -> Self {
        Self {
            pending: Vec::new(),
            batch_size,
            timeout,
            last_processed: time::Instant::now(),
        }
    }

    fn push(&mut self, data: Vec<UsageBuffer>) {
        self.pending.extend(data);
    }

    fn should_process(&self) -> bool {
        self.pending.len() >= self.batch_size
            || (!self.pending.is_empty() && self.last_processed.elapsed() >= self.timeout)
    }

    fn take_batch(&mut self) -> Vec<UsageBuffer> {
        self.last_processed = time::Instant::now();
        std::mem::take(&mut self.pending)
    }
}

/// Background job to collect and ingest UsageData and TriggerData.
/// Ingestion happens when either the batch_size or the timeout is exceeded, whichever satisfies the
/// first.
async fn ingest_usage_job(
    thread_id: usize,
    msg_receiver: Arc<Mutex<mpsc::Receiver<UsageMessage>>>,
    batch_size: usize,
    timeout: time::Duration,
) {
    log::debug!("[USAGE:JOB] thread_{thread_id} starts waiting for reporting jobs");
    let mut usage_report_runner = UsageReportRunner::new(batch_size, timeout);
    let mut interval = time::interval(timeout);

    loop {
        let mut msg_receiver = msg_receiver.lock().await;
        tokio::select! {
            msg = msg_receiver.recv() => {
                match msg {
                    Some(UsageMessage::Data(usage_buf)) => {
                        log::debug!("[USAGE:JOB] thread_{thread_id} received and queued {} messages.", usage_buf.len());
                        usage_report_runner.push(usage_buf);
                        if usage_report_runner.should_process() {
                            let buffered = usage_report_runner.take_batch();
                            ingest_buffered_usage(thread_id, buffered).await;
                        }
                    }
                    Some(UsageMessage::Shutdown(res_sender)) => {
                        log::debug!("[USAGE:JOB] thread_{thread_id} received shutdown signal");
                        // process any remaining data before shutting down
                        if !usage_report_runner.pending.is_empty() {
                            let buffered = usage_report_runner.take_batch();
                            ingest_buffered_usage(thread_id, buffered).await;
                        }
                        res_sender.send(()).ok();
                        break;
                    }
                    Some(UsageMessage::Ping(ping_sender)) => {
                        log::debug!("[USAGE:JOB] thread_{thread_id} received initialization ping");
                        ping_sender.send(()).ok();
                    }
                    None => break, // channel closed
                }
            }
            _ = interval.tick() => {
                if usage_report_runner.should_process() {
                    let buffered = usage_report_runner.take_batch();
                    ingest_buffered_usage(thread_id, buffered).await;
                }
            }
        }
    }
}

async fn ingest_buffered_usage(thread_id: usize, usage_buffer: Vec<UsageBuffer>) {
    log::debug!(
        "[USAGE:JOB] thread_{thread_id} ingests {} buffered usage data",
        usage_buffer.len()
    );
    let (mut usage_data, mut trigger_data) = (Vec::new(), Vec::new());
    for item in usage_buffer {
        match item {
            UsageBuffer::Usage(usage) => usage_data.push(*usage),
            UsageBuffer::Trigger(trigger) => trigger_data.push(*trigger),
        }
    }
    if !usage_data.is_empty() {
        ingest_usages(usage_data).await;
    }
    if !trigger_data.is_empty() {
        ingest_trigger_usages(trigger_data).await;
    }
}

// Cron job to frequently publish auditted events
#[cfg(feature = "enterprise")]
pub async fn run_audit_publish() {
    let o2cfg = o2_enterprise::enterprise::common::infra::config::get_config();
    if !o2cfg.common.audit_enabled {
        return;
    }
    let mut audit_interval = time::interval(time::Duration::from_secs(
        o2cfg.common.audit_publish_interval.try_into().unwrap(),
    ));
    audit_interval.tick().await; // trigger the first run
    loop {
        log::debug!("Audit ingestion loop running");
        audit_interval.tick().await;
        o2_enterprise::enterprise::common::auditor::publish_existing_audits(publish_audit).await;
    }
}

#[cfg(feature = "enterprise")]
pub async fn audit(msg: auditor::AuditMessage) {
    auditor::audit(msg, publish_audit).await;
}

#[cfg(feature = "enterprise")]
pub async fn flush_audit() {
    auditor::flush_audit(publish_audit).await;
}

#[cfg(feature = "enterprise")]
async fn publish_audit(
    req: cluster_rpc::UsageRequest,
) -> Result<cluster_rpc::UsageResponse, anyhow::Error> {
    ingestion_service::ingest(&get_config().common.usage_org, req).await
}

#[inline]
pub fn http_report_metrics(
    start: std::time::Instant,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    code: &str,
    uri: &str,
) {
    let time = start.elapsed().as_secs_f64();
    let uri = format!("/api/org/{}", uri);
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&[
            &uri,
            code,
            org_id,
            stream_name,
            stream_type.to_string().as_str(),
        ])
        .observe(time);
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&[
            &uri,
            code,
            org_id,
            stream_name,
            stream_type.to_string().as_str(),
        ])
        .inc();
}
