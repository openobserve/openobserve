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

//! Model Pricing Service Layer
//!
//! Provides CRUD operations with an in-memory cache for fast hot-path lookups.
//! The cache follows the standard OpenObserve watch/cache pattern:
//! - `cache()` loads all entries from DB at startup.
//! - `watch()` subscribes to coordinator events and updates the cache on every node.
//! - Write operations emit coordinator events so all nodes stay in sync. User-defined models take
//!   priority over built-in models during cost calculation.

use std::{collections::HashMap, sync::Arc};

use config::meta::model_pricing::ModelPricingDefinition;
use dashmap::DashMap;
use infra::table;
use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};

/// The meta org whose model pricing definitions are inherited by all other orgs.
const META_ORG: &str = "_meta";

const WATCHER_PREFIX: &str = "/model_pricing/";

/// Cached model pricing entry with pre-compiled regex.
#[derive(Clone)]
pub struct CachedModelPricing {
    pub definition: ModelPricingDefinition,
    pub compiled_regex: Regex,
}

/// In-memory cache: org_id -> sorted Vec of enabled entries (pre-compiled regex).
/// Wrapped in Arc so `get_org_pricing_entries` returns a cheap refcount bump
/// instead of cloning every entry on every trace request.
/// Populated at startup via `cache()` and kept current via `watch()`.
static CACHE: Lazy<Arc<DashMap<String, Arc<Vec<CachedModelPricing>>>>> =
    Lazy::new(|| Arc::new(DashMap::new()));

// ── Cache helpers ─────────────────────────────────────────────────────────────

/// Build a sorted, compiled entry list from raw definitions (skips disabled / bad regex).
fn build_entries(definitions: Vec<ModelPricingDefinition>) -> Vec<CachedModelPricing> {
    let mut entries: Vec<CachedModelPricing> = definitions
        .into_iter()
        .filter(|d| d.enabled)
        .filter_map(|def| {
            match RegexBuilder::new(&def.match_pattern)
                .size_limit(1 << 16)
                .build()
            {
                Ok(re) => Some(CachedModelPricing {
                    definition: def,
                    compiled_regex: re,
                }),
                Err(e) => {
                    log::warn!(
                        "[model_pricing] invalid regex '{}' for model '{}': {e}",
                        def.match_pattern,
                        def.name,
                    );
                    None
                }
            }
        })
        .collect();

    // Lower sort_order wins; ties broken alphabetically.
    entries.sort_by(|a, b| {
        a.definition
            .sort_order
            .cmp(&b.definition.sort_order)
            .then_with(|| a.definition.name.cmp(&b.definition.name))
    });
    entries
}

/// Reload the cache for a single org from the database.
async fn reload_org(org_id: &str) {
    match table::model_pricing::list(org_id).await {
        Ok(defs) => {
            CACHE.insert(org_id.to_string(), Arc::new(build_entries(defs)));
        }
        Err(e) => {
            log::error!("[model_pricing] failed to reload cache for org '{org_id}': {e}");
        }
    }
}

// ── Public cache API ──────────────────────────────────────────────────────────

/// Return the pre-loaded pricing entries for an org with `META_ORG` fallback.
///
/// Resolution: org-specific entries first, then `META_ORG` entries appended as fallback.
/// Since `find_pricing_sync_at` picks the first regex match, org-specific entries naturally
/// take priority over inherited meta org entries.
///
/// Returns an `Arc` so the caller gets a cheap refcount bump instead of cloning.
pub fn get_org_pricing_entries(org_id: &str) -> Arc<Vec<CachedModelPricing>> {
    let org_entries = CACHE.get(org_id).map(|e| Arc::clone(e.value()));
    let default_entries = if org_id != META_ORG {
        CACHE.get(META_ORG).map(|e| Arc::clone(e.value()))
    } else {
        None
    };

    match (org_entries, default_entries) {
        // Org has entries, no defaults — return org entries directly (zero-copy).
        (Some(org), None) => org,
        // No org entries, has defaults — return defaults directly (zero-copy).
        (None, Some(def)) => def,
        // Both present — merge: org first, then defaults.
        (Some(org), Some(def)) => {
            let mut merged = Vec::with_capacity(org.len() + def.len());
            merged.extend_from_slice(&org);
            merged.extend_from_slice(&def);
            Arc::new(merged)
        }
        // Neither — empty.
        (None, None) => Arc::default(),
    }
}

/// Sync lookup: find the best matching pricing definition from pre-loaded entries.
///
/// When `span_ts_micros` is Some, only definitions where `valid_from <= span_ts` are
/// considered. Among all matching definitions the one with the greatest `valid_from`
/// (most recent) is selected, giving accurate historical cost calculation.
/// When `span_ts_micros` is None, the first matching entry is returned.
pub fn find_pricing_sync_at(
    entries: &[CachedModelPricing],
    model_name: &str,
    span_ts_micros: Option<i64>,
) -> Option<ModelPricingDefinition> {
    let mut best: Option<&CachedModelPricing> = None;

    for entry in entries {
        if !entry.compiled_regex.is_match(model_name) {
            continue;
        }
        // If valid_from is set, it must be <= span timestamp
        if let (Some(span_ts), Some(valid_from)) = (span_ts_micros, entry.definition.valid_from)
            && valid_from > span_ts
        {
            continue;
        }
        // Pick the entry with the greatest valid_from (most recent applicable price)
        let is_better = match &best {
            None => true,
            Some(b) => {
                let new_vf = entry.definition.valid_from.unwrap_or(i64::MIN);
                let best_vf = b.definition.valid_from.unwrap_or(i64::MIN);
                new_vf > best_vf
            }
        };
        if is_better {
            best = Some(entry);
        }
    }

    best.map(|e| e.definition.clone())
}

/// Result of a cost calculation, including the selected tier name for logging.
pub struct CostResult {
    pub cost: HashMap<String, f64>,
    pub tier_name: String,
}

/// Calculate cost using a model pricing definition.
/// Returns a `CostResult` with a map of usage_key -> cost and the name of the selected tier.
/// The "total" key in the usage map is always skipped — cost total is always computed as the sum
/// of individual component costs to avoid double-counting.
pub fn calculate_cost_from_definition(
    definition: &ModelPricingDefinition,
    usage: &HashMap<String, i64>,
) -> CostResult {
    let mut cost = HashMap::new();

    let tier = select_tier(definition, usage);
    let tier_name = tier.name.clone();

    let mut total = 0.0;
    for (usage_key, &token_count) in usage {
        if usage_key == "total" {
            continue;
        }
        if token_count == 0 {
            continue;
        }
        if let Some(&price_per_token) = tier.prices.get(usage_key) {
            let key_cost = token_count as f64 * price_per_token;
            if key_cost > 0.0 {
                cost.insert(usage_key.clone(), key_cost);
                total += key_cost;
            }
        } else {
            log::debug!(
                "[model_pricing] usage key '{}' has {} tokens but no price in tier '{}' — cost zero",
                usage_key,
                token_count,
                tier.name,
            );
        }
    }

    if total > 0.0 {
        cost.insert("total".to_string(), total);
    }

    CostResult { cost, tier_name }
}

fn select_tier<'a>(
    definition: &'a ModelPricingDefinition,
    usage: &HashMap<String, i64>,
) -> &'a config::meta::model_pricing::PricingTierDefinition {
    // Evaluate conditional tiers in order; first match wins.
    for tier in &definition.tiers {
        if let Some(ref cond) = tier.condition {
            let actual = usage.get(&cond.usage_key).copied().unwrap_or(0) as f64;
            if cond.operator.evaluate(actual, cond.value) {
                return tier;
            }
        }
    }

    // Fallback: first tier without a condition, or the very first tier.
    definition
        .tiers
        .iter()
        .find(|t| t.condition.is_none())
        .unwrap_or_else(|| definition.tiers.first().expect("at least one tier"))
}

// ── Startup: cache + watch ────────────────────────────────────────────────────

/// Load all model pricing definitions for all orgs into the in-memory cache.
/// Called once at startup from `job/mod.rs`.
pub async fn cache() -> Result<(), anyhow::Error> {
    let orgs = table::model_pricing::list_orgs().await?;
    for org_id in &orgs {
        let defs = table::model_pricing::list(org_id).await?;
        CACHE.insert(org_id.clone(), Arc::new(build_entries(defs)));
    }
    log::info!("[model_pricing] cache loaded for {} orgs", orgs.len());
    Ok(())
}

/// Watch for model pricing changes from other cluster nodes and update the local cache.
/// Called once at startup from `job/mod.rs` (spawned as a background task).
pub async fn watch() -> Result<(), anyhow::Error> {
    let cluster_coordinator = super::get_coordinator().await;
    let mut events = cluster_coordinator.watch(WATCHER_PREFIX).await?;
    let events = Arc::get_mut(&mut events).unwrap();
    log::info!("[model_pricing] start watching");
    loop {
        let ev = match events.recv().await {
            Some(ev) => ev,
            None => {
                log::error!("[model_pricing] watch: event channel closed");
                break;
            }
        };
        match ev {
            super::Event::Put(ev) => {
                // Key format: /model_pricing/{org_id}/{model_id}
                if let Some(org_id) = parse_org_from_key(&ev.key) {
                    reload_org(org_id).await;
                    log::debug!("[model_pricing] reloaded cache for org '{org_id}' (put)");
                }
            }
            super::Event::Delete(ev) => {
                if let Some(org_id) = parse_org_from_key(&ev.key) {
                    reload_org(org_id).await;
                    log::debug!("[model_pricing] reloaded cache for org '{org_id}' (delete)");
                }
            }
            super::Event::Empty => {}
        }
    }
    Ok(())
}

fn parse_org_from_key(key: &str) -> Option<&str> {
    // Strip prefix, then take the first path segment as org_id.
    // Key: /model_pricing/{org_id}/{model_id}
    key.strip_prefix(WATCHER_PREFIX)
        .and_then(|rest| rest.split('/').next())
        .filter(|s| !s.is_empty())
}

// ── CRUD with coordinator events ──────────────────────────────────────────────

pub async fn list(org_id: &str) -> Result<Vec<ModelPricingDefinition>, anyhow::Error> {
    Ok(table::model_pricing::list(org_id).await?)
}

pub async fn get_by_id(id: &str) -> Result<Option<ModelPricingDefinition>, anyhow::Error> {
    Ok(table::model_pricing::get_by_id(id).await?)
}

pub async fn set(item: ModelPricingDefinition) -> Result<ModelPricingDefinition, anyhow::Error> {
    let org_id = item.org_id.clone();
    let saved = table::model_pricing::put(item).await?;
    let id = saved.id.map(|id| id.to_string()).unwrap_or_default();
    let event_key = format!("{WATCHER_PREFIX}{org_id}/{id}");
    if let Err(e) = infra::coordinator::model_pricing::emit_put_event(&event_key).await {
        log::error!("[model_pricing] failed to emit put event: {e}");
    }
    Ok(saved)
}

/// Delete a model pricing definition by ID.
/// `org_id` is required for the coordinator event key (cache invalidation), not for the DB query.
/// The caller (HTTP handler) must verify ownership before calling this.
pub async fn delete_by_id(org_id: &str, id: &str) -> Result<(), anyhow::Error> {
    table::model_pricing::delete_by_id(id).await?;
    let event_key = format!("{WATCHER_PREFIX}{org_id}/{id}");
    if let Err(e) = infra::coordinator::model_pricing::emit_delete_event(&event_key).await {
        log::error!("[model_pricing] failed to emit delete event: {e}");
    }
    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use config::meta::model_pricing::{PricingTierDefinition, TierCondition, TierOperator};

    use super::*;

    fn make_definition(tiers: Vec<PricingTierDefinition>) -> ModelPricingDefinition {
        ModelPricingDefinition {
            name: "test".to_string(),
            match_pattern: "(?i)^test-model".to_string(),
            tiers,
            ..Default::default()
        }
    }

    #[test]
    fn test_select_default_tier() {
        let def = make_definition(vec![PricingTierDefinition {
            name: "Default".to_string(),
            condition: None,
            prices: HashMap::from([
                ("input".to_string(), 0.000003),
                ("output".to_string(), 0.000015),
            ]),
        }]);

        let usage = HashMap::from([("input".to_string(), 1000i64), ("output".to_string(), 500)]);
        let result = calculate_cost_from_definition(&def, &usage);
        assert_eq!(result.tier_name, "Default");
        assert!((result.cost["input"] - 0.003).abs() < 1e-10);
        assert!((result.cost["output"] - 0.0075).abs() < 1e-10);
        assert!((result.cost["total"] - 0.0105).abs() < 1e-10);
    }

    #[test]
    fn test_select_conditional_tier() {
        let def = make_definition(vec![
            PricingTierDefinition {
                name: "Default".to_string(),
                condition: None,
                prices: HashMap::from([
                    ("input".to_string(), 0.000003),
                    ("output".to_string(), 0.000015),
                ]),
            },
            PricingTierDefinition {
                name: "Extended Context".to_string(),
                condition: Some(TierCondition {
                    usage_key: "input".to_string(),
                    operator: TierOperator::Gt,
                    value: 200_000.0,
                }),
                prices: HashMap::from([
                    ("input".to_string(), 0.000006),
                    ("output".to_string(), 0.0000225),
                ]),
            },
        ]);

        // Below threshold: default tier
        let usage = HashMap::from([
            ("input".to_string(), 50_000i64),
            ("output".to_string(), 10_000),
        ]);
        let result = calculate_cost_from_definition(&def, &usage);
        assert_eq!(result.tier_name, "Default");
        assert!((result.cost["input"] - 0.15).abs() < 1e-10);

        // Above threshold: extended tier
        let usage = HashMap::from([
            ("input".to_string(), 250_000i64),
            ("output".to_string(), 10_000),
        ]);
        let result = calculate_cost_from_definition(&def, &usage);
        assert_eq!(result.tier_name, "Extended Context");
        assert!((result.cost["input"] - 1.5).abs() < 1e-10);
        assert!((result.cost["output"] - 0.225).abs() < 1e-10);
    }

    #[test]
    fn test_find_pricing_sync_matches_first() {
        let entries = vec![
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "custom-gpt4o".to_string(),
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "other-gpt4o".to_string(),
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
        ];

        let result = find_pricing_sync_at(&entries, "gpt-4o-2024-05-13", None);
        assert!(result.is_some());
        assert_eq!(result.unwrap().name, "custom-gpt4o");
    }

    #[test]
    fn test_find_pricing_sync_no_match() {
        let entries = vec![CachedModelPricing {
            definition: ModelPricingDefinition {
                name: "gpt-4o".to_string(),
                ..Default::default()
            },
            compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
        }];

        assert!(find_pricing_sync_at(&entries, "claude-sonnet-4-6", None).is_none());
    }

    #[test]
    fn test_find_pricing_sync_empty_entries() {
        assert!(find_pricing_sync_at(&[], "gpt-4o", None).is_none());
    }

    #[test]
    fn test_calculate_cost_zero_usage() {
        let def = make_definition(vec![PricingTierDefinition {
            name: "Default".to_string(),
            condition: None,
            prices: HashMap::from([
                ("input".to_string(), 0.000003),
                ("output".to_string(), 0.000015),
            ]),
        }]);

        let usage = HashMap::from([("input".to_string(), 0i64), ("output".to_string(), 0)]);
        let result = calculate_cost_from_definition(&def, &usage);
        assert!(result.cost.is_empty());
    }

    #[test]
    fn test_parse_org_from_key() {
        assert_eq!(
            parse_org_from_key("/model_pricing/myorg/abc123"),
            Some("myorg")
        );
        assert_eq!(parse_org_from_key("/model_pricing/"), None);
        assert_eq!(parse_org_from_key("/other/myorg/id"), None);
    }

    #[test]
    fn test_valid_from_selects_most_recent() {
        // Two entries match "gpt-4o" but with different valid_from timestamps.
        // The one with the greatest valid_from <= span_ts should win.
        let entries = vec![
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-old".to_string(),
                    valid_from: Some(1_000_000), // old
                    tiers: vec![PricingTierDefinition {
                        name: "Old".to_string(),
                        condition: None,
                        prices: HashMap::from([("input".to_string(), 0.000001)]),
                    }],
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-new".to_string(),
                    valid_from: Some(5_000_000), // newer
                    tiers: vec![PricingTierDefinition {
                        name: "New".to_string(),
                        condition: None,
                        prices: HashMap::from([("input".to_string(), 0.000005)]),
                    }],
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
        ];

        // Span at ts=6M → both valid, picks newer (valid_from=5M)
        let result = find_pricing_sync_at(&entries, "gpt-4o", Some(6_000_000));
        assert_eq!(result.unwrap().name, "gpt-4o-new");

        // Span at ts=3M → only old is valid (valid_from=1M <= 3M, 5M > 3M)
        let result = find_pricing_sync_at(&entries, "gpt-4o", Some(3_000_000));
        assert_eq!(result.unwrap().name, "gpt-4o-old");

        // Span at ts=500k → neither valid
        let result = find_pricing_sync_at(&entries, "gpt-4o", Some(500_000));
        assert!(result.is_none());
    }

    #[test]
    fn test_total_key_in_usage_is_skipped() {
        // "total" in usage map should not be double-counted
        let def = make_definition(vec![PricingTierDefinition {
            name: "Default".to_string(),
            condition: None,
            prices: HashMap::from([
                ("input".to_string(), 0.000003),
                ("output".to_string(), 0.000015),
                ("total".to_string(), 0.0001), // should be ignored
            ]),
        }]);

        let usage = HashMap::from([
            ("input".to_string(), 1000i64),
            ("output".to_string(), 500),
            ("total".to_string(), 1500), // should be skipped
        ]);
        let result = calculate_cost_from_definition(&def, &usage);
        // total should be computed as sum of input+output costs, not from the "total" usage key
        assert!((result.cost["input"] - 0.003).abs() < 1e-10);
        assert!((result.cost["output"] - 0.0075).abs() < 1e-10);
        assert!((result.cost["total"] - 0.0105).abs() < 1e-10);
        assert_eq!(result.cost.len(), 3); // input, output, total
    }

    #[test]
    fn test_usage_key_without_price_is_zero_cost() {
        let def = make_definition(vec![PricingTierDefinition {
            name: "Default".to_string(),
            condition: None,
            prices: HashMap::from([("input".to_string(), 0.000003)]),
        }]);

        // "output" has tokens but no price configured → should not appear in cost
        let usage = HashMap::from([("input".to_string(), 1000i64), ("output".to_string(), 500)]);
        let result = calculate_cost_from_definition(&def, &usage);
        assert!((result.cost["input"] - 0.003).abs() < 1e-10);
        assert!(!result.cost.contains_key("output"));
        assert!((result.cost["total"] - 0.003).abs() < 1e-10);
    }

    #[test]
    fn test_all_tier_operators() {
        let make_tiered = |op: TierOperator| {
            make_definition(vec![
                PricingTierDefinition {
                    name: "Conditional".to_string(),
                    condition: Some(TierCondition {
                        usage_key: "input".to_string(),
                        operator: op,
                        value: 100.0,
                    }),
                    prices: HashMap::from([("input".to_string(), 0.00001)]),
                },
                PricingTierDefinition {
                    name: "Default".to_string(),
                    condition: None,
                    prices: HashMap::from([("input".to_string(), 0.000001)]),
                },
            ])
        };

        let usage_50 = HashMap::from([("input".to_string(), 50i64)]);
        let usage_100 = HashMap::from([("input".to_string(), 100i64)]);
        let usage_150 = HashMap::from([("input".to_string(), 150i64)]);

        // Gt: 150 > 100 → conditional, 100 !> 100 → default
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Gt), &usage_150).tier_name,
            "Conditional"
        );
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Gt), &usage_100).tier_name,
            "Default"
        );

        // Gte: 100 >= 100 → conditional, 50 !>= 100 → default
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Gte), &usage_100).tier_name,
            "Conditional"
        );
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Gte), &usage_50).tier_name,
            "Default"
        );

        // Lt: 50 < 100 → conditional, 100 !< 100 → default
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Lt), &usage_50).tier_name,
            "Conditional"
        );
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Lt), &usage_100).tier_name,
            "Default"
        );

        // Lte: 100 <= 100 → conditional, 150 !<= 100 → default
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Lte), &usage_100).tier_name,
            "Conditional"
        );
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Lte), &usage_150).tier_name,
            "Default"
        );

        // Eq: 100 == 100 → conditional, 50 != 100 → default
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Eq), &usage_100).tier_name,
            "Conditional"
        );
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Eq), &usage_50).tier_name,
            "Default"
        );

        // Neq: 50 != 100 → conditional, 100 == 100 → default
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Neq), &usage_50).tier_name,
            "Conditional"
        );
        assert_eq!(
            calculate_cost_from_definition(&make_tiered(TierOperator::Neq), &usage_100).tier_name,
            "Default"
        );
    }

    #[test]
    fn test_build_entries_skips_disabled() {
        let entries = build_entries(vec![
            ModelPricingDefinition {
                name: "enabled".to_string(),
                match_pattern: "(?i)^test".to_string(),
                enabled: true,
                tiers: vec![PricingTierDefinition {
                    name: "Default".to_string(),
                    condition: None,
                    prices: HashMap::from([("input".to_string(), 0.000001)]),
                }],
                ..Default::default()
            },
            ModelPricingDefinition {
                name: "disabled".to_string(),
                match_pattern: "(?i)^test".to_string(),
                enabled: false,
                tiers: vec![PricingTierDefinition {
                    name: "Default".to_string(),
                    condition: None,
                    prices: HashMap::from([("input".to_string(), 0.000001)]),
                }],
                ..Default::default()
            },
        ]);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].definition.name, "enabled");
    }

    #[test]
    fn test_build_entries_skips_invalid_regex() {
        let entries = build_entries(vec![
            ModelPricingDefinition {
                name: "valid".to_string(),
                match_pattern: "(?i)^test".to_string(),
                enabled: true,
                tiers: vec![PricingTierDefinition {
                    name: "Default".to_string(),
                    condition: None,
                    prices: HashMap::from([("input".to_string(), 0.000001)]),
                }],
                ..Default::default()
            },
            ModelPricingDefinition {
                name: "bad-regex".to_string(),
                match_pattern: "[invalid(".to_string(),
                enabled: true,
                tiers: vec![PricingTierDefinition {
                    name: "Default".to_string(),
                    condition: None,
                    prices: HashMap::from([("input".to_string(), 0.000001)]),
                }],
                ..Default::default()
            },
        ]);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].definition.name, "valid");
    }

    #[test]
    fn test_build_entries_sorted_by_sort_order() {
        let entries = build_entries(vec![
            ModelPricingDefinition {
                name: "low-priority".to_string(),
                match_pattern: "(?i)^test".to_string(),
                enabled: true,
                sort_order: 10,
                tiers: vec![PricingTierDefinition {
                    name: "Default".to_string(),
                    condition: None,
                    prices: HashMap::new(),
                }],
                ..Default::default()
            },
            ModelPricingDefinition {
                name: "high-priority".to_string(),
                match_pattern: "(?i)^test".to_string(),
                enabled: true,
                sort_order: -1,
                tiers: vec![PricingTierDefinition {
                    name: "Default".to_string(),
                    condition: None,
                    prices: HashMap::new(),
                }],
                ..Default::default()
            },
        ]);
        assert_eq!(entries[0].definition.name, "high-priority");
        assert_eq!(entries[1].definition.name, "low-priority");
    }

    // These tests share the static CACHE so they use a single test to avoid
    // parallel-test interference on the META_ORG key.
    #[test]
    fn test_default_org_fallback() {
        // Setup: insert META_ORG entries
        let default_entries = Arc::new(build_entries(vec![ModelPricingDefinition {
            name: "gpt-4o-default".to_string(),
            match_pattern: "(?i)^gpt-4o".to_string(),
            enabled: true,
            tiers: vec![PricingTierDefinition {
                name: "Default".to_string(),
                condition: None,
                prices: HashMap::from([("input".to_string(), 0.000003)]),
            }],
            ..Default::default()
        }]));
        CACHE.insert(META_ORG.to_string(), default_entries);

        // --- Case 1: Org with no entries inherits META_ORG ---
        let entries = get_org_pricing_entries("test_fallback_org_empty");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].definition.name, "gpt-4o-default");

        // --- Case 2: META_ORG itself does NOT duplicate ---
        let entries = get_org_pricing_entries(META_ORG);
        assert_eq!(entries.len(), 1);

        // --- Case 3: Org-specific entries take priority, defaults appended ---
        let org_entries = Arc::new(build_entries(vec![ModelPricingDefinition {
            name: "gpt-4o-acme".to_string(),
            match_pattern: "(?i)^gpt-4o".to_string(),
            enabled: true,
            tiers: vec![PricingTierDefinition {
                name: "Acme Custom".to_string(),
                condition: None,
                prices: HashMap::from([("input".to_string(), 0.000005)]),
            }],
            ..Default::default()
        }]));
        CACHE.insert("test_fallback_org_acme".to_string(), org_entries);

        let entries = get_org_pricing_entries("test_fallback_org_acme");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].definition.name, "gpt-4o-acme");
        assert_eq!(entries[1].definition.name, "gpt-4o-default");

        // find_pricing_sync_at should pick the org-specific one (first match)
        let matched = find_pricing_sync_at(&entries, "gpt-4o-2024-05-13", None);
        assert_eq!(matched.unwrap().name, "gpt-4o-acme");

        // Cleanup
        CACHE.remove(META_ORG);
        CACHE.remove("test_fallback_org_acme");
    }
}
