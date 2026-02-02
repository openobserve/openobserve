use tantivy::tokenizer::{Token, TokenFilter, TokenStream, Tokenizer};

/// `RemoveShortFilter` removes tokens that are shorter
/// than a given number of bytes (in UTF-8 representation).
///
/// It is especially useful when indexing unconstrained content.
/// e.g. Mail containing base-64 encoded pictures etc.
#[derive(Clone)]
pub struct RemoveShortFilter {
    length_limit: usize,
}

impl RemoveShortFilter {
    /// Creates a `RemoveShortFilter` given a limit in bytes of the UTF-8 representation.
    pub fn limit(length_limit: usize) -> RemoveShortFilter {
        RemoveShortFilter { length_limit }
    }
}

impl<T> RemoveShortFilterStream<T> {
    fn predicate(&self, token: &Token) -> bool {
        token.text.len() >= self.token_length_limit
    }
}

impl TokenFilter for RemoveShortFilter {
    type Tokenizer<T: Tokenizer> = RemoveShortFilterWrapper<T>;

    fn transform<T: Tokenizer>(self, tokenizer: T) -> RemoveShortFilterWrapper<T> {
        RemoveShortFilterWrapper {
            length_limit: self.length_limit,
            inner: tokenizer,
        }
    }
}

#[derive(Clone)]
pub struct RemoveShortFilterWrapper<T: Tokenizer> {
    length_limit: usize,
    inner: T,
}

impl<T: Tokenizer> Tokenizer for RemoveShortFilterWrapper<T> {
    type TokenStream<'a> = RemoveShortFilterStream<T::TokenStream<'a>>;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        RemoveShortFilterStream {
            token_length_limit: self.length_limit,
            tail: self.inner.token_stream(text),
        }
    }
}

pub struct RemoveShortFilterStream<T> {
    token_length_limit: usize,
    tail: T,
}

impl<T: TokenStream> TokenStream for RemoveShortFilterStream<T> {
    fn advance(&mut self) -> bool {
        while self.tail.advance() {
            if self.predicate(self.tail.token()) {
                return true;
            }
        }
        false
    }

    fn token(&self) -> &Token {
        self.tail.token()
    }

    fn token_mut(&mut self) -> &mut Token {
        self.tail.token_mut()
    }
}

#[cfg(test)]
mod tests {
    use tantivy::tokenizer::{SimpleTokenizer, TextAnalyzer, Token};

    use super::*;

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
        let mut a = TextAnalyzer::builder(SimpleTokenizer::default())
            .filter(RemoveShortFilter::limit(2))
            .build();
        let mut token_stream = a.token_stream(text);
        let mut tokens: Vec<Token> = vec![];
        let mut add_token = |token: &Token| {
            tokens.push(token.clone());
        };
        token_stream.process(&mut add_token);
        tokens
    }

    #[test]
    fn test_remove_short() {
        let tokens = token_stream_helper("i am a hello tantivy, happy searching!");
        assert_eq!(tokens.len(), 5);
        assert_token(&tokens[0], 1, "am", 2, 4);
        assert_token(&tokens[1], 3, "hello", 7, 12);
        assert_token(&tokens[2], 4, "tantivy", 13, 20);
        assert_token(&tokens[3], 5, "happy", 22, 27);
        assert_token(&tokens[4], 6, "searching", 28, 37);
    }
}
