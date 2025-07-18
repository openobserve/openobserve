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

use std::{
    collections::{HashMap, HashSet},
    fmt::Display,
    sync::Arc,
};

use arrow_schema::{DataType, Field, Schema};
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{bitvec::BitVec, inverted_index::IndexOptimizeMode},
    utils::tantivy::query::contains_query::ContainsAutomaton,
};
use tantivy::{
    Searcher,
    aggregation::{
        AggregationCollector, Key,
        agg_req::{Aggregation, AggregationVariants},
        agg_result::{AggregationResult, BucketResult},
        bucket::TermsAggregation,
    },
    query::Query,
};

use crate::service::search::index::IndexCondition;

#[derive(Debug, Clone)]
pub enum TantivyResult {
    RowIds(HashSet<u32>),
    RowIdsBitVec(usize, BitVec),
    Count(usize),              // simple count optimization
    Histogram(Vec<u64>),       // simple histogram optimization
    TopN(Vec<(String, u64)>),  // simple top n optimization
    Distinct(HashSet<String>), // simple distinct optimization
}

impl TantivyResult {
    pub fn handle_matched_docs(searcher: &Searcher, query: Box<dyn Query>) -> anyhow::Result<Self> {
        let res = searcher.search(&query, &tantivy::collector::DocSetCollector)?;

        let row_ids = res
            .into_iter()
            .map(|doc| doc.doc_id)
            .collect::<HashSet<_>>();
        Ok(Self::RowIds(row_ids))
    }

    pub fn handle_simple_select(
        searcher: &Searcher,
        query: Box<dyn Query>,
        limit: usize,
        ascend: bool,
    ) -> anyhow::Result<Self> {
        let res = searcher.search(
            &query,
            &tantivy::collector::TopDocs::with_limit(limit).tweak_score(
                move |_segment_reader: &tantivy::SegmentReader| {
                    move |doc_id: tantivy::DocId, _original_score: tantivy::Score| {
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
            .collect::<HashSet<_>>();
        Ok(Self::RowIds(row_ids))
    }

    pub fn handle_simple_count(searcher: &Searcher, query: Box<dyn Query>) -> anyhow::Result<Self> {
        let res = searcher.search(&query, &tantivy::collector::Count)?;
        Ok(Self::Count(res))
    }

    pub fn handle_simple_histogram(
        searcher: &Searcher,
        query: Box<dyn Query>,
        min_value: i64,
        bucket_width: u64,
        num_buckets: usize,
    ) -> anyhow::Result<Self> {
        let res = searcher.search(
            &query,
            &tantivy::collector::HistogramCollector::new::<i64>(
                TIMESTAMP_COL_NAME.to_string(),
                min_value,
                bucket_width,
                num_buckets,
            ),
        )?;

        Ok(Self::Histogram(res))
    }

    pub fn handle_simple_top_n(
        searcher: &Searcher,
        query: Box<dyn Query>,
        field: &str,
        limit: usize,
        _ascend: bool, // TODO: support ascend
    ) -> anyhow::Result<Self> {
        // collector
        let limit = (limit * 4).max(1000) as u32;
        let aggregation = Aggregation {
            agg: AggregationVariants::Terms(TermsAggregation {
                field: field.to_string(),
                size: Some(limit),
                order: None,
                missing: None,
                min_doc_count: Some(1),
                show_term_doc_count_error: Some(false),
                segment_size: Some(limit),
            }),
            sub_aggregation: HashMap::new(),
        };
        let aggregations = HashMap::from([("termagg".to_string(), aggregation)]);
        let collector = AggregationCollector::from_aggs(aggregations, Default::default());

        let mut res = searcher.search(&query, &collector)?;

        if let AggregationResult::BucketResult(BucketResult::Terms { buckets, .. }) =
            res.0.remove("termagg").unwrap()
        {
            let top_n = buckets
                .into_iter()
                .map(|bucket| {
                    let count = bucket.doc_count;
                    match bucket.key {
                        Key::Str(s) => (s, count),
                        Key::F64(f) => (f.to_string(), count),
                    }
                })
                .collect::<Vec<_>>();
            Ok(Self::TopN(top_n))
        } else {
            anyhow::bail!("Failed to get top n results from tantivy");
        }
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
    TopN(Vec<(String, u64)>),
    Distinct(HashSet<String>),
}

impl TantivyMultiResultBuilder {
    pub fn new(optimize_rule: &Option<IndexOptimizeMode>) -> Self {
        match optimize_rule {
            Some(IndexOptimizeMode::SimpleHistogram(..)) => Self::Histogram(vec![]),
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

    pub fn add_top_n(&mut self, top_n: Vec<(String, u64)>) {
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
            Self::TopN(a) => TantivyMultiResult::TopN(a),
            Self::Distinct(a) => TantivyMultiResult::Distinct(a),
        }
    }
}

pub enum TantivyMultiResult {
    RowNums(u64),
    Histogram(Vec<u64>),
    TopN(Vec<(String, u64)>),
    Distinct(HashSet<String>),
}

impl Display for TantivyMultiResult {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RowNums(num) => write!(f, "row_nums: {num}"),
            Self::Histogram(histogram) => {
                write!(f, "histogram hits: {}", histogram.iter().sum::<u64>())
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

    pub fn top_n(self) -> Vec<(String, u64)> {
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

pub fn change_schema_to_utf8_view(schema: Schema) -> Schema {
    if !get_config().common.utf8_view_enabled {
        return schema;
    }

    let fields = schema
        .fields()
        .iter()
        .map(|f| {
            if f.data_type() == &DataType::Utf8 {
                Arc::new(Field::new(f.name(), DataType::Utf8View, f.is_nullable()))
            } else {
                f.clone()
            }
        })
        .collect::<Vec<_>>();
    Schema::new(fields)
}
