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

use config::{
    get_config,
    meta::usage::{TriggerData, UsageData},
};
use once_cell::sync::Lazy;
use tokio::{
    sync::{mpsc, oneshot, Mutex},
    time,
};

pub(super) static USAGE_QUEUER: Lazy<Arc<UsageQueuer>> =
    Lazy::new(|| Arc::new(initialize_usage_queuer()));

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

#[derive(Debug)]
pub(super) struct UsageQueuer {
    pub(super) msg_sender: mpsc::Sender<UsageMessage>,
}

impl UsageQueuer {
    pub(super) fn new(msg_sender: mpsc::Sender<UsageMessage>) -> Self {
        Self { msg_sender }
    }

    pub(super) async fn enqueue(
        &self,
        usage_buf: Vec<UsageBuffer>,
    ) -> Result<(), mpsc::error::SendError<UsageMessage>> {
        self.msg_sender.send(UsageMessage::Data(usage_buf)).await
    }

    pub(super) async fn shutdown(
        &self,
        res_sender: oneshot::Sender<()>,
    ) -> Result<(), mpsc::error::SendError<UsageMessage>> {
        self.msg_sender
            .send(UsageMessage::Shutdown(res_sender))
            .await
    }
}

#[derive(Debug)]
pub(super) enum UsageMessage {
    Data(Vec<UsageBuffer>),
    Shutdown(oneshot::Sender<()>),
    Ping(oneshot::Sender<()>),
}

#[derive(Debug)]
pub(super) enum UsageBuffer {
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
        super::ingestion::ingest_usages(usage_data).await;
    }
    if !trigger_data.is_empty() {
        super::ingestion::ingest_trigger_usages(trigger_data).await;
    }
}
