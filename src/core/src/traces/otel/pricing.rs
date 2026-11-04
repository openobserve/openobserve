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

//! Token counting for LLM spans that report a prompt but no usage.

use tiktoken_rs::{get_bpe_from_model, o200k_base};

pub fn calculate_token_count(model_name: &str, prompt: &str) -> i64 {
    let encoding = match get_bpe_from_model(model_name) {
        Ok(m) => m,
        Err(_) => o200k_base().unwrap(),
    };
    let tokens = encoding.encode_with_special_tokens(prompt);
    tokens.len() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

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
