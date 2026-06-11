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

use tantivy::{
    DocId, Score, SegmentOrdinal, SegmentReader,
    collector::{Collector, SegmentCollector},
};

/// A collector for single-segment indexes that gathers all matching doc IDs.
///
/// Assumes the index has exactly one segment. `merge_fruits` pops the single
/// segment's result rather than concatenating, keeping allocations minimal.
pub struct SingleSegmentDocIdCollector;

pub struct SingleSegmentDocIdSegmentCollector {
    pub(crate) docs: Vec<DocId>,
}

impl SegmentCollector for SingleSegmentDocIdSegmentCollector {
    type Fruit = Vec<DocId>;

    #[inline]
    fn collect(&mut self, doc: DocId, _score: Score) {
        self.docs.push(doc);
    }

    #[inline]
    fn collect_block(&mut self, docs: &[DocId]) {
        self.docs.extend_from_slice(docs);
    }

    fn harvest(self) -> Vec<DocId> {
        self.docs
    }
}

impl Collector for SingleSegmentDocIdCollector {
    type Fruit = Vec<DocId>;
    type Child = SingleSegmentDocIdSegmentCollector;

    fn for_segment(
        &self,
        _segment_local_id: SegmentOrdinal,
        segment: &SegmentReader,
    ) -> tantivy::Result<Self::Child> {
        Ok(SingleSegmentDocIdSegmentCollector {
            docs: Vec::with_capacity(segment.max_doc() as usize),
        })
    }

    fn requires_scoring(&self) -> bool {
        false
    }

    fn merge_fruits(&self, mut segment_fruits: Vec<Vec<DocId>>) -> tantivy::Result<Vec<DocId>> {
        debug_assert!(
            segment_fruits.len() <= 1,
            "SingleSegmentDocIdCollector used on multi-segment index"
        );
        Ok(segment_fruits.pop().unwrap_or_default())
    }
}

#[cfg(test)]
mod tests {
    use tantivy::{
        Index, IndexWriter, TantivyDocument,
        collector::{Collector, SegmentCollector},
        query::AllQuery,
        schema::{Schema, TEXT},
    };

    use super::*;

    fn build_single_segment_index(doc_count: usize) -> (Index, tantivy::Searcher) {
        let mut schema_builder = Schema::builder();
        let body = schema_builder.add_text_field("body", TEXT);
        let schema = schema_builder.build();

        let index = Index::create_in_ram(schema);
        let mut writer: IndexWriter = index.writer(15_000_000).unwrap();

        for i in 0..doc_count {
            let mut doc = TantivyDocument::default();
            doc.add_text(body, &format!("document number {i}"));
            writer.add_document(doc).unwrap();
        }
        writer.commit().unwrap();

        let reader = index.reader().unwrap();
        let searcher = reader.searcher();
        (index, searcher)
    }

    #[test]
    fn test_collector_returns_all_docs() {
        let (_index, searcher) = build_single_segment_index(5);
        let docs = searcher
            .search(&AllQuery, &SingleSegmentDocIdCollector)
            .unwrap();
        assert_eq!(docs.len(), 5);
    }

    #[test]
    fn test_collector_empty_index() {
        let (_index, searcher) = build_single_segment_index(0);
        let docs = searcher
            .search(&AllQuery, &SingleSegmentDocIdCollector)
            .unwrap();
        assert!(docs.is_empty());
    }

    #[test]
    fn test_collector_doc_ids_are_valid() {
        let doc_count = 10;
        let (_index, searcher) = build_single_segment_index(doc_count);
        let docs = searcher
            .search(&AllQuery, &SingleSegmentDocIdCollector)
            .unwrap();

        assert_eq!(docs.len(), doc_count);
        // All doc IDs must be within [0, max_doc)
        let max_doc = searcher.segment_readers()[0].max_doc();
        for &doc_id in &docs {
            assert!(doc_id < max_doc, "doc_id {doc_id} >= max_doc {max_doc}");
        }
    }

    #[test]
    fn test_requires_scoring_is_false() {
        assert!(!SingleSegmentDocIdCollector.requires_scoring());
    }

    #[test]
    fn test_merge_fruits_returns_single_segment() {
        let collector = SingleSegmentDocIdCollector;
        let fruits = vec![vec![0, 1, 2]];
        let merged = collector.merge_fruits(fruits).unwrap();
        assert_eq!(merged, vec![0, 1, 2]);
    }

    // debug_assert! is compiled out in release builds, so only test the panic
    // when debug assertions are enabled.
    #[cfg(debug_assertions)]
    #[test]
    #[should_panic(expected = "SingleSegmentDocIdCollector used on multi-segment index")]
    fn test_merge_fruits_panics_on_multiple_segments() {
        let collector = SingleSegmentDocIdCollector;
        let fruits = vec![vec![0, 1, 2], vec![3, 4, 5]];
        let _ = collector.merge_fruits(fruits);
    }

    #[test]
    fn test_merge_fruits_empty_input() {
        let collector = SingleSegmentDocIdCollector;
        let merged = collector.merge_fruits(vec![]).unwrap();
        assert!(merged.is_empty());
    }

    #[test]
    fn test_segment_collector_collect_block() {
        let mut seg_collector = SingleSegmentDocIdSegmentCollector { docs: vec![] };
        seg_collector.collect_block(&[0, 1, 2, 3]);
        assert_eq!(seg_collector.docs, vec![0, 1, 2, 3]);
    }

    #[test]
    fn test_segment_collector_collect_single() {
        let mut seg_collector = SingleSegmentDocIdSegmentCollector { docs: vec![] };
        seg_collector.collect(42, 1.0);
        seg_collector.collect(7, 0.5);
        assert_eq!(seg_collector.docs, vec![42, 7]);
    }

    #[test]
    fn test_segment_collector_harvest() {
        let seg_collector = SingleSegmentDocIdSegmentCollector {
            docs: vec![10, 20, 30],
        };
        let harvested = seg_collector.harvest();
        assert_eq!(harvested, vec![10, 20, 30]);
    }

    #[test]
    fn test_for_segment_pre_allocates_capacity() {
        let (_index, searcher) = build_single_segment_index(100);
        let segment_reader = &searcher.segment_readers()[0];
        let collector = SingleSegmentDocIdCollector;
        let child = collector.for_segment(0, segment_reader).unwrap();
        // The pre-allocated capacity should be at least max_doc
        assert!(child.docs.capacity() >= segment_reader.max_doc() as usize);
    }

    #[test]
    fn test_term_query_returns_matching_docs_only() {
        use tantivy::{
            Term,
            query::TermQuery,
            schema::{IndexRecordOption, TEXT},
        };

        let mut schema_builder = Schema::builder();
        let body = schema_builder.add_text_field("body", TEXT);
        let schema = schema_builder.build();

        let index = Index::create_in_ram(schema);
        let mut writer: IndexWriter = index.writer(15_000_000).unwrap();

        let mut doc = TantivyDocument::default();
        doc.add_text(body, "hello world");
        writer.add_document(doc).unwrap();

        let mut doc = TantivyDocument::default();
        doc.add_text(body, "goodbye world");
        writer.add_document(doc).unwrap();

        let mut doc = TantivyDocument::default();
        doc.add_text(body, "hello again");
        writer.add_document(doc).unwrap();

        writer.commit().unwrap();

        let reader = index.reader().unwrap();
        let searcher = reader.searcher();

        let term = Term::from_field_text(body, "hello");
        let query = TermQuery::new(term, IndexRecordOption::Basic);

        let docs = searcher
            .search(&query, &SingleSegmentDocIdCollector)
            .unwrap();
        assert_eq!(docs.len(), 2, "expected 2 docs matching 'hello'");
    }
}
