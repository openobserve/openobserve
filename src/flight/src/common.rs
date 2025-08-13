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

use arrow::array::RecordBatch;
use arrow_schema::SchemaRef;
use config::meta::search::ScanStats;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

#[derive(Debug)]
pub enum FlightMessage {
    Schema(SchemaRef),
    RecordBatch(RecordBatch),
    CustomMessage(CustomMessage),
}

/// Custom message for ser/deserialize
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CustomMessage {
    ScanStats(ScanStats),
}

/// the CustomMessage is not ready, so we need to use this struct to store
/// the scan stats, and send it to the client when the scan stats is ready
pub enum PreCustomMessage {
    ScanStats(ScanStats),
    ScanStatsRef(Option<Arc<Mutex<ScanStats>>>),
}

impl PreCustomMessage {
    pub fn get_custom_message(&self) -> Option<CustomMessage> {
        match self {
            PreCustomMessage::ScanStats(stats) => Some(CustomMessage::ScanStats(*stats)),
            PreCustomMessage::ScanStatsRef(stats_ref) => stats_ref
                .as_ref()
                .map(|stats| CustomMessage::ScanStats(*stats.lock())),
        }
    }
}
