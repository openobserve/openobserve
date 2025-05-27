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

use error::ErrorData;
use tokio::{
    sync::{mpsc, oneshot},
    time,
};
use usage::{TriggerData, UsageData};

pub mod error;
pub mod usage;

#[derive(Debug)]
pub struct ReportingQueue {
    pub msg_sender: mpsc::Sender<ReportingMessage>,
}

#[derive(Debug)]
pub enum ReportingMessage {
    Data(ReportingData),
    Shutdown(oneshot::Sender<()>),
    Start(oneshot::Sender<()>),
}

#[derive(Debug)]
pub enum ReportingData {
    Usage(Box<UsageData>),
    Trigger(Box<TriggerData>),
    Error(Box<ErrorData>),
}

#[derive(Debug)]
pub struct ReportingRunner {
    pub pending: Vec<ReportingData>,
    pub batch_size: usize,
    pub timeout: time::Duration,
    pub last_processed: time::Instant,
}

impl ReportingQueue {
    pub fn new(msg_sender: mpsc::Sender<ReportingMessage>) -> Self {
        Self { msg_sender }
    }

    pub async fn enqueue(
        &self,
        reporting_data: ReportingData,
    ) -> Result<(), mpsc::error::SendError<ReportingMessage>> {
        self.msg_sender
            .send(ReportingMessage::Data(reporting_data))
            .await
    }

    pub async fn start(
        &self,
        start_sender: oneshot::Sender<()>,
    ) -> Result<(), mpsc::error::SendError<ReportingMessage>> {
        self.msg_sender
            .send(ReportingMessage::Start(start_sender))
            .await
    }

    pub async fn shutdown(
        &self,
        res_sender: oneshot::Sender<()>,
    ) -> Result<(), mpsc::error::SendError<ReportingMessage>> {
        self.msg_sender
            .send(ReportingMessage::Shutdown(res_sender))
            .await
    }
}

impl ReportingRunner {
    pub fn new(batch_size: usize, timeout: time::Duration) -> Self {
        Self {
            pending: vec![],
            batch_size,
            timeout,
            last_processed: time::Instant::now(),
        }
    }

    pub fn push(&mut self, data: ReportingData) {
        self.pending.push(data);
    }

    pub fn should_process(&self) -> bool {
        self.pending.len() >= self.batch_size
            || (!self.pending.is_empty() && self.last_processed.elapsed() >= self.timeout)
    }

    pub fn take_batch(&mut self) -> Vec<ReportingData> {
        self.last_processed = time::Instant::now();
        std::mem::take(&mut self.pending)
    }
}
