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

use std::{fs::create_dir_all, sync::Arc};

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

// TODO: clean up temp static
static WORKER_DEFAULT_WAIT_TIME: u64 = 1; // seconds between each pull
static WORKER_MAX_IDLE: f64 = 600.0; // max idle time in seconds before shut down

/// Multi-consumer side of the TaskQueue. Created and maaged by TaskQueue asscoaited with a stream.
/// TaskQueue creates a mpmc channel where producer holds the sender and consumers hold
/// the receiver. Each initialized worker has two tasks to perform. Worker will shut down
/// when corresponding producer closes their channel.
pub(super) struct Workers {
    pub stream_name: Arc<str>,
    pub receiver: Arc<Receiver<IngestEntry>>,
    pub handles: RwVec<Worker>,
}

impl Workers {
    pub fn new(count: usize, stream_name: &str, receiver: Arc<Receiver<IngestEntry>>) -> Self {
        let mut handles = Vec::with_capacity(count);
        for _ in 0..count {
            let worker = init_worker(stream_name.to_owned(), Arc::clone(&receiver));
            handles.push(worker);
        }
        Self {
            stream_name: Arc::from(stream_name),
            receiver,
            handles: RwVec::from(handles),
        }
    }

    /// Initializes additional {count} number of workers.
    pub async fn add_workers_by(&self, count: usize) {
        let mut rw = self.handles.write().await;
        for _ in 0..count {
            let handle = init_worker(self.stream_name.to_string(), Arc::clone(&self.receiver));
            rw.push(handle);
        }
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
        join_res.iter().for_each(|res| {
            if let Err(e) = res {
                log::error!(
                    "Stream({})-Worker error when closing: {:?}",
                    self.stream_name,
                    e
                )
            }
        });
    }
}

/// Initializes a background worker (TaskQueue consumer) with two tasks.
/// The main task is receiving and processing IngestEntry sent by TaskQueue producers.
/// The side task is persisting pending tasks to disk.
/// The worker is asscoaited with a stream by stream_name.
fn init_worker(stream_name: String, receiver: Arc<Receiver<IngestEntry>>) -> Worker {
    let handle = tokio::spawn(async move {
        let worker_id = ider::generate();
        log::info!("Stream({stream_name})-Worker({worker_id}) starting");

        // Used to communicated between the worker's two tasks
        let (store_sig_s, store_sig_r) = bounded::<Option<Vec<IngestEntry>>>(1);

        // side job - persisting
        let persist_job_handle = tokio::spawn(persist_job(
            stream_name.clone(),
            worker_id.clone(),
            store_sig_r,
        ));

        // main task - receiving/processing IngestEntries (awaited)
        _ = process_job(stream_name, worker_id, receiver, store_sig_s).await?;
        // Join the side task
        _ = persist_job_handle.await?;
        Ok(())
    });
    handle
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
///     Records elapsed time, which if exceeds WORKER_MAX_IDLE time, exists this task.
async fn process_job(
    stream_name: String,
    worker_id: String,
    receiver: Arc<Receiver<IngestEntry>>,
    store_sig_s: Sender<Option<Vec<IngestEntry>>>,
) -> Result<()> {
    let mut interval =
        tokio::time::interval(tokio::time::Duration::from_secs(WORKER_DEFAULT_WAIT_TIME));
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
            // Send to background to persist
            if let Err(e) = store_sig_s.send(Some(pending_tasks.clone())).await {
                log::error!(
                    "Stream({stream_name})-Worker({worker_id}) failed to send pending tasks to persist job. Error: {:?}",
                    e
                );
            }
            log::info!(
                "Stream({stream_name})-Worker({worker_id}) received and processing {} requests",
                pending_tasks.len()
            );
            process_tasks_with_retries(&stream_name, &worker_id, &pending_tasks, 0).await;
            if let Err(e) = store_sig_s.send(None).await {
                log::error!(
                    "Stream({stream_name})-Worker({worker_id}) failed to send pending tasks to persist job. Error: {:?}",
                    e
                );
            }
            time = std::time::Instant::now();
        }
        interval.tick().await;
    }
    log::info!(
        "Stream({stream_name})-Worker({worker_id}) idle time exceeded maximum idle time allowed. Shutting down."
    );
    store_sig_s.close(); // signal persist job to close
    // Flush to disk or remove saved file
    let path = build_file_path(&stream_name, &worker_id);
    create_dir_all(path.parent().unwrap())
        .context("Failed to flush to disk when worker shutting down")?;
    let to_persist = if pending_tasks.is_empty() {
        None
    } else {
        Some(pending_tasks)
    };
    persist_job_inner(&path, to_persist)?;
    Ok(())
}

/// Batch ingests IngestEntries with maximum 3 retries.
/// Retry only applies to IngestEntries that failed due to ServiceUnavailable (503)
/// from Ingester
pub(super) async fn process_tasks_with_retries(
    stream_name: &str,
    worker_id: &str,
    tasks: &Vec<IngestEntry>,
    retry_count: i32,
) {
    for task in tasks {
        match task.ingest().await {
            Ok(mut retry) => {
                if retry {
                    log::error!("Ingester not available for {stream_name}. Trying again",);
                    let mut retires = 0;
                    while retires < retry_count && retry {
                        if let Ok(r) = task.ingest().await {
                            retires += 1;
                            retry = r;
                        } else {
                            break;
                        }
                    }
                }
            }
            Err(e) => {
                log::error!(
                    "Stream({stream_name})-Worker({worker_id}) failed to ingest {:?}. Error: {:?}. Request dropped",
                    task,
                    e,
                );
            }
        }
    }
}
