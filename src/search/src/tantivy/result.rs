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

use config::meta::{inverted_index::IndexOptimizeMode, stream::FileKey};
use hashbrown::HashMap;

use super::pruner::SimpleSelectPruner;

// TantivyMultiResultBuilder is used to build a TantivyMultiResult from multiple TantivyResult
pub enum TantivyMultiResultBuilder {
    RowNums(u64),
    Count(u64),
    SimpleSelect {
        num_rows: u64,
        pruner: SimpleSelectPruner,
    },
    Histogram(Vec<Vec<u64>>),
    MultiHistogram(Vec<Vec<(i64, String, u64)>>),
    TopN(Vec<(Vec<String>, u64)>),
    Distinct(HashSet<String>),
}

impl TantivyMultiResultBuilder {
    pub fn new(optimize_rule: &Option<IndexOptimizeMode>, file_groups: &[Vec<FileKey>]) -> Self {
        match optimize_rule {
            Some(IndexOptimizeMode::SimpleHistogram(..)) => Self::Histogram(vec![]),
            Some(IndexOptimizeMode::SimpleMultiHistogram(..)) => Self::MultiHistogram(vec![]),
            Some(IndexOptimizeMode::SimpleTopN(..)) => Self::TopN(vec![]),
            Some(IndexOptimizeMode::SimpleDistinct(..)) => Self::Distinct(HashSet::new()),
            Some(IndexOptimizeMode::SimpleSelect(limit, ascend)) => Self::SimpleSelect {
                num_rows: 0,
                pruner: SimpleSelectPruner::new(*limit, *ascend, file_groups),
            },
            Some(IndexOptimizeMode::SimpleCount) => Self::Count(0),
            None => Self::RowNums(0),
        }
    }

    pub fn add_row_nums(&mut self, row_nums: u64) {
        match self {
            Self::RowNums(a) => *a += row_nums,
            // SimpleSelect maybe falls back to row_id collection
            Self::SimpleSelect { num_rows, .. } => *num_rows += row_nums,
            _ => unreachable!("unsupported tantivy multi result"),
        }
    }

    // simple count
    pub fn add_count(&mut self, count: u64) {
        match self {
            Self::Count(a) => *a += count,
            _ => unreachable!("unsupported tantivy multi result"),
        }
    }

    // simple select
    pub fn add_select_candidates(
        &mut self,
        file_name: String,
        candidates: Arc<Vec<(i64, u32)>>,
        row_group_size: Option<u32>,
    ) {
        match self {
            Self::SimpleSelect { num_rows, pruner } => {
                *num_rows += candidates.len() as u64;
                pruner.record_candidates(file_name, candidates, row_group_size);
            }
            _ => unreachable!("unsupported tantivy multi result"),
        }
    }

    // simple histogram
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

    // simple multi histogram
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

    // simple top-n
    pub fn add_top_n(&mut self, top_n: Vec<(Vec<String>, u64)>) {
        match self {
            Self::TopN(a) => a.extend(top_n),
            _ => unreachable!("unsupported tantivy multi result"),
        }
    }

    // simple distinct
    pub fn add_distinct(&mut self, distinct: HashSet<String>) {
        match self {
            Self::Distinct(a) => a.extend(distinct),
            _ => unreachable!("unsupported tantivy multi result"),
        }
    }

    pub fn should_prune_remaining_groups(&self, trace_id: &str, group_id: usize) -> bool {
        match self {
            Self::SimpleSelect { pruner, .. } => {
                pruner.should_prune_remaining_groups(trace_id, group_id)
            }
            _ => false,
        }
    }

    /// Build the merged result; for SimpleSelect this also finalizes the file
    /// selections to the global top-N.
    pub fn build(
        self,
        trace_id: &str,
        file_list_map: &mut HashMap<String, FileKey>,
    ) -> TantivyMultiResult {
        match self {
            Self::RowNums(a) => TantivyMultiResult::RowNums(a),
            Self::Count(a) => TantivyMultiResult::Count(a),
            Self::SimpleSelect {
                num_rows,
                mut pruner,
            } => {
                pruner.finalize(trace_id, file_list_map);
                TantivyMultiResult::SimpleSelect(num_rows)
            }
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
    Count(u64),
    SimpleSelect(u64),
    Histogram(Vec<u64>),
    MultiHistogram(Vec<(i64, String, u64)>),
    TopN(Vec<(Vec<String>, u64)>),
    Distinct(HashSet<String>),
}

impl Display for TantivyMultiResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RowNums(num) => write!(f, "row_nums: {num}"),
            Self::Count(num) => write!(f, "count: {num}"),
            Self::SimpleSelect(num) => write!(f, "select row_nums: {num}"),
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
            Self::Count(a) => *a as usize,
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
    fn test_tantivy_multi_result_builder_new() {
        // Test with SimpleHistogram
        let optimize_rule = Some(IndexOptimizeMode::SimpleHistogram(0, 1000, 10, 0));
        let builder = TantivyMultiResultBuilder::new(&optimize_rule, &[]);
        assert!(matches!(builder, TantivyMultiResultBuilder::Histogram(_)));

        // Test with SimpleTopN
        let optimize_rule = Some(IndexOptimizeMode::SimpleTopN(
            vec!["field".to_string()],
            10,
            true,
        ));
        let builder = TantivyMultiResultBuilder::new(&optimize_rule, &[]);
        assert!(matches!(builder, TantivyMultiResultBuilder::TopN(_)));

        // Test with SimpleDistinct
        let optimize_rule = Some(IndexOptimizeMode::SimpleDistinct(
            "field".to_string(),
            10,
            true,
        ));
        let builder = TantivyMultiResultBuilder::new(&optimize_rule, &[]);
        assert!(matches!(builder, TantivyMultiResultBuilder::Distinct(_)));

        // Test with SimpleSelect
        let optimize_rule = Some(IndexOptimizeMode::SimpleSelect(10, true));
        let builder = TantivyMultiResultBuilder::new(&optimize_rule, &[]);
        assert!(matches!(
            builder,
            TantivyMultiResultBuilder::SimpleSelect { num_rows: 0, .. }
        ));

        // Test with SimpleCount
        let optimize_rule = Some(IndexOptimizeMode::SimpleCount);
        let builder = TantivyMultiResultBuilder::new(&optimize_rule, &[]);
        assert!(matches!(builder, TantivyMultiResultBuilder::Count(_)));

        // Test with None
        let builder = TantivyMultiResultBuilder::new(&None, &[]);
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
    fn test_tantivy_multi_result_builder_add_row_nums_simple_select() {
        // the skipped-conditions fallback reports row nums for SimpleSelect
        let mut builder = TantivyMultiResultBuilder::SimpleSelect {
            num_rows: 10,
            pruner: SimpleSelectPruner::new(10, true, &[]),
        };
        builder.add_row_nums(5);

        match builder {
            TantivyMultiResultBuilder::SimpleSelect { num_rows, .. } => assert_eq!(num_rows, 15),
            _ => panic!("Expected SimpleSelect variant"),
        }
    }

    #[test]
    fn test_tantivy_multi_result_builder_add_count() {
        let mut builder = TantivyMultiResultBuilder::Count(10);
        builder.add_count(5);

        match builder {
            TantivyMultiResultBuilder::Count(count) => assert_eq!(count, 15),
            _ => panic!("Expected Count variant"),
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
    fn test_tantivy_multi_result_builder_build() {
        // Test RowNums build
        let builder = TantivyMultiResultBuilder::RowNums(100);
        let result = builder.build("test", &mut HashMap::new());
        match result {
            TantivyMultiResult::RowNums(count) => assert_eq!(count, 100),
            _ => panic!("Expected RowNums result"),
        }

        // Test Count build
        let builder = TantivyMultiResultBuilder::Count(100);
        let result = builder.build("test", &mut HashMap::new());
        match result {
            TantivyMultiResult::Count(count) => assert_eq!(count, 100),
            _ => panic!("Expected Count result"),
        }

        // Test SimpleSelect build
        let builder = TantivyMultiResultBuilder::SimpleSelect {
            num_rows: 100,
            pruner: SimpleSelectPruner::new(10, true, &[]),
        };
        let result = builder.build("test", &mut HashMap::new());
        match result {
            TantivyMultiResult::SimpleSelect(count) => assert_eq!(count, 100),
            _ => panic!("Expected SimpleSelect result"),
        }

        // Test empty Histogram build
        let builder = TantivyMultiResultBuilder::Histogram(vec![]);
        let result = builder.build("test", &mut HashMap::new());
        match result {
            TantivyMultiResult::Histogram(hist) => assert!(hist.is_empty()),
            _ => panic!("Expected Histogram result"),
        }

        // Test Histogram build with data
        let mut builder = TantivyMultiResultBuilder::Histogram(vec![]);
        builder.add_histogram(vec![10, 20, 30]);
        builder.add_histogram(vec![5, 15, 25]);
        let result = builder.build("test", &mut HashMap::new());
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
        let result = builder.build("test", &mut HashMap::new());
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
        let result = builder.build("test", &mut HashMap::new());
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
        // only SimpleCount reads the row count back out of the result
        let result = TantivyMultiResult::Count(123);
        assert_eq!(result.num_rows(), 123);

        let result = TantivyMultiResult::RowNums(123);
        assert_eq!(result.num_rows(), 0);

        let result = TantivyMultiResult::SimpleSelect(123);
        assert_eq!(result.num_rows(), 0);

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

        // Test Count display
        let result = TantivyMultiResult::Count(12345);
        assert_eq!(format!("{result}"), "count: 12345");

        // Test SimpleSelect display
        let result = TantivyMultiResult::SimpleSelect(12345);
        assert_eq!(format!("{result}"), "select row_nums: 12345");

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

        let result = builder.build("test", &mut HashMap::new());
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
}
