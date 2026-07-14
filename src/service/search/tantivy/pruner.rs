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

//! File-list pruning for SimpleSelect (`ORDER BY _timestamp [DESC] LIMIT n`)
//! queries.
//!
//! Each tantivy search returns per-file candidates as `(_timestamp, doc_id)`
//! pairs. The [`SimpleSelectPruner`] collects them across the group loop to
//! stop the search early, then merges them into the exact global top-N so
//! only the winning rows reach the parquet data phase.

use std::sync::Arc;

use config::meta::stream::{FileKey, FileSelection};
use hashbrown::HashMap;

use super::selection_from_row_ids;

/// A file's top-`limit` candidates as `(_timestamp, doc_id)` plus the row
/// group size of its index file.
type FileCandidates = (Arc<Vec<(i64, u32)>>, Option<u32>);

/// Prunes the file list of a SimpleSelect query using the per-file
/// candidates collected from the tantivy index, each carrying the exact
/// `_timestamp` of the matched row.
///
/// Only candidates obtained without skipped conditions are recorded: every
/// candidate row survives any filter DataFusion re-applies, so the merged
/// global top-N among them is exact.
pub struct SimpleSelectPruner {
    limit: usize,
    ascend: bool,
    /// time bound covering every file in groups `i..`: the newest `max_ts`
    /// for descending order, the oldest `min_ts` for ascending order
    group_suffix_bounds: Vec<i64>,
    /// per-file top-`limit` exact candidates as `(_timestamp, doc_id)`,
    /// with the row group size of the index file
    candidates: HashMap<String, FileCandidates>,
}

impl SimpleSelectPruner {
    pub fn new(limit: usize, ascend: bool, file_groups: &[Vec<FileKey>]) -> Self {
        // tantivy's TopDocs panics on a zero limit
        debug_assert!(limit > 0, "SimpleSelect always carries a positive limit");
        Self {
            limit,
            ascend,
            group_suffix_bounds: group_suffix_bounds(file_groups, ascend),
            candidates: HashMap::new(),
        }
    }

    /// Record a file's exact candidates; its selection is deferred until the
    /// global top-N merge in [`Self::finalize`].
    pub fn record_candidates(
        &mut self,
        file_name: String,
        candidates: Arc<Vec<(i64, u32)>>,
        row_group_size: Option<u32>,
    ) {
        debug_assert!(
            candidates.is_sorted_by(|a, b| if self.ascend { a.0 <= b.0 } else { a.0 >= b.0 }),
            "candidates must be timestamp-ordered best-first"
        );
        self.candidates
            .insert(file_name, (candidates, row_group_size));
    }

    /// Whether the groups after `group_id` can be dropped: at least `limit`
    /// candidate rows are guaranteed to sort before every row of the
    /// remaining groups.
    pub fn should_prune_remaining_groups(&self, trace_id: &str, group_id: usize) -> bool {
        // out of range for the last group: nothing remains to prune
        let Some(&bound) = self.group_suffix_bounds.get(group_id + 1) else {
            return false;
        };
        // each file's candidates are timestamp-ordered best-first, so the
        // rows strictly beyond the bound form a prefix
        let beyond_bound =
            |&(ts, _): &(i64, u32)| if self.ascend { ts < bound } else { ts > bound };
        let guaranteed: usize = self
            .candidates
            .values()
            .map(|(candidates, _)| candidates.partition_point(beyond_bound))
            .sum();
        if guaranteed < self.limit {
            return false;
        }
        log::info!(
            "[trace_id {trace_id}] search->tantivy: simple select limit {} satisfied by {guaranteed} matches before remaining groups, prune after group {group_id}",
            self.limit,
        );
        true
    }

    /// Merge the per-file candidates into the exact global top-N and shrink
    /// the file list to it: files with candidates keep a selection over
    /// their winning rows (or are removed if none win), and with a full
    /// winner set, files without candidates are removed when their whole
    /// time range sorts strictly after the weakest winner.
    pub fn finalize(&mut self, trace_id: &str, file_list_map: &mut HashMap<String, FileKey>) {
        let mut candidates = std::mem::take(&mut self.candidates);
        // files can disappear from the list before the merge (e.g. groups
        // dropped after an early stop)
        candidates.retain(|key, _| file_list_map.contains_key(key));
        if candidates.is_empty() {
            return;
        }
        let before_num = file_list_map.len();

        // global merge: the top-`limit` candidate rows across all files;
        // the winners only need to be selected, never sorted
        let mut merged: Vec<(i64, &String, u32)> = candidates
            .iter()
            .flat_map(|(key, (candidates, _))| {
                candidates
                    .iter()
                    .map(move |&(ts, doc_id)| (ts, key, doc_id))
            })
            .collect();
        if merged.len() > self.limit {
            if self.ascend {
                merged.select_nth_unstable_by_key(self.limit - 1, |&(ts, ..)| ts);
            } else {
                merged
                    .select_nth_unstable_by_key(self.limit - 1, |&(ts, ..)| std::cmp::Reverse(ts));
            }
            merged.truncate(self.limit);
        }
        let rows_selected = merged.len();

        // group the winning doc ids per file
        let mut winners: HashMap<&String, Vec<u32>> = HashMap::new();
        for &(_, key, doc_id) in &merged {
            winners.entry(key).or_default().push(doc_id);
        }
        for (key, (_, row_group_size)) in &candidates {
            let Some(doc_ids) = winners.get(key) else {
                // exact candidates but no winning row: the file cannot
                // contribute to the top-N
                file_list_map.remove(key);
                continue;
            };
            let file = file_list_map
                .get_mut(key)
                .expect("candidate files were retained above");
            let row_ids =
                selection_from_row_ids(file.meta.records as usize, doc_ids.iter().copied());
            file.with_selection(FileSelection::Rows(Arc::new(row_ids)), *row_group_size);
        }

        // with a full winner set, drop the files without candidates that
        // sort entirely after the weakest winner
        if merged.len() == self.limit {
            let timestamps = merged.iter().map(|&(ts, ..)| ts);
            let weakest_ts = if self.ascend {
                timestamps.max()
            } else {
                timestamps.min()
            }
            .expect("checked non-empty");
            file_list_map.retain(|key, f| {
                candidates.contains_key(key)
                    || if self.ascend {
                        f.meta.min_ts <= weakest_ts
                    } else {
                        f.meta.max_ts >= weakest_ts
                    }
            });
        }

        let files_pruned = before_num - file_list_map.len();
        if files_pruned > 0 || rows_selected > 0 {
            log::info!(
                "[trace_id {trace_id}] search->tantivy: simple select limit {} merged top-N, selected {rows_selected} rows, pruned {files_pruned} files, {} files left",
                self.limit,
                file_list_map.len(),
            );
        }
    }
}

/// For each group `i`, the time bound covering every file in groups `i..`.
/// A candidate outranks every row of the remaining groups iff it lies
/// strictly beyond this bound.
///
/// The suffix fold covers the case where a later group holds a file that
/// sorts beyond every file of the next group.
fn group_suffix_bounds(file_groups: &[Vec<FileKey>], ascend: bool) -> Vec<i64> {
    let mut bounds: Vec<i64> = file_groups
        .iter()
        .map(|group| {
            if ascend {
                group
                    .iter()
                    .map(|f| f.meta.min_ts)
                    .min()
                    .unwrap_or(i64::MAX)
            } else {
                group
                    .iter()
                    .map(|f| f.meta.max_ts)
                    .max()
                    .unwrap_or(i64::MIN)
            }
        })
        .collect();
    for i in (0..bounds.len().saturating_sub(1)).rev() {
        bounds[i] = if ascend {
            bounds[i].min(bounds[i + 1])
        } else {
            bounds[i].max(bounds[i + 1])
        };
    }
    bounds
}

#[cfg(test)]
mod tests {
    use config::meta::stream::FileMeta;
    use itertools::Itertools;

    use super::*;

    fn create_file_key(min_ts: i64, max_ts: i64) -> FileKey {
        FileKey {
            key: format!("file_{min_ts}_{max_ts}"),
            meta: FileMeta {
                min_ts,
                max_ts,
                records: 1000,
                ..Default::default()
            },
            ..Default::default()
        }
    }

    fn build_file_map(files: Vec<FileKey>) -> HashMap<String, FileKey> {
        files.into_iter().map(|f| (f.key.clone(), f)).collect()
    }

    fn sorted_keys(map: &HashMap<String, FileKey>) -> Vec<String> {
        map.keys().cloned().sorted().collect()
    }

    fn make_pruner(
        limit: usize,
        ascend: bool,
        candidates: &[(&str, &[(i64, u32)])],
    ) -> SimpleSelectPruner {
        make_pruner_with_bounds(limit, ascend, vec![], candidates)
    }

    fn make_pruner_with_bounds(
        limit: usize,
        ascend: bool,
        group_suffix_bounds: Vec<i64>,
        candidates: &[(&str, &[(i64, u32)])],
    ) -> SimpleSelectPruner {
        let mut pruner = SimpleSelectPruner {
            limit,
            ascend,
            group_suffix_bounds,
            candidates: HashMap::new(),
        };
        for (key, rows) in candidates {
            pruner.record_candidates(key.to_string(), Arc::new(rows.to_vec()), Some(1024));
        }
        pruner
    }

    fn selected_rows(file: &FileKey) -> Vec<usize> {
        match file.selection.as_ref().expect("selection should be set") {
            FileSelection::Rows(bitmap) => bitmap.set_indices().collect(),
            other => panic!("expected a Rows selection, got {other:?}"),
        }
    }

    #[test]
    fn test_new() {
        let groups = vec![vec![create_file_key(1, 10)]];
        let pruner = SimpleSelectPruner::new(10, false, &groups);
        assert_eq!(pruner.limit, 10);
        assert_eq!(pruner.group_suffix_bounds, vec![10]);
    }

    #[test]
    fn test_finalize_desc_merges_global_top_n() {
        let mut files = build_file_map(vec![
            create_file_key(91, 100),
            create_file_key(81, 90),
            create_file_key(1, 80),
        ]);
        let mut pruner = make_pruner(
            3,
            false,
            &[
                ("file_91_100", &[(100, 10), (99, 11), (95, 12)]),
                ("file_81_90", &[(98, 20), (90, 21)]),
                ("file_1_80", &[(70, 30)]),
            ],
        );
        pruner.finalize("test", &mut files);
        // global top-3 by ts desc: 100, 99 (file_91_100) and 98 (file_81_90)
        assert_eq!(
            sorted_keys(&files),
            vec!["file_81_90".to_string(), "file_91_100".to_string()]
        );
        // the selections shrink to the winning rows only
        assert_eq!(selected_rows(&files["file_91_100"]), vec![10, 11]);
        assert_eq!(selected_rows(&files["file_81_90"]), vec![20]);
        assert_eq!(files["file_91_100"].row_group_size, Some(1024));
    }

    #[test]
    fn test_finalize_desc_prunes_time_dominated_files_without_candidates() {
        // file_1_50 has no exact candidates (no index) but its whole time
        // range sorts after the weakest winner (ts 99); file_80_99 touches
        // the weakest winner's timestamp and must be kept
        let mut files = build_file_map(vec![
            create_file_key(91, 100),
            create_file_key(80, 99),
            create_file_key(1, 50),
        ]);
        let mut pruner = make_pruner(2, false, &[("file_91_100", &[(100, 0), (99, 1)])]);
        pruner.finalize("test", &mut files);
        assert_eq!(
            sorted_keys(&files),
            vec!["file_80_99".to_string(), "file_91_100".to_string()]
        );
        assert_eq!(selected_rows(&files["file_91_100"]), vec![0, 1]);
    }

    #[test]
    fn test_finalize_partial_winner_set_keeps_files_without_candidates() {
        // fewer candidates than the limit: no weakest-winner threshold, so
        // the file without candidates survives no matter how old it is
        let mut files = build_file_map(vec![create_file_key(91, 100), create_file_key(1, 10)]);
        let mut pruner = make_pruner(10, false, &[("file_91_100", &[(100, 0), (99, 1)])]);
        pruner.finalize("test", &mut files);
        assert_eq!(files.len(), 2);
        assert_eq!(selected_rows(&files["file_91_100"]), vec![0, 1]);
    }

    #[test]
    fn test_finalize_asc_merges_and_prunes() {
        let mut files = build_file_map(vec![
            create_file_key(1, 10),
            create_file_key(11, 20),
            create_file_key(30, 40),
        ]);
        let mut pruner = make_pruner(
            2,
            true,
            &[("file_1_10", &[(1, 0), (2, 1)]), ("file_11_20", &[(11, 5)])],
        );
        pruner.finalize("test", &mut files);
        // global top-2 by ts asc: 1, 2 — both in file_1_10; file_11_20 loses
        // and file_30_40 (no candidates) starts after the weakest winner (2)
        assert_eq!(sorted_keys(&files), vec!["file_1_10".to_string()]);
        assert_eq!(selected_rows(&files["file_1_10"]), vec![0, 1]);
    }

    #[test]
    fn test_finalize_ignores_candidates_of_removed_files() {
        // candidates of a file no longer in the list (e.g. dropped with the
        // groups after an early prune) must not influence the merge
        let mut files = build_file_map(vec![create_file_key(91, 100)]);
        let mut pruner = make_pruner(
            1,
            false,
            &[("file_gone", &[(200, 0)]), ("file_91_100", &[(100, 7)])],
        );
        pruner.finalize("test", &mut files);
        assert_eq!(selected_rows(&files["file_91_100"]), vec![7]);
    }

    #[test]
    fn test_finalize_without_candidates_is_noop() {
        let mut files = build_file_map(vec![create_file_key(91, 100), create_file_key(1, 80)]);
        let mut pruner = make_pruner(10, false, &[]);
        pruner.finalize("test", &mut files);
        assert_eq!(files.len(), 2);
        assert!(files.values().all(|f| f.selection.is_none()));
    }

    #[test]
    fn test_should_prune_remaining_groups_uses_candidate_timestamps() {
        // the file spans 50..100 but its candidates carry exact timestamps,
        // so hits inside a file that overlaps the remaining bound still count
        let pruner = make_pruner_with_bounds(
            3,
            false,
            vec![100, 90, 80],
            &[("file_50_100", &[(99, 0), (95, 1), (91, 2)])],
        );
        // all 3 candidate timestamps sort strictly after the bound 90
        assert!(pruner.should_prune_remaining_groups("test", 0));
        assert!(pruner.should_prune_remaining_groups("test", 1));
        // last group: nothing remains, no prune signal needed
        assert!(!pruner.should_prune_remaining_groups("test", 2));
    }

    #[test]
    fn test_should_prune_remaining_groups_boundary_ties_do_not_count() {
        // ts == bound is not strictly newer: only ts 99 counts against the
        // bound 95, so 1 < limit 2 and the search must continue
        let pruner = make_pruner_with_bounds(
            2,
            false,
            vec![100, 95],
            &[("file_50_100", &[(99, 0), (95, 1), (91, 2)])],
        );
        assert!(!pruner.should_prune_remaining_groups("test", 0));
    }

    #[test]
    fn test_should_prune_remaining_groups_asc() {
        let pruner = make_pruner_with_bounds(
            2,
            true,
            vec![1, 10, 30],
            &[("file_1_20", &[(1, 0), (5, 1), (12, 2)])],
        );
        // candidates at ts 1 and 5 sort strictly before the bound 10
        assert!(pruner.should_prune_remaining_groups("test", 0));
    }

    #[test]
    fn test_record_candidates_defers_selection() {
        let files = build_file_map(vec![create_file_key(1, 10)]);
        let mut pruner = make_pruner(5, false, &[]);
        pruner.record_candidates("file_1_10".to_string(), Arc::new(vec![(9, 3)]), Some(1024));
        // deferred: recorded on the pruner, no selection built yet
        assert!(files["file_1_10"].selection.is_none());
        assert!(pruner.candidates.contains_key("file_1_10"));
    }
}
