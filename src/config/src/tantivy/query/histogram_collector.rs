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

use fastdivide::DividerU64;
use hashbrown::HashMap;
use tantivy::{
    DocId, Score, SegmentOrdinal, SegmentReader,
    collector::{Collector, SegmentCollector},
    columnar::{Cardinality, Column, StrColumn},
};

use super::topn_collector::{DENSE_GROUP_SPACE_LIMIT, resolve_ords, truncate_top_k};

/// Fixed-width bucket math shared by the histogram collectors: shifts a raw
/// timestamp into local wall-clock space (`ts + ts_offset`), bounds-checks it,
/// and maps it to a bucket index with a precomputed divider instead of a
/// per-doc hardware division.
///
/// `ts_offset` (microseconds east of UTC) mirrors `histogram()` with a
/// timezone, which is rewritten to `date_bin` over `_timestamp + offset`;
/// `min_value` is the first bucket's key in that shifted space.
#[derive(Clone)]
struct BucketComputer {
    min_value: i64,
    ts_offset: i64,
    divider: DividerU64,
    num_buckets: usize,
}

impl BucketComputer {
    fn new(min_value: i64, bucket_width: u64, num_buckets: usize, ts_offset: i64) -> Self {
        Self {
            min_value,
            ts_offset,
            divider: DividerU64::divide_by(bucket_width.max(1)),
            num_buckets,
        }
    }

    #[inline]
    fn bucket(&self, ts: i64) -> Option<usize> {
        let v = ts + self.ts_offset;
        if v < self.min_value {
            return None;
        }
        let bucket = self.divider.divide((v - self.min_value) as u64) as usize;
        (bucket < self.num_buckets).then_some(bucket)
    }
}

/// Block-fetch the first value per doc into a reusable buffer. `first_vals`
/// only writes present slots, so stale values are reset to None first —
/// unless the column is Full cardinality and writes every slot anyway.
#[inline]
fn fetch_first_vals<T: PartialOrd + Copy + std::fmt::Debug + Send + Sync + 'static>(
    col: &Column<T>,
    docs: &[DocId],
    buf: &mut Vec<Option<T>>,
) {
    if col.get_cardinality() != Cardinality::Full {
        buf.clear();
    }
    buf.resize(docs.len(), None);
    col.first_vals(docs, buf);
}

/// Counts matching docs into fixed-width timestamp buckets, for
/// `SELECT histogram(_timestamp) AS ts, count(*) GROUP BY ts`.
///
/// Replaces `tantivy::collector::HistogramCollector`, which fetches the fast
/// field per doc through an `Arc<dyn ColumnValues>` and implements no
/// `collect_block`; this version fetches timestamps block-wise.
pub struct SimpleHistogramCollector {
    field: String,
    min_value: i64,
    bucket_width: u64,
    num_buckets: usize,
    ts_offset: i64,
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
            field,
            min_value,
            bucket_width,
            num_buckets,
            ts_offset,
        }
    }
}

pub struct SimpleHistogramSegmentCollector {
    /// None when the column is missing from this segment (legacy index file)
    col: Option<Column<i64>>,
    computer: BucketComputer,
    counts: Vec<u32>,
    ts_buf: Vec<Option<i64>>,
}

impl Collector for SimpleHistogramCollector {
    /// Bucket counts, always `num_buckets` long (zeros included).
    type Fruit = Vec<u64>;
    type Child = SimpleHistogramSegmentCollector;

    fn for_segment(
        &self,
        _segment_local_id: SegmentOrdinal,
        segment: &SegmentReader,
    ) -> tantivy::Result<Self::Child> {
        let col = segment.fast_fields().column_opt::<i64>(&self.field)?;
        Ok(SimpleHistogramSegmentCollector {
            col,
            computer: BucketComputer::new(
                self.min_value,
                self.bucket_width,
                self.num_buckets,
                self.ts_offset,
            ),
            counts: vec![0; self.num_buckets],
            ts_buf: Vec::new(),
        })
    }

    fn requires_scoring(&self) -> bool {
        false
    }

    fn merge_fruits(&self, mut segment_fruits: Vec<Vec<u64>>) -> tantivy::Result<Self::Fruit> {
        debug_assert!(
            segment_fruits.len() <= 1,
            "SimpleHistogramCollector used on multi-segment index"
        );
        Ok(segment_fruits
            .pop()
            .unwrap_or_else(|| vec![0; self.num_buckets]))
    }
}

impl SegmentCollector for SimpleHistogramSegmentCollector {
    type Fruit = Vec<u64>;

    fn collect(&mut self, doc: DocId, _score: Score) {
        let Some(col) = &self.col else {
            return;
        };
        if let Some(ts) = col.first(doc)
            && let Some(bucket) = self.computer.bucket(ts)
        {
            self.counts[bucket] += 1;
        }
    }

    /// Block variant of [`Self::collect`]: fetch the whole block's timestamps
    /// at once instead of paying a per-document column lookup.
    fn collect_block(&mut self, docs: &[DocId]) {
        let Some(col) = &self.col else {
            return;
        };
        fetch_first_vals(col, docs, &mut self.ts_buf);
        for ts in self.ts_buf.iter().flatten() {
            if let Some(bucket) = self.computer.bucket(*ts) {
                self.counts[bucket] += 1;
            }
        }
    }

    fn harvest(self) -> Self::Fruit {
        // counts are u32 (bounded by the segment's doc count) to halve the
        // cache footprint of the hot loop; widen for the public result
        self.counts.into_iter().map(u64::from).collect()
    }
}

/// Counts matching docs into (fixed-width timestamp bucket × breakdown term)
/// groups, for `SELECT histogram(_timestamp) AS ts, level, count(*) GROUP BY
/// ts, level`.
///
/// Replaces tantivy's `HistogramAggregation` + nested `TermsAggregation`,
/// which re-dispatches every doc through a buffered sub-aggregation cache and
/// materializes a String per (bucket, term) pair at harvest. This version
/// counts (bucket, term-ordinal) groups in one pass — a flat array when the
/// group space is small, a hash map otherwise — and resolves ordinals to
/// strings once per distinct surviving term.
pub struct MultiHistogramCollector {
    ts_field: String,
    breakdown_field: String,
    /// first bucket's key in local wall-clock space, aligned to bucket_width
    min_value: i64,
    bucket_width: u64,
    num_buckets: usize,
    ts_offset: i64,
    /// top terms kept per bucket (the old TermsAggregation `size`,
    /// ZO_QUERY_DEFAULT_LIMIT); a bucket with at most this many distinct
    /// terms contributes exactly
    per_bucket_limit: usize,
    /// group space size up to which the dense counting array is used
    dense_limit: usize,
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
        let num_buckets = if max_value > min_value {
            ((max_value - min_value) as u64).div_ceil(bucket_width.max(1)) as usize
        } else {
            0
        };
        let per_bucket_limit = crate::get_config().limit.query_default_limit.max(1) as usize;
        Self {
            ts_field,
            breakdown_field,
            min_value,
            bucket_width,
            // sparse keys pack the bucket index into 32 bits; a query needs a
            // sub-second interval over more than an hour to even get near this
            num_buckets: num_buckets.min(u32::MAX as usize),
            ts_offset,
            per_bucket_limit,
            dense_limit: DENSE_GROUP_SPACE_LIMIT,
        }
    }

    #[cfg(test)]
    fn with_per_bucket_limit(mut self, limit: usize) -> Self {
        self.per_bucket_limit = limit;
        self
    }

    #[cfg(test)]
    fn with_dense_limit(mut self, dense_limit: usize) -> Self {
        self.dense_limit = dense_limit;
        self
    }
}

/// Per-segment (bucket, term) counters: a flat array when `num_buckets *
/// num_terms` is small, otherwise a hash map.
enum GroupCounts {
    /// counts indexed by `bucket * num_terms + ord` — bucket-major because
    /// docs within a file are roughly time-ordered, so consecutive docs stay
    /// within one bucket's row
    Dense { counts: Vec<u32>, num_terms: usize },
    /// keyed by `(bucket << 32) | ord`, so sorting the keys yields
    /// bucket-major order with ordinals ascending within each bucket
    Sparse(HashMap<u64, u32>),
}

impl GroupCounts {
    #[inline]
    fn add(&mut self, bucket: usize, ord: u64) {
        match self {
            Self::Dense { counts, num_terms } => counts[bucket * *num_terms + ord as usize] += 1,
            Self::Sparse(counts) => *counts.entry(((bucket as u64) << 32) | ord).or_insert(0) += 1,
        }
    }
}

pub struct MultiHistogramSegmentCollector {
    /// None when either column is missing from this segment (legacy index file)
    cols: Option<(Column<i64>, StrColumn)>,
    computer: BucketComputer,
    counts: GroupCounts,
    per_bucket_limit: usize,
    bucket_width: u64,
    ts_buf: Vec<Option<i64>>,
    ord_buf: Vec<Option<u64>>,
}

impl Collector for MultiHistogramCollector {
    /// `(bucket key in local wall-clock µs, breakdown value, count)` rows
    type Fruit = Vec<(i64, String, u64)>;
    type Child = MultiHistogramSegmentCollector;

    fn for_segment(
        &self,
        _segment_local_id: SegmentOrdinal,
        segment: &SegmentReader,
    ) -> tantivy::Result<Self::Child> {
        let fast_fields = segment.fast_fields();
        let ts_col = fast_fields.column_opt::<i64>(&self.ts_field)?;
        let str_col = fast_fields.str(&self.breakdown_field)?;
        let cols = ts_col.zip(str_col);
        let counts = match &cols {
            Some((_, str_col)) => {
                let num_terms = str_col.num_terms();
                match num_terms.checked_mul(self.num_buckets) {
                    Some(space) if num_terms > 0 && space <= self.dense_limit => {
                        GroupCounts::Dense {
                            counts: vec![0; space],
                            num_terms,
                        }
                    }
                    _ => GroupCounts::Sparse(HashMap::new()),
                }
            }
            None => GroupCounts::Sparse(HashMap::new()),
        };
        Ok(MultiHistogramSegmentCollector {
            cols,
            computer: BucketComputer::new(
                self.min_value,
                self.bucket_width,
                self.num_buckets,
                self.ts_offset,
            ),
            counts,
            per_bucket_limit: self.per_bucket_limit,
            bucket_width: self.bucket_width,
            ts_buf: Vec::new(),
            ord_buf: Vec::new(),
        })
    }

    fn requires_scoring(&self) -> bool {
        false
    }

    fn merge_fruits(
        &self,
        mut segment_fruits: Vec<Vec<(i64, String, u64)>>,
    ) -> tantivy::Result<Self::Fruit> {
        debug_assert!(
            segment_fruits.len() <= 1,
            "MultiHistogramCollector used on multi-segment index"
        );
        Ok(segment_fruits.pop().unwrap_or_default())
    }
}

impl SegmentCollector for MultiHistogramSegmentCollector {
    type Fruit = Vec<(i64, String, u64)>;

    fn collect(&mut self, doc: DocId, _score: Score) {
        let Some((ts_col, str_col)) = &self.cols else {
            return;
        };
        // a doc missing the breakdown value forms no group (terms agg `missing: None`)
        if let Some(ts) = ts_col.first(doc)
            && let Some(ord) = str_col.ords().first(doc)
            && let Some(bucket) = self.computer.bucket(ts)
        {
            self.counts.add(bucket, ord);
        }
    }

    /// Block variant of [`Self::collect`]: fetch both columns' values for the
    /// whole block at once instead of paying per-document column lookups.
    fn collect_block(&mut self, docs: &[DocId]) {
        let Self {
            cols,
            computer,
            counts,
            ts_buf,
            ord_buf,
            ..
        } = self;
        let Some((ts_col, str_col)) = cols else {
            return;
        };
        fetch_first_vals(ts_col, docs, ts_buf);
        fetch_first_vals(str_col.ords(), docs, ord_buf);
        for (ts, ord) in ts_buf.iter().zip(ord_buf.iter()) {
            let (Some(ts), Some(ord)) = (ts, ord) else {
                continue;
            };
            if let Some(bucket) = computer.bucket(*ts) {
                counts.add(bucket, *ord);
            }
        }
    }

    fn harvest(self) -> Self::Fruit {
        let Self {
            cols,
            computer,
            counts,
            per_bucket_limit,
            bucket_width,
            ..
        } = self;
        let Some((_, str_col)) = cols else {
            return Vec::new();
        };

        // Per bucket, keep all terms when within per_bucket_limit (the bucket's
        // contribution is exact) or only the top-k by count otherwise, on cheap
        // integer ordinals BEFORE touching the term dictionary. Count ties break
        // toward smaller ordinals, clustering survivors for cheaper resolution.
        let mut groups: Vec<(u32, u64, u32)> = Vec::new();
        let mut entries: Vec<(u64, u32)> = Vec::new();
        let mut truncated_buckets = 0usize;
        let mut keep_bucket =
            |bucket: u32, entries: &mut Vec<(u64, u32)>, groups: &mut Vec<(u32, u64, u32)>| {
                if entries.len() > per_bucket_limit {
                    truncated_buckets += 1;
                    truncate_top_k(entries, per_bucket_limit, false);
                }
                groups.extend(entries.iter().map(|(ord, count)| (bucket, *ord, *count)));
            };
        match counts {
            GroupCounts::Dense { counts, num_terms } => {
                for (bucket, row) in counts.chunks_exact(num_terms).enumerate() {
                    entries.clear();
                    entries.extend(
                        row.iter()
                            .enumerate()
                            .filter(|(_, count)| **count > 0)
                            .map(|(ord, count)| (ord as u64, *count)),
                    );
                    keep_bucket(bucket as u32, &mut entries, &mut groups);
                }
            }
            GroupCounts::Sparse(counts) => {
                let mut all = counts.into_iter().collect::<Vec<_>>();
                all.sort_unstable_by_key(|(key, _)| *key);
                for run in all.chunk_by(|a, b| a.0 >> 32 == b.0 >> 32) {
                    let bucket = (run[0].0 >> 32) as u32;
                    entries.clear();
                    entries.extend(run.iter().map(|(key, count)| (key & 0xFFFF_FFFF, *count)));
                    keep_bucket(bucket, &mut entries, &mut groups);
                }
            }
        }
        if truncated_buckets > 0 {
            log::debug!(
                "tantivy multi_histogram collector: {truncated_buckets} buckets exceeded \
                 {per_bucket_limit} distinct terms, keeping the per-bucket top-k, the merged \
                 counts are approximate",
            );
        }

        // resolve the distinct surviving ordinals in one sorted dictionary pass
        let ord_map = resolve_ords(&str_col, groups.iter().map(|(_, ord, _)| *ord).collect());
        let mut out = Vec::with_capacity(groups.len());
        for (bucket, ord, count) in groups {
            if let Some(s) = ord_map.get(&ord) {
                let key = computer.min_value + bucket as i64 * bucket_width as i64;
                out.push((key, s.clone(), count as u64));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use tantivy::{
        Index, doc,
        query::AllQuery,
        schema::{FAST, SchemaBuilder, TextOptions},
    };

    use super::*;

    /// One segment: timestamps 0..50 with breakdown levels, one doc missing
    /// the level, one doc below and one above the [0, 50) bucket range.
    fn build_index() -> tantivy::Searcher {
        let mut schema_builder = SchemaBuilder::new();
        let ts = schema_builder.add_i64_field("_timestamp", FAST);
        let level = schema_builder.add_text_field("level", TextOptions::default().set_fast(None));
        let index = Index::create_in_ram(schema_builder.build());

        let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
        writer.add_document(doc!(ts => 0i64, level => "a")).unwrap();
        writer.add_document(doc!(ts => 5i64, level => "b")).unwrap();
        writer.add_document(doc!(ts => 6i64, level => "b")).unwrap();
        // missing level: counted by the simple histogram, no group in the multi
        writer.add_document(doc!(ts => 7i64)).unwrap();
        writer
            .add_document(doc!(ts => 15i64, level => "a"))
            .unwrap();
        writer
            .add_document(doc!(ts => 25i64, level => "a"))
            .unwrap();
        writer
            .add_document(doc!(ts => 25i64, level => "b"))
            .unwrap();
        writer
            .add_document(doc!(ts => 49i64, level => "c"))
            .unwrap();
        // outside [min, max): dropped by both collectors
        writer
            .add_document(doc!(ts => 50i64, level => "a"))
            .unwrap();
        writer
            .add_document(doc!(ts => -10i64, level => "a"))
            .unwrap();
        writer.commit().unwrap();

        index.reader().unwrap().searcher()
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
    fn test_simple_histogram_collector_missing_column() {
        let searcher = build_index();
        let collector = SimpleHistogramCollector::new("no_such".to_string(), 0, 10, 5, 0);
        let res = searcher.search(&AllQuery, &collector).unwrap();
        assert_eq!(res, vec![0; 5]);
    }

    #[test]
    fn test_multi_histogram_collector() {
        let searcher = build_index();
        let row = |ts: i64, s: &str, count: u64| (ts, s.to_string(), count);

        // dense_limit usize::MAX forces the dense counting array, 0 forces the
        // hash map; both must produce identical results
        for dense_limit in [usize::MAX, 0] {
            let collector = MultiHistogramCollector::new(
                "_timestamp".to_string(),
                "level".to_string(),
                0,
                50,
                10,
                0,
            )
            .with_dense_limit(dense_limit);
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
                "dense_limit={dense_limit}"
            );
        }
    }

    #[test]
    fn test_multi_histogram_collector_per_bucket_limit() {
        let searcher = build_index();
        for dense_limit in [usize::MAX, 0] {
            let collector = MultiHistogramCollector::new(
                "_timestamp".to_string(),
                "level".to_string(),
                0,
                50,
                10,
                0,
            )
            .with_per_bucket_limit(1)
            .with_dense_limit(dense_limit);
            let mut res = searcher.search(&AllQuery, &collector).unwrap();
            res.sort_unstable();
            // bucket 0 keeps "b" (count 2 beats 1); ties keep the smaller ordinal
            assert_eq!(
                res,
                vec![
                    (0, "b".to_string(), 2),
                    (10, "a".to_string(), 1),
                    (20, "a".to_string(), 1),
                    (40, "c".to_string(), 1),
                ],
                "dense_limit={dense_limit}"
            );
        }
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
    fn test_multi_histogram_collector_missing_column() {
        let searcher = build_index();
        let collector = MultiHistogramCollector::new(
            "_timestamp".to_string(),
            "no_such".to_string(),
            0,
            50,
            10,
            0,
        );
        let res = searcher.search(&AllQuery, &collector).unwrap();
        assert!(res.is_empty());
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

    #[test]
    fn test_bucket_computer_bounds() {
        let computer = BucketComputer::new(100, 10, 3, 0);
        assert_eq!(computer.bucket(99), None);
        assert_eq!(computer.bucket(100), Some(0));
        assert_eq!(computer.bucket(115), Some(1));
        assert_eq!(computer.bucket(129), Some(2));
        assert_eq!(computer.bucket(130), None);

        // offset shifts the value before bucketing
        let computer = BucketComputer::new(100, 10, 3, 50);
        assert_eq!(computer.bucket(49), None);
        assert_eq!(computer.bucket(50), Some(0));
        assert_eq!(computer.bucket(79), Some(2));
        assert_eq!(computer.bucket(80), None);
    }
}
