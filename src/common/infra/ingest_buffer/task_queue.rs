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

use anyhow::{Context, Result};
use async_channel::{bounded, Sender};
use once_cell::sync::Lazy;

use super::{entry::IngestEntry, workers::Workers};

type RwMap<K, V> = tokio::sync::RwLock<hashbrown::HashMap<K, V>>;

// TODO: change those static to env
static MIN_WORKER_CNT: usize = 3;
static DEFAULT_CHANNEL_CAP: usize = 10;
static MANAGER_CLEANUP_INTERVAL: u64 = 600;

/// A global hash map that maps stream of a TaskQueue instsance.
static TQMANAGER: Lazy<TaskQueueManager> = Lazy::new(TaskQueueManager::new);

pub(super) async fn init() -> Result<(), anyhow::Error> {
    _ = TQMANAGER.task_queues.read().await.len();

    // start a background job to clean up TQManager's hash map
    tokio::spawn(async move {
        let interval = tokio::time::Duration::from_secs(MANAGER_CLEANUP_INTERVAL);
        let mut interval = tokio::time::interval(interval);
        interval.tick().await; // the first tick is immediate
        loop {
            TQMANAGER.remove_stopped_task_queues().await;
            interval.tick().await;
        }
    });

    Ok(())
}

/// Sends a task to a TaskQueue based on stream name. To be called by server api endpoitns.
pub async fn send_task(stream_name: &str, task: IngestEntry) -> Result<()> {
    TQMANAGER.send_task(stream_name, task).await
}

/// Gracefully terminates all running TaskQueues
pub async fn shut_down() {
    TQMANAGER.terminal_all().await;
}

struct TaskQueueManager {
    task_queues: RwMap<Arc<str>, TaskQueue>, // key: stream, val: TaskQueue
}

impl TaskQueueManager {
    fn new() -> Self {
        Self {
            task_queues: RwMap::default(),
        }
    }

    /// Finds or creates a new TaskQueue to send an IngestEntry.
    async fn send_task(&self, stream_name: &str, task: IngestEntry) -> Result<()> {
        if !self.task_queue_avail(stream_name).await {
            self.add_task_queue_for(stream_name).await;
        }
        let r = self.task_queues.read().await;
        let tq = r
            .get(stream_name)
            .context("Failed to find TaskQueue. BUG")?;
        tq.send_task(task).await
    }

    /// Called by TaskManager's background task periodically to remove the entires
    /// where a TaskQueue's consumer side is already terminated.
    async fn remove_stopped_task_queues(&self) {
        let mut keys_to_remove = vec![];
        {
            let r = self.task_queues.read().await;
            for (k, v) in r.iter() {
                if v.workers.running_worker_count().await == 0 {
                    keys_to_remove.push(k.clone());
                }
            }
        }
        if !keys_to_remove.is_empty() {
            let mut w = self.task_queues.write().await;
            for key in keys_to_remove {
                w.remove(&key);
            }
        }
    }

    /// First checks if a TaskQueue instance exists for given stream_name;
    /// Second, if exists, ensures TaskQueue has at least MIN_WORKER_CNT running workers.
    async fn task_queue_avail(&self, stream_name: &str) -> bool {
        let r = self.task_queues.read().await;
        match r.get(stream_name) {
            Some(tq) => {
                let curr_running_cnt = tq.workers.running_worker_count().await;
                if curr_running_cnt < MIN_WORKER_CNT {
                    tq.workers
                        .add_workers_by(MIN_WORKER_CNT - curr_running_cnt)
                        .await;
                }
                true
            }
            None => false,
        }
    }

    /// Inits a new TaskQueue for stream_name.
    async fn add_task_queue_for(&self, stream_name: &str) {
        let tq = TaskQueue::new(DEFAULT_CHANNEL_CAP, stream_name);
        let mut w = self.task_queues.write().await;
        w.insert(Arc::from(stream_name), tq);
    }

    async fn terminal_all(&self) {
        let mut r = self.task_queues.write().await;
        for tq in r.values() {
            tq.shut_down().await;
        }
        _ = r.drain();
    }
}

struct TaskQueue {
    sender: Arc<Sender<IngestEntry>>,
    workers: Arc<Workers>,
}

impl TaskQueue {
    pub fn new(channel_cap: usize, stream_name: &str) -> Self {
        let (sender, receiver) = bounded::<IngestEntry>(channel_cap);
        let workers = Arc::new(Workers::new(
            MIN_WORKER_CNT,
            stream_name,
            Arc::new(receiver),
        ));
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
                "Stream({}) channel is closed. BUG",
                self.workers.stream_name
            ));
        }
        while let Err(e) = self.sender.try_send(task.clone()) {
            log::info!(
                "Stream({}) channel currently full {:?}. Increase worker count",
                self.workers.stream_name,
                e
            );
            self.workers.add_workers_by(MIN_WORKER_CNT).await;
        }
        Ok(())
    }

    async fn shut_down(&self) {
        self.sender.close(); // all cloned receivers will shut down in next iteration
        self.workers.shut_down().await;
    }
}
