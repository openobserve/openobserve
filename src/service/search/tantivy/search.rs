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

use std::{collections::HashSet, fmt::Display, sync::Arc};

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

use crate::service::search::index::IndexCondition;

#[derive(Debug, Clone)]
pub enum TantivyResult {
    RowIds(Vec<u32>),
    RowIdsSelection {
        row_ids: Arc<BooleanBuffer>, // per-row match bitmap, length num_rows
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

        let row_ids = res
            .into_iter()
            .map(|(_, doc)| doc.doc_id)
            .collect::<Vec<_>>();
        Ok(Self::RowIds(row_ids))
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

// TantivyMultiResultBuilder is used to build a TantivyMultiResult from multiple TantivyResult
pub enum TantivyMultiResultBuilder {
    RowNums(u64),
    Histogram(Vec<Vec<u64>>),
    MultiHistogram(Vec<Vec<(i64, String, u64)>>),
    TopN(Vec<(Vec<String>, u64)>),
    Distinct(HashSet<String>),
}

impl TantivyMultiResultBuilder {
    pub fn new(optimize_rule: &Option<IndexOptimizeMode>) -> Self {
        match optimize_rule {
            Some(IndexOptimizeMode::SimpleHistogram(..)) => Self::Histogram(vec![]),
            Some(IndexOptimizeMode::SimpleMultiHistogram(..)) => Self::MultiHistogram(vec![]),
            Some(IndexOptimizeMode::SimpleTopN(..)) => Self::TopN(vec![]),
            Some(IndexOptimizeMode::SimpleDistinct(..)) => Self::Distinct(HashSet::new()),
            Some(IndexOptimizeMode::SimpleSelect(..))
            | Some(IndexOptimizeMode::SimpleCount)
            | None => Self::RowNums(0),
        }
    }

    pub fn add_row_nums(&mut self, row_nums: u64) {
        match self {
            Self::RowNums(a) => *a += row_nums,
            _ => unreachable!("unsupported tantivy multi result"),
        }
    }

    pub fn add_histogram(&mut self, histogram: Vec<u64>) {
        match self {
            Self::Histogram(a) => {
                if !histogram.is_empty() {
                    a.push(histogram);
                }
            }
            _ => unreachable!("unsupported tantivy multi result"),
        }
    }

    pub fn add_multi_histogram(&mut self, multi_histogram: Vec<(i64, String, u64)>) {
        match self {
            Self::MultiHistogram(a) => {
                if !multi_histogram.is_empty() {
                    a.push(multi_histogram);
                }
            }
            _ => unreachable!("unsupported tantivy multi result"),
        }
    }

    pub fn add_top_n(&mut self, top_n: Vec<(Vec<String>, u64)>) {
        match self {
            Self::TopN(a) => a.extend(top_n),
            _ => unreachable!("unsupported tantivy multi result"),
        }
    }

    pub fn add_distinct(&mut self, distinct: HashSet<String>) {
        match self {
            Self::Distinct(a) => a.extend(distinct),
            _ => unreachable!("unsupported tantivy multi result"),
        }
    }

    pub fn num_rows(&self) -> usize {
        match self {
            Self::RowNums(a) => *a as usize,
            _ => 0,
        }
    }

    pub fn build(self) -> TantivyMultiResult {
        match self {
            Self::RowNums(a) => TantivyMultiResult::RowNums(a),
            Self::Histogram(histograms_hits) => {
                if histograms_hits.is_empty() {
                    return TantivyMultiResult::Histogram(vec![]);
                }
                let len = histograms_hits[0].len();
                let histogram = (0..len)
                    .map(|i| {
                        histograms_hits
                            .iter()
                            .map(|v| v.get(i).unwrap_or(&0))
                            .sum::<u64>()
                    })
                    .collect();
                TantivyMultiResult::Histogram(histogram)
            }
            Self::MultiHistogram(results) => {
                // Merge: flatten all per-file results into a single Vec
                let merged: Vec<(i64, String, u64)> = results.into_iter().flatten().collect();
                TantivyMultiResult::MultiHistogram(merged)
            }
            Self::TopN(a) => TantivyMultiResult::TopN(a),
            Self::Distinct(a) => TantivyMultiResult::Distinct(a),
        }
    }
}

pub enum TantivyMultiResult {
    RowNums(u64),
    Histogram(Vec<u64>),
    MultiHistogram(Vec<(i64, String, u64)>),
    TopN(Vec<(Vec<String>, u64)>),
    Distinct(HashSet<String>),
}

impl Display for TantivyMultiResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RowNums(num) => write!(f, "row_nums: {num}"),
            Self::Histogram(histogram) => {
                write!(f, "histogram hits: {}", histogram.iter().sum::<u64>())
            }
            Self::MultiHistogram(multi_histogram) => {
                write!(f, "multi_histogram hits: {}", multi_histogram.len())
            }
            Self::TopN(top_n) => write!(f, "top_n hits: {}", top_n.len()),
            Self::Distinct(distinct) => write!(f, "distinct hits: {}", distinct.len()),
        }
    }
}

impl TantivyMultiResult {
    pub fn num_rows(&self) -> usize {
        match self {
            Self::RowNums(a) => *a as usize,
            _ => 0,
        }
    }

    pub fn histogram(self) -> Vec<u64> {
        match self {
            Self::Histogram(a) => a,
            _ => vec![],
        }
    }

    pub fn multi_histogram(self) -> Vec<(i64, String, u64)> {
        match self {
            Self::MultiHistogram(a) => a,
            _ => vec![],
        }
    }

    pub fn top_n(self) -> Vec<(Vec<String>, u64)> {
        match self {
            Self::TopN(a) => a,
            _ => vec![],
        }
    }

    pub fn distinct(self) -> HashSet<String> {
        match self {
            Self::Distinct(a) => a,
            _ => HashSet::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use config::meta::inverted_index::IndexOptimizeMode;

    use super::*;

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
    fn test_tantivy_multi_result_builder_new() {
        // Test with SimpleHistogram
        let optimize_rule = Some(IndexOptimizeMode::SimpleHistogram(0, 1000, 10, 0));
        let builder = TantivyMultiResultBuilder::new(&optimize_rule);
        assert!(matches!(builder, TantivyMultiResultBuilder::Histogram(_)));

        // Test with SimpleTopN
        let optimize_rule = Some(IndexOptimizeMode::SimpleTopN(
            vec!["field".to_string()],
            10,
            true,
        ));
        let builder = TantivyMultiResultBuilder::new(&optimize_rule);
        assert!(matches!(builder, TantivyMultiResultBuilder::TopN(_)));

        // Test with SimpleDistinct
        let optimize_rule = Some(IndexOptimizeMode::SimpleDistinct(
            "field".to_string(),
            10,
            true,
        ));
        let builder = TantivyMultiResultBuilder::new(&optimize_rule);
        assert!(matches!(builder, TantivyMultiResultBuilder::Distinct(_)));

        // Test with SimpleSelect
        let optimize_rule = Some(IndexOptimizeMode::SimpleSelect(10, true));
        let builder = TantivyMultiResultBuilder::new(&optimize_rule);
        assert!(matches!(builder, TantivyMultiResultBuilder::RowNums(_)));

        // Test with SimpleCount
        let optimize_rule = Some(IndexOptimizeMode::SimpleCount);
        let builder = TantivyMultiResultBuilder::new(&optimize_rule);
        assert!(matches!(builder, TantivyMultiResultBuilder::RowNums(_)));

        // Test with None
        let builder = TantivyMultiResultBuilder::new(&None);
        assert!(matches!(builder, TantivyMultiResultBuilder::RowNums(_)));
    }

    #[test]
    fn test_tantivy_multi_result_builder_add_row_nums() {
        let mut builder = TantivyMultiResultBuilder::RowNums(10);
        builder.add_row_nums(5);

        match builder {
            TantivyMultiResultBuilder::RowNums(count) => assert_eq!(count, 15),
            _ => panic!("Expected RowNums variant"),
        }
    }

    #[test]
    fn test_tantivy_multi_result_builder_add_histogram() {
        let mut builder = TantivyMultiResultBuilder::Histogram(vec![]);

        builder.add_histogram(vec![10, 20, 30]);
        builder.add_histogram(vec![5, 15, 25]);

        match &builder {
            TantivyMultiResultBuilder::Histogram(histograms) => {
                assert_eq!(histograms.len(), 2);
                assert_eq!(histograms[0], vec![10, 20, 30]);
                assert_eq!(histograms[1], vec![5, 15, 25]);
            }
            _ => panic!("Expected Histogram variant"),
        }

        // Test empty histogram is not added
        builder.add_histogram(vec![]);
        match &builder {
            TantivyMultiResultBuilder::Histogram(histograms) => {
                assert_eq!(histograms.len(), 2); // Should still be 2
            }
            _ => panic!("Expected Histogram variant"),
        }
    }

    #[test]
    fn test_tantivy_multi_result_builder_add_top_n() {
        let mut builder = TantivyMultiResultBuilder::TopN(vec![]);

        let top_n1 = vec![
            (vec!["term1".to_string()], 100),
            (vec!["term2".to_string()], 50),
        ];
        let top_n2 = vec![(vec!["term3".to_string(), "sub1".to_string()], 75)];

        builder.add_top_n(top_n1);
        builder.add_top_n(top_n2);

        match &builder {
            TantivyMultiResultBuilder::TopN(results) => {
                assert_eq!(results.len(), 3);
                assert_eq!(results[0].0, vec!["term1".to_string()]);
                assert_eq!(results[0].1, 100);
                assert_eq!(results[2].0, vec!["term3".to_string(), "sub1".to_string()]);
                assert_eq!(results[2].1, 75);
            }
            _ => panic!("Expected TopN variant"),
        }
    }

    #[test]
    fn test_tantivy_multi_result_builder_add_distinct() {
        let mut builder = TantivyMultiResultBuilder::Distinct(HashSet::new());

        let mut distinct1 = HashSet::new();
        distinct1.insert("value1".to_string());
        distinct1.insert("value2".to_string());

        let mut distinct2 = HashSet::new();
        distinct2.insert("value2".to_string()); // Duplicate
        distinct2.insert("value3".to_string());

        builder.add_distinct(distinct1);
        builder.add_distinct(distinct2);

        match &builder {
            TantivyMultiResultBuilder::Distinct(results) => {
                assert_eq!(results.len(), 3); // Should deduplicate
                assert!(results.contains("value1"));
                assert!(results.contains("value2"));
                assert!(results.contains("value3"));
            }
            _ => panic!("Expected Distinct variant"),
        }
    }

    #[test]
    fn test_tantivy_multi_result_builder_num_rows() {
        let builder = TantivyMultiResultBuilder::RowNums(42);
        assert_eq!(builder.num_rows(), 42);

        let builder = TantivyMultiResultBuilder::Histogram(vec![]);
        assert_eq!(builder.num_rows(), 0);

        let builder = TantivyMultiResultBuilder::TopN(vec![]);
        assert_eq!(builder.num_rows(), 0);

        let builder = TantivyMultiResultBuilder::Distinct(HashSet::new());
        assert_eq!(builder.num_rows(), 0);
    }

    #[test]
    fn test_tantivy_multi_result_builder_build() {
        // Test RowNums build
        let builder = TantivyMultiResultBuilder::RowNums(100);
        let result = builder.build();
        match result {
            TantivyMultiResult::RowNums(count) => assert_eq!(count, 100),
            _ => panic!("Expected RowNums result"),
        }

        // Test empty Histogram build
        let builder = TantivyMultiResultBuilder::Histogram(vec![]);
        let result = builder.build();
        match result {
            TantivyMultiResult::Histogram(hist) => assert!(hist.is_empty()),
            _ => panic!("Expected Histogram result"),
        }

        // Test Histogram build with data
        let mut builder = TantivyMultiResultBuilder::Histogram(vec![]);
        builder.add_histogram(vec![10, 20, 30]);
        builder.add_histogram(vec![5, 15, 25]);
        let result = builder.build();
        match result {
            TantivyMultiResult::Histogram(hist) => {
                assert_eq!(hist.len(), 3);
                assert_eq!(hist[0], 15); // 10 + 5
                assert_eq!(hist[1], 35); // 20 + 15
                assert_eq!(hist[2], 55); // 30 + 25
            }
            _ => panic!("Expected Histogram result"),
        }

        // Test TopN build
        let mut builder = TantivyMultiResultBuilder::TopN(vec![]);
        builder.add_top_n(vec![(vec!["term1".to_string()], 100)]);
        let result = builder.build();
        match result {
            TantivyMultiResult::TopN(top_n) => {
                assert_eq!(top_n.len(), 1);
                assert_eq!(top_n[0].0, vec!["term1".to_string()]);
                assert_eq!(top_n[0].1, 100);
            }
            _ => panic!("Expected TopN result"),
        }

        // Test Distinct build
        let mut builder = TantivyMultiResultBuilder::Distinct(HashSet::new());
        let mut distinct = HashSet::new();
        distinct.insert("value1".to_string());
        builder.add_distinct(distinct);
        let result = builder.build();
        match result {
            TantivyMultiResult::Distinct(dist) => {
                assert_eq!(dist.len(), 1);
                assert!(dist.contains("value1"));
            }
            _ => panic!("Expected Distinct result"),
        }
    }

    #[test]
    fn test_tantivy_multi_result_num_rows() {
        let result = TantivyMultiResult::RowNums(123);
        assert_eq!(result.num_rows(), 123);

        let result = TantivyMultiResult::Histogram(vec![10, 20, 30]);
        assert_eq!(result.num_rows(), 0);

        let result = TantivyMultiResult::TopN(vec![(vec!["term".to_string()], 50)]);
        assert_eq!(result.num_rows(), 0);

        let mut distinct = HashSet::new();
        distinct.insert("value".to_string());
        let result = TantivyMultiResult::Distinct(distinct);
        assert_eq!(result.num_rows(), 0);
    }

    #[test]
    fn test_tantivy_multi_result_histogram() {
        let histogram_data = vec![10, 20, 30, 40];
        let result = TantivyMultiResult::Histogram(histogram_data.clone());

        let extracted = result.histogram();
        assert_eq!(extracted, histogram_data);

        // Test non-histogram returns empty vec
        let result = TantivyMultiResult::RowNums(100);
        let extracted = result.histogram();
        assert!(extracted.is_empty());
    }

    #[test]
    fn test_tantivy_multi_result_top_n() {
        let top_n_data = vec![
            (vec!["term1".to_string()], 100),
            (vec!["term2".to_string(), "sub1".to_string()], 50),
        ];
        let result = TantivyMultiResult::TopN(top_n_data.clone());

        let extracted = result.top_n();
        assert_eq!(extracted, top_n_data);

        // Test non-top-n returns empty vec
        let result = TantivyMultiResult::RowNums(100);
        let extracted = result.top_n();
        assert!(extracted.is_empty());
    }

    #[test]
    fn test_tantivy_multi_result_distinct() {
        let mut distinct_data = HashSet::new();
        distinct_data.insert("value1".to_string());
        distinct_data.insert("value2".to_string());
        let result = TantivyMultiResult::Distinct(distinct_data.clone());

        let extracted = result.distinct();
        assert_eq!(extracted, distinct_data);

        // Test non-distinct returns empty set
        let result = TantivyMultiResult::RowNums(100);
        let extracted = result.distinct();
        assert!(extracted.is_empty());
    }

    #[test]
    fn test_tantivy_multi_result_display() {
        // Test RowNums display
        let result = TantivyMultiResult::RowNums(12345);
        assert_eq!(format!("{result}"), "row_nums: 12345");

        // Test Histogram display
        let result = TantivyMultiResult::Histogram(vec![10, 20, 30]);
        assert_eq!(format!("{result}"), "histogram hits: 60");

        // Test TopN display
        let result =
            TantivyMultiResult::TopN(vec![(vec!["a".to_string()], 1), (vec!["b".to_string()], 2)]);
        assert_eq!(format!("{result}"), "top_n hits: 2");

        // Test Distinct display
        let mut distinct = HashSet::new();
        distinct.insert("val1".to_string());
        distinct.insert("val2".to_string());
        distinct.insert("val3".to_string());
        let result = TantivyMultiResult::Distinct(distinct);
        assert_eq!(format!("{result}"), "distinct hits: 3");
    }

    #[test]
    fn test_histogram_builder_edge_cases() {
        // Test with histograms of different lengths
        let mut builder = TantivyMultiResultBuilder::Histogram(vec![]);
        builder.add_histogram(vec![10, 20]);
        builder.add_histogram(vec![5, 15, 25]); // Different length

        let result = builder.build();
        match result {
            TantivyMultiResult::Histogram(hist) => {
                // Should use the length of the first histogram (2)
                assert_eq!(hist.len(), 2);
                assert_eq!(hist[0], 15); // 10 + 5
                assert_eq!(hist[1], 35); // 20 + 15 (25 is ignored due to index bounds)
            }
            _ => panic!("Expected Histogram result"),
        }
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
