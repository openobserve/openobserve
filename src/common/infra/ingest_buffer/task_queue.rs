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

use actix_web::HttpResponse;
use anyhow::Result;
use async_channel::{bounded, Sender};
use config::{cluster, CONFIG};
use once_cell::sync::Lazy;
use tokio::sync::RwLock;

use super::{entry::IngestEntry, workers::Workers};

// REVIEW: static ok or env variables?
/// initial # of workers
static MIN_WORKER_CNT: usize = 3;
/// max # of requests could be held in channel.
static DEFAULT_CHANNEL_CAP: usize = 5; // if channel if full -> init more workers
/// Max acceptable latency between a request is accepted and searchable
static SEARCHABLE_LATENCY: u64 = 60;
/// A global hash map that maps stream of a TaskQueue instance.
static TASK_QUEUE: Lazy<RwLock<TaskQueue>> = Lazy::new(RwLock::default);

pub(super) async fn init() -> Result<()> {
    // _ = TQ_MANAGER.read().await.task_queues.len();
    _ = TASK_QUEUE.read().await.channel_is_full();
    Ok(())
}

/// Sends a task to a TaskQueue based on stream name. To be called by server api endpoitns.
pub async fn send_task(task: IngestEntry) -> HttpResponse {
    // check memtable
    if let Err(e) = ingester::check_memtable_size() {
        return HttpResponse::ServiceUnavailable().json(e.to_string());
    }
    let tq = TASK_QUEUE.read().await;
    match tq.send_task(task).await {
        Ok(_) => HttpResponse::Ok().json("Request buffered. Waiting to be processed"),
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

/// Gracefully terminates all running TaskQueues
pub async fn shut_down() {
    if CONFIG.common.feature_ingest_buffer_enabled
        && (cluster::is_router(&cluster::LOCAL_NODE_ROLE)
            || cluster::is_single_node(&cluster::LOCAL_NODE_ROLE))
    {
        log::info!("Shutting down TaskQueueManager");
        let tq = TASK_QUEUE.read().await;
        tq.shut_down().await;
    }
}

struct TaskQueue {
    sender: Arc<Sender<IngestEntry>>,
    workers: Arc<Workers>,
    max_workers_cnt: usize,
}

impl Default for TaskQueue {
    fn default() -> Self {
        Self::new(0)
    }
}

impl TaskQueue {
    pub fn new(tq_index: usize) -> Self {
        let estimated_ingest_entry_size = if CONFIG.limit.ingest_buffer_threshold != 0 {
            CONFIG.limit.ingest_buffer_threshold
        } else {
            5 * 1024 * 1024 // 5mb
        };
        let max_workers_cnt = (CONFIG.limit.ingest_buffer_size
            / (DEFAULT_CHANNEL_CAP * estimated_ingest_entry_size))
            - 1; // channel takes 1, the rest is workers
        let (sender, receiver) = bounded::<IngestEntry>(DEFAULT_CHANNEL_CAP);
        let workers = Arc::new(Workers::new(MIN_WORKER_CNT, tq_index, Arc::new(receiver)));
        Self {
            sender: Arc::new(sender),
            workers,
            max_workers_cnt,
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
        if self.channel_is_full() || self.workers.running_worker_count().await == 0 {
            let added_worker_count = self
                .workers
                .add_workers_by(MIN_WORKER_CNT, self.max_workers_cnt)
                .await;
            if added_worker_count > 0 {
                log::info!(
                    "IngestBuffer channel currently full. Added {added_worker_count} workers"
                );
            } else {
                log::info!(
                    "IngestBuffer channel currently full and reached max workers count. Wait"
                );
            }
        }
        tokio::select! {
            _ = self.sender.send(task) => Ok(()),
            _ = tokio::time::sleep(tokio::time::Duration::from_secs(SEARCHABLE_LATENCY)) => {
                log::warn!(
                    "TaskQueue({}) fully loaded & max latency reached. Request rejected.",
                    self.workers.tq_index,
                );
                Err(anyhow::anyhow!("Max latency reached. Ingest request rejected."))
            }
        }
    }

    fn channel_is_full(&self) -> bool {
        self.sender.capacity().unwrap() - self.sender.len() == 0
    }

    async fn shut_down(&self) {
        self.sender.close(); // all cloned receivers will shut down in next iteration
        self.workers.shut_down().await;
    }
}
