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

use std::sync::Arc;

use ::datafusion::arrow::datatypes::Schema;
use chrono::{DateTime, TimeZone, Utc};
use config::{
    cluster, get_config,
    meta::stream::{
        FileKey, FileListDeleted, MergeStrategy, PartitionTimeLevel, StreamSettings, StreamType,
    },
    metrics,
    utils::{parquet::parse_file_key_columns, time::hour_micros},
};
use hashbrown::{HashMap, HashSet};
use infra::{
    cache::file_data,
    file_list as infra_file_list,
    schema::{get_partition_time_level_at, get_settings},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::downsampling::get_largest_downsampling_rule;
use search_service::file_list;
use tokio::{
    sync::{Semaphore, mpsc},
    task::JoinHandle,
};

use super::{
    job::{job_range_end, job_time_level, scheduling_level},
    plan::{BatchLimits, MergePolicy},
};
use crate::{
    bloom::compact::RetiredBlooms,
    worker::{MergeBatch, MergeSender},
};

/// Position of the hour directory in `files/{org}/{type}/{stream}/YYYY/MM/DD/HH/...`.
const HOUR_SEGMENT: usize = 7;

/// What a worker returns for one batch: `(batch_id, new_files, retire_files)`.
type BatchResult = Result<(usize, Vec<FileKey>, Vec<FileKey>), anyhow::Error>;

/// One job's merge window: the stream, the range it covers and whether it is still open.
struct MergeWindow {
    org_id: String,
    stream_type: StreamType,
    stream_name: String,
    /// The job offset, aligned to its hour.
    offset: i64,
    job_end: i64,
    /// The range can still receive files: only full-size groups are sealed.
    is_incremental: bool,
    /// A daily day was written hourly: its files merge as one group, written to DD/00.
    merges_by_day: bool,
    date_start: String,
    date_end: String,
    /// End of the range the files are read from; the merge rule is selected by it.
    range_end_ts: i64,
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
        let partition_time_level = job_time_level(
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

    fn stream(&self) -> String {
        format!("{}/{}/{}", self.org_id, self.stream_type, self.stream_name)
    }
}

/// What one merge round left behind, for a partition or for the whole window.
#[derive(Default)]
struct RoundOutcome {
    retired_blooms: RetiredBlooms,
    /// The round only prepared the window: the job is re-armed instead of finished.
    needs_another_round: bool,
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

fn group_by_partition(files: Vec<FileKey>, window: &MergeWindow) -> HashMap<String, Vec<FileKey>> {
    let mut partitions: HashMap<String, Vec<FileKey>> = HashMap::default();
    for file in files {
        let prefix = &file.key[..file.key.rfind('/').unwrap()];
        let prefix = if window.merges_by_day {
            day_prefix(prefix)
        } else {
            prefix.to_string()
        };
        partitions.entry(prefix).or_default().push(file);
    }
    partitions
}

/// Merges every partition of the window, `file_merge_thread_num` of them at a time.
async fn merge_partitions(
    worker_tx: mpsc::Sender<(MergeSender, MergeBatch)>,
    window: &Arc<MergeWindow>,
    policy: &MergePolicy,
    scan_schema: Arc<Schema>,
    files: Vec<FileKey>,
) -> Result<RoundOutcome, anyhow::Error> {
    let semaphore = Arc::new(Semaphore::new(get_config().limit.file_merge_thread_num));
    let partitions = group_by_partition(files, window);
    let mut tasks = Vec::with_capacity(partitions.len());
    for (prefix, files) in partitions {
        let permit = semaphore.clone().acquire_owned().await.unwrap();
        let worker_tx = worker_tx.clone();
        let window = window.clone();
        let policy = policy.clone();
        let scan_schema = scan_schema.clone();
        let task: JoinHandle<anyhow::Result<RoundOutcome>> = tokio::task::spawn(async move {
            let _permit = permit;
            merge_partition(&worker_tx, &window, &policy, &scan_schema, prefix, files).await
        });
        tasks.push(task);
    }

    let mut outcome = RoundOutcome::default();
    for task in tasks {
        let partition = task.await??;
        outcome.needs_another_round |= partition.needs_another_round;
        for (date, bloom_vers) in partition.retired_blooms {
            outcome
                .retired_blooms
                .entry(date)
                .or_default()
                .extend(bloom_vers);
        }
    }
    Ok(outcome)
}

/// One partition's round: plan its batches, run them on the workers, commit the results.
async fn merge_partition(
    worker_tx: &mpsc::Sender<(MergeSender, MergeBatch)>,
    window: &MergeWindow,
    policy: &MergePolicy,
    scan_schema: &Arc<Schema>,
    prefix: String,
    files: Vec<FileKey>,
) -> anyhow::Result<RoundOutcome> {
    let cfg = get_config();
    let strategy = MergeStrategy::from(&cfg.compact.strategy);
    let limits = BatchLimits {
        strategy: &strategy,
        max_file_size: cfg.compact.max_file_size,
        max_group_files: cfg.compact.max_group_files,
        is_incremental: window.is_incremental,
        merge_max_original_size: infra_file_list::merge_max_original_size(),
        max_merge_groups: cfg.compact.metrics_max_groups,
    };
    let files = sort_for_strategy(files, &strategy);
    let plan = policy
        .plan(files, &limits, scan_schema, &window.stream())
        .await;
    let batches: Vec<MergeBatch> = plan
        .batches
        .into_iter()
        .enumerate()
        .map(|(batch_id, (files, mode))| MergeBatch {
            batch_id,
            org_id: window.org_id.clone(),
            stream_type: window.stream_type,
            stream_name: window.stream_name.clone(),
            prefix: prefix.clone(),
            files,
            mode,
        })
        .collect();
    if batches.is_empty() {
        return Ok(RoundOutcome::default());
    }

    let results = run_batches(worker_tx, batches).await?;
    let retired_blooms = commit_results(window, results).await?;
    Ok(RoundOutcome {
        retired_blooms,
        needs_another_round: plan.needs_another_round,
    })
}

fn sort_for_strategy(mut files: Vec<FileKey>, strategy: &MergeStrategy) -> Vec<FileKey> {
    match strategy {
        MergeStrategy::FileSize => files.sort_by_key(|k| k.meta.original_size),
        MergeStrategy::FileTime => files.sort_by_key(|k| k.meta.min_ts),
        MergeStrategy::TimeRange => files = sort_by_time_range(files),
    }
    files
}

/// Sends the batches to the merge workers and waits for every result.
async fn run_batches(
    worker_tx: &mpsc::Sender<(MergeSender, MergeBatch)>,
    batches: Vec<MergeBatch>,
) -> anyhow::Result<Vec<BatchResult>> {
    let batch_num = batches.len();
    let (inner_tx, mut inner_rx) = mpsc::channel(batch_num);
    for batch in batches {
        if let Err(e) = worker_tx.send((inner_tx.clone(), batch)).await {
            log::error!("[COMPACTOR] send batch to worker failed: {e}");
            return Err(anyhow::Error::msg("send batch to worker failed"));
        }
    }
    let mut results = Vec::with_capacity(batch_num);
    for _ in 0..batch_num {
        results.push(inner_rx.recv().await.unwrap());
    }
    Ok(results)
}

/// Writes each merged batch to the file list; returns the blooms its retired files leave behind.
async fn commit_results(
    window: &MergeWindow,
    results: Vec<BatchResult>,
) -> anyhow::Result<RetiredBlooms> {
    let mut last_error = None;
    let mut check_guard = HashSet::with_capacity(results.len());
    let mut retired_blooms = RetiredBlooms::default();
    for ret in results {
        let (batch_id, new_files, retire_files) = match ret {
            Ok(v) => v,
            Err(e) => {
                log::error!("[COMPACTOR] merge files failed: {e}");
                last_error = Some(e);
                continue;
            }
        };

        if check_guard.contains(&batch_id) {
            log::warn!(
                "[COMPACTOR] merge files for stream: [{}] found error files, batch_id: {batch_id} duplicate",
                window.stream()
            );
            continue;
        }
        check_guard.insert(batch_id);

        // retire the merged inputs and the gone files, never the planned batch
        let events = retirement_events(new_files, &retire_files);
        if events.is_empty() {
            continue;
        }

        if let Err(e) = write_file_list(&window.org_id, window.stream_type, &events).await {
            log::error!("[COMPACTOR] write file list failed: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }

        // on nodes that also serve queries the merged source files may still be in use
        if cluster::LOCAL_NODE.is_compactor() && !cluster::LOCAL_NODE.is_querier() {
            file_data::delete::add(retire_files.iter().map(|f| f.key.clone()).collect());
        }

        // only after the file list write: a failed batch keeps its files and their blooms
        for file in retire_files.iter().filter(|f| f.meta.bloom_ver > 0) {
            // a `.bf` lives under the hour of the file it covers, not under the job's
            if let Ok((_, date, _)) = parse_file_key_columns(&file.key) {
                retired_blooms
                    .entry(date)
                    .or_default()
                    .push(file.meta.bloom_ver);
            }
        }
    }
    match last_error {
        Some(e) => Err(e),
        None => Ok(retired_blooms),
    }
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

fn has_downsampling_rule(_stream_name: &str, _max_ts: i64) -> bool {
    #[cfg(feature = "enterprise")]
    return get_largest_downsampling_rule(_stream_name, _max_ts).is_some();
    #[cfg(not(feature = "enterprise"))]
    false
}

async fn write_file_list(
    org_id: &str,
    stream_type: StreamType,
    events: &[FileKey],
) -> Result<(), anyhow::Error> {
    if events.is_empty() {
        return Ok(());
    }

    let del_items = events
        .iter()
        .filter(|v| v.deleted)
        .map(|v| FileListDeleted {
            id: 0,
            account: v.account.clone(),
            file: v.key.clone(),
            index_file: v.meta.index_size > 0,
            mindex_file: v.meta.mindex_size > 0,
            flattened: v.meta.flattened,
        })
        .collect::<Vec<_>>();

    // set to db
    // retry 5 times
    let cfg = get_config();
    let mut success = false;
    let mut mark_deleted_done = false;
    let created_at = config::utils::time::now_micros();
    for _ in 0..5 {
        if !mark_deleted_done && let Err(e) = infra::file_list::batch_process(events).await {
            log::error!("[COMPACTOR] batch_process to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        mark_deleted_done = true;
        if !del_items.is_empty()
            && let Err(e) = infra_file_list::batch_add_deleted(org_id, created_at, &del_items).await
        {
            log::error!("[COMPACTOR] batch_add_deleted to db failed, retrying: {e}");
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            continue;
        }
        success = true;
        break;
    }

    // handle dump_stats for file_list type streams
    if success && stream_type == StreamType::Filelist && cfg.compact.file_list_dump_enabled {
        let (deleted_files, new_files): (Vec<_>, Vec<_>) = events.iter().partition(|e| e.deleted);
        crate::dump::handle_dump_stats_on_merge(&deleted_files, &new_files).await;
    }

    if success {
        // send broadcast to other nodes
        if cfg.cache_latest_files.enabled {
            // get id for all the new files
            let file_ids = infra_file_list::query_ids_by_files(events).await?;
            let mut events = events.to_vec();
            for event in events.iter_mut() {
                if let Some(id) = file_ids.get(&event.key) {
                    event.id = *id;
                }
            }
            if let Err(e) = db::file_list::broadcast::send(&events).await {
                log::error!("[COMPACTOR] send broadcast for file_list failed: {e}");
            }
        }
    } else {
        return Err(anyhow::anyhow!("batch_write to db failed"));
    }

    Ok(())
}

/// `prefix` with its hour directory replaced by `00`, where the files of a daily day are written.
fn day_prefix(prefix: &str) -> String {
    prefix
        .split('/')
        .enumerate()
        .map(|(i, segment)| if i == HOUR_SEGMENT { "00" } else { segment })
        .collect::<Vec<_>>()
        .join("/")
}

/// File-list events that add `new_files` and delete `retire_files`; delete-only is valid.
fn retirement_events(new_files: Vec<FileKey>, retire_files: &[FileKey]) -> Vec<FileKey> {
    if retire_files.is_empty() {
        return Vec::new();
    }
    let mut events = Vec::with_capacity(new_files.len() + retire_files.len());
    events.extend(new_files.into_iter().filter(|f| !f.key.is_empty()));
    events.extend(retire_files.iter().map(|file| FileKey {
        deleted: true,
        selection: None,
        row_group_size: None,
        ..file.clone()
    }));
    events.sort_by(|a, b| a.key.cmp(&b.key));
    events
}

/// sort by time range without overlapping
fn sort_by_time_range(mut file_list: Vec<FileKey>) -> Vec<FileKey> {
    let files_num = file_list.len();
    file_list.sort_by_key(|f| f.meta.min_ts);
    let mut groups: Vec<Vec<FileKey>> = Vec::with_capacity(files_num);
    for file in file_list {
        let mut inserted = None;
        for (i, group) in groups.iter().enumerate() {
            if group
                .last()
                .is_some_and(|f| file.meta.min_ts >= f.meta.max_ts)
            {
                inserted = Some(i);
                break;
            }
        }
        if let Some(i) = inserted {
            groups[i].push(file);
        } else {
            groups.push(vec![file]);
        }
    }
    let mut files = Vec::with_capacity(files_num);
    for group in groups {
        files.extend(group);
    }
    files
}

#[cfg(test)]
mod tests {
    use config::meta::stream::{FileKey, FileMeta};

    use super::*;

    // Helper function to create test FileKey
    fn create_file_key(key: &str, min_ts: i64, max_ts: i64, original_size: i64) -> FileKey {
        FileKey {
            id: 0,
            account: "test_account".to_string(),
            key: key.to_string(),
            meta: FileMeta {
                min_ts,
                max_ts,
                records: 100,
                original_size,
                compressed_size: original_size / 2, // assume 50% compression
                index_size: 0,
                mindex_size: 0,
                flattened: false,
                bloom_ver: 0,
            },
            deleted: false,
            selection: None,
            row_group_size: None,
        }
    }

    #[test]
    fn test_day_prefix_replaces_only_the_hour() {
        assert_eq!(
            day_prefix("files/o/logs/s/2026/09/30/17"),
            "files/o/logs/s/2026/09/30/00"
        );
        assert_eq!(
            day_prefix("files/o/logs/s/2026/09/30/17/k8s_namespace=prod/host=a"),
            "files/o/logs/s/2026/09/30/00/k8s_namespace=prod/host=a"
        );
        assert_eq!(
            day_prefix("files/o/logs/s/2026/09/30/00"),
            "files/o/logs/s/2026/09/30/00"
        );
    }

    #[test]
    fn test_retirement_events_empty_retire_files_produces_nothing() {
        let new_files = vec![create_file_key("out.parquet", 1000, 2000, 4096)];
        let events = retirement_events(new_files, &[]);
        assert!(events.is_empty());
    }

    #[test]
    fn test_retirement_events_delete_only_without_new_files() {
        let gone = vec![create_file_key("gone.parquet", 1000, 2000, 1024)];
        let events = retirement_events(Vec::new(), &gone);
        let keys: Vec<(&str, bool)> = events.iter().map(|f| (f.key.as_str(), f.deleted)).collect();
        assert_eq!(keys, vec![("gone.parquet", true)]);
    }

    #[test]
    fn test_retirement_events_retires_exactly_retire_files() {
        let new_files = vec![
            create_file_key("out.parquet", 1000, 3000, 4096),
            create_file_key("", 0, 0, 0),
        ];
        let retire = vec![
            create_file_key("b.parquet", 2000, 3000, 1024),
            create_file_key("a.parquet", 1000, 2000, 1024),
        ];
        let events = retirement_events(new_files, &retire);
        let keys: Vec<(&str, bool)> = events.iter().map(|f| (f.key.as_str(), f.deleted)).collect();
        assert_eq!(
            keys,
            vec![
                ("a.parquet", true),
                ("b.parquet", true),
                ("out.parquet", false)
            ]
        );
        assert!(events.iter().all(|f| f.selection.is_none()));
    }

    #[test]
    fn test_sort_by_time_range_edge_case_adjacent_files() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 2000, 1024),
            create_file_key("file2.parquet", 2000, 3000, 1024), // exactly adjacent
            create_file_key("file3.parquet", 3000, 4000, 1024), // exactly adjacent
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);

        // Adjacent files should be able to be in the same group
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file2.parquet");
        assert_eq!(result[2].key, "file3.parquet");
    }

    // Test helper function creation
    #[test]
    fn test_create_file_key_helper() {
        let file_key = create_file_key("test.parquet", 1000, 2000, 1024);
        assert_eq!(file_key.key, "test.parquet");
        assert_eq!(file_key.meta.min_ts, 1000);
        assert_eq!(file_key.meta.max_ts, 2000);
        assert_eq!(file_key.meta.original_size, 1024);
        assert_eq!(file_key.meta.compressed_size, 512); // 50% compression
        assert_eq!(file_key.meta.records, 100);
        assert!(!file_key.meta.flattened);
        assert_eq!(file_key.id, 0);
        assert_eq!(file_key.account, "test_account");
        assert!(!file_key.deleted);
        assert!(file_key.selection.is_none());
    }

    // Boundary tests for sort_by_time_range
    #[test]
    fn test_sort_by_time_range_negative_timestamps() {
        let files = vec![
            create_file_key("file1.parquet", -2000, -1000, 1024),
            create_file_key("file2.parquet", -1000, 0, 1024),
            create_file_key("file3.parquet", 0, 1000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file2.parquet");
        assert_eq!(result[2].key, "file3.parquet");
    }

    #[test]
    fn test_sort_by_time_range_large_timestamps() {
        let files = vec![
            create_file_key("file1.parquet", i64::MAX - 2000, i64::MAX - 1000, 1024),
            create_file_key("file2.parquet", i64::MAX - 1000, i64::MAX, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file2.parquet");
    }

    // Edge case where min_ts equals max_ts (point in time)
    #[test]
    fn test_sort_by_time_range_point_in_time() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 1000, 1024), // Point in time
            create_file_key("file2.parquet", 1000, 2000, 1024), // Overlaps with file1
            create_file_key("file3.parquet", 2000, 2000, 1024), // Point in time, adjacent
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);

        // Verify all files are present
        let keys: Vec<&String> = result.iter().map(|f| &f.key).collect();
        assert!(keys.contains(&&"file1.parquet".to_string()));
        assert!(keys.contains(&&"file2.parquet".to_string()));
        assert!(keys.contains(&&"file3.parquet".to_string()));
    }

    #[test]
    fn test_sort_by_time_range_many_files_random_order() {
        let files = vec![
            create_file_key("file_f.parquet", 6000, 7000, 1024),
            create_file_key("file_b.parquet", 2000, 3000, 1024),
            create_file_key("file_d.parquet", 4000, 5000, 1024),
            create_file_key("file_a.parquet", 1000, 2000, 1024),
            create_file_key("file_c.parquet", 3000, 4000, 1024),
            create_file_key("file_e.parquet", 5000, 6000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 6);

        // Should be sorted by min_ts (all adjacent files)
        assert_eq!(result[0].key, "file_a.parquet");
        assert_eq!(result[1].key, "file_b.parquet");
        assert_eq!(result[2].key, "file_c.parquet");
        assert_eq!(result[3].key, "file_d.parquet");
        assert_eq!(result[4].key, "file_e.parquet");
        assert_eq!(result[5].key, "file_f.parquet");
    }

    #[test]
    fn test_sort_by_time_range_gaps_between_files() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 2000, 1024),
            create_file_key("file2.parquet", 5000, 6000, 1024), // gap after file1
            create_file_key("file3.parquet", 3000, 4000, 1024), // fits in gap
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);

        // Should be sorted by min_ts
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file3.parquet");
        assert_eq!(result[2].key, "file2.parquet");
    }

    #[test]
    fn test_sort_by_time_range_empty_list() {
        let files = vec![];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn test_sort_by_time_range_unsorted_non_overlapping() {
        let files = vec![
            create_file_key("file3.parquet", 3000, 4000, 1024),
            create_file_key("file1.parquet", 1000, 2000, 1024),
            create_file_key("file2.parquet", 2000, 3000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);
        // Should be sorted by min_ts
        assert_eq!(result[0].key, "file1.parquet");
        assert_eq!(result[1].key, "file2.parquet");
        assert_eq!(result[2].key, "file3.parquet");
    }

    #[test]
    fn test_sort_by_time_range_overlapping_files() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 2500, 1024), // overlaps with file2
            create_file_key("file2.parquet", 2000, 3000, 1024), // overlaps with file1
            create_file_key("file3.parquet", 3500, 4000, 1024), // non-overlapping
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);

        // First file should be file1 (min_ts = 1000)
        assert_eq!(result[0].key, "file1.parquet");

        // Due to overlapping, file3 should come next (can fit in same group as file1)
        // file2 would be in a separate group since it overlaps with file1
        let mut found_file2 = false;
        let mut found_file3 = false;
        for file in &result {
            if file.key == "file2.parquet" {
                found_file2 = true;
            }
            if file.key == "file3.parquet" {
                found_file3 = true;
            }
        }
        assert!(found_file2);
        assert!(found_file3);
    }

    #[test]
    fn test_sort_by_time_range_complex_overlapping() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 1500, 1024),
            create_file_key("file2.parquet", 1200, 1800, 1024), // overlaps with file1
            create_file_key("file3.parquet", 1600, 2000, 1024), // overlaps with file2
            create_file_key("file4.parquet", 2000, 2500, 1024), // adjacent to file3
            create_file_key("file5.parquet", 3000, 3500, 1024), // separate group
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 5);

        // Verify all files are present
        let keys: Vec<&String> = result.iter().map(|f| &f.key).collect();
        assert!(keys.contains(&&"file1.parquet".to_string()));
        assert!(keys.contains(&&"file2.parquet".to_string()));
        assert!(keys.contains(&&"file3.parquet".to_string()));
        assert!(keys.contains(&&"file4.parquet".to_string()));
        assert!(keys.contains(&&"file5.parquet".to_string()));
    }

    #[test]
    fn test_sort_by_time_range_identical_timestamps() {
        let files = vec![
            create_file_key("file1.parquet", 1000, 2000, 1024),
            create_file_key("file2.parquet", 1000, 2000, 512),
            create_file_key("file3.parquet", 1000, 2000, 2048),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 3);

        // All files have same timestamp, so they should all be in separate groups
        // due to overlap, but ordering should be maintained based on original order after sorting
        let keys: Vec<&String> = result.iter().map(|f| &f.key).collect();
        assert_eq!(keys.len(), 3);
        assert!(keys.contains(&&"file1.parquet".to_string()));
        assert!(keys.contains(&&"file2.parquet".to_string()));
        assert!(keys.contains(&&"file3.parquet".to_string()));
    }

    // ── Additional sort_by_time_range edge-case tests ────────────────────────

    /// Two files share the same min_ts but have different max_ts values.
    /// The file with the smaller max_ts ends first; the second file starts at
    /// the same time and thus overlaps → they must land in different groups.
    #[test]
    fn test_sort_by_time_range_same_min_ts_different_max_ts() {
        let files = vec![
            create_file_key("file_a.parquet", 1000, 3000, 1024),
            create_file_key("file_b.parquet", 1000, 2000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"file_a.parquet"));
        assert!(keys.contains(&"file_b.parquet"));
        // Both share min_ts=1000, so they overlap: each ends up in its own group.
        // Consecutive elements in the output must not have a later file whose
        // min_ts < the predecessor's max_ts within the same group-chain.
        // We just verify the invariant: result preserves all files.
        assert_eq!(result.len(), 2);
    }

    /// All files are completely overlapping (same time range).
    /// Every file goes into a separate group; total count must be preserved.
    #[test]
    fn test_sort_by_time_range_all_identical_ranges() {
        let files = vec![
            create_file_key("file1.parquet", 500, 1500, 1024),
            create_file_key("file2.parquet", 500, 1500, 512),
            create_file_key("file3.parquet", 500, 1500, 2048),
            create_file_key("file4.parquet", 500, 1500, 768),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 4);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"file1.parquet"));
        assert!(keys.contains(&"file2.parquet"));
        assert!(keys.contains(&"file3.parquet"));
        assert!(keys.contains(&"file4.parquet"));
    }

    /// Files whose min_ts == max_ts == 0 (zero timestamps).
    #[test]
    fn test_sort_by_time_range_zero_timestamps() {
        let files = vec![
            create_file_key("file1.parquet", 0, 0, 1024),
            create_file_key("file2.parquet", 0, 1000, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        // First file is whichever has min_ts=0; both should survive.
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"file1.parquet"));
        assert!(keys.contains(&"file2.parquet"));
    }

    /// Two non-overlapping groups: group A has files [1000,2000] and [2000,3000];
    /// group B has files [1500,2500] and [2500,3500].  The algorithm must
    /// produce exactly 4 files in the output.
    #[test]
    fn test_sort_by_time_range_two_interleaved_groups() {
        // After sort by min_ts:
        //   A1: [1000,2000], B1: [1500,2500], A2: [2000,3000], B2: [2500,3500]
        // A1 opens group-0.  B1 overlaps A1 (1500 < 2000) → opens group-1.
        // A2: min_ts=2000 >= group-0's last max=2000 → fits group-0.
        // B2: min_ts=2500 >= group-1's last max=2500 → fits group-1.
        let files = vec![
            create_file_key("A1.parquet", 1000, 2000, 1024),
            create_file_key("B1.parquet", 1500, 2500, 1024),
            create_file_key("A2.parquet", 2000, 3000, 1024),
            create_file_key("B2.parquet", 2500, 3500, 1024),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 4);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"A1.parquet"));
        assert!(keys.contains(&"A2.parquet"));
        assert!(keys.contains(&"B1.parquet"));
        assert!(keys.contains(&"B2.parquet"));
        // Group-0 chain: A1 then A2 (adjacent).  Verify they appear consecutively.
        let a1_pos = result.iter().position(|f| f.key == "A1.parquet").unwrap();
        let a2_pos = result.iter().position(|f| f.key == "A2.parquet").unwrap();
        assert_eq!(
            a2_pos,
            a1_pos + 1,
            "A1 and A2 should be in the same group (consecutive)"
        );
    }

    /// A chain of files where each one's min_ts equals the previous file's max_ts
    /// (strictly adjacent, no gap).  All should end up in one group.
    #[test]
    fn test_sort_by_time_range_strictly_adjacent_chain() {
        let files = vec![
            create_file_key("f1.parquet", 100, 200, 512),
            create_file_key("f3.parquet", 300, 400, 512),
            create_file_key("f2.parquet", 200, 300, 512),
            create_file_key("f4.parquet", 400, 500, 512),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 4);
        // All are adjacent (min_ts == prev max_ts) so they chain into one group.
        assert_eq!(result[0].key, "f1.parquet");
        assert_eq!(result[1].key, "f2.parquet");
        assert_eq!(result[2].key, "f3.parquet");
        assert_eq!(result[3].key, "f4.parquet");
    }

    /// A single file where min_ts == max_ts (point-in-time, zero-width range).
    #[test]
    fn test_sort_by_time_range_single_point_file() {
        let files = vec![create_file_key("point.parquet", 42, 42, 256)];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].key, "point.parquet");
        assert_eq!(result[0].meta.min_ts, 42);
        assert_eq!(result[0].meta.max_ts, 42);
    }

    // ── sort_by_time_range: additional branch-coverage tests ─────────────────

    /// Two files that don't overlap and have a gap between them.  The second
    /// file's min_ts is strictly greater than the first file's max_ts, so both
    /// land in the same chain (group-0) and appear in order.
    #[test]
    fn test_sort_by_time_range_two_non_overlapping_with_gap() {
        let files = vec![
            create_file_key("early.parquet", 1000, 2000, 512),
            create_file_key("late.parquet", 5000, 6000, 512),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].key, "early.parquet");
        assert_eq!(result[1].key, "late.parquet");
    }

    /// Files presented in strictly descending min_ts order.  After the internal
    /// sort by min_ts the algorithm must produce the same output as if they had
    /// been given in ascending order.
    #[test]
    fn test_sort_by_time_range_descending_input_order() {
        let files = vec![
            create_file_key("f4.parquet", 4000, 5000, 512),
            create_file_key("f3.parquet", 3000, 4000, 512),
            create_file_key("f2.parquet", 2000, 3000, 512),
            create_file_key("f1.parquet", 1000, 2000, 512),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 4);
        // Adjacent chain: all files should appear sorted by min_ts.
        assert_eq!(result[0].key, "f1.parquet");
        assert_eq!(result[1].key, "f2.parquet");
        assert_eq!(result[2].key, "f3.parquet");
        assert_eq!(result[3].key, "f4.parquet");
    }

    /// File where min_ts == max_ts == i64::MIN (boundary value).
    #[test]
    fn test_sort_by_time_range_min_i64_timestamps() {
        let files = vec![
            create_file_key("a.parquet", i64::MIN, i64::MIN, 256),
            create_file_key("b.parquet", i64::MIN, 0, 256),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"a.parquet"));
        assert!(keys.contains(&"b.parquet"));
    }

    /// A file whose min_ts is greater than its max_ts (malformed / inverted range).
    /// The algorithm must still return all files without panicking.
    #[test]
    fn test_sort_by_time_range_inverted_range_no_panic() {
        let files = vec![
            create_file_key("good.parquet", 1000, 3000, 512),
            create_file_key("bad.parquet", 5000, 2000, 512), // inverted: min > max
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"good.parquet"));
        assert!(keys.contains(&"bad.parquet"));
    }

    /// Many fully-overlapping files create as many groups as there are files.
    /// Verify that the total count is always preserved regardless of input size.
    #[test]
    fn test_sort_by_time_range_ten_fully_overlapping_files() {
        let files: Vec<FileKey> = (0..10)
            .map(|i| create_file_key(&format!("f{i}.parquet"), 0, 1000, 256))
            .collect();
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 10, "All files must be preserved");
    }

    /// Non-overlapping files interleaved with overlapping ones.
    /// Ensures multiple groups can be built simultaneously and
    /// files correctly land in the first group that can accept them.
    #[test]
    fn test_sort_by_time_range_mixed_overlap_and_gaps() {
        // After sort by min_ts:
        //  A: [100, 200], B: [150, 300], C: [200, 400], D: [300, 500], E: [600, 700]
        // Group-0 starts with A.
        // B (min=150 < A.max=200) → new group-1.
        // C (min=200 >= A.max=200) → fits group-0 (A chain extends to max=400).
        // D (min=300 < C.max=400) in group-0 fails; min=300 >= B.max=300 → fits group-1.
        // E (min=600 >= C.max=400) → fits group-0.
        let files = vec![
            create_file_key("A.parquet", 100, 200, 512),
            create_file_key("B.parquet", 150, 300, 512),
            create_file_key("C.parquet", 200, 400, 512),
            create_file_key("D.parquet", 300, 500, 512),
            create_file_key("E.parquet", 600, 700, 512),
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 5);
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"A.parquet"));
        assert!(keys.contains(&"B.parquet"));
        assert!(keys.contains(&"C.parquet"));
        assert!(keys.contains(&"D.parquet"));
        assert!(keys.contains(&"E.parquet"));
    }

    /// Verify `sort_by_time_range` with exactly two files where the second
    /// file's min_ts equals the first file's max_ts — the boundary condition
    /// `min_ts >= max_ts` in the group-fit predicate.
    #[test]
    fn test_sort_by_time_range_exact_boundary_two_files() {
        let files = vec![
            create_file_key("first.parquet", 1000, 2000, 512),
            create_file_key("second.parquet", 2000, 3000, 512), // min == prev max
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        // min_ts(second) == max_ts(first), so `file.meta.min_ts >= f.meta.max_ts`
        // evaluates to true → second file joins first file's group.
        assert_eq!(result[0].key, "first.parquet");
        assert_eq!(result[1].key, "second.parquet");
    }

    /// A file whose min_ts is one less than the previous group's max_ts must
    /// NOT join that group (it overlaps by 1 microsecond).
    #[test]
    fn test_sort_by_time_range_one_unit_overlap() {
        let files = vec![
            create_file_key("first.parquet", 1000, 2000, 512),
            create_file_key("overlap.parquet", 1999, 3000, 512), // 1999 < 2000
        ];
        let result = sort_by_time_range(files);
        assert_eq!(result.len(), 2);
        // overlap.parquet must be in a different group from first.parquet.
        // The first element should be first.parquet (lower min_ts).
        assert_eq!(result[0].key, "first.parquet");
        // Both files must appear; overlap.parquet goes to a new group.
        let keys: Vec<&str> = result.iter().map(|f| f.key.as_str()).collect();
        assert!(keys.contains(&"overlap.parquet"));
    }
}
