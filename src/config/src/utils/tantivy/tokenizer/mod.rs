// Copyright 2025 OpenObserve Inc.
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

mod o2_tokenizer;
mod remove_short;

pub use o2_tokenizer::O2Tokenizer;
use tantivy::tokenizer::{SimpleTokenizer, TextAnalyzer, Token};

use crate::{get_config, utils::tantivy::tokenizer::remove_short::RemoveShortFilter};

pub const O2_TOKENIZER: &str = "o2";
const MIN_TOKEN_LENGTH: usize = 2;
const MAX_TOKEN_LENGTH: usize = 64;

pub fn o2_tokenizer_build() -> TextAnalyzer {
    let cfg = get_config();
    let min_token_length =
        std::cmp::max(cfg.limit.inverted_index_min_token_length, MIN_TOKEN_LENGTH);
    let max_token_length =
        std::cmp::max(cfg.limit.inverted_index_max_token_length, MAX_TOKEN_LENGTH);
    if cfg.common.inverted_index_camel_case_tokenizer_disabled {
        tantivy::tokenizer::TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(RemoveShortFilter::limit(min_token_length))
            .filter(tantivy::tokenizer::RemoveLongFilter::limit(
                max_token_length,
            ))
            .filter(tantivy::tokenizer::LowerCaser)
            .build()
    } else {
        tantivy::tokenizer::TextAnalyzer::builder(O2Tokenizer::default())
            .filter(RemoveShortFilter::limit(min_token_length))
            .filter(tantivy::tokenizer::RemoveLongFilter::limit(
                max_token_length,
            ))
            .filter(tantivy::tokenizer::LowerCaser)
            .build()
    }
}

#[derive(Default, Debug)]
pub struct CollectedTokens {
    // Smalled possible tokens in string. Contains;
    // - tokens from camel case tokenization step ( for example, `Camel` and `Case` from
    //   `CamelCase` )
    // - tokens spearated by non alphanumeric characters
    // - Non ASCII tokens - UTF8
    pub atomic_tokens: Vec<String>,
    // Root tokens before camel case tokenization step
    pub root_tokens: Vec<String>,
}

pub fn o2_collect_tokens(text: &str) -> CollectedTokens {
    let mut a = o2_tokenizer_build();
    let mut token_stream = a.token_stream(text);
    let mut tokens = CollectedTokens::default();
    // we will never run in a case where the offset_from is same for two tokens except for o2
    // tokenizer, but keeping this check to make it explicit.
    let is_o2_tokenizer = !get_config()
        .common
        .inverted_index_camel_case_tokenizer_disabled;
    let mut previous_token: Option<Token> = None;
    let mut add_token = |token: &Token| {
        if let Some(pt) = previous_token.as_ref()
            && pt.offset_from == token.offset_from
            && is_o2_tokenizer
        {
            // move the previous token to root token as we found its atomic token
            if let Some(root_token) = tokens.atomic_tokens.pop() {
                tokens.root_tokens.push(root_token);
            } else {
                unreachable!()
            }
        }
        tokens.atomic_tokens.push(token.text.to_lowercase());
        previous_token = Some(token.to_owned());
    };
    token_stream.process(&mut add_token);
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_o2_collect_tokens_classify_tokens() {
        let mut collected_tokens = o2_collect_tokens("CamelCase");

        assert_eq!(collected_tokens.atomic_tokens.len(), 2);
        assert_eq!(
            collected_tokens.atomic_tokens.pop(),
            Some("case".to_owned())
        );
        assert_eq!(
            collected_tokens.atomic_tokens.pop(),
            Some("camel".to_owned())
        );

        assert_eq!(
            collected_tokens.root_tokens.pop(),
            Some("camelcase".to_owned())
        );
    }

    #[test]
    fn test_o2_collect_tokens_classify_tokens_long() {
        let collected_tokens = o2_collect_tokens(
            "Hello, happy tax payer!민족어대사전中文的ErrorExceptionAndHTTPResponse",
        );

        // After lowercasing and filtering, we should have:
        // - 18 atomic tokens (hello, happy, tax, payer, 6 Korean chars, 3 Chinese chars, error,
        //   exception, and, http, response)
        // - 1 root token (errorexceptionandhttpresponse before camel case split)
        assert_eq!(collected_tokens.atomic_tokens.len(), 18);
        assert_eq!(collected_tokens.root_tokens.len(), 1);

        // Verify atomic tokens contain all expected tokens
        assert!(collected_tokens.atomic_tokens.contains(&"hello".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"happy".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"tax".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"payer".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"민".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"족".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"어".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"대".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"사".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"전".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"中".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"文".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"的".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"error".to_owned()));
        assert!(
            collected_tokens
                .atomic_tokens
                .contains(&"exception".to_owned())
        );
        assert!(collected_tokens.atomic_tokens.contains(&"and".to_owned()));
        assert!(collected_tokens.atomic_tokens.contains(&"http".to_owned()));
        assert!(
            collected_tokens
                .atomic_tokens
                .contains(&"response".to_owned())
        );

        // Verify root token
        assert_eq!(
            collected_tokens.root_tokens[0],
            "errorexceptionandhttpresponse"
        );
    }
}
