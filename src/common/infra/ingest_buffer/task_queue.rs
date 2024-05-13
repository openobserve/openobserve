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

/// initial # of workers
static DEFAULT_WORKER_CNT: usize = 3;
/// max # of requests could be held in channel.
static DEFAULT_CHANNEL_CAP: usize = 5; // if channel if full -> init more workers
/// Max acceptable latency between a request is accepted and searchable
static SEARCHABLE_LATENCY: u64 = 60; // request dropped if exceeding this latency
/// A global hash map that maps stream of a TaskQueue instance.
static TASK_QUEUE: Lazy<RwLock<TaskQueue>> = Lazy::new(RwLock::default);

pub(super) async fn init() -> Result<()> {
    _ = TASK_QUEUE.read().await.sender.len();
    Ok(())
}

/// External-facing function to be called by endpoint handlers to send a task
/// into the buffer. Returns `HttpResponse` directly to client.
///
/// 2 scenarios function fails to send a task
/// 1. server memtable overflow -> ServiceUnavailable
/// 2. ingest buffer errors: a. channel closed, or, b. fully loaded and max latency exceeded
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
            update_buffer_size(content_length, true).await;
            HttpResponse::Ok().json("Request buffered. Waiting to be processed")
        }
        Err(e) => HttpResponse::InternalServerError().json(e.to_string()),
    }
}

/// Keeps track of the total ingest buffer size to limit the memory usage.
/// Shared among producer and all consumers, which is managed by a RwLock.
/// Producer increases the buffer size whereas consumers decrease buffer size.
pub async fn update_buffer_size(delta: usize, incr: bool) {
    let mut tq_w = TASK_QUEUE.write().await;
    tq_w.update_size(delta, incr);
}

/// Gracefully terminates all running TaskQueues
pub async fn shut_down() {
    if CONFIG.common.feature_ingest_buffer_enabled
        && (cluster::is_router(&cluster::LOCAL_NODE_ROLE)
            || cluster::is_single_node(&cluster::LOCAL_NODE_ROLE))
    {
        log::info!("Shutting down IngestBuffer");
        let tq = TASK_QUEUE.read().await;
        tq.shut_down().await;
    }
}

/// A multi-producer multi-consumer task queue implemented with
/// async-channel crate to function as IngestBuffer to buffer
/// IngestEntry requests.
///
/// While all accepted tasks are processed in memory, all TaskQueue's
/// workers do persist the tasks they received to disk before processing
/// to avoid data loss if application crashes.
struct TaskQueue {
    sender: Arc<Sender<IngestEntry>>,
    workers: Arc<Workers>,
    current_size: usize,
}

impl Default for TaskQueue {
    fn default() -> Self {
        Self::new()
    }
}

impl TaskQueue {
    pub fn new() -> Self {
        // underlying channel is bounded for reasons
        //  a. avoid unbounded memory usage;
        //  b. ensure tasks are picked up by workers as only then do received tasks get persisted to
        //     disk
        let (sender, receiver) = bounded::<IngestEntry>(DEFAULT_CHANNEL_CAP);
        let workers = Arc::new(Workers::new(DEFAULT_WORKER_CNT, Arc::new(receiver)));
        Self {
            sender: Arc::new(sender),
            workers,
            current_size: 0,
        }
    }

    /// Updates the total size of ingest buffer.
    /// Increased when requests accepted by the buffer and decreased when requests
    /// successfully processed by buffer's worker.
    fn update_size(&mut self, delta: usize, incr: bool) {
        if incr {
            self.current_size += delta
        } else {
            self.current_size -= delta
        }
    }

    /// Sends a task (IngestEntry) into the TaskQueue.
    /// Error if the channel was wrongly closed or max latency exceeded.
    /// Elastically increases the number of consumers (workers) when:
    ///     - no active running workers (workers self shut down when ideal too long)
    ///     - channel is full and all workers are processing.
    async fn send_task(&self, task: IngestEntry) -> Result<()> {
        if self.sender.is_closed() {
            return Err(anyhow::anyhow!("IngestBuffer channel is closed. BUG",));
        }
        if self.should_add_more_workers().await {
            self.workers.add_workers_by(DEFAULT_WORKER_CNT).await;
        }
        // tries to enqueue the task into the channel with `SEARCHABLE_LATENCY` as timeout
        tokio::select! {
            _ = self.sender.send(task) => Ok(()),
            _ = tokio::time::sleep(tokio::time::Duration::from_secs(SEARCHABLE_LATENCY)) => {
                // timed out because channel is full and no additional workers
                // were invoked due to memory constraint
                log::warn!(
                    "IngestBuffer fully loaded & max latency reached. Request rejected.",
                );
                Err(anyhow::anyhow!("Max latency reached. Ingestion request rejected."))
            }
        }
    }

    /// Determines whether the TaskQueue should init more producers (workers).
    /// No if total buffered size already surpasses allowed memory usage.
    /// Otherwise, yes if either channel is currently full or no workers actively running
    async fn should_add_more_workers(&self) -> bool {
        if self.current_size >= CONFIG.limit.ingest_buffer_size {
            log::info!("IngestBuffer channel currently full and reached max workers count. Wait");
            false
        } else if self.sender.capacity().unwrap() - self.sender.len() == 0
            || self.workers.running_worker_count().await == 0
        {
            log::info!("IngestBuffer adding more workers");
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
