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

use config::{
    META_ORG_ID, get_config,
    meta::{
        self_reporting::{
            ReportingData, ReportingMessage, ReportingQueue, ReportingRunner,
            usage::{ERROR_STREAM, TRIGGERS_STREAM, TriggerData},
        },
        stream::{StreamParams, StreamType},
    },
    utils::json,
};
use hashbrown::HashMap;
use once_cell::sync::Lazy;
use tokio::{
    sync::{Mutex, mpsc},
    time,
};

#[cfg(feature = "cloud")]
use crate::service::organization;

pub(super) static USAGE_QUEUE: Lazy<Arc<ReportingQueue>> =
    Lazy::new(|| Arc::new(initialize_usage_queue()));

pub(super) static ERROR_QUEUE: Lazy<Arc<ReportingQueue>> =
    Lazy::new(|| Arc::new(initialize_error_queue()));

/// Creates a reporting queue with specified configuration parameters.
///
/// # Arguments
/// * `publish_interval` - Interval in seconds for publishing batches
/// * `batch_size` - Maximum number of items per batch
/// * `thread_num` - Number of worker threads to spawn
fn create_reporting_queue(
    publish_interval: u64,
    batch_size: usize,
    thread_num: usize,
) -> ReportingQueue {
    let timeout = time::Duration::from_secs(publish_interval);

    let (msg_sender, msg_receiver) =
        mpsc::channel::<ReportingMessage>(batch_size * std::cmp::max(2, thread_num));
    let msg_receiver = Arc::new(Mutex::new(msg_receiver));

    for thread_id in 0..thread_num {
        let msg_receiver = msg_receiver.clone();
        tokio::task::spawn(self_reporting_ingest_job(
            thread_id,
            msg_receiver,
            batch_size,
            timeout,
        ));
    }

    ReportingQueue::new(msg_sender)
}

fn initialize_usage_queue() -> ReportingQueue {
    let cfg = get_config();

    // max usage reporting interval can be 10 mins, because we
    // need relatively recent data for usage calculations
    #[cfg(feature = "enterprise")]
    let usage_publish_interval = (10 * 60).min(cfg.common.usage_publish_interval);
    #[cfg(not(feature = "enterprise"))]
    let usage_publish_interval = cfg.common.usage_publish_interval;

    create_reporting_queue(
        usage_publish_interval
            .try_into()
            .expect("Env ZO_USAGE_PUBLISH_INTERVAL invalid format. Should be set as integer"),
        cfg.common.usage_batch_size,
        cfg.limit.usage_reporting_thread_num,
    )
}

fn initialize_error_queue() -> ReportingQueue {
    let cfg = get_config();

    // max usage reporting interval can be 10 mins, because we
    // need relatively recent data for usage calculations
    #[cfg(feature = "enterprise")]
    let usage_publish_interval = (10 * 60).min(cfg.common.usage_publish_interval);
    #[cfg(not(feature = "enterprise"))]
    let usage_publish_interval = cfg.common.usage_publish_interval;

    create_reporting_queue(
        usage_publish_interval
            .try_into()
            .expect("Env ZO_USAGE_PUBLISH_INTERVAL invalid format. Should be set as integer"),
        cfg.common.usage_batch_size,
        cfg.limit.usage_reporting_thread_num,
    )
}

async fn self_reporting_ingest_job(
    thread_id: usize,
    msg_receiver: Arc<Mutex<mpsc::Receiver<ReportingMessage>>>,
    batch_size: usize,
    timeout: time::Duration,
) {
    log::debug!("[SELF-REPORTING] thread_{thread_id} starts waiting for reporting messages");
    let mut reporting_runner = ReportingRunner::new(batch_size, timeout);
    let mut interval = time::interval(timeout);

    loop {
        let mut msg_receiver = msg_receiver.lock().await;
        tokio::select! {
            msg = msg_receiver.recv() => {
                match msg {
                    Some(ReportingMessage::Start(start_sender)) => {
                        log::debug!("[SELF-REPORTING] thread_{thread_id} received starting ping");
                        start_sender.send(()).ok();
                    }
                    Some(ReportingMessage::Shutdown(res_sender)) => {
                        log::debug!("[SELF-REPORTING] thread_{thread_id} received shutdown ping");
                        // process any remaining data before shutting down
                        if !reporting_runner.pending.is_empty() {
                            let buffered = reporting_runner.take_batch();
                            update_queue_depth_metrics(&buffered);
                            ingest_buffered_data(thread_id, buffered).await;
                        }
                        res_sender.send(()).ok();
                        break;
                    }
                    Some(ReportingMessage::Data(reporting_data)) => {
                        reporting_runner.push(reporting_data);
                        // Update queue depth metric after adding data
                        update_queue_depth_metric_for_runner(&reporting_runner);

                        if reporting_runner.should_process() {
                            let buffered = reporting_runner.take_batch();
                            update_queue_depth_metrics(&buffered);
                            ingest_buffered_data(thread_id, buffered).await;
                        }
                    }
                    None => break, // channel closed
                }
            }
            _ = interval.tick() => {
                if reporting_runner.should_process() {
                    let buffered = reporting_runner.take_batch();
                    update_queue_depth_metrics(&buffered);
                    ingest_buffered_data(thread_id, buffered).await;
                }
            }
        }
    }
}

/// Update queue depth metrics based on pending data in the runner
fn update_queue_depth_metric_for_runner(runner: &ReportingRunner) {
    let mut usage_count = 0;
    let mut error_count = 0;

    for data in &runner.pending {
        match data {
            ReportingData::Usage(_) | ReportingData::Trigger(_) => usage_count += 1,
            ReportingData::Error(_) => error_count += 1,
        }
    }

    config::metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["usage"])
        .set(usage_count);
    config::metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["error"])
        .set(error_count);
}

/// Update queue depth metrics after taking a batch (decrement)
fn update_queue_depth_metrics(batch: &[ReportingData]) {
    let mut usage_count = 0;
    let mut error_count = 0;

    for data in batch {
        match data {
            ReportingData::Usage(_) | ReportingData::Trigger(_) => usage_count += 1,
            ReportingData::Error(_) => error_count += 1,
        }
    }

    // Decrement the gauge by the batch size
    config::metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["usage"])
        .sub(usage_count);
    config::metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["error"])
        .sub(error_count);
}

async fn ingest_buffered_data(thread_id: usize, buffered: Vec<ReportingData>) {
    log::debug!(
        "[SELF-REPORTING] thread_{thread_id} ingests {} buffered data",
        buffered.len()
    );

    let (usages, triggers, errors, raw_errors) = buffered.into_iter().fold(
        (Vec::new(), Vec::new(), Vec::new(), Vec::new()),
        |(mut usages, mut triggers, mut errors, mut raw_errors), item| {
            match item {
                ReportingData::Usage(usage) => usages.push(*usage),
                ReportingData::Trigger(trigger) => triggers.push(json::to_value(*trigger).unwrap()),
                ReportingData::Error(error) => {
                    let error_data = *error;
                    // Keep raw error data for DB batching
                    errors.push(json::to_value(&error_data).unwrap());
                    raw_errors.push(error_data);
                }
            }
            (usages, triggers, errors, raw_errors)
        },
    );

    let cfg = get_config();

    #[cfg(not(feature = "enterprise"))]
    let usage_reporting_mode = &cfg.common.usage_reporting_mode;
    #[cfg(feature = "enterprise")]
    let usage_reporting_mode = {
        if cfg.common.usage_reporting_mode == "local" {
            "local"
        } else {
            "both"
        }
    };

    if !usages.is_empty() {
        super::ingestion::ingest_usages(usages).await;
    }

    if !triggers.is_empty() {
        let mut additional_reporting_orgs: Vec<String> =
            if !cfg.common.additional_reporting_orgs.is_empty() {
                cfg.common
                    .additional_reporting_orgs
                    .split(",")
                    .map(|s| s.to_string())
                    .collect()
            } else {
                Vec::new()
            };
        additional_reporting_orgs.push(META_ORG_ID.to_string());

        additional_reporting_orgs.sort();
        additional_reporting_orgs.dedup();

        // Ensure triggers stream exists with complete schema for each org (lazy, once per restart)
        for org in &additional_reporting_orgs {
            if let Err(e) = super::triggers_schema::ensure_triggers_stream_initialized(org).await {
                log::warn!(
                    "[SELF-REPORTING] Failed to ensure triggers stream initialized for {org}: {e}"
                );
            }
        }

        let mut enqueued_on_failure = false;

        for org in &additional_reporting_orgs {
            let trigger_stream = StreamParams::new(org, TRIGGERS_STREAM, StreamType::Logs);

            if super::ingestion::ingest_reporting_data(triggers.clone(), trigger_stream)
                .await
                .is_err()
                && usage_reporting_mode != "both"
                && !enqueued_on_failure
            {
                // Only enqueue once on first failure , this brings risk that it may be duplicated
                enqueued_on_failure = true;

                for trigger_json in triggers.clone() {
                    let trigger: TriggerData = json::from_value(trigger_json).unwrap();
                    if let Err(e) = USAGE_QUEUE
                        .enqueue(ReportingData::Trigger(Box::new(trigger)))
                        .await
                    {
                        log::error!(
                            "[SELF-REPORTING] Error in pushing back un-ingested TriggerData to UsageQueue: {e}"
                        );
                    }
                }
            }
        }
    }

    let mut per_org_map = HashMap::new();
    // If configured, automatically add each trigger's own org
    if cfg.common.usage_report_to_own_org && usage_reporting_mode != "remote" {
        for trigger_json in triggers {
            if let Ok(trigger) = json::from_value::<TriggerData>(trigger_json.clone()) {
                let org_id = &trigger.org;
                #[cfg(feature = "cloud")]
                match organization::is_org_in_free_trial_period(org_id).await {
                    Ok(ongoing) => {
                        if !ongoing {
                            continue;
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "error checking for trial period for trigger ingestion for {org_id} : {e}"
                        );
                        continue;
                    }
                }
                let entry = per_org_map.entry(org_id.clone()).or_insert(vec![]);
                entry.push(trigger_json);
            }
        }
        for (org, values) in per_org_map.into_iter() {
            let trigger_stream = StreamParams::new(&org, TRIGGERS_STREAM, StreamType::Logs);

            // before pushing to own org ensure that we have a proper triggers stream schema in
            // place
            if let Err(e) = super::triggers_schema::ensure_triggers_stream_initialized(&org).await {
                log::warn!(
                    "[SELF-REPORTING] Failed to ensure triggers stream initialized for {org}: {e}"
                );
            }

            if let Err(e) = super::ingestion::ingest_reporting_data(values, trigger_stream).await {
                log::error!("error in ingesting trigger data for {org} : {e}");
            }
        }
    }

    if cfg.common.usage_reporting_errors_enabled && !errors.is_empty() {
        let error_stream = StreamParams::new(META_ORG_ID, ERROR_STREAM, StreamType::Logs);
        if let Err(e) = super::ingestion::ingest_reporting_data(errors, error_stream).await {
            log::error!("[SELF-REPORTING] Error in ingesting ErrorData: {e}");
        }
    }

    // Batch upsert pipeline errors to DB
    if !raw_errors.is_empty() {
        let pipeline_errors: Vec<_> = raw_errors
            .into_iter()
            .filter_map(|error_data| {
                // Only process pipeline errors
                if let config::meta::self_reporting::error::ErrorSource::Pipeline(pipeline_error) =
                    error_data.error_source
                {
                    Some((
                        pipeline_error.pipeline_id.clone(),
                        pipeline_error.pipeline_name.clone(),
                        error_data.stream_params.org_id.to_string(),
                        error_data._timestamp,
                        pipeline_error,
                    ))
                } else {
                    None
                }
            })
            .collect();

        if !pipeline_errors.is_empty() {
            log::debug!(
                "[SELF-REPORTING] thread_{thread_id} batch upserting {} pipeline errors to DB",
                pipeline_errors.len()
            );
            if let Err(e) = crate::service::db::pipeline_errors::batch_upsert(pipeline_errors).await
            {
                log::error!(
                    "[SELF-REPORTING] thread_{thread_id} failed to batch upsert pipeline errors to DB: {e}"
                );
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use config::meta::{
        self_reporting::{
            error::ErrorData,
            usage::{TriggerData, TriggerDataStatus, TriggerDataType, UsageData, UsageEvent},
        },
        stream::{StreamParams, StreamType},
    };
    use tokio::{
        sync::oneshot,
        time::{self, Duration},
    };

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

        // Add data
        let usage_data = create_test_usage_data();
        runner.push(ReportingData::Usage(Box::new(usage_data)));

        // Should not process until batch size is reached
        assert!(!runner.should_process());

        // Add more data to reach batch size
        let trigger_data = create_test_trigger_data();
        runner.push(ReportingData::Trigger(Box::new(trigger_data)));
        let error_data = create_test_error_data();
        runner.push(ReportingData::Error(Box::new(error_data)));

        // Should process now
        assert!(runner.should_process());

        // Take batch
        let batch = runner.take_batch();
        assert_eq!(batch.len(), 3);

        // Should not process after taking batch
        assert!(!runner.should_process());
    }

    #[tokio::test]
    async fn test_reporting_runner_timeout_processing() {
        let mut runner = ReportingRunner::new(10, Duration::from_millis(100));

        // Add one item
        let usage_data = create_test_usage_data();
        runner.push(ReportingData::Usage(Box::new(usage_data)));

        // Should not process immediately
        assert!(!runner.should_process());

        // Wait for timeout
        time::sleep(Duration::from_millis(150)).await;

        // Should process after timeout
        assert!(runner.should_process());
    }

    #[tokio::test]
    async fn test_reporting_queue_enqueue() {
        let (sender, _receiver) = mpsc::channel(10);
        let queue = ReportingQueue::new(sender);

        let usage_data = create_test_usage_data();
        let result = queue
            .enqueue(ReportingData::Usage(Box::new(usage_data)))
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

        let msg = receiver.recv().await.unwrap();
        match msg {
            ReportingMessage::Start(sender) => {
                sender.send(()).unwrap();
            }
            _ => panic!("Expected Start message"),
        }

        // Test shutdown message
        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        queue.shutdown(shutdown_sender).await.unwrap();

        let msg = receiver.recv().await.unwrap();
        match msg {
            ReportingMessage::Shutdown(sender) => {
                sender.send(()).unwrap();
            }
            _ => panic!("Expected Shutdown message"),
        }

        // Verify both channels received responses
        assert!(start_receiver.await.is_ok());
        assert!(shutdown_receiver.await.is_ok());
    }

    #[tokio::test]
    async fn test_data_folding() {
        let usage_data = create_test_usage_data();
        let trigger_data = create_test_trigger_data();
        let error_data = create_test_error_data();

        let buffered = [
            ReportingData::Usage(Box::new(usage_data)),
            ReportingData::Trigger(Box::new(trigger_data)),
            ReportingData::Error(Box::new(error_data)),
        ];

        let (usages, triggers, errors) = buffered.into_iter().fold(
            (Vec::new(), Vec::new(), Vec::new()),
            |(mut usages, mut triggers, mut errors), item| {
                match item {
                    ReportingData::Usage(usage) => usages.push(*usage),
                    ReportingData::Trigger(trigger) => {
                        triggers.push(json::to_value(*trigger).unwrap())
                    }
                    ReportingData::Error(error) => errors.push(json::to_value(*error).unwrap()),
                }
                (usages, triggers, errors)
            },
        );

        assert_eq!(usages.len(), 1);
        assert_eq!(triggers.len(), 1);
        assert_eq!(errors.len(), 1);

        assert_eq!(usages[0].org_id, "test-org");
        assert_eq!(triggers[0]["org"], "test-org");
        assert_eq!(errors[0]["org_id"], "test-org");
    }

    #[tokio::test]
    async fn test_empty_buffered_data() {
        let buffered = [];
        let (usages, triggers, errors) = buffered.into_iter().fold(
            (Vec::new(), Vec::new(), Vec::new()),
            |(mut usages, mut triggers, mut errors), item| {
                match item {
                    ReportingData::Usage(usage) => usages.push(*usage),
                    ReportingData::Trigger(trigger) => {
                        triggers.push(json::to_value(*trigger).unwrap())
                    }
                    ReportingData::Error(error) => errors.push(json::to_value(*error).unwrap()),
                }
                (usages, triggers, errors)
            },
        );

        assert!(usages.is_empty());
        assert!(triggers.is_empty());
        assert!(errors.is_empty());
    }

    #[tokio::test]
    async fn test_mixed_data_types() {
        let usage_data1 = create_test_usage_data();
        let usage_data2 = UsageData {
            org_id: "test-org-2".to_string(),
            ..usage_data1.clone()
        };
        let trigger_data = create_test_trigger_data();
        let error_data = create_test_error_data();

        let buffered = [
            ReportingData::Usage(Box::new(usage_data1)),
            ReportingData::Usage(Box::new(usage_data2)),
            ReportingData::Trigger(Box::new(trigger_data)),
            ReportingData::Error(Box::new(error_data)),
        ];

        let (usages, triggers, errors) = buffered.into_iter().fold(
            (Vec::new(), Vec::new(), Vec::new()),
            |(mut usages, mut triggers, mut errors), item| {
                match item {
                    ReportingData::Usage(usage) => usages.push(*usage),
                    ReportingData::Trigger(trigger) => {
                        triggers.push(json::to_value(*trigger).unwrap())
                    }
                    ReportingData::Error(error) => errors.push(json::to_value(*error).unwrap()),
                }
                (usages, triggers, errors)
            },
        );

        assert_eq!(usages.len(), 2);
        assert_eq!(triggers.len(), 1);
        assert_eq!(errors.len(), 1);

        assert_eq!(usages[0].org_id, "test-org");
        assert_eq!(usages[1].org_id, "test-org-2");
    }
}
