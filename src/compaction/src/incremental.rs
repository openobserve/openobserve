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

//! Write-side trigger for incremental compaction of the still-open current hour.
//!
//! The per-hour scheduled compactor only merges an hour after it has fully passed
//! (see `merge::generate_job_by_stream`). At high ingest volume that means thousands
//! of small ingester files pile up in the open hour and are all merged in one large
//! burst when the hour ends, which is slow and leaves recent-hour queries scanning
//! many small files.
//!
//! To smooth this out, the ingester maintains a purely in-memory per-`(stream, hour)`
//! file counter as it uploads files. When a stream crosses
//! `ZO_COMPACT_PENDING_FILES_TRIGGER` files in the current hour, it enqueues a merge
//! job for that hour right away. The merge worker recognises a current-hour job and
//! runs it in "incremental" mode (seal only full-size groups, carry the remainder),
//! deleting the job on completion so the next round can re-trigger.
//!
//! Notes:
//! - The counter is local to each ingester, so it only reflects that node's own uploads. That is
//!   intentional: we don't need a globally accurate count, just a cheap signal. Job inserts are
//!   deduped by the unique `(stream, offsets)` index (`add_job` uses `ON CONFLICT DO NOTHING`), so
//!   many ingesters racing only create one job, and the merge worker reads the *global* file_list
//!   to decide what to actually seal.
//! - Memory is bounded to one entry per active stream: the entry resets whenever the data partition
//!   hour switches.
//! - Disabled by default (`ZO_COMPACT_PENDING_FILES_TRIGGER = 0`); when disabled this does nothing
//!   and behavior is identical to the scheduled-only path.

//! Incremental compaction scheduling state.

use std::sync::LazyLock;

use config::{RwAHashMap, get_config, meta::stream::StreamType, utils::time::hour_micros};
use infra::cluster::get_cached_online_ingester_nodes;

/// key: `org/stream_type/stream` -> (data partition hour in micros, files seen this hour)
static PENDING_FILES: LazyLock<RwAHashMap<String, (i64, usize)>> = LazyLock::new(Default::default);

/// Record that one new file was uploaded for `(org, stream_type, stream)` whose data
/// falls in the hour containing `min_ts`. When the per-hour count crosses the configured
/// threshold, enqueue an incremental merge job for that hour and reset the counter.
pub async fn incr_pending_file(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    min_ts: i64,
) {
    let cfg = get_config();
    let ingester_num = get_cached_online_ingester_nodes()
        .await
        .map(|nodes| nodes.len())
        .unwrap_or(1);
    // must wait for at least 3 times of needed files
    let threshold =
        (cfg.compact.max_file_size / cfg.limit.max_file_size_in_memory / ingester_num).max(1) * 3;

    let hour = min_ts - min_ts % hour_micros(1);
    let key = format!("{org_id}/{stream_type}/{stream_name}");

    let triggered_hour = {
        let mut w = PENDING_FILES.write().await;
        let (cur_hour, cur_cnt) = w.get(&key).copied().unwrap_or((hour, 0));
        // reset when the data partition hour switches, keeping memory to one entry per stream
        let mut cnt = if cur_hour != hour { 0 } else { cur_cnt };
        cnt += 1;
        if cnt >= threshold {
            w.insert(key, (hour, 0)); // reset after trigger
            Some(hour)
        } else {
            w.insert(key, (hour, cnt));
            None
        }
    };

    let Some(hour) = triggered_hour else {
        return; // not triggered
    };

    // enqueue the incremental job; deduped at the DB layer by the unique (stream, offsets)
    // add_job will re-trigger the job if it is already done, so we don't need to check the status
    if let Err(e) = infra::file_list::add_job(org_id, stream_type, stream_name, hour).await {
        log::error!(
            "[COMPACTOR:INCREMENTAL] add_job failed for [{org_id}/{stream_type}/{stream_name}] hour {hour}: {e}"
        );
    } else {
        log::debug!(
            "[COMPACTOR:INCREMENTAL] enqueued incremental merge for [{org_id}/{stream_type}/{stream_name}] hour {hour}"
        );
    }
}
