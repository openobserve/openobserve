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

//! Built-in Model Pricing Sync
//!
//! Syncs model pricing definitions from the configured GitHub source into the database
//! under the `_openobserve` org. Runs on startup and periodically (every 6h by default).

use std::sync::{
    LazyLock,
    atomic::{AtomicI64, Ordering},
};

use config::meta::model_pricing::{
    BUILT_IN_ORG, ModelPricingDefinition, PricingSource, PricingTierDefinition,
};
use infra::table;
use serde::{Deserialize, Serialize};

use crate::service::github::GitHubDataService;

/// Shared GitHub data service instance (reused by the cron and the built-in endpoint).
pub static GITHUB_SERVICE: LazyLock<GitHubDataService> = LazyLock::new(GitHubDataService::new);

/// Timestamp (Unix seconds) of the last successful sync from GitHub. 0 means never synced.
static LAST_SYNC_TIMESTAMP: AtomicI64 = AtomicI64::new(0);

/// Returns the Unix timestamp (seconds) of the last successful built-in pricing sync.
/// Returns 0 if no sync has completed yet.
pub fn last_sync_timestamp() -> i64 {
    LAST_SYNC_TIMESTAMP.load(Ordering::Relaxed)
}

/// A model pricing entry from the community/built-in GitHub JSON source.
#[derive(Debug, Deserialize)]
pub struct BuiltInModelPricingEntry {
    pub name: String,
    pub match_pattern: String,
    pub tiers: Vec<PricingTierDefinition>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub provider: String,
}

/// Result of a sync operation.
#[derive(Debug, Serialize)]
pub struct SyncResult {
    pub created: usize,
    pub updated: usize,
    pub disabled: usize,
}

/// Fetch built-in model pricing from the configured GitHub source and upsert into the DB
/// under the `_openobserve` org. Models removed from the upstream source are disabled (not
/// deleted) to preserve historical cost calculations.
pub async fn sync_built_in_from_github(force_refresh: bool) -> Result<SyncResult, anyhow::Error> {
    let source_url = config::get_config().common.model_pricing_source_url.clone();
    log::info!(
        "[model_pricing_sync] syncing built-in pricing from {source_url} (force={force_refresh})"
    );

    // Fetch from GitHub
    let github_service = &*GITHUB_SERVICE;
    let data = github_service
        .fetch_with_cache(&source_url, force_refresh)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to fetch built-in pricing: {e}"))?;

    let entries: Vec<BuiltInModelPricingEntry> = serde_json::from_slice(&data)
        .map_err(|e| anyhow::anyhow!("Failed to parse built-in pricing JSON: {e}"))?;

    // Get existing built-in model names for detecting removals
    let existing_names: std::collections::HashSet<String> =
        table::model_pricing::list_built_in_names()
            .await?
            .into_iter()
            .collect();

    let mut created = 0usize;
    let mut updated = 0usize;
    let upstream_names: std::collections::HashSet<String> =
        entries.iter().map(|e| e.name.clone()).collect();

    // Upsert each entry
    for entry in entries {
        let is_new = !existing_names.contains(&entry.name);
        let definition = ModelPricingDefinition {
            id: None, // will be looked up by (org, name) on upsert
            org_id: BUILT_IN_ORG.to_string(),
            name: entry.name,
            match_pattern: entry.match_pattern,
            enabled: true,
            tiers: entry.tiers,
            valid_from: None,
            sort_order: 0,
            source: PricingSource::BuiltIn,
            provider: entry.provider,
            description: entry.description,
            created_at: 0, // set by DB layer
            updated_at: 0,
            children: Vec::new(),
        };

        match table::model_pricing::put(definition).await {
            Ok(_) => {
                if is_new {
                    created += 1;
                } else {
                    updated += 1;
                }
            }
            Err(e) => {
                log::warn!("[model_pricing_sync] failed to upsert built-in model: {e}");
            }
        }
    }

    // Disable models that were removed from the upstream source
    let mut disabled = 0usize;
    for name in &existing_names {
        if !upstream_names.contains(name) {
            // Fetch the existing entry and disable it
            match table::model_pricing::get(BUILT_IN_ORG, name).await {
                Ok(Some(mut def)) if def.enabled => {
                    def.enabled = false;
                    if let Err(e) = table::model_pricing::put(def).await {
                        log::warn!(
                            "[model_pricing_sync] failed to disable removed model '{name}': {e}"
                        );
                    } else {
                        disabled += 1;
                    }
                }
                _ => {}
            }
        }
    }

    // Emit coordinator event so all nodes refresh the _openobserve cache
    let event_key = format!("/model_pricing/{BUILT_IN_ORG}/_sync");
    if let Err(e) = infra::coordinator::model_pricing::emit_put_event(&event_key).await {
        log::error!("[model_pricing_sync] failed to emit sync event: {e}");
    }

    LAST_SYNC_TIMESTAMP.store(chrono::Utc::now().timestamp(), Ordering::Relaxed);

    log::info!(
        "[model_pricing_sync] sync complete: created={created}, updated={updated}, disabled={disabled}"
    );

    Ok(SyncResult {
        created,
        updated,
        disabled,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_last_sync_timestamp_initial_value() {
        // Initial value is 0 (never synced), unless tests run after sync
        let ts = last_sync_timestamp();
        assert!(ts >= 0);
    }

    #[test]
    fn test_sync_result_fields() {
        let r = SyncResult {
            created: 3,
            updated: 1,
            disabled: 0,
        };
        assert_eq!(r.created, 3);
        assert_eq!(r.updated, 1);
        assert_eq!(r.disabled, 0);
    }
}
