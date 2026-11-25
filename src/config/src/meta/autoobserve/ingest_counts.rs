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

//! Per-stream ingest counts for AutoObserve: the ingest path hands each request's record count
//! to a sink the enterprise build registers at start-up.

use std::sync::{Arc, OnceLock};

use crate::meta::stream::StreamType;

static SINK: OnceLock<Arc<dyn IngestCountSink>> = OnceLock::new();

/// Called on the ingest path for every request, so it must not block, await or allocate.
pub trait IngestCountSink: Send + Sync {
    fn add(&self, org: &str, stream_type: StreamType, stream: &str, records: u64);
}

pub fn register(sink: Arc<dyn IngestCountSink>) -> bool {
    SINK.set(sink).is_ok()
}

#[inline]
pub fn add(org: &str, stream_type: StreamType, stream: &str, records: u64) {
    if let Some(sink) = SINK.get() {
        sink.add(org, stream_type, stream, records);
    }
}
