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

//! The round of one window's partitions: plan each partition's batches, run them on the merge
//! workers and commit the results to the file list.

use std::sync::Arc;

use ::datafusion::arrow::datatypes::Schema;
use config::{
    cluster, get_config,
    meta::stream::{FileKey, FileListDeleted, MergeStrategy, StreamType},
    utils::parquet::parse_file_key_columns,
};
use hashbrown::{HashMap, HashSet};
use infra::{cache::file_data, file_list as infra_file_list};
use tokio::{
    sync::{Semaphore, mpsc},
    task::JoinHandle,
};

use super::{
    policy::{BatchLimits, MergePolicy},
    stream::MergeWindow,
};
use crate::{
    bloom::compact::RetiredBlooms,
    worker::{MergeBatch, MergeSender},
};

/// Position of the hour directory in `files/{org}/{type}/{stream}/YYYY/MM/DD/HH/...`.
const HOUR_SEGMENT: usize = 7;

/// What a worker returns for one batch: `(batch_id, new_files, retire_files)`.
type BatchResult = Result<(usize, Vec<FileKey>, Vec<FileKey>), anyhow::Error>;

/// What one merge round left behind, for a partition or for the whole window.
#[derive(Default)]
pub(super) struct RoundOutcome {
    pub(super) retired_blooms: RetiredBlooms,
    /// The round only prepared the window: the job is re-armed instead of finished.
    pub(super) needs_another_round: bool,
}

/// Merges every partition of the window, `file_merge_thread_num` of them at a time.
pub(super) async fn merge_partitions(
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
    let limits = BatchLimits::from_config(&cfg, &strategy, window.is_incremental);
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

    /// Sorts files named by their input position; returns the positions in output order.
    fn sorted_positions(ranges: &[(i64, i64)]) -> Vec<usize> {
        let files = ranges
            .iter()
            .enumerate()
            .map(|(i, (min_ts, max_ts))| create_file_key(&i.to_string(), *min_ts, *max_ts, 1024))
            .collect();
        sort_by_time_range(files)
            .iter()
            .map(|f| f.key.parse().unwrap())
            .collect()
    }

    #[test]
    fn test_sort_by_time_range_orders_non_overlapping_files_by_time() {
        assert!(sorted_positions(&[]).is_empty());
        assert_eq!(sorted_positions(&[(42, 42)]), [0]);
        // a file starting where the previous one ends does not overlap it
        assert_eq!(
            sorted_positions(&[(1000, 2000), (2000, 3000), (3000, 4000)]),
            [0, 1, 2]
        );
        assert_eq!(
            sorted_positions(&[(4000, 5000), (3000, 4000), (2000, 3000), (1000, 2000)]),
            [3, 2, 1, 0]
        );
        assert_eq!(
            sorted_positions(&[(1000, 2000), (5000, 6000), (3000, 4000)]),
            [0, 2, 1]
        );
        assert_eq!(
            sorted_positions(&[(-2000, -1000), (-1000, 0), (0, 1000)]),
            [0, 1, 2]
        );
        assert_eq!(
            sorted_positions(&[(1000, 1000), (1000, 2000), (2000, 2000)]),
            [0, 1, 2]
        );
        assert_eq!(
            sorted_positions(&[
                (i64::MAX - 1000, i64::MAX),
                (i64::MIN, i64::MIN),
                (i64::MIN, 0)
            ]),
            [1, 2, 0]
        );
    }

    #[test]
    fn test_sort_by_time_range_chains_overlapping_files() {
        // one unit of overlap opens a second chain; the next file rejoins the first
        assert_eq!(
            sorted_positions(&[(1000, 2000), (1999, 3000), (2000, 2500)]),
            [0, 2, 1]
        );
        // two interleaved chains come out one after the other
        assert_eq!(
            sorted_positions(&[(1000, 2000), (1500, 2500), (2000, 3000), (2500, 3500)]),
            [0, 2, 1, 3]
        );
        // a file joins the first chain it fits
        assert_eq!(
            sorted_positions(&[(100, 200), (150, 300), (200, 400), (300, 500), (600, 700)]),
            [0, 2, 4, 1, 3]
        );
        // files of one range are a chain each, in input order
        assert_eq!(sorted_positions(&[(500, 1500); 4]), [0, 1, 2, 3]);
        assert_eq!(sorted_positions(&[(1000, 3000), (1000, 2000)]), [0, 1]);
        // an inverted range is kept, not dropped
        assert_eq!(sorted_positions(&[(1000, 3000), (5000, 2000)]), [0, 1]);
    }
}
