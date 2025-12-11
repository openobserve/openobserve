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

use std::str::CharIndices;

use tantivy::tokenizer::{Token, TokenStream, Tokenizer};

#[derive(Default, Clone)]
pub enum CollectType {
    #[default]
    Ingest,
    Search,
}

/// Tokenize the text by splitting on whitespaces and punctuation.
#[derive(Clone, Default)]
pub struct O2Tokenizer {
    token: Token,
    collect_type: CollectType,
}

impl O2Tokenizer {
    pub fn new(collect_type: CollectType) -> Self {
        Self {
            collect_type,
            ..Default::default()
        }
    }
}

/// TokenStream produced by the `O2Tokenizer`.
pub struct O2TokenStream<'a> {
    text: &'a str,
    chars: CharIndices<'a>,
    token: &'a mut Token,
    buffer: Vec<&'a str>,
    buffer_offset: usize,
    collect_type: &'a CollectType,
}

impl Tokenizer for O2Tokenizer {
    type TokenStream<'a> = O2TokenStream<'a>;
    fn token_stream<'a>(&'a mut self, text: &'a str) -> O2TokenStream<'a> {
        self.token.reset();
        O2TokenStream {
            text,
            chars: text.char_indices(),
            token: &mut self.token,
            buffer: Vec::new(),
            buffer_offset: 0,
            collect_type: &self.collect_type,
        }
    }
}

impl O2TokenStream<'_> {
    // search for the end of the current token.
    fn search_token_end(&mut self) -> (usize, char) {
        (self.chars)
            .find(|(_, c)| !c.is_ascii_alphanumeric())
            .unwrap_or((self.text.len(), ' '))
    }

    // get the next token from the buffer
    fn get_buffer_token(&mut self) -> bool {
        if self.buffer.is_empty() {
            return false;
        }
        let token = self.buffer.remove(0);
        self.token.offset_from = self.buffer_offset;
        self.token.offset_to = self.buffer_offset + token.len();
        self.token.text.push_str(token);
        self.buffer_offset += token.len();
        true
    }
}

impl TokenStream for O2TokenStream<'_> {
    fn advance(&mut self) -> bool {
        self.token.text.clear();
        self.token.position = self.token.position.wrapping_add(1);

        // First, check if we have buffered tokens from previous camel case split
        if self.get_buffer_token() {
            return true;
        }

        // Scan for the next alphanumeric character (skipping punctuation/whitespace)
        while let Some((offset_from, c)) = self.chars.next() {
            if c.is_alphanumeric() {
                // Non-ASCII alphanumeric characters are emitted individually
                if !c.is_ascii() {
                    self.token.text.push(c);
                    self.token.offset_from = offset_from;
                    self.token.offset_to = offset_from + c.len_utf8();
                    return true;
                }

                // Find where this ASCII token ends
                let (offset_to, stop_c) = self.search_token_end();
                let token_text = &self.text[offset_from..offset_to];

                // Check if this token has uppercase letters after the first character (camel case)
                // This excludes tokens like "Hello" or "INFO" that are just capitalized or all-caps
                if token_text.len() > 1 && token_text.chars().skip(1).any(char::is_uppercase) {
                    // Split "CamelCase" -> ["Camel", "Case"] and buffer them for later
                    let splits = split_camel_case(token_text);

                    // Only emit root separately if we have actual splits (len > 1)
                    if splits.len() > 1 {
                        self.buffer.extend(splits);
                        self.buffer_offset = offset_from;

                        // If the delimiter after this token is non-ASCII, buffer it as a separate
                        // token
                        if !stop_c.is_ascii() {
                            self.buffer
                                .push(&self.text[offset_to..offset_to + stop_c.len_utf8()]);
                        }

                        // Emit the root token first (the full "CamelCase" before splits)
                        if matches!(self.collect_type, CollectType::Ingest) {
                            self.token.offset_from = offset_from;
                            self.token.offset_to = offset_to;
                            self.token.text.push_str(token_text);
                            return true;
                        } else {
                            // Search mode - skip root token and emit first buffered split
                            return self.get_buffer_token();
                        }
                    }
                    // If splits.len() == 1, fall through to emit normally
                }

                if !stop_c.is_ascii() {
                    // No camel case, but the delimiter is non-ASCII, so buffer it for next call
                    self.buffer
                        .push(&self.text[offset_to..offset_to + stop_c.len_utf8()]);
                    self.buffer_offset = offset_to;
                }

                // Emit the token we found
                self.token.offset_from = offset_from;
                self.token.offset_to = offset_to;
                self.token.text.push_str(token_text);
                return true;
            }
            // If c is not alphanumeric, continue looping (skip punctuation/whitespace)
        }

        // No more tokens
        false
    }

    fn token(&self) -> &Token {
        self.token
    }

    fn token_mut(&mut self) -> &mut Token {
        self.token
    }
}

fn split_camel_case(input: &str) -> Vec<&str> {
    if looks_like_base64(input) {
        return vec![input];
    }
    let mut words = Vec::new();
    let mut start = 0;
    let mut prev_was_upper = false;
    for (i, c) in input.char_indices() {
        if c.is_uppercase() {
            if i != 0
                && (!prev_was_upper
                    || (i + 1 < input.len()
                        && input[i + 1..]
                            .chars()
                            .next()
                            .map(|c| c.is_lowercase())
                            .unwrap_or(false)))
            {
                words.push(&input[start..i]);
                start = i;
            }
            prev_was_upper = true;
        } else {
            prev_was_upper = false;
        }
    }

    words.push(&input[start..]);
    words
}

// Add this helper function to detect base64-like strings
fn looks_like_base64(s: &str) -> bool {
    // Base64 characteristics:
    // 1. Only contains [A-Za-z0-9], the tokenizer will remove all non-alphanumeric characters
    // 2. Should be reasonably long (to avoid false positives)
    const MIN_BASE64_LENGTH: usize = super::MAX_TOKEN_LENGTH + 1; // Adjust this threshold as needed

    if s.len() < MIN_BASE64_LENGTH {
        return false;
    }

    s.chars()
        .all(|c| matches!(c, 'A'..='Z' | 'a'..='z' | '0'..='9' ))
}

#[cfg(test)]
mod tests {
    use tantivy::tokenizer::{TextAnalyzer, Token};

    use super::*;

    /// This is a function that can be used in tests and doc tests
    /// to assert a token's correctness.
    fn assert_token(token: &Token, position: usize, text: &str, from: usize, to: usize) {
        assert_eq!(
            token.position, position,
            "expected position {position} but {token:?}"
        );
        assert_eq!(token.text, text, "expected text {text} but {token:?}");
        assert_eq!(
            token.offset_from, from,
            "expected offset_from {from} but {token:?}"
        );
        assert_eq!(token.offset_to, to, "expected offset_to {to} but {token:?}");
    }

    fn token_stream_helper(text: &str, collect_type: CollectType) -> Vec<Token> {
        let mut a = TextAnalyzer::from(O2Tokenizer::new(collect_type));
        let mut token_stream = a.token_stream(text);
        let mut tokens: Vec<Token> = vec![];
        let mut add_token = |token: &Token| {
            tokens.push(token.clone());
        };
        token_stream.process(&mut add_token);
        tokens
    }

    #[test]
    fn test_o2_tokenizer() {
        let tokens = token_stream_helper(
            "Hello, happy tax payer!민족어대사전中文的ErrorExceptionAndHTTPResponse",
            CollectType::Ingest,
        );
        assert_eq!(tokens.len(), 19);
        assert_token(&tokens[0], 0, "Hello", 0, 5);
        assert_token(&tokens[1], 1, "happy", 7, 12);
        assert_token(&tokens[2], 2, "tax", 13, 16);
        assert_token(&tokens[3], 3, "payer", 17, 22);
        assert_token(&tokens[4], 4, "민", 23, 26);
        assert_token(&tokens[5], 5, "족", 26, 29);
        assert_token(&tokens[6], 6, "어", 29, 32);
        assert_token(&tokens[7], 7, "대", 32, 35);
        assert_token(&tokens[8], 8, "사", 35, 38);
        assert_token(&tokens[9], 9, "전", 38, 41);
        assert_token(&tokens[10], 10, "中", 41, 44);
        assert_token(&tokens[11], 11, "文", 44, 47);
        assert_token(&tokens[12], 12, "的", 47, 50);
        assert_token(&tokens[13], 13, "ErrorExceptionAndHTTPResponse", 50, 79); // Root token
        assert_token(&tokens[14], 14, "Error", 50, 55);
        assert_token(&tokens[15], 15, "Exception", 55, 64);
        assert_token(&tokens[16], 16, "And", 64, 67);
        assert_token(&tokens[17], 17, "HTTP", 67, 71);
        assert_token(&tokens[18], 18, "Response", 71, 79);
    }

    #[test]
    fn test_o2_tokenizer_search() {
        // Search mode - no root token for camelCase
        let tokens = token_stream_helper(
            "Hello, happy tax payer!민족어대사전中文的ErrorExceptionAndHTTPResponse",
            CollectType::Search,
        );
        assert_eq!(tokens.len(), 18); // No root token for ErrorExceptionAndHTTPResponse
        assert_token(&tokens[0], 0, "Hello", 0, 5);
        assert_token(&tokens[1], 1, "happy", 7, 12);
        assert_token(&tokens[2], 2, "tax", 13, 16);
        assert_token(&tokens[3], 3, "payer", 17, 22);
        assert_token(&tokens[4], 4, "민", 23, 26);
        assert_token(&tokens[5], 5, "족", 26, 29);
        assert_token(&tokens[6], 6, "어", 29, 32);
        assert_token(&tokens[7], 7, "대", 32, 35);
        assert_token(&tokens[8], 8, "사", 35, 38);
        assert_token(&tokens[9], 9, "전", 38, 41);
        assert_token(&tokens[10], 10, "中", 41, 44);
        assert_token(&tokens[11], 11, "文", 44, 47);
        assert_token(&tokens[12], 12, "的", 47, 50);
        // No root token - only splits
        assert_token(&tokens[13], 13, "Error", 50, 55);
        assert_token(&tokens[14], 14, "Exception", 55, 64);
        assert_token(&tokens[15], 15, "And", 64, 67);
        assert_token(&tokens[16], 16, "HTTP", 67, 71);
        assert_token(&tokens[17], 17, "Response", 71, 79);
    }

    #[test]
    fn test_o2_tokenizer_camel_case() {
        let tokens = token_stream_helper("CamelCase", CollectType::Ingest);
        assert_eq!(tokens.len(), 3);
        assert_token(&tokens[0], 0, "CamelCase", 0, 9); // Root token first
        assert_token(&tokens[1], 1, "Camel", 0, 5); // Then split tokens
        assert_token(&tokens[2], 2, "Case", 5, 9);
    }

    #[test]
    fn test_o2_tokenizer_camel_case_search() {
        let tokens = token_stream_helper("CamelCase", CollectType::Search);
        assert_eq!(tokens.len(), 2); // No root token in search mode
        assert_token(&tokens[0], 0, "Camel", 0, 5); // Only split tokens
        assert_token(&tokens[1], 1, "Case", 5, 9);
    }

    #[test]
    fn test_o2_tokenizer_camel_case_with_base64() {
        let body = "2025-03-13 INFO Current Users : Ly8gQWRkIHRoaXMgaGVscGVyIGZ1bmN0aW9uIHRvIGRldGVjd+O2gQWRkIHRoaXMgaGVscGVyIGZ1bmN0aW9uIHRvIGRldGVjdCBiYXNlNjQtbGlrZSBzdHJpbmdzCmZuIGxvb2tzX2xpa2VfYmFzZTY0KHM6ICZzdHIpIC0xIGJvb2wgewogICAgLy8gQmFzZTY0IGNoYXJhY3RlcmlzdGljczoKICAgIC8vIDEuIExlbmd0aCBzaG91bGQgYmUgbXVsdGlwbGUgb2YgNCAoZXhjZXB0IGZvciBwYWRkZWQgc3RyaW5ncykKICAgIC8vIDIuIE9ubHkgY29udGFpbnMgW0EtWmEtejAtOSsvPV0KICAgIC8vIDMuIFNob3VsZCBiZSByZWFzb25hYmx5IGxvbmcgKHRvIGF2b2lkIGZhbHNlIHBvc2l0aXZlcykKICAgIGNvbnN0IE1JTl9CQVNFNjRfTEVOR1RIOiB1c2l6ZSA9IgPCBNSU5fQkFTRTY0X0xF==";
        let tokens = token_stream_helper(body, CollectType::Ingest);
        assert_eq!(tokens.len(), 28);
        assert_token(&tokens[0], 0, "2025", 0, 4);
        assert_token(&tokens[1], 1, "03", 5, 7);
        assert_token(&tokens[2], 2, "13", 8, 10);
        assert_token(&tokens[3], 3, "INFO", 11, 15);
        assert_token(&tokens[4], 4, "Current", 16, 23);
        assert_token(&tokens[5], 5, "Users", 24, 29);
    }

    #[test]
    fn test_o2_tokenizer_all_caps() {
        // All caps words should NOT be split
        let tokens = token_stream_helper("HTTP API REST JSON XML", CollectType::Ingest);
        assert_eq!(tokens.len(), 5);
        assert_token(&tokens[0], 0, "HTTP", 0, 4);
        assert_token(&tokens[1], 1, "API", 5, 8);
        assert_token(&tokens[2], 2, "REST", 9, 13);
        assert_token(&tokens[3], 3, "JSON", 14, 18);
        assert_token(&tokens[4], 4, "XML", 19, 22);
    }

    #[test]
    fn test_o2_tokenizer_acronym_with_word() {
        // "HTTPSConnection" should emit root + splits: "HTTPS", "Connection"
        let tokens = token_stream_helper("HTTPSConnection", CollectType::Ingest);
        assert_eq!(tokens.len(), 3);
        assert_token(&tokens[0], 0, "HTTPSConnection", 0, 15); // Root token
        assert_token(&tokens[1], 1, "HTTPS", 0, 5);
        assert_token(&tokens[2], 2, "Connection", 5, 15);
    }

    #[test]
    fn test_o2_tokenizer_acronym_with_word_search() {
        // "HTTPSConnection" in search mode - no root token
        let tokens = token_stream_helper("HTTPSConnection", CollectType::Search);
        assert_eq!(tokens.len(), 2); // No root token
        assert_token(&tokens[0], 0, "HTTPS", 0, 5);
        assert_token(&tokens[1], 1, "Connection", 5, 15);
    }

    #[test]
    fn test_o2_tokenizer_numbers_in_camel_case() {
        // "base64String" has 'S', so it's camelCase: root + "base64", "String"
        // "utf8Encode" has 'E', so it's camelCase: root + "utf8", "Encode"
        let tokens = token_stream_helper("base64String utf8Encode", CollectType::Ingest);
        assert_eq!(tokens.len(), 6);
        assert_token(&tokens[0], 0, "base64String", 0, 12); // Root
        assert_token(&tokens[1], 1, "base64", 0, 6);
        assert_token(&tokens[2], 2, "String", 6, 12);
        assert_token(&tokens[3], 3, "utf8Encode", 13, 23); // Root
        assert_token(&tokens[4], 4, "utf8", 13, 17);
        assert_token(&tokens[5], 5, "Encode", 17, 23);
    }

    #[test]
    fn test_o2_tokenizer_numbers_in_camel_case_search() {
        // Search mode - no root tokens
        let tokens = token_stream_helper("base64String utf8Encode", CollectType::Search);
        assert_eq!(tokens.len(), 4); // No root tokens
        assert_token(&tokens[0], 0, "base64", 0, 6);
        assert_token(&tokens[1], 1, "String", 6, 12);
        assert_token(&tokens[2], 2, "utf8", 13, 17);
        assert_token(&tokens[3], 3, "Encode", 17, 23);
    }

    #[test]
    fn test_o2_tokenizer_single_uppercase_first_char() {
        // Single uppercase first character should NOT trigger camelCase
        let tokens = token_stream_helper("Hello World Welcome", CollectType::Ingest);
        assert_eq!(tokens.len(), 3);
        assert_token(&tokens[0], 0, "Hello", 0, 5);
        assert_token(&tokens[1], 1, "World", 6, 11);
        assert_token(&tokens[2], 2, "Welcome", 12, 19);
    }

    #[test]
    fn test_o2_tokenizer_consecutive_uppercase() {
        // "XMLHttpRequest" -> root + splits: "XML", "Http", "Request"
        let tokens = token_stream_helper("XMLHttpRequest", CollectType::Ingest);
        assert_eq!(tokens.len(), 4);
        assert_token(&tokens[0], 0, "XMLHttpRequest", 0, 14); // Root
        assert_token(&tokens[1], 1, "XML", 0, 3);
        assert_token(&tokens[2], 2, "Http", 3, 7);
        assert_token(&tokens[3], 3, "Request", 7, 14);
    }

    #[test]
    fn test_o2_tokenizer_consecutive_uppercase_search() {
        // Search mode - no root token
        let tokens = token_stream_helper("XMLHttpRequest", CollectType::Search);
        assert_eq!(tokens.len(), 3); // No root token
        assert_token(&tokens[0], 0, "XML", 0, 3);
        assert_token(&tokens[1], 1, "Http", 3, 7);
        assert_token(&tokens[2], 2, "Request", 7, 14);
    }

    #[test]
    fn test_o2_tokenizer_mixed_scripts() {
        // Mixed Latin, Chinese, Japanese, Korean - each CJK character is a separate token
        let tokens = token_stream_helper("Hello世界こんにちは안녕하세요", CollectType::Ingest);
        assert_eq!(tokens.len(), 13);
        assert_token(&tokens[0], 0, "Hello", 0, 5);
        assert_token(&tokens[1], 1, "世", 5, 8);
        assert_token(&tokens[2], 2, "界", 8, 11);
        assert_token(&tokens[3], 3, "こ", 11, 14);
        assert_token(&tokens[4], 4, "ん", 14, 17);
        assert_token(&tokens[5], 5, "に", 17, 20);
        assert_token(&tokens[6], 6, "ち", 20, 23);
        assert_token(&tokens[7], 7, "は", 23, 26);
        assert_token(&tokens[8], 8, "안", 26, 29);
        assert_token(&tokens[9], 9, "녕", 29, 32);
        assert_token(&tokens[10], 10, "하", 32, 35);
        assert_token(&tokens[11], 11, "세", 35, 38);
        assert_token(&tokens[12], 12, "요", 38, 41);
    }

    #[test]
    fn test_o2_tokenizer_empty_and_punctuation() {
        // Empty string should produce no tokens
        let tokens = token_stream_helper("", CollectType::Ingest);
        assert_eq!(tokens.len(), 0);

        // Only punctuation should produce no tokens
        let tokens = token_stream_helper("!@#$%^&*()", CollectType::Ingest);
        assert_eq!(tokens.len(), 0);

        // Only whitespace should produce no tokens
        let tokens = token_stream_helper("   \t\n  ", CollectType::Ingest);
        assert_eq!(tokens.len(), 0);
    }

    #[test]
    fn test_o2_tokenizer_multiple_camel_case_sequence() {
        // Multiple camelCase words in sequence
        let tokens = token_stream_helper("getUserName getEmailAddress", CollectType::Ingest);
        assert_eq!(tokens.len(), 8);
        // getUserName: root + get, User, Name
        assert_token(&tokens[0], 0, "getUserName", 0, 11);
        assert_token(&tokens[1], 1, "get", 0, 3);
        assert_token(&tokens[2], 2, "User", 3, 7);
        assert_token(&tokens[3], 3, "Name", 7, 11);
        // getEmailAddress: root + get, Email, Address
        assert_token(&tokens[4], 4, "getEmailAddress", 12, 27);
        assert_token(&tokens[5], 5, "get", 12, 15);
        assert_token(&tokens[6], 6, "Email", 15, 20);
        assert_token(&tokens[7], 7, "Address", 20, 27);
    }

    #[test]
    fn test_o2_tokenizer_multiple_camel_case_sequence_search() {
        // Search mode - no root tokens
        let tokens = token_stream_helper("getUserName getEmailAddress", CollectType::Search);
        assert_eq!(tokens.len(), 6); // No root tokens
        assert_token(&tokens[0], 0, "get", 0, 3);
        assert_token(&tokens[1], 1, "User", 3, 7);
        assert_token(&tokens[2], 2, "Name", 7, 11);
        assert_token(&tokens[3], 3, "get", 12, 15);
        assert_token(&tokens[4], 4, "Email", 15, 20);
        assert_token(&tokens[5], 5, "Address", 20, 27);
    }

    #[test]
    fn test_o2_tokenizer_numbers_only() {
        let tokens = token_stream_helper("123 456 789", CollectType::Ingest);
        assert_eq!(tokens.len(), 3);
        assert_token(&tokens[0], 0, "123", 0, 3);
        assert_token(&tokens[1], 1, "456", 4, 7);
        assert_token(&tokens[2], 2, "789", 8, 11);
    }

    #[test]
    fn test_o2_tokenizer_alphanumeric_mix() {
        // Mix of letters and numbers without camelCase
        let tokens = token_stream_helper("test123 data456abc", CollectType::Ingest);
        assert_eq!(tokens.len(), 2);
        assert_token(&tokens[0], 0, "test123", 0, 7);
        assert_token(&tokens[1], 1, "data456abc", 8, 18);
    }

    #[test]
    fn test_o2_tokenizer_single_char_tokens() {
        let tokens = token_stream_helper("a b c", CollectType::Ingest);
        assert_eq!(tokens.len(), 3);
        assert_token(&tokens[0], 0, "a", 0, 1);
        assert_token(&tokens[1], 1, "b", 2, 3);
        assert_token(&tokens[2], 2, "c", 4, 5);
    }

    #[test]
    fn test_o2_tokenizer_special_camel_cases() {
        // "iPhone" should emit root + splits: "i", "Phone"
        let tokens = token_stream_helper("iPhone", CollectType::Ingest);
        assert_eq!(tokens.len(), 3);
        assert_token(&tokens[0], 0, "iPhone", 0, 6); // Root
        assert_token(&tokens[1], 1, "i", 0, 1);
        assert_token(&tokens[2], 2, "Phone", 1, 6);

        // "eBay" should emit root + splits: "e", "Bay"
        let tokens = token_stream_helper("eBay", CollectType::Ingest);
        assert_eq!(tokens.len(), 3);
        assert_token(&tokens[0], 0, "eBay", 0, 4); // Root
        assert_token(&tokens[1], 1, "e", 0, 1);
        assert_token(&tokens[2], 2, "Bay", 1, 4);
    }

    #[test]
    fn test_o2_tokenizer_special_camel_cases_search() {
        // Search mode - no root tokens
        let tokens = token_stream_helper("iPhone", CollectType::Search);
        assert_eq!(tokens.len(), 2); // No root
        assert_token(&tokens[0], 0, "i", 0, 1);
        assert_token(&tokens[1], 1, "Phone", 1, 6);

        let tokens = token_stream_helper("eBay", CollectType::Search);
        assert_eq!(tokens.len(), 2); // No root
        assert_token(&tokens[0], 0, "e", 0, 1);
        assert_token(&tokens[1], 1, "Bay", 1, 4);
    }

    #[test]
    fn test_o2_tokenizer_camel_case_short() {
        let body = "U8iI34Vi";
        let tokens = token_stream_helper(body, CollectType::Ingest);
        assert_eq!(tokens.len(), 4);
        assert_token(&tokens[0], 0, "U8iI34Vi", 0, 8);
        assert_token(&tokens[1], 1, "U8i", 0, 3);
        assert_token(&tokens[2], 2, "I34", 3, 6);
        assert_token(&tokens[3], 3, "Vi", 6, 8);
    }

    #[test]
    fn test_o2_tokenizer_camel_case_short_search() {
        let body = "U8iI34Vi";
        let tokens = token_stream_helper(body, CollectType::Search);
        assert_eq!(tokens.len(), 3); // No root token
        assert_token(&tokens[0], 0, "U8i", 0, 3);
        assert_token(&tokens[1], 1, "I34", 3, 6);
        assert_token(&tokens[2], 2, "Vi", 6, 8);
    }

    #[test]
    fn test_o2_tokenizer_camel_case_ip() {
        let body = "192.168.1.80";
        let tokens = token_stream_helper(body, CollectType::Ingest);
        assert_eq!(tokens.len(), 4);
        assert_token(&tokens[0], 0, "192", 0, 3);
        assert_token(&tokens[1], 1, "168", 4, 7);
        assert_token(&tokens[2], 2, "1", 8, 9);
        assert_token(&tokens[3], 3, "80", 10, 12);
    }
}
