// Copyright 2024 OpenObserve Inc.
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

use tokio::sync::{mpsc, oneshot};
use usage::{TriggerData, UsageData};

pub mod usage;

#[derive(Debug)]
pub struct ReportingQueue {
    pub msg_sender: mpsc::Sender<ReportingMessage>,
}

#[derive(Debug)]
pub enum ReportingMessage {
    Usage(UsageData),
    Trigger(TriggerData),
    Error,
    Shutdown(oneshot::Sender<()>),
    Start(oneshot::Sender<()>),
}
