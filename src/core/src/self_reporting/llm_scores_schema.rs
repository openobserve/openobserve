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

use std::{
    future::Future,
    sync::{Arc, LazyLock as Lazy},
};

use anyhow::Result;
use config::{
    meta::{
        self_reporting::llm_scores::{self, LlmScoreRecord},
        stream::{StreamSettings, StreamType},
    },
    utils::{schema::schema_eq, time::now_micros},
};
use dashmap::DashMap;
use tokio::sync::OnceCell;

static INITIALIZATION_CACHE: Lazy<InitializationCache> = Lazy::new(InitializationCache::default);

#[derive(Default)]
struct InitializationCache {
    orgs: DashMap<String, Arc<OnceCell<()>>>,
}

impl InitializationCache {
    async fn run<Initialize, InitializeFuture>(
        &self,
        org_id: &str,
        initialize: Initialize,
    ) -> Result<()>
    where
        Initialize: FnOnce() -> InitializeFuture,
        InitializeFuture: Future<Output = Result<()>>,
    {
        let initialization = self
            .orgs
            .entry(org_id.to_string())
            .or_insert_with(|| Arc::new(OnceCell::new()))
            .clone();
        initialization.get_or_try_init(initialize).await.map(|_| ())
    }
}

fn expected_llm_scores_schema() -> Result<arrow_schema::Schema> {
    LlmScoreRecord::schema_for_reflection()
}

pub async fn ensure_llm_scores_stream_initialized(org_id: &str) -> Result<()> {
    INITIALIZATION_CACHE
        .run(org_id, || async {
            initialize_llm_scores_stream_schema(org_id)
                .await
                .inspect_err(|e| {
                    log::warn!(
                        "[LLM-SCORES] Failed to initialize _llm_scores stream schema for org {org_id}: {e}"
                    );
                })?;
            initialize_experiment_id_index(org_id)
                .await
                .inspect_err(|e| {
                    log::warn!(
                        "[LLM-SCORES] Failed to initialize experiment_id index for org {org_id}: {e}"
                    );
                })?;
            Ok(())
        })
        .await
}

async fn initialize_experiment_id_index(org_id: &str) -> Result<()> {
    let mut settings =
        infra::schema::get_settings(org_id, llm_scores::LLM_SCORES_STREAM, StreamType::Logs)
            .await
            .map(|settings| (*settings).clone())
            .unwrap_or_default();
    if !add_experiment_id_index(&mut settings, now_micros()) {
        return Ok(());
    }
    schema::save_stream_settings(
        org_id,
        llm_scores::LLM_SCORES_STREAM,
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

async fn initialize_llm_scores_stream_schema(org_id: &str) -> Result<()> {
    let stream_name = llm_scores::LLM_SCORES_STREAM;
    let stream_type = StreamType::Logs;

    log::info!("[LLM-SCORES] Creating _llm_scores stream schema for {org_id}/{stream_name}");

    let expected_schema = expected_llm_scores_schema()?;

    if infra::schema::get(org_id, stream_name, stream_type)
        .await
        .is_ok_and(|ref schema| schema_eq(schema, &expected_schema))
    {
        log::debug!(
            "[LLM-SCORES] _llm_scores stream {org_id}/{stream_name} already exists with expected schema"
        );
        return Ok(());
    }

    match crate::db::schema::merge(
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
    use std::{
        sync::{
            Arc,
            atomic::{AtomicUsize, Ordering},
        },
        time::Duration,
    };

    use tokio::sync::Notify;

    use super::*;

    #[tokio::test]
    async fn concurrent_callers_wait_for_the_same_initialization() {
        let cache = Arc::new(InitializationCache::default());
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let attempts = Arc::new(AtomicUsize::new(0));

        let first = {
            let cache = Arc::clone(&cache);
            let started = Arc::clone(&started);
            let release = Arc::clone(&release);
            let attempts = Arc::clone(&attempts);
            tokio::spawn(async move {
                cache
                    .run("legacy-org", || async move {
                        attempts.fetch_add(1, Ordering::SeqCst);
                        started.notify_one();
                        release.notified().await;
                        Ok(())
                    })
                    .await
            })
        };
        started.notified().await;

        let mut second = {
            let cache = Arc::clone(&cache);
            let attempts = Arc::clone(&attempts);
            tokio::spawn(async move {
                cache
                    .run("legacy-org", || async move {
                        attempts.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    })
                    .await
            })
        };

        assert!(
            tokio::time::timeout(Duration::from_millis(25), &mut second)
                .await
                .is_err(),
            "a concurrent caller returned before schema initialization completed"
        );
        release.notify_one();
        first.await.unwrap().unwrap();
        second.await.unwrap().unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn failed_initialization_is_returned_and_retried() {
        let cache = InitializationCache::default();
        let attempts = AtomicUsize::new(0);

        let error = cache
            .run("retry-org", || async {
                attempts.fetch_add(1, Ordering::SeqCst);
                anyhow::bail!("transient failure")
            })
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "transient failure");

        cache
            .run("retry-org", || async {
                attempts.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .await
            .unwrap();
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }
    #[test]
    fn test_llm_score_reflection_has_all_fields() {
        let sample = LlmScoreRecord::init_for_reflection();
        let json_value = config::utils::json::to_value(&sample).unwrap();
        let obj = json_value.as_object().unwrap();
        assert!(obj.contains_key("id"));
        assert!(obj.contains_key("task_id"));
        assert!(obj.contains_key("eval_run_id"));
        assert!(obj.contains_key("evaluator_trace_id"));
        assert!(obj.contains_key("org_id"));
        assert!(obj.contains_key("target_scope"));
        assert!(obj.contains_key("target_id"));
        assert!(obj.contains_key("evaluation_key"));
        assert!(obj.contains_key("score_version"));
        assert!(obj.contains_key("ref_timestamp"));
        assert!(obj.contains_key("job_version"));
        assert!(obj.contains_key("span_id"));
        assert!(obj.contains_key("trace_id"));
        assert!(obj.contains_key("session_id"));
        assert!(obj.contains_key("experiment_id"));
        assert!(obj.contains_key("row_id"));
        assert!(obj.contains_key("trial_index"));
        assert!(obj.contains_key("record_ts"));
        assert!(obj.contains_key("status"));
        assert!(obj.contains_key("skip_reason"));
        assert!(obj.contains_key("level"));
        assert!(obj.contains_key("name"));
        assert!(obj.contains_key("value_numeric"));
        assert!(obj.contains_key("value_categorical"));
        assert!(obj.contains_key("value_boolean"));
        assert!(obj.contains_key("data_type"));
        assert!(obj.contains_key("score_config_id"));
        assert!(obj.contains_key("score_config_row_id"));
        assert!(obj.contains_key("review_submission_id"));
        assert!(obj.contains_key("queue_id"));
        assert!(obj.contains_key("queue_item_id"));
        assert!(obj.contains_key("review_submission_score_count"));
        assert!(obj.contains_key("reasoning"));
        assert!(obj.contains_key("review_submission_comments"));
        assert!(obj.contains_key("scorer_id"));
        assert!(obj.contains_key("source_stream_type"));
        assert!(!obj.contains_key("agent_name"));
        assert!(!obj.contains_key("agent_id"));
        assert!(!obj.contains_key("target_agent_name"));
        assert!(!obj.contains_key("target_agent_id"));
        assert!(obj.contains_key("_timestamp"));
    }

    #[test]
    fn test_llm_score_reflection_schema_has_all_value_fields() {
        let schema = expected_llm_scores_schema().unwrap();

        assert!(schema.field_with_name("value_numeric").is_ok());
        assert!(schema.field_with_name("value_categorical").is_ok());
        assert!(schema.field_with_name("value_boolean").is_ok());
        assert!(schema.field_with_name("ref_timestamp").is_ok());
        assert!(schema.field_with_name("row_id").is_ok());
        assert!(schema.field_with_name("trial_index").is_ok());
        assert!(schema.field_with_name("record_ts").is_ok());
        assert!(schema.field_with_name("status").is_ok());
        assert!(schema.field_with_name("skip_reason").is_ok());
        assert!(schema.field_with_name("score_config_row_id").is_ok());
        assert!(schema.field_with_name("review_submission_id").is_ok());
        assert!(schema.field_with_name("queue_id").is_ok());
        assert!(schema.field_with_name("queue_item_id").is_ok());
        assert!(
            schema
                .field_with_name("review_submission_score_count")
                .is_ok()
        );
        assert!(schema.field_with_name("review_submission_comments").is_ok());
    }

    #[test]
    fn experiment_id_index_is_added_once_with_its_update_time() {
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
