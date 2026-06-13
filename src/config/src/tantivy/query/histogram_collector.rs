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
    bucket_width: u64,
    divider: DividerU64,
    num_buckets: usize,
}

impl BucketComputer {
    fn new(min_value: i64, bucket_width: u64, num_buckets: usize, ts_offset: i64) -> Self {
        let bucket_width = bucket_width.max(1);
        Self {
            min_value,
            ts_offset,
            bucket_width,
            divider: DividerU64::divide_by(bucket_width),
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

/// Physical ordering of a segment's timestamp column.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SortOrder {
    Ascending,
    Descending,
    Unsorted,
}

/// Sort direction of the segment's timestamp column.
///
/// Time-sorted index files are an OpenObserve design guarantee: every parquet
/// file is written `ORDER BY _timestamp DESC` and the tantivy index preserves
/// its row order, so only the direction is probed (two column reads). Debug
/// builds still verify the full invariant.
fn column_sort_order(col: &Column<i64>) -> SortOrder {
    // non-Full means some docs lack the value, so doc-id runs no longer map
    // 1:1 to value runs — fall back to the scan path
    if col.get_cardinality() != Cardinality::Full {
        return SortOrder::Unsorted;
    }
    let num_docs = col.num_docs();
    if num_docs <= 1 {
        return SortOrder::Descending;
    }
    let ascending = col.values.get_val(0) <= col.values.get_val(num_docs - 1);
    if ascending {
        SortOrder::Ascending
    } else {
        SortOrder::Descending
    }
}

/// Bucket marker for doc-id runs whose timestamps fall outside the histogram
/// range.
const BUCKET_NONE: u32 = u32::MAX;

/// Maps ascending doc ids to bucket indexes on a time-sorted segment without
/// reading the timestamp of any matched doc: a binary search on the monotone
/// column locates the doc-id boundary of every bucket edge once per segment,
/// and bucketing a doc is then a cursor advance over the resulting
/// `(first_doc_id, bucket)` runs.
struct SortedBucketCursor {
    /// runs ascending by first doc id, covering all docs; `BUCKET_NONE` marks
    /// out-of-range runs
    runs: Vec<(DocId, u32)>,
    cur: usize,
}

impl SortedBucketCursor {
    fn build(col: &Column<i64>, computer: &BucketComputer, order: SortOrder) -> Self {
        let num_docs = col.num_docs();
        let num_buckets = computer.num_buckets;
        let mut runs = Vec::with_capacity(num_buckets + 2);
        runs.push((0u32, BUCKET_NONE));
        if num_docs == 0 || num_buckets == 0 {
            return Self { runs, cur: 0 };
        }

        // bucket edges back in raw timestamp space (`bucket()` shifts each
        // value by ts_offset, so unshift the edges instead); i128 guards the
        // multiply against overflow at extreme query bounds
        let raw_edge = |k: usize| -> i64 {
            (computer.min_value as i128 - computer.ts_offset as i128
                + k as i128 * computer.bucket_width as i128)
                .clamp(i64::MIN as i128, i64::MAX as i128) as i64
        };

        // Boundary doc id of every bucket edge: Ascending → first doc with
        // ts >= edge, Descending → first doc with ts < edge. Boundaries are
        // monotone in k, so each search resumes from the previous result.
        let values = &col.values;
        let ascending = order == SortOrder::Ascending;
        let mut bounds = vec![0u32; num_buckets + 1];
        let mut prev = if ascending { 0 } else { num_docs };
        for (k, bound) in bounds.iter_mut().enumerate() {
            let edge = raw_edge(k);
            let (mut lo, mut hi) = if ascending {
                (prev, num_docs)
            } else {
                (0, prev)
            };
            while lo < hi {
                let mid = lo + (hi - lo) / 2;
                let v = values.get_val(mid);
                if if ascending { v < edge } else { v >= edge } {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            *bound = lo;
            prev = lo;
        }

        if ascending {
            // docs [bounds[k], bounds[k+1]) hold bucket k
            for (k, &bound) in bounds.iter().take(num_buckets).enumerate() {
                runs.push((bound, k as u32));
            }
            runs.push((bounds[num_buckets], BUCKET_NONE));
        } else {
            // docs [bounds[k+1], bounds[k]) hold bucket k, descending in k
            for k in (0..num_buckets).rev() {
                runs.push((bounds[k + 1], k as u32));
            }
            runs.push((bounds[0], BUCKET_NONE));
        }
        Self { runs, cur: 0 }
    }

    /// Bucket of `doc`, which must not be smaller than any previously passed
    /// doc id (collectors receive docs in ascending order within a segment).
    #[inline]
    fn bucket(&mut self, doc: DocId) -> Option<usize> {
        while self.cur + 1 < self.runs.len() && doc >= self.runs[self.cur + 1].0 {
            self.cur += 1;
        }
        let bucket = self.runs[self.cur].1;
        (bucket != BUCKET_NONE).then_some(bucket as usize)
    }

    /// Counts a whole block of ascending doc ids into `counts`. A contiguous
    /// block (every doc matched — the no-filter case) is counted one run at a
    /// time instead of one doc at a time.
    fn count_block(&mut self, docs: &[DocId], counts: &mut [u32]) {
        let (Some(&first), Some(&last)) = (docs.first(), docs.last()) else {
            return;
        };
        if docs.len() as u64 != last as u64 - first as u64 + 1 {
            for &doc in docs {
                if let Some(bucket) = self.bucket(doc) {
                    counts[bucket] += 1;
                }
            }
            return;
        }
        let mut doc = first as u64;
        let stop = last as u64 + 1;
        while doc < stop {
            // after bucket() the cursor's run contains `doc`, so the next
            // run's start is strictly greater — the loop always advances
            let bucket = self.bucket(doc as u32);
            let run_end = self
                .runs
                .get(self.cur + 1)
                .map_or(u64::MAX, |&(start, _)| start as u64);
            let end = run_end.min(stop);
            if let Some(bucket) = bucket {
                counts[bucket] += (end - doc) as u32;
            }
            doc = end;
        }
    }
}

/// Counts matching docs into fixed-width timestamp buckets, for
/// `SELECT histogram(_timestamp) AS ts, count(*) GROUP BY ts`.
///
/// Replaces `tantivy::collector::HistogramCollector`, which fetches the fast
/// field per doc through an `Arc<dyn ColumnValues>` and implements no
/// `collect_block`.
///
/// Segments are time-sorted by design (parquet is written `ORDER BY
/// _timestamp DESC` and the index preserves row order), so docs map to
/// buckets by doc id alone via [`SortedBucketCursor`] — no per-doc column
/// reads at all. Fetching timestamps block-wise remains only as a defensive
/// fallback for a non-Full timestamp column.
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

/// Per-segment bucketing strategy, picked once in `for_segment`.
enum HistogramMode {
    /// time-sorted segment: docs map to buckets by id alone, no column reads
    Sorted(SortedBucketCursor),
    /// general path: fetch timestamps block-wise and bucket each one
    Scan {
        col: Column<i64>,
        ts_buf: Vec<Option<i64>>,
    },
    /// column missing from this segment (legacy index file)
    Missing,
}

pub struct SimpleHistogramSegmentCollector {
    mode: HistogramMode,
    computer: BucketComputer,
    counts: Vec<u32>,
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
        let computer = BucketComputer::new(
            self.min_value,
            self.bucket_width,
            self.num_buckets,
            self.ts_offset,
        );
        let mode = match segment.fast_fields().column_opt::<i64>(&self.field)? {
            None => HistogramMode::Missing,
            Some(col) => match column_sort_order(&col) {
                SortOrder::Unsorted => HistogramMode::Scan {
                    col,
                    ts_buf: Vec::new(),
                },
                order => HistogramMode::Sorted(SortedBucketCursor::build(&col, &computer, order)),
            },
        };
        Ok(SimpleHistogramSegmentCollector {
            mode,
            computer,
            counts: vec![0; self.num_buckets],
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
        match &mut self.mode {
            HistogramMode::Sorted(cursor) => {
                if let Some(bucket) = cursor.bucket(doc) {
                    self.counts[bucket] += 1;
                }
            }
            HistogramMode::Scan { col, .. } => {
                if let Some(ts) = col.first(doc)
                    && let Some(bucket) = self.computer.bucket(ts)
                {
                    self.counts[bucket] += 1;
                }
            }
            HistogramMode::Missing => {}
        }
    }

    /// Block variant of [`Self::collect`]: count by doc-id runs on a sorted
    /// segment, otherwise fetch the whole block's timestamps at once instead
    /// of paying a per-document column lookup.
    fn collect_block(&mut self, docs: &[DocId]) {
        match &mut self.mode {
            HistogramMode::Sorted(cursor) => cursor.count_block(docs, &mut self.counts),
            HistogramMode::Scan { col, ts_buf } => {
                fetch_first_vals(col, docs, ts_buf);
                for ts in ts_buf.iter().flatten() {
                    if let Some(bucket) = self.computer.bucket(*ts) {
                        self.counts[bucket] += 1;
                    }
                }
            }
            HistogramMode::Missing => {}
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
    /// Some on a time-sorted segment: buckets come from doc-id runs instead
    /// of fetching the timestamp column
    sorted: Option<SortedBucketCursor>,
    computer: BucketComputer,
    counts: GroupCounts,
    per_bucket_limit: usize,
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
        let computer = BucketComputer::new(
            self.min_value,
            self.bucket_width,
            self.num_buckets,
            self.ts_offset,
        );
        let sorted = cols
            .as_ref()
            .and_then(|(ts_col, _)| match column_sort_order(ts_col) {
                SortOrder::Unsorted => None,
                order => Some(SortedBucketCursor::build(ts_col, &computer, order)),
            });
        Ok(MultiHistogramSegmentCollector {
            cols,
            sorted,
            computer,
            counts,
            per_bucket_limit: self.per_bucket_limit,
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
        let Self {
            cols,
            sorted,
            computer,
            counts,
            ..
        } = self;
        let Some((ts_col, str_col)) = cols else {
            return;
        };
        // a doc missing the breakdown value forms no group (terms agg `missing: None`)
        if let Some(cursor) = sorted {
            if let Some(bucket) = cursor.bucket(doc)
                && let Some(ord) = str_col.ords().first(doc)
            {
                counts.add(bucket, ord);
            }
        } else if let Some(ts) = ts_col.first(doc)
            && let Some(ord) = str_col.ords().first(doc)
            && let Some(bucket) = computer.bucket(ts)
        {
            counts.add(bucket, ord);
        }
    }

    /// Block variant of [`Self::collect`]: fetch the columns' values for the
    /// whole block at once instead of paying per-document column lookups; on
    /// a sorted segment the timestamp fetch is skipped entirely.
    fn collect_block(&mut self, docs: &[DocId]) {
        let Self {
            cols,
            sorted,
            computer,
            counts,
            ts_buf,
            ord_buf,
            ..
        } = self;
        let Some((ts_col, str_col)) = cols else {
            return;
        };
        fetch_first_vals(str_col.ords(), docs, ord_buf);
        if let Some(cursor) = sorted {
            for (&doc, ord) in docs.iter().zip(ord_buf.iter()) {
                let Some(ord) = ord else {
                    continue;
                };
                if let Some(bucket) = cursor.bucket(doc) {
                    counts.add(bucket, *ord);
                }
            }
            return;
        }
        fetch_first_vals(ts_col, docs, ts_buf);
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
                let key = computer.min_value + bucket as i64 * computer.bucket_width as i64;
                out.push((key, s.clone(), count as u64));
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use tantivy::{
        Index, Term, doc,
        query::{AllQuery, TermQuery},
        schema::{FAST, IndexRecordOption, SchemaBuilder, TextFieldIndexing, TextOptions},
    };

    use super::*;

    /// Builds a single-segment index with the given `(timestamp, level)` rows
    /// in row order — collectors see doc ids in exactly this order.
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
    /// the level, one doc below and one above the [0, 50) bucket range. Rows
    /// are ordered by timestamp DESC — the physical layout the write path
    /// guarantees — so the collectors take the sorted fast path.
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
    fn test_simple_histogram_collector_sorted_asc() {
        let searcher = build_index_from(&[
            (-10, Some("a")),
            (0, Some("a")),
            (5, Some("b")),
            (6, Some("b")),
            (7, None),
            (15, Some("a")),
            (25, Some("a")),
            (25, Some("b")),
            (49, Some("c")),
            (50, Some("a")),
        ]);
        let collector = SimpleHistogramCollector::new("_timestamp".to_string(), 0, 10, 5, 0);
        let res = searcher.search(&AllQuery, &collector).unwrap();
        assert_eq!(res, vec![4, 1, 2, 0, 1]);
    }

    #[test]
    fn test_simple_histogram_collector_with_filter() {
        let searcher = build_index();
        let level = searcher.schema().get_field("level").unwrap();
        // matches ts 50, 25, 15, 0, -10 — a non-contiguous doc set, so the
        // sorted path buckets doc-by-doc through the cursor
        let query = TermQuery::new(Term::from_field_text(level, "a"), IndexRecordOption::Basic);
        let collector = SimpleHistogramCollector::new("_timestamp".to_string(), 0, 10, 5, 0);
        let res = searcher.search(&query, &collector).unwrap();
        assert_eq!(res, vec![1, 1, 1, 0, 0]);
    }

    #[test]
    fn test_simple_histogram_collector_sorted_ties_on_edges() {
        // runs of equal timestamps sitting exactly on bucket edges
        let searcher = build_index_from(&[
            (20, None),
            (20, None),
            (20, None),
            (10, None),
            (10, None),
            (0, None),
        ]);
        let collector = SimpleHistogramCollector::new("_timestamp".to_string(), 0, 10, 3, 0);
        let res = searcher.search(&AllQuery, &collector).unwrap();
        assert_eq!(res, vec![1, 2, 3]);
    }

    #[test]
    fn test_simple_histogram_collector_optional_ts_column_scan_fallback() {
        // a doc without _timestamp makes the column non-Full, which disables
        // the sorted fast path; the scan fallback must still count correctly
        let mut schema_builder = SchemaBuilder::new();
        let ts = schema_builder.add_i64_field("_timestamp", FAST);
        let index = Index::create_in_ram(schema_builder.build());
        let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
        writer.add_document(doc!(ts => 30i64)).unwrap();
        writer.add_document(doc!()).unwrap();
        writer.add_document(doc!(ts => 5i64)).unwrap();
        writer.commit().unwrap();
        let searcher = index.reader().unwrap().searcher();

        let collector = SimpleHistogramCollector::new("_timestamp".to_string(), 0, 10, 4, 0);
        let res = searcher.search(&AllQuery, &collector).unwrap();
        assert_eq!(res, vec![1, 0, 0, 1]);
    }

    #[test]
    fn test_sorted_bucket_cursor_count_block() {
        // hand-built runs: docs [0,2) out of range, [2,5) bucket 0, bucket 1
        // empty, [5,9) bucket 2, [9,..) out of range
        let runs = vec![(0, BUCKET_NONE), (2, 0), (5, 1), (5, 2), (9, BUCKET_NONE)];

        // contiguous block: counted run-at-a-time
        let mut cursor = SortedBucketCursor {
            runs: runs.clone(),
            cur: 0,
        };
        let mut counts = vec![0u32; 3];
        cursor.count_block(&(0..=10).collect::<Vec<_>>(), &mut counts);
        assert_eq!(counts, vec![3, 0, 4]);

        // sparse block: counted doc-by-doc through the cursor
        let mut cursor = SortedBucketCursor { runs, cur: 0 };
        let mut counts = vec![0u32; 3];
        cursor.count_block(&[2, 6, 9, 10], &mut counts);
        assert_eq!(counts, vec![1, 0, 1]);
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
