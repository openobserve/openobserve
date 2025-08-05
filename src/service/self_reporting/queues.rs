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
            error::ErrorData,
            usage::{ERROR_STREAM, TRIGGERS_USAGE_STREAM, TriggerData},
        },
        stream::{StreamParams, StreamType},
    },
    utils::json,
};
use once_cell::sync::Lazy;
use tokio::{
    sync::{Mutex, mpsc},
    time,
};

pub(super) static USAGE_QUEUE: Lazy<Arc<ReportingQueue>> =
    Lazy::new(|| Arc::new(initialize_usage_queue()));

pub(super) static ERROR_QUEUE: Lazy<Arc<ReportingQueue>> =
    Lazy::new(|| Arc::new(initialize_error_queue()));

fn initialize_usage_queue() -> ReportingQueue {
    let cfg = get_config();
    let timeout = time::Duration::from_secs(
        cfg.common
            .usage_publish_interval
            .try_into()
            .expect("Env ZO_USAGE_PUBLISH_INTERVAL invalid format. Should be set as integer"),
    );
    let batch_size = cfg.common.usage_batch_size;

    let (msg_sender, msg_receiver) = mpsc::channel::<ReportingMessage>(
        batch_size * std::cmp::max(2, cfg.limit.usage_reporting_thread_num),
    );
    let msg_receiver = Arc::new(Mutex::new(msg_receiver));

    for thread_id in 0..cfg.limit.usage_reporting_thread_num {
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

fn initialize_error_queue() -> ReportingQueue {
    let cfg = get_config();
    let timeout = time::Duration::from_secs(
        cfg.common
            .usage_publish_interval
            .try_into()
            .expect("Env ZO_USAGE_PUBLISH_INTERVAL invalid format. Should be set as integer"),
    );
    let batch_size = cfg.common.usage_batch_size;

    let (msg_sender, msg_receiver) = mpsc::channel::<ReportingMessage>(
        batch_size * std::cmp::max(2, cfg.limit.usage_reporting_thread_num),
    );
    let msg_receiver = Arc::new(Mutex::new(msg_receiver));

    for thread_id in 0..cfg.limit.usage_reporting_thread_num {
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
                            ingest_buffered_data(thread_id, buffered).await;
                        }
                        res_sender.send(()).ok();
                        break;
                    }
                    Some(ReportingMessage::Data(reporting_data)) => {
                        reporting_runner.push(reporting_data);
                        if reporting_runner.should_process() {
                            let buffered = reporting_runner.take_batch();
                            ingest_buffered_data(thread_id, buffered).await;
                        }
                    }
                    None => break, // channel closed
                }
            }
            _ = interval.tick() => {
                if reporting_runner.should_process() {
                    let buffered = reporting_runner.take_batch();
                    ingest_buffered_data(thread_id, buffered).await;
                }
            }
        }
    }
}

async fn ingest_buffered_data(thread_id: usize, buffered: Vec<ReportingData>) {
    log::debug!(
        "[SELF-REPORTING] thread_{thread_id} ingests {} buffered data",
        buffered.len()
    );

    let (usages, triggers, errors) = buffered.into_iter().fold(
        (Vec::new(), Vec::new(), Vec::new()),
        |(mut usages, mut triggers, mut errors), item| {
            match item {
                ReportingData::Usage(usage) => usages.push(*usage),
                ReportingData::Trigger(trigger) => triggers.push(json::to_value(*trigger).unwrap()),
                ReportingData::Error(error) => errors.push(json::to_value(*error).unwrap()),
            }
            (usages, triggers, errors)
        },
    );

    let cfg = get_config();

    if !usages.is_empty() {
        super::ingestion::ingest_usages(usages).await;
    }

    if !triggers.is_empty() {
        let mut additional_reporting_orgs = if !cfg.common.additional_reporting_orgs.is_empty() {
            cfg.common.additional_reporting_orgs.split(",").collect()
        } else {
            Vec::new()
        };
        additional_reporting_orgs.push(META_ORG_ID);
        additional_reporting_orgs.dedup();

        let mut enqueued_on_failure = false;

        for org in additional_reporting_orgs {
            let trigger_stream = StreamParams::new(org, TRIGGERS_USAGE_STREAM, StreamType::Logs);

            if super::ingestion::ingest_reporting_data(triggers.clone(), trigger_stream)
                .await
                .is_err()
                && &cfg.common.usage_reporting_mode != "both"
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

    if !errors.is_empty() {
        let error_stream = StreamParams::new(META_ORG_ID, ERROR_STREAM, StreamType::Logs);
        if super::ingestion::ingest_reporting_data(errors.clone(), error_stream)
            .await
            .is_err()
            && &cfg.common.usage_reporting_mode != "both"
        {
            // on error in ingesting usage data, push back the data
            for error_json in errors {
                let error: ErrorData = json::from_value(error_json).unwrap();
                if let Err(e) = ERROR_QUEUE
                    .enqueue(ReportingData::Error(Box::new(error)))
                    .await
                {
                    log::error!(
                        "[SELF-REPORTING] Error in pushing back un-ingested ErrorData to ErrorQueue: {e}"
                    );
                }
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
