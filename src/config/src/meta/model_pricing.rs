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
