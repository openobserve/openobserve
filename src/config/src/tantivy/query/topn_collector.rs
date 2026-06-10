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
    columnar::StrColumn,
};

use crate::meta::inverted_index::MAX_SIMPLE_TOPN_FIELDS;

/// Packed multi-field term-ordinal key.
///
/// Ordinals always fit in 32 bits: a segment holds at most u32::MAX docs (DocId is u32) and a
/// dictionary cannot have more terms than docs. Field `i`'s ordinal occupies bits
/// `32*i..32*(i+1)`. A single integer key hashes faster (and uses less memory bandwidth) than
/// a tuple or Vec on the 100M+ insert hot path.
pub trait OrdKey: Copy + Eq + Ord + std::hash::Hash + Send + Sync + 'static {
    /// max number of ordinals this key can hold
    const CAPACITY: usize;

    fn pack(ords: &[u64]) -> Self;
    fn unpack(self, idx: usize) -> u64;
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

/// Flat collector for `GROUP BY field0[, .., fieldN] COUNT(*)` (N in 1..=4).
///
/// Aggregates over the fields' columnar (fast field) term ordinals into a single flat
/// map and returns the per-file top-K `(fields, count)` groups:
///   - read each field's term ordinal for each matching doc,
///   - count into a single flat `packed ordinals -> count` map (bounded by the file's rows),
///   - keep only the per-file top-K, resolving ordinals to strings for survivors only.
///
/// This replaces tantivy's `TermsAggregation`, which keeps a separate sub-collector per
/// bucket level, materializes a string per group, and over-fetches the product of the
/// per-level segment sizes (exponential in the field count).
///
/// `K` selects the packed key width: `u64` for 1..=2 fields, `u128` for 3..=4 fields.
pub struct TopNCollector<K: OrdKey> {
    fields: Vec<String>,
    /// number of groups to keep per file (over-fetch for cross-file accuracy)
    k: usize,
    /// keep the K smallest counts (ORDER BY count ASC) instead of the K largest
    ascend: bool,
    _key: std::marker::PhantomData<K>,
}

impl<K: OrdKey> TopNCollector<K> {
    pub fn new(fields: Vec<String>, k: usize, ascend: bool) -> Self {
        debug_assert!(!fields.is_empty() && fields.len() <= K::CAPACITY);
        Self {
            fields,
            k,
            ascend,
            _key: std::marker::PhantomData,
        }
    }
}

pub struct TopNSegmentCollector<K: OrdKey> {
    /// None when any field's column is missing from this segment (legacy index file)
    cols: Option<Vec<StrColumn>>,
    k: usize,
    ascend: bool,
    /// packed segment-local term ordinals -> count
    counts: HashMap<K, u64>,
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
        Ok(TopNSegmentCollector {
            cols,
            k: self.k,
            ascend: self.ascend,
            counts: HashMap::new(),
        })
    }

    fn requires_scoring(&self) -> bool {
        false
    }

    fn merge_fruits(
        &self,
        mut segment_fruits: Vec<Vec<(Vec<String>, u64)>>,
    ) -> tantivy::Result<Self::Fruit> {
        // Common case (one segment per file): the single per-segment fruit is already the
        // resolved, truncated top-K — return it as-is instead of rebuilding a string map.
        if segment_fruits.len() == 1 {
            return Ok(segment_fruits.pop().unwrap());
        }
        // Otherwise sum partial counts for identical groups across segments, then keep the
        // top-K.
        let mut merged: HashMap<Vec<String>, u64> = HashMap::new();
        for fruit in segment_fruits {
            for (key, count) in fruit {
                *merged.entry(key).or_insert(0) += count;
            }
        }
        let mut merged = merged.into_iter().collect::<Vec<_>>();
        truncate_top_k(&mut merged, self.k, self.ascend);
        Ok(merged)
    }
}

impl<K: OrdKey> SegmentCollector for TopNSegmentCollector<K> {
    type Fruit = Vec<(Vec<String>, u64)>;

    fn collect(&mut self, doc: DocId, _score: Score) {
        let Some(cols) = &self.cols else {
            return;
        };
        // index_fields are single-valued raw columns: take the first ordinal if present.
        // Docs missing any field do not form a group (matches `missing: None` before).
        let mut ords = [0u64; MAX_SIMPLE_TOPN_FIELDS];
        for (ord, col) in ords.iter_mut().zip(cols.iter()) {
            match col.ords().first(doc) {
                Some(o) => *ord = o,
                None => return,
            }
        }
        let key = K::pack(&ords[..cols.len()]);
        *self.counts.entry(key).or_insert(0) += 1;
    }

    fn harvest(self) -> Self::Fruit {
        let TopNSegmentCollector {
            cols,
            k,
            ascend,
            counts,
        } = self;
        let Some(cols) = cols else {
            return Vec::new();
        };

        // Reduce to the per-segment top-K on cheap integer ordinals BEFORE resolving strings,
        // so the term dictionary is only touched for the surviving groups.
        let mut top = counts.into_iter().collect::<Vec<_>>();
        truncate_top_k(&mut top, k, ascend);

        // Resolve survivors to strings in one sorted forward pass per field (see
        // `resolve_ords`) instead of a random per-group lookup. `truncate_top_k` breaks count
        // ties toward smaller keys (= smaller ordinals), so survivors cluster near the start
        // of each dictionary and the sorted pass walks far fewer blocks.
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
            out.push((row, count));
        }
        out
    }
}

/// Resolve a set of segment-local term ordinals to strings in a single sorted forward pass
/// over the term dictionary.
///
/// `Dictionary::ord_to_term` re-opens and re-scans a block from its first ordinal on every
/// call, so resolving K ordinals one-by-one (in arbitrary order) is `O(K * block_size)`.
/// `sorted_ords_to_term_cb` opens each block once and walks forward, which is what makes bulk
/// resolution cheap — and what Tantivy's own terms aggregation relies on.
fn resolve_ords(col: &StrColumn, mut ords: Vec<u64>) -> HashMap<u64, String> {
    ords.sort_unstable();
    ords.dedup();
    let mut strings: Vec<String> = Vec::with_capacity(ords.len());
    // the callback is invoked once per input ordinal in order, so `strings[i]` pairs with
    // `ords[i]`; on error only the unresolved tail is dropped (zip stops at the shorter side)
    if let Err(e) = col
        .dictionary()
        .sorted_ords_to_term_cb(ords.iter().copied(), |bytes| {
            strings.push(String::from_utf8_lossy(bytes).into_owned());
            Ok(())
        })
    {
        log::warn!(
            "search->tantivy: topn failed to resolve {} of {} term ordinals: {e}",
            ords.len() - strings.len(),
            ords.len()
        );
    }
    ords.into_iter().zip(strings).collect()
}

/// Keep only the top-K entries by count, in place. `ascend` selects the K smallest counts
/// (ORDER BY count ASC), otherwise the K largest (ORDER BY count DESC). Count ties are broken
/// toward the smaller key, which keeps survivors clustered by ordinal for cheaper resolution;
/// this is valid because SQL leaves tie order unspecified and DataFusion applies the final sort.
fn truncate_top_k<K: Ord>(items: &mut Vec<(K, u64)>, k: usize, ascend: bool) {
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
        writer.commit().unwrap();
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
        let search = |fields: &[&str], k: usize, ascend: bool| {
            let fields: Vec<String> = fields.iter().map(|s| s.to_string()).collect();
            let mut res = if fields.len() <= 2 {
                searcher
                    .search(&AllQuery, &TopNCollector::<u64>::new(fields, k, ascend))
                    .unwrap()
            } else {
                searcher
                    .search(&AllQuery, &TopNCollector::<u128>::new(fields, k, ascend))
                    .unwrap()
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

        // single field via the u64 key (doc with missing f1 still counts for f0)
        assert_eq!(
            search(&["f0"], 10, false),
            vec![row(&["a"], 5), row(&["b"], 1), row(&["c"], 1)]
        );

        // two fields, counts merged across segments, missing-field doc excluded
        assert_eq!(
            search(&["f0", "f1"], 10, false),
            vec![
                row(&["a", "x"], 3),
                row(&["a", "y"], 2),
                row(&["b", "x"], 1)
            ]
        );
        // ascend keeps the smallest counts
        assert_eq!(search(&["f0", "f1"], 10, true)[0], row(&["b", "x"], 1));
        // k truncates per merge result
        assert_eq!(search(&["f0", "f1"], 1, false), vec![row(&["a", "x"], 3)]);

        // three fields via the u128 key
        assert_eq!(
            search(&["f0", "f1", "f2"], 10, false),
            vec![
                row(&["a", "x", "1"], 3),
                row(&["a", "y", "1"], 1),
                row(&["a", "y", "2"], 1),
                row(&["b", "x", "1"], 1)
            ]
        );
    }

    #[test]
    fn test_truncate_top_k() {
        let mk = || vec![("a", 5u64), ("b", 1), ("c", 9), ("d", 3), ("e", 7)];

        // keep K largest counts (ORDER BY count DESC)
        let mut desc = mk();
        truncate_top_k(&mut desc, 2, false);
        let mut got: Vec<u64> = desc.iter().map(|(_, c)| *c).collect();
        got.sort_unstable();
        assert_eq!(got, vec![7, 9]);

        // keep K smallest counts (ORDER BY count ASC)
        let mut asc = mk();
        truncate_top_k(&mut asc, 2, true);
        let mut got: Vec<u64> = asc.iter().map(|(_, c)| *c).collect();
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
