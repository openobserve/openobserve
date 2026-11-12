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

//! Open hour of a metrics-index stream: the pending ingester files become hash-merged files,
//! which the closed-hour rule takes once more.

use config::meta::stream::FileKey;
use metrics_index::MetricsFileLayout;
use search::merge::MergeMode;

use super::{
    BatchLimits, PlannedBatch, RoundPlan, legacy_batches, mergeable_chunks, split_legacy_metrics,
};
use crate::incremental::OPEN_HOUR_MERGE_FILES;

/// The pending ingester files merge whatever their size.
pub(super) const READS_WHOLE_WINDOW: bool = true;

pub(super) fn plan(files: Vec<FileKey>, limits: &BatchLimits<'_>) -> RoundPlan {
    let (files, legacy_files) = split_legacy_metrics(files);
    let mut batches = legacy_batches(legacy_files, limits);
    batches.extend(pending_batches(&files, limits));
    RoundPlan::last(batches)
}

/// The pending ingester files, once enough piled up, in batches of at most the merge-group cap.
fn pending_batches(files: &[FileKey], limits: &BatchLimits<'_>) -> Vec<PlannedBatch> {
    let pending: Vec<FileKey> = files
        .iter()
        .filter(|f| MetricsFileLayout::of(&f.key) == Some(MetricsFileLayout::HashSorted))
        .cloned()
        .collect();
    // too few pending files: wait for more flushes before rewriting them
    if pending.len() < OPEN_HOUR_MERGE_FILES {
        return Vec::new();
    }
    mergeable_chunks(pending, limits.max_merge_groups)
        .into_iter()
        .map(|pending| (pending, MergeMode::MetricsHashMerged))
        .collect()
}

#[cfg(test)]
mod tests {
    use config::meta::stream::MergeStrategy;

    use super::{
        super::{MergePolicy, tests::*},
        *,
    };

    /// In the still-open hour the legacy files keep the incremental rules:
    /// a full group is sealed, the remainder waits, and the hash files never
    /// join it.
    #[tokio::test]
    async fn test_plan_batches_incremental_legacy_group_seals_only_full_groups() {
        let mut files: Vec<FileKey> = (1..=4)
            .map(|i| metrics_file(&format!("{i}.parquet"), 300))
            .collect();
        files.push(metrics_file("hash-sorted-v1-5.parquet", 300));
        files.push(metrics_file("hash-sorted-v1-6.parquet", 300));
        let batches = MergePolicy::MetricsOpenHour
            .plan(
                files,
                &limits(&MergeStrategy::FileTime, 0, true),
                &schema(),
                "test",
            )
            .await
            .batches;
        assert_eq!(batches.len(), 1, "{batches:?}");
        let (legacy, mode) = &batches[0];
        assert!(matches!(mode, MergeMode::Classic), "{mode}");
        assert_eq!(names(legacy), ["1.parquet", "2.parquet", "3.parquet"]);
    }

    /// The open metrics-index hour merges every pending ingester file once enough have piled
    /// up; earlier round outputs and legacy files stay out of that batch.
    #[tokio::test]
    async fn test_plan_batches_open_metrics_hour_merges_pending_files() {
        let mut files: Vec<FileKey> = (1..=OPEN_HOUR_MERGE_FILES)
            .map(|i| hash_file(&format!("hash-sorted-v1-{i:02}.parquet"), 30))
            .collect();
        files.push(hash_file("hash-merged-v1-round1.parquet", 400));
        files.push(metrics_file("legacy.parquet", 100));
        let strategy = MergeStrategy::FileTime;
        let limits = limits(&strategy, 0, true);
        let batches = MergePolicy::MetricsOpenHour
            .plan(files.clone(), &limits, &schema(), "s")
            .await
            .batches;
        assert_eq!(batches.len(), 1, "{batches:?}");
        assert!(
            matches!(batches[0].1, MergeMode::MetricsHashMerged),
            "{}",
            batches[0].1
        );
        assert_eq!(batches[0].0.len(), OPEN_HOUR_MERGE_FILES);
        assert!(
            batches[0]
                .0
                .iter()
                .all(|f| f.key.contains("/hash-sorted-v1-"))
        );
        files.retain(|f| !f.key.ends_with("hash-sorted-v1-01.parquet"));
        assert!(
            MergePolicy::MetricsOpenHour
                .plan(files, &limits, &schema(), "s")
                .await
                .batches
                .is_empty(),
            "fewer pending files than the minimum wait for more"
        );
    }
}
