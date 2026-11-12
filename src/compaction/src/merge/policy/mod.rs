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

//! The merge rules, one file each: which rule a window follows is decided here, what the rule
//! reads and how it batches lives in its own file.

#[cfg(feature = "enterprise")]
mod downsampling;
mod metrics_closed_hour;
mod metrics_open_hour;
mod size_bounded;
#[cfg(test)]
mod test_utils;

use std::sync::Arc;

use arrow_schema::Schema;
#[cfg(feature = "enterprise")]
use config::meta::promql::DownsamplingRule;
use config::meta::stream::{FileKey, MergeStrategy, StreamType};
use metrics_index::{MetricsFileLayout, metrics_index_stream};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::downsampling::get_largest_downsampling_rule;
use search::merge::MergeMode;

/// One planned merge: the files and the mode they merge in.
pub(super) type PlannedBatch = (Vec<FileKey>, MergeMode);

/// The size rules one merge round batches files under.
pub(super) struct BatchLimits<'a> {
    pub strategy: &'a MergeStrategy,
    pub max_file_size: usize,
    pub max_group_files: usize,
    /// The hour is still open: an unfilled trailing group waits for more files.
    pub is_incremental: bool,
    /// The classic merge query's cap: larger files are at their target size.
    pub merge_max_original_size: i64,
    /// Most sorted inputs (merge groups) one metrics merge may open; 0 is no cap.
    pub max_merge_groups: usize,
}

/// What one round merges in a partition of the window.
#[derive(Debug)]
pub(super) struct RoundPlan {
    pub batches: Vec<PlannedBatch>,
    /// These batches only prepare the window: it is planned again once they are committed.
    pub needs_another_round: bool,
}

impl RoundPlan {
    /// A round after which the window is settled.
    fn last(batches: Vec<PlannedBatch>) -> Self {
        Self {
            batches,
            needs_another_round: false,
        }
    }
}

/// The rule one window (an hour or a day of a stream) merges under.
#[derive(Debug, Clone)]
pub(super) enum MergePolicy {
    /// Groups up to the size target, each written in the given mode: logs, traces, plain metrics.
    SizeBounded(MergeMode),
    /// Open hour of a metrics-index stream: the pending ingester files become hash-merged files.
    MetricsOpenHour,
    /// Closed hour of a metrics-index stream: indexed files, after pre-merges while over the cap.
    MetricsClosedHour,
    /// Closed metrics window under a downsampling rule: every file in one batch.
    #[cfg(feature = "enterprise")]
    Downsampling(DownsamplingRule),
}

impl MergePolicy {
    /// The rule for the window of `stream_name` that ends at `range_end_ts`, `closed` once settled.
    pub(super) fn select(
        stream_type: StreamType,
        stream_name: &str,
        schema: &Schema,
        _range_end_ts: i64,
        closed: bool,
    ) -> Self {
        #[cfg(feature = "enterprise")]
        if closed
            && stream_type == StreamType::Metrics
            && let Some(rule) = get_largest_downsampling_rule(stream_name, _range_end_ts)
        {
            return Self::Downsampling(rule.clone());
        }
        if metrics_index_stream(stream_type, schema) {
            return if closed {
                Self::MetricsClosedHour
            } else {
                Self::MetricsOpenHour
            };
        }
        Self::SizeBounded(MergeMode::for_stream(stream_type, stream_name))
    }

    /// True when the rule plans over every file of the window, those at the size target included.
    pub(super) fn reads_whole_window(&self) -> bool {
        match self {
            Self::SizeBounded(_) => size_bounded::READS_WHOLE_WINDOW,
            Self::MetricsOpenHour => metrics_open_hour::READS_WHOLE_WINDOW,
            Self::MetricsClosedHour => metrics_closed_hour::READS_WHOLE_WINDOW,
            #[cfg(feature = "enterprise")]
            Self::Downsampling(_) => downsampling::READS_WHOLE_WINDOW,
        }
    }

    /// The batches one partition's `files` merge in this round.
    pub(super) async fn plan(
        &self,
        files: Vec<FileKey>,
        limits: &BatchLimits<'_>,
        schema: &Arc<Schema>,
        stream: &str,
    ) -> RoundPlan {
        let mut plan = match self {
            Self::SizeBounded(mode) => size_bounded::plan(&files, limits, mode),
            Self::MetricsOpenHour => metrics_open_hour::plan(files, limits),
            Self::MetricsClosedHour => {
                metrics_closed_hour::plan(files, limits, schema, stream).await
            }
            #[cfg(feature = "enterprise")]
            Self::Downsampling(rule) => downsampling::plan(files, rule),
        };
        // a rule may plan a batch of no files: nothing to merge
        plan.batches.retain(|(files, _)| !files.is_empty());
        plan
    }
}

/// Legacy metrics files never join a hash-ordered batch: sorting them would
/// be a full sort of the hour. Returns `(hash-ordered files, legacy files)`.
fn split_legacy_metrics(files: Vec<FileKey>) -> (Vec<FileKey>, Vec<FileKey>) {
    files
        .into_iter()
        .partition(|f| MetricsFileLayout::is_hash_ordered(&f.key))
}

/// The classic size-bounded merges the legacy files of a metrics-index hour keep.
fn legacy_batches(mut files: Vec<FileKey>, limits: &BatchLimits<'_>) -> Vec<PlannedBatch> {
    // a whole-hour query lists every file; the classic merge never rewrites the full-sized ones
    files.retain(|f| f.meta.original_size <= limits.merge_max_original_size);
    size_bounded::batches(&files, limits, &MergeMode::Classic)
}

/// `files` in chunks of at most `max_files` (0: one chunk); a lone trailing file is left out.
fn mergeable_chunks(files: Vec<FileKey>, max_files: usize) -> Vec<Vec<FileKey>> {
    if max_files == 0 {
        return vec![files];
    }
    // a lone trailing file has nothing to merge with and waits for the next round
    files
        .chunks(max_files)
        .filter(|chunk| chunk.len() > 1)
        .map(<[FileKey]>::to_vec)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_select_policy_by_stream_and_window_state() {
        let plain = Schema::empty();
        let hashed = Schema::new(vec![arrow_schema::Field::new(
            config::meta::promql::HASH_LABEL,
            arrow_schema::DataType::UInt64,
            false,
        )]);
        let select = |stream_type, name, schema, closed| {
            MergePolicy::select(stream_type, name, schema, 0, closed)
        };
        assert!(matches!(
            select(StreamType::Traces, "app", &plain, true),
            MergePolicy::SizeBounded(MergeMode::Classic)
        ));
        assert!(matches!(
            select(StreamType::Filelist, "x", &plain, false),
            MergePolicy::SizeBounded(MergeMode::FileList)
        ));
        assert!(matches!(
            select(StreamType::Metrics, "cpu", &plain, true),
            MergePolicy::SizeBounded(MergeMode::Classic)
        ));
        assert!(matches!(
            select(StreamType::Metrics, "cpu", &hashed, false),
            MergePolicy::MetricsOpenHour
        ));
        assert!(matches!(
            select(StreamType::Metrics, "cpu", &hashed, true),
            MergePolicy::MetricsClosedHour
        ));
        assert!(!MergePolicy::SizeBounded(MergeMode::Classic).reads_whole_window());
        assert!(MergePolicy::MetricsOpenHour.reads_whole_window());
        assert!(MergePolicy::MetricsClosedHour.reads_whole_window());
    }
}
