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
    SegmentOrdinal, SegmentReader,
    aggregation::{
        AggregationCollector, Key,
        agg_req::{Aggregation, AggregationVariants, Aggregations},
        agg_result::{AggregationResult, BucketEntries, BucketResult},
        bucket::{HistogramAggregation, HistogramBounds, TermsAggregation},
    },
    collector::{Collector, SegmentCollector},
};

/// Counts matching docs into fixed-width timestamp buckets, for
/// `SELECT histogram(_timestamp) AS ts, count(*) GROUP BY ts`.
///
/// Delegates to `tantivy::collector::HistogramCollector`. `ts_offset`
/// (microseconds east of UTC, from `histogram()` with a timezone) shifts each
/// timestamp into local wall-clock space before bucketing; since the buckets
/// are fixed-width, shifting the range down by the offset instead
/// (`min_value - ts_offset`) yields the same bucket counts without touching
/// the per-doc values.
pub struct SimpleHistogramCollector {
    inner: tantivy::collector::HistogramCollector,
}

impl SimpleHistogramCollector {
    pub fn new(
        field: String,
        min_value: i64,
        bucket_width: u64,
        num_buckets: usize,
        ts_offset: i64,
    ) -> Self {
        Self {
            inner: tantivy::collector::HistogramCollector::new::<i64>(
                field,
                min_value - ts_offset,
                bucket_width.max(1),
                num_buckets,
            ),
        }
    }
}

impl Collector for SimpleHistogramCollector {
    /// Bucket counts, always `num_buckets` long (zeros included).
    type Fruit = Vec<u64>;
    type Child = <tantivy::collector::HistogramCollector as Collector>::Child;

    fn for_segment(
        &self,
        segment_local_id: SegmentOrdinal,
        segment: &SegmentReader,
    ) -> tantivy::Result<Self::Child> {
        self.inner.for_segment(segment_local_id, segment)
    }

    fn requires_scoring(&self) -> bool {
        false
    }

    fn merge_fruits(&self, segment_fruits: Vec<Vec<u64>>) -> tantivy::Result<Self::Fruit> {
        self.inner.merge_fruits(segment_fruits)
    }
}

/// Counts matching docs into (fixed-width timestamp bucket × breakdown term)
/// groups, for `SELECT histogram(_timestamp) AS ts, level, count(*) GROUP BY
/// ts, level`.
///
/// Delegates to tantivy's `HistogramAggregation` with a nested
/// `TermsAggregation` (keeping the top `ZO_QUERY_DEFAULT_LIMIT` terms per
/// bucket). The aggregation runs in raw timestamp space — bounds are shifted
/// down by `ts_offset` and the resulting bucket keys shifted back up — so the
/// returned keys are in local wall-clock space, like the values `histogram()`
/// with a timezone produces.
pub struct MultiHistogramCollector {
    inner: AggregationCollector,
    ts_offset: i64,
}

impl MultiHistogramCollector {
    pub fn new(
        ts_field: String,
        breakdown_field: String,
        min_value: i64,
        max_value: i64,
        bucket_width: u64,
        ts_offset: i64,
    ) -> Self {
        let limit = crate::get_config().limit.query_default_limit.max(1);
        let bucket_width = bucket_width.max(1) as i64;
        let raw_min = min_value - ts_offset;
        let raw_max = max_value - ts_offset;
        let histogram_agg = Aggregation {
            agg: AggregationVariants::Histogram(HistogramAggregation {
                field: ts_field,
                interval: bucket_width as f64,
                // min_value is bucket-aligned in local wall-clock space, so the
                // raw-space buckets must start at raw_min: align them to its
                // remainder instead of multiples of the interval
                offset: Some(raw_min.rem_euclid(bucket_width) as f64),
                min_doc_count: Some(1),
                // HistogramBounds.contains is inclusive on both ends, but the
                // histogram range is [min, max); timestamps are integral µs,
                // so an inclusive max - 1 is an exclusive max
                hard_bounds: Some(HistogramBounds {
                    min: raw_min as f64,
                    max: (raw_max - 1) as f64,
                }),
                extended_bounds: None,
                keyed: false,
                is_normalized_to_ns: false,
            }),
            sub_aggregation: Aggregations::from_iter(vec![(
                "breakdown".to_string(),
                Aggregation {
                    agg: AggregationVariants::Terms(TermsAggregation {
                        field: breakdown_field,
                        size: Some(limit as u32),
                        order: None,
                        missing: None,
                        min_doc_count: Some(1),
                        show_term_doc_count_error: Some(false),
                        segment_size: None,
                        include: None,
                        exclude: None,
                    }),
                    sub_aggregation: Default::default(),
                },
            )]),
        };
        let aggregations = Aggregations::from_iter(vec![("histogram".to_string(), histogram_agg)]);
        Self {
            inner: AggregationCollector::from_aggs(aggregations, Default::default()),
            ts_offset,
        }
    }
}

impl Collector for MultiHistogramCollector {
    /// `(bucket key in local wall-clock µs, breakdown value, count)` rows
    type Fruit = Vec<(i64, String, u64)>;
    type Child = <AggregationCollector as Collector>::Child;

    fn for_segment(
        &self,
        segment_local_id: SegmentOrdinal,
        segment: &SegmentReader,
    ) -> tantivy::Result<Self::Child> {
        self.inner.for_segment(segment_local_id, segment)
    }

    fn requires_scoring(&self) -> bool {
        false
    }

    fn merge_fruits(
        &self,
        segment_fruits: Vec<<Self::Child as SegmentCollector>::Fruit>,
    ) -> tantivy::Result<Self::Fruit> {
        let mut res = self.inner.merge_fruits(segment_fruits)?;
        let mut results = Vec::new();
        let Some(AggregationResult::BucketResult(BucketResult::Histogram { buckets })) =
            res.0.remove("histogram")
        else {
            return Ok(results);
        };
        let hist_buckets = match buckets {
            BucketEntries::Vec(vec) => vec,
            BucketEntries::HashMap(map) => map.into_values().collect(),
        };
        for mut bucket_entry in hist_buckets {
            let timestamp = match bucket_entry.key {
                Key::F64(k) => k as i64 + self.ts_offset,
                _ => continue,
            };
            let Some(AggregationResult::BucketResult(BucketResult::Terms {
                buckets: term_entries,
                ..
            })) = bucket_entry.sub_aggregation.0.remove("breakdown")
            else {
                continue;
            };
            for term_bucket in term_entries {
                let breakdown_value = match term_bucket.key {
                    Key::Str(s) => s,
                    Key::F64(f) => f.to_string(),
                    Key::I64(i) => i.to_string(),
                    Key::U64(u) => u.to_string(),
                };
                results.push((timestamp, breakdown_value, term_bucket.doc_count));
            }
        }
        Ok(results)
    }
}

// OSS stub for the enterprise histogram RANK fast path: always falls back to
// SimpleHistogramCollector. Signature must match the enterprise version.
#[allow(clippy::too_many_arguments)]
pub fn simple_histogram_rank(
    _searcher: &tantivy::Searcher,
    _ts_field: &str,
    _term_field: Option<(&str, &str)>,
    _min_value: i64,
    _bucket_width: u64,
    _num_buckets: usize,
    _ts_offset: i64,
    _file_min_ts: i64,
    _file_max_ts: i64,
) -> tantivy::Result<Option<Vec<u64>>> {
    Ok(None)
}

#[cfg(test)]
mod tests {
    use tantivy::{
        Index, doc,
        query::AllQuery,
        schema::{FAST, IndexRecordOption, SchemaBuilder, TextFieldIndexing, TextOptions},
    };

    use super::*;

    /// Builds a single-segment index with the given `(timestamp, level)` rows
    /// in row order.
    fn build_index_from(rows: &[(i64, Option<&str>)]) -> tantivy::Searcher {
        let mut schema_builder = SchemaBuilder::new();
        let ts = schema_builder.add_i64_field("_timestamp", FAST);
        let level = schema_builder.add_text_field(
            "level",
            TextOptions::default()
                .set_indexing_options(
                    TextFieldIndexing::default()
                        .set_index_option(IndexRecordOption::Basic)
                        .set_tokenizer("raw"),
                )
                .set_fast(None),
        );
        let index = Index::create_in_ram(schema_builder.build());

        let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
        for (timestamp, lvl) in rows {
            let mut doc = doc!(ts => *timestamp);
            if let Some(lvl) = lvl {
                doc.add_text(level, lvl);
            }
            writer.add_document(doc).unwrap();
        }
        writer.commit().unwrap();

        index.reader().unwrap().searcher()
    }

    /// One segment: timestamps 0..50 with breakdown levels, one doc missing
    /// the level, one doc below and one above the [0, 50) bucket range.
    fn build_index() -> tantivy::Searcher {
        build_index_from(&[
            // outside [min, max): dropped by both collectors (as is -10 below)
            (50, Some("a")),
            (49, Some("c")),
            (25, Some("a")),
            (25, Some("b")),
            (15, Some("a")),
            // missing level: counted by the simple histogram, no group in the multi
            (7, None),
            (6, Some("b")),
            (5, Some("b")),
            (0, Some("a")),
            (-10, Some("a")),
        ])
    }

    #[test]
    fn test_simple_histogram_collector() {
        let searcher = build_index();
        let collector = SimpleHistogramCollector::new("_timestamp".to_string(), 0, 10, 5, 0);
        let res = searcher.search(&AllQuery, &collector).unwrap();
        assert_eq!(res, vec![4, 1, 2, 0, 1]);
    }

    #[test]
    fn test_simple_histogram_collector_with_ts_offset() {
        let searcher = build_index();
        // shift +10: -10 lands in bucket 0, 49/50 shift out of range
        let collector = SimpleHistogramCollector::new("_timestamp".to_string(), 0, 10, 5, 10);
        let res = searcher.search(&AllQuery, &collector).unwrap();
        assert_eq!(res, vec![1, 4, 1, 2, 0]);
    }

    #[test]
    fn test_multi_histogram_collector() {
        let searcher = build_index();
        let row = |ts: i64, s: &str, count: u64| (ts, s.to_string(), count);

        let collector = MultiHistogramCollector::new(
            "_timestamp".to_string(),
            "level".to_string(),
            0,
            50,
            10,
            0,
        );
        let mut res = searcher.search(&AllQuery, &collector).unwrap();
        res.sort_unstable();
        assert_eq!(
            res,
            vec![
                row(0, "a", 1),
                row(0, "b", 2),
                row(10, "a", 1),
                row(20, "a", 1),
                row(20, "b", 1),
                row(40, "c", 1),
            ],
        );
    }

    #[test]
    fn test_multi_histogram_collector_with_ts_offset() {
        let searcher = build_index();
        // shift +10 with range [0, 50): -10 → bucket 0, 49 → out of range
        let collector = MultiHistogramCollector::new(
            "_timestamp".to_string(),
            "level".to_string(),
            0,
            50,
            10,
            10,
        );
        let mut res = searcher.search(&AllQuery, &collector).unwrap();
        res.sort_unstable();
        assert_eq!(
            res,
            vec![
                (0, "a".to_string(), 1),
                (10, "a".to_string(), 1),
                (10, "b".to_string(), 2),
                (20, "a".to_string(), 1),
                (30, "a".to_string(), 1),
                (30, "b".to_string(), 1),
            ]
        );
    }

    #[test]
    fn test_multi_histogram_collector_empty_range() {
        let searcher = build_index();
        let collector = MultiHistogramCollector::new(
            "_timestamp".to_string(),
            "level".to_string(),
            50,
            50,
            10,
            0,
        );
        let res = searcher.search(&AllQuery, &collector).unwrap();
        assert!(res.is_empty());
    }
}
