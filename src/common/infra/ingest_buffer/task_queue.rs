// Copyright 2023 Zinc Labs Inc.
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

pub static TASKQUEUE: Lazy<TaskQueue> = Lazy::new(TaskQueue::new);

pub type RwMap<K, V> = tokio::sync::RwLock<hashbrown::HashMap<K, V>>;

pub struct TaskQueue {
    pub sender: Arc<Sender<IngestEntry>>,
    pub receiver: Arc<Receiver<IngestEntry>>,
    pub queues: RwMap<Arc<str>, Workers>, // key: stream, val: workers
}

pub async fn init() -> Result<(), anyhow::Error> {
    _ = TASKQUEUE.queues.read().await.len();
    Ok(())
}

pub async fn send_task(stream_name: &str, task: IngestEntry) -> Result<(), anyhow::Error> {
    TASKQUEUE.send_task(stream_name, task).await
}

impl TaskQueue {
    pub fn new() -> Self {
        // TODO: set default channel cap
        let queue_cap = 10;
        let (sender, receiver) = bounded::<IngestEntry>(queue_cap);
        let queues = RwMap::default();
        Self {
            sender: Arc::new(sender),
            receiver: Arc::new(receiver),
            queues,
        }
    }

    // TODO
    // 1. add logic to increase # of workers for a queue or increase the channel capacity
    // 2. send status back. (??: public endpoint needs to respond IngestionResponse)
    pub async fn send_task(
        &self,
        stream_name: &str,
        task: IngestEntry,
    ) -> Result<(), anyhow::Error> {
        if self.receiver.is_closed() {
            return Err(anyhow::anyhow!("Channel is closed. BUG"));
        }
        if !self.queue_exists_for(stream_name).await {
            let mut r = self.queues.write().await;
            let workers = Workers::new(Arc::clone(&self.receiver));
            r.insert(Arc::from(stream_name), workers);
        }

        let mut delay_secs = 1;
        while let Err(e) = self.sender.try_send(task.clone()) {
            println!("channel is full {:?}. delay for now, TODO to add", e);
            tokio::time::sleep(tokio::time::Duration::from_secs(delay_secs)).await;
            delay_secs *= 2;
            if delay_secs > 10 {
                // waiting too long, not enough workers to take tasks out of the channel
                // increase worker count for this stream
                self.increase_workers_for(stream_name).await;
            }
        }
        Ok(())
    }

    // TODO: change the static incremental number
    pub async fn increase_workers_for(&self, stream_name: &str) {
        let mut rw = self.queues.write().await;
        rw.entry(Arc::from(stream_name)).and_modify(|workers| {
            workers.add_workers_by(5);
        });
    }

    pub async fn shut_down(&self) {
        let mut r = self.queues.write().await;
        let _: Vec<_> = r
            .values_mut()
            .map(|w| async { w.shut_down().await })
            .collect();
        self.sender.close(); // all cloned receivers will shut down in next iteration
    }

    async fn queue_exists_for(&self, stream_name: &str) -> bool {
        let r = self.queues.read().await;
        r.contains_key(stream_name)
    }
}
