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

use async_channel::Receiver;
use futures::future::join_all;
use tokio::task::JoinHandle;

use super::entry::IngestEntry;

type RwVec<T> = tokio::sync::RwLock<Vec<T>>;

pub struct Workers {
    pub receiver: Arc<Receiver<IngestEntry>>,
    pub handles: RwVec<JoinHandle<()>>,
}

impl Workers {
    pub fn new(count: usize, receiver: Arc<Receiver<IngestEntry>>) -> Self {
        let mut handles = Vec::with_capacity(count);
        for i in 0..count {
            let r = receiver.clone();
            let worker = tokio::spawn(async move {
                let _ = process_task(i, r).await;
            });
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
        for i in curr_cnt..curr_cnt + count {
            let r = Arc::clone(&self.receiver);
            let handle = tokio::spawn(async move {
                let _ = process_task(i, r).await;
            });
            rw.push(handle);
        }
    }

    pub async fn running_worker_count(&self) -> usize {
        let mut rw = self.handles.write().await;
        rw.retain(|handle| !handle.is_finished());
        rw.len()
    }

    // TODO: handle join errors
    pub async fn shut_down(&self) {
        let mut rw = self.handles.write().await;
        let _join_res = join_all(rw.drain(..)).await;
    }
}

// TODO: add default delay between each pull
// TODO: define max idle time before shutting down a worker
// TODO: handle errors
async fn process_task(
    id: usize,
    receiver: Arc<Receiver<IngestEntry>>,
) -> Result<(), anyhow::Error> {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
    let mut time = std::time::Instant::now();
    let max_idle_time = 10.0;
    println!("Worker {id} starting");
    loop {
        if receiver.is_closed() {
            break;
        }
        let mut received = vec![];
        while let Ok(req) = receiver.try_recv() {
            received.push(req);
        }
        if !received.is_empty() {
            println!(
                "receiver {id} received and ingesting {} request.",
                receiver.len()
            );
            // reset idle time
            time = std::time::Instant::now();
            for req in received {
                req.ingest().await;
            }
        } else if time.elapsed().as_secs_f64() > max_idle_time {
            println!("worker {id} idle too long, shutting down");
            break;
        }
        interval.tick().await;
    }
    drop(receiver);
    Ok(())
}
