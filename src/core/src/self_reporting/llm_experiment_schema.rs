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
        self_reporting::llm_experiments::{self, ExperimentExecutionRecord},
        stream::{StreamSettings, StreamType},
    },
    utils::{schema::schema_eq, time::now_micros},
};
use dashmap::DashSet;

static INITIALIZED_ORGS: Lazy<DashSet<String>> = Lazy::new(DashSet::new);

fn expected_llm_experiment_schema() -> Result<arrow_schema::Schema> {
    let sample = config::utils::json::to_value(ExperimentExecutionRecord::init_for_reflection())?;
    let sample = config::utils::flatten::flatten(sample)?;
    let sample = sample.as_object().ok_or_else(|| {
        anyhow::anyhow!("Failed to convert ExperimentExecutionRecord to JSON object")
    })?;

    Ok(config::utils::schema::infer_json_schema_from_map(
        llm_experiments::LLM_EXPERIMENT_STREAM,
        StreamType::Logs,
        std::iter::once(sample),
    )?)
}

pub async fn ensure_llm_experiment_stream_initialized(org_id: &str) -> Result<()> {
    if !INITIALIZED_ORGS.insert(org_id.to_string()) {
        return Ok(());
    }

    let schema_initialized = initialize_llm_experiment_stream_schema(org_id)
        .await
        .inspect_err(|error| {
            log::warn!(
                "[LLM-EXPERIMENT] Failed to initialize execution stream schema for org {org_id}: {error}"
            );
        })
        .is_ok();
    let index_initialized = initialize_experiment_id_index(org_id)
        .await
        .inspect_err(|error| {
            log::warn!(
                "[LLM-EXPERIMENT] Failed to initialize experiment_id index for org {org_id}: {error}"
            );
        })
        .is_ok();

    if !(schema_initialized && index_initialized) {
        INITIALIZED_ORGS.remove(org_id);
    }
    Ok(())
}

async fn initialize_llm_experiment_stream_schema(org_id: &str) -> Result<()> {
    let stream_name = llm_experiments::LLM_EXPERIMENT_STREAM;
    let stream_type = StreamType::Logs;
    let expected_schema = expected_llm_experiment_schema()?;

    if infra::schema::get(org_id, stream_name, stream_type)
        .await
        .is_ok_and(|ref schema| schema_eq(schema, &expected_schema))
    {
        return Ok(());
    }

    crate::db::schema::merge(
        org_id,
        stream_name,
        stream_type,
        &expected_schema,
        Some(now_micros()),
    )
    .await
    .map(|_| ())
    .map_err(|error| anyhow::anyhow!("Execution stream schema creation failed: {error}"))
}

async fn initialize_experiment_id_index(org_id: &str) -> Result<()> {
    let mut settings = infra::schema::get_settings(
        org_id,
        llm_experiments::LLM_EXPERIMENT_STREAM,
        StreamType::Logs,
    )
    .await
    .map(|settings| (*settings).clone())
    .unwrap_or_default();
    if !add_experiment_id_index(&mut settings, now_micros()) {
        return Ok(());
    }
    schema::save_stream_settings(
        org_id,
        llm_experiments::LLM_EXPERIMENT_STREAM,
        StreamType::Logs,
        settings,
    )
    .await?;
    Ok(())
}

fn add_experiment_id_index(settings: &mut StreamSettings, now: i64) -> bool {
    const FIELD: &str = "experiment_id";
    if settings.index_fields.iter().any(|field| field == FIELD) {
        return false;
    }
    settings.index_fields.push(FIELD.to_string());
    settings
        .index_fields_updated_at
        .insert(FIELD.to_string(), now);
    true
}

#[cfg(test)]
mod tests {
    use config::meta::stream::StreamSettings;

    use super::{add_experiment_id_index, expected_llm_experiment_schema};

    #[test]
    fn execution_stream_schema_contains_the_complete_slot_contract() {
        let schema = expected_llm_experiment_schema().unwrap();

        for field in [
            "experiment_id",
            "item_logical_id",
            "row_id",
            "trial_index",
            "status",
            "output",
            "error_message",
            "error_attempt_count",
            "latency_ms",
            "tokens_in",
            "tokens_out",
            "cost",
            "trace_id",
            "task_fingerprint",
            "_timestamp",
        ] {
            assert!(
                schema.field_with_name(field).is_ok(),
                "missing schema field {field}"
            );
        }
    }

    #[test]
    fn experiment_id_index_is_added_once() {
        let mut settings = StreamSettings::default();

        assert!(add_experiment_id_index(&mut settings, 123));
        assert!(!add_experiment_id_index(&mut settings, 456));
        assert_eq!(settings.index_fields, vec!["experiment_id"]);
        assert_eq!(
            settings.index_fields_updated_at.get("experiment_id"),
            Some(&123)
        );
    }
}
