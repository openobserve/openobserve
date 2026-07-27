// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use std::{
    sync::{Arc, LazyLock as Lazy, OnceLock},
    time::Duration,
};

use async_trait::async_trait;
use chrono::{DateTime, Datelike, Timelike};
use config::{
    SIZE_IN_MB,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        self_reporting::{
            EnqueueError, ReportingData, ReportingMessage, ReportingQueue, ReportingRunner,
            error::ErrorData,
            usage::{RequestStats, TriggerData, UsageData, UsageEvent, UsageType},
        },
        stream::StreamType,
    },
    metrics,
};
use tokio::{
    sync::{Mutex, mpsc, oneshot},
    time,
};

#[async_trait]
pub trait BatchPublisher: Send + Sync + 'static {
    async fn publish(&self, worker_id: usize, batch: Vec<ReportingData>);
}

static BATCH_PUBLISHER: OnceLock<Arc<dyn BatchPublisher>> = OnceLock::new();
static USAGE_QUEUE: Lazy<Arc<ReportingQueue>> =
    Lazy::new(|| Arc::new(initialize_reporting_queue()));
static ERROR_QUEUE: Lazy<Arc<ReportingQueue>> =
    Lazy::new(|| Arc::new(initialize_reporting_queue()));

/// Registers the persistence adapter used after the reporting queue forms a batch.
pub fn set_batch_publisher(
    publisher: Arc<dyn BatchPublisher>,
) -> Result<(), Arc<dyn BatchPublisher>> {
    BATCH_PUBLISHER.set(publisher)
}

pub async fn run() {
    #[cfg(not(feature = "enterprise"))]
    {
        if !get_config().common.usage_enabled {
            return;
        }
    }

    if let Err(error) = start().await {
        log::error!("[SELF-REPORTING] Reporting queue initialization failed: {error}");
        return;
    }

    log::debug!("[SELF-REPORTING] successfully initialized reporting queues");
}

pub fn publish_triggers_usage(trigger: TriggerData) {
    #[cfg(not(feature = "enterprise"))]
    {
        if !get_config().common.usage_enabled {
            log::debug!(
                "[SELF-REPORTING] Skipping trigger usage publish - usage reporting disabled"
            );
            return;
        }
    }

    log::debug!(
        "[SELF-REPORTING] Publishing trigger usage: org={}, module={:?}, key={}, status={:?}",
        trigger.org,
        trigger.module,
        trigger.key,
        trigger.status
    );

    match try_enqueue(ReportingData::Trigger(Box::new(trigger))) {
        Ok(()) => {
            log::debug!(
                "[SELF-REPORTING] Successfully queued trigger usage data to be ingested (non-blocking)"
            )
        }
        Err(tokio::sync::mpsc::error::TrySendError::Full(message)) => {
            let dropped_info = match message {
                ReportingMessage::Data(ReportingData::Trigger(trigger)) => {
                    Some((trigger.org.clone(), trigger.key.clone()))
                }
                _ => None,
            };

            if let Some((org, key)) = dropped_info {
                log::warn!(
                    "[SELF-REPORTING] Usage queue full, dropping trigger data for org={}, key={}. \
                     System is overloaded. Consider increasing ZO_USAGE_REPORTING_THREAD_NUM or ZO_USAGE_BATCH_SIZE.",
                    org,
                    key
                );
            } else {
                log::warn!(
                    "[SELF-REPORTING] Usage queue full, dropping trigger data. \
                     System is overloaded. Consider increasing ZO_USAGE_REPORTING_THREAD_NUM or ZO_USAGE_BATCH_SIZE."
                );
            }

            metrics::SELF_REPORTING_DROPPED_TRIGGERS
                .with_label_values(&["usage"])
                .inc();
        }
        Err(tokio::sync::mpsc::error::TrySendError::Closed(_)) => {
            log::error!(
                "[SELF-REPORTING] Usage queue closed, cannot send trigger data. \
                 Self-reporting service may have shut down."
            );
        }
    }
}

pub async fn publish_error(error_data: ErrorData) {
    let cfg = get_config();
    #[cfg(not(feature = "enterprise"))]
    {
        if !cfg.common.usage_enabled {
            log::debug!("[SELF-REPORTING] Skipping error publish - usage reporting disabled");
            return;
        }
    }

    let timeout_duration = Duration::from_secs(cfg.common.error_publish_timeout_secs);
    let org = error_data.stream_params.org_id.clone();
    let error_source = match &error_data.error_source {
        config::meta::self_reporting::error::ErrorSource::Alert => "Alert",
        config::meta::self_reporting::error::ErrorSource::Dashboard => "Dashboard",
        config::meta::self_reporting::error::ErrorSource::Function(_) => "Function",
        config::meta::self_reporting::error::ErrorSource::Ingestion => "Ingestion",
        config::meta::self_reporting::error::ErrorSource::Pipeline(_) => "Pipeline",
        config::meta::self_reporting::error::ErrorSource::Search => "Search",
        config::meta::self_reporting::error::ErrorSource::Other => "Other",
        config::meta::self_reporting::error::ErrorSource::SsoClaimParser(_) => "SsoClaimParser",
        config::meta::self_reporting::error::ErrorSource::OrgStorage(_) => "OrgStorage",
    };

    log::debug!(
        "[SELF-REPORTING] Publishing error data: org={}, source={}, timeout={:?}",
        org,
        error_source,
        timeout_duration
    );

    let start = std::time::Instant::now();
    match enqueue_error_with_timeout(ReportingData::Error(Box::new(error_data)), timeout_duration)
        .await
    {
        Ok(()) => {
            log::debug!(
                "[SELF-REPORTING] Successfully queued error data to be ingested (took {:?}, timeout-based)",
                start.elapsed()
            );
        }
        Err(EnqueueError::Timeout) => {
            log::warn!(
                "[SELF-REPORTING] Timeout ({:?}) queueing error data for org={}, source={}. \
                 System overloaded, error reporting degraded. \
                 Consider increasing ZO_USAGE_REPORTING_THREAD_NUM or ZO_USAGE_BATCH_SIZE.",
                timeout_duration,
                org,
                error_source
            );
            metrics::SELF_REPORTING_TIMEOUT_ERRORS
                .with_label_values(&["error"])
                .inc();
        }
        Err(EnqueueError::SendFailed(error)) => {
            log::error!(
                "[SELF-REPORTING] Failed to send error data for org={}, source={}: {error}",
                org,
                error_source
            );
        }
    }
}

pub async fn flush() {
    let cfg = get_config();

    #[cfg(feature = "enterprise")]
    let usage_enabled = true;
    #[cfg(not(feature = "enterprise"))]
    let usage_enabled = cfg.common.usage_enabled;

    if !usage_enabled || (!LOCAL_NODE.is_ingester() && !LOCAL_NODE.is_querier()) {
        return;
    }

    shutdown(cfg.limit.usage_reporting_thread_num).await;
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
    tokio::spawn(publish_usage(usages));
}

async fn publish_usage(usages: Vec<UsageData>) {
    #[cfg(not(feature = "enterprise"))]
    {
        let cfg = get_config();
        if !cfg.common.usage_enabled {
            return;
        }
    }

    for usage in usages {
        if let Err(e) = USAGE_QUEUE
            .enqueue(ReportingData::Usage(Box::new(usage)))
            .await
        {
            log::error!(
                "[SELF-REPORTING] Failed to send usage data to background ingesting job: {e}"
            );
        }
    }
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
        Some(publisher) => publisher.publish(worker_id, batch).await,
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

#[cfg(test)]
mod tests {
    use config::meta::{
        self_reporting::{
            error::ErrorData,
            usage::{TriggerData, TriggerDataStatus, TriggerDataType},
        },
        stream::StreamParams,
    };
    use tokio::time::Duration;

    use super::*;

    fn create_test_usage_data() -> UsageData {
        UsageData {
            _timestamp: 1234567890,
            event: UsageEvent::Ingestion,
            year: 2024,
            month: 1,
            day: 1,
            hour: 12,
            event_time_hour: "2024-01-01T12:00:00Z".to_string(),
            org_id: "test-org".to_string(),
            request_body: "test body".to_string(),
            size: 1024.0,
            unit: "bytes".to_string(),
            user_email: "test@example.com".to_string(),
            response_time: 0.1,
            stream_type: StreamType::Logs,
            num_records: 100,
            dropped_records: 0,
            stream_name: "test-stream".to_string(),
            trace_id: None,
            cached_ratio: None,
            scan_files: None,
            compressed_size: None,
            min_ts: None,
            max_ts: None,
            search_type: None,
            search_event_context: None,
            took_wait_in_queue: None,
            result_cache_ratio: None,
            function: None,
            is_partial: false,
            work_group: None,
            node_name: None,
            dashboard_info: None,
            peak_memory_usage: None,
        }
    }

    fn create_test_trigger_data() -> TriggerData {
        TriggerData {
            _timestamp: 1234567890,
            org: "test-org".to_string(),
            module: TriggerDataType::Report,
            key: "test-key".to_string(),
            next_run_at: 1234567890,
            is_realtime: false,
            is_silenced: false,
            status: TriggerDataStatus::Completed,
            start_time: 1234567890,
            end_time: 1234567890,
            retries: 0,
            skipped_alerts_count: None,
            error: None,
            success_response: None,
            is_partial: None,
            delay_in_secs: None,
            evaluation_took_in_secs: None,
            source_node: None,
            query_took: None,
            scheduler_trace_id: None,
            time_in_queue_ms: None,
            dedup_enabled: None,
            dedup_suppressed: None,
            dedup_count: None,
            grouped: None,
            group_size: None,
        }
    }

    fn create_test_error_data() -> ErrorData {
        ErrorData {
            _timestamp: 1234567890,
            stream_params: StreamParams::new("test-org", "test-stream", StreamType::Logs),
            error_source: config::meta::self_reporting::error::ErrorSource::Other,
        }
    }

    #[tokio::test]
    async fn test_reporting_runner_basic_operations() {
        let mut runner = ReportingRunner::new(3, Duration::from_secs(1));

        // Initially should not process
        assert!(!runner.should_process());

        // Should not process until batch size is reached
        runner.push(ReportingData::Usage(Box::new(create_test_usage_data())));
        assert!(!runner.should_process());

        // Add more data to reach batch size
        runner.push(ReportingData::Trigger(Box::new(create_test_trigger_data())));
        runner.push(ReportingData::Error(Box::new(create_test_error_data())));
        assert!(runner.should_process());

        let batch = runner.take_batch();
        assert_eq!(batch.len(), 3);
        assert!(!runner.should_process());
    }

    #[tokio::test]
    async fn test_reporting_runner_timeout_processing() {
        let mut runner = ReportingRunner::new(10, Duration::from_millis(100));

        runner.push(ReportingData::Usage(Box::new(create_test_usage_data())));

        // Should not process immediately, but should after the timeout elapses
        assert!(!runner.should_process());
        time::sleep(Duration::from_millis(150)).await;
        assert!(runner.should_process());
    }

    #[tokio::test]
    async fn test_reporting_queue_enqueue() {
        let (sender, _receiver) = mpsc::channel(10);
        let queue = ReportingQueue::new(sender);

        let result = queue
            .enqueue(ReportingData::Usage(Box::new(create_test_usage_data())))
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_reporting_queue_start_shutdown() {
        let (sender, mut receiver) = mpsc::channel(10);
        let queue = ReportingQueue::new(sender);

        // Test start message
        let (start_sender, start_receiver) = oneshot::channel();
        queue.start(start_sender).await.unwrap();
        match receiver.recv().await.unwrap() {
            ReportingMessage::Start(sender) => sender.send(()).unwrap(),
            _ => panic!("Expected Start message"),
        }

        // Test shutdown message
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        queue.shutdown(shutdown_sender).await.unwrap();
        match receiver.recv().await.unwrap() {
            ReportingMessage::Shutdown(sender) => sender.send(()).unwrap(),
            _ => panic!("Expected Shutdown message"),
        }

        // Verify both channels received responses
        assert!(start_receiver.await.is_ok());
        assert!(shutdown_receiver.await.is_ok());
    }

    #[test]
    fn test_count_data() {
        let batch = [
            ReportingData::Usage(Box::new(create_test_usage_data())),
            ReportingData::Trigger(Box::new(create_test_trigger_data())),
            ReportingData::Error(Box::new(create_test_error_data())),
        ];
        assert_eq!(count_data(&batch), (2, 1));
        assert_eq!(count_data(&[]), (0, 0));
    }
}
