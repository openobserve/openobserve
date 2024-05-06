// Copyright 2024 Zinc Labs Inc.
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

use anyhow::Result;
use async_channel::{bounded, Sender};
use config::CONFIG;
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

use super::{entry::IngestEntry, workers::Workers};

// REVIEW: static ok or env variables?
/// initial # of workers
static MIN_WORKER_CNT: usize = 3;
/// max # of requests could be held in channel.
static DEFAULT_CHANNEL_CAP: usize = 10; // if channel if full -> init more workers

/// A global hash map that maps stream of a TaskQueue instance.
static TQ_MANAGER: Lazy<RwLock<TaskQueueManager>> = Lazy::new(RwLock::default);

pub(super) async fn init() -> Result<()> {
    _ = TQ_MANAGER.read().await.task_queues.len();
    Ok(())
}

/// Sends a task to a TaskQueue based on stream name. To be called by server api endpoitns.
pub async fn send_task(task: IngestEntry) -> Result<()> {
    let mut w = TQ_MANAGER.write().await;
    w.send_task(task).await
}

/// Gracefully terminates all running TaskQueues
pub async fn shut_down() {
    log::info!("Shutting down TaskQueueManager");
    let mut w = TQ_MANAGER.write().await;
    w.terminal_all().await;
}

struct TaskQueueManager {
    round_robin_idx: usize,
    task_queues: Vec<TaskQueue>,
}

impl Default for TaskQueueManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskQueueManager {
    fn new() -> Self {
        let mut task_queues = Vec::with_capacity(CONFIG.limit.ingest_buffer_queue_num);
        for idx in 0..CONFIG.limit.ingest_buffer_queue_num {
            task_queues.push(TaskQueue::new(DEFAULT_CHANNEL_CAP, idx));
        }
        Self {
            round_robin_idx: 0,
            task_queues,
        }
    }

    async fn send_task(&mut self, task: IngestEntry) -> Result<()> {
        let tq = self.find_tq_or_add_workers().await?;
        tq.send_task(task).await
    }

    /// Finds the first TaskQueue whose channel is not currently full.
    /// If all TaskQueues are busy, add more workers to a TaskQueue.
    /// If all TaskQueues have reached max number of workers allowed, try again.
    async fn find_tq_or_add_workers(&mut self) -> Result<&TaskQueue> {
        let mut tq = None;
        while tq.is_none() {
            tq = match self.task_queues[self.round_robin_idx..]
                .iter()
                .chain(self.task_queues[..self.round_robin_idx].iter())
                .find(|tq| !tq.channel_is_full())
            {
                Some(tq) => {
                    if tq.workers.running_worker_count().await == 0 {
                        tq.workers.add_workers_by(MIN_WORKER_CNT).await;
                    }
                    Some(tq)
                }
                None => {
                    let Some(tq) = self.task_queues.get(self.round_robin_idx) else {
                        return Err(anyhow::anyhow!(
                            "TaskQueueManager not able to find TaskQueue."
                        ));
                    };
                    log::info!("All TaskQueue is full. Add workers or try again");
                    // Try add more workers
                    let added_worker_count = tq.workers.add_workers_by(MIN_WORKER_CNT).await;
                    // HACK: sleep half a sec to allow worker to pick up to avoid init more workers
                    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                    if added_worker_count > 0 {
                        log::info!(
                            "TaskQueue({}) channel added {} new workers",
                            self.round_robin_idx,
                            added_worker_count
                        );
                        Some(tq)
                    } else {
                        //
                        log::warn!(
                            "All TaskQueue busy with max number of workers allowed. Try finding again.",
                        );
                        None
                    }
                }
            };
            self.round_robin_idx = (self.round_robin_idx + 1) % self.task_queues.len();
        }
        let tq = tq.unwrap();
        Ok(tq)
    }

    async fn terminal_all(&mut self) {
        for tq in self.task_queues.drain(..) {
            tq.shut_down().await;
        }
    }
}

struct TaskQueue {
    sender: Arc<Sender<IngestEntry>>,
    workers: Arc<Workers>,
}

impl TaskQueue {
    pub fn new(channel_cap: usize, tq_index: usize) -> Self {
        let (sender, receiver) = bounded::<IngestEntry>(channel_cap);
        let workers = Arc::new(Workers::new(MIN_WORKER_CNT, tq_index, Arc::new(receiver)));
        Self {
            sender: Arc::new(sender),
            workers,
        }
    }

    /// Sends an IngestEntry into the TaskQueue.
    /// Error if the channel was wrongly closed.
    /// Increase the worker count if channel is full.
    async fn send_task(&self, task: IngestEntry) -> Result<()> {
        if self.sender.is_closed() {
            return Err(anyhow::anyhow!(
                "TaskQueue({}) channel is closed. BUG",
                self.workers.tq_index
            ));
        }
        let mut exponential_delay = tokio::time::Duration::from_millis(500);
        while self.sender.try_send(task.clone()).is_err() {
            log::info!(
                "TaskQueue({}) waits {}/s",
                self.workers.tq_index,
                exponential_delay.as_secs()
            );
            tokio::time::sleep(exponential_delay).await;
            exponential_delay *= 2; // Exponential backoff
        }
        Ok(())
    }

    fn channel_is_full(&self) -> bool {
        self.sender.capacity().unwrap() - self.sender.len() == 0
    }

    async fn shut_down(&self) {
        self.sender.close(); // all cloned receivers will shut down in next iteration
        self.workers.shut_down().await;
    }
}
