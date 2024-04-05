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

use std::{fs::remove_file, sync::Arc};

use async_channel::{bounded, Receiver, RecvError, Sender};
use config::ider;
use futures::future::join_all;
use tokio::{sync::RwLock, task::JoinHandle};

use super::{
    entry::IngestEntry,
    queue_store::{build_file_path, persist_tasks},
};

type RwVec<T> = RwLock<Vec<T>>;
type Worker = JoinHandle<()>;

// TODO: clean up temp static
static WORKER_MAX_IDLE: f64 = 600.0;

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

// TODO: improvement
// add an env variable to adjust persisting strategy
// 1. No data loss -> persist and process linearly
// 2. lossy -> async tasks and only persist one a while
fn init_worker(receiver: Arc<Receiver<IngestEntry>>) -> Worker {
    let handle = tokio::spawn(async move {
        let id = ider::generate();
        println!("Worker {id} starting");
        // let (store_sig_s, store_sig_r) = mpsc::channel::<Vec<IngestEntry>>(1);
        let (store_sig_s, store_sig_r) = bounded::<Vec<IngestEntry>>(1);
        // start a new task to disk every x minuts
        let persist_job = tokio::spawn(persist_with_interval(
            "stream_name",
            "worker_id",
            store_sig_r,
        ));
        // main task - receive/process tasks
        let _ = process_tasks(id, receiver, store_sig_s).await;
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
    store_sig_s: Sender<Vec<IngestEntry>>,
) -> Result<(), anyhow::Error> {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
    let mut time = std::time::Instant::now();

    let mut pending_tasks = vec![];

    while time.elapsed().as_secs_f64() <= WORKER_MAX_IDLE {
        if receiver.is_closed() {
            break;
        }

        while let Ok(req) = receiver.try_recv() {
            pending_tasks.push(req);
        }

        if !pending_tasks.is_empty() {
            time = std::time::Instant::now();
            // Send to background to persist
            if let Err(e) = store_sig_s.send(pending_tasks.clone()).await {
                println!("failed to send to persisting job, {}", e);
            }
            println!(
                "worker {id} received and ingesting {} request.",
                pending_tasks.len()
            );
            pending_tasks = process_tasks_with_retries(&pending_tasks).await;
        }
        interval.tick().await;
    }
    println!("worker {id} idle too long, shutting down");
    store_sig_s.close(); // signal persist job to close
    Ok(())
}

pub(super) async fn process_tasks_with_retries(tasks: &Vec<IngestEntry>) -> Vec<IngestEntry> {
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

async fn persist_with_interval(
    stream_name: &str,
    worker_id: &str,
    store_sig_r: Receiver<Vec<IngestEntry>>,
) -> Result<(), anyhow::Error> {
    loop {
        match store_sig_r.recv().await {
            Ok(pending_tasks) => {
                let _ = persist_tasks(stream_name, worker_id, &pending_tasks);
            }
            Err(RecvError) => {
                // worker shutting down. No more persisting
                break;
            }
        }
    }
    // clean up
    let path = build_file_path(stream_name, worker_id);
    remove_file(path)?;
    Ok(())
}
