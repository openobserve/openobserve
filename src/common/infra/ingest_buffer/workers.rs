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

use async_channel::Receiver;
use config::ider;
use futures::future::join_all;
use tokio::{sync::RwLock, task::JoinHandle};

use super::{entry::IngestEntry, queue_store::persist_tasks};

type RwVec<T> = RwLock<Vec<T>>;
type Worker = JoinHandle<()>;

// TODO: clean up temp static
static PERSIST_INTERVAL: u64 = 600;

// HELP: is the RwLock on the workers necessary
// only 1 global TaskQueueManager which is already RwLock'd
//
pub(super) struct Workers {
    pub receiver: Arc<Receiver<IngestEntry>>,
    pub handles: RwVec<Worker>,
}

impl Workers {
    pub fn new(count: usize, receiver: Arc<Receiver<IngestEntry>>) -> Self {
        let mut handles = Vec::with_capacity(count);
        for _ in 0..count {
            let worker = init_worker(Arc::clone(&receiver));
            handles.push(worker);
        }
        Self {
            receiver,
            handles: RwVec::from(handles),
        }
    }

    pub async fn add_workers_by(&self, count: usize) {
        let mut rw = self.handles.write().await;
        let curr_cnt = rw.len();
        for _ in curr_cnt..curr_cnt + count {
            let handle = init_worker(Arc::clone(&self.receiver));
            rw.push(handle);
        }
    }

    pub async fn running_worker_count(&self) -> usize {
        let mut rw = self.handles.write().await;
        rw.retain(|handle| !handle.is_finished());
        rw.shrink_to_fit();
        rw.len()
    }

    // TODO: handle join errors
    pub async fn shut_down(&self) {
        let mut rw = self.handles.write().await;
        let _join_res = join_all(rw.drain(..)).await;
    }
}

struct PendingTasks {
    closed: bool,
    tasks: Vec<IngestEntry>,
}

impl Default for PendingTasks {
    fn default() -> Self {
        Self {
            closed: false,
            tasks: Vec::new(),
        }
    }
}

fn init_worker(receiver: Arc<Receiver<IngestEntry>>) -> Worker {
    let handle = tokio::spawn(async move {
        let id = ider::generate();
        println!("Worker {id} starting");
        let shared_pending_tasks: Arc<RwLock<PendingTasks>> = Arc::new(RwLock::default());
        // start a new tasks to disk every x minuts
        let persist_job = tokio::spawn(persist_with_interval(
            shared_pending_tasks.clone(),
            PERSIST_INTERVAL,
        ));
        // main task - receive/process tasks
        let _ = process_tasks(id, receiver, shared_pending_tasks.clone()).await;
        // Worker shut donw. No need to wait for persist job anymore.
        persist_job.abort();
        // Maybe clean up file dir;
    });
    handle
}

// TODO: add default delay between each pull
// TODO: define max idle time before shutting down a worker
// TODO: handle errors
async fn process_tasks(
    id: String,
    receiver: Arc<Receiver<IngestEntry>>,
    pending_tasks: Arc<RwLock<PendingTasks>>,
) -> Result<(), anyhow::Error> {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
    let mut time = std::time::Instant::now();
    let max_idle_time = 600.0;

    loop {
        if receiver.is_closed() {
            break;
        }

        let mut w = pending_tasks.write().await;
        while let Ok(req) = receiver.try_recv() {
            w.tasks.push(req)
        }

        if !w.tasks.is_empty() {
            time = std::time::Instant::now();
            println!(
                "receiver {id} received and ingesting {} request.",
                receiver.len()
            );
            w.tasks = process_tasks_with_retries(&w.tasks).await;
        } else if time.elapsed().as_secs_f64() > max_idle_time {
            println!("worker {id} idle too long, shutting down");
            w.closed = true;
            drop(w);
            break;
        }
        drop(w);
        interval.tick().await;
    }
    drop(receiver);
    Ok(())
}

async fn process_tasks_with_retries(tasks: &Vec<IngestEntry>) -> Vec<IngestEntry> {
    let mut failed_tasks = vec![];
    for task in tasks {
        match task.ingest().await {
            Ok(_) => println!("successfully ingested this task"),
            Err(e) => {
                println!("failed to ingest. will try again {:?}", e);
                failed_tasks.push(task.clone());
            }
        }
    }
    failed_tasks
}

async fn persist_with_interval(pending_tasks: Arc<RwLock<PendingTasks>>, interval: u64) {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(interval));
    interval.tick().await;
    loop {
        let r = pending_tasks.read().await;
        if r.closed {
            // maybe clean up files asscoaited with this worker
            println!("worker is shutting down. no more persisting");
            break;
        } else if !r.tasks.is_empty() {
            // invoke a writer and write all the tasks to disk
            let _ = persist_tasks("stream_name", "worker_id", &r.tasks);
        }
        drop(r);
        interval.tick().await;
    }
}
