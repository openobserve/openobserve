// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, LazyLock as Lazy, OnceLock},
};

use chrono::{DateTime, Datelike, Timelike};
use config::{
    SIZE_IN_MB, get_config,
    meta::{
        self_reporting::{
            ReportingData, ReportingMessage, ReportingQueue, ReportingRunner,
            usage::{RequestStats, UsageData, UsageEvent, UsageType},
        },
        stream::StreamType,
    },
    metrics,
};
use tokio::{
    sync::{Mutex, mpsc, oneshot},
    time,
};

pub type BatchPublishFuture = Pin<Box<dyn Future<Output = ()> + Send + 'static>>;
pub type BatchPublisher = fn(usize, Vec<ReportingData>) -> BatchPublishFuture;

static BATCH_PUBLISHER: OnceLock<BatchPublisher> = OnceLock::new();
static USAGE_QUEUE: Lazy<Arc<ReportingQueue>> =
    Lazy::new(|| Arc::new(initialize_reporting_queue()));
static ERROR_QUEUE: Lazy<Arc<ReportingQueue>> =
    Lazy::new(|| Arc::new(initialize_reporting_queue()));

/// Registers the persistence adapter used after the reporting queue forms a batch.
pub fn set_batch_publisher(publisher: BatchPublisher) {
    if BATCH_PUBLISHER.set(publisher).is_err() {
        log::warn!("[USAGE-REPORTING] batch publisher was already initialized");
    }
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
    let event: UsageEvent = usage_type.into();
    if matches!(event, UsageEvent::Ingestion) {
        metrics::INGEST_RECORDS
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc_by(stats.records as u64);
        metrics::INGEST_BYTES
            .with_label_values(&[org_id, stream_type.as_str()])
            .inc_by((stats.size * SIZE_IN_MB) as u64);
    }

    #[cfg(not(feature = "enterprise"))]
    if !get_config().common.usage_enabled {
        return;
    }

    let now = DateTime::from_timestamp_micros(timestamp).unwrap();
    let request_body = stats.request_body.unwrap_or(usage_type.to_string());
    let user_email = stats.user_email.unwrap_or_default();
    let mut usages = Vec::with_capacity(if num_functions > 0 { 2 } else { 1 });

    if num_functions > 0 {
        usages.push(UsageData {
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
            request_body: request_body.clone(),
            function: None,
            size: stats.size,
            scan_files: stats.scan_files,
            unit: "MB".to_owned(),
            user_email: user_email.clone(),
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
            node_name: stats.node_name.clone(),
            dashboard_info: stats.dashboard_info.clone(),
            peak_memory_usage: stats.peak_memory_usage,
        });
    }

    usages.push(UsageData {
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
        request_body,
        size: if matches!(
            event,
            UsageEvent::NewIncident | UsageEvent::IncidentReAnalysis
        ) {
            stats.records as f64
        } else {
            stats.size
        },
        scan_files: stats.scan_files,
        unit: if matches!(
            event,
            UsageEvent::NewIncident | UsageEvent::IncidentReAnalysis
        ) {
            "Count".to_owned()
        } else {
            "MB".to_owned()
        },
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
        search_event_context: stats.search_event_context,
        trace_id: stats.trace_id,
        took_wait_in_queue: stats.took_wait_in_queue,
        result_cache_ratio: stats.result_cache_ratio,
        is_partial: stats.is_partial,
        work_group: stats.work_group,
        node_name: stats.node_name,
        dashboard_info: stats.dashboard_info,
        peak_memory_usage: stats.peak_memory_usage,
    });

    report_usage(usages);
}

pub fn report_usage(usages: Vec<UsageData>) {
    #[cfg(not(feature = "enterprise"))]
    if !get_config().common.usage_enabled {
        return;
    }

    tokio::spawn(async move {
        for usage in usages {
            if let Err(error) = USAGE_QUEUE
                .enqueue(ReportingData::Usage(Box::new(usage)))
                .await
            {
                log::error!("[USAGE-REPORTING] failed to enqueue usage data: {error}");
            }
        }
    });
}

pub async fn start() -> Result<(), String> {
    start_queue(&USAGE_QUEUE, "usage").await?;
    start_queue(&ERROR_QUEUE, "error").await
}

pub async fn shutdown(worker_count: usize) {
    for _ in 0..worker_count {
        shutdown_queue(&USAGE_QUEUE, "usage").await;
        shutdown_queue(&ERROR_QUEUE, "error").await;
    }
}

pub async fn enqueue(data: ReportingData) -> Result<(), String> {
    match data {
        ReportingData::Error(error) => ERROR_QUEUE
            .enqueue(ReportingData::Error(error))
            .await
            .map_err(|error| error.to_string()),
        data => USAGE_QUEUE
            .enqueue(data)
            .await
            .map_err(|error| error.to_string()),
    }
}

pub fn try_enqueue(data: ReportingData) -> Result<(), mpsc::error::TrySendError<ReportingMessage>> {
    match data {
        ReportingData::Error(error) => ERROR_QUEUE.try_enqueue(ReportingData::Error(error)),
        data => USAGE_QUEUE.try_enqueue(data),
    }
}

pub async fn enqueue_error_with_timeout(
    data: ReportingData,
    timeout: std::time::Duration,
) -> Result<(), config::meta::self_reporting::EnqueueError> {
    ERROR_QUEUE.enqueue_with_timeout(data, timeout).await
}

fn initialize_reporting_queue() -> ReportingQueue {
    let cfg = get_config();
    #[cfg(feature = "enterprise")]
    let publish_interval = (10 * 60).min(cfg.common.usage_publish_interval);
    #[cfg(not(feature = "enterprise"))]
    let publish_interval = cfg.common.usage_publish_interval;
    let timeout = time::Duration::from_secs(
        publish_interval
            .try_into()
            .expect("Env ZO_USAGE_PUBLISH_INTERVAL must be an integer"),
    );
    let worker_count = cfg.limit.usage_reporting_thread_num;
    let (sender, receiver) = mpsc::channel::<ReportingMessage>(
        cfg.common.usage_batch_size * std::cmp::max(2, worker_count),
    );
    let receiver = Arc::new(Mutex::new(receiver));
    for worker_id in 0..worker_count {
        tokio::spawn(run_queue_worker(
            worker_id,
            receiver.clone(),
            cfg.common.usage_batch_size,
            timeout,
        ));
    }
    ReportingQueue::new(sender)
}

async fn run_queue_worker(
    worker_id: usize,
    receiver: Arc<Mutex<mpsc::Receiver<ReportingMessage>>>,
    batch_size: usize,
    timeout: time::Duration,
) {
    let mut runner = ReportingRunner::new(batch_size, timeout);
    let mut interval = time::interval(timeout);
    loop {
        let mut receiver = receiver.lock().await;
        tokio::select! {
            message = receiver.recv() => match message {
                Some(ReportingMessage::Start(sender)) => { sender.send(()).ok(); }
                Some(ReportingMessage::Shutdown(sender)) => {
                    if !runner.pending.is_empty() {
                        publish_batch(worker_id, runner.take_batch()).await;
                    }
                    sender.send(()).ok();
                    break;
                }
                Some(ReportingMessage::Data(data)) => {
                    runner.push(data);
                    update_queue_depth(&runner);
                    if runner.should_process() {
                        publish_batch(worker_id, runner.take_batch()).await;
                    }
                }
                None => break,
            },
            _ = interval.tick() => {
                if runner.should_process() {
                    publish_batch(worker_id, runner.take_batch()).await;
                }
            }
        }
    }
}

async fn publish_batch(worker_id: usize, batch: Vec<ReportingData>) {
    decrement_queue_depth(&batch);
    match BATCH_PUBLISHER.get() {
        Some(publisher) => publisher(worker_id, batch).await,
        None => log::error!("[USAGE-REPORTING] batch publisher is not initialized"),
    }
}

fn update_queue_depth(runner: &ReportingRunner) {
    let (usage, error) = count_data(&runner.pending);
    metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["usage"])
        .set(usage);
    metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["error"])
        .set(error);
}

fn decrement_queue_depth(batch: &[ReportingData]) {
    let (usage, error) = count_data(batch);
    metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["usage"])
        .sub(usage);
    metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["error"])
        .sub(error);
}

fn count_data(data: &[ReportingData]) -> (i64, i64) {
    data.iter().fold((0, 0), |(usage, error), item| match item {
        ReportingData::Usage(_) | ReportingData::Trigger(_) => (usage + 1, error),
        ReportingData::Error(_) => (usage, error + 1),
    })
}

async fn start_queue(queue: &ReportingQueue, name: &str) -> Result<(), String> {
    let (sender, receiver) = oneshot::channel();
    queue
        .start(sender)
        .await
        .map_err(|error| error.to_string())?;
    receiver
        .await
        .map_err(|error| format!("{name} queue failed to start: {error}"))
}

async fn shutdown_queue(queue: &ReportingQueue, name: &str) {
    let (sender, receiver) = oneshot::channel();
    if let Err(error) = queue.shutdown(sender).await {
        log::error!("[USAGE-REPORTING] failed to stop {name} queue: {error}");
        return;
    }
    receiver.await.ok();
}

#[inline]
pub fn http_report_metrics(
    start: std::time::Instant,
    org_id: &str,
    stream_type: StreamType,
    code: &str,
    uri: &str,
    search_type: &str,
    search_group: &str,
) {
    let uri = format!("/api/org/{uri}");
    let labels = [
        uri.as_str(),
        code,
        org_id,
        stream_type.as_str(),
        search_type,
        search_group,
    ];
    metrics::HTTP_RESPONSE_TIME
        .with_label_values(&labels)
        .observe(start.elapsed().as_secs_f64());
    metrics::HTTP_INCOMING_REQUESTS
        .with_label_values(&labels)
        .inc();
}
