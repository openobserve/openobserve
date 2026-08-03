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

//! Publishes typed Score records to the reserved `_llm_scores` stream.

use anyhow::Result;
use config::meta::{
    self_reporting::llm_scores::{LLM_SCORES_STREAM, LlmScoreRecord},
    stream::{StreamParams, StreamType},
};

/// Publish a complete annotation batch as one internal ingestion request.
pub async fn publish(org_id: &str, records: &[LlmScoreRecord]) -> Result<()> {
    if records.is_empty() {
        return Ok(());
    }

    super::llm_scores_schema::ensure_llm_scores_stream_initialized(org_id).await?;
    let values = records
        .iter()
        .map(config::utils::json::to_value)
        .collect::<Result<Vec<_>, _>>()?;
    let stream = StreamParams::new(org_id, LLM_SCORES_STREAM, StreamType::Logs);

    super::ingestion::ingest_reporting_data(values, stream).await
}
