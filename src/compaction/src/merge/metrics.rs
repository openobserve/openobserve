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

//! How the compactor batches a metrics-index hour: the open hour's pending files, a closed
//! hour's pre-merge while it exceeds the merge-group cap, and the scope of its indexed merge.

use std::sync::Arc;

use arrow_schema::Schema;
use config::meta::stream::FileKey;
use metrics_index::MetricsFileLayout;
use search::merge::{MergeMode, hash_merged_chains};

use super::plan::{BatchLimits, PlannedBatch};
use crate::incremental::OPEN_HOUR_MERGE_FILES;

/// Extra indexed files tolerated before rewriting the closed hour.
const METRICS_INDEX_REWRITE_SLACK: usize = 4;

/// What the merge of a closed indexed metrics hour covers.
#[derive(Debug, PartialEq, Eq)]
enum MetricsIndexMergeScope {
    /// Leaves the hour unchanged when indexed-file fragmentation is within the size target.
    Skip,
    /// Merge only the late, non-indexed files into one new indexed file;
    /// existing indexed files stay. Their hash ranges may overlap, which
    /// readers handle per file.
    LateFilesOnly,
    /// Too many indexed files: rewrite the whole hour. Reached by late
    /// merges piling up fragments (amortizes their full-rewrite cost) or by
    /// a raised `max_file_size` shrinking the ideal count (such hours are
    /// re-enqueued by the old-data sweep).
    WholeHour,
}

/// The open hour's round: its pending ingester files merge into hash-merged output.
pub(super) fn open_hour_batches(files: &[FileKey], max_groups: usize) -> Vec<PlannedBatch> {
    ingester_batches(files, OPEN_HOUR_MERGE_FILES, max_groups)
        .into_iter()
        .map(|pending| (pending, MergeMode::MetricsHashMerged))
        .collect()
}

/// The closed hour: a pre-merge while it exceeds the merge-group cap, else the indexed merge.
pub(super) async fn closed_hour_batches(
    files: Vec<FileKey>,
    limits: &BatchLimits<'_>,
    schema: &Arc<Schema>,
    stream: &str,
) -> Vec<PlannedBatch> {
    let files = indexed_hour_scope(files, limits.max_file_size, stream);
    let max_groups = limits.max_merge_groups;
    // fewer files than the cap cannot form more groups than it: no footer is read
    let pre_merge = if max_groups > 0 && files.len() > max_groups {
        let chains = hash_merged_chains(schema.clone(), &files, stream).await;
        pre_merge_batches(&files, chains, max_groups)
    } else {
        Vec::new()
    };
    if !pre_merge.is_empty() {
        log::info!(
            "[COMPACTOR] merge_by_stream [{stream}] metrics_indexed merge of {} files exceeds {max_groups} merge groups, pre-merging in {} hash-merged batches first",
            files.len(),
            pre_merge.len()
        );
        return pre_merge
            .into_iter()
            .map(|group| (group, MergeMode::MetricsHashMerged))
            .collect();
    }
    if files.is_empty() {
        return Vec::new();
    }
    vec![(files, MergeMode::MetricsIndexed)]
}

/// What a closed indexed metrics hour merges, see [`MetricsIndexMergeScope`].
fn indexed_hour_scope(mut files: Vec<FileKey>, max_file_size: usize, stream: &str) -> Vec<FileKey> {
    match metrics_index_merge_scope(&files, max_file_size) {
        MetricsIndexMergeScope::Skip => Vec::new(),
        MetricsIndexMergeScope::LateFilesOnly => {
            files.retain(|f| MetricsFileLayout::of(&f.key) != Some(MetricsFileLayout::Indexed));
            log::debug!(
                "[COMPACTOR] merge_by_stream [{stream}] metrics_indexed late merge of {} files, indexed files untouched",
                files.len()
            );
            files
        }
        MetricsIndexMergeScope::WholeHour => {
            log::debug!(
                "[COMPACTOR] merge_by_stream [{stream}] metrics_indexed fragmentation cap hit, full rewrite of {} files",
                files.len()
            );
            files
        }
    }
}

/// Hash-merged batches a closed hour runs first when it holds more merge groups than `max_groups`.
fn pre_merge_batches(
    files: &[FileKey],
    hash_merged_chains: Option<Vec<Vec<FileKey>>>,
    max_groups: usize,
) -> Vec<Vec<FileKey>> {
    let Some(chains) = hash_merged_chains else {
        // chains of unknown width are never rewritten: only fewer ingester files surely shrink it
        return ingester_batches(files, max_groups + 1, max_groups);
    };
    let mut groups: Vec<Vec<FileKey>> = files
        .iter()
        .filter(|f| MetricsFileLayout::of(&f.key) == Some(MetricsFileLayout::HashSorted))
        .map(|f| vec![f.clone()])
        .collect();
    groups.extend(chains);
    let has_indexed = files
        .iter()
        .any(|f| MetricsFileLayout::of(&f.key) == Some(MetricsFileLayout::Indexed));
    // indexed files are never pre-merged; the scan spreads even one chain over two groups
    let indexed_groups = if has_indexed { 2 } else { 0 };
    if groups.len() + indexed_groups <= max_groups {
        return Vec::new();
    }
    // smallest first: the most groups collapse for the fewest bytes rewritten
    groups.sort_by_key(|group| group.iter().map(|f| f.meta.compressed_size).sum::<i64>());
    groups
        .chunks(max_groups)
        .filter(|chunk| chunk.len() > 1)
        .map(|chunk| chunk.concat())
        .collect()
}

/// The hash-sorted files, once `min_files` piled up, in batches of at most `max_groups`.
fn ingester_batches(files: &[FileKey], min_files: usize, max_groups: usize) -> Vec<Vec<FileKey>> {
    let pending: Vec<FileKey> = files
        .iter()
        .filter(|f| MetricsFileLayout::of(&f.key) == Some(MetricsFileLayout::HashSorted))
        .cloned()
        .collect();
    if pending.len() < min_files {
        return Vec::new();
    }
    if max_groups == 0 {
        return vec![pending];
    }
    // a lone trailing file has nothing to merge with and waits for the next round
    pending
        .chunks(max_groups)
        .filter(|chunk| chunk.len() > 1)
        .map(<[FileKey]>::to_vec)
        .collect()
}

fn metrics_index_merge_scope(files: &[FileKey], max_file_size: usize) -> MetricsIndexMergeScope {
    let indexed_files = files
        .iter()
        .filter(|f| MetricsFileLayout::of(&f.key) == Some(MetricsFileLayout::Indexed))
        .count();
    let total_original_size: i64 = files.iter().map(|f| f.meta.original_size.max(0)).sum();
    let ideal_file_count = (total_original_size as usize).div_ceil(max_file_size.max(1));
    if indexed_files > ideal_file_count + METRICS_INDEX_REWRITE_SLACK {
        MetricsIndexMergeScope::WholeHour
    } else if indexed_files == files.len() {
        MetricsIndexMergeScope::Skip
    } else {
        MetricsIndexMergeScope::LateFilesOnly
    }
}

#[cfg(test)]
mod tests {
    use config::meta::stream::FileMeta;

    use super::*;

    fn file_key(name: &str, original_size: i64) -> FileKey {
        let mut key = FileKey::from_file_name(&format!("files/o/metrics/m/2026/08/18/10/{name}"));
        key.meta = FileMeta {
            min_ts: 10,
            max_ts: 20,
            records: 100,
            original_size,
            ..Default::default()
        };
        key
    }

    #[test]
    fn test_metrics_index_merge_scope() {
        let max_file_size = 100_usize;
        let indexed = |id: usize| file_key(&format!("indexed-v1-{id}.parquet"), 10);
        let late = |id: usize| file_key(&format!("hash-sorted-v1-{id}.parquet"), 10);

        // every file indexed and acceptably sized: the hour is left alone
        assert_eq!(
            metrics_index_merge_scope(&[indexed(1), indexed(2)], max_file_size),
            MetricsIndexMergeScope::Skip
        );
        // max_file_size raised (files written at a smaller target): a fully indexed
        // hour above the cap is rewritten to the new size, no late data needed
        let raised: Vec<FileKey> = (1..=10).map(indexed).collect();
        assert_eq!(
            metrics_index_merge_scope(&raised, max_file_size),
            MetricsIndexMergeScope::WholeHour
        );
        // same files under the original target (ideal 10): left alone
        assert_eq!(
            metrics_index_merge_scope(&raised, 10),
            MetricsIndexMergeScope::Skip
        );
        // no indexed files yet (first hour-end pass): merge everything
        assert_eq!(
            metrics_index_merge_scope(&[late(1), late(2)], max_file_size),
            MetricsIndexMergeScope::LateFilesOnly
        );
        // few indexed files: only the late ones merge
        assert_eq!(
            metrics_index_merge_scope(
                &[indexed(1), indexed(2), indexed(3), late(4)],
                max_file_size,
            ),
            MetricsIndexMergeScope::LateFilesOnly
        );
        // fragmentation cap: 8 indexed files, total size 90 -> ideal 1,
        // 8 > 1 + METRICS_INDEX_REWRITE_SLACK -> rewrite the whole hour
        let mut fragmented: Vec<FileKey> = (1..=8).map(indexed).collect();
        fragmented.push(late(9));
        assert_eq!(
            metrics_index_merge_scope(&fragmented, max_file_size),
            MetricsIndexMergeScope::WholeHour
        );
        // same file count but a large hour (ideal 9): still a late-only merge
        let mut large: Vec<FileKey> = (1..=8)
            .map(|id| file_key(&format!("indexed-v1-{id}.parquet"), 100))
            .collect();
        large.push(late(9));
        assert_eq!(
            metrics_index_merge_scope(&large, max_file_size),
            MetricsIndexMergeScope::LateFilesOnly
        );
    }

    fn hash_file(name: &str, compressed_size: i64) -> FileKey {
        let mut file = file_key(name, compressed_size * 40);
        file.meta.compressed_size = compressed_size;
        file
    }

    fn ingester_hour(count: usize) -> Vec<FileKey> {
        (1..=count)
            .map(|i| hash_file(&format!("hash-sorted-v1-{i:03}.parquet"), 30))
            .collect()
    }

    fn names(files: &[FileKey]) -> Vec<&str> {
        files
            .iter()
            .map(|f| f.key.rsplit('/').next().unwrap())
            .collect()
    }

    /// Over the cap, ingester files and hash-merged chains merge smallest first in groups of
    /// the cap; the indexed files count as two groups and stay out of every batch.
    #[test]
    fn test_pre_merge_batches_group_smallest_first_over_the_cap() {
        let mut files = ingester_hour(3);
        files.push(hash_file("indexed-v1-d.parquet", 5));
        files.push(hash_file("indexed-v1-e.parquet", 5));
        let chains = vec![
            vec![
                hash_file("hash-merged-v1-a.parquet", 400),
                hash_file("hash-merged-v1-b.parquet", 400),
            ],
            vec![hash_file("hash-merged-v1-c.parquet", 10)],
        ];
        assert!(pre_merge_batches(&files, Some(chains.clone()), 7).is_empty());
        assert!(
            pre_merge_batches(&ingester_hour(3), Some(chains.clone()), 5).is_empty(),
            "five groups without indexed files fit a cap of five"
        );
        assert_eq!(pre_merge_batches(&files, Some(chains.clone()), 6).len(), 1);
        let batches = pre_merge_batches(&files, Some(chains), 4);
        assert_eq!(
            batches.len(),
            1,
            "the lone largest chain waits: {batches:?}"
        );
        assert_eq!(
            names(&batches[0]),
            [
                "hash-merged-v1-c.parquet",
                "hash-sorted-v1-001.parquet",
                "hash-sorted-v1-002.parquet",
                "hash-sorted-v1-003.parquet"
            ]
        );
    }

    /// Without chain statistics only the ingester files pre-merge, and only over the cap.
    #[test]
    fn test_pre_merge_batches_without_chains_take_ingester_files_only() {
        let mut files = ingester_hour(7);
        files.extend((1..=20).map(|i| hash_file(&format!("hash-merged-v1-{i}.parquet"), 400)));
        let batches = pre_merge_batches(&files, None, 3);
        let sizes: Vec<usize> = batches.iter().map(Vec::len).collect();
        assert_eq!(sizes, [3, 3], "the lone 7th file waits");
        assert!(
            batches
                .iter()
                .flatten()
                .all(|f| f.key.contains("/hash-sorted-v1-"))
        );
        assert!(pre_merge_batches(&files, None, 7).is_empty());
    }
}
