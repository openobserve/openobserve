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

use once_cell::sync::Lazy;
use tokio::sync::mpsc;

static PENDING_CHANNEL: Lazy<Queue> = Lazy::new(Queue::new);

struct Queue {
    tx: mpsc::Sender<Vec<String>>,
}

impl Queue {
    fn new() -> Self {
        let (tx, mut rx) = mpsc::channel::<Vec<String>>(10240);
        tokio::task::spawn(async move {
            while let Some(files) = rx.recv().await {
                for file in files {
                    if let Err(e) = super::disk::remove(&file).await {
                        log::error!("[CACHE:FILE_DATA] Failed to delete file: {e}");
                    }
                    tokio::task::consume_budget().await;
                }
            }
        });
        Self { tx }
    }

    fn add(&self, files: Vec<String>) {
        if let Err(e) = self.tx.try_send(files) {
            log::error!("[CACHE:FILE_DATA] Failed to send files to pending delete channel: {e}");
        }
    }
}

pub fn add(files: Vec<String>) {
    if !files.is_empty() {
        PENDING_CHANNEL.add(files)
    }
}
