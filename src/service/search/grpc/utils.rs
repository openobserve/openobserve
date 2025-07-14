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
    sync::Arc,
};

use arrow_schema::{DataType, Field, Schema};
use config::{TIMESTAMP_COL_NAME, get_config, meta::bitvec::BitVec};
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

#[derive(Debug, Clone)]
pub enum TantivyResult {
    RowIds(HashSet<u32>),
    RowIdsBitVec(usize, BitVec),
    Count(usize),             // simple count optimization
    Histogram(Vec<u64>),      // simple histogram optimization
    TopN(Vec<(String, u64)>), // simple top n optimization
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
        let aggregation = Aggregation {
            agg: AggregationVariants::Terms(TermsAggregation {
                field: field.to_string(),
                size: Some(limit as u32),
                order: None,
                missing: None,
                min_doc_count: Some(0),
                show_term_doc_count_error: Some(false),
                segment_size: Some(1000),
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
