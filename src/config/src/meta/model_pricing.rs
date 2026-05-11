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
}
