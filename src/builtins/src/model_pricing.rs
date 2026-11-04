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

//! Built-in model-pricing synchronization.
//!
//! Syncs model pricing definitions from the configured GitHub source into the database
//! under the `_openobserve` org. Runs on startup and periodically (every 6h by default).
//! Until a sync succeeds, or forever on an offline install, the seed list compiled into the
//! binary ([`SEED_PRICING_JSON`]) supplies the built-in prices.

use std::sync::{
    LazyLock,
    atomic::{AtomicI64, Ordering},
};

use config::meta::model_pricing::{
    BUILT_IN_ORG, ModelPricingDefinition, PricingSource, PricingTierDefinition,
};
use infra::table;
use serde::{Deserialize, Serialize};

use crate::github::GitHubDataService;

/// Shared GitHub data service instance (reused by the cron and the built-in endpoint).
pub static GITHUB_SERVICE: LazyLock<GitHubDataService> = LazyLock::new(GitHubDataService::new);

/// Timestamp (Unix seconds) of the last successful sync from GitHub. 0 means never synced.
static LAST_SYNC_TIMESTAMP: AtomicI64 = AtomicI64::new(0);

/// The built-in price list as of [`SEED_DATE`], shipped in the binary so prices work offline.
/// Same format as the GitHub source (`llm_pricing.json` in openobserve/sdr_patterns).
pub const SEED_PRICING_JSON: &str = include_str!("model_pricing_seed.json");

/// Date (UTC) of the upstream `llm_pricing.json` commit that [`SEED_PRICING_JSON`] copies.
pub const SEED_DATE: &str = "2026-10-28";

/// Returns the Unix timestamp (seconds) of the last successful built-in pricing sync.
/// Returns 0 if no sync has completed yet.
pub fn last_sync_timestamp() -> i64 {
    LAST_SYNC_TIMESTAMP.load(Ordering::Relaxed)
}

/// Parses the compiled-in seed list.
pub fn seed_entries() -> Result<Vec<BuiltInModelPricingEntry>, anyhow::Error> {
    let raw: Vec<serde_json::Value> = serde_json::from_str(SEED_PRICING_JSON)
        .map_err(|e| anyhow::anyhow!("Failed to parse seed pricing JSON: {e}"))?;
    Ok(parse_entries(raw))
}

/// Fill missing compiled-in prices, retrying incomplete seeds without overwriting synced rows.
pub async fn load_seed() -> Result<usize, anyhow::Error> {
    let names = table::model_pricing::list_built_in_names().await?;
    let existing: std::collections::HashSet<&str> = names.iter().map(String::as_str).collect();
    let mut missing = Vec::new();
    for entry in seed_entries()? {
        if existing.contains(entry.name.as_str()) {
            continue;
        }
        let definition = entry.into_definition();
        definition.validate_tiers(true).map_err(|error| {
            anyhow::anyhow!("Invalid seed price '{}': {error}", definition.name)
        })?;
        missing.push(definition);
    }
    let created = usize::try_from(table::model_pricing::insert_missing_built_ins(missing).await?)?;
    if created > 0 {
        emit_sync_event().await;
    }
    log::info!("[model_pricing_sync] loaded {created} seed prices dated {SEED_DATE}");
    Ok(created)
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

    let raw_entries: Vec<serde_json::Value> = serde_json::from_slice(&data)
        .map_err(|e| anyhow::anyhow!("Failed to parse built-in pricing JSON: {e}"))?;
    // Names come from the raw JSON so an entry this build cannot parse is kept, not disabled.
    let upstream_names: std::collections::HashSet<String> = raw_entries
        .iter()
        .filter_map(|e| e.get("name").and_then(|n| n.as_str()).map(str::to_string))
        .collect();
    let entries = parse_entries(raw_entries);

    // Get existing built-in model names for detecting removals
    let existing_names: std::collections::HashSet<String> =
        table::model_pricing::list_built_in_names()
            .await?
            .into_iter()
            .collect();

    let (created, updated) = upsert_entries(entries, &existing_names).await;

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

    emit_sync_event().await;

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

/// Upserts catalogue entries as built-in definitions; returns (created, updated).
/// An entry whose name is in `existing_names` counts as updated.
async fn upsert_entries(
    entries: Vec<BuiltInModelPricingEntry>,
    existing_names: &std::collections::HashSet<String>,
) -> (usize, usize) {
    let mut created = 0usize;
    let mut updated = 0usize;
    for entry in entries {
        let is_new = !existing_names.contains(&entry.name);
        let definition = entry.into_definition();
        // An invalid entry could overprice every span; keep the previously stored row.
        if let Err(e) = definition.validate_tiers(true) {
            log::warn!(
                "[model_pricing_sync] skipping invalid entry '{}': {e}",
                definition.name
            );
            continue;
        }

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
    (created, updated)
}

/// Tells every node to refresh its `_openobserve` pricing cache.
async fn emit_sync_event() {
    let event_key = format!("/model_pricing/{BUILT_IN_ORG}/_sync");
    if let Err(e) = infra::coordinator::emit_put(&event_key).await {
        log::error!("[model_pricing_sync] failed to emit sync event: {e}");
    }
}

impl BuiltInModelPricingEntry {
    fn into_definition(self) -> ModelPricingDefinition {
        ModelPricingDefinition {
            id: None, // will be looked up by (org, name) on upsert
            org_id: BUILT_IN_ORG.to_string(),
            name: self.name,
            match_pattern: self.match_pattern,
            enabled: true,
            tiers: self.tiers,
            valid_from: None,
            sort_order: 0,
            source: PricingSource::BuiltIn,
            provider: self.provider,
            description: self.description,
            created_at: 0, // set by DB layer
            updated_at: 0,
            children: Vec::new(),
            prepared_rule_keys: Default::default(),
        }
    }
}

/// Parses each catalogue entry on its own so one malformed entry does not stop the whole sync.
fn parse_entries(raw: Vec<serde_json::Value>) -> Vec<BuiltInModelPricingEntry> {
    raw.into_iter()
        .filter_map(|value| {
            let name = value
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("<unnamed>")
                .to_string();
            serde_json::from_value(value)
                .inspect_err(|e| log::warn!("[model_pricing_sync] skipping entry '{name}': {e}"))
                .ok()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The seed list is all an offline install has, so every entry must parse and validate
    /// without any network access.
    #[test]
    fn test_seed_list_loads_offline() {
        let raw: Vec<serde_json::Value> = serde_json::from_str(SEED_PRICING_JSON).unwrap();
        let entries = seed_entries().unwrap();
        assert!(
            entries.len() > 50,
            "seed list has {} entries",
            entries.len()
        );
        assert_eq!(entries.len(), raw.len(), "an entry failed to parse");
        for entry in entries {
            let definition = entry.into_definition();
            definition
                .validate_tiers(true)
                .unwrap_or_else(|e| panic!("{}: {e}", definition.name));
        }
        assert!(chrono::NaiveDate::parse_from_str(SEED_DATE, "%Y-%m-%d").is_ok());
    }

    #[test]
    fn test_last_sync_timestamp_initial_value() {
        // Initial value is 0 (never synced), unless tests run after sync
        let ts = last_sync_timestamp();
        assert!(ts >= 0);
    }

    /// The built-in source (`llm_pricing.json`) lives in a separate repo, so this
    /// pins the exact JSON shape a peak/off-peak entry uses — DeepSeek V4 here.
    #[test]
    fn test_parse_built_in_entry_with_utc_windows() {
        let json = r#"[
          {
            "name": "DeepSeek V4 Pro",
            "provider": "DeepSeek",
            "description": "DeepSeek V4 Pro",
            "match_pattern": "(?i)deepseek-v4-pro",
            "tiers": [
              {
                "name": "Off-Peak",
                "prices": { "input": 6.6e-07, "output": 1.98e-06 }
              },
              {
                "name": "Peak (01:00-04:00, 06:00-10:00 UTC)",
                "utc_windows": [
                  { "start_minute": 60, "end_minute": 240 },
                  { "start_minute": 360, "end_minute": 600 }
                ],
                "prices": { "input": 1.32e-06, "output": 3.96e-06 }
              }
            ]
          }
        ]"#;

        let entries: Vec<BuiltInModelPricingEntry> = serde_json::from_str(json).unwrap();
        assert_eq!(entries.len(), 1);
        let tiers = &entries[0].tiers;
        assert_eq!(tiers.len(), 2);

        // The unrestricted off-peak tier is listed FIRST on purpose: a binary that
        // predates `utc_windows` ignores the field, and its fallback lookup picks the
        // first tier with no condition — which must be the cheaper off-peak rate.
        assert!(tiers[0].utc_windows.is_empty());
        assert!(tiers[0].condition.is_none());

        assert_eq!(tiers[1].utc_windows.len(), 2);
        assert_eq!(tiers[1].utc_windows[0].start_minute, 60);
        assert_eq!(tiers[1].utc_windows[0].end_minute, 240);
        assert_eq!(tiers[1].utc_windows[1].start_minute, 360);
        assert_eq!(tiers[1].utc_windows[1].end_minute, 600);

        // Peak is exactly double off-peak on every priced key.
        for key in ["input", "output"] {
            let off = tiers[0].prices[key];
            let peak = tiers[1].prices[key];
            assert!(
                (peak - off * 2.0).abs() < 1e-15,
                "{key}: {peak} != 2 * {off}"
            );
        }
    }

    /// Pins the JSON shape of a service-tier entry (OpenAI Flex) in `llm_pricing.json`.
    #[test]
    fn test_parse_built_in_entry_with_rules() {
        use config::meta::model_pricing::RuleOp;

        let json = r#"[
          {
            "name": "GPT-6 Sol",
            "provider": "OpenAI",
            "description": "OpenAI GPT-6 Sol",
            "match_pattern": "(?i)gpt-6-sol",
            "tiers": [
              {
                "name": "Default",
                "prices": { "input": 2e-06, "output": 1e-05 }
              },
              {
                "name": "Extended Context (272k+)",
                "condition": { "usage_key": "input", "operator": "gte", "value": 272000 },
                "prices": { "input": 4e-06, "output": 1.5e-05 }
              },
              {
                "name": "Flex",
                "rules": [
                  {
                    "keys": ["openai.response.service_tier", "openai.request.service_tier"],
                    "op": "in",
                    "values": ["flex"]
                  }
                ],
                "prices": { "input": 1e-06, "output": 5e-06 }
              },
              {
                "name": "Flex · Extended Context (272k+)",
                "condition": { "usage_key": "input", "operator": "gte", "value": 272000 },
                "rules": [
                  {
                    "keys": ["openai.response.service_tier", "openai.request.service_tier"],
                    "op": "in",
                    "values": ["flex"]
                  }
                ],
                "prices": { "input": 2e-06, "output": 7.5e-06 }
              }
            ]
          }
        ]"#;

        let entries: Vec<BuiltInModelPricingEntry> = serde_json::from_str(json).unwrap();
        let tiers = &entries[0].tiers;
        assert_eq!(tiers.len(), 4);

        // Plain tiers come first so binaries that predate `rules` still pick the standard rates.
        assert!(tiers[0].is_default());
        assert!(tiers[1].rules.is_empty() && tiers[1].condition.is_some());

        assert_eq!(tiers[2].rules[0].op, RuleOp::In);
        assert_eq!(tiers[2].rules[0].keys[0], "openai.response.service_tier");
        assert_eq!(tiers[2].rules[0].values, vec!["flex"]);
        assert!(tiers[2].condition.is_none());
        assert_eq!(tiers[3].restriction_count(), 2);
    }

    #[test]
    fn test_parse_entries_skips_only_malformed_entries() {
        let raw: Vec<serde_json::Value> = serde_json::from_str(
            r#"[
              {"name": "Good", "match_pattern": "good", "tiers": [{"name": "Default", "prices": {"input": 1e-6}}]},
              {"name": "Broken", "match_pattern": "broken", "tiers": "not-a-list"},
              {"name": "Future", "match_pattern": "future", "tiers": [
                {"name": "Default", "prices": {"input": 1e-6}},
                {"name": "New op", "rules": [{"keys": ["k"], "op": "regex", "values": ["v"]}], "prices": {"input": 2e-6}}
              ]}
            ]"#,
        )
        .unwrap();
        let names: Vec<String> = parse_entries(raw).into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["Good", "Future"]);
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
