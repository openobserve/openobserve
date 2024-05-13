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
    _ = TASK_QUEUE.read().await.sender.len();
    Ok(())
}

/// Sends a task to a TaskQueue based on stream name. To be called by server api endpoitns.
pub async fn send_task(task: IngestEntry) -> HttpResponse {
    // check memtable
    if let Err(e) = ingester::check_memtable_size() {
        return HttpResponse::ServiceUnavailable().json(e.to_string());
    }
    let content_length = task.content_length;
    let tq_r = TASK_QUEUE.read().await;
    match tq_r.send_task(task).await {
        Ok(_) => {
            drop(tq_r);
            update_size(content_length, true).await;
            HttpResponse::Ok().json("Request buffered. Waiting to be processed")
        }
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

pub async fn update_size(delta: usize, incr: bool) {
    let mut tq_w = TASK_QUEUE.write().await;
    tq_w.update_size(delta, incr);
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
    size: usize,
}

impl Default for TaskQueue {
    fn default() -> Self {
        Self::new(0)
    }
}

impl TaskQueue {
    pub fn new(tq_index: usize) -> Self {
        let (sender, receiver) = bounded::<IngestEntry>(DEFAULT_CHANNEL_CAP);
        let workers = Arc::new(Workers::new(MIN_WORKER_CNT, tq_index, Arc::new(receiver)));
        Self {
            sender: Arc::new(sender),
            workers,
            size: 0,
        }
    }

    fn update_size(&mut self, delta: usize, incr: bool) {
        if incr {
            self.size += delta
        } else {
            self.size -= delta
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
        if self.should_add_more_workers().await {
            self.workers.add_workers_by(MIN_WORKER_CNT).await;
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

    async fn should_add_more_workers(&self) -> bool {
        if self.size >= CONFIG.limit.ingest_buffer_size {
            log::info!("IngestBuffer channel currently full and reached max workers count. Wait");
            false
        } else if self.sender.capacity().unwrap() - self.sender.len() == 0
            || self.workers.running_worker_count().await == 0
        {
            log::info!("IngestBuffer channel currently full. Added more workers");
            true
        } else {
            false
        }
    }

    async fn shut_down(&self) {
        self.sender.close(); // all cloned receivers will shut down in next iteration
        self.workers.shut_down().await;
    }
}
