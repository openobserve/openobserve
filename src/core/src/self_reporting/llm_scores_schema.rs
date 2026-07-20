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

use std::sync::LazyLock as Lazy;

use anyhow::Result;
use config::{
    meta::{
        self_reporting::llm_scores::{self, LlmScoreRecord},
        stream::StreamType,
    },
    utils::schema::schema_eq,
};
use dashmap::DashSet;

static INITIALIZED_ORGS: Lazy<DashSet<String>> = Lazy::new(DashSet::new);

pub async fn ensure_llm_scores_stream_initialized(org_id: &str) -> Result<()> {
    if !INITIALIZED_ORGS.insert(org_id.to_string()) {
        return Ok(());
    }

    if let Err(e) = initialize_llm_scores_stream_schema(org_id).await {
        log::warn!(
            "[LLM-SCORES] Failed to initialize _llm_scores stream schema for org {org_id}: {e}"
        );
    }

    Ok(())
}

async fn initialize_llm_scores_stream_schema(org_id: &str) -> Result<()> {
    let stream_name = llm_scores::LLM_SCORES_STREAM;
    let stream_type = StreamType::Logs;

    log::info!("[LLM-SCORES] Creating _llm_scores stream schema for {org_id}/{stream_name}");

    let sample = LlmScoreRecord::init_for_reflection();
    let json_value = config::utils::json::to_value(&sample)?;
    let json_map = json_value
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("Failed to convert LlmScoreRecord to JSON object"))?;

    let expected_schema = config::utils::schema::infer_json_schema_from_map(
        stream_name,
        stream_type,
        std::iter::once(json_map),
    )?;

    if infra::schema::get(org_id, stream_name, stream_type)
        .await
        .is_ok_and(|ref schema| schema_eq(schema, &expected_schema))
    {
        log::debug!(
            "[LLM-SCORES] _llm_scores stream {org_id}/{stream_name} already exists with expected schema"
        );
        return Ok(());
    }

    match crate::service::db::schema::merge(
        org_id,
        stream_name,
        stream_type,
        &expected_schema,
        Some(config::utils::time::now_micros()),
    )
    .await
    {
        Ok(_) => {
            log::info!(
                "[LLM-SCORES] Successfully created _llm_scores stream schema for {org_id}/{stream_name} with {} fields",
                expected_schema.fields().len()
            );
            Ok(())
        }
        Err(e) => {
            log::error!(
                "[LLM-SCORES] Failed to create _llm_scores stream schema for {org_id}/{stream_name}: {e}"
            );
            Err(anyhow::anyhow!("Schema creation failed: {}", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ensure_llm_scores_stream_initialized_marks_org() {
        let test_org = "test_llm_scores_org_1";
        let result = ensure_llm_scores_stream_initialized(test_org).await;
        assert!(result.is_ok());
        assert!(INITIALIZED_ORGS.contains(test_org));
    }

    #[tokio::test]
    async fn test_ensure_llm_scores_stream_initialized_idempotent() {
        let test_org = "test_llm_scores_org_2";
        let r1 = ensure_llm_scores_stream_initialized(test_org).await;
        let r2 = ensure_llm_scores_stream_initialized(test_org).await;
        assert!(r1.is_ok());
        assert!(r2.is_ok());
    }

    #[test]
    fn test_llm_score_reflection_has_all_fields() {
        let sample = LlmScoreRecord::init_for_reflection();
        let json_value = config::utils::json::to_value(&sample).unwrap();
        let obj = json_value.as_object().unwrap();
        assert!(obj.contains_key("id"));
        assert!(obj.contains_key("span_id"));
        assert!(obj.contains_key("trace_id"));
        assert!(obj.contains_key("session_id"));
        assert!(obj.contains_key("experiment_id"));
        assert!(obj.contains_key("level"));
        assert!(obj.contains_key("name"));
        assert!(obj.contains_key("value_numeric"));
        assert!(obj.contains_key("value_categorical"));
        assert!(obj.contains_key("value_boolean"));
        assert!(obj.contains_key("data_type"));
        assert!(obj.contains_key("score_config_id"));
        assert!(obj.contains_key("scorer_id"));
        assert!(obj.contains_key("source_stream_type"));
        assert!(!obj.contains_key("agent_name"));
        assert!(!obj.contains_key("agent_id"));
        assert!(!obj.contains_key("target_agent_name"));
        assert!(!obj.contains_key("target_agent_id"));
        assert!(obj.contains_key("_timestamp"));
    }
}
