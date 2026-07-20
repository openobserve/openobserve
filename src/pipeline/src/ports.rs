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

use std::sync::{Arc, OnceLock};

use async_trait::async_trait;
use proto::cluster_rpc::{IngestionRequest, IngestionResponse};

#[async_trait]
pub trait RecordSink: Send + Sync + 'static {
    async fn ingest(&self, request: IngestionRequest) -> anyhow::Result<IngestionResponse>;
}

static RECORD_SINK: OnceLock<Arc<dyn RecordSink>> = OnceLock::new();

pub fn install_record_sink(sink: Arc<dyn RecordSink>) -> Result<(), Arc<dyn RecordSink>> {
    RECORD_SINK.set(sink)
}

pub async fn ingest(request: IngestionRequest) -> anyhow::Result<IngestionResponse> {
    let sink = RECORD_SINK
        .get()
        .ok_or_else(|| anyhow::anyhow!("pipeline record sink is not installed"))?;
    sink.ingest(request).await
}
