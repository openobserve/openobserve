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

//! LLM Model Pricing
//!
//! This module provides pricing information for popular LLM models to calculate
//! costs from token usage when cost information is not provided by the client.
//!
//! Pricing is based on publicly available information from model providers and
//! is updated as of March 2026.

use std::sync::LazyLock as Lazy;

use config::meta::model_pricing::{UtcTimeWindow, windows_match};
use regex::Regex;
use tiktoken_rs::{get_bpe_from_model, o200k_base};

pub fn calculate_token_count(model_name: &str, prompt: &str) -> i64 {
    let encoding = match get_bpe_from_model(model_name) {
        Ok(m) => m,
        Err(_) => o200k_base().unwrap(),
    };
    let tokens = encoding.encode_with_special_tokens(prompt);
    tokens.len() as i64
}

/// Calculate cost from token usage
///
/// # Arguments
/// * `model_name` - Name of the model (e.g., "gpt-4", "claude-sonnet-4-6")
/// * `input_tokens` - Number of input tokens
/// * `output_tokens` - Number of output tokens
/// * `ts_micros` - Span start time in microseconds, used to resolve tiers that are restricted to
///   recurring UTC time-of-day windows (peak / off-peak pricing). Pass `None` when the time is
///   unknown — the unrestricted tier is used instead.
///
/// # Returns
/// * `Some((input_cost, output_cost, total_cost))` if pricing is found
/// * `None` if no pricing information is available for this model
pub fn calculate_cost(
    model_name: &str,
    input_tokens: i64,
    output_tokens: i64,
    ts_micros: Option<i64>,
) -> Option<(f64, f64, f64)> {
    // Find matching pricing
    let pricing = MODEL_PRICING.iter().find(|p| p.matches(model_name))?;

    // Get appropriate tier
    let tier = pricing.get_tier(input_tokens, ts_micros);

    // Calculate costs (tokens / 1,000,000 * price_per_million)
    let input_cost = (input_tokens as f64 / 1_000_000.0) * tier.input_price_per_million;
    let output_cost = (output_tokens as f64 / 1_000_000.0) * tier.output_price_per_million;
    let total_cost = input_cost + output_cost;

    Some((input_cost, output_cost, total_cost))
}

/// Canonicalize a raw model name string to a stable identifier.
///
/// Different vendors/instrumentation frameworks report the same model under
/// different raw strings (e.g. "anthropic/claude-sonnet-4-6" vs.
/// "claude-sonnet-4-6"), which otherwise land as distinct nodes/keys in
/// aggregations like the service graph. This reuses the same pattern list as
/// `calculate_cost` so cost lookup and node identity stay consistent.
///
/// Returns `None` if no known pattern matches (caller should fall back to the
/// raw string).
pub fn canonical_model_pattern(model_name: &str) -> Option<&'static str> {
    MODEL_PRICING
        .iter()
        .find(|p| p.matches(model_name))
        .map(|p| p.pattern.as_str())
}

/// All known model-name patterns in match priority order (most specific
/// first), for callers that need to build a SQL expression covering every
/// pattern rather than matching a single Rust string.
pub fn model_patterns() -> impl Iterator<Item = &'static str> {
    MODEL_PRICING.iter().map(|p| p.pattern.as_str())
}

/// Pricing tier based on token count or other conditions
#[derive(Debug, Clone, Default)]
pub struct PricingTier {
    /// Minimum input tokens for this tier (None means no minimum)
    pub min_input_tokens: Option<i64>,
    /// Recurring UTC time-of-day windows during which this tier applies.
    /// Empty means the tier is not time-restricted.
    pub utc_windows: Vec<UtcTimeWindow>,
    /// Cost per 1M input tokens in USD
    pub input_price_per_million: f64,
    /// Cost per 1M output tokens in USD
    pub output_price_per_million: f64,
}

impl PricingTier {
    /// A tier with neither a token threshold nor a time window — the unconditional
    /// fallback used when no restricted tier applies.
    fn is_unrestricted(&self) -> bool {
        self.min_input_tokens.is_none() && self.utc_windows.is_empty()
    }
}

/// Model pricing information
#[derive(Debug, Clone)]
pub struct ModelPricing {
    /// Pattern to match model names (supports regex)
    pub pattern: String,
    /// Pricing tiers (evaluated in order, first matching tier is used)
    pub tiers: Vec<PricingTier>,
    /// Pre-compiled regex for efficient matching in the hot path.
    compiled: Regex,
}

impl ModelPricing {
    /// Create a simple model pricing with a single tier
    pub fn simple(pattern: &str, input_price: f64, output_price: f64) -> Self {
        Self {
            pattern: pattern.to_string(),
            tiers: vec![PricingTier {
                input_price_per_million: input_price,
                output_price_per_million: output_price,
                ..Default::default()
            }],
            compiled: Regex::new(pattern).expect("invalid regex in model pricing pattern"),
        }
    }

    /// Create a tiered pricing model (e.g., for Claude Sonnet with extended context)
    pub fn tiered(pattern: &str, tiers: Vec<PricingTier>) -> Self {
        Self {
            pattern: pattern.to_string(),
            tiers,
            compiled: Regex::new(pattern).expect("invalid regex in model pricing pattern"),
        }
    }

    /// Create a model whose rates change with the UTC time of day (e.g. DeepSeek's
    /// peak / off-peak pricing). Spans inside `peak_windows` are billed at the peak
    /// rate; everything else falls through to the off-peak rate.
    pub fn peak_off_peak(
        pattern: &str,
        peak_windows: Vec<UtcTimeWindow>,
        peak_input: f64,
        peak_output: f64,
        off_peak_input: f64,
        off_peak_output: f64,
    ) -> Self {
        Self::tiered(
            pattern,
            vec![
                PricingTier {
                    utc_windows: peak_windows,
                    input_price_per_million: peak_input,
                    output_price_per_million: peak_output,
                    ..Default::default()
                },
                PricingTier {
                    input_price_per_million: off_peak_input,
                    output_price_per_million: off_peak_output,
                    ..Default::default()
                },
            ],
        )
    }

    /// Get the appropriate pricing tier for the given token counts and span time.
    /// Restricted tiers (token threshold and/or UTC time window) are evaluated in
    /// order; the first one that applies wins, otherwise the unrestricted tier does.
    pub fn get_tier(&self, input_tokens: i64, ts_micros: Option<i64>) -> &PricingTier {
        for tier in &self.tiers {
            if !windows_match(&tier.utc_windows, ts_micros) {
                continue;
            }
            match tier.min_input_tokens {
                Some(min) if input_tokens < min => continue,
                _ => return tier,
            }
        }
        // Fallback: the unrestricted tier, else the last one defined.
        self.tiers
            .iter()
            .find(|t| t.is_unrestricted())
            .unwrap_or_else(|| self.tiers.last().unwrap())
    }

    /// Check if this pricing matches the given model name
    pub fn matches(&self, model_name: &str) -> bool {
        self.compiled.is_match(model_name)
    }
}

/// DeepSeek peak-hour windows: 01:00-04:00 and 06:00-10:00 UTC.
/// Every other hour is off-peak at half the peak rate.
fn deepseek_peak_windows() -> Vec<UtcTimeWindow> {
    vec![
        UtcTimeWindow::from_hm((1, 0), (4, 0)),
        UtcTimeWindow::from_hm((6, 0), (10, 0)),
    ]
}

/// Global model pricing database
pub static MODEL_PRICING: Lazy<Vec<ModelPricing>> = Lazy::new(|| {
    vec![
        // OpenAI Models
        // Reference: https://developers.openai.com/api/docs/pricing/
        ModelPricing::simple("gpt-5\\.2-pro", 21.00, 168.00),
        ModelPricing::simple("gpt-5\\.2", 1.75, 14.00),
        ModelPricing::simple("gpt-5\\.1", 1.25, 10.00),
        ModelPricing::simple("gpt-5-pro", 15.00, 120.00),
        ModelPricing::simple("gpt-5-mini", 0.25, 2.00),
        ModelPricing::simple("gpt-5-nano", 0.05, 0.40),
        ModelPricing::simple("gpt-5", 1.25, 10.00),
        ModelPricing::simple("gpt-4\\.1-mini", 0.40, 1.60),
        ModelPricing::simple("gpt-4\\.1", 2.00, 8.00),
        ModelPricing::simple("gpt-4o-mini", 0.15, 0.60),
        ModelPricing::simple("gpt-4o", 2.50, 10.00),
        ModelPricing::simple("o1-pro", 150.00, 600.00),
        ModelPricing::simple("o1", 15.00, 60.00),
        ModelPricing::simple("o3-pro", 20.00, 80.00),
        ModelPricing::simple("o3-mini", 1.10, 4.40),
        ModelPricing::simple("o3", 2.00, 8.00),
        ModelPricing::simple("o4-mini", 1.10, 4.40),
        ModelPricing::simple("gpt-image-1\\.5", 8.00, 32.00),
        ModelPricing::simple("gpt-image-1-mini", 2.50, 8.00),
        ModelPricing::simple("gpt-image-1", 10.00, 40.00),
        ModelPricing::simple("gpt-4-turbo", 10.00, 30.00),
        ModelPricing::simple("gpt-4-32k", 60.00, 120.00),
        ModelPricing::simple("gpt-4-0125-preview", 10.00, 30.00),
        ModelPricing::simple("gpt-4-1106-preview", 10.00, 30.00),
        ModelPricing::simple("gpt-4", 30.00, 60.00),
        ModelPricing::simple("gpt-3\\.5-turbo", 0.50, 1.50),
        ModelPricing::simple("gpt-3\\.5", 0.50, 1.50),
        ModelPricing::simple("text-embedding-3-large", 0.13, 0.0),
        ModelPricing::simple("text-embedding-3-small", 0.02, 0.0),
        ModelPricing::simple("text-embedding-ada-002", 0.10, 0.0),
        // Anthropic Models
        // Reference: https://platform.claude.com/docs/en/about-claude/pricing
        ModelPricing::tiered(
            "claude-opus-4-6",
            vec![
                PricingTier {
                    min_input_tokens: Some(200_000),
                    utc_windows: Vec::new(),
                    input_price_per_million: 10.00,
                    output_price_per_million: 37.50,
                },
                PricingTier {
                    min_input_tokens: None,
                    utc_windows: Vec::new(),
                    input_price_per_million: 5.00,
                    output_price_per_million: 25.00,
                },
            ],
        ),
        ModelPricing::tiered(
            "claude-sonnet-4-6",
            vec![
                PricingTier {
                    min_input_tokens: Some(200_000),
                    utc_windows: Vec::new(),
                    input_price_per_million: 6.00,
                    output_price_per_million: 22.50,
                },
                PricingTier {
                    min_input_tokens: None,
                    utc_windows: Vec::new(),
                    input_price_per_million: 3.00,
                    output_price_per_million: 15.00,
                },
            ],
        ),
        ModelPricing::tiered(
            "claude-sonnet-4-5",
            vec![
                PricingTier {
                    min_input_tokens: Some(200_000),
                    utc_windows: Vec::new(),
                    input_price_per_million: 6.00,
                    output_price_per_million: 22.50,
                },
                PricingTier {
                    min_input_tokens: None,
                    utc_windows: Vec::new(),
                    input_price_per_million: 3.00,
                    output_price_per_million: 15.00,
                },
            ],
        ),
        ModelPricing::tiered(
            "claude-sonnet-4",
            vec![
                PricingTier {
                    min_input_tokens: Some(200_000),
                    utc_windows: Vec::new(),
                    input_price_per_million: 6.00,
                    output_price_per_million: 22.50,
                },
                PricingTier {
                    min_input_tokens: None,
                    utc_windows: Vec::new(),
                    input_price_per_million: 3.00,
                    output_price_per_million: 15.00,
                },
            ],
        ),
        ModelPricing::simple("claude-opus-4-5", 5.00, 25.00),
        ModelPricing::simple("claude-haiku-4-5", 1.00, 5.00),
        ModelPricing::simple("claude-opus-4-1", 15.00, 75.00),
        ModelPricing::simple("claude-opus-4", 15.00, 75.00),
        ModelPricing::simple("claude-3-opus", 15.00, 75.00),
        ModelPricing::simple("claude-3-7-sonnet", 3.00, 15.00),
        ModelPricing::simple("claude-3-5-sonnet", 3.00, 15.00),
        ModelPricing::simple("claude-3-sonnet", 3.00, 15.00),
        ModelPricing::simple("claude-haiku-3-5", 0.80, 4.00),
        ModelPricing::simple("claude-3-5-haiku", 0.80, 4.00),
        ModelPricing::simple("claude-3-haiku", 0.25, 1.25),
        // Google Gemini Models
        // Reference: https://ai.google.dev/pricing
        ModelPricing::tiered(
            "gemini-3\\.1-pro",
            vec![
                PricingTier {
                    min_input_tokens: Some(200_000),
                    utc_windows: Vec::new(),
                    input_price_per_million: 4.00,
                    output_price_per_million: 18.00,
                },
                PricingTier {
                    min_input_tokens: None,
                    utc_windows: Vec::new(),
                    input_price_per_million: 2.00,
                    output_price_per_million: 12.00,
                },
            ],
        ),
        ModelPricing::simple("gemini-3\\.1-flash-lite", 0.25, 1.50),
        ModelPricing::simple("gemini-3-flash", 0.50, 3.00),
        ModelPricing::tiered(
            "gemini-2\\.5-pro",
            vec![
                PricingTier {
                    min_input_tokens: Some(200_000),
                    utc_windows: Vec::new(),
                    input_price_per_million: 2.50,
                    output_price_per_million: 15.00,
                },
                PricingTier {
                    min_input_tokens: None,
                    utc_windows: Vec::new(),
                    input_price_per_million: 1.25,
                    output_price_per_million: 10.00,
                },
            ],
        ),
        ModelPricing::simple("gemini-2\\.5-flash-lite", 0.10, 0.40),
        ModelPricing::simple("gemini-2\\.5-flash", 0.30, 2.50),
        ModelPricing::simple("gemini-2\\.0-flash-lite", 0.075, 0.30),
        ModelPricing::simple("gemini-2\\.0-flash", 0.10, 0.40),
        ModelPricing::simple("gemini-1\\.5-pro", 1.25, 5.00),
        ModelPricing::simple("gemini-1\\.5-flash", 0.075, 0.30),
        ModelPricing::simple("gemini-pro", 0.50, 1.50),
        ModelPricing::simple("gemini-embedding-001", 0.15, 0.0),
        // DeepSeek Models
        // Reference: https://api-docs.deepseek.com/quick_start/pricing
        //
        // V4 bills at two rates that alternate with the UTC clock: peak hours are
        // 01:00-04:00 and 06:00-10:00 UTC, and every other hour is off-peak at half
        // the peak rate. `input` here is the cache-miss rate; cache-hit input is
        // priced through user-defined `cache_read_input_tokens` entries.
        ModelPricing::peak_off_peak(
            "(?i)deepseek-v4-flash",
            deepseek_peak_windows(),
            0.44,
            1.32,
            0.22,
            0.66,
        ),
        ModelPricing::peak_off_peak(
            "(?i)deepseek-v4-pro",
            deepseek_peak_windows(),
            1.32,
            3.96,
            0.66,
            1.98,
        ),
        // Legacy DeepSeek model names, kept for historical spans — these are no longer
        // on the published price list and are not peak/off-peak split.
        ModelPricing::simple("(?i)deepseek-(?:v3|chat)(?:$|-)", 0.27, 1.10),
        ModelPricing::simple("(?i)deepseek-(?:r1|reasoner)(?:-\\d[\\d-]*)?$", 0.55, 2.19),
        ModelPricing::simple("(?i)deepseek-r1-distill-llama-8b", 0.04, 0.04),
        ModelPricing::simple("(?i)deepseek-r1-distill-qwen-32b", 0.29, 0.29),
    ]
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_canonical_model_pattern_merges_vendor_prefix_variants() {
        // Introspection instance (Google-ADK/gateway style, direct-vs-gateway path)
        // and CrewAI/LiteLLM (provider/model style) both report claude-sonnet-4-6
        // under different raw strings. They must canonicalize to the same pattern.
        let raw_strings = ["claude-sonnet-4-6", "anthropic/claude-sonnet-4-6"];
        let canon: Vec<_> = raw_strings
            .iter()
            .map(|s| canonical_model_pattern(s))
            .collect();
        assert_eq!(canon[0], canon[1]);
        assert_eq!(canon[0], Some("claude-sonnet-4-6"));
    }

    #[test]
    fn test_canonical_model_pattern_merges_dated_and_undated_variants() {
        let direct = canonical_model_pattern("anthropic/claude-sonnet-4-5-20250929");
        let gateway = canonical_model_pattern("claude-sonnet-4-5-20250929");
        assert_eq!(direct, gateway);
        assert_eq!(direct, Some("claude-sonnet-4-5"));
    }

    #[test]
    fn test_canonical_model_pattern_older_dated_snapshot_is_distinct_bucket() {
        // A pre-4.5/4.6 dated snapshot (older CrewAI/LiteLLM deployments) does not
        // contain "4-5" or "4-6" as a substring, so it falls into the broader
        // "claude-sonnet-4" bucket rather than merging with newer snapshots. This
        // is expected: it is plausibly a materially different model.
        let older = canonical_model_pattern("anthropic/claude-sonnet-4-20250514");
        assert_eq!(older, Some("claude-sonnet-4"));
    }

    #[test]
    fn test_canonical_model_pattern_unknown_model_returns_none() {
        assert_eq!(canonical_model_pattern("some-unlisted-custom-model"), None);
    }

    #[test]
    fn test_model_patterns_nonempty_and_matches_pricing_table() {
        let patterns: Vec<_> = model_patterns().collect();
        assert!(!patterns.is_empty());
        assert!(patterns.contains(&"claude-sonnet-4-6"));
        assert_eq!(patterns.len(), MODEL_PRICING.len());
    }

    #[test]
    fn test_calculate_cost_gpt4() {
        let (input_cost, output_cost, total_cost) =
            calculate_cost("gpt-4o", 1000, 500, None).unwrap();
        assert_eq!(input_cost, 0.0025); // 1000 / 1M * $2.50
        assert_eq!(output_cost, 0.005); // 500 / 1M * $10.00
        assert_eq!(total_cost, 0.0075);
    }

    #[test]
    fn test_calculate_cost_claude_sonnet_tiered_default_tier() {
        // Test with < 200k tokens (default tier)
        let (input_cost, output_cost, total_cost) =
            calculate_cost("claude-sonnet-4-6", 50_000, 10_000, None).unwrap();
        assert!((input_cost - 0.15).abs() < 1e-10); // 50k / 1M * $3.00
        assert!((output_cost - 0.15).abs() < 1e-10); // 10k / 1M * $15.00
        assert!((total_cost - 0.30).abs() < 1e-10);
    }

    #[test]
    fn test_calculate_cost_claude_sonnet_tiered_extended_tier() {
        // Test with > 200k tokens (extended context tier)
        let (input_cost, output_cost, total_cost) =
            calculate_cost("claude-sonnet-4-6", 250_000, 10_000, None).unwrap();
        assert!((input_cost - 1.5).abs() < 1e-10); // 250k / 1M * $6.00
        assert!((output_cost - 0.225).abs() < 1e-10); // 10k / 1M * $22.50
        assert!((total_cost - 1.725).abs() < 1e-10);
    }

    #[test]
    fn test_calculate_cost_unknown_model() {
        assert!(calculate_cost("unknown-model-xyz", 1000, 500, None).is_none());
    }

    #[test]
    fn test_calculate_cost_gemini() {
        let (input_cost, output_cost, total_cost) =
            calculate_cost("gemini-1.5-flash", 10_000, 5_000, None).unwrap();
        assert!((input_cost - 0.00075).abs() < 1e-10); // 10k / 1M * $0.075
        assert!((output_cost - 0.0015).abs() < 1e-10); // 5k / 1M * $0.30
        assert!((total_cost - 0.00225).abs() < 1e-10);
    }

    #[test]
    fn test_model_pricing_matches() {
        let pricing = ModelPricing::simple("gpt-4", 30.0, 60.0);
        assert!(pricing.matches("gpt-4"));
        assert!(pricing.matches("gpt-4-0613"));
        assert!(!pricing.matches("gpt-3.5-turbo"));
    }

    #[test]
    fn test_zero_tokens() {
        let (input_cost, output_cost, total_cost) = calculate_cost("gpt-4o", 0, 0, None).unwrap();
        assert_eq!(input_cost, 0.0);
        assert_eq!(output_cost, 0.0);
        assert_eq!(total_cost, 0.0);
    }

    #[test]
    fn test_dot_escape_matches_exact_version() {
        // gpt-5.2 pattern uses \\. to match literal dot — should NOT match "gpt-512"
        let pricing = ModelPricing::simple("gpt-5\\.2", 1.75, 14.00);
        assert!(pricing.matches("gpt-5.2"));
        assert!(pricing.matches("gpt-5.2-something"));
        assert!(!pricing.matches("gpt-512"));
        assert!(!pricing.matches("gpt-5x2"));
    }

    #[test]
    fn test_dot_escape_gemini_versions() {
        // Gemini patterns use \\. for version dots
        let pricing = ModelPricing::simple("gemini-2\\.5-flash", 0.30, 2.50);
        assert!(pricing.matches("gemini-2.5-flash"));
        assert!(pricing.matches("gemini-2.5-flash-001"));
        assert!(!pricing.matches("gemini-225-flash"));
        assert!(!pricing.matches("gemini-2x5-flash"));
    }

    #[test]
    fn test_dot_escape_gpt_3_5() {
        // gpt-3.5 uses \\. — should not match gpt-315 or gpt-3X5
        let pricing = ModelPricing::simple("gpt-3\\.5-turbo", 0.50, 1.50);
        assert!(pricing.matches("gpt-3.5-turbo"));
        assert!(pricing.matches("gpt-3.5-turbo-0125"));
        assert!(!pricing.matches("gpt-315-turbo"));
    }

    #[test]
    fn test_claude_hyphen_not_dot() {
        // Anthropic model IDs use hyphens, not dots — no \\. needed
        assert!(calculate_cost("claude-3-5-haiku", 1000, 500, None).is_some());
        assert!(calculate_cost("claude-haiku-3-5", 1000, 500, None).is_some());
        assert!(calculate_cost("claude-haiku-4-5", 1000, 500, None).is_some());
        assert!(calculate_cost("claude-opus-4-6", 1000, 500, None).is_some());
    }

    #[test]
    fn test_new_openai_models() {
        // Verify new models are matched
        assert!(calculate_cost("gpt-5.1", 1000, 500, None).is_some());
        assert!(calculate_cost("gpt-5-pro", 1000, 500, None).is_some());
        assert!(calculate_cost("gpt-5-nano", 1000, 500, None).is_some());
        assert!(calculate_cost("o1", 1000, 500, None).is_some());
        assert!(calculate_cost("o1-pro", 1000, 500, None).is_some());
        assert!(calculate_cost("o3-pro", 1000, 500, None).is_some());
        assert!(calculate_cost("o3-mini", 1000, 500, None).is_some());
    }

    #[test]
    fn test_new_gemini_models() {
        assert!(calculate_cost("gemini-3.1-pro-preview", 1000, 500, None).is_some());
        assert!(calculate_cost("gemini-3.1-flash-lite-preview", 1000, 500, None).is_some());
        assert!(calculate_cost("gemini-3-flash-preview", 1000, 500, None).is_some());
        assert!(calculate_cost("gemini-embedding-001", 1000, 500, None).is_some());
    }

    /// Microseconds since the epoch for a UTC clock time on 1970-01-01.
    fn micros_at_utc(hour: i64, minute: i64) -> Option<i64> {
        Some((hour * 3600 + minute * 60) * 1_000_000)
    }

    #[test]
    fn test_deepseek_models() {
        // Off-peak (12:00 UTC): $0.66/$1.98 per 1M for v4-pro.
        let (input_cost, output_cost, total_cost) =
            calculate_cost("deepseek-v4-pro", 1000, 500, micros_at_utc(12, 0)).unwrap();

        assert!((input_cost - 0.00066).abs() < 1e-12);
        assert!((output_cost - 0.00099).abs() < 1e-12);
        assert!((total_cost - 0.00165).abs() < 1e-12);
        assert!(calculate_cost("deepseek-chat", 1000, 500, None).is_some());
        assert!(calculate_cost("deepseek/deepseek-r1-0528", 1000, 500, None).is_some());
        assert!(calculate_cost("deepseek-r1-distill-qwen-32b", 1000, 500, None).is_some());
    }

    #[test]
    fn test_deepseek_peak_is_double_off_peak() {
        for model in ["deepseek-v4-pro", "deepseek-v4-flash"] {
            let (peak_in, peak_out, _) =
                calculate_cost(model, 1_000_000, 1_000_000, micros_at_utc(2, 0)).unwrap();
            let (off_in, off_out, _) =
                calculate_cost(model, 1_000_000, 1_000_000, micros_at_utc(12, 0)).unwrap();
            assert!(
                (peak_in - off_in * 2.0).abs() < 1e-12,
                "{model} input: peak {peak_in} != 2x off-peak {off_in}"
            );
            assert!(
                (peak_out - off_out * 2.0).abs() < 1e-12,
                "{model} output: peak {peak_out} != 2x off-peak {off_out}"
            );
        }
    }

    #[test]
    fn test_deepseek_v4_flash_published_rates() {
        // https://api-docs.deepseek.com/quick_start/pricing — cache-miss input / output.
        let (peak_in, peak_out, _) = calculate_cost(
            "deepseek-v4-flash",
            1_000_000,
            1_000_000,
            micros_at_utc(6, 30),
        )
        .unwrap();
        assert!((peak_in - 0.44).abs() < 1e-12);
        assert!((peak_out - 1.32).abs() < 1e-12);

        let (off_in, off_out, _) = calculate_cost(
            "deepseek-v4-flash",
            1_000_000,
            1_000_000,
            micros_at_utc(23, 0),
        )
        .unwrap();
        assert!((off_in - 0.22).abs() < 1e-12);
        assert!((off_out - 0.66).abs() < 1e-12);
    }

    #[test]
    fn test_deepseek_unknown_timestamp_falls_back_to_off_peak() {
        // No span time → the unrestricted (off-peak) tier, never a windowed one.
        let (input_cost, ..) = calculate_cost("deepseek-v4-pro", 1_000_000, 0, None).unwrap();
        assert!((input_cost - 0.66).abs() < 1e-12);
    }

    #[test]
    fn test_time_windows_do_not_affect_unwindowed_models() {
        // A model with no time-restricted tier prices identically at any hour.
        let at_peak = calculate_cost("gpt-4o", 1000, 500, micros_at_utc(2, 0)).unwrap();
        let at_off = calculate_cost("gpt-4o", 1000, 500, micros_at_utc(14, 0)).unwrap();
        let no_ts = calculate_cost("gpt-4o", 1000, 500, None).unwrap();
        assert_eq!(at_peak, at_off);
        assert_eq!(at_peak, no_ts);
    }

    #[test]
    fn test_context_length_tier_still_selected_with_timestamp() {
        // Time windows must not disturb the existing token-threshold tiering.
        // Below the 200k threshold → base rate ($3/1M), regardless of the hour.
        let (small_in, ..) =
            calculate_cost("claude-sonnet-4-6", 100_000, 0, micros_at_utc(2, 0)).unwrap();
        assert!((small_in - 0.30).abs() < 1e-12);
        // Above it → extended-context rate ($6/1M).
        let (large_in, ..) =
            calculate_cost("claude-sonnet-4-6", 300_000, 0, micros_at_utc(2, 0)).unwrap();
        assert!((large_in - 1.80).abs() < 1e-12);
    }

    #[test]
    fn test_calculate_token_count_known_model() {
        // Test with a known OpenAI model
        let prompt = "Hello, world!";
        let token_count = calculate_token_count("gpt-4", prompt);
        assert!(token_count > 0);
        // "Hello, world!" should be encoded to a few tokens
        assert!(token_count < 10);
    }

    #[test]
    fn test_calculate_token_count_unknown_model() {
        // Test with an unknown model (should fallback to o200k_base)
        let prompt = "This is a test prompt";
        let token_count = calculate_token_count("unknown-model-xyz", prompt);
        assert!(token_count > 0);
        // Should still return a valid token count using fallback encoding
    }

    #[test]
    fn test_calculate_token_count_empty_prompt() {
        // Test with empty prompt
        let token_count = calculate_token_count("gpt-4", "");
        // Empty prompt might still have some tokens (like BOS token) or be 0
        assert!(token_count >= 0);
    }

    #[test]
    fn test_calculate_token_count_long_prompt() {
        // Test with a longer prompt
        let prompt = "The quick brown fox jumps over the lazy dog. ".repeat(10);
        let token_count = calculate_token_count("gpt-4", &prompt);
        assert!(token_count > 0);
        // Longer prompt should have more tokens
        assert!(token_count > 10);
    }

    #[test]
    fn test_calculate_token_count_special_characters() {
        // Test with special characters and unicode
        let prompt = "Hello! 你好 🌍 世界";
        let token_count = calculate_token_count("gpt-4", prompt);
        assert!(token_count > 0);
    }

    #[test]
    fn test_calculate_token_count_different_models() {
        // Test that different models produce consistent results (or at least valid results)
        let prompt = "Test prompt";
        let gpt4_count = calculate_token_count("gpt-4", prompt);
        let gpt35_count = calculate_token_count("gpt-3.5-turbo", prompt);
        let claude_count = calculate_token_count("claude-3-5-sonnet", prompt);

        // All should return valid token counts
        assert!(gpt4_count > 0);
        assert!(gpt35_count > 0);
        assert!(claude_count > 0);
    }
}
