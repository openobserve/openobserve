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

//! Persisted Evaluation Watermarks for the LLM Eval Scheduler.
//!
//! The scheduler owns target detection for trace/session jobs. Its partition is
//! an organization plus trace stream, and the watermark is stored in the meta
//! store via `kv_store` so restarts resume from the last committed ingest-time
//! position with a configured delay rewind.

use serde::{Deserialize, Serialize};

use super::kv_store;
use crate::errors;

const EVALUATION_WATERMARK_KEY_PREFIX: &str = "/llm_eval/evaluation_watermarks";

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct EvaluationWatermark {
    pub org_id: String,
    pub stream: String,
    pub stream_type: String,
    pub watermark_us: i64,
    pub updated_at: i64,
}

impl EvaluationWatermark {
    pub fn new(org_id: &str, stream: &str, stream_type: &str, watermark_us: i64) -> Self {
        Self {
            org_id: org_id.to_string(),
            stream: stream.to_string(),
            stream_type: stream_type.to_string(),
            watermark_us,
            updated_at: config::utils::time::now_micros(),
        }
    }

    pub fn partition_key(&self) -> String {
        partition_key(&self.org_id, &self.stream, &self.stream_type)
    }

    pub fn resume_start_us(&self, delay_rewind_us: i64) -> i64 {
        resume_start_us(self.watermark_us, delay_rewind_us)
    }
}

pub fn partition_key(org_id: &str, stream: &str, stream_type: &str) -> String {
    format!(
        "{}/{}/{}/{}",
        EVALUATION_WATERMARK_KEY_PREFIX,
        escape_key_part(org_id),
        escape_key_part(stream_type),
        escape_key_part(stream)
    )
}

pub fn resume_start_us(watermark_us: i64, delay_rewind_us: i64) -> i64 {
    watermark_us.saturating_sub(delay_rewind_us.max(0)).max(0)
}

pub async fn get(
    org_id: &str,
    stream: &str,
    stream_type: &str,
) -> Result<Option<EvaluationWatermark>, errors::Error> {
    let key = partition_key(org_id, stream, stream_type);
    let Some(record) = kv_store::get(org_id, &key).await? else {
        return Ok(None);
    };

    let watermark = config::utils::json::from_slice(&record.value)
        .map_err(|e| errors::Error::Message(format!("invalid evaluation watermark {key}: {e}")))?;
    Ok(Some(watermark))
}

pub async fn advance(
    org_id: &str,
    stream: &str,
    stream_type: &str,
    watermark_us: i64,
) -> Result<EvaluationWatermark, errors::Error> {
    let watermark = EvaluationWatermark::new(org_id, stream, stream_type, watermark_us);
    let key = watermark.partition_key();
    let value = config::utils::json::to_vec(&watermark)?;
    kv_store::set(org_id, &key, &value).await?;
    Ok(watermark)
}

fn escape_key_part(value: &str) -> String {
    value.replace('%', "%25").replace('/', "%2F")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_partition_key_is_stable_and_escaped() {
        assert_eq!(
            partition_key("org/1", "trace/stream", "traces"),
            "/llm_eval/evaluation_watermarks/org%2F1/traces/trace%2Fstream"
        );
    }

    #[test]
    fn test_resume_start_rewinds_without_underflow() {
        assert_eq!(resume_start_us(10_000, 1_500), 8_500);
        assert_eq!(resume_start_us(1_000, 5_000), 0);
        assert_eq!(resume_start_us(1_000, -1), 1_000);
    }

    #[test]
    fn test_watermark_round_trip_json() {
        let watermark = EvaluationWatermark {
            org_id: "org-1".to_string(),
            stream: "traces".to_string(),
            stream_type: "traces".to_string(),
            watermark_us: 123,
            updated_at: 456,
        };

        let bytes = config::utils::json::to_vec(&watermark).unwrap();
        let back: EvaluationWatermark = config::utils::json::from_slice(&bytes).unwrap();

        assert_eq!(back, watermark);
        assert_eq!(back.partition_key(), watermark.partition_key());
    }
}
