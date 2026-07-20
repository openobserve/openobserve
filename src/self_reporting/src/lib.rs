// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use std::sync::Arc;

use async_trait::async_trait;
use config::meta::self_reporting::{
    ReportingData, ReportingMessage, ReportingQueue, ReportingRunner,
};
use tokio::{
    sync::{Mutex, mpsc},
    time::{self, Duration},
};

/// Persistence boundary for batches produced by the self-reporting queue.
///
/// Implementations live in integration crates so queue processing does not
/// depend on ingestion, schema, or database services.
#[async_trait]
pub trait BatchSink: Send + Sync + 'static {
    async fn write(&self, worker_id: usize, batch: Vec<ReportingData>);
}

/// Creates a bounded reporting queue and starts its batch workers.
pub fn create_reporting_queue(
    publish_interval: u64,
    batch_size: usize,
    worker_count: usize,
    sink: Arc<dyn BatchSink>,
) -> ReportingQueue {
    let timeout = Duration::from_secs(publish_interval);
    let channel_capacity = batch_size * std::cmp::max(2, worker_count);
    let (msg_sender, msg_receiver) = mpsc::channel::<ReportingMessage>(channel_capacity);
    let msg_receiver = Arc::new(Mutex::new(msg_receiver));

    for worker_id in 0..worker_count {
        tokio::task::spawn(run_worker(
            worker_id,
            Arc::clone(&msg_receiver),
            batch_size,
            timeout,
            Arc::clone(&sink),
        ));
    }

    ReportingQueue::new(msg_sender)
}

async fn run_worker(
    worker_id: usize,
    msg_receiver: Arc<Mutex<mpsc::Receiver<ReportingMessage>>>,
    batch_size: usize,
    timeout: Duration,
    sink: Arc<dyn BatchSink>,
) {
    log::debug!("[SELF-REPORTING] worker_{worker_id} starts waiting for reporting messages");
    let mut reporting_runner = ReportingRunner::new(batch_size, timeout);
    let mut interval = time::interval(timeout);

    loop {
        let mut msg_receiver = msg_receiver.lock().await;
        tokio::select! {
            msg = msg_receiver.recv() => {
                match msg {
                    Some(ReportingMessage::Start(start_sender)) => {
                        log::debug!("[SELF-REPORTING] worker_{worker_id} received starting ping");
                        start_sender.send(()).ok();
                    }
                    Some(ReportingMessage::Shutdown(res_sender)) => {
                        log::debug!("[SELF-REPORTING] worker_{worker_id} received shutdown ping");
                        flush(worker_id, &mut reporting_runner, sink.as_ref()).await;
                        res_sender.send(()).ok();
                        break;
                    }
                    Some(ReportingMessage::Data(reporting_data)) => {
                        reporting_runner.push(reporting_data);
                        update_queue_depth_metric_for_runner(&reporting_runner);
                        if reporting_runner.should_process() {
                            flush(worker_id, &mut reporting_runner, sink.as_ref()).await;
                        }
                    }
                    None => break,
                }
            }
            _ = interval.tick() => {
                if reporting_runner.should_process() {
                    flush(worker_id, &mut reporting_runner, sink.as_ref()).await;
                }
            }
        }
    }
}

async fn flush(worker_id: usize, runner: &mut ReportingRunner, sink: &dyn BatchSink) {
    if runner.pending.is_empty() {
        return;
    }

    let batch = runner.take_batch();
    update_queue_depth_metrics(&batch);
    sink.write(worker_id, batch).await;
}

fn update_queue_depth_metric_for_runner(runner: &ReportingRunner) {
    let (usage_count, error_count) = count_data_types(&runner.pending);
    config::metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["usage"])
        .set(usage_count);
    config::metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["error"])
        .set(error_count);
}

fn update_queue_depth_metrics(batch: &[ReportingData]) {
    let (usage_count, error_count) = count_data_types(batch);
    config::metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["usage"])
        .sub(usage_count);
    config::metrics::SELF_REPORTING_QUEUE_DEPTH
        .with_label_values(&["error"])
        .sub(error_count);
}

fn count_data_types(batch: &[ReportingData]) -> (i64, i64) {
    batch
        .iter()
        .fold((0, 0), |(usage, error), data| match data {
            ReportingData::Usage(_) | ReportingData::Trigger(_) => (usage + 1, error),
            ReportingData::Error(_) => (usage, error + 1),
        })
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use config::meta::self_reporting::{
        ReportingData,
        usage::{TriggerData, TriggerDataStatus, TriggerDataType},
    };
    use tokio::sync::oneshot;

    use super::*;

    struct CountingSink(AtomicUsize);

    #[async_trait]
    impl BatchSink for CountingSink {
        async fn write(&self, _worker_id: usize, batch: Vec<ReportingData>) {
            self.0.fetch_add(batch.len(), Ordering::SeqCst);
        }
    }

    fn trigger() -> ReportingData {
        ReportingData::Trigger(Box::new(TriggerData {
            _timestamp: 1,
            org: "test-org".to_string(),
            module: TriggerDataType::Report,
            key: "test-key".to_string(),
            next_run_at: 1,
            is_realtime: false,
            is_silenced: false,
            status: TriggerDataStatus::Completed,
            start_time: 1,
            end_time: 1,
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
        }))
    }

    #[tokio::test]
    async fn flushes_pending_data_through_sink_on_shutdown() {
        let sink = Arc::new(CountingSink(AtomicUsize::new(0)));
        let queue = create_reporting_queue(60, 10, 1, sink.clone());
        queue.enqueue(trigger()).await.unwrap();

        let (shutdown_sender, shutdown_receiver) = oneshot::channel();
        queue.shutdown(shutdown_sender).await.unwrap();
        shutdown_receiver.await.unwrap();

        assert_eq!(sink.0.load(Ordering::SeqCst), 1);
    }
}
