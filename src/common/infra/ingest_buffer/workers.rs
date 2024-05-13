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
use async_channel::{bounded, Receiver, Sender};
use config::ider;
use futures::future::join_all;
use tokio::{sync::RwLock, task::JoinHandle};

use super::{
    entry::IngestEntry,
    queue_store::{build_file_path, persist_job, persist_job_inner},
};

type RwVec<T> = RwLock<Vec<T>>;
type Worker = JoinHandle<Result<()>>;

// REVIEW: static ok or env variables?
/// seconds between each pull for a worker
static WORKER_DEFAULT_WAIT_TIME: u64 = 1;
/// max idle time in seconds before shut down
static WORKER_MAX_IDLE_TIME: f64 = 60.0;
/// max number of requests a worker should process in one batch
static WORKER_BATCH_PROCESSING_SIZE: usize = 5;

/// Multi-consumer side of the TaskQueue. Created and manged by TaskQueue associated with a stream.
/// TaskQueue creates a mpmc channel where producer holds the sender and consumers hold
/// the receiver. Each initialized worker has two tasks to perform. Worker will shut down
/// when corresponding producer closes their channel.
pub(super) struct Workers {
    pub tq_index: usize,
    pub receiver: Arc<Receiver<IngestEntry>>,
    pub handles: RwVec<Worker>,
}

impl Workers {
    pub fn new(count: usize, tq_index: usize, receiver: Arc<Receiver<IngestEntry>>) -> Self {
        let mut handles = Vec::with_capacity(count);
        for _ in 0..count {
            let worker = init_worker(tq_index, Arc::clone(&receiver));
            handles.push(worker);
        }
        Self {
            tq_index,
            receiver,
            handles: RwVec::from(handles),
        }
    }

    /// Initializes additional {count} number of workers.
    pub async fn add_workers_by(&self, count: usize, max_worker_count: usize) -> usize {
        let mut rw = self.handles.write().await;
        let add_count = count.min(max_worker_count - rw.len());
        for _ in 0..add_count {
            let handle = init_worker(self.tq_index, Arc::clone(&self.receiver));
            rw.push(handle);
        }
        add_count
    }

    /// Removes finished workers and returns remaining active worker count.
    pub async fn running_worker_count(&self) -> usize {
        let mut rw = self.handles.write().await;
        rw.retain(|handle| !handle.is_finished());
        rw.shrink_to_fit();
        rw.len()
    }

    /// Terminates all active workers
    pub async fn shut_down(&self) {
        let mut rw = self.handles.write().await;
        let join_res = join_all(rw.drain(..)).await;
        for res in join_res {
            if let Err(e) = res {
                if !e.is_cancelled() {
                    log::error!(
                        "TaskQueue({})-Worker error when closing: {:?}",
                        self.tq_index,
                        e
                    )
                }
            }
        }
    }
}

/// Initializes a background worker (TaskQueue consumer) with two tasks.
/// The main task is receiving and processing IngestEntry sent by TaskQueue producers.
/// The side task is persisting pending tasks to disk.
/// The worker is associated with a stream by stream_name.
fn init_worker(tq_index: usize, receiver: Arc<Receiver<IngestEntry>>) -> Worker {
    tokio::spawn(async move {
        let worker_id = ider::generate();
        log::info!("TaskQueue({tq_index})-Worker({worker_id}) starting");

        // Used to communicated between the worker's two tasks
        let (store_sig_s, store_sig_r) = bounded::<Option<Vec<IngestEntry>>>(1);

        // side job - persisting
        let persist_job_handle =
            tokio::spawn(persist_job(tq_index, worker_id.clone(), store_sig_r));

        // main task - receiving/processing IngestEntries (awaited)
        process_job(tq_index, worker_id, receiver, store_sig_s).await?;
        // Join the side task
        _ = persist_job_handle.await?;
        Ok(())
    })
}

/// TaskQueue worker's main task.
/// Worker pulls all available IngestEntries in the channel periodically (defined by
/// worker_wait_time).
///
/// If there is any IngestEntries to be processed:
///     1. Sends received IngestEntries to persist job to store in disk
///     2. Process all received IngestEntries
///     3. Signal persist job to remove successfully processed IngestEntries
///
/// Otherwise:
///     Records elapsed time, which if exceeds WORKER_MAX_IDLE_TIME time, exists this task.
async fn process_job(
    tq_index: usize,
    worker_id: String,
    receiver: Arc<Receiver<IngestEntry>>,
    store_sig_s: Sender<Option<Vec<IngestEntry>>>,
) -> Result<()> {
    let mut wait_interval =
        tokio::time::interval(tokio::time::Duration::from_secs(WORKER_DEFAULT_WAIT_TIME));
    let mut time = std::time::Instant::now();

    let mut pending_tasks = vec![];

    while time.elapsed().as_secs_f64() <= WORKER_MAX_IDLE_TIME {
        if receiver.is_closed() {
            // closed by TaskQueue::shut_down()
            break;
        }

        while let Ok(req) = receiver.try_recv() {
            if let Err(e) = req.validate() {
                log::warn!(
                    "TaskQueue({tq_index})-Worker({worker_id}) received an invalid request {:?}. Skip.",
                    e
                );
                continue;
            }
            pending_tasks.push(req);
            if pending_tasks.len() == WORKER_BATCH_PROCESSING_SIZE {
                break;
            }
        }

        if !pending_tasks.is_empty() {
            // Send to background to persist
            if let Err(e) = store_sig_s.send(Some(pending_tasks.clone())).await {
                log::error!(
                    "TaskQueue({tq_index})-Worker({worker_id}) failed to send pending tasks to persist job. Error: {:?}",
                    e
                );
            }
            log::info!(
                "TaskQueue({tq_index})-Worker({worker_id}) received and processing {} requests",
                pending_tasks.len()
            );
            process_tasks_with_retries(tq_index, &worker_id, &pending_tasks, 0).await;
            pending_tasks.clear();
            if let Err(e) = store_sig_s.send(None).await {
                log::error!(
                    "TaskQueue({tq_index})-Worker({worker_id}) failed to send pending tasks to persist job. Error: {:?}",
                    e
                );
            }
            time = std::time::Instant::now();
        }
        wait_interval.tick().await;
    }
    log::info!("TaskQueue({tq_index})-Worker({worker_id}) shutting down.");
    store_sig_s.close(); // signal persist job to close
    // Flush to disk or remove saved file
    let path = build_file_path(tq_index, &worker_id);
    let to_persist = if pending_tasks.is_empty() {
        None
    } else {
        Some(pending_tasks)
    };
    persist_job_inner(&path, to_persist)
        .context("Failed to flush to disk when worker shutting down")?;
    Ok(())
}

/// Batch ingests IngestEntries with maximum 3 retries.
/// Retry only applies to IngestEntries that failed due to ServiceUnavailable (503)
/// from Ingester
pub(super) async fn process_tasks_with_retries(
    tq_index: usize,
    worker_id: &str,
    tasks: &Vec<IngestEntry>,
    retry_count: i32,
) {
    let mut succeed = 0;
    for task in tasks {
        match task.ingest().await {
            Ok(mut retry) => {
                if retry {
                    log::error!("Ingester not available. Trying again",);
                    let mut retires = 0;
                    while retires < retry_count && retry {
                        if let Ok(r) = task.ingest().await {
                            retires += 1;
                            retry = r;
                        } else {
                            break;
                        }
                    }
                    if retry {
                        log::warn!(
                            "TaskQueue({tq_index})-Worker({worker_id}): max retries reached. Skip request",
                        );
                        continue;
                    }
                }
                succeed += 1;
            }
            Err(e) => {
                log::error!(
                    "TaskQueue({tq_index})-Worker({worker_id}) failed to ingest {:?}. Error: {:?}. Request dropped",
                    task,
                    e,
                );
            }
        }
    }
    log::info!(
        "TaskQueue({tq_index})-Worker({worker_id}) successfully ingested {}/{} request(s).",
        succeed,
        tasks.len()
    );
}
