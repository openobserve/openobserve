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

use tantivy::{
    error::TantivyError,
    query::{AutomatonWeight, EnableScoring, Query, Weight},
    schema::Field,
};
use tantivy_fst::Automaton;

/// A Contains Query matches all of the documents
/// containing a specific term that contains
/// a given keyword.
///
/// This query is useful for finding documents where
/// a field contains a specific substring.
///
/// ```rust
/// use tantivy::collector::Count;
/// use tantivy::query::ContainsQuery;
/// use tantivy::schema::{Schema, TEXT};
/// use tantivy::{doc, Index, IndexWriter};
///
/// # fn test() -> tantivy::Result<()> {
/// let mut schema_builder = Schema::builder();
/// let title = schema_builder.add_text_field("title", TEXT);
/// let schema = schema_builder.build();
/// let index = Index::create_in_ram(schema);
/// {
///     let mut index_writer: IndexWriter = index.writer(15_000_000)?;
///     index_writer.add_document(doc!(
///         title => "The Name of the Wind",
///     ))?;
///     index_writer.add_document(doc!(
///         title => "The Diary of Muadib",
///     ))?;
///     index_writer.add_document(doc!(
///         title => "A Dairy Cow",
///     ))?;
///     index_writer.add_document(doc!(
///         title => "The Diary of a Young Girl",
///     ))?;
///     index_writer.commit()?;
/// }
///
/// let reader = index.reader()?;
/// let searcher = reader.searcher();
///
/// // Case-insensitive search (default)
/// let query = ContainsQuery::new("diary", title, false)?;
/// let count = searcher.search(&query, &Count)?;
/// assert_eq!(count, 2);
///
/// // Case-sensitive search
/// let query = ContainsQuery::new("Diary", title, true)?;
/// let count = searcher.search(&query, &Count)?;
/// assert_eq!(count, 2);
/// Ok(())
/// # }
/// # assert!(test().is_ok());
/// ```
#[derive(Debug, Clone)]
pub struct ContainsQuery {
    keyword: String,
    field: Field,
    case_sensitive: bool,
}

impl ContainsQuery {
    /// Creates a new ContainsQuery from a given keyword
    ///
    /// # Arguments
    ///
    /// * `keyword` - The keyword to search for
    /// * `field` - The field to search in
    /// * `case_sensitive` - If true, the search is case-sensitive. If false, the search is
    ///   case-insensitive.
    pub fn new(keyword: &str, field: Field, case_sensitive: bool) -> tantivy::Result<Self> {
        if keyword.is_empty() {
            return Err(TantivyError::InvalidArgument(
                "ContainsQuery keyword cannot be empty".to_string(),
            ));
        }
        let processed_keyword = if case_sensitive {
            keyword.to_string()
        } else {
            keyword.to_lowercase()
        };
        Ok(ContainsQuery {
            keyword: processed_keyword,
            field,
            case_sensitive,
        })
    }

    /// Creates a new case-insensitive ContainsQuery (convenience method)
    pub fn new_case_insensitive(keyword: &str, field: Field) -> tantivy::Result<Self> {
        Self::new(keyword, field, false)
    }

    /// Creates a new case-sensitive ContainsQuery (convenience method)
    pub fn new_case_sensitive(keyword: &str, field: Field) -> tantivy::Result<Self> {
        Self::new(keyword, field, true)
    }

    fn specialized_weight(&self) -> AutomatonWeight<ContainsAutomaton> {
        AutomatonWeight::new(
            self.field,
            ContainsAutomaton::new(&self.keyword, self.case_sensitive),
        )
    }
}

impl Query for ContainsQuery {
    fn weight(&self, _enabled_scoring: EnableScoring<'_>) -> tantivy::Result<Box<dyn Weight>> {
        Ok(Box::new(self.specialized_weight()))
    }
}

/// Automaton that matches terms containing a given keyword
#[derive(Debug, Clone)]
pub struct ContainsAutomaton {
    keyword: Vec<u8>,
    case_sensitive: bool,
}

impl ContainsAutomaton {
    pub fn new(keyword: &str, case_sensitive: bool) -> Self {
        ContainsAutomaton {
            keyword: keyword.as_bytes().to_vec(),
            case_sensitive,
        }
    }
}

impl Automaton for ContainsAutomaton {
    type State = ContainsState;

    fn start(&self) -> Self::State {
        ContainsState::Searching { pos: 0 }
    }

    fn is_match(&self, state: &Self::State) -> bool {
        matches!(state, ContainsState::Found)
    }

    fn can_match(&self, _state: &Self::State) -> bool {
        true // All states can potentially match
    }

    fn accept(&self, state: &Self::State, byte: u8) -> Self::State {
        match state {
            ContainsState::Found => ContainsState::Found,
            ContainsState::Searching { pos } => {
                let compare_byte = if self.case_sensitive {
                    byte
                } else {
                    byte.to_ascii_lowercase()
                };

                if *pos < self.keyword.len() && compare_byte == self.keyword[*pos] {
                    // Continue matching the keyword
                    if *pos + 1 == self.keyword.len() {
                        ContainsState::Found
                    } else {
                        ContainsState::Searching { pos: pos + 1 }
                    }
                } else if *pos > 0 {
                    // We were in the middle of matching, but this byte doesn't match
                    // Try to restart the match from the beginning
                    if compare_byte == self.keyword[0] {
                        ContainsState::Searching { pos: 1 }
                    } else {
                        ContainsState::Searching { pos: 0 }
                    }
                } else {
                    // We haven't started matching yet, keep searching
                    if compare_byte == self.keyword[0] {
                        ContainsState::Searching { pos: 1 }
                    } else {
                        ContainsState::Searching { pos: 0 }
                    }
                }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ContainsState {
    /// Still searching for the keyword
    Searching { pos: usize },
    /// Found the keyword
    Found,
}

#[cfg(test)]
mod test {
    use tantivy::{
        Index, IndexWriter,
        collector::TopDocs,
        doc,
        schema::{Field, STRING, Schema},
    };

    use super::ContainsQuery;

    fn build_test_index() -> tantivy::Result<(Index, Field)> {
        let mut schema_builder = Schema::builder();
        let title_field = schema_builder.add_text_field("title", STRING);
        let schema = schema_builder.build();
        let index = Index::create_in_ram(schema);
        {
            let mut index_writer: IndexWriter = index.writer(150000000).unwrap();
            index_writer.add_document(doc!(
                title_field => "The Name of the Wind",
            ))?;
            index_writer.add_document(doc!(
                title_field => "The Diary of Muadib",
            ))?;
            index_writer.add_document(doc!(
                title_field => "A Dairy Cow",
            ))?;
            index_writer.add_document(doc!(
                title_field => "The Diary of a Young Girl",
            ))?;
            index_writer.add_document(doc!(
                title_field => "Programming in Rust",
            ))?;
            index_writer.add_document(doc!(
                title_field => "Rust Programming Guide",
            ))?;
            index_writer.commit()?;
        }
        Ok((index, title_field))
    }

    #[test]
    pub fn test_contains_query() -> tantivy::Result<()> {
        let (index, field) = build_test_index()?;

        let matching = ContainsQuery::new("diary", field, false)?;
        let not_matching = ContainsQuery::new("xyz", field, false)?;
        verify_contains_query(matching, not_matching, index);
        Ok(())
    }

    #[test]
    pub fn test_contains_query_case_insensitive() -> tantivy::Result<()> {
        let (index, field) = build_test_index()?;
        let reader = index.reader()?;
        let searcher = reader.searcher();

        // Test case insensitive matching
        let query1 = ContainsQuery::new("DIARY", field, false)?;
        let query2 = ContainsQuery::new("diary", field, false)?;
        let query3 = ContainsQuery::new("Diary", field, false)?;

        let docs1 = searcher.search(&query1, &TopDocs::with_limit(10))?;
        let docs2 = searcher.search(&query2, &TopDocs::with_limit(10))?;
        let docs3 = searcher.search(&query3, &TopDocs::with_limit(10))?;

        assert_eq!(docs1.len(), docs2.len());
        assert_eq!(docs2.len(), docs3.len());
        assert_eq!(docs1.len(), 2); // "Diary" and "Dairy"

        Ok(())
    }

    #[test]
    pub fn test_contains_query_case_sensitive() -> tantivy::Result<()> {
        let (index, field) = build_test_index()?;
        let reader = index.reader()?;
        let searcher = reader.searcher();

        // Test case sensitive matching
        let query1 = ContainsQuery::new("Diary", field, true)?;
        let query2 = ContainsQuery::new("diary", field, true)?;
        let query3 = ContainsQuery::new("DAIRY", field, true)?;

        let docs1 = searcher.search(&query1, &TopDocs::with_limit(10))?;
        let docs2 = searcher.search(&query2, &TopDocs::with_limit(10))?;
        let docs3 = searcher.search(&query3, &TopDocs::with_limit(10))?;

        // "Diary" should match 2 documents
        assert_eq!(docs1.len(), 2);
        // "diary" should match 0 documents (case sensitive)
        assert_eq!(docs2.len(), 0);
        // "DAIRY" should match 0 documents (case sensitive)
        assert_eq!(docs3.len(), 0);

        Ok(())
    }

    #[test]
    pub fn test_contains_query_convenience_methods() -> tantivy::Result<()> {
        let (index, field) = build_test_index()?;
        let reader = index.reader()?;
        let searcher = reader.searcher();

        // Test convenience methods
        let case_insensitive_query = ContainsQuery::new_case_insensitive("diary", field)?;
        let case_sensitive_query = ContainsQuery::new_case_sensitive("Diary", field)?;

        let docs_insensitive =
            searcher.search(&case_insensitive_query, &TopDocs::with_limit(10))?;
        let docs_sensitive = searcher.search(&case_sensitive_query, &TopDocs::with_limit(10))?;

        assert_eq!(docs_insensitive.len(), 2);
        assert_eq!(docs_sensitive.len(), 2);

        Ok(())
    }

    #[test]
    pub fn test_contains_query_rust() -> tantivy::Result<()> {
        let (index, field) = build_test_index()?;
        let reader = index.reader()?;
        let searcher = reader.searcher();

        let query = ContainsQuery::new("rust", field, false)?;
        let docs = searcher.search(&query, &TopDocs::with_limit(10))?;
        assert_eq!(docs.len(), 2); // "Programming in Rust" and "Rust Programming Guide"

        Ok(())
    }

    #[test]
    pub fn test_contains_query_empty_keyword() {
        let (_index, field) = build_test_index().unwrap();

        match ContainsQuery::new("", field, false) {
            Err(tantivy::error::TantivyError::InvalidArgument(msg)) => {
                assert!(msg.contains("cannot be empty"))
            }
            res => panic!("unexpected result: {res:?}"),
        }
    }

    fn verify_contains_query(
        query_matching: ContainsQuery,
        query_not_matching: ContainsQuery,
        index: Index,
    ) {
        let reader = index.reader().unwrap();
        let searcher = reader.searcher();
        {
            let scored_docs = searcher
                .search(&query_matching, &TopDocs::with_limit(10))
                .unwrap();
            assert!(!scored_docs.is_empty(), "Expected at least 1 document");
            for (score, _) in scored_docs {
                assert_eq!(score, 1.0);
            }
        }
        let top_docs = searcher
            .search(&query_not_matching, &TopDocs::with_limit(10))
            .unwrap();
        assert!(top_docs.is_empty(), "Expected ZERO document");
    }
}
