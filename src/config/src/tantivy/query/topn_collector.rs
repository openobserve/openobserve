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

use hashbrown::HashMap;
use tantivy::{
    DocId, Score, SegmentOrdinal, SegmentReader,
    collector::{Collector, SegmentCollector},
    columnar::{Cardinality, StrColumn},
};

use crate::meta::inverted_index::MAX_SIMPLE_TOPN_FIELDS;

/// Packed multi-field term-ordinal key: field `i`'s ordinal occupies bits `32*i..32*(i+1)`.
/// Ordinals always fit in 32 bits (a segment holds at most u32::MAX docs), and a single
/// integer key is much cheaper than a tuple or Vec on the per-doc hot path.
pub trait OrdKey: Copy + Eq + Ord + std::hash::Hash + Send + Sync + 'static {
    /// max number of ordinals this key can hold
    const CAPACITY: usize;

    fn pack(ords: &[u64]) -> Self;
    fn unpack(self, idx: usize) -> u64;
}

impl OrdKey for u32 {
    const CAPACITY: usize = 1;

    fn pack(ords: &[u64]) -> Self {
        debug_assert!(ords.len() == 1 && ords[0] <= u32::MAX as u64);
        ords[0] as u32
    }

    fn unpack(self, idx: usize) -> u64 {
        debug_assert_eq!(idx, 0);
        self as u64
    }
}

impl OrdKey for u64 {
    const CAPACITY: usize = 2;

    fn pack(ords: &[u64]) -> Self {
        debug_assert!(ords.len() <= 2 && ords.iter().all(|&o| o <= u32::MAX as u64));
        ords.iter()
            .enumerate()
            .fold(0u64, |key, (i, &ord)| key | (ord << (32 * i)))
    }

    fn unpack(self, idx: usize) -> u64 {
        (self >> (32 * idx)) & 0xFFFF_FFFF
    }
}

impl OrdKey for u128 {
    const CAPACITY: usize = 4;

    fn pack(ords: &[u64]) -> Self {
        debug_assert!(ords.len() <= 4 && ords.iter().all(|&o| o <= u32::MAX as u64));
        ords.iter()
            .enumerate()
            .fold(0u128, |key, (i, &ord)| key | ((ord as u128) << (32 * i)))
    }

    fn unpack(self, idx: usize) -> u64 {
        ((self >> (32 * idx)) & 0xFFFF_FFFF) as u64
    }
}

/// Flat collector for `GROUP BY field0[, .., fieldN] COUNT(*)` (N in 1..=4): counts packed
/// fast-field term ordinals into a single flat map, keeps all groups when the file has at
/// most `max_groups` distinct groups (its contribution is exact) or only the top-K otherwise
/// (approximate), and resolves ordinals to strings for the survivors only.
///
/// This replaces tantivy's nested `TermsAggregation`, which materializes a string per group
/// and over-fetches exponentially in the field count.
///
/// `K` selects the packed key width: `u32` for a single field, `u64` for two, `u128` for 3..=4.
pub struct TopNCollector<K: OrdKey> {
    fields: Vec<String>,
    /// groups kept per file when truncating (over-fetch for cross-file accuracy)
    k: usize,
    /// up to this many distinct groups, a file returns all of them
    /// (ZO_INVERTED_INDEX_TOPN_MAX_GROUP_NUM, at least k)
    max_groups: usize,
    /// keep the K smallest counts (ORDER BY count ASC) instead of the K largest
    ascend: bool,
    /// group space size up to which the dense counting array is used
    dense_limit: usize,
    _key: std::marker::PhantomData<K>,
}

impl<K: OrdKey> TopNCollector<K> {
    pub fn new(fields: Vec<String>, limit: usize, ascend: bool) -> Self {
        debug_assert!(!fields.is_empty() && fields.len() <= K::CAPACITY);
        // over-fetch beyond the query limit for cross-file merge accuracy
        let k = if fields.len() == 1 {
            (limit * 4).max(1000)
        } else {
            (limit * 2).max(1000)
        };
        let max_groups = crate::get_config().limit.inverted_index_topn_max_group_num;
        Self {
            fields,
            k,
            max_groups: max_groups.max(k),
            ascend,
            dense_limit: DENSE_GROUP_SPACE_LIMIT,
            _key: std::marker::PhantomData,
        }
    }

    #[cfg(test)]
    fn with_k(mut self, k: usize) -> Self {
        self.k = k;
        self
    }

    #[cfg(test)]
    fn with_max_groups(mut self, max_groups: usize) -> Self {
        self.max_groups = max_groups.max(self.k);
        self
    }

    #[cfg(test)]
    fn with_dense_limit(mut self, dense_limit: usize) -> Self {
        self.dense_limit = dense_limit;
        self
    }
}

/// Above this many cells (4 bytes each = 32MB) the dense counting array gives way to a hash map.
pub const DENSE_GROUP_SPACE_LIMIT: usize = 8_000_000;

/// Per-segment group counters: a flat array indexed by the mixed-radix ordinal when the
/// product of the fields' dictionary sizes is small (one add per doc, no hashing), otherwise
/// a hash map keyed by the packed ordinals.
///
/// Counts are `u32` — a group's count is bounded by the segment's doc count, and `DocId` is
/// u32 — which halves the cache footprint of both representations; `harvest` widens to u64.
enum GroupCounts<K> {
    /// counts indexed by `ord0 + dims0*(ord1 + dims1*(ord2 + ..))`
    Dense {
        counts: Vec<u32>,
        dims: [usize; MAX_SIMPLE_TOPN_FIELDS],
    },
    Sparse(HashMap<K, u32>),
}

impl<K: OrdKey> GroupCounts<K> {
    #[inline]
    fn add(&mut self, ords: &[u64]) {
        match self {
            Self::Dense { counts, dims } => {
                let mut index = 0usize;
                for i in (0..ords.len()).rev() {
                    index = index * dims[i] + ords[i] as usize;
                }
                counts[index] += 1;
            }
            Self::Sparse(counts) => *counts.entry(K::pack(ords)).or_insert(0) += 1,
        }
    }
}

pub struct TopNSegmentCollector<K: OrdKey> {
    /// None when any field's column is missing from this segment (legacy index file)
    cols: Option<Vec<StrColumn>>,
    k: usize,
    max_groups: usize,
    ascend: bool,
    counts: GroupCounts<K>,
    /// per-field reusable buffers for block-fetched ordinals
    ord_bufs: Vec<Vec<Option<u64>>>,
}

impl<K: OrdKey> Collector for TopNCollector<K> {
    type Fruit = Vec<(Vec<String>, u64)>;
    type Child = TopNSegmentCollector<K>;

    fn for_segment(
        &self,
        _segment_local_id: SegmentOrdinal,
        segment: &SegmentReader,
    ) -> tantivy::Result<Self::Child> {
        let fast_fields = segment.fast_fields();
        let cols = self
            .fields
            .iter()
            .map(|field| fast_fields.str(field))
            .collect::<tantivy::Result<Option<Vec<_>>>>()?;
        let counts = match &cols {
            Some(cols) => {
                let mut dims = [1usize; MAX_SIMPLE_TOPN_FIELDS];
                let mut space = Some(1usize);
                for (dim, col) in dims.iter_mut().zip(cols.iter()) {
                    *dim = col.num_terms();
                    space = space.and_then(|s| s.checked_mul(*dim));
                }
                match space {
                    Some(space) if space <= self.dense_limit => GroupCounts::Dense {
                        counts: vec![0; space],
                        dims,
                    },
                    _ => GroupCounts::Sparse(HashMap::new()),
                }
            }
            None => GroupCounts::Sparse(HashMap::new()),
        };
        let ord_bufs = vec![Vec::new(); self.fields.len()];
        Ok(TopNSegmentCollector {
            cols,
            k: self.k,
            max_groups: self.max_groups,
            ascend: self.ascend,
            counts,
            ord_bufs,
        })
    }

    fn requires_scoring(&self) -> bool {
        false
    }

    fn merge_fruits(
        &self,
        mut segment_fruits: Vec<Vec<(Vec<String>, u64)>>,
    ) -> tantivy::Result<Self::Fruit> {
        debug_assert!(
            segment_fruits.len() <= 1,
            "TopNSegmentCollector used on multi-segment index"
        );
        Ok(segment_fruits.pop().unwrap_or_default())
    }
}

impl<K: OrdKey> SegmentCollector for TopNSegmentCollector<K> {
    type Fruit = Vec<(Vec<String>, u64)>;

    fn collect(&mut self, doc: DocId, _score: Score) {
        let Some(cols) = &self.cols else {
            return;
        };
        // columns are single-valued; a doc missing any field forms no group
        let mut ords = [0u64; MAX_SIMPLE_TOPN_FIELDS];
        for (ord, col) in ords.iter_mut().zip(cols.iter()) {
            match col.ords().first(doc) {
                Some(o) => *ord = o,
                None => return,
            }
        }
        self.counts.add(&ords[..cols.len()]);
    }

    /// Block variant of [`Self::collect`]: fetch each field's ordinals for the whole block
    /// at once instead of paying a per-document column lookup.
    // the doc index addresses one slot in EVERY field's buffer, which iterators can't express
    #[allow(clippy::needless_range_loop)]
    fn collect_block(&mut self, docs: &[DocId]) {
        let Self {
            cols,
            counts,
            ord_bufs,
            ..
        } = self;
        let Some(cols) = cols else {
            return;
        };
        let num_fields = cols.len();
        for (buf, col) in ord_bufs.iter_mut().zip(cols.iter()) {
            // first_vals only writes present slots, so reset stale values to None first —
            // unless the column is Full cardinality and writes every slot anyway
            if col.ords().get_cardinality() != Cardinality::Full {
                buf.clear();
            }
            buf.resize(docs.len(), None);
            col.ords().first_vals(docs, buf);
        }
        // `K::CAPACITY == 1` is const per monomorphization: for the single-field key the
        // ordinal is the dense index / packed key itself, so the field loops compile away
        match counts {
            GroupCounts::Dense { counts, dims } => {
                if K::CAPACITY == 1 {
                    for ord in ord_bufs[0].iter().flatten() {
                        counts[*ord as usize] += 1;
                    }
                } else {
                    'doc: for d in 0..docs.len() {
                        let mut index = 0usize;
                        for i in (0..num_fields).rev() {
                            match ord_bufs[i][d] {
                                Some(ord) => index = index * dims[i] + ord as usize,
                                None => continue 'doc,
                            }
                        }
                        counts[index] += 1;
                    }
                }
            }
            GroupCounts::Sparse(counts) => {
                if K::CAPACITY == 1 {
                    for ord in ord_bufs[0].iter().flatten() {
                        *counts.entry(K::pack(&[*ord])).or_insert(0) += 1;
                    }
                } else {
                    let mut ords = [0u64; MAX_SIMPLE_TOPN_FIELDS];
                    'doc: for d in 0..docs.len() {
                        for i in 0..num_fields {
                            match ord_bufs[i][d] {
                                Some(ord) => ords[i] = ord,
                                None => continue 'doc,
                            }
                        }
                        let key = K::pack(&ords[..num_fields]);
                        *counts.entry(key).or_insert(0) += 1;
                    }
                }
            }
        }
    }

    fn harvest(self) -> Self::Fruit {
        let TopNSegmentCollector {
            cols,
            k,
            max_groups,
            ascend,
            counts,
            ..
        } = self;
        let Some(cols) = cols else {
            return Vec::new();
        };

        // Within max_groups distinct groups, return all of them (this segment's contribution
        // is exact); beyond that keep only the top-K on cheap integer ordinals BEFORE
        // touching the term dictionary — the merged result becomes approximate.
        let top: Vec<(K, u32)> = match counts {
            GroupCounts::Dense { counts, dims } => {
                let unpack_index = |index: usize| {
                    let mut rest = index;
                    let mut ords = [0u64; MAX_SIMPLE_TOPN_FIELDS];
                    for i in 0..cols.len() {
                        ords[i] = (rest % dims[i]) as u64;
                        rest /= dims[i];
                    }
                    K::pack(&ords[..cols.len()])
                };
                let groups = counts.iter().filter(|count| **count > 0).count();
                let entries: Vec<(usize, u32)> = if groups <= max_groups {
                    counts
                        .iter()
                        .enumerate()
                        .filter(|(_, count)| **count > 0)
                        .map(|(index, count)| (index, *count))
                        .collect()
                } else {
                    log::debug!(
                        "tantivy topn collector: segment has {groups} distinct groups > max \
                         groups {max_groups}, keeping top {k}, the merged top-n is approximate",
                    );
                    select_top_k_dense(&counts, k, ascend)
                };
                entries
                    .into_iter()
                    .map(|(index, count)| (unpack_index(index), count))
                    .collect()
            }
            GroupCounts::Sparse(counts) => {
                let mut top = counts.into_iter().collect::<Vec<_>>();
                if top.len() > max_groups {
                    log::debug!(
                        "tantivy topn collector: segment has {} distinct groups > max groups \
                         {max_groups}, keeping top {k}, the merged top-n is approximate",
                        top.len(),
                    );
                    truncate_top_k(&mut top, k, ascend);
                }
                top
            }
        };

        // Resolve survivors to strings in one sorted forward pass per field. Count ties broke
        // toward smaller keys, so survivors cluster near the start of each dictionary.
        let maps = cols
            .iter()
            .enumerate()
            .map(|(i, col)| resolve_ords(col, top.iter().map(|(key, _)| key.unpack(i)).collect()))
            .collect::<Vec<_>>();

        let mut out = Vec::with_capacity(top.len());
        'next_group: for (key, count) in top {
            let mut row = Vec::with_capacity(cols.len());
            for (i, map) in maps.iter().enumerate() {
                match map.get(&key.unpack(i)) {
                    Some(s) => row.push(s.clone()),
                    None => continue 'next_group,
                }
            }
            out.push((row, count as u64));
        }
        out
    }
}

/// Resolve term ordinals to strings in one sorted forward pass over the term dictionary:
/// `sorted_ords_to_term_cb` opens each dictionary block once, while `ord_to_term` would
/// re-scan a block per call.
pub fn resolve_ords(col: &StrColumn, mut ords: Vec<u64>) -> HashMap<u64, String> {
    ords.sort_unstable();
    ords.dedup();
    let mut strings: Vec<String> = Vec::with_capacity(ords.len());
    // the callback fires once per input ordinal in order, so `strings[i]` pairs with `ords[i]`;
    // on error only the unresolved tail is dropped (zip stops at the shorter side)
    if let Err(e) = col.dictionary().sorted_ords_to_term_cb(&ords, |bytes| {
        strings.push(String::from_utf8_lossy(bytes).into_owned());
    }) {
        log::warn!(
            "search->tantivy: topn failed to resolve {} of {} term ordinals: {e}",
            ords.len() - strings.len(),
            ords.len()
        );
    }
    ords.into_iter().zip(strings).collect()
}

/// Select the top-K `(index, count)` entries from a dense counting array, with the same
/// ordering contract as [`truncate_top_k`]. A bounded max-heap of the worst kept entry makes
/// the scan O(n): indexes arrive in ascending order, so once the heap is full tied candidates
/// lose to what is already kept and are rejected in O(1).
fn select_top_k_dense(counts: &[u32], k: usize, ascend: bool) -> Vec<(usize, u32)> {
    use std::collections::BinaryHeap;
    if k == 0 {
        return Vec::new();
    }
    // flip counts for descending so both orders keep the K smallest (key, index) entries
    let sort_key = |count: u32| if ascend { count } else { !count };
    let mut heap: BinaryHeap<(u32, usize)> = BinaryHeap::with_capacity(k + 1);
    for (index, &count) in counts.iter().enumerate() {
        if count == 0 {
            continue;
        }
        let entry = (sort_key(count), index);
        if heap.len() < k {
            heap.push(entry);
        } else if let Some(&worst) = heap.peek()
            && entry < worst
        {
            heap.pop();
            heap.push(entry);
        }
    }
    heap.into_iter()
        .map(|(_, index)| (index, counts[index]))
        .collect()
}

/// Keep the top-K entries by count, in place: the K smallest when `ascend`, the K largest
/// otherwise. Count ties break toward the smaller key, which keeps survivors clustered by
/// ordinal for cheaper resolution (SQL leaves tie order unspecified).
pub fn truncate_top_k<K: Ord>(items: &mut Vec<(K, u32)>, k: usize, ascend: bool) {
    if k == 0 {
        items.clear();
        return;
    }
    if items.len() <= k {
        return;
    }
    if ascend {
        items.select_nth_unstable_by(k, |a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
    } else {
        items.select_nth_unstable_by(k, |a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    }
    items.truncate(k);
}

#[cfg(test)]
mod tests {
    use tantivy::{
        Index, doc,
        query::AllQuery,
        schema::{SchemaBuilder, TextOptions},
    };

    use super::*;

    #[test]
    fn test_ord_key_pack_unpack() {
        let key = u32::pack(&[7]);
        assert_eq!(key.unpack(0), 7);

        let key = u32::pack(&[u32::MAX as u64]);
        assert_eq!(key.unpack(0), u32::MAX as u64);

        let key = u64::pack(&[7]);
        assert_eq!(key.unpack(0), 7);

        let key = u64::pack(&[7, 9]);
        assert_eq!((key.unpack(0), key.unpack(1)), (7, 9));

        let key = u128::pack(&[1, 2, 3, 4]);
        assert_eq!(
            (key.unpack(0), key.unpack(1), key.unpack(2), key.unpack(3)),
            (1, 2, 3, 4)
        );

        let max = u32::MAX as u64;
        let key = u128::pack(&[max, 0, max]);
        assert_eq!((key.unpack(0), key.unpack(1), key.unpack(2)), (max, 0, max));
    }

    #[test]
    fn test_topn_collector() {
        let mut schema_builder = SchemaBuilder::new();
        let opts = TextOptions::default().set_fast(None);
        let f0 = schema_builder.add_text_field("f0", opts.clone());
        let f1 = schema_builder.add_text_field("f1", opts.clone());
        let f2 = schema_builder.add_text_field("f2", opts);
        let index = Index::create_in_ram(schema_builder.build());

        // two commits -> two segments, so (a, x) must be summed across segments
        let mut writer = index.writer_with_num_threads(1, 15_000_000).unwrap();
        writer
            .add_document(doc!(f0 => "a", f1 => "x", f2 => "1"))
            .unwrap();
        writer
            .add_document(doc!(f0 => "a", f1 => "x", f2 => "1"))
            .unwrap();
        writer
            .add_document(doc!(f0 => "a", f1 => "y", f2 => "1"))
            .unwrap();
        writer
            .add_document(doc!(f0 => "a", f1 => "y", f2 => "2"))
            .unwrap();
        writer
            .add_document(doc!(f0 => "a", f1 => "x", f2 => "1"))
            .unwrap();
        writer
            .add_document(doc!(f0 => "b", f1 => "x", f2 => "1"))
            .unwrap();
        // missing f1 -> does not form a group for queries that include f1
        writer.add_document(doc!(f0 => "c", f2 => "1")).unwrap();
        writer.commit().unwrap();

        let searcher = index.reader().unwrap().searcher();
        let row = |strs: &[&str], count: u64| (strs.iter().map(|s| s.to_string()).collect(), count);

        fn run<K: OrdKey>(
            searcher: &tantivy::Searcher,
            fields: &[&str],
            k: usize,
            max_groups: usize,
            ascend: bool,
            dense_limit: usize,
        ) -> Vec<(Vec<String>, u64)> {
            let fields: Vec<String> = fields.iter().map(|s| s.to_string()).collect();
            searcher
                .search(
                    &AllQuery,
                    &TopNCollector::<K>::new(fields, 10, ascend)
                        .with_k(k)
                        .with_max_groups(max_groups)
                        .with_dense_limit(dense_limit),
                )
                .unwrap()
        }

        // dense_limit usize::MAX forces the dense counting array, 0 forces the hash map;
        // both must produce identical results
        for dense_limit in [usize::MAX, 0] {
            let search = |fields: &[&str], k: usize, max_groups: usize, ascend: bool| {
                let mut res = match fields.len() {
                    1 => run::<u32>(&searcher, fields, k, max_groups, ascend, dense_limit),
                    2 => run::<u64>(&searcher, fields, k, max_groups, ascend, dense_limit),
                    _ => run::<u128>(&searcher, fields, k, max_groups, ascend, dense_limit),
                };
                res.sort_by(|a, b| {
                    if ascend {
                        a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0))
                    } else {
                        b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0))
                    }
                });
                res
            };

            // single field via the u32 key (doc with missing f1 still counts for f0)
            assert_eq!(
                search(&["f0"], 10, 10, false),
                vec![row(&["a"], 5), row(&["b"], 1), row(&["c"], 1)]
            );

            // a single field through the wider u64 key takes the generic (non-specialized)
            // counting path and must agree
            let mut res = run::<u64>(&searcher, &["f0"], 10, 10, false, dense_limit);
            res.sort_unstable();
            assert_eq!(res, vec![row(&["a"], 5), row(&["b"], 1), row(&["c"], 1)]);

            // two fields, counts merged across segments, missing-field doc excluded
            assert_eq!(
                search(&["f0", "f1"], 10, 10, false),
                vec![
                    row(&["a", "x"], 3),
                    row(&["a", "y"], 2),
                    row(&["b", "x"], 1)
                ]
            );
            // ascend keeps the smallest counts
            assert_eq!(search(&["f0", "f1"], 10, 10, true)[0], row(&["b", "x"], 1));
            // when groups exceed max_groups, only the top-k survive
            assert_eq!(
                search(&["f0", "f1"], 1, 1, false),
                vec![row(&["a", "x"], 3)]
            );
            // max_groups above the distinct count keeps everything even when k is small
            assert_eq!(search(&["f0", "f1"], 1, 10, false).len(), 3);

            // three fields via the u128 key
            assert_eq!(
                search(&["f0", "f1", "f2"], 10, 10, false),
                vec![
                    row(&["a", "x", "1"], 3),
                    row(&["a", "y", "1"], 1),
                    row(&["a", "y", "2"], 1),
                    row(&["b", "x", "1"], 1)
                ]
            );
        }
    }

    #[test]
    fn test_select_top_k_dense_matches_truncate_top_k() {
        // counts indexed by ordinal, with zeros (absent groups) and ties
        let counts: Vec<u32> = vec![3, 0, 1, 5, 1, 0, 5, 2, 1, 3];
        for ascend in [false, true] {
            for k in [1, 2, 3, 5, 20] {
                let mut expected: Vec<(usize, u32)> = counts
                    .iter()
                    .enumerate()
                    .filter(|(_, c)| **c > 0)
                    .map(|(i, c)| (i, *c))
                    .collect();
                truncate_top_k(&mut expected, k, ascend);
                expected.sort_unstable();

                let mut got = select_top_k_dense(&counts, k, ascend);
                got.sort_unstable();
                assert_eq!(got, expected, "k={k} ascend={ascend}");
            }
        }
        assert!(select_top_k_dense(&counts, 0, false).is_empty());
    }

    #[test]
    fn test_truncate_top_k() {
        let mk = || vec![("a", 5u32), ("b", 1), ("c", 9), ("d", 3), ("e", 7)];

        // keep K largest counts (ORDER BY count DESC)
        let mut desc = mk();
        truncate_top_k(&mut desc, 2, false);
        let mut got: Vec<u32> = desc.iter().map(|(_, c)| *c).collect();
        got.sort_unstable();
        assert_eq!(got, vec![7, 9]);

        // keep K smallest counts (ORDER BY count ASC)
        let mut asc = mk();
        truncate_top_k(&mut asc, 2, true);
        let mut got: Vec<u32> = asc.iter().map(|(_, c)| *c).collect();
        got.sort_unstable();
        assert_eq!(got, vec![1, 3]);

        // no-op when K >= len
        let mut all = mk();
        truncate_top_k(&mut all, 10, false);
        assert_eq!(all.len(), 5);

        // K == 0 clears
        let mut none = mk();
        truncate_top_k(&mut none, 0, false);
        assert!(none.is_empty());
    }
}
