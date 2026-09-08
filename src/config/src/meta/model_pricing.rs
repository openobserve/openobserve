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

//! Model Pricing Definitions
//!
//! User-defined LLM model pricing configurations for cost tracking.
//! Each definition uses a regex match pattern to map model names to pricing tiers.
//! Prices are per-token (e.g., 0.000001 = $1/1M tokens).
//!
//! Built-in pricing for popular models lives in `pricing.rs` and is used as a
//! fallback when no user-defined definition matches a span's model name.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The meta org whose model pricing definitions are inherited by all other orgs.
pub const META_ORG: &str = "_meta";

/// The built-in org whose pricing definitions are synced from the community GitHub source.
/// These entries are read-only and managed by a background sync job.
pub const BUILT_IN_ORG: &str = "_openobserve";

/// Ownership source of a model pricing definition.
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PricingSource {
    /// Synced from the community GitHub repository. Read-only.
    BuiltIn,
    /// Defined at the meta org level by super admins.
    MetaOrg,
    /// Defined or cloned by the org itself.
    #[default]
    Org,
}

impl PricingSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            PricingSource::BuiltIn => "built_in",
            PricingSource::MetaOrg => "meta_org",
            PricingSource::Org => "org",
        }
    }
}

impl From<&str> for PricingSource {
    fn from(s: &str) -> Self {
        match s {
            "built_in" => PricingSource::BuiltIn,
            "meta_org" => PricingSource::MetaOrg,
            _ => PricingSource::Org,
        }
    }
}

/// A user-defined model pricing definition that maps model names (via regex) to pricing tiers.
/// These definitions take priority over the built-in pricing in `pricing.rs`.
#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
#[serde(default)]
pub struct ModelPricingDefinition {
    /// Unique identifier (KSUID)
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    pub id: Option<svix_ksuid::Ksuid>,
    /// Organization ID
    #[serde(default)]
    pub org_id: String,
    /// Display name for the model (e.g., "GPT-4o", "Claude Sonnet 4.6")
    pub name: String,
    /// Regex pattern to match model names from incoming spans.
    /// Example: "(?i)^gpt-4o" or "(?i)^(claude-sonnet-4-6)$"
    /// Max length: 512 characters.
    pub match_pattern: String,
    /// Whether this definition is active
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Pricing tiers. The first tier without a condition is the default (fallback).
    /// Tiers with conditions are evaluated first in order; first match wins.
    pub tiers: Vec<PricingTierDefinition>,
    /// Optional Unix timestamp (microseconds) from which this definition is valid.
    /// When multiple definitions match the same model name, the one with the
    /// greatest `valid_from` that is still <= the span's start time is used.
    /// If None, the definition is valid for all time.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid_from: Option<i64>,
    /// Explicit sort order for deterministic tie-breaking when multiple definitions match the
    /// same model name and have equal (or absent) `valid_from` values.
    /// Lower values are checked first; the first match wins.
    /// Defaults to 0 — set a lower number to make a definition take priority.
    #[serde(default)]
    pub sort_order: i32,

    /// Ownership source: built_in (synced from GitHub), meta_org, or org.
    #[serde(default)]
    pub source: PricingSource,
    /// Provider name (e.g., "OpenAI", "Anthropic"). Populated for built-in entries.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub provider: String,
    /// Human-readable description. Populated for built-in entries.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    /// Created timestamp in microseconds
    #[serde(default)]
    pub created_at: i64,
    /// Updated timestamp in microseconds
    #[serde(default)]
    pub updated_at: i64,
    /// Definitions shadowed by this one (same match_pattern, lower source/sort priority).
    /// Only populated in list responses — not stored in the database.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<ModelPricingDefinition>,
}

/// A pricing tier within a model definition.
#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
#[serde(default)]
pub struct PricingTierDefinition {
    /// Display name for this tier (e.g., "Default", "Extended Context")
    pub name: String,
    /// Optional condition that must be met for this tier to apply.
    /// If None, this is the default (fallback) tier.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition: Option<TierCondition>,
    /// Prices per token, keyed by usage type.
    /// Keys must exactly match usage keys produced by the span extractor:
    ///   "input", "output", "cache_read_input_tokens", "cache_creation_input_tokens", etc.
    /// Values are price per single token (e.g., 0.000003 = $3/1M tokens).
    ///
    /// **Precision note:** `f64` provides ~15 significant decimal digits, which is more
    /// than sufficient for cost *estimation* on observability data. These values are not
    /// used for billing or financial accounting — they produce approximate cost figures
    /// for dashboards and alerts. The multiplication `token_count as f64 * price` is
    /// exact for token counts < 2^53 (~9 quadrillion), well beyond practical span sizes.
    #[serde(default)]
    pub prices: HashMap<String, f64>,
    /// Recurring UTC time-of-day windows during which this tier applies.
    ///
    /// Empty (the default) means the tier is not time-restricted. Providers such as
    /// DeepSeek publish "peak" and "off-peak" rates that repeat every day, which is a
    /// time-of-day range rather than an absolute cutover (that is what `valid_from` is
    /// for). A tier applies when the span falls in ANY of its windows *and* its
    /// `condition` (if set) passes, so windows compose with context-length tiering.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub utc_windows: Vec<UtcTimeWindow>,
}

/// Number of minutes in a day. Window bounds are normalized modulo this value, so
/// `1440` (i.e. 24:00) is accepted as an end bound and normalizes to `0`.
pub const MINUTES_PER_DAY: u32 = 1440;

/// A recurring UTC time-of-day window during which a pricing tier applies.
///
/// Bounds are minutes since UTC midnight and the range is half-open:
/// `[start_minute, end_minute)`. A window whose `start_minute` is greater than its
/// `end_minute` wraps past midnight (e.g. `990 -> 30` is 16:30–00:30 UTC). Equal
/// bounds are rejected on write — leave `utc_windows` empty for an always-on tier.
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq, Eq, ToSchema)]
#[serde(default)]
pub struct UtcTimeWindow {
    /// Inclusive start, minutes since UTC midnight (0–1440).
    pub start_minute: u32,
    /// Exclusive end, minutes since UTC midnight (0–1440).
    pub end_minute: u32,
}

impl UtcTimeWindow {
    /// Build a window from UTC clock times. `end` may be `(24, 0)` for end-of-day.
    pub fn from_hm(start: (u32, u32), end: (u32, u32)) -> Self {
        Self {
            start_minute: start.0 * 60 + start.1,
            end_minute: end.0 * 60 + end.1,
        }
    }

    /// Whether `minute_of_day` (minutes since UTC midnight) falls inside this window.
    pub fn contains(&self, minute_of_day: u32) -> bool {
        let start = self.start_minute % MINUTES_PER_DAY;
        let end = self.end_minute % MINUTES_PER_DAY;
        let m = minute_of_day % MINUTES_PER_DAY;
        if start == end {
            // Degenerate window — treat as "all day" rather than "never", so a
            // misconfigured entry still prices spans instead of silently dropping them.
            true
        } else if start < end {
            m >= start && m < end
        } else {
            // Wraps past midnight.
            m >= start || m < end
        }
    }
}

/// Minutes since UTC midnight for a Unix timestamp in microseconds.
/// Uses Euclidean division so pre-epoch timestamps stay in `0..1440`.
pub fn utc_minute_of_day(ts_micros: i64) -> u32 {
    let secs = ts_micros.div_euclid(1_000_000);
    (secs.rem_euclid(86_400) / 60) as u32
}

/// Whether a set of windows admits `ts_micros`. An empty window list is unrestricted.
/// When the timestamp is unknown, a time-restricted tier never matches — the caller
/// falls back to the unrestricted default tier.
pub fn windows_match(windows: &[UtcTimeWindow], ts_micros: Option<i64>) -> bool {
    if windows.is_empty() {
        return true;
    }
    match ts_micros {
        Some(ts) => {
            let minute = utc_minute_of_day(ts);
            windows.iter().any(|w| w.contains(minute))
        }
        None => false,
    }
}

/// Condition for a pricing tier.
#[derive(Clone, Debug, Serialize, Deserialize, Default, ToSchema)]
#[serde(default)]
pub struct TierCondition {
    /// The usage key to evaluate (e.g., "input")
    pub usage_key: String,
    /// Comparison operator
    pub operator: TierOperator,
    /// Threshold value (e.g., 200000 for extended context pricing)
    pub value: f64,
}

/// Comparison operators for tier conditions.
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TierOperator {
    #[default]
    Gt,
    Gte,
    Lt,
    Lte,
    Eq,
    Neq,
}

impl TierOperator {
    /// Tolerance for Eq/Neq comparisons. Token counts are integers cast to f64,
    /// so 0.5 is more than sufficient and avoids false negatives from f64::EPSILON
    /// being too tight for large values.
    const EQ_TOLERANCE: f64 = 0.5;

    pub fn evaluate(&self, actual: f64, threshold: f64) -> bool {
        match self {
            TierOperator::Gt => actual > threshold,
            TierOperator::Gte => actual >= threshold,
            TierOperator::Lt => actual < threshold,
            TierOperator::Lte => actual <= threshold,
            TierOperator::Eq => (actual - threshold).abs() < Self::EQ_TOLERANCE,
            TierOperator::Neq => (actual - threshold).abs() >= Self::EQ_TOLERANCE,
        }
    }
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pricing_source_as_str() {
        assert_eq!(PricingSource::BuiltIn.as_str(), "built_in");
        assert_eq!(PricingSource::MetaOrg.as_str(), "meta_org");
        assert_eq!(PricingSource::Org.as_str(), "org");
    }

    #[test]
    fn test_pricing_source_from_str() {
        assert_eq!(PricingSource::from("built_in"), PricingSource::BuiltIn);
        assert_eq!(PricingSource::from("meta_org"), PricingSource::MetaOrg);
        assert_eq!(PricingSource::from("org"), PricingSource::Org);
        // unknown → Org (default)
        assert_eq!(PricingSource::from("unknown"), PricingSource::Org);
        assert_eq!(PricingSource::from(""), PricingSource::Org);
    }

    #[test]
    fn test_pricing_source_roundtrip() {
        for src in [
            PricingSource::BuiltIn,
            PricingSource::MetaOrg,
            PricingSource::Org,
        ] {
            assert_eq!(PricingSource::from(src.as_str()), src);
        }
    }

    #[test]
    fn test_tier_operator_gt() {
        let op = TierOperator::Gt;
        assert!(op.evaluate(5.0, 4.0));
        assert!(!op.evaluate(4.0, 5.0));
        assert!(!op.evaluate(4.0, 4.0));
    }

    #[test]
    fn test_tier_operator_gte() {
        let op = TierOperator::Gte;
        assert!(op.evaluate(5.0, 4.0));
        assert!(op.evaluate(4.0, 4.0));
        assert!(!op.evaluate(3.0, 4.0));
    }

    #[test]
    fn test_tier_operator_lt() {
        let op = TierOperator::Lt;
        assert!(op.evaluate(3.0, 4.0));
        assert!(!op.evaluate(4.0, 4.0));
        assert!(!op.evaluate(5.0, 4.0));
    }

    #[test]
    fn test_tier_operator_lte() {
        let op = TierOperator::Lte;
        assert!(op.evaluate(3.0, 4.0));
        assert!(op.evaluate(4.0, 4.0));
        assert!(!op.evaluate(5.0, 4.0));
    }

    #[test]
    fn test_tier_operator_eq_tolerance() {
        let op = TierOperator::Eq;
        assert!(op.evaluate(100.0, 100.0));
        // within tolerance (0.5)
        assert!(op.evaluate(100.3, 100.0));
        // outside tolerance
        assert!(!op.evaluate(101.0, 100.0));
    }

    #[test]
    fn test_tier_operator_neq_tolerance() {
        let op = TierOperator::Neq;
        assert!(op.evaluate(101.0, 100.0));
        // within tolerance → NOT neq
        assert!(!op.evaluate(100.3, 100.0));
        assert!(!op.evaluate(100.0, 100.0));
    }

    #[test]
    fn test_tier_operator_serde_snake_case_all_variants() {
        let cases = [
            (TierOperator::Gt, "\"gt\""),
            (TierOperator::Gte, "\"gte\""),
            (TierOperator::Lt, "\"lt\""),
            (TierOperator::Lte, "\"lte\""),
            (TierOperator::Eq, "\"eq\""),
            (TierOperator::Neq, "\"neq\""),
        ];
        for (variant, expected_json) in cases {
            let s = serde_json::to_string(&variant).unwrap();
            assert_eq!(s, expected_json);
            let back: TierOperator = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_tier_operator_default_is_gt() {
        let op: TierOperator = Default::default();
        assert_eq!(op, TierOperator::Gt);
    }

    #[test]
    fn test_pricing_source_serde_snake_case() {
        assert_eq!(
            serde_json::to_string(&PricingSource::BuiltIn).unwrap(),
            "\"built_in\""
        );
        assert_eq!(
            serde_json::to_string(&PricingSource::MetaOrg).unwrap(),
            "\"meta_org\""
        );
        assert_eq!(
            serde_json::to_string(&PricingSource::Org).unwrap(),
            "\"org\""
        );
    }

    #[test]
    fn test_model_pricing_definition_enabled_defaults_true() {
        // `enabled` has `default = "default_true"` → deserializes as true when absent
        let json = r#"{"name":"gpt-4","match_pattern":"gpt-4","tiers":[]}"#;
        let def: ModelPricingDefinition = serde_json::from_str(json).unwrap();
        assert!(def.enabled);
        assert_eq!(def.name, "gpt-4");
        assert!(def.tiers.is_empty());
    }

    #[test]
    fn test_model_pricing_definition_skip_serializing_if_empty_strings() {
        let def = ModelPricingDefinition {
            provider: String::new(),
            description: String::new(),
            name: "test".to_string(),
            match_pattern: ".*".to_string(),
            ..Default::default()
        };
        let val = serde_json::to_value(&def).unwrap();
        // skip_serializing_if = "String::is_empty" — absent when empty
        assert!(!val.as_object().unwrap().contains_key("provider"));
        assert!(!val.as_object().unwrap().contains_key("description"));
    }

    #[test]
    fn test_model_pricing_definition_children_empty_omitted() {
        let def = ModelPricingDefinition {
            name: "m".to_string(),
            match_pattern: ".*".to_string(),
            children: vec![],
            ..Default::default()
        };
        let val = serde_json::to_value(&def).unwrap();
        assert!(!val.as_object().unwrap().contains_key("children"));
    }

    #[test]
    fn test_pricing_tier_definition_serde_defaults() {
        let json = r#"{"name":"default"}"#;
        let tier: PricingTierDefinition = serde_json::from_str(json).unwrap();
        assert_eq!(tier.name, "default");
        assert!(tier.condition.is_none());
        assert!(tier.prices.is_empty());
    }

    #[test]
    fn test_tier_condition_serde_roundtrip() {
        let cond = TierCondition {
            usage_key: "input".to_string(),
            operator: TierOperator::Gt,
            value: 200000.0,
        };
        let json = serde_json::to_string(&cond).unwrap();
        let back: TierCondition = serde_json::from_str(&json).unwrap();
        assert_eq!(back.usage_key, "input");
        assert_eq!(back.operator, TierOperator::Gt);
        assert_eq!(back.value, 200000.0);
    }

    #[test]
    fn test_model_pricing_definition_optional_fields_absent_when_none() {
        let def = ModelPricingDefinition {
            name: "m".to_string(),
            match_pattern: ".*".to_string(),
            ..Default::default()
        };
        let json = serde_json::to_value(&def).unwrap();
        let obj = json.as_object().unwrap();
        assert!(!obj.contains_key("id"));
        assert!(!obj.contains_key("valid_from"));
    }

    #[test]
    fn test_model_pricing_definition_valid_from_present_when_some() {
        let def = ModelPricingDefinition {
            name: "m".to_string(),
            match_pattern: ".*".to_string(),
            valid_from: Some(1_700_000_000_000_000),
            ..Default::default()
        };
        let json = serde_json::to_value(&def).unwrap();
        assert!(json.as_object().unwrap().contains_key("valid_from"));
    }

    #[test]
    fn test_pricing_tier_condition_absent_when_none() {
        let tier = PricingTierDefinition::default();
        let json = serde_json::to_value(&tier).unwrap();
        assert!(!json.as_object().unwrap().contains_key("condition"));
    }

    #[test]
    fn test_pricing_tier_condition_present_when_some() {
        let tier = PricingTierDefinition {
            name: "extended".to_string(),
            condition: Some(TierCondition {
                usage_key: "input".to_string(),
                operator: TierOperator::Gt,
                value: 200000.0,
            }),
            ..Default::default()
        };
        let json = serde_json::to_value(&tier).unwrap();
        assert!(json.as_object().unwrap().contains_key("condition"));
    }

    #[test]
    fn test_default_true_returns_true() {
        assert!(default_true());
    }

    // ── UTC time windows ──────────────────────────────────────────────────

    #[test]
    fn test_utc_window_from_hm() {
        let w = UtcTimeWindow::from_hm((1, 0), (4, 0));
        assert_eq!(w.start_minute, 60);
        assert_eq!(w.end_minute, 240);
    }

    #[test]
    fn test_utc_window_contains_half_open_range() {
        let w = UtcTimeWindow::from_hm((1, 0), (4, 0));
        // start is inclusive, end is exclusive
        assert!(w.contains(60));
        assert!(w.contains(239));
        assert!(!w.contains(240));
        assert!(!w.contains(59));
    }

    #[test]
    fn test_utc_window_wraps_past_midnight() {
        // 16:30 -> 00:30 UTC
        let w = UtcTimeWindow::from_hm((16, 30), (0, 30));
        assert!(w.contains(990)); // 16:30
        assert!(w.contains(1439)); // 23:59
        assert!(w.contains(0)); // 00:00
        assert!(w.contains(29)); // 00:29
        assert!(!w.contains(30)); // 00:30 — exclusive end
        assert!(!w.contains(600)); // 10:00
    }

    #[test]
    fn test_utc_window_end_of_day_normalizes() {
        // 22:00 -> 24:00 must cover the tail of the day, not collapse to empty.
        let w = UtcTimeWindow::from_hm((22, 0), (24, 0));
        assert!(w.contains(1320));
        assert!(w.contains(1439));
        assert!(!w.contains(0));
        assert!(!w.contains(1319));
    }

    #[test]
    fn test_utc_window_equal_bounds_is_all_day() {
        let w = UtcTimeWindow {
            start_minute: 300,
            end_minute: 300,
        };
        assert!(w.contains(0));
        assert!(w.contains(300));
        assert!(w.contains(1439));
    }

    #[test]
    fn test_utc_minute_of_day() {
        // 1970-01-01T00:00:00Z
        assert_eq!(utc_minute_of_day(0), 0);
        // 1970-01-01T01:30:00Z
        assert_eq!(utc_minute_of_day(5_400_000_000), 90);
        // one full day later, same clock time
        assert_eq!(utc_minute_of_day(86_400_000_000 + 5_400_000_000), 90);
    }

    #[test]
    fn test_utc_minute_of_day_negative_timestamp() {
        // One minute before the epoch is 23:59 UTC, not a negative minute.
        assert_eq!(utc_minute_of_day(-60_000_000), 1439);
    }

    #[test]
    fn test_windows_match_empty_is_unrestricted() {
        assert!(windows_match(&[], None));
        assert!(windows_match(&[], Some(0)));
    }

    #[test]
    fn test_windows_match_any_window() {
        // DeepSeek peak hours: 01:00-04:00 and 06:00-10:00 UTC
        let peak = vec![
            UtcTimeWindow::from_hm((1, 0), (4, 0)),
            UtcTimeWindow::from_hm((6, 0), (10, 0)),
        ];
        let at = |h: i64, m: i64| Some((h * 3600 + m * 60) * 1_000_000);
        assert!(windows_match(&peak, at(2, 30)));
        assert!(windows_match(&peak, at(7, 0)));
        assert!(!windows_match(&peak, at(5, 0)));
        assert!(!windows_match(&peak, at(12, 0)));
        assert!(!windows_match(&peak, at(0, 0)));
    }

    #[test]
    fn test_windows_match_unknown_timestamp_never_matches() {
        let peak = vec![UtcTimeWindow::from_hm((1, 0), (4, 0))];
        assert!(!windows_match(&peak, None));
    }

    #[test]
    fn test_pricing_tier_utc_windows_default_empty_and_omitted() {
        let json = r#"{"name":"default"}"#;
        let tier: PricingTierDefinition = serde_json::from_str(json).unwrap();
        assert!(tier.utc_windows.is_empty());
        let val = serde_json::to_value(&tier).unwrap();
        assert!(!val.as_object().unwrap().contains_key("utc_windows"));
    }

    #[test]
    fn test_pricing_tier_utc_windows_roundtrip() {
        let tier = PricingTierDefinition {
            name: "peak".to_string(),
            utc_windows: vec![UtcTimeWindow::from_hm((1, 0), (4, 0))],
            ..Default::default()
        };
        let json = serde_json::to_string(&tier).unwrap();
        let back: PricingTierDefinition = serde_json::from_str(&json).unwrap();
        assert_eq!(back.utc_windows.len(), 1);
        assert_eq!(back.utc_windows[0].start_minute, 60);
        assert_eq!(back.utc_windows[0].end_minute, 240);
    }
}
