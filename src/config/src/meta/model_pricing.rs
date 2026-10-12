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

use std::{borrow::Cow, collections::HashMap};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::utils::json;

/// The meta org whose model pricing definitions are inherited by all other orgs.
pub const META_ORG: &str = "_meta";

/// The built-in org whose pricing definitions are synced from the community GitHub source.
/// These entries are read-only and managed by a background sync job.
pub const BUILT_IN_ORG: &str = "_openobserve";

/// Rule keys with this prefix read the span's token counts instead of its attributes.
pub const USAGE_KEY_PREFIX: &str = "usage.";

/// Longest attribute value kept in a [`PricingContext`]; prompts and completions are longer.
pub const MAX_CONTEXT_VALUE_LEN: usize = 256;

pub const MAX_TIERS: usize = 32;
pub const MAX_RULES_PER_TIER: usize = 8;
pub const MAX_RULE_KEYS: usize = 16;
pub const MAX_RULE_VALUES: usize = 64;
pub const MAX_TIER_PRIORITY: i32 = 1000;

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
    /// Pricing tiers: the matching tier with the highest (priority, restriction count) wins,
    /// ties go to list order, and the unrestricted tier is the fallback.
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

impl ModelPricingDefinition {
    /// Whether any tier reads span attributes, i.e. whether a [`PricingContext`] is needed.
    pub fn has_rules(&self) -> bool {
        self.tiers.iter().any(|t| !t.rules.is_empty())
    }

    /// Normalizes every rule key once; call when the definition enters the cache.
    pub fn prepare(&mut self) {
        for rule in self.tiers.iter_mut().flat_map(|t| t.rules.iter_mut()) {
            rule.prepare();
        }
    }

    /// Normalized attribute keys the rules read, so only those are copied into the context.
    pub fn rule_attribute_keys(&self) -> Vec<Cow<'_, str>> {
        let mut keys: Vec<Cow<'_, str>> = self
            .tiers
            .iter()
            .flat_map(|t| &t.rules)
            .flat_map(TierRule::attribute_keys)
            .collect();
        keys.sort_unstable();
        keys.dedup();
        keys
    }
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
    /// Span-attribute rules (service tier, speed, region) that must all hold.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rules: Vec<TierRule>,
    /// Breaks ties between matching tiers before the restriction count; higher wins.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub priority: i32,
}

impl PricingTierDefinition {
    /// Selection rank among matching tiers: priority first, then restriction count.
    pub fn rank(&self) -> (i32, usize) {
        (self.priority, self.restriction_count())
    }

    /// How many restrictions the tier carries.
    pub fn restriction_count(&self) -> usize {
        usize::from(self.condition.is_some())
            + usize::from(!self.utc_windows.is_empty())
            + self.rules.len()
    }

    /// The unrestricted fallback tier.
    pub fn is_default(&self) -> bool {
        self.restriction_count() == 0
    }
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

/// A rule on a span attribute; `keys` are tried in order and the first present one is compared.
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq, ToSchema)]
#[serde(default)]
pub struct TierRule {
    /// Attribute keys tried in order; compared ignoring case and `_`/`-`/`.` separators.
    #[serde(deserialize_with = "lenient_strings")]
    pub keys: Vec<String>,
    pub op: RuleOp,
    /// Accepted values for `in` / `not_in`, compared trimmed and case-insensitively.
    #[serde(
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "lenient_strings"
    )]
    pub values: Vec<String>,
    /// Threshold for the numeric operators.
    #[serde(
        skip_serializing_if = "Option::is_none",
        deserialize_with = "lenient_f64"
    )]
    pub value: Option<f64>,
    #[serde(skip)]
    #[schema(ignore)]
    prepared: Vec<RuleKey>,
}

impl TierRule {
    pub fn new(keys: &[&str], op: RuleOp, values: &[&str], value: Option<f64>) -> Self {
        Self {
            keys: keys.iter().map(|k| k.to_string()).collect(),
            op,
            values: values.iter().map(|v| v.to_string()).collect(),
            value,
            prepared: Vec::new(),
        }
    }

    /// An absent attribute fails every operator except `not_in` and `not_exists`; a missing
    /// usage count reads as 0, like the legacy `condition`.
    pub fn matches(&self, ctx: &PricingContext, usage: &HashMap<String, i64>) -> bool {
        let found = self.lookup(ctx, usage);
        match self.op {
            RuleOp::Exists => found.is_some(),
            RuleOp::NotExists => found.is_none(),
            RuleOp::In => found.is_some_and(|v| self.accepts(&v)),
            RuleOp::NotIn => !found.is_some_and(|v| self.accepts(&v)),
            RuleOp::Gt | RuleOp::Gte | RuleOp::Lt | RuleOp::Lte => {
                let actual = found
                    .and_then(|v| v.trim().parse::<f64>().ok())
                    .filter(|v| v.is_finite());
                match (actual, self.value) {
                    (Some(actual), Some(threshold)) => self.op.compare(actual, threshold),
                    _ => false,
                }
            }
            RuleOp::Unknown => false,
        }
    }

    /// Rejects a rule that can never match or exceeds the size caps.
    pub fn validate(&self) -> Result<(), String> {
        if self.op == RuleOp::Unknown {
            return Err("rule has an unknown operator".to_string());
        }
        if self.keys.iter().all(|k| k.trim().is_empty()) {
            return Err("rule must list at least one attribute key".to_string());
        }
        if self.keys.len() > MAX_RULE_KEYS || self.values.len() > MAX_RULE_VALUES {
            return Err(format!(
                "rule may list at most {MAX_RULE_KEYS} keys and {MAX_RULE_VALUES} values"
            ));
        }
        if self
            .keys
            .iter()
            .chain(&self.values)
            .any(|s| s.len() > MAX_CONTEXT_VALUE_LEN)
        {
            return Err(format!(
                "rule keys and values must be at most {MAX_CONTEXT_VALUE_LEN} characters"
            ));
        }
        if self
            .keys
            .iter()
            .any(|k| usage_key(k).is_some_and(|u| u.trim().is_empty()))
        {
            return Err("rule usage key must name a usage type after 'usage.'".to_string());
        }
        match self.op {
            RuleOp::In | RuleOp::NotIn if self.values.iter().all(|v| v.trim().is_empty()) => {
                Err("rule must list at least one value".to_string())
            }
            RuleOp::Gt | RuleOp::Gte | RuleOp::Lt | RuleOp::Lte
                if !self.value.is_some_and(f64::is_finite) =>
            {
                Err("rule must have a finite numeric value".to_string())
            }
            _ => Ok(()),
        }
    }

    /// Normalizes the keys once so per-span lookups do not allocate.
    pub fn prepare(&mut self) {
        self.prepared = self.keys.iter().map(|k| RuleKey::parse(k)).collect();
    }

    fn lookup<'a>(
        &'a self,
        ctx: &'a PricingContext,
        usage: &HashMap<String, i64>,
    ) -> Option<Cow<'a, str>> {
        let read = |key: &RuleKey| match key {
            RuleKey::Usage(k) => Some(Cow::Owned(usage.get(k).copied().unwrap_or(0).to_string())),
            RuleKey::Attr(k) => ctx.get_normalized(k).map(Cow::Borrowed),
        };
        if self.prepared.len() == self.keys.len() {
            self.prepared.iter().find_map(read)
        } else {
            self.keys
                .iter()
                .map(|k| RuleKey::parse(k))
                .find_map(|k| read(&k).map(|v| Cow::Owned(v.into_owned())))
        }
    }

    fn accepts(&self, actual: &str) -> bool {
        let actual = actual.trim();
        self.values
            .iter()
            .any(|v| v.trim().eq_ignore_ascii_case(actual))
    }

    fn attribute_keys(&self) -> Vec<Cow<'_, str>> {
        if self.prepared.len() == self.keys.len() {
            return self
                .prepared
                .iter()
                .filter_map(|k| match k {
                    RuleKey::Attr(k) => Some(Cow::Borrowed(k.as_str())),
                    RuleKey::Usage(_) => None,
                })
                .collect();
        }
        self.keys
            .iter()
            .filter_map(|k| match RuleKey::parse(k) {
                RuleKey::Attr(k) => Some(Cow::Owned(k)),
                RuleKey::Usage(_) => None,
            })
            .collect()
    }
}

/// A rule key resolved to either a usage count or a normalized attribute name.
#[derive(Clone, Debug, PartialEq)]
enum RuleKey {
    Usage(String),
    Attr(String),
}

impl RuleKey {
    fn parse(key: &str) -> Self {
        match usage_key(key) {
            Some(usage) => RuleKey::Usage(usage.trim().to_string()),
            None => RuleKey::Attr(normalize_attribute_key(key)),
        }
    }
}

/// Operators for [`TierRule`].
#[derive(Clone, Copy, Debug, Serialize, Deserialize, Default, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RuleOp {
    #[default]
    In,
    NotIn,
    Exists,
    NotExists,
    Gt,
    Gte,
    Lt,
    Lte,
    /// An operator this build does not know; it never matches, so newer catalogues still parse.
    #[serde(other)]
    Unknown,
}

impl RuleOp {
    fn compare(self, actual: f64, threshold: f64) -> bool {
        match self {
            RuleOp::Gt => actual > threshold,
            RuleOp::Gte => actual >= threshold,
            RuleOp::Lt => actual < threshold,
            RuleOp::Lte => actual <= threshold,
            RuleOp::In | RuleOp::NotIn | RuleOp::Exists | RuleOp::NotExists | RuleOp::Unknown => {
                false
            }
        }
    }
}

/// Scalar span attributes a [`TierRule`] can read, keyed by normalized attribute name.
#[derive(Clone, Debug, Default)]
pub struct PricingContext {
    entries: HashMap<String, ContextEntry>,
    known: bool,
}

/// One attribute value plus what decides a normalized-key collision deterministically.
#[derive(Clone, Debug)]
struct ContextEntry {
    namespaced: bool,
    raw_key: String,
    value: String,
}

impl PricingContext {
    /// No span is known (e.g. the eval cost calculator): every rule-restricted tier is skipped.
    pub fn unknown() -> Self {
        Self::default()
    }

    /// A span whose attributes were all supplied, so absent ones really are absent.
    pub fn known() -> Self {
        Self {
            known: true,
            ..Self::default()
        }
    }

    pub fn from_strings(attrs: &HashMap<String, String>) -> Self {
        let mut ctx = Self::known();
        for (k, v) in attrs {
            ctx.insert("", k, v, None);
        }
        ctx
    }

    /// Whether the span's attributes were supplied; rule tiers never match otherwise.
    pub fn is_known(&self) -> bool {
        self.known
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.get_normalized(&normalize_attribute_key(key))
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Adds JSON attributes under `prefix`, keeping only keys in `wanted` when it is given.
    pub fn extend_json(
        &mut self,
        prefix: &str,
        attrs: &HashMap<String, json::Value>,
        wanted: Option<&[&str]>,
    ) {
        for (k, v) in attrs {
            match v {
                json::Value::String(s) => self.insert(prefix, k, s, wanted),
                json::Value::Number(n) => self.insert(prefix, k, &n.to_string(), wanted),
                json::Value::Bool(b) => {
                    self.insert(prefix, k, if *b { "true" } else { "false" }, wanted)
                }
                _ => {}
            }
        }
    }

    /// Adds string attributes under `prefix`, keeping only keys in `wanted` when it is given.
    pub fn extend_strings(
        &mut self,
        prefix: &str,
        attrs: &HashMap<String, String>,
        wanted: Option<&[&str]>,
    ) {
        for (k, v) in attrs {
            self.insert(prefix, k, v, wanted);
        }
    }

    fn get_normalized(&self, normalized: &str) -> Option<&str> {
        self.entries.get(normalized).map(|e| e.value.as_str())
    }

    fn insert(&mut self, prefix: &str, key: &str, value: &str, wanted: Option<&[&str]>) {
        if value.trim().is_empty() || value.len() > MAX_CONTEXT_VALUE_LEN {
            return;
        }
        let normalized = normalize_attribute_key(&format!("{prefix}{key}"));
        if wanted.is_some_and(|w| !w.contains(&normalized.as_str())) {
            return;
        }
        let namespaced = !prefix.is_empty();
        // Namespaced (resource./param.) values beat raw span keys, then the smaller raw key wins.
        if let Some(existing) = self.entries.get(&normalized)
            && (existing.namespaced, existing.raw_key.as_str()) != (namespaced, key)
            && (!existing.namespaced, existing.raw_key.as_str()) <= (!namespaced, key)
        {
            return;
        }
        self.entries.insert(
            normalized,
            ContextEntry {
                namespaced,
                raw_key: key.to_string(),
                value: value.to_string(),
            },
        );
    }
}

/// Lowercase with `_`/`-`/`.` removed, so `serviceTier` and `service_tier` name the same attribute.
pub fn normalize_attribute_key(key: &str) -> String {
    key.chars()
        .filter(|c| !matches!(c, '_' | '-' | '.'))
        .flat_map(char::to_lowercase)
        .collect()
}

/// The usage type named by a `usage.`-prefixed rule key, matched case-insensitively.
fn usage_key(key: &str) -> Option<&str> {
    let key = key.trim();
    key.get(..USAGE_KEY_PREFIX.len())
        .filter(|p| p.eq_ignore_ascii_case(USAGE_KEY_PREFIX))
        .map(|_| &key[USAGE_KEY_PREFIX.len()..])
}

/// Accepts strings, numbers and bools so a hand-edited catalogue entry cannot fail the whole sync.
fn lenient_strings<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Vec::<json::Value>::deserialize(deserializer).unwrap_or_default();
    Ok(raw
        .into_iter()
        .filter_map(|v| match v {
            json::Value::String(s) => Some(s),
            json::Value::Number(n) => Some(n.to_string()),
            json::Value::Bool(b) => Some(b.to_string()),
            _ => None,
        })
        .collect())
}

/// Accepts a number or a numeric string; anything else becomes `None` and fails validation.
fn lenient_f64<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(match json::Value::deserialize(deserializer)? {
        json::Value::Number(n) => n.as_f64(),
        json::Value::String(s) => s.trim().parse().ok(),
        _ => None,
    })
}

fn default_true() -> bool {
    true
}

fn is_zero(v: &i32) -> bool {
    *v == 0
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

    // ── Attribute rules ───────────────────────────────────────────────────

    fn ctx(pairs: &[(&str, &str)]) -> PricingContext {
        PricingContext::from_strings(
            &pairs
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
        )
    }

    fn rule(keys: &[&str], op: RuleOp, values: &[&str]) -> TierRule {
        TierRule::new(keys, op, values, None)
    }

    fn service_tier_in(values: &[&str]) -> TierRule {
        rule(
            &[
                "openai.response.service_tier",
                "openai.request.service_tier",
            ],
            RuleOp::In,
            values,
        )
    }

    #[test]
    fn test_rule_in_matches_any_listed_value() {
        let r = service_tier_in(&["fast", "priority"]);
        let usage = HashMap::new();
        assert!(r.matches(&ctx(&[("openai.request.service_tier", "priority")]), &usage));
        assert!(r.matches(&ctx(&[("openai.request.service_tier", "fast")]), &usage));
        assert!(!r.matches(&ctx(&[("openai.request.service_tier", "flex")]), &usage));
    }

    #[test]
    fn test_rule_keys_are_tried_in_order() {
        let r = service_tier_in(&["flex"]);
        let usage = HashMap::new();
        // The response tier is listed first, so it wins over the requested one.
        assert!(!r.matches(
            &ctx(&[
                ("openai.request.service_tier", "flex"),
                ("openai.response.service_tier", "default"),
            ]),
            &usage
        ));
        assert!(r.matches(
            &ctx(&[
                ("openai.request.service_tier", "auto"),
                ("openai.response.service_tier", "flex"),
            ]),
            &usage
        ));
    }

    #[test]
    fn test_rule_absent_attribute() {
        let usage = HashMap::new();
        let empty = ctx(&[("temperature", "flex")]);
        assert!(!service_tier_in(&["flex"]).matches(&empty, &usage));
        assert!(rule(&["service_tier"], RuleOp::NotIn, &["flex"]).matches(&empty, &usage));
        assert!(!rule(&["service_tier"], RuleOp::Exists, &[]).matches(&empty, &usage));
        assert!(rule(&["service_tier"], RuleOp::NotExists, &[]).matches(&empty, &usage));
        let present = ctx(&[("service_tier", "flex")]);
        assert!(rule(&["service_tier"], RuleOp::Exists, &[]).matches(&present, &usage));
        assert!(!rule(&["service_tier"], RuleOp::NotIn, &["flex"]).matches(&present, &usage));
    }

    #[test]
    fn test_rule_key_and_value_normalization() {
        let r = rule(&["service_tier"], RuleOp::In, &["flex"]);
        let usage = HashMap::new();
        assert!(r.matches(&ctx(&[("serviceTier", " FLEX ")]), &usage));
        assert!(r.matches(&ctx(&[("Service-Tier", "Flex")]), &usage));
        assert!(!r.matches(&ctx(&[("service_tier", "flexible")]), &usage));
        assert!(
            rule(&["service.tier"], RuleOp::In, &["flex"])
                .matches(&ctx(&[("service_tier", "flex")]), &usage)
        );
    }

    #[test]
    fn test_rule_numeric_operators() {
        let mut r = rule(&["gen_ai.request.max_tokens"], RuleOp::Gte, &[]);
        r.value = Some(1000.0);
        let usage = HashMap::new();
        assert!(r.matches(&ctx(&[("gen_ai.request.max_tokens", "1000")]), &usage));
        assert!(!r.matches(&ctx(&[("gen_ai.request.max_tokens", "999")]), &usage));
        assert!(!r.matches(&ctx(&[("gen_ai.request.max_tokens", "lots")]), &usage));
        assert!(!r.matches(&ctx(&[]), &usage));
        r.op = RuleOp::Lt;
        assert!(r.matches(&ctx(&[("gen_ai.request.max_tokens", "999")]), &usage));
    }

    #[test]
    fn test_rule_usage_prefix_reads_token_counts() {
        let mut r = rule(&["usage.input"], RuleOp::Gt, &[]);
        r.value = Some(200_000.0);
        let usage = HashMap::from([("input".to_string(), 300_000i64)]);
        assert!(r.matches(&ctx(&[]), &usage));
        assert!(!r.matches(&ctx(&[]), &HashMap::from([("input".to_string(), 1000i64)])));
        assert!(!r.matches(&ctx(&[]), &HashMap::new()));
    }

    #[test]
    fn test_rule_validate() {
        assert!(service_tier_in(&["flex"]).validate().is_ok());
        assert!(
            rule(&[" "], RuleOp::In, &["flex"])
                .validate()
                .unwrap_err()
                .contains("attribute key")
        );
        assert!(
            rule(&["service_tier"], RuleOp::In, &[""])
                .validate()
                .unwrap_err()
                .contains("at least one value")
        );
        assert!(
            rule(&["service_tier"], RuleOp::Exists, &[])
                .validate()
                .is_ok()
        );
        let numeric = rule(&["usage.input"], RuleOp::Gt, &[]);
        assert!(numeric.validate().unwrap_err().contains("numeric"));
        let mut nan = numeric.clone();
        nan.value = Some(f64::NAN);
        assert!(nan.validate().is_err());
        let mut ok = numeric;
        ok.value = Some(1.0);
        assert!(ok.validate().is_ok());
    }

    #[test]
    fn test_rule_serde_roundtrip_and_defaults() {
        let json = r#"{"keys":["openai.response.service_tier"],"op":"in","values":["flex"]}"#;
        let r: TierRule = serde_json::from_str(json).unwrap();
        assert_eq!(r.op, RuleOp::In);
        assert_eq!(r.value, None);
        let back: TierRule = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
        assert_eq!(back, r);
        let val = serde_json::to_value(&r).unwrap();
        assert!(!val.as_object().unwrap().contains_key("value"));

        let tier: PricingTierDefinition = serde_json::from_str(r#"{"name":"default"}"#).unwrap();
        assert!(tier.rules.is_empty());
        let val = serde_json::to_value(&tier).unwrap();
        assert!(!val.as_object().unwrap().contains_key("rules"));
    }

    #[test]
    fn test_tier_restriction_count_and_default() {
        let mut tier = PricingTierDefinition::default();
        assert!(tier.is_default());
        tier.rules.push(service_tier_in(&["flex"]));
        assert_eq!(tier.restriction_count(), 1);
        assert!(!tier.is_default());
        tier.condition = Some(TierCondition::default());
        tier.utc_windows
            .push(UtcTimeWindow::from_hm((1, 0), (2, 0)));
        assert_eq!(tier.restriction_count(), 3);
    }

    #[test]
    fn test_context_keeps_only_short_scalars() {
        let mut c = PricingContext::known();
        c.extend_json(
            "",
            &HashMap::from([
                ("tier".to_string(), json::json!("flex")),
                ("max_tokens".to_string(), json::json!(1024)),
                ("stream".to_string(), json::json!(true)),
                ("messages".to_string(), json::json!([{"role": "user"}])),
                ("blank".to_string(), json::json!("  ")),
                (
                    "prompt".to_string(),
                    json::json!("x".repeat(MAX_CONTEXT_VALUE_LEN + 1)),
                ),
            ]),
            None,
        );
        assert_eq!(c.get("tier"), Some("flex"));
        assert_eq!(c.get("max_tokens"), Some("1024"));
        assert_eq!(c.get("stream"), Some("true"));
        assert_eq!(c.get("messages"), None);
        assert_eq!(c.get("blank"), None);
        assert_eq!(c.get("prompt"), None);

        c.extend_strings(
            "param.",
            &HashMap::from([("service_tier".to_string(), "priority".to_string())]),
            None,
        );
        assert_eq!(c.get("param.service_tier"), Some("priority"));
        assert!(PricingContext::default().is_empty());
        assert!(c.is_known() && !PricingContext::unknown().is_known());
    }

    #[test]
    fn test_context_wanted_keys_filter() {
        let mut c = PricingContext::known();
        c.extend_json(
            "",
            &HashMap::from([
                (
                    "openai.response.service_tier".to_string(),
                    json::json!("flex"),
                ),
                ("gen_ai.request.model".to_string(), json::json!("gpt-6")),
            ]),
            Some(&["openairesponseservicetier"]),
        );
        assert_eq!(c.get("openai.response.service_tier"), Some("flex"));
        assert_eq!(c.get("gen_ai.request.model"), None);
    }

    #[test]
    fn test_context_collisions_are_deterministic() {
        for _ in 0..20 {
            let mut c = PricingContext::known();
            c.extend_strings(
                "",
                &HashMap::from([
                    ("service_tier".to_string(), "default".to_string()),
                    ("serviceTier".to_string(), "flex".to_string()),
                    ("resource_cloud_region".to_string(), "us".to_string()),
                ]),
                None,
            );
            // The smaller raw key wins a collision between raw span keys.
            assert_eq!(c.get("service_tier"), Some("flex"));
            c.extend_strings(
                "resource.",
                &HashMap::from([("cloud.region".to_string(), "eu".to_string())]),
                None,
            );
            // A namespaced resource attribute beats a raw span key that normalizes the same.
            assert_eq!(c.get("resource.cloud.region"), Some("eu"));
        }
    }

    #[test]
    fn test_rule_unknown_op_parses_never_matches_and_fails_validation() {
        let r: TierRule =
            serde_json::from_str(r#"{"keys":["service_tier"],"op":"regex","values":["fl.*"]}"#)
                .unwrap();
        assert_eq!(r.op, RuleOp::Unknown);
        assert!(!r.matches(&ctx(&[("service_tier", "flex")]), &HashMap::new()));
        assert!(r.validate().unwrap_err().contains("unknown operator"));
        let tier: PricingTierDefinition = serde_json::from_str(
            r#"{"name":"x","rules":[{"keys":["a"],"op":"contains","values":["b"]}],"prices":{"input":1e-6}}"#,
        )
        .unwrap();
        assert_eq!(tier.rules[0].op, RuleOp::Unknown);
    }

    #[test]
    fn test_rule_lenient_value_and_values_parsing() {
        let r: TierRule =
            serde_json::from_str(r#"{"keys":["usage.input"],"op":"gte","value":"272000"}"#)
                .unwrap();
        assert_eq!(r.value, Some(272000.0));
        let r: TierRule =
            serde_json::from_str(r#"{"keys":["n"],"op":"in","values":[1, true, "x", {"a":1}]}"#)
                .unwrap();
        assert_eq!(r.values, vec!["1", "true", "x"]);
        let r: TierRule =
            serde_json::from_str(r#"{"keys":["n"],"op":"gt","value":"lots"}"#).unwrap();
        assert_eq!(r.value, None);
        assert!(r.validate().is_err());
    }

    #[test]
    fn test_rule_usage_prefix_case_insensitive_and_missing_reads_zero() {
        let mut r = rule(&["Usage.cache_read_input_tokens"], RuleOp::Lt, &[]);
        r.value = Some(1.0);
        assert!(r.matches(&ctx(&[]), &HashMap::new()));
        assert!(!r.matches(
            &ctx(&[]),
            &HashMap::from([("cache_read_input_tokens".to_string(), 5i64)])
        ));
        assert!(rule(&["usage."], RuleOp::Exists, &[]).validate().is_err());
    }

    #[test]
    fn test_rule_prepared_and_unprepared_agree() {
        let mut r = service_tier_in(&["flex"]);
        let c = ctx(&[("openai.request.service_tier", "flex")]);
        assert!(r.matches(&c, &HashMap::new()));
        r.prepare();
        assert!(r.matches(&c, &HashMap::new()));
        let mut def = ModelPricingDefinition {
            tiers: vec![PricingTierDefinition {
                rules: vec![service_tier_in(&["flex"])],
                ..Default::default()
            }],
            ..Default::default()
        };
        let unprepared: Vec<String> = def
            .rule_attribute_keys()
            .into_iter()
            .map(Cow::into_owned)
            .collect();
        def.prepare();
        assert_eq!(def.rule_attribute_keys(), unprepared);
        assert_eq!(
            def.rule_attribute_keys(),
            vec!["openairequestservicetier", "openairesponseservicetier"]
        );
    }

    #[test]
    fn test_rule_validate_caps() {
        let many: Vec<String> = (0..=MAX_RULE_VALUES).map(|i| i.to_string()).collect();
        let refs: Vec<&str> = many.iter().map(String::as_str).collect();
        assert!(rule(&["k"], RuleOp::In, &refs).validate().is_err());
        let long = "x".repeat(MAX_CONTEXT_VALUE_LEN + 1);
        assert!(rule(&[&long], RuleOp::Exists, &[]).validate().is_err());
    }

    #[test]
    fn test_tier_rank_puts_priority_first() {
        let low = PricingTierDefinition {
            condition: Some(TierCondition::default()),
            rules: vec![service_tier_in(&["flex"])],
            ..Default::default()
        };
        let high = PricingTierDefinition {
            rules: vec![service_tier_in(&["flex"])],
            priority: 1,
            ..Default::default()
        };
        assert!(high.rank() > low.rank());
        let val = serde_json::to_value(&low).unwrap();
        assert!(!val.as_object().unwrap().contains_key("priority"));
    }
}
