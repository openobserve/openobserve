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

//! One merge round of a job: resolve its window, pick the rule, merge the partitions, settle the
//! job.

use std::sync::Arc;

use ::datafusion::arrow::datatypes::Schema;
use chrono::{DateTime, TimeZone, Utc};
use config::{
    meta::stream::{FileKey, PartitionTimeLevel, StreamSettings, StreamType},
    metrics,
    utils::time::hour_micros,
};
use infra::{
    file_list as infra_file_list,
    schema::{get_partition_time_level_at, get_settings},
};
use search_service::file_list;
use tokio::sync::mpsc;

use super::{
    job::{job_range_end, scheduling_level},
    partition::merge_partitions,
    policy::{MergePolicy, has_downsampling_rule, window_level},
};
use crate::{
    bloom::compact::RetiredBlooms,
    worker::{MergeBatch, MergeSender},
};

/// One job's merge window: the stream, the range it covers and whether it is still open.
pub(super) struct MergeWindow {
    pub(super) org_id: String,
    pub(super) stream_type: StreamType,
    pub(super) stream_name: String,
    /// The job offset, aligned to its hour.
    pub(super) offset: i64,
    pub(super) job_end: i64,
    /// The range can still receive files: only full-size groups are sealed.
    pub(super) is_incremental: bool,
    /// A daily day was written hourly: its files merge as one group, written to DD/00.
    pub(super) merges_by_day: bool,
    pub(super) date_start: String,
    pub(super) date_end: String,
    /// End of the range the files are read from; the merge rule is selected by it.
    pub(super) range_end_ts: i64,
}

impl MergeWindow {
    fn resolve(
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        settings: Option<&StreamSettings>,
        offset: i64,
    ) -> Self {
        let offset = offset - offset % hour_micros(1);
        let job_level = scheduling_level(stream_type, settings, offset);
        let job_end = job_range_end(offset, job_level);
        let is_incremental = !crate::is_past_hour(job_end);
        let partition_time_level = window_level(
            stream_type,
            offset,
            !is_incremental,
            get_partition_time_level_at(stream_type, settings, offset),
            |max_ts| has_downsampling_rule(stream_name, max_ts),
        );
        let offset_time: DateTime<Utc> = Utc.timestamp_nanos(offset * 1000);
        let (date_start, date_end) = if partition_time_level == PartitionTimeLevel::Daily {
            (
                offset_time.format("%Y/%m/%d/00").to_string(),
                offset_time.format("%Y/%m/%d/23").to_string(),
            )
        } else {
            (
                offset_time.format("%Y/%m/%d/%H").to_string(),
                offset_time.format("%Y/%m/%d/%H").to_string(),
            )
        };
        Self {
            org_id: org_id.to_string(),
            stream_type,
            stream_name: stream_name.to_string(),
            offset,
            job_end,
            is_incremental,
            merges_by_day: job_level == PartitionTimeLevel::Daily,
            date_start,
            date_end,
            range_end_ts: job_range_end(offset, partition_time_level),
        }
    }

    pub(super) fn stream(&self) -> String {
        format!("{}/{}/{}", self.org_id, self.stream_type, self.stream_name)
    }
}

/// Runs one merge round of a job's window: plan, merge, commit, then settle the job.
pub async fn merge_by_stream(
    worker_tx: mpsc::Sender<(MergeSender, MergeBatch)>,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    job_id: i64,
    offset: i64,
) -> Result<(), anyhow::Error> {
    let start = std::time::Instant::now();

    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    if schema == Schema::empty() {
        // the stream was deleted: nothing is left to merge
        mark_job_done(job_id).await;
        return Ok(());
    }

    log::debug!(
        "[COMPACTOR] merge_by_stream [{org_id}/{stream_type}/{stream_name}] offset: {offset}"
    );

    let settings = get_settings(org_id, stream_name, stream_type).await;
    let window = Arc::new(MergeWindow::resolve(
        org_id,
        stream_type,
        stream_name,
        settings.as_deref(),
        offset,
    ));
    let policy = MergePolicy::select(
        stream_type,
        stream_name,
        &schema,
        window.range_end_ts,
        !window.is_incremental,
    );
    let files = window_files(&window, &policy).await?;
    if files.is_empty() {
        mark_job_done(job_id).await;
        return Ok(());
    }

    let scan_schema = Arc::new(schema.with_metadata(Default::default()));
    let outcome = merge_partitions(worker_tx, &window, &policy, scan_schema, files).await?;
    build_blooms(&window, outcome.needs_another_round, outcome.retired_blooms).await;
    settle_job(&window, job_id, outcome.needs_another_round).await;

    let time = start.elapsed().as_secs_f64();
    metrics::COMPACT_USED_TIME
        .with_label_values(&[org_id, stream_type.as_str()])
        .inc_by(time);

    Ok(())
}

async fn mark_job_done(job_id: i64) {
    if let Err(e) = infra_file_list::set_job_done(&[job_id]).await {
        log::error!("[COMPACTOR] set_job_done failed: {e}");
    }
}

/// The files of the window the policy plans over.
async fn window_files(
    window: &MergeWindow,
    policy: &MergePolicy,
) -> Result<Vec<FileKey>, anyhow::Error> {
    let max_original_size = if policy.reads_whole_window() {
        i64::MAX
    } else {
        infra_file_list::merge_max_original_size()
    };
    let files = file_list::query_for_merge(
        &window.org_id,
        window.stream_type,
        &window.stream_name,
        &window.date_start,
        &window.date_end,
        max_original_size,
    )
    .await
    .map_err(|e| anyhow::anyhow!("query file list failed: {e}"))?;

    log::debug!(
        "[COMPACTOR] merge_by_stream [{}] date range: [{},{}], files: {}",
        window.stream(),
        window.date_start,
        window.date_end,
        files.len(),
    );
    Ok(files)
}

/// Builds the window's bloom filters; a failure only leaves files on the regular search path.
async fn build_blooms(
    window: &MergeWindow,
    needs_another_round: bool,
    retired_blooms: RetiredBlooms,
) {
    let stream = window.stream();
    let date_start = &window.date_start;
    let build_start = std::time::Instant::now();
    match crate::bloom::compact::build_for_stream(
        &window.org_id,
        window.stream_type,
        &window.stream_name,
        date_start,
        // a window due another round is rewritten then: its blooms would go unreferenced at once
        window.is_incremental || needs_another_round,
        retired_blooms,
    )
    .await
    {
        Ok(false) => {}
        Ok(true) => {
            let build_time = build_start.elapsed().as_millis();
            log::info!("[COMPACTOR] bloom build for {stream}/{date_start} took: {build_time} ms");
        }
        Err(e) => {
            log::warn!("[COMPACTOR] bloom build for {stream}/{date_start} failed: {e}");
        }
    }
}

/// Marks the job done, re-arms it for another round, or leaves it Running for the retry.
async fn settle_job(window: &MergeWindow, job_id: i64, needs_another_round: bool) {
    let stream = window.stream();
    let date_start = &window.date_start;
    // the range settled mid-round: stay Running so check_running_jobs re-arms a whole-range retry
    if window.is_incremental && crate::is_past_hour(window.job_end) {
        log::warn!(
            "[COMPACTOR] merge_by_stream [{stream}] range of {date_start} settled during the incremental round, job {job_id} is left for the retry"
        );
    } else if needs_another_round {
        log::info!(
            "[COMPACTOR] merge_by_stream [{stream}] {date_start} needs another merge round, job {job_id} is re-armed"
        );
        if let Err(e) = infra_file_list::set_job_pending(&[job_id], 0, None).await {
            log::error!("[COMPACTOR] set_job_pending failed: {e}");
        }
    } else if let Err(e) = infra_file_list::set_job_done(&[job_id]).await {
        log::error!("[COMPACTOR] set_job_done failed: {e}");
    } else if window.is_incremental
        && crate::is_past_hour(window.job_end)
        // add_job does nothing on a Running row, so the scheduled pass may have just missed this one
        && let Err(e) = infra_file_list::add_job(
            &window.org_id,
            window.stream_type,
            &window.stream_name,
            window.offset,
        )
        .await
    {
        log::error!("[COMPACTOR] re-arm job {job_id} failed: {e}");
    }
}
