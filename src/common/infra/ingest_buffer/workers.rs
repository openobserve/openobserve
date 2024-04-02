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

pub struct Workers {
    pub workers_cnt: usize,
    pub receiver: Arc<Receiver<IngestEntry>>,
    pub workers: Vec<JoinHandle<()>>,
}

impl Workers {
    // TODO: add default worker count
    pub fn new(receiver: Arc<Receiver<IngestEntry>>) -> Self {
        let workers_cnt = 1;
        let mut workers = Vec::with_capacity(workers_cnt);
        for i in 0..workers_cnt {
            let r = receiver.clone();
            let worker = tokio::spawn(async move {
                let _ = process_task(i, r).await;
            });
            workers.push(worker);
        }
        Self {
            workers_cnt,
            receiver,
            workers,
        }
    }

    pub fn add_workers_by(&mut self, count: usize) {
        for i in self.workers_cnt..self.workers_cnt + count {
            let r = Arc::clone(&self.receiver);
            let worker = tokio::spawn(async move {
                let _ = process_task(i, r).await;
            });
            self.workers.push(worker);
        }
        self.workers_cnt += count;
    }

    // TODO: handle join errors
    pub async fn shut_down(&mut self) {
        let _join_res = join_all(self.workers.drain(..)).await;
    }
}

// TODO: add default delay between each pull
// TODO: handle errors
async fn process_task(
    id: usize,
    receiver: Arc<Receiver<IngestEntry>>,
) -> Result<(), anyhow::Error> {
    let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
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
            for req in received {
                req.ingest().await;
            }
        }
        interval.tick().await;
    }
    drop(receiver);
    Ok(())
}
