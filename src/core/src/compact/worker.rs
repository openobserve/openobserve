// Copyright 2026 OpenObserve Inc.
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

//! Compatibility constructors for compactor workers.
//!
//! Worker lifecycle is owned by `openobserve-compactor`; this facade injects
//! the merge implementation that is still composed in `openobserve-core`.

use std::sync::Arc;

use async_trait::async_trait;
use config::meta::stream::{FileKey, StreamType};
pub use openobserve_compactor::worker::{
    MergeBatch, MergeExecutor, MergeJob, MergeResult, MergeSender,
};
use tokio::sync::mpsc;

struct CoreMergeExecutor;

#[async_trait]
impl MergeExecutor for CoreMergeExecutor {
    async fn merge_by_stream(
        &self,
        worker_tx: mpsc::Sender<(MergeSender, MergeBatch)>,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        job_id: i64,
        offset: i64,
    ) -> Result<(), anyhow::Error> {
        super::merge::merge_by_stream(worker_tx, org_id, stream_type, stream_name, job_id, offset)
            .await
    }

    async fn merge_files(
        &self,
        thread_id: usize,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        prefix: &str,
        files: &[FileKey],
    ) -> Result<(Vec<FileKey>, Vec<FileKey>), anyhow::Error> {
        super::merge::merge_files(thread_id, org_id, stream_type, stream_name, prefix, files).await
    }
}

pub struct JobScheduler(openobserve_compactor::worker::JobScheduler);

impl JobScheduler {
    pub fn new(num: usize, worker_tx: mpsc::Sender<(MergeSender, MergeBatch)>) -> Self {
        Self(openobserve_compactor::worker::JobScheduler::new(
            num,
            worker_tx,
            Arc::new(CoreMergeExecutor),
        ))
    }

    pub fn tx(&self) -> mpsc::Sender<MergeJob> {
        self.0.tx()
    }

    pub fn run(&mut self) -> Result<(), anyhow::Error> {
        self.0.run()
    }
}

pub struct MergeWorker(openobserve_compactor::worker::MergeWorker);

impl MergeWorker {
    pub fn new(num: usize) -> Self {
        Self(openobserve_compactor::worker::MergeWorker::new(
            num,
            Arc::new(CoreMergeExecutor),
        ))
    }

    pub fn tx(&self) -> mpsc::Sender<(MergeSender, MergeBatch)> {
        self.0.tx()
    }

    pub fn run(&mut self) -> Result<(), anyhow::Error> {
        self.0.run()
    }
}
