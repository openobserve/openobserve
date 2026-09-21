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
        self_reporting::redaction::{REDACTION_EVIDENCE_STREAM, RedactionEvidence},
        stream::{StreamSettings, StreamType},
    },
    utils::{schema::schema_eq, time::now_micros},
};
use dashmap::DashMap;
use tokio::sync::OnceCell;

// Auditors filter on stream, row kind, and pattern identity.
const INDEX_FIELDS: [&str; 3] = ["stream_name", "kind", "pattern_hash"];

// Stable org cells keep failures retryable and make success a node-lifetime no-op.
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

/// Initialize the canonical `_redaction_evidence` schema once per org.
pub async fn ensure_redaction_evidence_stream_initialized(org_id: &str) -> Result<()> {
    INITIALIZATION_CACHE
        .run(org_id, || async {
            initialize_redaction_evidence_stream_schema(org_id)
                .await
                .inspect_err(|e| {
                    log::warn!(
                        "[SDR-EVIDENCE] Failed to initialize {REDACTION_EVIDENCE_STREAM} schema for org {org_id}: {e}"
                    );
                })?;
            initialize_index_fields(org_id).await.inspect_err(|e| {
                log::warn!("[SDR-EVIDENCE] Failed to initialize index fields for org {org_id}: {e}");
            })?;
            Ok(())
        })
        .await
}

async fn initialize_redaction_evidence_stream_schema(org_id: &str) -> Result<()> {
    let expected_schema = RedactionEvidence::schema_for_reflection()?;

    if infra::schema::get(org_id, REDACTION_EVIDENCE_STREAM, StreamType::Logs)
        .await
        .is_ok_and(|ref schema| schema_eq(schema, &expected_schema))
    {
        return Ok(());
    }

    crate::db::schema::merge(
        org_id,
        REDACTION_EVIDENCE_STREAM,
        StreamType::Logs,
        &expected_schema,
        Some(now_micros()),
    )
    .await
    .map_err(|e| anyhow::anyhow!("Schema creation failed: {e}"))?;

    log::info!(
        "[SDR-EVIDENCE] Created {REDACTION_EVIDENCE_STREAM} schema for {org_id} with {} fields",
        expected_schema.fields().len()
    );
    Ok(())
}

async fn initialize_index_fields(org_id: &str) -> Result<()> {
    let mut settings =
        infra::schema::get_settings(org_id, REDACTION_EVIDENCE_STREAM, StreamType::Logs)
            .await
            .map(|settings| (*settings).clone())
            .unwrap_or_default();
    if !add_index_fields(&mut settings, now_micros()) {
        return Ok(());
    }
    schema::save_stream_settings(
        org_id,
        REDACTION_EVIDENCE_STREAM,
        StreamType::Logs,
        settings,
    )
    .await?;
    Ok(())
}

fn add_index_fields(settings: &mut StreamSettings, now: i64) -> bool {
    let mut changed = false;
    for field in INDEX_FIELDS {
        if settings.index_fields.iter().any(|f| f == field) {
            continue;
        }
        settings.index_fields.push(field.to_string());
        settings
            .index_fields_updated_at
            .insert(field.to_string(), now);
        changed = true;
    }
    changed
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

    #[test]
    fn index_fields_are_added_once_with_their_update_time() {
        let mut settings = StreamSettings::default();

        assert!(add_index_fields(&mut settings, 123));
        assert!(!add_index_fields(&mut settings, 456));
        assert_eq!(
            settings.index_fields,
            vec!["stream_name", "kind", "pattern_hash"]
        );
        assert_eq!(settings.index_fields_updated_at.get("kind"), Some(&123));
    }

    #[test]
    fn a_pre_existing_index_field_does_not_block_the_others() {
        let mut settings = StreamSettings::default();
        settings.index_fields.push("kind".to_string());

        assert!(add_index_fields(&mut settings, 7));
        assert!(settings.index_fields.contains(&"pattern_hash".to_string()));
        assert_eq!(settings.index_fields_updated_at.get("kind"), None);
    }

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
                    .run("evidence-org", || async move {
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
                    .run("evidence-org", || async move {
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
}
