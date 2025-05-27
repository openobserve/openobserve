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

/// Tokenize the text by splitting on whitespaces and punctuation.
#[derive(Clone, Default)]
pub struct O2Tokenizer {
    token: Token,
}

/// TokenStream produced by the `O2Tokenizer`.
pub struct O2TokenStream<'a> {
    text: &'a str,
    chars: CharIndices<'a>,
    token: &'a mut Token,
    buffer: Vec<&'a str>,
    buffer_offset: usize,
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
        if self.get_buffer_token() {
            return true;
        }
        while let Some((offset_from, c)) = self.chars.next() {
            if c.is_alphanumeric() {
                let (offset_to, stop_c) = self.search_token_end();
                if self.text[offset_from..offset_to]
                    .chars()
                    .any(char::is_uppercase)
                {
                    // handle camel case
                    self.buffer
                        .extend(split_camel_case(&self.text[offset_from..offset_to]));
                    self.buffer_offset = offset_from;
                    if !stop_c.is_ascii() {
                        self.buffer
                            .push(&self.text[offset_to..offset_to + stop_c.len_utf8()]);
                    }
                    if self.get_buffer_token() {
                        return true;
                    }
                } else if !stop_c.is_ascii() {
                    self.buffer
                        .push(&self.text[offset_to..offset_to + stop_c.len_utf8()]);
                    self.buffer_offset = offset_to;
                }
                self.token.offset_from = offset_from;
                self.token.offset_to = offset_to;
                self.token.text.push_str(&self.text[offset_from..offset_to]);
                return true;
            }
        }
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
    const MIN_BASE64_LENGTH: usize = 1024; // Adjust this threshold as needed

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

    fn token_stream_helper(text: &str) -> Vec<Token> {
        let mut a = TextAnalyzer::from(O2Tokenizer::default());
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
        );
        assert_eq!(tokens.len(), 18);
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
        assert_token(&tokens[13], 13, "Error", 50, 55);
        assert_token(&tokens[14], 14, "Exception", 55, 64);
        assert_token(&tokens[15], 15, "And", 64, 67);
        assert_token(&tokens[16], 16, "HTTP", 67, 71);
        assert_token(&tokens[17], 17, "Response", 71, 79);
    }

    #[test]
    fn test_o2_tokenizer_camel_case() {
        let tokens = token_stream_helper("CamelCase");
        assert_eq!(tokens.len(), 2);
        assert_token(&tokens[0], 0, "Camel", 0, 5);
        assert_token(&tokens[1], 1, "Case", 5, 9);
    }

    #[test]
    fn test_o2_tokenizer_camel_case_with_base64() {
        let body = "2025-03-13 INFO Current Users : Ly8gQWRkIHRoaXMgaGVscGVyIGZ1bmN0aW9uIHRvIGRldGVjdCBiYXNlNjQtbGlrZSBzdHJpbmdzCmZuIGxvb2tzX2xpa2VfYmFzZTY0KHM6ICZzdHIpIC0xIGJvb2wgewogICAgLy8gQmFzZTY0IGNoYXJhY3RlcmlzdGljczoKICAgIC8vIDEuIExlbmd0aCBzaG91bGQgYmUgbXVsdGlwbGUgb2YgNCAoZXhjZXB0IGZvciBwYWRkZWQgc3RyaW5ncykKICAgIC8vIDIuIE9ubHkgY29udGFpbnMgW0EtWmEtejAtOSsvPV0KICAgIC8vIDMuIFNob3VsZCBiZSByZWFzb25hYmx5IGxvbmcgKHRvIGF2b2lkIGZhbHNlIHBvc2l0aXZlcykKICAgIGNvbnN0IE1JTl9CQVNFNjRfTEVOR1RIOiB1c2l6ZSA9IDE2OyAvLyBBZGp1c3QgdGhpcyB0aHJlc2hvbGQgYXMgbmVlZGVkCiAgICAKICAgIGlmIHMubGVuKCkgPCBNSU5fQkFTRTY0X0xFTkdUSCB7c3NzCiAgICAgICAgcmV0dXJuIGZhbHNlO3gKICAgIH0KICAgIC8vIEFkZCB0aGlzIGhlbHBlciBmdW5jdGlvbiB0byBkZXRlY3QgYmFzZTY0LWxpa2Ugc3RyaW5ncwpmbiBsb29rc19saWtlX2Jhc2U2NChzOiAmc3RyKSAtPiBib29sIHsKICAgIC8vIEJhc2U2NCBjaGFyYWN0ZXJpc3RpY3M6CiAgICAvLyAxLiBMZW5ndGggc2hvdWxkIGJlIG11bHRpcGxlIG9mIDQgKGV4Y2VwdCBmb3IgcGFkZGVkIHN0cmluZ3MpCiAgICAvLyAyLiBPbmx5IGNvbnRhaW5zIFtBLVphLXowLTkrLz1dCiAgICAvLyAzLiBTaG91bGQgYmUgcmVhc29uYWJseSBsb25nICh0byBhdm9pZCBmYWxzZSBwb3NpdGl2ZXMpCiAgICBjb25zdCBNSU5fQkFTRTY0X0xFTkdUSDogdXNpemUgPSAxNjsgLy8gQWRqdXN0IHRoaXMgdGhyZXNob2xkIGFzIG5lZWRlZAogICAgCiAgICBpZiBzLmxlbigpIDwgTUlOX0JBU0U2NF9MRU5HVEggewogICAgICAgIHJldHVybiBmYWxzZTsKICAgIH0KICAgIA==";
        let tokens = token_stream_helper(body);
        assert_eq!(tokens.len(), 7);
        assert_token(&tokens[0], 0, "2025", 0, 4);
        assert_token(&tokens[1], 1, "03", 5, 7);
        assert_token(&tokens[2], 2, "13", 8, 10);
        assert_token(&tokens[3], 3, "INFO", 11, 15);
        assert_token(&tokens[4], 4, "Current", 16, 23);
        assert_token(&tokens[5], 5, "Users", 24, 29);
    }
}
