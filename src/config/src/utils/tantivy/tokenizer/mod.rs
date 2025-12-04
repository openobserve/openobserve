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

pub use o2_tokenizer::{CollectType, O2Tokenizer};
use tantivy::tokenizer::{TextAnalyzer, Token};

use crate::{get_config, utils::tantivy::tokenizer::remove_short::RemoveShortFilter};

pub const O2_TOKENIZER: &str = "o2";
const MIN_TOKEN_LENGTH: usize = 2;
const MAX_TOKEN_LENGTH: usize = 64;

pub fn o2_tokenizer_build(collect_type: CollectType) -> TextAnalyzer {
    let cfg = get_config();
    let min_token_length =
        std::cmp::max(cfg.limit.inverted_index_min_token_length, MIN_TOKEN_LENGTH);
    let max_token_length =
        std::cmp::max(cfg.limit.inverted_index_max_token_length, MAX_TOKEN_LENGTH);
    tantivy::tokenizer::TextAnalyzer::builder(O2Tokenizer::new(collect_type))
        .filter(RemoveShortFilter::limit(min_token_length))
        .filter(tantivy::tokenizer::RemoveLongFilter::limit(
            max_token_length,
        ))
        .filter(tantivy::tokenizer::LowerCaser)
        .build()
}

pub fn o2_collect_search_tokens(text: &str) -> Vec<String> {
    let mut a = o2_tokenizer_build(CollectType::Search);
    let mut token_stream = a.token_stream(text);

    let mut tokens: Vec<String> = Vec::new();
    let mut add_token = |token: &Token| {
        tokens.push(token.text.to_lowercase());
    };
    token_stream.process(&mut add_token);
    tokens
}
