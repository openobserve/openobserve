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

//! What the compactor merges in a closed indexed metrics hour: nothing when
//! every file is indexed, the late files alone while fragmentation is low,
//! else the whole hour.

use std::sync::Arc;

use arrow_schema::Schema;
use config::meta::stream::FileKey;
use metrics_index::MetricsFileLayout;
use search::merge::{MergeMode, hash_ordered_chains};

use super::plan::{PlannedBatch, mergeable_chunks};

/// Extra indexed files tolerated before rewriting the closed hour.
const METRICS_INDEX_REWRITE_SLACK: usize = 4;

/// What the merge of a closed indexed metrics hour covers.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum MetricsIndexMergeScope {
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

pub(super) fn metrics_index_merge_scope(
    files: &[FileKey],
    max_file_size: usize,
) -> MetricsIndexMergeScope {
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

/// Hash-merged batches a closed hour runs before its indexed merge while it exceeds the cap.
pub(super) async fn pre_merge_batches(
    files: &[FileKey],
    max_groups: usize,
    schema: &Arc<Schema>,
    stream: &str,
) -> Vec<PlannedBatch> {
    // fewer files than the cap cannot form more groups than it: no footer is read
    if max_groups == 0 || files.len() <= max_groups {
        return Vec::new();
    }

    let mut ingester = Vec::new();
    let mut hash_merged = Vec::new();
    let mut indexed_groups = 0;
    for file in files {
        match MetricsFileLayout::of(&file.key) {
            Some(MetricsFileLayout::HashSorted) => ingester.push(file.clone()),
            Some(MetricsFileLayout::HashMerged) => hash_merged.push(file.clone()),
            // indexed files are never pre-merged; the scan spreads even one chain over two groups
            Some(MetricsFileLayout::Indexed) => indexed_groups = 2,
            None => {}
        }
    }

    let chains = hash_ordered_chains(schema.clone(), hash_merged, stream).await;
    let groups = split_into_pre_merge_groups(ingester, chains, indexed_groups, max_groups);
    if !groups.is_empty() {
        log::info!(
            "[COMPACTOR] merge_by_stream [{stream}] metrics_indexed merge of {} files exceeds {max_groups} merge groups, pre-merging in {} hash-merged batches first",
            files.len(),
            groups.len()
        );
    }

    groups
        .into_iter()
        .map(|group| (group, MergeMode::MetricsHashMerged))
        .collect()
}

/// The groups to pre-merge, empty while the hour holds at most `max_groups` merge groups.
fn split_into_pre_merge_groups(
    ingester: Vec<FileKey>,
    hash_merged_chains: Option<Vec<Vec<FileKey>>>,
    indexed_groups: usize,
    max_groups: usize,
) -> Vec<Vec<FileKey>> {
    let Some(chains) = hash_merged_chains else {
        // chains of unknown width are never rewritten: only fewer ingester files surely shrink it
        if ingester.len() <= max_groups {
            return Vec::new();
        }
        return mergeable_chunks(ingester, max_groups);
    };

    // every ingester file spans the whole hash range, so each is a group of its own
    let mut groups: Vec<Vec<FileKey>> = ingester.into_iter().map(|file| vec![file]).collect();
    groups.extend(chains);
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

    /// Over the cap the smallest groups merge first and a lone trailing group waits.
    #[test]
    fn test_split_into_pre_merge_groups() {
        let file = |name: &str, compressed_size| {
            let mut file = file_key(name, 0);
            file.meta.compressed_size = compressed_size;
            file
        };
        let ingester = vec![
            file("hash-sorted-v1-1.parquet", 30),
            file("hash-sorted-v1-2.parquet", 30),
        ];
        let chains = vec![
            vec![file("hash-merged-v1-a.parquet", 400)],
            vec![file("hash-merged-v1-b.parquet", 10)],
        ];
        let groups = |indexed_groups, max_groups| {
            split_into_pre_merge_groups(
                ingester.clone(),
                Some(chains.clone()),
                indexed_groups,
                max_groups,
            )
        };
        assert!(groups(0, 4).is_empty(), "four groups fit a cap of four");
        assert_eq!(groups(2, 4).len(), 1, "indexed files add two groups");
        let batches = groups(0, 3);
        let sizes: Vec<Vec<i64>> = batches
            .iter()
            .map(|batch| batch.iter().map(|f| f.meta.compressed_size).collect())
            .collect();
        assert_eq!(sizes, [[10, 30, 30]], "the largest group waits alone");
    }
}
