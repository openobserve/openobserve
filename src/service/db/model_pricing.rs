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

use config::meta::model_pricing::{BUILT_IN_ORG, META_ORG, ModelPricingDefinition, PricingSource};
use dashmap::DashMap;
use infra::table;
use once_cell::sync::Lazy;
use regex::{Regex, RegexBuilder};

const WATCHER_PREFIX: &str = "/model_pricing/";

/// Maximum compiled regex size (bytes). Limits NFA state-set size to prevent
/// pathological patterns from consuming excessive CPU on the hot path.
pub const REGEX_SIZE_LIMIT: usize = 10 * 1024; // 10 KB

/// Cached model pricing entry with pre-compiled regex.
#[derive(Clone)]
pub struct CachedModelPricing {
    pub definition: ModelPricingDefinition,
    pub compiled_regex: Regex,
}

/// Per-org raw entries: org_id -> sorted Vec of that org's own enabled entries.
/// Updated by `reload_org` on startup and coordinator events.
static CACHE: Lazy<DashMap<String, Arc<Vec<CachedModelPricing>>>> = Lazy::new(DashMap::new);

/// Lazily-computed merged views: org_id -> (org source Arc, meta source Arc, merged result).
/// Valid as long as the source `Arc` pointers haven't changed (checked via `Arc::ptr_eq`).
/// This avoids re-merging on every span — the merge only happens once after a pricing change.
static MERGED: Lazy<DashMap<String, MergedEntry>> = Lazy::new(DashMap::new);

/// A cached merge of org + meta + built-in entries, valid while the source `Arc`s are unchanged.
struct MergedEntry {
    org_source: Arc<Vec<CachedModelPricing>>,
    meta_source: Option<Arc<Vec<CachedModelPricing>>>,
    built_in_source: Option<Arc<Vec<CachedModelPricing>>>,
    merged: Arc<Vec<CachedModelPricing>>,
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

/// Build a sorted, compiled entry list from raw definitions (skips disabled / bad regex).
fn build_entries(definitions: Vec<ModelPricingDefinition>) -> Vec<CachedModelPricing> {
    let mut entries: Vec<CachedModelPricing> = definitions
        .into_iter()
        .filter(|d| d.enabled)
        .filter_map(|def| {
            match RegexBuilder::new(&def.match_pattern)
                .size_limit(REGEX_SIZE_LIMIT)
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

/// Return the effective pricing entries for an org: org-specific entries merged with `META_ORG`
/// and `BUILT_IN_ORG` entries, sorted by priority (org > meta > built-in) then `sort_order`.
/// The result is lazily cached — the merge only runs once after a pricing change, making the
/// hot path a single `Arc::clone`.
pub fn get_org_pricing_entries(org_id: &str) -> Arc<Vec<CachedModelPricing>> {
    let org_arc = CACHE.get(org_id).map(|e| Arc::clone(e.value()));
    let meta_arc = if org_id != META_ORG && org_id != BUILT_IN_ORG {
        CACHE.get(META_ORG).map(|e| Arc::clone(e.value()))
    } else {
        None
    };
    let built_in_arc = if org_id != BUILT_IN_ORG {
        CACHE.get(BUILT_IN_ORG).map(|e| Arc::clone(e.value()))
    } else {
        None
    };

    // Fast path: only one source has data.
    let sources_present =
        org_arc.is_some() as u8 + meta_arc.is_some() as u8 + built_in_arc.is_some() as u8;
    if sources_present == 0 {
        return Arc::default();
    }
    if sources_present == 1 {
        if let Some(ref org) = org_arc {
            return Arc::clone(org);
        }
        if let Some(ref meta) = meta_arc {
            return Arc::clone(meta);
        }
        if let Some(ref bi) = built_in_arc {
            return Arc::clone(bi);
        }
    }

    // Multiple sources — check the lazy merged cache.
    let org_arc = org_arc.unwrap_or_default();

    if let Some(cached) = MERGED.get(org_id) {
        let org_eq = Arc::ptr_eq(&cached.org_source, &org_arc);
        let meta_eq = match (&cached.meta_source, &meta_arc) {
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            (None, None) => true,
            _ => false,
        };
        let bi_eq = match (&cached.built_in_source, &built_in_arc) {
            (Some(a), Some(b)) => Arc::ptr_eq(a, b),
            (None, None) => true,
            _ => false,
        };
        if org_eq && meta_eq && bi_eq {
            return Arc::clone(&cached.merged);
        }
    }

    // Stale or missing — recompute.
    let merged = merge_entries(
        &org_arc,
        meta_arc.as_deref().map(|v| &**v),
        built_in_arc.as_deref().map(|v| &**v),
    );
    let result = Arc::clone(&merged);
    MERGED.insert(
        org_id.to_string(),
        MergedEntry {
            org_source: org_arc,
            meta_source: meta_arc,
            built_in_source: built_in_arc,
            merged,
        },
    );
    result
}

/// Merge org + meta + built-in entries into a single sorted list.
/// Priority: org (0) > meta (1) > built-in (2) at the same sort_order.
fn merge_entries(
    org: &[CachedModelPricing],
    meta: Option<&[CachedModelPricing]>,
    built_in: Option<&[CachedModelPricing]>,
) -> Arc<Vec<CachedModelPricing>> {
    let meta = meta.unwrap_or_default();
    let built_in = built_in.unwrap_or_default();
    let mut merged = Vec::with_capacity(org.len() + meta.len() + built_in.len());
    merged.extend_from_slice(org);
    merged.extend_from_slice(meta);
    merged.extend_from_slice(built_in);
    merged.sort_by(|x, y| {
        x.definition
            .sort_order
            .cmp(&y.definition.sort_order)
            .then_with(|| {
                // Priority order: Org (0) < MetaOrg (1) < BuiltIn (2)
                source_priority(&x.definition.source).cmp(&source_priority(&y.definition.source))
            })
            .then_with(|| x.definition.name.cmp(&y.definition.name))
    });
    Arc::new(merged)
}

fn source_priority(source: &PricingSource) -> u8 {
    match source {
        PricingSource::Org => 0,
        PricingSource::MetaOrg => 1,
        PricingSource::BuiltIn => 2,
    }
}

/// Sync lookup: find the best matching pricing definition from pre-loaded entries.
///
/// When `span_ts_micros` is Some, only definitions where `valid_from <= span_ts` are
/// considered. Selection priority:
///   1. Source priority: Org > MetaOrg > BuiltIn  (higher-priority source always wins)
///   2. Within the same source, the greatest `valid_from` (most recent) wins.
///   3. Within the same source and `valid_from`, the merge-order position (sort_order then name) is
///      used as the final tiebreaker — earlier in the list wins.
///
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
        let is_better = match &best {
            None => true,
            Some(b) => {
                let new_prio = source_priority(&entry.definition.source);
                let best_prio = source_priority(&b.definition.source);
                if new_prio != best_prio {
                    // Lower priority number = higher precedence (Org=0 beats MetaOrg=1 beats
                    // BuiltIn=2)
                    new_prio < best_prio
                } else {
                    // Same source level: prefer the most recent valid_from.
                    // None means "valid for all time" — treated as i64::MIN so that
                    // an entry with an explicit valid_from is preferred when available.
                    let new_vf = entry.definition.valid_from.unwrap_or(i64::MIN);
                    let best_vf = b.definition.valid_from.unwrap_or(i64::MIN);
                    new_vf > best_vf
                }
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
    let tier = match select_tier(definition, usage) {
        Some(t) => t,
        None => {
            log::warn!(
                "[model_pricing] no tiers in definition '{}' — returning empty cost",
                definition.name,
            );
            return CostResult {
                cost: HashMap::new(),
                tier_name: String::new(),
            };
        }
    };
    let tier_name = tier.name.clone();

    let mut cost = HashMap::new();
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
) -> Option<&'a config::meta::model_pricing::PricingTierDefinition> {
    // Evaluate conditional tiers in order; first match wins.
    for tier in &definition.tiers {
        if let Some(ref cond) = tier.condition {
            let actual = usage.get(&cond.usage_key).copied().unwrap_or(0) as f64;
            if cond.operator.evaluate(actual, cond.value) {
                return Some(tier);
            }
        }
    }

    // Fallback: first tier without a condition, or the very first tier.
    definition
        .tiers
        .iter()
        .find(|t| t.condition.is_none())
        .or_else(|| definition.tiers.first())
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
/// `org_id` is used both for the DB query (defence-in-depth org scoping) and the coordinator
/// event key (cache invalidation). Returns `Ok(true)` if deleted, `Ok(false)` if not found.
/// Returns an error if the entry is built-in.
pub async fn delete_by_id(org_id: &str, id: &str) -> Result<bool, anyhow::Error> {
    let deleted = table::model_pricing::delete_by_id(org_id, id).await?;
    if deleted {
        let event_key = format!("{WATCHER_PREFIX}{org_id}/{id}");
        if let Err(e) = infra::coordinator::model_pricing::emit_delete_event(&event_key).await {
            log::error!("[model_pricing] failed to emit delete event: {e}");
        }
    }
    Ok(deleted)
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
    fn test_meta_org_merge() {
        let meta_entries = Arc::new(build_entries(vec![ModelPricingDefinition {
            name: "gpt-4o-meta".to_string(),
            match_pattern: "(?i)^gpt-4o".to_string(),
            enabled: true,
            tiers: vec![PricingTierDefinition {
                name: "Default".to_string(),
                condition: None,
                prices: HashMap::from([("input".to_string(), 0.000003)]),
            }],
            ..Default::default()
        }]));
        CACHE.insert(META_ORG.to_string(), meta_entries);

        // --- Case 1: Org with no own entries gets META_ORG entries ---
        let entries = get_org_pricing_entries("test_merge_org_empty");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].definition.name, "gpt-4o-meta");

        // --- Case 2: META_ORG itself does NOT include itself twice ---
        let entries = get_org_pricing_entries(META_ORG);
        assert_eq!(entries.len(), 1);

        // --- Case 3: Org with own entries gets both merged (no implicit priority) ---
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
        CACHE.insert("test_merge_org_acme".to_string(), org_entries);

        let entries = get_org_pricing_entries("test_merge_org_acme");
        assert_eq!(entries.len(), 2);
        // Both entries are present; which one matches is determined by enabled status + sort_order,
        // not by implicit priority between org and meta.
        let names: Vec<&str> = entries.iter().map(|e| e.definition.name.as_str()).collect();
        assert!(names.contains(&"gpt-4o-acme"));
        assert!(names.contains(&"gpt-4o-meta"));

        // --- Case 4: Repeated call returns cached merge (Arc::ptr_eq) ---
        let first = get_org_pricing_entries("test_merge_org_acme");
        let second = get_org_pricing_entries("test_merge_org_acme");
        assert!(
            Arc::ptr_eq(&first, &second),
            "repeated call should return same Arc"
        );

        // Cleanup
        MERGED.remove("test_merge_org_empty");
        MERGED.remove("test_merge_org_acme");
        CACHE.remove(META_ORG);
        CACHE.remove("test_merge_org_acme");
    }

    #[test]
    fn test_find_pricing_source_priority_org_beats_builtin() {
        // An Org entry with valid_from=None should beat a BuiltIn entry with a specific
        // valid_from, because source priority (Org > BuiltIn) takes precedence.
        let entries = vec![
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-org".to_string(),
                    valid_from: None, // "valid for all time"
                    source: PricingSource::Org,
                    tiers: vec![PricingTierDefinition {
                        name: "Org".to_string(),
                        condition: None,
                        prices: HashMap::from([("input".to_string(), 0.000010)]),
                    }],
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-builtin".to_string(),
                    valid_from: Some(5_000_000),
                    source: PricingSource::BuiltIn,
                    tiers: vec![PricingTierDefinition {
                        name: "BuiltIn".to_string(),
                        condition: None,
                        prices: HashMap::from([("input".to_string(), 0.000003)]),
                    }],
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
        ];

        // Org entry must win even though BuiltIn has a higher valid_from
        let result = find_pricing_sync_at(&entries, "gpt-4o", Some(6_000_000));
        assert_eq!(result.unwrap().name, "gpt-4o-org");
    }

    #[test]
    fn test_find_pricing_source_priority_org_beats_meta() {
        let entries = vec![
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-meta".to_string(),
                    valid_from: Some(5_000_000),
                    source: PricingSource::MetaOrg,
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-org".to_string(),
                    valid_from: None,
                    source: PricingSource::Org,
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
        ];

        let result = find_pricing_sync_at(&entries, "gpt-4o", Some(6_000_000));
        assert_eq!(result.unwrap().name, "gpt-4o-org");
    }

    #[test]
    fn test_find_pricing_same_source_uses_valid_from() {
        // Two Org entries: valid_from tiebreaker applies within same source
        let entries = vec![
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-old-price".to_string(),
                    valid_from: Some(1_000_000),
                    source: PricingSource::Org,
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-new-price".to_string(),
                    valid_from: Some(5_000_000),
                    source: PricingSource::Org,
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
        ];

        // At ts=6M both valid, picks newer
        let result = find_pricing_sync_at(&entries, "gpt-4o", Some(6_000_000));
        assert_eq!(result.unwrap().name, "gpt-4o-new-price");

        // At ts=3M only old is valid
        let result = find_pricing_sync_at(&entries, "gpt-4o", Some(3_000_000));
        assert_eq!(result.unwrap().name, "gpt-4o-old-price");
    }

    #[test]
    fn test_find_pricing_meta_beats_builtin() {
        let entries = vec![
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-builtin".to_string(),
                    valid_from: Some(5_000_000),
                    source: PricingSource::BuiltIn,
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-meta".to_string(),
                    valid_from: None,
                    source: PricingSource::MetaOrg,
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
        ];

        let result = find_pricing_sync_at(&entries, "gpt-4o", Some(6_000_000));
        assert_eq!(result.unwrap().name, "gpt-4o-meta");
    }

    #[test]
    fn test_find_pricing_falls_back_to_lower_priority_when_org_not_applicable() {
        // Org entry has valid_from in the future, so for an older span only BuiltIn applies
        let entries = vec![
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-org".to_string(),
                    valid_from: Some(10_000_000), // future
                    source: PricingSource::Org,
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
            CachedModelPricing {
                definition: ModelPricingDefinition {
                    name: "gpt-4o-builtin".to_string(),
                    valid_from: Some(1_000_000),
                    source: PricingSource::BuiltIn,
                    ..Default::default()
                },
                compiled_regex: Regex::new("(?i)^gpt-4o").unwrap(),
            },
        ];

        // At ts=5M, org entry's valid_from (10M) > span_ts → filtered out, builtin wins
        let result = find_pricing_sync_at(&entries, "gpt-4o", Some(5_000_000));
        assert_eq!(result.unwrap().name, "gpt-4o-builtin");

        // At ts=15M, org entry is now applicable and wins by source priority
        let result = find_pricing_sync_at(&entries, "gpt-4o", Some(15_000_000));
        assert_eq!(result.unwrap().name, "gpt-4o-org");
    }
}
