// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Community fallback for collecting the first or last matching document IDs.
//! The enterprise build exposes the same API with an optimized no-score
//! collector.

use tantivy::{DocId, Score, Searcher, collector::TopDocs, query::Query};

pub fn collect_top_doc_ids(
    searcher: &Searcher,
    query: &dyn Query,
    limit: usize,
    ascend: bool,
) -> tantivy::Result<Vec<DocId>> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    searcher
        .search(
            query,
            &TopDocs::with_limit(limit).tweak_score(
                move |_segment_reader: &tantivy::SegmentReader| {
                    move |doc_id: DocId, _original_score: Score| {
                        if ascend {
                            doc_id as i64
                        } else {
                            -(doc_id as i64)
                        }
                    }
                },
            ),
        )
        .map(|docs| docs.into_iter().map(|(_, doc)| doc.doc_id).collect())
}
