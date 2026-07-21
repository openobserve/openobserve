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

use std::{collections::HashSet, sync::Arc};

use arrow::buffer::BooleanBuffer;
#[cfg(not(feature = "enterprise"))]
use config::tantivy::query::histogram_collector::{
    MultiHistogramCollector, SimpleHistogramCollector, simple_histogram_rank,
};
use config::{
    TIMESTAMP_COL_NAME,
    meta::inverted_index::{IndexOptimizeMode, MAX_SIMPLE_TOPN_FIELDS},
    tantivy::query::{
        contains_query::ContainsAutomaton, ids_collector::SingleSegmentDocIdCollector,
        topn_collector::TopNCollector,
    },
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::search::tantivy::histogram_collector::{
    MultiHistogramCollector, SimpleHistogramCollector, simple_histogram_rank,
};
use tantivy::{
    DocId, Score, Searcher,
    collector::{Count, TopDocs},
    query::Query,
};

use crate::index::IndexCondition;

#[derive(Debug, Clone)]
pub enum TantivyResult {
    RowIds(Vec<u32>),
    RowIdsSelection {
        row_ids: Arc<BooleanBuffer>, // per-row match bitmap, length num_rows
        row_group_size: Option<u32>,
    },
    SelectCandidates {
        candidates: Arc<Vec<(i64, u32)>>, //(_timestamp, doc_id) pairs
        row_group_size: Option<u32>,
    },
    NoMatch, // the file should be excluded without building a bitmap
    Skipped {
        percent: usize, // skipped tantivy search, with the percentage
    },
    Count(usize),                            // simple count optimization
    Histogram(Vec<u64>),                     // simple histogram optimization
    MultiHistogram(Vec<(i64, String, u64)>), // multi histogram optimization (with breakdown)
    TopN(Vec<(Vec<String>, u64)>),           // group by top n optimization (1..=4 fields)
    Distinct(HashSet<String>),               // simple distinct optimization
}

impl TantivyResult {
    // used for skip tantivy search
    pub fn percent(&self) -> usize {
        match self {
            Self::Skipped { percent } => *percent,
            _ => 0,
        }
    }

    pub fn get_memory_size(&self) -> usize {
        match self {
            Self::RowIds(row_ids) => {
                row_ids.capacity() * std::mem::size_of::<u32>() + std::mem::size_of::<Vec<u32>>()
            }
            Self::RowIdsSelection { row_ids, .. } => {
                row_ids.inner().len() + std::mem::size_of::<BooleanBuffer>()
            }
            Self::SelectCandidates { candidates, .. } => {
                candidates.capacity() * std::mem::size_of::<(i64, u32)>()
                    + std::mem::size_of::<Vec<(i64, u32)>>()
            }
            Self::NoMatch => 0,
            Self::Skipped { .. } => std::mem::size_of::<usize>(),
            Self::Count(_) => std::mem::size_of::<usize>(),
            Self::Histogram(histogram) => {
                histogram.capacity() * std::mem::size_of::<u64>() + std::mem::size_of::<Vec<u64>>()
            }
            Self::MultiHistogram(multi_histogram) => {
                multi_histogram
                    .iter()
                    .map(|(_, s, _)| {
                        s.capacity() + std::mem::size_of::<i64>() + std::mem::size_of::<u64>()
                    })
                    .sum::<usize>()
                    + std::mem::size_of::<Vec<(i64, String, u64)>>()
            }
            Self::TopN(top_n) => {
                top_n
                    .iter()
                    .map(|(keys, _)| {
                        keys.iter().map(|s| s.capacity()).sum::<usize>()
                            + std::mem::size_of::<Vec<String>>()
                            + std::mem::size_of::<u64>()
                    })
                    .sum::<usize>()
                    + std::mem::size_of::<Vec<(Vec<String>, u64)>>()
            }
            Self::Distinct(distinct) => {
                distinct.iter().map(|s| s.capacity()).sum::<usize>()
                    + std::mem::size_of::<HashSet<String>>()
            }
        }
    }
}

impl TantivyResult {
    pub fn handle_matched_docs(searcher: &Searcher, query: Box<dyn Query>) -> anyhow::Result<Self> {
        let docs = searcher.search(&query, &SingleSegmentDocIdCollector)?;
        Ok(Self::RowIds(docs))
    }

    pub fn handle_simple_select(
        searcher: &Searcher,
        query: Box<dyn Query>,
        limit: usize,
        ascend: bool,
    ) -> anyhow::Result<Self> {
        let res = searcher.search(
            &query,
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
        )?;

        if res.is_empty() {
            return Ok(Self::SelectCandidates {
                candidates: Arc::new(Vec::new()),
                row_group_size: None,
            });
        }

        // every index file stores _timestamp as a single-valued fast field,
        // one value per doc_id; the caller enforces a single segment
        let ts_col = searcher.segment_readers()[0]
            .fast_fields()
            .i64(TIMESTAMP_COL_NAME)?;
        let candidates = res
            .into_iter()
            .map(|(_, doc)| {
                let ts = ts_col.first(doc.doc_id).ok_or_else(|| {
                    anyhow::anyhow!(
                        "missing {TIMESTAMP_COL_NAME} fast-field value for doc_id {}",
                        doc.doc_id
                    )
                })?;
                Ok((ts, doc.doc_id))
            })
            .collect::<anyhow::Result<Vec<_>>>()?;
        Ok(Self::SelectCandidates {
            candidates: Arc::new(candidates),
            row_group_size: None,
        })
    }

    pub fn handle_simple_count(searcher: &Searcher, query: Box<dyn Query>) -> anyhow::Result<Self> {
        let res = searcher.search(&query, &Count)?;
        Ok(Self::Count(res))
    }

    pub fn handle_simple_histogram(
        searcher: &Searcher,
        query: Box<dyn Query>,
        condition: &IndexCondition,
        idx_optimize_rule: IndexOptimizeMode,
        file_in_range: bool,
        file_min_ts: i64,
        file_max_ts: i64,
    ) -> anyhow::Result<Self> {
        let IndexOptimizeMode::SimpleHistogram(min_value, bucket_width, num_buckets, ts_offset) =
            idx_optimize_rule
        else {
            return Err(anyhow::anyhow!("invalid index optimize rule"));
        };
        // RANK fast path only when no extra _timestamp-range was ANDed in
        // (file fully in range) and the filter is match-all or a single term
        let (rank_eligible, term_field) = if file_in_range {
            if condition.is_condition_all() {
                (true, None)
            } else if let Some(tv) = condition.single_equal_term() {
                (true, Some(tv))
            } else {
                (false, None)
            }
        } else {
            (false, None)
        };

        // RANK fast path (enterprise); None falls back to the collector below
        if rank_eligible
            && let Some(counts) = simple_histogram_rank(
                searcher,
                TIMESTAMP_COL_NAME,
                term_field.as_ref().map(|(f, v)| (f.as_str(), v.as_str())),
                min_value,
                bucket_width,
                num_buckets,
                ts_offset,
                file_min_ts,
                file_max_ts,
            )?
        {
            return Ok(Self::Histogram(counts));
        }

        let res = searcher.search(
            &query,
            &SimpleHistogramCollector::new(
                TIMESTAMP_COL_NAME.to_string(),
                min_value,
                bucket_width,
                num_buckets,
                ts_offset,
            ),
        )?;

        Ok(Self::Histogram(res))
    }

    pub fn handle_simple_multi_histogram(
        searcher: &Searcher,
        query: Box<dyn Query>,
        min_value: i64,
        max_value: i64,
        bucket_width: u64,
        ts_offset: i64,
        breakdown_field: &str,
    ) -> anyhow::Result<Self> {
        let res = searcher.search(
            &query,
            &MultiHistogramCollector::new(
                TIMESTAMP_COL_NAME.to_string(),
                breakdown_field.to_string(),
                min_value,
                max_value,
                bucket_width,
                ts_offset,
            ),
        )?;

        Ok(Self::MultiHistogram(res))
    }

    pub fn handle_simple_top_n(
        searcher: &Searcher,
        query: Box<dyn Query>,
        fields: &[String],
        limit: usize,
        ascend: bool,
    ) -> anyhow::Result<Self> {
        if fields.is_empty() || fields.len() > MAX_SIMPLE_TOPN_FIELDS {
            anyhow::bail!(
                "handle_simple_top_n requires 1..={MAX_SIMPLE_TOPN_FIELDS} fields, got {}",
                fields.len()
            );
        }

        // a single ordinal fits a u32 key, two pack into a u64, three or four need a u128
        let results = if fields.len() == 1 {
            let collector = TopNCollector::<u32>::new(fields.to_vec(), limit, ascend);
            searcher.search(&query, &collector)?
        } else if fields.len() == 2 {
            let collector = TopNCollector::<u64>::new(fields.to_vec(), limit, ascend);
            searcher.search(&query, &collector)?
        } else {
            let collector = TopNCollector::<u128>::new(fields.to_vec(), limit, ascend);
            searcher.search(&query, &collector)?
        };

        Ok(Self::TopN(results))
    }

    pub fn handle_simple_distinct(
        searcher: &Searcher,
        index_condition: &IndexCondition,
        field: &str,
        limit: usize,
        ascend: bool,
    ) -> anyhow::Result<Self> {
        let mut distinct_values: Vec<String> = Vec::with_capacity(limit * 4);
        let field = searcher.schema().get_field(field).unwrap();
        if let Some((value, case_sensitive)) = index_condition.get_str_match_condition() {
            for seg in searcher.segment_readers() {
                let index = seg.inverted_index(field).unwrap();
                let mut terms = index
                    .terms()
                    .search(ContainsAutomaton::new(&value, case_sensitive))
                    .into_stream()
                    .unwrap();
                while let Some((term, _)) = terms.next() {
                    if ascend && distinct_values.len() >= limit {
                        break;
                    }
                    distinct_values.push(String::from_utf8(term.to_vec()).unwrap());
                }
            }
        } else {
            for seg in searcher.segment_readers() {
                let index = seg.inverted_index(field).unwrap();
                let mut terms = index.terms().stream().unwrap();
                while let Some((term, _)) = terms.next() {
                    if ascend && distinct_values.len() >= limit {
                        break;
                    }
                    distinct_values.push(String::from_utf8(term.to_vec()).unwrap());
                }
            }
        }
        if !ascend {
            distinct_values.reverse();
            distinct_values.truncate(limit);
        }
        Ok(Self::Distinct(distinct_values.into_iter().collect()))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn test_handle_simple_select_reads_candidate_timestamps() {
        const MARGIN_IN_BYTES: usize = 1_000_000;
        const MEMORY_BUDGET_NUM_BYTES_MIN: usize = ((MARGIN_IN_BYTES as u32) * 15u32) as usize;

        let mut schema_builder = tantivy::schema::SchemaBuilder::new();
        let ts_field = schema_builder.add_i64_field(TIMESTAMP_COL_NAME, tantivy::schema::FAST);
        let schema = schema_builder.build();
        let index = tantivy::index::Index::create_in_ram(schema);
        let mut writer = index
            .writer_with_num_threads(1, MEMORY_BUDGET_NUM_BYTES_MIN)
            .unwrap();
        // rows are stored newest first, matching the descending doc_id
        // ranking assumption of handle_simple_select
        for ts in [100i64, 90, 80, 70] {
            writer.add_document(tantivy::doc!(ts_field => ts)).unwrap();
        }
        writer.commit().unwrap();
        let searcher = index.reader().unwrap().searcher();

        let result = TantivyResult::handle_simple_select(
            &searcher,
            Box::new(tantivy::query::AllQuery),
            2,
            false,
        )
        .unwrap();
        match result {
            TantivyResult::SelectCandidates {
                candidates,
                row_group_size,
            } => {
                let mut candidates = (*candidates).clone();
                candidates.sort_unstable();
                assert_eq!(candidates, vec![(90, 1), (100, 0)]);
                assert_eq!(row_group_size, None);
            }
            other => panic!("expected SelectCandidates, got {other:?}"),
        }

        // ascending order picks the highest doc ids (oldest rows)
        let result = TantivyResult::handle_simple_select(
            &searcher,
            Box::new(tantivy::query::AllQuery),
            2,
            true,
        )
        .unwrap();
        match result {
            TantivyResult::SelectCandidates { candidates, .. } => {
                let mut candidates = (*candidates).clone();
                candidates.sort_unstable();
                assert_eq!(candidates, vec![(70, 3), (80, 2)]);
            }
            other => panic!("expected SelectCandidates, got {other:?}"),
        }
    }

    #[test]
    fn test_handle_simple_select_missing_timestamp_returns_error() {
        let mut schema_builder = tantivy::schema::SchemaBuilder::new();
        schema_builder.add_i64_field(TIMESTAMP_COL_NAME, tantivy::schema::FAST);
        let index = tantivy::index::Index::create_in_ram(schema_builder.build());
        let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
        writer.add_document(tantivy::doc!()).unwrap();
        writer.commit().unwrap();
        let searcher = index.reader().unwrap().searcher();

        let error = TantivyResult::handle_simple_select(
            &searcher,
            Box::new(tantivy::query::AllQuery),
            1,
            false,
        )
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("missing _timestamp fast-field value for doc_id 0")
        );
    }

    #[test]
    fn test_select_candidates_memory_size() {
        let result = TantivyResult::SelectCandidates {
            candidates: Arc::new(vec![(100i64, 1u32), (99, 2)]),
            row_group_size: None,
        };
        assert!(result.get_memory_size() >= 2 * std::mem::size_of::<(i64, u32)>());
    }

    #[test]
    fn test_tantivy_result_percent() {
        let result = TantivyResult::Skipped { percent: 75 };
        assert_eq!(result.percent(), 75);

        let result = TantivyResult::RowIds(Vec::new());
        assert_eq!(result.percent(), 0);

        let result = TantivyResult::Count(100);
        assert_eq!(result.percent(), 0);
    }

    #[test]
    fn test_tantivy_result_get_memory_size_count() {
        let result = TantivyResult::Count(12345);
        let memory_size = result.get_memory_size();

        assert_eq!(memory_size, std::mem::size_of::<usize>());
    }

    #[test]
    fn test_tantivy_result_get_memory_size_histogram() {
        let histogram = vec![10u64, 20u64, 30u64, 40u64];
        let result = TantivyResult::Histogram(histogram);
        let memory_size = result.get_memory_size();

        // Should include Vec overhead + capacity * size_of(u64)
        assert!(memory_size > 0);
        assert!(memory_size >= std::mem::size_of::<Vec<u64>>());
    }

    #[test]
    fn test_tantivy_result_get_memory_size_top_n() {
        let top_n = vec![
            (vec!["term1".to_string()], 100u64),
            (vec!["term2".to_string(), "sub1".to_string()], 200u64),
            (vec!["term3".to_string(), "sub2".to_string()], 150u64),
        ];
        let result = TantivyResult::TopN(top_n);
        let memory_size = result.get_memory_size();

        // Should include Vec overhead + string capacities + u64 sizes
        assert!(memory_size > 0);
        assert!(memory_size >= std::mem::size_of::<Vec<(Vec<String>, u64)>>());
    }

    #[test]
    fn test_tantivy_result_get_memory_size_distinct() {
        let mut distinct = HashSet::new();
        distinct.insert("value1".to_string());
        distinct.insert("value2".to_string());
        distinct.insert("value3".to_string());

        let result = TantivyResult::Distinct(distinct);
        let memory_size = result.get_memory_size();

        // Should include HashSet overhead + string capacities
        assert!(memory_size > 0);
        assert!(memory_size >= std::mem::size_of::<HashSet<String>>());
    }

    #[test]
    fn test_memory_size_edge_cases() {
        // Test with empty collections
        let result = TantivyResult::RowIdsSelection {
            row_ids: Arc::new(BooleanBuffer::new_unset(0)),
            row_group_size: None,
        };
        let memory_size = result.get_memory_size();
        assert_eq!(memory_size, std::mem::size_of::<BooleanBuffer>());

        let result = TantivyResult::RowIds(Vec::new());
        let memory_size = result.get_memory_size();
        assert!(memory_size >= std::mem::size_of::<Vec<u32>>());

        let result = TantivyResult::Histogram(vec![]);
        let memory_size = result.get_memory_size();
        assert!(memory_size >= std::mem::size_of::<Vec<u64>>());

        let result = TantivyResult::TopN(vec![]);
        let memory_size = result.get_memory_size();
        assert_eq!(memory_size, std::mem::size_of::<Vec<(String, u64)>>());

        let result = TantivyResult::Distinct(HashSet::new());
        let memory_size = result.get_memory_size();
        assert_eq!(memory_size, std::mem::size_of::<HashSet<String>>());
    }
}
