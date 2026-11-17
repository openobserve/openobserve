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
use config::{
    meta::stream::{FileKey, StreamParams, StreamType},
    metrics,
    utils::time::now_micros,
};
use infra::{file_list as infra_file_list, schema};
use search_service::file_list;
use tokio::sync::mpsc;

use super::{
    partition::{RoundOutcome, merge_partitions},
    policy::{MergePolicy, MergeWindow},
};
use crate::worker::{MergeBatch, MergeSender};

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
    let now = now_micros();

    let schema = schema::get(org_id, stream_name, stream_type).await?;
    if schema == Schema::empty() {
        // the stream was deleted: nothing is left to merge
        mark_job_done(job_id).await;
        return Ok(());
    }

    log::debug!(
        "[COMPACTOR] merge_by_stream [{org_id}/{stream_type}/{stream_name}] offset: {offset}"
    );

    let settings = schema::get_settings(org_id, stream_name, stream_type).await;
    let policy = Arc::new(MergePolicy::resolve(
        &StreamParams::new(org_id, stream_name, stream_type),
        &schema,
        settings.as_deref(),
        offset,
        now,
    ));
    let files = query_window_files(&policy).await?;
    if files.is_empty() {
        mark_job_done(job_id).await;
        return Ok(());
    }

    let scan_schema = Arc::new(schema.with_metadata(Default::default()));
    let outcome = merge_partitions(worker_tx, &policy, scan_schema, files).await?;
    let needs_another_round = outcome.needs_another_round;
    build_blooms(policy.window(), outcome).await;
    settle_job(policy.window(), job_id, needs_another_round).await;

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
async fn query_window_files(policy: &MergePolicy) -> Result<Vec<FileKey>, anyhow::Error> {
    let window = policy.window();
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
        window.stream_key(),
        window.date_start,
        window.date_end,
        files.len(),
    );
    Ok(files)
}

/// Builds the window's bloom filters; a failure only leaves files on the regular search path.
async fn build_blooms(window: &MergeWindow, outcome: RoundOutcome) {
    let stream = window.stream_key();
    let date_start = &window.date_start;
    let build_start = std::time::Instant::now();
    match crate::bloom::compact::build_for_stream(
        &window.org_id,
        window.stream_type,
        &window.stream_name,
        date_start,
        // a window due another round is rewritten then: its blooms would go unreferenced at once
        window.is_incremental || outcome.needs_another_round,
        outcome.retired_blooms,
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

/// Marks the job done, or re-arms it when the range needs another round.
async fn settle_job(window: &MergeWindow, job_id: i64, needs_another_round: bool) {
    let stream = window.stream_key();
    let date_start = &window.date_start;
    // Running -> Pending directly: passing through Done would let a dump job take the range first
    let settled_mid_round =
        window.is_incremental && crate::is_past_hour(window.job_end, now_micros());
    if settled_mid_round || needs_another_round {
        log::info!(
            "[COMPACTOR] merge_by_stream [{stream}] {date_start} needs another merge round (settled mid-round: {settled_mid_round}), job {job_id} is re-armed"
        );
        if let Err(e) = infra_file_list::set_job_pending(&[job_id], 0, None).await {
            log::error!("[COMPACTOR] set_job_pending failed: {e}");
        }
        return;
    }

    if let Err(e) = infra_file_list::set_job_done(&[job_id]).await {
        log::error!("[COMPACTOR] set_job_done failed: {e}");
        return;
    }
    // re-read the clock: the range may settle while set_job_done runs,
    // and the scheduled add_job does nothing on a Running row
    if window.is_incremental
        && crate::is_past_hour(window.job_end, now_micros())
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
