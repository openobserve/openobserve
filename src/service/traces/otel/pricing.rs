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
//! is updated as of January 2025.

use once_cell::sync::Lazy;
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
/// * `model_name` - Name of the model (e.g., "gpt-4", "claude-sonnet-4-5")
/// * `input_tokens` - Number of input tokens
/// * `output_tokens` - Number of output tokens
///
/// # Returns
/// * `Some((input_cost, output_cost, total_cost))` if pricing is found
/// * `None` if no pricing information is available for this model
pub fn calculate_cost(
    model_name: &str,
    input_tokens: i64,
    output_tokens: i64,
) -> Option<(f64, f64, f64)> {
    // Find matching pricing
    let pricing = MODEL_PRICING.iter().find(|p| p.matches(model_name))?;

    // Get appropriate tier
    let tier = pricing.get_tier(input_tokens);

    // Calculate costs (tokens / 1,000,000 * price_per_million)
    let input_cost = (input_tokens as f64 / 1_000_000.0) * tier.input_price_per_million;
    let output_cost = (output_tokens as f64 / 1_000_000.0) * tier.output_price_per_million;
    let total_cost = input_cost + output_cost;

    Some((input_cost, output_cost, total_cost))
}

/// Pricing tier based on token count or other conditions
#[derive(Debug, Clone)]
pub struct PricingTier {
    /// Minimum input tokens for this tier (None means no minimum)
    pub min_input_tokens: Option<i64>,
    /// Cost per 1M input tokens in USD
    pub input_price_per_million: f64,
    /// Cost per 1M output tokens in USD
    pub output_price_per_million: f64,
}

/// Model pricing information
#[derive(Debug, Clone)]
pub struct ModelPricing {
    /// Pattern to match model names (supports regex)
    pub pattern: String,
    /// Pricing tiers (evaluated in order, first matching tier is used)
    pub tiers: Vec<PricingTier>,
}

impl ModelPricing {
    /// Create a simple model pricing with a single tier
    pub fn simple(pattern: &str, input_price: f64, output_price: f64) -> Self {
        Self {
            pattern: pattern.to_string(),
            tiers: vec![PricingTier {
                min_input_tokens: None,
                input_price_per_million: input_price,
                output_price_per_million: output_price,
            }],
        }
    }

    /// Create a tiered pricing model (e.g., for Claude Sonnet with extended context)
    pub fn tiered(pattern: &str, tiers: Vec<PricingTier>) -> Self {
        Self {
            pattern: pattern.to_string(),
            tiers,
        }
    }

    /// Get the appropriate pricing tier for the given token counts
    pub fn get_tier(&self, input_tokens: i64) -> &PricingTier {
        for tier in &self.tiers {
            if let Some(min) = tier.min_input_tokens {
                if input_tokens >= min {
                    return tier;
                }
            } else {
                return tier;
            }
        }
        // Fallback to last tier (default)
        self.tiers.last().unwrap()
    }

    /// Check if this pricing matches the given model name
    pub fn matches(&self, model_name: &str) -> bool {
        if let Ok(re) = Regex::new(&self.pattern) {
            re.is_match(model_name)
        } else {
            // Fallback to simple substring match if regex is invalid
            model_name.contains(&self.pattern)
        }
    }
}

/// Global model pricing database
pub static MODEL_PRICING: Lazy<Vec<ModelPricing>> = Lazy::new(|| {
    vec![
        // OpenAI Models
        // Reference: https://openai.com/api/pricing/
        ModelPricing::simple("gpt-4o", 2.50, 10.00),
        ModelPricing::simple("gpt-4o-mini", 0.15, 0.60),
        ModelPricing::simple("gpt-4-turbo", 10.00, 30.00),
        ModelPricing::simple("gpt-4-32k", 60.00, 120.00),
        ModelPricing::simple("gpt-4-0125-preview", 10.00, 30.00),
        ModelPricing::simple("gpt-4-1106-preview", 10.00, 30.00),
        ModelPricing::simple("gpt-4", 30.00, 60.00),
        ModelPricing::simple("gpt-3.5-turbo", 0.50, 1.50),
        ModelPricing::simple("gpt-3.5", 0.50, 1.50),
        ModelPricing::simple("text-embedding-3-large", 0.13, 0.0),
        ModelPricing::simple("text-embedding-3-small", 0.02, 0.0),
        ModelPricing::simple("text-embedding-ada-002", 0.10, 0.0),
        // Anthropic Models
        // Reference: https://docs.anthropic.com/en/docs/about-claude/models#model-comparison-table
        ModelPricing::simple("claude-opus-4", 15.00, 75.00),
        ModelPricing::simple("claude-3-opus", 15.00, 75.00),
        // Claude Sonnet 4.5 with tiered pricing (extended context > 200k tokens)
        ModelPricing::tiered(
            "claude-sonnet-4-5",
            vec![
                PricingTier {
                    min_input_tokens: Some(200_000),
                    input_price_per_million: 6.00,
                    output_price_per_million: 22.50,
                },
                PricingTier {
                    min_input_tokens: None,
                    input_price_per_million: 3.00,
                    output_price_per_million: 15.00,
                },
            ],
        ),
        ModelPricing::simple("claude-3-5-sonnet", 3.00, 15.00),
        ModelPricing::simple("claude-3-sonnet", 3.00, 15.00),
        ModelPricing::simple("claude-haiku-4", 0.80, 4.00),
        ModelPricing::simple("claude-3-5-haiku", 0.80, 4.00),
        ModelPricing::simple("claude-3-haiku", 0.25, 1.25),
        // Google Gemini Models
        // Reference: https://ai.google.dev/pricing
        ModelPricing::simple("gemini-2.0-flash-exp", 0.0, 0.0), // Free during preview
        ModelPricing::simple("gemini-1.5-pro", 1.25, 5.00),
        ModelPricing::simple("gemini-1.5-flash", 0.075, 0.30),
        ModelPricing::simple("gemini-pro", 0.50, 1.50),
    ]
});

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_cost_gpt4() {
        let (input_cost, output_cost, total_cost) = calculate_cost("gpt-4o", 1000, 500).unwrap();
        assert_eq!(input_cost, 0.0025); // 1000 / 1M * $2.50
        assert_eq!(output_cost, 0.005); // 500 / 1M * $10.00
        assert_eq!(total_cost, 0.0075);
    }

    #[test]
    fn test_calculate_cost_claude_sonnet_default_tier() {
        // Test with < 200k tokens (default tier)
        let (input_cost, output_cost, total_cost) =
            calculate_cost("claude-sonnet-4-5", 50_000, 10_000).unwrap();
        assert!((input_cost - 0.15).abs() < 1e-10); // 50k / 1M * $3.00
        assert!((output_cost - 0.15).abs() < 1e-10); // 10k / 1M * $15.00
        assert!((total_cost - 0.30).abs() < 1e-10);
    }

    #[test]
    fn test_calculate_cost_claude_sonnet_extended_tier() {
        // Test with > 200k tokens (extended context tier)
        let (input_cost, output_cost, total_cost) =
            calculate_cost("claude-sonnet-4-5", 250_000, 10_000).unwrap();
        assert!((input_cost - 1.5).abs() < 1e-10); // 250k / 1M * $6.00
        assert!((output_cost - 0.225).abs() < 1e-10); // 10k / 1M * $22.50
        assert!((total_cost - 1.725).abs() < 1e-10);
    }

    #[test]
    fn test_calculate_cost_unknown_model() {
        assert!(calculate_cost("unknown-model-xyz", 1000, 500).is_none());
    }

    #[test]
    fn test_calculate_cost_gemini() {
        let (input_cost, output_cost, total_cost) =
            calculate_cost("gemini-1.5-flash", 10_000, 5_000).unwrap();
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
        let (input_cost, output_cost, total_cost) = calculate_cost("gpt-4o", 0, 0).unwrap();
        assert_eq!(input_cost, 0.0);
        assert_eq!(output_cost, 0.0);
        assert_eq!(total_cost, 0.0);
    }
}
