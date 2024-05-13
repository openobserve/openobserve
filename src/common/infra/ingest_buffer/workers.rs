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
    task_queue::update_buffer_size,
};

type RwVec<T> = RwLock<Vec<T>>;
type Worker = JoinHandle<Result<()>>;

/// for batch processing: worker's default wait time between each pull from channel
static WORKER_DEFAULT_WAIT_TIME: u64 = 1;
/// for batch processing: max number of requests a worker should process in one batch
static WORKER_BATCH_PROCESSING_SIZE: usize = 5; // 
/// max idle time in seconds before a worker shuts itself down
static WORKER_MAX_IDLE_TIME: f64 = 60.0;

/// Consumer side of the IngestBuffer. The number of workers is dynamically increased
/// or decreased based on the load the IngestBuffer is receiving. All active workers
/// receives the fair chance of being picked to receive buffered requests thanks to
/// async-channel crate.
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

    /// Initializes additional workers.
    pub async fn add_workers_by(&self, count: usize) {
        let mut rw = self.handles.write().await;
        for _ in 0..count {
            let handle = init_worker(Arc::clone(&self.receiver));
            rw.push(handle);
        }
    }

    /// Removes stopped workers and returns remaining active worker count.
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
                    log::error!("IngestBuffer error when closing: {:?}", e)
                }
            }
        }
    }
}

/// Initializes a background worker (TaskQueue consumer) to perform two async jobs as below:
/// [process_job]                                 | [persist_job]
/// 1. receives {tasks} buffered in TaskQueue     | channel by producers                       |
/// 2. sends all received {tasks} to      --------> persists received {tasks} to disk in '.wal'
/// 3. processes all received {tasks}             |
/// 4. informs to remove 'wa              --------> removes the 'wal'
fn init_worker(receiver: Arc<Receiver<IngestEntry>>) -> Worker {
    tokio::spawn(async move {
        let worker_id = ider::generate();
        log::info!("IngestBuffer-Worker({worker_id}) starting");

        // Used to communicated between the worker's two tasks
        let (store_sig_s, store_sig_r) = bounded::<Option<Vec<IngestEntry>>>(1);

        // side job - persisting
        let persist_job_handle = tokio::spawn(persist_job(worker_id.clone(), store_sig_r));

        // main task - receiving/processing IngestEntries (awaited)
        process_job(worker_id, receiver, store_sig_s).await?;
        // Join the side task
        _ = persist_job_handle.await?;
        Ok(())
    })
}

/// TaskQueue worker's main job.
/// Worker pulls available {tasks} buffered in the channel periodically (defined by
/// [WORKER_DEFAULT_WAIT_TIME]). At most, a worker pulls [WORKER_BATCH_PROCESSING_SIZE]
/// tasks out of channel each time.
///
/// If there is any tasks to be processed:
///     1. Sends received IngestEntries to persist job to store in disk in 'wal'
///     2. Process all received IngestEntries
///     3. Signals persist job to remove corresponding 'wal' file
///
/// Otherwise:
///     Records elapsed time, which if exceeds [WORKER_MAX_IDLE_TIME] time, exists this task.
async fn process_job(
    worker_id: String,
    receiver: Arc<Receiver<IngestEntry>>,
    store_sig_s: Sender<Option<Vec<IngestEntry>>>,
) -> Result<()> {
    let mut wait_interval =
        tokio::time::interval(tokio::time::Duration::from_secs(WORKER_DEFAULT_WAIT_TIME));
    let mut idle_time = std::time::Instant::now();

    let mut pending_tasks = vec![];

    while idle_time.elapsed().as_secs_f64() <= WORKER_MAX_IDLE_TIME {
        if receiver.is_closed() {
            break; // closed by TaskQueue::shut_down()
        }

        while let Ok(req) = receiver.try_recv() {
            if let Err(e) = req.validate() {
                log::warn!(
                    "IngestBuffer-Worker({worker_id}) received an invalid request {:?}. Skip.",
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
            // received some tasks -> Send to background to persist
            if let Err(e) = store_sig_s.send(Some(pending_tasks.clone())).await {
                log::error!(
                    "IngestBuffer-Worker({worker_id}) failed to send pending tasks to persist job. Error: {:?}",
                    e
                );
            }
            log::info!(
                "IngestBuffer-Worker({worker_id}) received and processing {} requests",
                pending_tasks.len()
            );
            process_tasks(&worker_id, &pending_tasks).await;
            pending_tasks.clear();
            if let Err(e) = store_sig_s.send(None).await {
                log::error!(
                    "IngestBuffer-Worker({worker_id}) failed to send pending tasks to persist job. Error: {:?}",
                    e
                );
            }
            idle_time = std::time::Instant::now(); // refresh idle time
        }
        wait_interval.tick().await;
    }
    log::info!("IngestBuffer-Worker({worker_id}) shutting down.");
    store_sig_s.close(); // signal persist job to close
    // In case worker was terminated by TaskQueue with unfinished tasks
    // -> flush to disk or remove saved file
    let path = build_file_path(&worker_id);
    let to_persist = if pending_tasks.is_empty() {
        None
    } else {
        Some(pending_tasks)
    };
    persist_job_inner(&path, to_persist)
        .context("Failed to flush to disk when worker shutting down")?;
    Ok(())
}

/// processes received tasks and update IngestBuffer total size after done.
pub(super) async fn process_tasks(worker_id: &str, tasks: &Vec<IngestEntry>) {
    let mut succeed = 0;
    let mut tq_size_update = 0;
    for task in tasks {
        tq_size_update += task.content_length;
        match task.ingest().await {
            Ok(success) => {
                if success {
                    succeed += 1;
                } else {
                    log::warn!("")
                }
            }
            Err(e) => {
                log::error!(
                    "IngestBuffer-Worker({worker_id}) failed to ingest. Error: {:?}. Request dropped",
                    e,
                );
            }
        }
    }
    log::info!(
        "IngestBuffer-Worker({worker_id}) successfully ingested {}/{} request(s).",
        succeed,
        tasks.len()
    );
    update_buffer_size(tq_size_update, false).await;
}
