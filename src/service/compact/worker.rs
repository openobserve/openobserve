// Copyright 2025 OpenObserve Inc.
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

use config::{
    cluster::is_offline,
    meta::stream::{FileKey, StreamType},
};
use tokio::sync::{Mutex, mpsc};

#[derive(Clone)]
pub struct MergeBatch {
    pub batch_id: usize,
    pub org_id: String,
    pub stream_type: StreamType,
    pub stream_name: String,
    pub prefix: String,
    pub files: Vec<FileKey>,
}

pub struct MergeResult {
    pub batch_id: usize,
    pub new_file: FileKey,
}

pub type MergeSender = mpsc::Sender<Result<(usize, Vec<FileKey>), anyhow::Error>>;

pub struct MergeJob {
    pub org_id: String,
    pub stream_type: StreamType,
    pub stream_name: String,
    pub job_id: i64,
    pub offset: i64,
}

/// JobScheduler is a worker that processes jobs
pub struct JobScheduler {
    num: usize,
    rx: Arc<Mutex<mpsc::Receiver<MergeJob>>>,
    tx: mpsc::Sender<MergeJob>,
    worker_tx: mpsc::Sender<(MergeSender, MergeBatch)>,
}

impl JobScheduler {
    pub fn new(num: usize, worker_tx: mpsc::Sender<(MergeSender, MergeBatch)>) -> Self {
        let (tx, rx) = mpsc::channel::<MergeJob>(1);
        let rx = Arc::new(Mutex::new(rx));
        Self {
            num,
            rx,
            tx,
            worker_tx,
        }
    }

    pub fn tx(&self) -> mpsc::Sender<MergeJob> {
        self.tx.clone()
    }

    pub fn run(&mut self) -> Result<(), anyhow::Error> {
        let cfg = config::get_config();
        let ttl = std::cmp::max(60, cfg.compact.job_run_timeout / 4) as u64;
        for thread_id in 0..self.num {
            let rx = self.rx.clone();
            let worker_tx = self.worker_tx.clone();
            tokio::spawn(async move {
                loop {
                    if is_offline() {
                        break;
                    }
                    let ret = rx.lock().await.recv().await;
                    match ret {
                        None => {
                            log::debug!(
                                "[COMPACTOR:SCHEDULER:{thread_id}] Receiving job channel is closed"
                            );
                            break;
                        }
                        Some(job) => {
                            let (_tx, mut rx) = mpsc::channel::<()>(1);
                            tokio::task::spawn(async move {
                                loop {
                                    tokio::select! {
                                        _ = tokio::time::sleep(tokio::time::Duration::from_secs(ttl)) => {}
                                        _ = rx.recv() => {
                                            log::debug!("[COMPACTOR:SCHEDULER:{thread_id}] update_running_jobs[{}] done", job.job_id);
                                            return;
                                        }
                                    }
                                    if let Err(e) =
                                        infra::file_list::update_running_jobs(&[job.job_id]).await
                                    {
                                        log::error!(
                                            "[COMPACTOR:SCHEDULER:{thread_id}] update_job_status[{}] failed: {}",
                                            job.job_id,
                                            e
                                        );
                                    }
                                }
                            });
                            if let Err(e) = super::merge::merge_by_stream(
                                worker_tx.clone(),
                                &job.org_id,
                                job.stream_type,
                                &job.stream_name,
                                job.job_id,
                                job.offset,
                            )
                            .await
                            {
                                log::error!(
                                    "[COMPACTOR:SCHEDULER:{thread_id}] merge_by_stream [{}/{}/{}] error: {}",
                                    job.org_id,
                                    job.stream_type,
                                    job.stream_name,
                                    e
                                );
                            }
                        }
                    }
                }
            });
        }
        Ok(())
    }
}

/// MergeWorker is a worker that merges files
pub struct MergeWorker {
    num: usize,
    rx: Arc<Mutex<mpsc::Receiver<(MergeSender, MergeBatch)>>>,
    tx: mpsc::Sender<(MergeSender, MergeBatch)>,
}

impl MergeWorker {
    pub fn new(num: usize) -> Self {
        let (tx, rx) = mpsc::channel::<(MergeSender, MergeBatch)>(1);
        let rx = Arc::new(Mutex::new(rx));
        Self { num, rx, tx }
    }

    pub fn tx(&self) -> mpsc::Sender<(MergeSender, MergeBatch)> {
        self.tx.clone()
    }

    pub fn run(&mut self) -> Result<(), anyhow::Error> {
        for thread_id in 0..self.num {
            let rx = self.rx.clone();
            tokio::spawn(async move {
                loop {
                    if is_offline() {
                        break;
                    }
                    let ret = rx.lock().await.recv().await;
                    match ret {
                        None => {
                            log::debug!(
                                "[COMPACTOR:WORKER:{thread_id}] Receiving files channel is closed"
                            );
                            break;
                        }
                        Some((tx, msg)) => {
                            match super::merge::merge_files(
                                thread_id,
                                &msg.org_id,
                                msg.stream_type,
                                &msg.stream_name,
                                &msg.prefix,
                                &msg.files,
                            )
                            .await
                            {
                                Ok((new_files, _)) => {
                                    if let Err(e) = tx.send(Ok((msg.batch_id, new_files))).await {
                                        log::error!(
                                            "[COMPACTOR:WORKER:{thread_id}] Error sending file to merge_job: {}",
                                            e
                                        );
                                    }
                                }
                                Err(e) => {
                                    log::error!(
                                        "[COMPACTOR:WORKER:{thread_id}] Error merging files: stream: {}/{}/{}, err: {}",
                                        msg.org_id,
                                        msg.stream_type,
                                        msg.stream_name,
                                        e
                                    );
                                    if let Err(e) = tx.send(Err(e)).await {
                                        log::error!(
                                            "[COMPACTOR:WORKER:{thread_id}] Error sending error to merge_job: {}",
                                            e
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }
        Ok(())
    }
}
