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

use async_channel::{bounded, Receiver, Sender};
use once_cell::sync::Lazy;

use super::{entry::IngestEntry, workers::Workers};

// TODO: change those static to env
static MIN_WORKER_CNT: usize = 3;
static DEFAULT_CHANNEL_CAP: usize = 10;

static TQMANAGER: Lazy<TaskQueueManager> = Lazy::new(TaskQueueManager::new);

type RwMap<K, V> = tokio::sync::RwLock<hashbrown::HashMap<K, V>>;

pub(super) async fn init() -> Result<(), anyhow::Error> {
    _ = TQMANAGER.task_queues.read().await.len();

    // start a background job to clean up TQManager's hash table
    tokio::spawn(async move {
        let interval = tokio::time::Duration::from_secs(600);
        let mut interval = tokio::time::interval(interval);
        interval.tick().await; // the first tick is immediate
        loop {
            TQMANAGER.remove_stopped_task_queues().await;
            interval.tick().await;
        }
    });

    Ok(())
}

pub async fn send_task(stream_name: &str, task: IngestEntry) -> Result<(), anyhow::Error> {
    TQMANAGER.send_task(stream_name, task).await
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

    async fn send_task(&self, stream_name: &str, task: IngestEntry) -> Result<(), anyhow::Error> {
        if !self.task_queue_avail(stream_name).await {
            self.add_task_queue_for(stream_name).await;
        }
        let r = self.task_queues.read().await;
        let tq = r.get(stream_name).unwrap();
        let _ = tq.send_task(task).await;
        Ok(())
    }

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
        let mut w = self.task_queues.write().await;
        for key in keys_to_remove {
            w.remove(&key);
        }
    }

    async fn task_queue_avail(&self, stream_name: &str) -> bool {
        let r = self.task_queues.read().await;
        match r.get(stream_name) {
            Some(tq) => {
                if tq.workers.running_worker_count().await == 0 {
                    tq.workers.add_workers_by(MIN_WORKER_CNT).await;
                }
                true
            }
            None => false,
        }
    }

    async fn add_task_queue_for(&self, stream_name: &str) {
        let tq = TaskQueue::new(DEFAULT_CHANNEL_CAP);
        let mut w = self.task_queues.write().await;
        w.insert(Arc::from(stream_name), tq);
    }
}

struct TaskQueue {
    sender: Arc<Sender<IngestEntry>>,
    receiver: Arc<Receiver<IngestEntry>>,
    workers: Arc<Workers>,
}

impl TaskQueue {
    // TODO: decide default initial workers count for a queue
    pub fn new(channel_cap: usize) -> Self {
        let (sender, receiver) = bounded::<IngestEntry>(channel_cap);
        // let queues = RwMap::default();
        let workers = Arc::new(Workers::new(MIN_WORKER_CNT, Arc::new(receiver.clone())));
        Self {
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            workers,
        }
    }

    // TODO
    // 1. add min worker count to increase the number of workers
    async fn send_task(&self, task: IngestEntry) -> Result<(), anyhow::Error> {
        if self.receiver.is_closed() {
            return Err(anyhow::anyhow!("Channel is closed. BUG"));
        }
        while let Err(e) = self.sender.try_send(task.clone()) {
            println!("channel is full {:?}.", e);
            if self.workers.running_worker_count().await < MIN_WORKER_CNT {
                self.workers.add_workers_by(MIN_WORKER_CNT).await;
            }
        }
        Ok(())
    }

    async fn shut_down(&self) {
        self.sender.close(); // all cloned receivers will shut down in next iteration
        self.workers.shut_down().await;
    }
}
