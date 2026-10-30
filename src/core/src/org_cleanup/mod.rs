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

#[cfg(test)]
mod coverage;

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock, Mutex, PoisonError},
};

use async_trait::async_trait;
use config::{meta::stream::StreamType, spawn_pausable_job};
use infra::{
    coordinator::org_status::{STATUS_DELETED, STATUS_DELETING, STATUS_PENDING_DELETION},
    db::{get_orm_client_ro, get_orm_client_rw},
    dist_lock,
    org_lifecycle::OrgLifecycleGuard,
    table::{org_cleanup_tasks, organizations},
};
use sea_orm::TransactionTrait;

const LOCK_KEY: &str = "/org_cleanup/worker_lock";
const MAX_ATTEMPTS: i32 = 10;

const ORDER_DELETE_STREAMS: i32 = 100;
const ORDER_DELETE_STREAM_ITEM: i32 = 150;
const ORDER_DELETE_FILE_LIST: i32 = 200;
// Object-store drain of the rows step 200 queued in file_list_deleted.
const ORDER_DRAIN_DELETED_FILES: i32 = 250;
const ORDER_DELETE_DB_RESOURCES: i32 = 300;
const ORDER_DELETE_SCHEDULER_TRIGGERS: i32 = 400;
const ORDER_DELETE_USERS: i32 = 600;
// Re-runs of 100/150/200 catch data written by ingestion that raced the block.
const ORDER_DELETE_STREAMS_FINAL: i32 = 700;
const ORDER_DELETE_STREAM_FINAL_ITEM: i32 = 750;
const ORDER_DELETE_FILE_LIST_FINAL: i32 = 800;
// Drains what 700-800 queued (the compactor GC skips the org by then), then drops providers, keys.
const ORDER_DRAIN_DELETED_FILES_FINAL: i32 = 850;
// Final step: remove OFGA tuples and keep the org row as a `deleted` tombstone.
const ORDER_DELETE_ORG_RECORD: i32 = 900;
// Days a tombstone keeps its id from being re-created, measured from deletion end.
const ORG_TOMBSTONE_DAYS: i64 = 30;
const SUPER_CLUSTER_REFUSAL: &str =
    "Organization delete is not supported with super-cluster enabled yet";
// Durable mark for a tombstone whose eviction has not been broadcast yet.
const TOMBSTONE_PURGE_PREFIX: &str = "/org_cleanup/tombstone_purge/";
const FAIL_STEP_ENV: &str = "ZO_ORG_CLEANUP_FAIL_STEP";
const DRAIN_STALL_MIN_MICROS: i64 = 24 * 3600 * 1_000_000;
const BROADCAST_ATTEMPTS: u64 = 3;
// Rows stamped this long before the window starts still count as late, for clock skew.
const LATE_ROW_SLACK_MICROS: i64 = 3600 * 1_000_000;
const FILE_ROWS_BATCH: i64 = 10_000;
// A blocked org's due triggers wait on an hourly grid from `deleted_at`, so a resurrect finds them.
const PARK_MICROS: i64 = 3600 * 1_000_000;

// Per process, so each compactor alerts at most once per org until the org recovers.
static FAILED_ORGS: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
// Status and `deleted_at` last re-sent per blocked org; a resurrect and re-delete moves the latter.
static RESENT_STATUSES: LazyLock<Mutex<HashMap<String, BlockedState>>> =
    LazyLock::new(Default::default);

type BlockedState = (String, Option<i64>);

/// Deletes the physical data for a stream during organization cleanup.
///
/// The cleanup workflow owns orchestration and schema removal, while the binary
/// wires in the data-lifecycle implementation used by its compactor.
///
/// Implementations must remove local-disk files, file_list rows, and dump files
/// over the canonical (BASE_TIME, now) range — not a hand-rolled file_list scan
/// with (0, i64::MAX), which query_for_dump rejects as invalid/overflowing.
/// The compactor's `compaction::retention::delete_all` is the reference
/// implementation.
#[async_trait]
pub trait StreamDataCleanup: Send + Sync {
    async fn delete_stream_data(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
    ) -> Result<(), anyhow::Error>;

    /// Deletes a bounded share of the org's mature `file_list_deleted` objects.
    async fn drain_deleted_files(&self, org_id: &str) -> Result<DrainPass, anyhow::Error>;
}

/// What a step run asks of the worker: mark it done, or requeue it without spending an attempt.
#[derive(Debug, PartialEq, Eq)]
pub enum StepOutcome {
    Done,
    Retry(DrainPass),
}

/// One drain pass: rows it removed, whether any remain, and whether it stopped at its batch cap.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct DrainPass {
    pub removed: usize,
    pub pending: bool,
    pub capped: bool,
}

#[derive(Debug, PartialEq, Eq)]
enum Recorded {
    Written,
    /// The org's task rows are gone, as after step 900 or a resurrect, so nothing was left to mark.
    RowGone,
    LeaseLost,
    Failed,
}

/// Storage and broadcast steps of the tombstone sweep, behind a seam so retries can be tested.
#[async_trait]
trait TombstoneStore: Send + Sync {
    async fn pending(&self) -> Result<Vec<Tombstone>, anyhow::Error>;
    async fn expired(&self, before: i64) -> Result<Vec<Tombstone>, anyhow::Error>;
    async fn mark(&self, tombstone: &Tombstone) -> Result<(), anyhow::Error>;
    async fn remove_row(&self, tombstone: &Tombstone) -> Result<bool, anyhow::Error>;
    async fn current_status(&self, org_id: &str) -> Result<Option<String>, anyhow::Error>;
    async fn broadcast_eviction(&self, org_id: &str) -> Result<(), anyhow::Error>;
    async fn unmark(&self, tombstone: &Tombstone) -> Result<(), anyhow::Error>;
}

/// One tombstone generation: the id plus the `updated_at` its deletion finished at.
#[derive(Debug, Clone, PartialEq)]
struct Tombstone {
    org_id: String,
    generation: i64,
}

impl Tombstone {
    fn purge_key(&self) -> String {
        format!(
            "{TOMBSTONE_PURGE_PREFIX}{}/{}",
            self.org_id, self.generation
        )
    }

    fn from_purge_key(key: &str) -> Option<Self> {
        let (org_id, generation) = key.strip_prefix(TOMBSTONE_PURGE_PREFIX)?.rsplit_once('/')?;
        if org_id.is_empty() || org_id.contains('/') {
            return None;
        }
        Some(Self {
            org_id: org_id.to_string(),
            generation: generation.parse().ok()?,
        })
    }
}

struct DbTombstoneStore;

#[async_trait]
impl TombstoneStore for DbTombstoneStore {
    async fn pending(&self) -> Result<Vec<Tombstone>, anyhow::Error> {
        let keys = infra::db::get_db()
            .await
            .list_keys(TOMBSTONE_PURGE_PREFIX)
            .await?;
        Ok(keys
            .iter()
            .filter_map(|k| Tombstone::from_purge_key(k))
            .collect())
    }

    async fn expired(&self, before: i64) -> Result<Vec<Tombstone>, anyhow::Error> {
        Ok(
            infra::table::organizations::list_expired_tombstone_rows(before)
                .await?
                .into_iter()
                .map(|r| Tombstone {
                    org_id: r.identifier,
                    generation: r.updated_at,
                })
                .collect(),
        )
    }

    async fn mark(&self, tombstone: &Tombstone) -> Result<(), anyhow::Error> {
        infra::db::get_db()
            .await
            .put(
                &tombstone.purge_key(),
                tombstone.generation.to_string().into(),
                false,
                None,
            )
            .await?;
        Ok(())
    }

    async fn remove_row(&self, tombstone: &Tombstone) -> Result<bool, anyhow::Error> {
        // The cutoff preserves chat rows belonging to a later organization that reused this id.
        infra::table::ai_chat_sessions::delete_purged_by_org(
            &tombstone.org_id,
            tombstone.generation + LATE_ROW_SLACK_MICROS,
        )
        .await?;
        Ok(infra::table::organizations::remove_tombstone_at(
            &tombstone.org_id,
            tombstone.generation,
        )
        .await?)
    }

    async fn current_status(&self, org_id: &str) -> Result<Option<String>, anyhow::Error> {
        Ok(infra::table::organizations::get_status_uncached(org_id).await?)
    }

    async fn broadcast_eviction(&self, org_id: &str) -> Result<(), anyhow::Error> {
        crate::db::org_status::evict(org_id).await?;
        Ok(())
    }

    async fn unmark(&self, tombstone: &Tombstone) -> Result<(), anyhow::Error> {
        infra::db::get_db()
            .await
            .delete_if_exists(&tombstone.purge_key(), false, false)
            .await?;
        Ok(())
    }
}

/// Grace-period length in days. Enterprise config; OSS builds have no grace period
/// (deletion is cloud-only). `0` = delete immediately (legacy behavior).
pub fn grace_period_days() -> i64 {
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::common::config::get_config()
            .common
            .org_deletion_grace_period_days
    }
    #[cfg(not(feature = "enterprise"))]
    {
        0
    }
}

/// Super-cluster fan-out of org deletion is not built yet, so deletion is refused while it is on.
pub fn super_cluster_enabled() -> bool {
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
    }
    #[cfg(not(feature = "enterprise"))]
    {
        false
    }
}

pub fn fixed_steps(org_id: &str, org_name: &str) -> Vec<org_cleanup_tasks::NewCleanupTask> {
    // Billing is not a step: initiate_deletion refuses an org that still has active billing.
    vec![
        ("delete_streams", ORDER_DELETE_STREAMS),
        ("delete_file_list", ORDER_DELETE_FILE_LIST),
        ("drain_deleted_files", ORDER_DRAIN_DELETED_FILES),
        ("delete_db_resources", ORDER_DELETE_DB_RESOURCES),
        ("delete_scheduler_triggers", ORDER_DELETE_SCHEDULER_TRIGGERS),
        ("delete_users", ORDER_DELETE_USERS),
        ("delete_streams_final", ORDER_DELETE_STREAMS_FINAL),
        ("delete_file_list_final", ORDER_DELETE_FILE_LIST_FINAL),
        ("drain_deleted_files_final", ORDER_DRAIN_DELETED_FILES_FINAL),
        ("delete_org_record", ORDER_DELETE_ORG_RECORD),
    ]
    .into_iter()
    .map(|(step, order)| org_cleanup_tasks::NewCleanupTask {
        org_id: org_id.to_string(),
        org_name: org_name.to_string(),
        step: step.to_string(),
        step_order: order,
    })
    .collect()
}

/// True for an unfinished task that the worker stopped picking up because it ran out of attempts.
pub fn is_exhausted(task: &org_cleanup_tasks::CleanupTask) -> bool {
    matches!(task.status.as_str(), "pending" | "failed") && task.attempts >= MAX_ATTEMPTS
}

pub async fn run(stream_data_cleanup: Arc<dyn StreamDataCleanup>) -> Result<(), anyhow::Error> {
    // Local mode frees every crashed run's rows; a cluster only expired or orphaned ones.
    match org_cleanup_tasks::requeue_running_on_startup().await {
        Ok(n) if n > 0 => {
            log::warn!("[org_cleanup] requeued {n} stale 'running' task(s) on startup")
        }
        Ok(_) => {}
        Err(e) => log::error!("[org_cleanup] failed to requeue stale running tasks: {e}"),
    }
    match reconcile().await {
        Ok(n) if n > 0 => log::warn!("[org_cleanup] re-enqueued {n} deleting org(s) without tasks"),
        Ok(_) => {}
        Err(e) => log::error!("[org_cleanup] reconcile failed: {e}"),
    }

    spawn_pausable_job!(
        "org_cleanup_worker",
        config::get_config().common.org_cleanup_poll_interval_secs,
        {
            // A drain that stopped at its batch cap goes again at once instead of a poll later.
            while run_once(Arc::clone(&stream_data_cleanup)).await
                && config::get_config().common.org_cleanup_poll_interval_secs > 0
            {}
        }
    );
    Ok(())
}

/// One worker pass; true when a drain stopped at its batch cap with mature rows left.
pub async fn run_once(stream_data_cleanup: Arc<dyn StreamDataCleanup>) -> bool {
    let capped = process_pending(stream_data_cleanup).await;
    if let Err(e) = scan_failed().await {
        log::error!("[org_cleanup] failed to scan exhausted tasks: {e}");
    }
    capped
}

pub async fn scan_failed() -> Result<Vec<String>, anyhow::Error> {
    use config::metrics::ORG_CLEANUP_FAILED_STEPS;

    let mut failed: HashMap<String, (i64, String)> = HashMap::new();
    for task in org_cleanup_tasks::list_exhausted(MAX_ATTEMPTS).await? {
        failed.entry(task.org_id).or_insert((0, task.step)).0 += 1;
    }
    let (newly_failed, recovered) = {
        let mut alerted = FAILED_ORGS.lock().unwrap_or_else(PoisonError::into_inner);
        let recovered: Vec<String> = alerted
            .iter()
            .filter(|org| !failed.contains_key(*org))
            .cloned()
            .collect();
        alerted.retain(|org| failed.contains_key(org));
        let newly_failed: Vec<String> = failed
            .keys()
            .filter(|org| alerted.insert((*org).clone()))
            .cloned()
            .collect();
        (newly_failed, recovered)
    };
    for org_id in &recovered {
        let _ = ORG_CLEANUP_FAILED_STEPS.remove_label_values(&[org_id]);
    }
    for (org_id, (count, _)) in &failed {
        ORG_CLEANUP_FAILED_STEPS
            .with_label_values(&[org_id])
            .set(*count);
    }
    for org_id in &newly_failed {
        let step = &failed[org_id].1;
        log::error!(
            "[org_cleanup] org={org_id} step={step} permanently failed after {MAX_ATTEMPTS} attempts"
        );
        emit_failed_alert(org_id, step).await;
    }
    Ok(newly_failed)
}

async fn process_pending(stream_data_cleanup: Arc<dyn StreamDataCleanup>) -> bool {
    let locker = match dist_lock::lock(LOCK_KEY, 0).await {
        Ok(l) => l,
        Err(e) => {
            log::debug!("[org_cleanup] failed to acquire lock: {e}");
            return false;
        }
    };

    match org_cleanup_tasks::requeue_running().await {
        Ok(n) if n > 0 => log::warn!("[org_cleanup] requeued {n} task(s) whose worker is gone"),
        Ok(_) => {}
        Err(e) => log::error!("[org_cleanup] failed to requeue tasks whose worker is gone: {e}"),
    }
    let tasks = match org_cleanup_tasks::list_pending(MAX_ATTEMPTS).await {
        Ok(t) => t,
        Err(e) => {
            log::error!("[org_cleanup] failed to list pending tasks: {e}");
            let _ = dist_lock::unlock(&locker).await;
            return false;
        }
    };

    if let Err(e) = dist_lock::unlock(&locker).await {
        log::error!("[org_cleanup] failed to release lock: {e}");
    }

    let mut by_org: std::collections::HashMap<String, Vec<org_cleanup_tasks::CleanupTask>> =
        std::collections::HashMap::new();
    for task in tasks {
        by_org.entry(task.org_id.clone()).or_default().push(task);
    }

    let futures: Vec<_> = by_org
        .into_values()
        .map(|mut org_tasks| {
            org_tasks.sort_by_key(|t| t.step_order);
            tokio::spawn(process_org_tasks(
                org_tasks,
                Arc::clone(&stream_data_cleanup),
            ))
        })
        .collect();

    let mut capped = false;
    for f in futures {
        match f.await {
            Ok(org_capped) => capped |= org_capped,
            // JoinError from a spawned per-org task (panic or cancellation). The
            // step error itself is already logged inside process_org_tasks.
            Err(e) => log::error!("[org_cleanup] task error: {e}"),
        }
    }
    capped
}

/// Runs the org's ready steps in order; true when its drain stopped at the batch cap.
async fn process_org_tasks(
    tasks: Vec<org_cleanup_tasks::CleanupTask>,
    stream_data_cleanup: Arc<dyn StreamDataCleanup>,
) -> bool {
    let mut capped = false;
    for task in &tasks {
        let predecessors_done =
            match org_cleanup_tasks::list_by_org_status(&task.org_id, None).await {
                Ok(all) => all
                    .iter()
                    .filter(|t| t.step_order < task.step_order)
                    .all(|t| t.status == "done"),
                Err(e) => {
                    log::error!(
                        "[org_cleanup] cannot check predecessors for {}: {e}",
                        task.org_id
                    );
                    return capped;
                }
            };

        if !predecessors_done {
            log::debug!(
                "[org_cleanup] org={} step={} waiting for predecessors",
                task.org_id,
                task.step
            );
            continue;
        }

        let claim = match org_cleanup_tasks::mark_running(&task.id).await {
            Ok(Some(claim)) => claim,
            Ok(None) => {
                log::debug!(
                    "[org_cleanup] org={} step={} lost CAS race",
                    task.org_id,
                    task.step
                );
                continue;
            }
            Err(e) => {
                log::error!("[org_cleanup] mark_running error: {e}");
                continue;
            }
        };

        log::info!(
            "[org_cleanup] org={} step={} attempt={}",
            task.org_id,
            task.step,
            task.attempts + 1
        );

        let mut lease = org_cleanup_tasks::LeaseKeeper::spawn(&claim);
        let step = execute_step(
            &task.org_id,
            &task.org_name,
            &task.step,
            stream_data_cleanup.as_ref(),
        );
        let result = tokio::select! {
            result = step => result,
            () = lease.lost() => {
                log::error!(
                    "[org_cleanup] org={} step={} lost its lease, step abandoned",
                    task.org_id,
                    task.step
                );
                return capped;
            }
        };
        drop(lease);
        let hit_cap = matches!(&result, Ok(StepOutcome::Retry(pass)) if pass.capped);
        if record_outcome(task, &claim, result).await == Recorded::Written && hit_cap {
            capped = true;
        }
    }
    capped
}

async fn record_outcome(
    task: &org_cleanup_tasks::CleanupTask,
    claim: &org_cleanup_tasks::Claim,
    result: Result<StepOutcome, anyhow::Error>,
) -> Recorded {
    let (org_id, step) = (&task.org_id, &task.step);
    let marked = match result {
        Ok(StepOutcome::Done) => {
            log::info!("[org_cleanup] org={org_id} step={step} done");
            // A lost 'done' write leaves the row running until requeued, which stalls the org.
            org_cleanup_tasks::mark_done(claim).await
        }
        Ok(StepOutcome::Retry(pass)) => {
            let delay = config::get_config().compact.delete_files_delay_minutes;
            let now = config::utils::time::now_micros();
            let since = progress_since(&pass, task.last_error.as_deref(), now);
            if drain_stalled(since, now, delay) {
                log::error!("[org_cleanup] org={org_id} step={step} stalled since {since}");
                let msg = org_cleanup_tasks::stalled_message(since);
                org_cleanup_tasks::mark_failed(claim, &msg).await
            } else {
                log::info!(
                    "[org_cleanup] org={org_id} step={step} removed {} rows, more pending",
                    pass.removed
                );
                let msg = org_cleanup_tasks::stall_clock_message(since);
                // Rows removed prove the step is not stuck, so stalls before them spend no budget.
                if pass.removed > 0 {
                    org_cleanup_tasks::mark_progress(claim, &msg).await
                } else {
                    org_cleanup_tasks::mark_retry(claim, &msg).await
                }
            }
        }
        Err(e) => {
            log::error!(
                "[org_cleanup] org={org_id} step={step} attempt={} error={e}",
                task.attempts + 1
            );
            org_cleanup_tasks::mark_failed(claim, &e.to_string()).await
        }
    };
    let recorded = match marked {
        Ok(true) => Recorded::Written,
        Ok(false) => match org_cleanup_tasks::exists(&claim.id).await {
            Ok(false) => Recorded::RowGone,
            Ok(true) => Recorded::LeaseLost,
            Err(e) => {
                log::error!("[org_cleanup] org={org_id} step={step} cannot read its row: {e}");
                Recorded::LeaseLost
            }
        },
        Err(e) => {
            log::error!("[org_cleanup] org={org_id} step={step} failed to record the outcome: {e}");
            Recorded::Failed
        }
    };
    match recorded {
        Recorded::RowGone => {
            log::info!(
                "[org_cleanup] org={org_id} step={step} finished; the org's task rows are gone"
            )
        }
        Recorded::LeaseLost => {
            log::warn!("[org_cleanup] org={org_id} step={step} lost its lease, outcome dropped")
        }
        Recorded::Written | Recorded::Failed => {}
    }
    recorded
}

/// A drain may go without removing rows for max(24h, 4 x the delete delay), then it is stalled.
fn drain_stalled(since: i64, now: i64, delay_minutes: i64) -> bool {
    let bound = DRAIN_STALL_MIN_MICROS.max(4 * delay_minutes * 60 * 1_000_000);
    now - since > bound
}

/// When the drain last removed rows: now if this pass did, else the clock its last retry recorded.
fn progress_since(pass: &DrainPass, last_error: Option<&str>, now: i64) -> i64 {
    if pass.removed > 0 {
        return now;
    }
    org_cleanup_tasks::stall_clock(last_error).unwrap_or(now)
}

async fn emit_failed_alert(org_id: &str, _step: &str) {
    #[cfg(feature = "cloud")]
    {
        use crate::self_reporting::cloud_events::{CloudEvent, EventType, enqueue_cloud_event};
        enqueue_cloud_event(CloudEvent {
            event: EventType::OrgCleanupFailed,
            org_id: org_id.to_string(),
            org_name: org_id.to_string(),
            org_type: String::new(),
            user: None,
            subscription_type: None,
            stream_name: None,
        })
        .await;
    }
    #[cfg(not(feature = "cloud"))]
    {
        log::error!(
            "[org_cleanup] org={org_id} permanently failed (alert not available in this build)"
        );
    }
}

async fn execute_step(
    org_id: &str,
    org_name: &str,
    step: &str,
    stream_data_cleanup: &dyn StreamDataCleanup,
) -> Result<StepOutcome, anyhow::Error> {
    forced_failure(step)?;
    if step == "drain_deleted_files" || step == "drain_deleted_files_final" {
        let pass = stream_data_cleanup.drain_deleted_files(org_id).await?;
        if pass.pending {
            return Ok(StepOutcome::Retry(pass));
        }
        if step == "drain_deleted_files_final" {
            delete_org_storage_providers(org_id).await?;
            // Last: the provider rows are encrypted under the org DEK, and a node may load them.
            delete_org_cipher_keys(org_id)
                .await
                .map_err(|e| anyhow::anyhow!("drain_deleted_files_final/cipher: {e}"))?;
        }
        return Ok(StepOutcome::Done);
    }
    run_step(org_id, org_name, step, stream_data_cleanup).await?;
    Ok(StepOutcome::Done)
}

/// Debug and release-ci builds only: the env names a step, or `enqueue`, that must fail.
fn forced_failure(point: &str) -> Result<(), anyhow::Error> {
    if cfg!(debug_assertions) && std::env::var(FAIL_STEP_ENV).is_ok_and(|v| v == point) {
        return Err(anyhow::anyhow!("{FAIL_STEP_ENV} forced {point} to fail"));
    }
    Ok(())
}

async fn run_step(
    org_id: &str,
    org_name: &str,
    step: &str,
    stream_data_cleanup: &dyn StreamDataCleanup,
) -> Result<(), anyhow::Error> {
    if step == "delete_streams" {
        enqueue_stream_items(org_id, org_name, "delete_stream", ORDER_DELETE_STREAM_ITEM).await
    } else if step == "delete_streams_final" {
        enqueue_stream_items(
            org_id,
            org_name,
            "delete_stream_final",
            ORDER_DELETE_STREAM_FINAL_ITEM,
        )
        .await
    } else if let Some(rest) = step
        .strip_prefix("delete_stream:")
        .or_else(|| step.strip_prefix("delete_stream_final:"))
    {
        step_delete_stream(org_id, rest, stream_data_cleanup).await
    } else if step == "delete_file_list" || step == "delete_file_list_final" {
        step_delete_file_list(org_id, step).await
    } else if step == "delete_db_resources" {
        step_delete_db_resources(org_id).await
    } else if step == "delete_scheduler_triggers" {
        step_delete_scheduler_triggers(org_id).await
    } else if step == "delete_users" {
        step_delete_users(org_id).await
    } else if step == "delete_org_record" {
        step_delete_org_record(org_id).await.map(|_| ())
    } else {
        Err(anyhow::anyhow!("unknown step: {step}"))
    }
}

/// One `{step_prefix}:{type}/{name}` task per stream; the prefix keeps re-run rows distinct.
fn stream_item_tasks(
    org_id: &str,
    org_name: &str,
    streams: &[common::meta::stream::StreamSchema],
    step_prefix: &str,
    step_order: i32,
) -> Vec<org_cleanup_tasks::NewCleanupTask> {
    streams
        .iter()
        .map(|s| org_cleanup_tasks::NewCleanupTask {
            org_id: org_id.to_string(),
            org_name: org_name.to_string(),
            step: format!("{step_prefix}:{}/{}", s.stream_type, s.stream_name),
            step_order,
        })
        .collect()
}

async fn enqueue_stream_items(
    org_id: &str,
    org_name: &str,
    step_prefix: &str,
    step_order: i32,
) -> Result<(), anyhow::Error> {
    let streams = crate::db::schema::list(org_id, None, false).await?;
    let sub_tasks = stream_item_tasks(org_id, org_name, &streams, step_prefix, step_order);

    if !sub_tasks.is_empty() {
        // add_batch is INSERT ... ON CONFLICT DO NOTHING on the (org_id, step)
        // unique index, so it is idempotent across retries and reports its own
        // errors. A post-insert count re-check would false-positive on a partial
        // re-run (already-present rows are skipped), so we rely on the insert.
        org_cleanup_tasks::add_batch(&sub_tasks).await?;
    }

    Ok(())
}

async fn step_delete_stream(
    org_id: &str,
    type_and_name: &str,
    stream_data_cleanup: &dyn StreamDataCleanup,
) -> Result<(), anyhow::Error> {
    let (stream_type_str, stream_name) = type_and_name
        .split_once('/')
        .ok_or_else(|| anyhow::anyhow!("invalid stream key: {type_and_name}"))?;

    let stream_type = StreamType::from(stream_type_str);

    stream_data_cleanup
        .delete_stream_data(org_id, stream_type, stream_name)
        .await?;

    // Delete the schema entry after the injected cleanup removes the stream data.
    crate::db::schema::delete(org_id, stream_name, Some(stream_type)).await?;

    Ok(())
}

async fn step_delete_file_list(org_id: &str, step: &str) -> Result<(), anyhow::Error> {
    let tasks = org_cleanup_tasks::list_by_org_status(org_id, None).await?;
    let first_pass = step == "delete_file_list";
    let found = if first_pass {
        // The deletion's one org-wide read, before the drain: legacy streams show up nowhere else.
        infra::file_list::list_org_streams_by_scan(org_id).await?
    } else {
        let since = late_rows_since(&tasks, config::utils::time::now_micros());
        let until = config::utils::time::now_micros() + LATE_ROW_SLACK_MICROS;
        infra::file_list::list_streams_updated_since(org_id, since, until).await?
    };
    let streams = org_file_streams(org_id, &tasks, found).await?;
    // In history mode nothing else deletes a history row's object, so it is queued as well.
    let history_mode = config::get_config().compact.file_list_deleted_mode
        == config::meta::stream::FileListBookKeepMode::History.to_string();
    delete_org_file_rows(org_id, &streams, FILE_ROWS_BATCH, history_mode).await?;
    if !first_pass {
        ensure_final_drain(org_id, &tasks).await?;
    }
    Ok(())
}

/// Adds step 850 to a deletion enqueued before it existed, so its late rows are drained too.
async fn ensure_final_drain(
    org_id: &str,
    tasks: &[org_cleanup_tasks::CleanupTask],
) -> Result<(), anyhow::Error> {
    if tasks.iter().any(|t| t.step == "drain_deleted_files_final") {
        return Ok(());
    }
    let org_name = tasks.first().map_or(org_id, |t| t.org_name.as_str());
    org_cleanup_tasks::add_batch(&[org_cleanup_tasks::NewCleanupTask {
        org_id: org_id.to_string(),
        org_name: org_name.to_string(),
        step: "drain_deleted_files_final".to_string(),
        step_order: ORDER_DRAIN_DELETED_FILES_FINAL,
    }])
    .await?;
    Ok(())
}

/// Step 800's look-back: step 200 lists its streams when it begins, so later rows count as late.
fn late_rows_since(tasks: &[org_cleanup_tasks::CleanupTask], now: i64) -> i64 {
    let started = tasks.iter().map(|t| t.created_at).min().unwrap_or(now);
    let first_pass_done = tasks
        .iter()
        .find(|t| t.step == "delete_file_list" && t.status == "done")
        .map_or(now, |t| t.updated_at);
    // Step 200 is claimed only once every earlier step is done, so their last finish precedes it.
    let first_pass_runnable = tasks
        .iter()
        .filter(|t| t.step_order < ORDER_DELETE_FILE_LIST && t.status == "done")
        .map(|t| t.updated_at)
        .filter(|&done| done <= first_pass_done)
        .max()
        .unwrap_or(started);
    first_pass_runnable - LATE_ROW_SLACK_MICROS
}

/// `found` plus the streams with a stats row or a step-150 task: all the org may have rows in.
async fn org_file_streams(
    org_id: &str,
    tasks: &[org_cleanup_tasks::CleanupTask],
    found: Vec<String>,
) -> Result<Vec<String>, anyhow::Error> {
    let mut streams: std::collections::BTreeSet<String> =
        infra::file_list::list_stats_streams_by_org(org_id)
            .await?
            .into_iter()
            .collect();
    streams.extend(found);
    streams.extend(tasks.iter().filter_map(|t| {
        t.step
            .strip_prefix("delete_stream:")
            .or_else(|| t.step.strip_prefix("delete_stream_final:"))
            .map(|type_and_name| format!("{org_id}/{type_and_name}"))
    }));
    Ok(streams.into_iter().collect())
}

/// Moves the streams' file rows to `file_list_deleted` in bounded batches, then drops jobs, stats.
async fn delete_org_file_rows(
    org_id: &str,
    streams: &[String],
    batch: i64,
    queue_history: bool,
) -> Result<(), anyhow::Error> {
    use infra::file_list::StreamRowsTable;

    for stream in streams {
        remove_stream_rows(StreamRowsTable::FileList, org_id, stream, batch, true).await?;
        remove_stream_rows(
            StreamRowsTable::History,
            org_id,
            stream,
            batch,
            queue_history,
        )
        .await?;
    }
    infra::file_list::delete_jobs_by_streams(org_id, streams).await?;
    // Last: the stats rows are how a retried step finds these streams again.
    infra::file_list::delete_stream_stats_by_org(org_id).await?;
    Ok(())
}

async fn remove_stream_rows(
    table: infra::file_list::StreamRowsTable,
    org_id: &str,
    stream: &str,
    batch: i64,
    to_deleted: bool,
) -> Result<(), anyhow::Error> {
    // Until an empty batch: a concurrent delete can shorten a batch while rows remain.
    while infra::file_list::remove_stream_batch(table, org_id, stream, batch, to_deleted).await? > 0
    {
    }
    Ok(())
}

/// Runs once the last drain is done: a provider deleted earlier strands objects left in its bucket.
async fn delete_org_storage_providers(org_id: &str) -> Result<(), anyhow::Error> {
    crate::db::org_storage::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("drain_deleted_files_final/org_storage_providers: {e}"))
}

/// Delete every downtime through the db layer, so caches, regions and OpenFGA tuples drop it.
async fn delete_org_downtimes(org_id: &str) -> Result<(), anyhow::Error> {
    crate::db::downtimes::delete_by_org(org_id).await
}

/// Delete every alert in an org through the service layer so the ALERTS /
/// STREAM_ALERTS caches evict cluster-wide (via the coordinator delete event) and
/// each alert's scheduler trigger + OFGA ownership is removed — none of which a
/// raw table wipe would do.
async fn delete_org_alerts(org_id: &str) -> Result<(), anyhow::Error> {
    let conn = get_orm_client_rw().await;

    // Organization teardown is the sole graph-guard bypass. Remove composite
    // child-index rows and definitions before ordinary alerts so no dangling
    // reverse reference can survive even transiently into the ordinary-alert
    // phase. This helper is private to the teardown workflow; there is no
    // public `force` capability.
    infra::table::alert_composites::delete_by_org(conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!("composite graph teardown: {e}"))?;

    let alerts = crate::db::alerts::alert::list_all_for_cleanup(org_id).await?;
    for alert in alerts {
        let Some(alert_id) = alert.id else { continue };
        crate::alerts::alert::delete_by_id(conn, org_id, alert_id)
            .await
            .map_err(|e| anyhow::anyhow!("alert {alert_id}: {e}"))?;
    }
    // Any alert the listing missed goes in one delete, which names it for its events.
    crate::alerts::alert::delete_rest_of_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("alerts the listing missed: {e}"))?;
    Ok(())
}

/// Delete every cipher key of the org's users through `db::keys`, so every REGISTRY evicts it.
#[cfg(feature = "enterprise")]
async fn delete_org_user_cipher_keys(org_id: &str) -> Result<(), anyhow::Error> {
    crate::db::keys::remove_cipher_keys_by_org(org_id).await?;
    Ok(())
}

/// OSS builds have no key registry; step 850's table delete removes any user key row.
#[cfg(not(feature = "enterprise"))]
async fn delete_org_user_cipher_keys(_org_id: &str) -> Result<(), anyhow::Error> {
    Ok(())
}

/// Delete the org's remaining cipher rows, the system DEK included.
async fn delete_org_cipher_keys(org_id: &str) -> Result<(), anyhow::Error> {
    infra::table::cipher::delete_by_org(org_id).await?;
    Ok(())
}

/// Through the db layer, so stored files, caches and cluster events are torn down too.
async fn delete_org_sourcemaps(org_id: &str) -> Result<(), anyhow::Error> {
    crate::db::sourcemaps::delete_by_org(org_id).await?;
    Ok(())
}

/// Per report through the db layer, its ownership tuple first, so a retry still finds the row.
async fn delete_org_reports(org_id: &str) -> Result<(), anyhow::Error> {
    let conn = get_orm_client_rw().await;
    let listed = infra::table::reports::list_ids_by_org(get_orm_client_ro().await, org_id).await?;
    for (report_id, folder_id) in listed {
        remove_report_ownership(org_id, &report_id, folder_id).await;
        crate::db::dashboards::reports::delete_by_id(conn, org_id, &report_id).await?;
    }
    // One delete takes any report the listing missed; its trigger goes at the scheduler step.
    for (report_id, folder_id) in infra::table::reports::delete_by_org(org_id).await? {
        remove_report_ownership(org_id, &report_id, folder_id).await;
    }
    Ok(())
}

async fn remove_report_ownership(org_id: &str, report_id: &str, folder_id: String) {
    let report = common::meta::authz::Authz {
        obj_id: report_id.to_owned(),
        parent_type: "report_folders".to_owned(),
        parent: folder_id,
    };
    crate::db::authz::remove_ownership(org_id, "reports", report).await;
}

/// Per table, so each node's `ENRICHMENT_TABLES` entry and this node's local copy go with the rows.
async fn delete_org_enrichment_tables(org_id: &str) -> Result<(), anyhow::Error> {
    // By org directory and checked, so a failure is retried even after the rows are gone.
    config::utils::enrichment_local_cache::delete_org(org_id).await?;
    let owned = format!("{org_id}/");
    let mut names: HashSet<String> = infra::table::enrichment_tables::list_names_by_org(org_id)
        .await?
        .into_iter()
        .collect();
    // A stream-backed table has no rows here once step 150 has deleted its stream.
    names.extend(
        transform::enrichment::ENRICHMENT_TABLES
            .iter()
            .filter_map(|e| {
                let (_, name) = e.key().strip_prefix(&owned)?.split_once('/')?;
                Some(name.to_string())
            }),
    );
    for name in names {
        enrichment_data::enrichment_table::cleanup_enrichment_table_resources(
            org_id,
            &name,
            StreamType::EnrichmentTables,
        )
        .await;
        // The cleanup above only logs failures, so these two repeat with `?`.
        enrichment_data::enrichment::storage::database::delete(org_id, &name).await?;
        crate::db::enrichment_table::delete(org_id, &name).await?;
    }
    // One delete takes the rows of any table the listing missed, and names it for its cleanup.
    let mut missed = infra::table::enrichment_tables::delete_by_org(org_id).await?;
    missed.sort();
    missed.dedup();
    for name in missed {
        enrichment_data::enrichment_table::cleanup_enrichment_table_resources(
            org_id,
            &name,
            StreamType::EnrichmentTables,
        )
        .await;
        crate::db::enrichment_table::delete(org_id, &name).await?;
    }
    Ok(())
}

/// Through the db layer, which also sends each table's super-cluster delete.
async fn delete_org_enrichment_url_jobs(org_id: &str) -> Result<(), anyhow::Error> {
    crate::db::enrichment_table::delete_url_jobs_by_org(org_id).await?;
    Ok(())
}

/// Offsets and node caches of the org; each prefix ends in `{org}/`, so `t1` never matches `t10`.
async fn delete_org_offsets_and_caches(org_id: &str) -> Result<(), anyhow::Error> {
    crate::db::compact::files::delete_by_org(org_id).await?;
    crate::db::compact::downsampling::delete_by_org(org_id).await?;
    let prefixes = [
        format!("/compact/organization/{org_id}/"),
        format!("/service_graph/v4/offsets/{org_id}/"),
        format!("/db_monitoring/offsets/{org_id}/"),
        format!(
            "{}/{org_id}/",
            crate::db::enrichment_table::ENRICHMENT_TABLE_SIZE_KEY
        ),
        format!(
            "{}/{org_id}/",
            infra::table::enrichment_tables::ENRICHMENT_TABLE_META_STREAM_STATS_KEY
        ),
    ];
    for prefix in prefixes {
        crate::db::delete_if_exists(&prefix, true, infra::db::NO_NEED_WATCH).await?;
    }
    crate::db::metrics::delete_by_org(org_id).await?;
    if !search_service::cluster::cacher::delete_cached_results(org_id.to_string(), 0).await {
        return Err(anyhow::anyhow!(
            "the query result cache delete failed on at least one querier"
        ));
    }
    promql_service::search::remove_org_results(org_id).await?;
    Ok(())
}

// The mappings live in the `_meta` org's settings, so the org's own settings delete misses them.
#[cfg(feature = "cloud")]
async fn delete_org_domain_mappings(org_id: &str) -> Result<(), anyhow::Error> {
    // The shared writer serializes this with the settings API and other orgs' cleanups.
    let org_id = org_id.to_string();
    crate::db::organization::update_org_setting(config::META_ORG_ID, move |settings| {
        let before = settings.domain_org_mappings.len();
        settings.domain_org_mappings.retain(|m| m.org_id != org_id);
        settings.domain_org_mappings.len() != before
    })
    .await?;
    Ok(())
}

async fn delete_org_fleet_resources(org_id: &str) -> Result<(), anyhow::Error> {
    use infra::table::{
        fleet_collectors, fleet_configs, fleet_rollouts, fleet_settings, fleet_tokens, fleets,
    };

    // Flushes skip orgs gone from the org cache; retention removes a row a racing flush re-adds.
    let collector_ids = fleet_collectors::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/fleet_collectors: {e}"))?;
    // Every node drops `admitted`, so a re-created org starts clean.
    for id in collector_ids {
        if let Err(e) = infra::coordinator::fleet::emit_collector_changed(org_id, &id).await {
            log::error!("step_delete_db_resources/fleet_collectors: event for {id}: {e}");
        }
    }
    let token_ids = fleet_tokens::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/fleet_tokens: {e}"))?;
    // Each node's watcher finds the row gone and evicts the cached hash.
    for token_id in token_ids {
        if let Err(e) = infra::coordinator::fleet::emit_token_changed(org_id, &token_id).await {
            log::error!("step_delete_db_resources/fleet_tokens: event for {token_id}: {e}");
        }
    }
    fleet_configs::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/fleet_configs: {e}"))?;
    fleet_rollouts::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/fleet_rollouts: {e}"))?;
    fleet_settings::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/fleet_settings: {e}"))?;
    fleets::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/fleets: {e}"))?;
    Ok(())
}

async fn delete_org_ai_assistant_resources(org_id: &str) -> Result<(), anyhow::Error> {
    infra::table::ai_access_requests::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_access_requests: {e}"))?;
    infra::table::ai_actions::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_actions: {e}"))?;
    infra::table::ai_grants::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_grants: {e}"))?;
    infra::table::ai_turn_marks::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_turn_marks: {e}"))?;
    infra::table::ai_chat_feedback::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_chat_feedback: {e}"))?;
    infra::table::ai_chat_imports::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_chat_imports: {e}"))?;
    infra::table::ai_approvals::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_approvals: {e}"))?;
    Ok(())
}

async fn step_delete_db_resources(org_id: &str) -> Result<(), anyhow::Error> {
    #[cfg(not(feature = "enterprise"))]
    use infra::table::service_streams;
    #[cfg(feature = "cloud")]
    use infra::table::trial_quota_usage;
    // `service_streams` is NOT imported here: this branch routes the enterprise
    // build through the storage layer instead, and imports the table module only
    // under #[cfg(not(feature = "enterprise"))] above. Importing it twice would
    // collide on the OSS build.
    use infra::table::{
        ai_chat_sessions, ai_chat_shares, ai_chat_turns, alert_acks, alert_calibration,
        alert_incidents, anomaly_detection, compactor_manual_jobs, distinct_values,
        external_alerts, gen_ai_agents, incident_events, incident_integrations, llm_eval,
        llm_prompts, llm_secrets, oncall_teams, online_eval_jobs, org_ai_toolsets, org_telephony,
        providers, query_history, ratelimit, rca_runs, rca_steering, re_pattern,
        re_pattern_stream_map, rum_pa, score_configs, scorers, search_queue, slack_alert_messages,
        slo, slo_backfill_jobs, slo_budget, slos, status_pages, synthetics_agents,
        synthetics_checks, synthetics_environments, synthetics_locations, synthetics_probe_tokens,
        synthetics_variables, timed_annotations, workflows,
    };

    // FK-constrained children must be deleted before their parents.
    // Order: timed_annotations → dashboards → folders (join chain:
    // folders→dashboards→timed_annotations)
    alert_incidents::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/alert_incidents: {e}"))?;
    incident_events::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/incident_events: {e}"))?;
    rca_steering::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/rca_steering: {e}"))?;
    rca_runs::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/rca_runs: {e}"))?;
    incident_integrations::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/incident_integrations: {e}"))?;
    external_alerts::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/external_alerts: {e}"))?;
    // SLOs go BEFORE alerts, deliberately: an alert-based SLO reads from a source
    // alert, and a later PR refuses to delete an alert a live SLO still depends
    // on. An org teardown must never stall on that guard.
    //
    // Within the SLO tables the order is also fixed: status rows and backfill jobs
    // carry no org column and resolve their org through `slos`, so they are swept
    // before the definitions that identify them.
    let slo_conn = get_orm_client_rw().await;
    slo::delete_by_org(slo_conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/slo_status: {e}"))?;
    slo_backfill_jobs::delete_by_org(slo_conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/slo_backfill_jobs: {e}"))?;
    slos::delete_by_org(slo_conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/slos: {e}"))?;
    slo_budget::delete_by_org(slo_conn, org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/slo_budget: {e}"))?;
    // Delete alerts through the service layer (not a raw table wipe) so the
    // ALERTS/STREAM_ALERTS in-memory caches evict cluster-wide via the coordinator
    // delete event, and each alert's scheduler trigger is torn down. A direct table
    // delete would leave stale alerts in every node's memory until the next restart.
    delete_org_alerts(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/alerts: {e}"))?;
    alert_acks::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/alert_acks: {e}"))?;
    // downtimes.folder_id has a FK (downtimes_folder_fk) → folders.id.
    delete_org_downtimes(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/downtimes: {e}"))?;
    // timed_annotation_panels cascade from timed_annotations; both are deleted here
    // via the three-hop join: folders.org → dashboards.folder_id → timed_annotations.dashboard_id
    // Must run BEFORE dashboards::delete_by_org or the join finds no rows.
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::slack::store::delete_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/slack: {e}"))?;
    slack_alert_messages::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/slack_alert_messages: {e}"))?;
    timed_annotations::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/timed_annotations: {e}"))?;
    crate::public_dashboards::revoke_all_for_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/public_dashboards: {e}"))?;
    // dashboards must be deleted before folders (FK constraint)
    crate::dashboards::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/dashboards: {e}"))?;
    // reports must be deleted before folders: reports.folder_id has a FK
    // (reports_folders_fk) → folders.id.
    delete_org_reports(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/reports: {e}"))?;
    // Prompt heads also reference folders with a restrictive FK. Delete the
    // complete registry before folders so an org with prompts can be removed.
    llm_prompts::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/llm_prompts: {e}"))?;
    // First, so each task's secrets go while the task row still names them.
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::llm_evaluations::remote_tasks::delete_all_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/llm_remote_tasks: {e}"))?;
    llm_eval::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/llm_eval: {e}"))?;
    score_configs::delete_all_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/score_configs: {e}"))?;
    scorers::delete_all_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/scorers: {e}"))?;
    online_eval_jobs::delete_all_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/online_eval_jobs: {e}"))?;
    providers::delete_all_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/providers: {e}"))?;
    llm_secrets::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/llm_secrets: {e}"))?;
    org_ai_toolsets::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/org_ai_toolsets: {e}"))?;
    // Before the rows: the purge lists the chats from them, and a retry skips confirmed ones.
    #[cfg(feature = "enterprise")]
    crate::ai_chat::purge_org_replicas(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_chat_replicas: {e}"))?;
    delete_org_ai_assistant_resources(org_id).await?;
    // Turns and shares before their chat rows, so none is left without the chat it belongs to.
    ai_chat_turns::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_chat_turns: {e}"))?;
    ai_chat_shares::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_chat_shares: {e}"))?;
    // Chats the retention sweep still re-purges stay until the tombstone sweep, as for any delete.
    let repurge_since =
        config::utils::time::now_micros() - ai_chat_sessions::REPLICA_REPURGE_WINDOW_MICROS;
    ai_chat_sessions::delete_by_org_except_repurging(org_id, repurge_since)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/ai_chat_sessions: {e}"))?;
    // A queued write would re-insert the rows; other nodes' flushes refuse an inactive org.
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::llm_evaluations::agent_registry::evict_org(org_id).await;
    gen_ai_agents::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/gen_ai_agents: {e}"))?;
    crate::db::model_pricing::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/model_pricing: {e}"))?;
    ratelimit::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/rate_limit_rules: {e}"))?;
    #[cfg(feature = "enterprise")]
    o2_ratelimit::dataresource::db::evict_org(org_id).await;
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::anomaly_detection::storage::delete_org_models(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/anomaly_model_objects: {e}"))?;
    // The model rows resolve their org through the configs, so they go first.
    anomaly_detection::models::delete_by_org(get_orm_client_rw().await, org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/anomaly_detection_models: {e}"))?;
    // These tables also hold restrictive folder FKs; drafts reference workflows.
    anomaly_detection::config::delete_by_org(get_orm_client_rw().await, org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/anomaly_detection_config: {e}"))?;
    // Runs, jobs and refs cascade from the checks.
    synthetics_checks::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/synthetics: {e}"))?;
    synthetics_probe_tokens::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/synthetics_probe_tokens: {e}"))?;
    synthetics_variables::delete_by_org(get_orm_client_rw().await, org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/synthetics_variables: {e}"))?;
    synthetics_environments::delete_by_org(get_orm_client_rw().await, org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/synthetics_environments: {e}"))?;
    synthetics_agents::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/synthetics_agents: {e}"))?;
    synthetics_locations::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/synthetics_locations: {e}"))?;
    // Presigned uploads use the default store; `job_upload` uses an account named like the org.
    infra::storage::del_org_prefix_strict(org_id, &format!("synthetics/{org_id}/"))
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/synthetics_artifacts: {e}"))?;
    workflows::delete_children_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/workflow_children: {e}"))?;
    workflows::delete_drafts_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/workflow_drafts: {e}"))?;
    workflows::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/workflows: {e}"))?;
    // Org-scoped, so a retry after the rows are gone still reaches every node.
    #[cfg(feature = "enterprise")]
    crate::db::workflows::evict_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/workflows_cache: {e}"))?;
    status_pages::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/status_pages: {e}"))?;
    // folders are safe to delete after dashboards, annotations, reports, and prompts are gone
    crate::db::folders::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/folders: {e}"))?;
    // destinations must be deleted before templates: destinations.template_id has a
    // FK (destinations_templates_fk) → templates.id, so templates cannot be removed
    // while any destination still references them.
    crate::db::alerts::destinations::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/destinations: {e}"))?;
    crate::db::alerts::templates::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/templates: {e}"))?;
    // Local only: deletion is refused while super-cluster replication is on.
    oncall_teams::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/oncall: {e}"))?;
    org_telephony::delete(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/org_telephony: {e}"))?;
    delete_org_fleet_resources(org_id).await?;
    crate::db::kv::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/kv_store: {e}"))?;
    rum_pa::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/rum_pa: {e}"))?;
    crate::rum_pa::service::emit_delete_org(org_id).await;
    delete_org_user_cipher_keys(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/user_cipher_keys: {e}"))?;
    delete_org_enrichment_tables(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/enrichment_tables: {e}"))?;
    delete_org_enrichment_url_jobs(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/enrichment_table_urls: {e}"))?;
    crate::db::backfill::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/backfill_jobs: {e}"))?;
    search_queue::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/search_queue: {e}"))?;
    query_history::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/query_history: {e}"))?;
    // re_pattern_stream_map references re_pattern with a restrictive FK.
    re_pattern_stream_map::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/re_pattern_stream_map: {e}"))?;
    re_pattern::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/re_pattern: {e}"))?;
    #[cfg(feature = "cloud")]
    trial_quota_usage::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/trial_quota_usage: {e}"))?;
    #[cfg(feature = "cloud")]
    infra::table::paid_overage_attribution::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/paid_overage_attribution: {e}"))?;
    // Through the db layer, not the table layer: it also evicts the token caches cluster-wide.
    crate::db::org_ingestion_tokens::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/org_ingestion_tokens: {e}"))?;
    // Same F6 pattern as the `_reset` handler: the table-layer delete alone leaves
    // every node's org cache intact forever (no TTL). On enterprise builds go
    // through the storage layer (clears local cache + super-cluster replication)
    // and emit an org-scope reload so remote nodes drop their cached copies too.
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::service_streams::evict_org(org_id).await;
        o2_enterprise::enterprise::service_streams::storage::ServiceStorage::delete_all(org_id)
            .await
            .map_err(|e| anyhow::anyhow!("step_delete_db_resources/service_streams: {e}"))?;
        infra::coordinator::service_streams::emit_reload_event(org_id)
            .await
            .map_err(|e| anyhow::anyhow!("step_delete_db_resources/service_streams_reload: {e}"))?;
    }
    #[cfg(not(feature = "enterprise"))]
    service_streams::delete_all(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/service_streams: {e}"))?;
    crate::db::system_settings::delete_org_settings(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/system_settings: {e}"))?;
    crate::db::functions::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/functions: {e}"))?;

    // Delete pipelines through the service layer so derived-stream triggers,
    // backfill jobs, OFGA ownership, and the executable-pipeline caches are all
    // torn down and evicted cluster-wide — a raw infra::pipeline::delete would
    // leave those side effects (and stale cache entries) behind.
    let pipelines = infra::pipeline::list_by_org(org_id).await?;
    for p in pipelines {
        let id = p.id.clone();
        crate::pipeline::delete_listed_pipeline(p)
            .await
            .map_err(|e| anyhow::anyhow!("step_delete_db_resources/pipeline {id}: {e}"))?;
    }
    // One delete takes any pipeline the listing missed; its triggers and jobs go at later steps.
    for id in infra::pipeline::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/pipelines: {e}"))?
    {
        crate::db::authz::remove_ownership(
            org_id,
            "pipelines",
            common::meta::authz::Authz::new(&id),
        )
        .await;
    }
    crate::db::pipeline_errors::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/pipeline_last_errors: {e}"))?;

    // Delete saved views from the meta key-value store. Reuse the canonical key
    // prefix const rather than hardcoding the path, so this stays correct if the
    // saved-views key layout ever changes.
    let db = infra::db::get_db().await;
    let prefix = format!(
        "{}/{org_id}/",
        crate::db::saved_view::SAVED_VIEWS_KEY_PREFIX
    );
    // with_prefix=true (bulk delete all of the org's views); NO_NEED_WATCH matches
    // saved_view::delete_view — no point emitting watch events for a disappearing org.
    db.delete(&prefix, true, infra::db::NO_NEED_WATCH, None)
        .await
        .map_err(|e| anyhow::anyhow!("saved_views delete error: {e}"))?;

    // Not `batch_remove`: it keys on origin id, and a stream's id is its name in every org.
    distinct_values::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/distinct_values: {e}"))?;
    crate::db::short_url::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/short_urls: {e}"))?;
    delete_org_sourcemaps(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/sourcemaps: {e}"))?;
    compactor_manual_jobs::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/compactor_manual_jobs: {e}"))?;
    // Org ids are reused, and a leftover row would hand the next org the deleted org's settings.
    alert_calibration::delete_by_org(get_orm_client_rw().await, org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/alert_calibration: {e}"))?;
    // Delete the S3 result objects backing this org's search jobs BEFORE dropping
    // the DB rows — the result paths are derived from each job's created_at/trace_id,
    // so once the rows are gone the objects can no longer be located and would leak.
    // (search_jobs service is enterprise-only; OSS just drops the rows below.)
    #[cfg(feature = "enterprise")]
    search_service::search_jobs::delete_org_result_files(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/search_job_results: {e}"))?;
    infra::table::search_job::search_jobs::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/search_jobs: {e}"))?;

    // Cloud-only resources: pending org invites, billing-group invites, and
    // billing-group memberships. The enterprise crate owns the ordering/error
    // handling; we invoke the single bundled entry point. Subscriptions are NOT
    // cancelled here — deletion is only reached once the org is billing-free
    // (enforced by the org_has_active_billing guard in initiate_deletion).
    #[cfg(feature = "cloud")]
    delete_org_domain_mappings(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/domain_org_mappings: {e}"))?;
    #[cfg(feature = "cloud")]
    o2_enterprise::enterprise::cloud::delete_org_cloud_resources(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/cloud_resources: {e}"))?;
    delete_org_offsets_and_caches(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/offsets_and_caches: {e}"))?;
    crate::db::organization::delete_org_setting(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/org_setting: {e}"))?;

    Ok(())
}

async fn step_delete_scheduler_triggers(org_id: &str) -> Result<(), anyhow::Error> {
    infra::scheduler::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("scheduler delete failed: {e}"))?;
    Ok(())
}

/// Map a user's org role to the OpenFGA relation used for their per-org access
/// tuple. `User` and `ServiceAccount` are granted via the `allowed_user` relation;
/// every other role uses its own name as the relation. Mirrors the mapping used on
/// normal user removal in `service::users`.
#[cfg(feature = "enterprise")]
fn user_fga_role(role: &config::meta::user::UserRole) -> String {
    use config::meta::user::UserRole;
    if *role == UserRole::ServiceAccount || *role == UserRole::User {
        "allowed_user".to_string()
    } else {
        role.to_string()
    }
}

async fn step_delete_users(org_id: &str) -> Result<(), anyhow::Error> {
    use infra::table::org_users;
    for member in org_users::list_users_by_org(org_id).await? {
        // Only this org's tuples go first; the transaction below decides the user.
        drop_member_tuples(org_id, &member.email, &member.role, false).await?;
        // Evicted while the rows exist, so a failed notification leaves the member for the retry.
        crate::db::org_users::evict_cached(org_id, &member.email)
            .await
            .map_err(|e| anyhow::anyhow!("evict org_user {}: {e}", member.email))?;
        let user_removed = org_users::remove_member(org_id, &member.email)
            .await
            .map_err(|e| anyhow::anyhow!("remove member {}: {e}", member.email))?;
        if user_removed {
            drop_member_tuples(org_id, &member.email, &member.role, true).await?;
        }
        announce_removed_member(org_id, &member.email, user_removed).await?;
    }
    // One transaction takes any member the listing missed; its tuples and events follow the rows.
    for member in org_users::remove_all_members(org_id).await? {
        drop_member_tuples(org_id, &member.email, &member.role, member.user_removed).await?;
        announce_removed_member(org_id, &member.email, member.user_removed).await?;
    }
    Ok(())
}

/// Drops the member's tuples in this org, or every tuple of the user once it has no other org.
#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
async fn drop_member_tuples(
    org_id: &str,
    email: &str,
    role: &config::meta::user::UserRole,
    whole_user: bool,
) -> Result<(), anyhow::Error> {
    #[cfg(feature = "enterprise")]
    if o2_openfga::config::get_config().enabled {
        if whole_user {
            o2_openfga::authorizer::authz::delete_user_tuples(email)
                .await
                .map_err(|e| anyhow::anyhow!("delete_user_tuples failed for {email}: {e}"))?;
        } else {
            let fga_role = user_fga_role(role);
            o2_openfga::authorizer::authz::delete_user_from_org(org_id, email, &fga_role)
                .await
                .map_err(|e| anyhow::anyhow!("delete_user_from_org failed for {email}: {e}"))?;
        }
    }
    Ok(())
}

/// Tells every node a member's rows are gone: the membership, or the whole user.
async fn announce_removed_member(
    org_id: &str,
    email: &str,
    user_removed: bool,
) -> Result<(), anyhow::Error> {
    if user_removed {
        crate::db::org_users::notify_removed_by_user(email).await?;
        crate::db::user::evict_cached(email)
            .await
            .map_err(|e| anyhow::anyhow!("evict user {email}: {e}"))?;
    } else {
        crate::db::org_users::evict_cached(org_id, email)
            .await
            .map_err(|e| anyhow::anyhow!("evict org_user {email}: {e}"))?;
    }
    Ok(())
}

#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
async fn emit_status_audit(org_id: &str, actor: &str, from: &str, to: &str) {
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::common::auditor;
        audit::audit(auditor::AuditMessage {
            user_email: actor.to_string(),
            org_id: org_id.to_string(),
            _timestamp: config::utils::time::now_micros(),
            protocol: auditor::Protocol::Http,
            delegated: None,
            response_meta: auditor::ResponseMeta {
                http_method: "SYSTEM".to_string(),
                http_path: format!("/system/org_cleanup/{from}_to_{to}"),
                http_query_params: String::new(),
                http_body: String::new(),
                http_response_code: 200,
                error_msg: None,
                trace_id: None,
            },
        })
        .await;
    }
}

pub async fn initiate_deletion(org_id: &str, initiated_by: &str) -> Result<(), anyhow::Error> {
    if super_cluster_enabled() {
        return Err(anyhow::anyhow!(SUPER_CLUSTER_REFUSAL));
    }

    // Before any status change, or step 900's own system-org guard would strand it in `deleting`.
    if org_id == config::DEFAULT_ORG || org_id == config::META_ORG_ID {
        return Err(anyhow::anyhow!("Cannot delete this organization"));
    }

    // Held until the new status is broadcast, so a stale tombstone purge cannot evict it.
    let guard = OrgLifecycleGuard::acquire(org_id).await?;
    let result = start_deletion(org_id, initiated_by).await;
    guard.release().await;
    result
}

/// Step 900, safe to repeat; returns true only for the run that tombstoned the org.
pub async fn step_delete_org_record(org_id: &str) -> Result<bool, anyhow::Error> {
    // Under the lock, so a status re-send that read `deleting` cannot land after `deleted`.
    let guard = OrgLifecycleGuard::acquire(org_id).await?;
    let tombstoned = tombstone_and_broadcast(org_id).await;
    guard.release().await;
    let (flipped, broadcast) = tombstoned?;
    // A retry finds the row already `deleted`, so only this run can audit the flip.
    if flipped {
        emit_status_audit(org_id, "system", "deleting", "deleted").await;
    }
    broadcast?;
    #[cfg(feature = "cloud")]
    crate::trial_quota::evict_org(org_id);
    // Last, so a failure above leaves the step row to be retried.
    infra::table::org_cleanup_tasks::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("delete_org_record/cleanup_tasks: {e}"))?;
    Ok(flipped)
}

/// Re-enqueues every `deleting` org that has no task rows, so its deletion runs again.
pub async fn reconcile() -> Result<usize, anyhow::Error> {
    let deleting = organizations::list_ids_by_status("deleting").await?;
    if deleting.is_empty() {
        return Ok(0);
    }
    let with_tasks: HashSet<String> = org_cleanup_tasks::list_orgs_with_tasks()
        .await?
        .into_iter()
        .collect();
    let mut requeued = 0;
    for org_id in deleting.iter().filter(|org| !with_tasks.contains(*org)) {
        match requeue(org_id).await {
            Ok(true) => {
                log::warn!("[org_cleanup] re-enqueued deleting org={org_id} that had no tasks");
                requeued += 1;
            }
            Ok(false) => {}
            Err(e) => log::error!("[org_cleanup] cannot re-enqueue org={org_id}: {e}"),
        }
    }
    Ok(requeued)
}

pub async fn retry(org_id: &str) -> Result<(), anyhow::Error> {
    if !requeue(org_id).await? && !unfinished_tombstone(org_id).await? {
        return Err(anyhow::anyhow!(
            "Organization {org_id} is not being deleted"
        ));
    }
    org_cleanup_tasks::reset_exhausted(org_id).await?;
    log::info!("[org_cleanup] retry requested for org={org_id}");
    Ok(())
}

/// Resurrect a soft-deleted org: pending_deletion → active, clear deleted_at, purge
/// any cleanup tasks, and unblock it across the cluster. No data was ever touched.
/// `actor` is the email of the _meta/root user performing the resurrection (for audit).
pub async fn resurrect_org(org_id: &str, actor: &str) -> Result<(), anyhow::Error> {
    // Under the lock, so a status re-send that read `pending_deletion` cannot re-block the org.
    let guard = OrgLifecycleGuard::acquire(org_id).await?;
    let restored = restore_active(org_id).await;
    guard.release().await;
    if let Some(deleted_at) = restored? {
        release_parked_triggers(org_id, deleted_at).await;
    }
    emit_status_audit(org_id, actor, "pending_deletion", "active").await;
    log::info!("[org_cleanup] resurrected org={org_id} by {actor}");
    Ok(())
}

/// A blocked org's due trigger runs next at the first point of its deletion's hourly grid.
pub fn parked_run_at(deleted_at: Option<i64>, now: i64) -> i64 {
    match deleted_at {
        Some(deleted_at) => {
            deleted_at + ((now - deleted_at).div_euclid(PARK_MICROS) + 1) * PARK_MICROS
        }
        None => now + PARK_MICROS,
    }
}

/// Drops this node's per-org state when the org goes; every node runs it from the status watch.
pub fn forget_gone_org(org_id: &str) {
    crate::traces::service_graph::v4::schedule::forget_org(org_id);
    crate::self_reporting::triggers_schema::forget_org(org_id);
    #[cfg(feature = "enterprise")]
    crate::ai_chat::forget_org(org_id);
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::oncall::notify::forget_org_breakers(org_id);
}

/// Promote every pending_deletion org whose grace window has elapsed to `deleting`
/// and enqueue its cleanup tasks. Returns the number promoted.
pub async fn promote_expired() -> Result<usize, anyhow::Error> {
    let grace_days = grace_period_days();
    if grace_days <= 0 || super_cluster_enabled() {
        return Ok(0);
    }
    let window_micros = grace_days * 24 * 3600 * 1_000_000;
    let now = config::utils::time::now_micros();

    // The DB, not this node's cache, which misses a pending event it never received.
    let pending_org_ids = organizations::list_ids_by_status(STATUS_PENDING_DELETION).await?;

    let mut promoted = 0usize;
    for org_id in pending_org_ids {
        // Held over the flip, so a compactor batch cannot drop rows of an org already deleting.
        let guard = match OrgLifecycleGuard::acquire(&org_id).await {
            Ok(guard) => guard,
            Err(e) => {
                log::error!("[org_cleanup] failed to promote org={org_id}: {e}");
                continue;
            }
        };
        let won = promote_pending(&org_id, now, window_micros).await;
        guard.release().await;
        if won {
            promoted += 1;
        }
    }
    Ok(promoted)
}

/// Removes tombstones older than `ORG_TOMBSTONE_DAYS`, which frees their ids for reuse.
pub async fn sweep_tombstones() -> Result<usize, anyhow::Error> {
    let cutoff = config::utils::time::now_micros() - ORG_TOMBSTONE_DAYS * 24 * 3600 * 1_000_000;
    sweep_tombstones_in(&DbTombstoneStore, cutoff).await
}

pub async fn run_promotion_scheduler() -> Result<(), anyhow::Error> {
    spawn_pausable_job!(
        "org_deletion_promotion",
        config::get_config().common.org_cleanup_poll_interval_secs,
        {
            match promote_expired().await {
                Ok(n) if n > 0 => log::info!("[org_cleanup] promoted {n} orgs to deleting"),
                Err(e) => log::error!("[org_cleanup] promotion error: {e}"),
                _ => {}
            }
            match sweep_tombstones().await {
                Ok(n) if n > 0 => log::info!("[org_cleanup] removed {n} expired tombstones"),
                Err(e) => log::error!("[org_cleanup] tombstone sweep error: {e}"),
                _ => {}
            }
            match crate::public_dashboards::purge_deleted().await {
                Ok(n) if n > 0 => log::info!("[org_cleanup] purged {n} revoked public links"),
                Err(e) => log::error!("[org_cleanup] public link purge error: {e}"),
                _ => {}
            }
            match reconcile().await {
                Ok(n) if n > 0 => log::warn!("[org_cleanup] re-enqueued {n} deleting orgs"),
                Err(e) => log::error!("[org_cleanup] reconcile error: {e}"),
                _ => {}
            }
            if let Err(e) = resend_blocked_statuses().await {
                log::error!("[org_cleanup] status re-send error: {e}");
            }
        }
    );
    Ok(())
}

/// Re-sends a blocked org's status once per status and deletion, for nodes that missed it.
pub async fn resend_blocked_statuses() -> Result<Vec<String>, anyhow::Error> {
    let mut current: HashMap<String, BlockedState> = HashMap::new();
    for status in [STATUS_PENDING_DELETION, STATUS_DELETING] {
        for (org_id, deleted_at) in organizations::list_ids_and_deleted_at_by_status(status).await?
        {
            current.insert(org_id, (status.to_string(), deleted_at));
        }
    }
    let changed: Vec<String> = {
        let mut resent = RESENT_STATUSES
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        resent.retain(|org_id, _| current.contains_key(org_id));
        current
            .iter()
            .filter(|(org_id, status)| resent.get(*org_id) != Some(*status))
            .map(|(org_id, _)| org_id.clone())
            .collect()
    };
    let mut sent = Vec::new();
    for org_id in changed {
        // Under the lock, so a resurrect or step 900 between the read and the send wins.
        let guard = match OrgLifecycleGuard::acquire(&org_id).await {
            Ok(guard) => guard,
            Err(e) => {
                log::error!("[org_cleanup] cannot re-send status of org={org_id}: {e}");
                continue;
            }
        };
        let resent = resend_status(&org_id).await;
        guard.release().await;
        match resent {
            Ok(Some(_)) => {
                // The listed state, so a change since the listing is re-sent on the next tick.
                if let Some(state) = current.get(&org_id) {
                    RESENT_STATUSES
                        .lock()
                        .unwrap_or_else(PoisonError::into_inner)
                        .insert(org_id.clone(), state.clone());
                }
                sent.push(org_id);
            }
            Ok(None) => {}
            Err(e) => log::error!("[org_cleanup] cannot re-send status of org={org_id}: {e}"),
        }
    }
    Ok(sent)
}

/// Moves an active org into deletion and broadcasts the block; the caller holds its lifecycle lock.
async fn start_deletion(org_id: &str, initiated_by: &str) -> Result<(), anyhow::Error> {
    let org = infra::table::organizations::get(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("org not found: {e}"))?;

    // Marketplace subscriptions and payer links only the customer can end, so deletion waits.
    #[cfg(feature = "cloud")]
    {
        if o2_enterprise::enterprise::cloud::billings::org_has_active_billing(org_id)
            .await
            .map_err(|e| anyhow::anyhow!("failed to check billing status: {e}"))?
        {
            return Err(anyhow::anyhow!(
                "Organization has an active subscription. Please cancel your subscription before deleting this organization."
            ));
        }
    }

    let grace_days = grace_period_days();

    if grace_days <= 0 {
        // The status CAS is the single guard against concurrent requests on any node.
        let won_race = enqueue_deletion(org_id, &org.org_name, "active", None)
            .await
            .map_err(|e| anyhow::anyhow!("failed to start deletion: {e}"))?;
        if !won_race {
            return Err(anyhow::anyhow!("Organization is already being deleted"));
        }
        broadcast_status(org_id, STATUS_DELETING).await;
        emit_status_audit(org_id, initiated_by, "active", "deleting").await;

        log::info!("[org_cleanup] initiated immediate deletion for org={org_id}");
        return Ok(());
    }

    // Clean-up waits for the grace period to expire, so the org stays restorable until then.
    let now = config::utils::time::now_micros();
    let won = infra::table::organizations::set_status_if_with_deleted_at(
        org_id,
        "active",
        "pending_deletion",
        Some(now),
    )
    .await
    .map_err(|e| anyhow::anyhow!("failed to set org status: {e}"))?;
    if !won {
        return Err(anyhow::anyhow!("Organization is already being deleted"));
    }
    broadcast_status(org_id, STATUS_PENDING_DELETION).await;
    emit_status_audit(org_id, initiated_by, "active", "pending_deletion").await;
    log::info!("[org_cleanup] soft-deleted org={org_id} (grace {grace_days}d)");
    Ok(())
}

/// Flips one expired pending org to `deleting`; the caller holds its lifecycle lock.
async fn promote_pending(org_id: &str, now: i64, window_micros: i64) -> bool {
    // A screen only: the promotion statement re-checks the status and the window on the primary.
    let org = match infra::table::organizations::get_from_db(org_id).await {
        Ok(o) => o,
        Err(e) => {
            log::warn!("[org_cleanup] promote: cannot load org={org_id}: {e}");
            return false;
        }
    };
    if org.status != "pending_deletion" {
        return false;
    }
    let Some(deleted_at) = org.deleted_at else {
        return false;
    };
    if now < deleted_at + window_micros {
        return false;
    }
    let due_before = Some(now - window_micros);
    let won = match enqueue_deletion(
        &org.identifier,
        &org.org_name,
        "pending_deletion",
        due_before,
    )
    .await
    {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "[org_cleanup] failed to promote org={}: {e}",
                org.identifier
            );
            return false;
        }
    };
    if !won {
        // Expected with several compactors: another node won the promotion CAS.
        log::debug!(
            "[org_cleanup] lost promotion race for org={} (another node promoted it)",
            org.identifier
        );
        return false;
    }
    broadcast_status(&org.identifier, STATUS_DELETING).await;
    emit_status_audit(&org.identifier, "system", "pending_deletion", "deleting").await;
    log::info!("[org_cleanup] promoted org={} to deleting", org.identifier);
    true
}

async fn enqueue_deletion(
    org_id: &str,
    org_name: &str,
    from: &str,
    due_before: Option<i64>,
) -> Result<bool, anyhow::Error> {
    let txn = get_orm_client_rw().await.begin().await?;
    let won = match due_before {
        Some(before) => organizations::promote_due_in(&txn, org_id, before).await?,
        None => organizations::set_status_if_in(&txn, org_id, from, "deleting").await?,
    };
    if !won {
        txn.rollback().await?;
        return Ok(false);
    }
    let enqueued = match forced_failure("enqueue") {
        Ok(()) => org_cleanup_tasks::add_batch_in(&txn, &fixed_steps(org_id, org_name))
            .await
            .map_err(anyhow::Error::from),
        Err(e) => Err(e),
    };
    if let Err(e) = enqueued {
        if let Err(rollback) = txn.rollback().await {
            log::error!("[org_cleanup] org={org_id} enqueue rollback failed: {rollback}");
        }
        return Err(e);
    }
    txn.commit().await?;
    organizations::invalidate_cache(Some(org_id)).await;
    Ok(true)
}

/// Runs after the status CAS, so a failed broadcast is only logged; the promotion tick re-sends it.
async fn broadcast_status(org_id: &str, status: &str) {
    let sent = broadcast_with_retry(org_id, BROADCAST_ATTEMPTS, || send_status(org_id, status));
    if let Err(e) = sent.await {
        log::warn!("[org_cleanup] org={org_id} is {status}; the promotion tick re-sends it: {e}");
    }
}

async fn send_status(org_id: &str, status: &str) -> Result<(), infra::errors::Error> {
    if status == STATUS_PENDING_DELETION {
        crate::db::org_status::broadcast_pending_deletion(org_id).await
    } else {
        crate::db::org_status::broadcast_deleting(org_id).await
    }
}

/// Re-broadcasting the same status is harmless, so a failed broadcast is simply repeated.
async fn broadcast_with_retry<F, Fut, E>(
    org_id: &str,
    attempts: u64,
    send: F,
) -> Result<(), anyhow::Error>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<(), E>>,
    E: std::fmt::Display,
{
    let mut attempt = 1;
    loop {
        match send().await {
            Ok(()) => return Ok(()),
            Err(e) if attempt >= attempts => {
                return Err(anyhow::anyhow!("broadcast failed {attempt} times: {e}"));
            }
            Err(e) => log::warn!("[org_cleanup] org={org_id} broadcast attempt {attempt}: {e}"),
        }
        tokio::time::sleep(std::time::Duration::from_millis(200 * attempt)).await;
        attempt += 1;
    }
}

/// Re-sends the row's status while it still blocks and returns it; the caller holds the org lock.
async fn resend_status(org_id: &str) -> Result<Option<String>, anyhow::Error> {
    let Some(status) = organizations::get_status_uncached(org_id).await? else {
        return Ok(None);
    };
    if status != STATUS_PENDING_DELETION && status != STATUS_DELETING {
        return Ok(None);
    }
    broadcast_with_retry(org_id, 1, || send_status(org_id, &status)).await?;
    Ok(Some(status))
}

/// Tombstones, then broadcasts, keeping the flip if the broadcast fails; caller holds the lock.
async fn tombstone_and_broadcast(
    org_id: &str,
) -> Result<(bool, Result<(), anyhow::Error>), anyhow::Error> {
    let flipped = crate::organization::tombstone_org(org_id).await?;
    let broadcast = crate::db::org_status::broadcast_deleted(org_id)
        .await
        .map_err(anyhow::Error::from);
    Ok((flipped, broadcast))
}

/// Flips a pending org back to active, unblocks it and returns its old `deleted_at`; under lock.
async fn restore_active(org_id: &str) -> Result<Option<i64>, anyhow::Error> {
    let Some(deleted_at) = infra::table::organizations::restore_pending(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("failed to set org status: {e}"))?
    else {
        return Err(anyhow::anyhow!(
            "Organization is not pending deletion (cannot resurrect)"
        ));
    };
    let _ = org_cleanup_tasks::delete_by_org(org_id).await;
    crate::db::org_status::set_active(org_id).await?;
    Ok(deleted_at)
}

/// Adds missing fixed steps only while the org is `deleting`, so a finished org is not revived.
async fn requeue(org_id: &str) -> Result<bool, anyhow::Error> {
    let Some(status) = organizations::get_status_uncached(org_id).await? else {
        return Ok(false);
    };
    if status != "deleting" {
        return Ok(false);
    }
    let org_name = organizations::get(org_id).await?.org_name;
    enqueue_deletion(org_id, &org_name, "deleting", None).await
}

/// A `deleted` org that still has task rows: step 900 flipped it but failed after, and may rerun.
async fn unfinished_tombstone(org_id: &str) -> Result<bool, anyhow::Error> {
    let status = organizations::get_status_uncached(org_id).await?;
    if status.as_deref() != Some(STATUS_DELETED) {
        return Ok(false);
    }
    Ok(!org_cleanup_tasks::list_by_org_status(org_id, None)
        .await?
        .is_empty())
}

/// Purges marked tombstones first, so an eviction that failed on an earlier sweep is retried.
async fn sweep_tombstones_in(
    store: &dyn TombstoneStore,
    cutoff: i64,
) -> Result<usize, anyhow::Error> {
    let mut tombstones = store.pending().await?;
    for tombstone in store.expired(cutoff).await? {
        if !tombstones.contains(&tombstone) {
            tombstones.push(tombstone);
        }
    }
    let mut purged = 0usize;
    for tombstone in tombstones {
        let org_id = &tombstone.org_id;
        match purge_tombstone(store, &tombstone).await {
            Ok(true) => {
                log::info!("[org_cleanup] removed tombstone org={org_id}");
                purged += 1;
            }
            Ok(false) => log::info!(
                "[org_cleanup] dropped purge mark of a re-used id org={org_id} generation={}",
                tombstone.generation
            ),
            Err(e) => log::error!("[org_cleanup] failed to remove tombstone org={org_id}: {e}"),
        }
    }
    Ok(purged)
}

/// Mark, delete the row, then unblock: unblocking first would reopen an id whose row still exists.
async fn purge_tombstone(
    store: &dyn TombstoneStore,
    tombstone: &Tombstone,
) -> Result<bool, anyhow::Error> {
    store.mark(tombstone).await?;
    store.remove_row(tombstone).await?;
    let guard = OrgLifecycleGuard::acquire(&tombstone.org_id).await?;
    let evicted = evict_unless_reused(store, &tombstone.org_id).await;
    guard.release().await;
    let evicted = evicted?;
    store.unmark(tombstone).await?;
    Ok(evicted)
}

/// Runs under the org's lifecycle lock, so no deletion can start between the read and the eviction.
async fn evict_unless_reused(
    store: &dyn TombstoneStore,
    org_id: &str,
) -> Result<bool, anyhow::Error> {
    // A blocking row now is a later org with this id, and its own lifecycle owns the status key.
    let reused = store
        .current_status(org_id)
        .await?
        .is_some_and(|status| infra::coordinator::org_status::is_blocking_status(&status));
    if !reused {
        store.broadcast_eviction(org_id).await?;
    }
    Ok(!reused)
}

/// Makes the org's parked triggers due again, so a restored org's alerts resume on their schedule.
async fn release_parked_triggers(org_id: &str, deleted_at: i64) {
    let now = config::utils::time::now_micros();
    if let Err(e) = infra::scheduler::release_parked(org_id, deleted_at, PARK_MICROS, now).await {
        log::error!("[org_cleanup] org={org_id} cannot release parked triggers: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every table with a restrictive FK into `folders`, and the call that empties it.
    const FOLDER_CHILD_DELETES: &[(&str, &str)] = &[
        ("dashboards", "dashboards::delete_by_org(org_id)"),
        ("alerts", "delete_org_alerts(org_id)"),
        ("reports", "delete_org_reports(org_id)"),
        ("llm_prompts", "llm_prompts::delete_by_org(org_id)"),
        (
            "anomaly_detection_config",
            "anomaly_detection::config::delete_by_org(",
        ),
        ("synthetics", "synthetics_checks::delete_by_org(org_id)"),
        ("workflows", "workflows::delete_by_org(org_id)"),
        ("workflow_drafts", "workflows::delete_drafts_by_org(org_id)"),
        ("downtimes", "delete_org_downtimes(org_id)"),
    ];

    /// Cached entities step 300 deletes through the db layer, never the raw table module.
    const DB_LAYER_DELETES: [&str; 11] = [
        "backfill_jobs",
        "dashboards",
        "destinations",
        "enrichment_table_urls",
        "enrichment_tables",
        "folders",
        "kv_store",
        "reports",
        "short_urls",
        "system_settings",
        "templates",
    ];

    /// Every infra and db-layer source the org-deletion program touches, by path under `src/`.
    const TEARDOWN_SOURCES: [(&str, &str); 92] = [
        (
            "db/src/alerts/alert.rs",
            include_str!("../../../db/src/alerts/alert.rs"),
        ),
        (
            "db/src/alerts/destinations.rs",
            include_str!("../../../db/src/alerts/destinations.rs"),
        ),
        (
            "db/src/alerts/templates.rs",
            include_str!("../../../db/src/alerts/templates.rs"),
        ),
        ("db/src/authz.rs", include_str!("../../../db/src/authz.rs")),
        (
            "db/src/backfill.rs",
            include_str!("../../../db/src/backfill.rs"),
        ),
        (
            "db/src/compact/downsampling.rs",
            include_str!("../../../db/src/compact/downsampling.rs"),
        ),
        (
            "db/src/compact/files.rs",
            include_str!("../../../db/src/compact/files.rs"),
        ),
        (
            "db/src/downtimes.rs",
            include_str!("../../../db/src/downtimes.rs"),
        ),
        (
            "db/src/enrichment_table.rs",
            include_str!("../../../db/src/enrichment_table.rs"),
        ),
        (
            "db/src/folders.rs",
            include_str!("../../../db/src/folders.rs"),
        ),
        (
            "db/src/functions.rs",
            include_str!("../../../db/src/functions.rs"),
        ),
        (
            "db/src/keys/mod.rs",
            include_str!("../../../db/src/keys/mod.rs"),
        ),
        ("db/src/kv.rs", include_str!("../../../db/src/kv.rs")),
        ("db/src/lib.rs", include_str!("../../../db/src/lib.rs")),
        (
            "db/src/metrics.rs",
            include_str!("../../../db/src/metrics.rs"),
        ),
        (
            "db/src/model_pricing.rs",
            include_str!("../../../db/src/model_pricing.rs"),
        ),
        (
            "db/src/org_ingestion_tokens.rs",
            include_str!("../../../db/src/org_ingestion_tokens.rs"),
        ),
        (
            "db/src/org_status.rs",
            include_str!("../../../db/src/org_status.rs"),
        ),
        (
            "db/src/org_storage.rs",
            include_str!("../../../db/src/org_storage.rs"),
        ),
        (
            "db/src/org_users.rs",
            include_str!("../../../db/src/org_users.rs"),
        ),
        (
            "db/src/organization.rs",
            include_str!("../../../db/src/organization.rs"),
        ),
        (
            "db/src/short_url.rs",
            include_str!("../../../db/src/short_url.rs"),
        ),
        (
            "db/src/sourcemaps.rs",
            include_str!("../../../db/src/sourcemaps.rs"),
        ),
        (
            "db/src/system_settings.rs",
            include_str!("../../../db/src/system_settings.rs"),
        ),
        (
            "db/src/teardown.rs",
            include_str!("../../../db/src/teardown.rs"),
        ),
        ("db/src/user.rs", include_str!("../../../db/src/user.rs")),
        (
            "db/src/workflows.rs",
            include_str!("../../../db/src/workflows.rs"),
        ),
        (
            "infra/src/db/mod.rs",
            include_str!("../../../infra/src/db/mod.rs"),
        ),
        (
            "infra/src/db/nats.rs",
            include_str!("../../../infra/src/db/nats.rs"),
        ),
        (
            "infra/src/db/postgres.rs",
            include_str!("../../../infra/src/db/postgres.rs"),
        ),
        (
            "infra/src/db/sqlite.rs",
            include_str!("../../../infra/src/db/sqlite.rs"),
        ),
        (
            "infra/src/file_list/mod.rs",
            include_str!("../../../infra/src/file_list/mod.rs"),
        ),
        (
            "infra/src/file_list/postgres.rs",
            include_str!("../../../infra/src/file_list/postgres.rs"),
        ),
        (
            "infra/src/file_list/sqlite.rs",
            include_str!("../../../infra/src/file_list/sqlite.rs"),
        ),
        (
            "infra/src/pipeline/mod.rs",
            include_str!("../../../infra/src/pipeline/mod.rs"),
        ),
        (
            "infra/src/pipeline/postgres.rs",
            include_str!("../../../infra/src/pipeline/postgres.rs"),
        ),
        (
            "infra/src/pipeline/sqlite.rs",
            include_str!("../../../infra/src/pipeline/sqlite.rs"),
        ),
        (
            "infra/src/scheduler/mod.rs",
            include_str!("../../../infra/src/scheduler/mod.rs"),
        ),
        (
            "infra/src/scheduler/postgres.rs",
            include_str!("../../../infra/src/scheduler/postgres.rs"),
        ),
        (
            "infra/src/scheduler/sqlite.rs",
            include_str!("../../../infra/src/scheduler/sqlite.rs"),
        ),
        (
            "infra/src/table/ai_chat_sessions.rs",
            include_str!("../../../infra/src/table/ai_chat_sessions.rs"),
        ),
        (
            "infra/src/table/ai_chat_shares.rs",
            include_str!("../../../infra/src/table/ai_chat_shares.rs"),
        ),
        (
            "infra/src/table/ai_chat_turns.rs",
            include_str!("../../../infra/src/table/ai_chat_turns.rs"),
        ),
        (
            "infra/src/table/alerts/mod.rs",
            include_str!("../../../infra/src/table/alerts/mod.rs"),
        ),
        (
            "infra/src/table/anomaly_detection/config.rs",
            include_str!("../../../infra/src/table/anomaly_detection/config.rs"),
        ),
        (
            "infra/src/table/anomaly_detection/models.rs",
            include_str!("../../../infra/src/table/anomaly_detection/models.rs"),
        ),
        (
            "infra/src/table/backfill_jobs.rs",
            include_str!("../../../infra/src/table/backfill_jobs.rs"),
        ),
        (
            "infra/src/table/cipher.rs",
            include_str!("../../../infra/src/table/cipher.rs"),
        ),
        (
            "infra/src/table/compactor_manual_jobs.rs",
            include_str!("../../../infra/src/table/compactor_manual_jobs.rs"),
        ),
        (
            "infra/src/table/dashboards.rs",
            include_str!("../../../infra/src/table/dashboards.rs"),
        ),
        (
            "infra/src/table/destinations.rs",
            include_str!("../../../infra/src/table/destinations.rs"),
        ),
        (
            "infra/src/table/downtimes.rs",
            include_str!("../../../infra/src/table/downtimes.rs"),
        ),
        (
            "infra/src/table/enrichment_table_urls.rs",
            include_str!("../../../infra/src/table/enrichment_table_urls.rs"),
        ),
        (
            "infra/src/table/enrichment_tables.rs",
            include_str!("../../../infra/src/table/enrichment_tables.rs"),
        ),
        (
            "infra/src/table/external_alerts.rs",
            include_str!("../../../infra/src/table/external_alerts.rs"),
        ),
        (
            "infra/src/table/folders.rs",
            include_str!("../../../infra/src/table/folders.rs"),
        ),
        (
            "infra/src/table/gen_ai_agents.rs",
            include_str!("../../../infra/src/table/gen_ai_agents.rs"),
        ),
        (
            "infra/src/table/incident_integrations.rs",
            include_str!("../../../infra/src/table/incident_integrations.rs"),
        ),
        (
            "infra/src/table/kv_store.rs",
            include_str!("../../../infra/src/table/kv_store.rs"),
        ),
        (
            "infra/src/table/llm_eval.rs",
            include_str!("../../../infra/src/table/llm_eval.rs"),
        ),
        (
            "infra/src/table/llm_secrets.rs",
            include_str!("../../../infra/src/table/llm_secrets.rs"),
        ),
        (
            "infra/src/table/mod.rs",
            include_str!("../../../infra/src/table/mod.rs"),
        ),
        (
            "infra/src/table/model_pricing.rs",
            include_str!("../../../infra/src/table/model_pricing.rs"),
        ),
        (
            "infra/src/table/oncall_policies.rs",
            include_str!("../../../infra/src/table/oncall_policies.rs"),
        ),
        (
            "infra/src/table/oncall_teams.rs",
            include_str!("../../../infra/src/table/oncall_teams.rs"),
        ),
        (
            "infra/src/table/oncall_user_contacts.rs",
            include_str!("../../../infra/src/table/oncall_user_contacts.rs"),
        ),
        (
            "infra/src/table/online_eval_jobs/mod.rs",
            include_str!("../../../infra/src/table/online_eval_jobs/mod.rs"),
        ),
        (
            "infra/src/table/org_ai_toolsets.rs",
            include_str!("../../../infra/src/table/org_ai_toolsets.rs"),
        ),
        (
            "infra/src/table/org_cleanup_tasks.rs",
            include_str!("../../../infra/src/table/org_cleanup_tasks.rs"),
        ),
        (
            "infra/src/table/org_ingestion_tokens.rs",
            include_str!("../../../infra/src/table/org_ingestion_tokens.rs"),
        ),
        (
            "infra/src/table/org_storage_providers.rs",
            include_str!("../../../infra/src/table/org_storage_providers.rs"),
        ),
        (
            "infra/src/table/org_users.rs",
            include_str!("../../../infra/src/table/org_users.rs"),
        ),
        (
            "infra/src/table/organizations.rs",
            include_str!("../../../infra/src/table/organizations.rs"),
        ),
        (
            "infra/src/table/ratelimit.rs",
            include_str!("../../../infra/src/table/ratelimit.rs"),
        ),
        (
            "infra/src/table/reports/mod.rs",
            include_str!("../../../infra/src/table/reports/mod.rs"),
        ),
        (
            "infra/src/table/search_job/search_jobs.rs",
            include_str!("../../../infra/src/table/search_job/search_jobs.rs"),
        ),
        (
            "infra/src/table/short_urls.rs",
            include_str!("../../../infra/src/table/short_urls.rs"),
        ),
        (
            "infra/src/table/source_maps.rs",
            include_str!("../../../infra/src/table/source_maps.rs"),
        ),
        (
            "infra/src/table/status_pages.rs",
            include_str!("../../../infra/src/table/status_pages.rs"),
        ),
        (
            "infra/src/table/synthetics_agents.rs",
            include_str!("../../../infra/src/table/synthetics_agents.rs"),
        ),
        (
            "infra/src/table/synthetics_checks.rs",
            include_str!("../../../infra/src/table/synthetics_checks.rs"),
        ),
        (
            "infra/src/table/synthetics_environments.rs",
            include_str!("../../../infra/src/table/synthetics_environments.rs"),
        ),
        (
            "infra/src/table/synthetics_locations.rs",
            include_str!("../../../infra/src/table/synthetics_locations.rs"),
        ),
        (
            "infra/src/table/synthetics_probe_tokens.rs",
            include_str!("../../../infra/src/table/synthetics_probe_tokens.rs"),
        ),
        (
            "infra/src/table/synthetics_variables.rs",
            include_str!("../../../infra/src/table/synthetics_variables.rs"),
        ),
        (
            "infra/src/table/system_settings.rs",
            include_str!("../../../infra/src/table/system_settings.rs"),
        ),
        (
            "infra/src/table/templates.rs",
            include_str!("../../../infra/src/table/templates.rs"),
        ),
        (
            "infra/src/table/timed_annotations.rs",
            include_str!("../../../infra/src/table/timed_annotations.rs"),
        ),
        (
            "infra/src/table/user_auth_state.rs",
            include_str!("../../../infra/src/table/user_auth_state.rs"),
        ),
        (
            "infra/src/table/user_password_history.rs",
            include_str!("../../../infra/src/table/user_password_history.rs"),
        ),
        (
            "infra/src/table/users.rs",
            include_str!("../../../infra/src/table/users.rs"),
        ),
        (
            "infra/src/table/workflows.rs",
            include_str!("../../../infra/src/table/workflows.rs"),
        ),
    ];

    /// Teardowns whose evictions run before each row delete, through `teardown::evict_then_delete`.
    const EVICT_THEN_DELETE_USERS: [(&str, &str); 4] = [
        (
            include_str!("../../../db/src/alerts/destinations.rs"),
            "delete_by_org",
        ),
        (
            include_str!("../../../db/src/alerts/templates.rs"),
            "delete_by_org",
        ),
        (include_str!("../../../db/src/kv.rs"), "delete_by_org"),
        (include_str!("../dashboards/mod.rs"), "delete_by_org"),
    ];

    /// Inline teardowns that evict before and after the row delete: `(source, fn, evict, delete)`.
    const EVICTIONS_AROUND_DELETES: [(&str, &str, &str, &str); 3] = [
        (
            include_str!("../../../db/src/system_settings.rs"),
            "delete_org_settings",
            "evict_settings(",
            "db::delete_org_settings(",
        ),
        (
            include_str!("../../../db/src/short_url.rs"),
            "delete_by_org",
            "evict_short_url(",
            "short_urls::delete_by_org(",
        ),
        (
            include_str!("../../../db/src/downtimes.rs"),
            "delete_by_org",
            "evict_org(",
            "table::delete_by_org(",
        ),
    ];

    /// Restrictive FKs into `organizations` and `users`; both are emptied by step 600.
    const ORG_AND_USER_CHILD_DELETES: &[(&str, &str, &str)] = &[
        (
            "organizations",
            "org_users",
            "org_users::remove_all_members(org_id)",
        ),
        ("users", "org_users", "org_users::remove_member(org_id"),
    ];
    /// The membership and user deletes step 600 runs, each in one transaction.
    const INFRA_ORG_USERS_SOURCE: &str = include_str!("../../../infra/src/table/org_users.rs");

    struct FailingStreamDataCleanup;

    #[async_trait]
    impl StreamDataCleanup for FailingStreamDataCleanup {
        async fn delete_stream_data(
            &self,
            _org_id: &str,
            _stream_type: StreamType,
            _stream_name: &str,
        ) -> Result<(), anyhow::Error> {
            Err(anyhow::anyhow!("stream cleanup failed"))
        }

        async fn drain_deleted_files(&self, _org_id: &str) -> Result<DrainPass, anyhow::Error> {
            Err(anyhow::anyhow!("drain failed"))
        }
    }

    struct PendingRowsCleanup {
        passes: std::sync::Mutex<Vec<DrainPass>>,
    }

    #[async_trait]
    impl StreamDataCleanup for PendingRowsCleanup {
        async fn delete_stream_data(
            &self,
            _org_id: &str,
            _stream_type: StreamType,
            _stream_name: &str,
        ) -> Result<(), anyhow::Error> {
            Ok(())
        }

        async fn drain_deleted_files(&self, _org_id: &str) -> Result<DrainPass, anyhow::Error> {
            let mut passes = self.passes.lock().unwrap();
            Ok(if passes.is_empty() {
                DrainPass::default()
            } else {
                passes.remove(0)
            })
        }
    }

    #[derive(Default)]
    struct FakeTombstoneStore {
        rows: Arc<std::sync::Mutex<Vec<(Tombstone, &'static str)>>>,
        marks: std::sync::Mutex<Vec<Tombstone>>,
        blocked: Arc<std::sync::Mutex<Vec<String>>>,
        ops: Arc<std::sync::Mutex<Vec<String>>>,
        fail_broadcasts: std::sync::Mutex<usize>,
        fail_unmarks: std::sync::Mutex<usize>,
        deletion_on_status_read: std::sync::Mutex<bool>,
        deletion: std::sync::Mutex<Option<tokio::task::JoinHandle<()>>>,
    }

    impl FakeTombstoneStore {
        fn with_tombstone(org_id: &str, fail_broadcasts: usize, fail_unmarks: usize) -> Self {
            let store = Self::default();
            store.insert_row(org_id, 1, "deleted");
            *store.fail_broadcasts.lock().unwrap() = fail_broadcasts;
            *store.fail_unmarks.lock().unwrap() = fail_unmarks;
            store
        }

        fn insert_row(&self, org_id: &str, generation: i64, status: &'static str) {
            let tombstone = Tombstone {
                org_id: org_id.to_string(),
                generation,
            };
            self.rows.lock().unwrap().push((tombstone, status));
            if status != "active" {
                self.blocked.lock().unwrap().push(org_id.to_string());
            }
        }

        fn log(&self, op: &str, org_id: &str) {
            self.ops.lock().unwrap().push(format!("{op}:{org_id}"));
        }
    }

    #[async_trait]
    impl TombstoneStore for FakeTombstoneStore {
        async fn pending(&self) -> Result<Vec<Tombstone>, anyhow::Error> {
            Ok(self.marks.lock().unwrap().clone())
        }

        async fn expired(&self, before: i64) -> Result<Vec<Tombstone>, anyhow::Error> {
            Ok(self
                .rows
                .lock()
                .unwrap()
                .iter()
                .filter(|(t, status)| *status == "deleted" && t.generation < before)
                .map(|(t, _)| t.clone())
                .collect())
        }

        async fn mark(&self, tombstone: &Tombstone) -> Result<(), anyhow::Error> {
            self.log("mark", &tombstone.org_id);
            let mut marks = self.marks.lock().unwrap();
            if !marks.contains(tombstone) {
                marks.push(tombstone.clone());
            }
            Ok(())
        }

        async fn remove_row(&self, tombstone: &Tombstone) -> Result<bool, anyhow::Error> {
            self.log("remove_row", &tombstone.org_id);
            let mut rows = self.rows.lock().unwrap();
            let before = rows.len();
            rows.retain(|(t, status)| !(t == tombstone && *status == "deleted"));
            Ok(rows.len() < before)
        }

        async fn current_status(&self, org_id: &str) -> Result<Option<String>, anyhow::Error> {
            let status = self
                .rows
                .lock()
                .unwrap()
                .iter()
                .find(|(t, _)| t.org_id == org_id)
                .map(|(_, status)| status.to_string());
            let start_deletion = std::mem::take(&mut *self.deletion_on_status_read.lock().unwrap());
            if start_deletion {
                let mut deletion = tokio::spawn(concurrent_deletion(
                    org_id.to_string(),
                    Arc::clone(&self.rows),
                    Arc::clone(&self.blocked),
                    Arc::clone(&self.ops),
                ));
                // Gives the deletion every chance to land between this read and the eviction.
                if tokio::time::timeout(std::time::Duration::from_millis(200), &mut deletion)
                    .await
                    .is_err()
                {
                    *self.deletion.lock().unwrap() = Some(deletion);
                }
            }
            Ok(status)
        }

        async fn broadcast_eviction(&self, org_id: &str) -> Result<(), anyhow::Error> {
            self.log("broadcast", org_id);
            let mut failures = self.fail_broadcasts.lock().unwrap();
            if *failures > 0 {
                *failures -= 1;
                return Err(anyhow::anyhow!("coordinator unavailable"));
            }
            self.blocked.lock().unwrap().retain(|b| b != org_id);
            Ok(())
        }

        async fn unmark(&self, tombstone: &Tombstone) -> Result<(), anyhow::Error> {
            self.log("unmark", &tombstone.org_id);
            let mut failures = self.fail_unmarks.lock().unwrap();
            if *failures > 0 {
                *failures -= 1;
                return Err(anyhow::anyhow!("meta store unavailable"));
            }
            self.marks.lock().unwrap().retain(|m| m != tombstone);
            Ok(())
        }
    }

    #[test]
    fn test_grace_period_days_non_negative() {
        assert!(grace_period_days() >= 0);
    }

    #[test]
    fn test_fixed_steps_count() {
        let steps = fixed_steps("myorg", "My Org");
        assert_eq!(steps.len(), 10);
    }

    #[test]
    fn test_fixed_steps_order_ascending() {
        let steps = fixed_steps("myorg", "My Org");
        let orders: Vec<i32> = steps.iter().map(|s| s.step_order).collect();
        let mut sorted = orders.clone();
        sorted.sort();
        assert_eq!(orders, sorted, "step_orders must be strictly ascending");
    }

    #[test]
    fn test_fixed_steps_no_duplicates() {
        let steps = fixed_steps("myorg", "My Org");
        let mut seen = std::collections::HashSet::new();
        for s in &steps {
            assert!(seen.insert(s.step.clone()), "duplicate step: {}", s.step);
        }
    }

    #[test]
    fn test_fixed_steps_org_fields() {
        let steps = fixed_steps("acme", "Acme Corp");
        for s in &steps {
            assert_eq!(s.org_id, "acme");
            assert_eq!(s.org_name, "Acme Corp");
        }
    }

    #[test]
    fn test_fixed_steps_contains_all_expected() {
        let steps = fixed_steps("org", "Org");
        let names: Vec<&str> = steps.iter().map(|s| s.step.as_str()).collect();
        for expected in &[
            "delete_streams",
            "delete_file_list",
            "drain_deleted_files",
            "delete_db_resources",
            "delete_scheduler_triggers",
            "delete_users",
            "delete_streams_final",
            "delete_file_list_final",
            "drain_deleted_files_final",
            "delete_org_record",
        ] {
            assert!(names.contains(expected), "missing step: {expected}");
        }
    }

    #[test]
    fn test_fixed_steps_excludes_billing_and_standalone_ofga() {
        // Active billing blocks initiate_deletion, and step 900's tombstone_org removes the tuples.
        let steps = fixed_steps("org", "Org");
        let names: Vec<&str> = steps.iter().map(|s| s.step.as_str()).collect();
        assert!(!names.contains(&"delete_cloud_billing"));
        assert!(!names.contains(&"delete_ofga"));
    }

    #[test]
    fn test_fixed_steps_terminal_is_org_record() {
        // The org record (which also removes OFGA tuples) must be the LAST step.
        let steps = fixed_steps("org", "Org");
        let last = steps
            .iter()
            .max_by_key(|s| s.step_order)
            .expect("non-empty");
        assert_eq!(last.step, "delete_org_record");
    }

    #[test]
    fn test_step_order_constants() {
        const { assert!(ORDER_DELETE_STREAMS < ORDER_DELETE_STREAM_ITEM) };
        const { assert!(ORDER_DELETE_STREAM_ITEM < ORDER_DELETE_FILE_LIST) };
        const { assert!(ORDER_DELETE_FILE_LIST < ORDER_DRAIN_DELETED_FILES) };
        const { assert!(ORDER_DRAIN_DELETED_FILES < ORDER_DELETE_DB_RESOURCES) };
        const { assert!(ORDER_DELETE_DB_RESOURCES < ORDER_DELETE_SCHEDULER_TRIGGERS) };
        const { assert!(ORDER_DELETE_SCHEDULER_TRIGGERS < ORDER_DELETE_USERS) };
        const { assert!(ORDER_DELETE_USERS < ORDER_DELETE_STREAMS_FINAL) };
        const { assert!(ORDER_DELETE_STREAMS_FINAL < ORDER_DELETE_STREAM_FINAL_ITEM) };
        const { assert!(ORDER_DELETE_STREAM_FINAL_ITEM < ORDER_DELETE_FILE_LIST_FINAL) };
        const { assert!(ORDER_DELETE_FILE_LIST_FINAL < ORDER_DELETE_ORG_RECORD) };
    }

    #[test]
    fn test_streams_and_file_list_rerun_before_org_record() {
        let steps = fixed_steps("org", "Org");
        let order_of = |name: &str| {
            steps
                .iter()
                .find(|s| s.step == name)
                .unwrap_or_else(|| panic!("missing step: {name}"))
                .step_order
        };
        assert_eq!(order_of("delete_streams_final"), 700);
        assert_eq!(order_of("delete_file_list_final"), 800);
        assert!(order_of("delete_file_list_final") < order_of("delete_org_record"));

        let streams: Vec<common::meta::stream::StreamSchema> = ["s1", "s2"]
            .into_iter()
            .map(|name| common::meta::stream::StreamSchema {
                stream_name: name.to_string(),
                stream_type: StreamType::Logs,
                schema: arrow_schema::Schema::empty(),
            })
            .collect();
        let first = stream_item_tasks(
            "org",
            "Org",
            &streams,
            "delete_stream",
            ORDER_DELETE_STREAM_ITEM,
        );
        let last = stream_item_tasks(
            "org",
            "Org",
            &streams,
            "delete_stream_final",
            ORDER_DELETE_STREAM_FINAL_ITEM,
        );
        let steps_of = |tasks: &[org_cleanup_tasks::NewCleanupTask]| {
            tasks.iter().map(|t| t.step.clone()).collect::<Vec<_>>()
        };
        assert_eq!(
            steps_of(&last),
            vec!["delete_stream_final:logs/s1", "delete_stream_final:logs/s2"]
        );
        assert!(last.iter().all(|t| t.step_order == 750));
        assert!(first.iter().all(|t| t.step_order == 150));
        // The (org_id, step) unique index would drop a re-run that reused the 150 names.
        assert!(
            steps_of(&last)
                .iter()
                .all(|s| !steps_of(&first).contains(s))
        );
    }

    #[test]
    fn test_drain_step_sits_between_file_list_and_db_resources() {
        let steps = fixed_steps("org", "Org");
        let order_of = |name: &str| {
            steps
                .iter()
                .find(|s| s.step == name)
                .unwrap_or_else(|| panic!("missing step: {name}"))
                .step_order
        };
        assert_eq!(order_of("drain_deleted_files"), 250);
        assert!(order_of("delete_file_list") < order_of("drain_deleted_files"));
        assert!(order_of("drain_deleted_files") < order_of("delete_db_resources"));
    }

    #[tokio::test]
    async fn test_drain_step_maps_pending_rows_to_retry() {
        let waiting = DrainPass {
            removed: 3,
            pending: true,
            capped: false,
        };
        let cleanup = PendingRowsCleanup {
            passes: std::sync::Mutex::new(vec![waiting]),
        };
        let first = execute_step("org", "Org", "drain_deleted_files", &cleanup).await;
        let second = execute_step("org", "Org", "drain_deleted_files", &cleanup).await;
        assert_eq!(first.unwrap(), StepOutcome::Retry(waiting));
        assert_eq!(second.unwrap(), StepOutcome::Done);
    }

    #[test]
    fn test_drain_stalls_only_after_a_day_without_removing_a_row() {
        let hour = 3600 * 1_000_000;
        let now = 100 * hour;
        let quiet = DrainPass {
            pending: true,
            ..Default::default()
        };
        let busy = DrainPass {
            removed: 1,
            ..quiet
        };
        let clock = org_cleanup_tasks::stall_clock_message(now - 25 * hour);
        // However old the step is, a pass that removed rows restarts the clock.
        assert_eq!(progress_since(&busy, Some(&clock), now), now);
        assert!(!drain_stalled(
            progress_since(&busy, Some(&clock), now),
            now,
            120
        ));
        assert!(drain_stalled(
            progress_since(&quiet, Some(&clock), now),
            now,
            120
        ));
        let recent = org_cleanup_tasks::stall_clock_message(now - 23 * hour);
        assert!(!drain_stalled(
            progress_since(&quiet, Some(&recent), now),
            now,
            120
        ));
        let stalled = org_cleanup_tasks::stalled_message(now - 25 * hour);
        assert_eq!(progress_since(&quiet, Some(&stalled), now), now - 25 * hour);
        // An error from a failed attempt, or no message at all, starts a fresh clock.
        assert_eq!(progress_since(&quiet, Some("object store down"), now), now);
        assert_eq!(progress_since(&quiet, None, now), now);
    }

    #[tokio::test]
    async fn test_broadcast_retries_then_reports_without_panicking() {
        let calls = std::sync::atomic::AtomicU64::new(0);
        let failed = broadcast_with_retry("t-broadcast", 3, || {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async { Err::<(), _>("coordinator down") }
        })
        .await;
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 3);
        assert!(failed.unwrap_err().to_string().contains("3 times"));
        let sent = broadcast_with_retry("t-broadcast", 3, || async { Ok::<(), String>(()) }).await;
        assert!(sent.is_ok());
    }

    #[tokio::test]
    async fn test_drain_step_propagates_drain_error() {
        let err = execute_step(
            "org",
            "Org",
            "drain_deleted_files",
            &FailingStreamDataCleanup,
        )
        .await
        .unwrap_err();
        assert_eq!(err.to_string(), "drain failed");
    }

    /// One task row of `org_id`, claimed the way the worker claims it.
    async fn claimed_task(
        org_id: &str,
        step: &str,
    ) -> (org_cleanup_tasks::CleanupTask, org_cleanup_tasks::Claim) {
        org_cleanup_tasks::add_batch(&[org_cleanup_tasks::NewCleanupTask {
            org_id: org_id.to_string(),
            org_name: org_id.to_string(),
            step: step.to_string(),
            step_order: ORDER_DELETE_ORG_RECORD,
        }])
        .await
        .unwrap();
        let task = org_cleanup_tasks::list_by_org_status(org_id, None)
            .await
            .unwrap()
            .remove(0);
        let claim = org_cleanup_tasks::mark_running(&task.id)
            .await
            .unwrap()
            .expect("a new task can be claimed");
        (task, claim)
    }

    async fn add_tasks_for(org_id: &str, steps: &[(&str, i32)]) {
        let tasks: Vec<_> = steps
            .iter()
            .map(|(step, step_order)| org_cleanup_tasks::NewCleanupTask {
                org_id: org_id.to_string(),
                org_name: org_id.to_string(),
                step: step.to_string(),
                step_order: *step_order,
            })
            .collect();
        org_cleanup_tasks::add_batch(&tasks).await.unwrap();
    }

    #[tokio::test]
    async fn test_step_that_removed_its_own_row_is_not_a_lease_loss() {
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_own_row_{}", config::utils::time::now_micros());
        let (task, claim) = claimed_task(&org_id, "delete_org_record").await;
        org_cleanup_tasks::delete_by_org(&org_id).await.unwrap();
        let recorded = record_outcome(&task, &claim, Ok(StepOutcome::Done)).await;
        assert_eq!(recorded, Recorded::RowGone);
    }

    #[tokio::test]
    async fn test_draining_step_retries_however_old_and_stalls_only_without_progress() {
        if !meta_store().await {
            return;
        }
        let hour = 3600 * 1_000_000;
        let org_id = format!("t_drain_progress_{}", config::utils::time::now_micros());
        let (mut task, claim) = claimed_task(&org_id, "drain_deleted_files").await;
        let pass = |removed| DrainPass {
            removed,
            pending: true,
            capped: true,
        };
        // A step enqueued two days ago that still removes rows is neither stalled nor charged.
        task.created_at -= 48 * hour;
        let busy = record_outcome(&task, &claim, Ok(StepOutcome::Retry(pass(5)))).await;
        let after_busy = org_cleanup_tasks::list_by_org_status(&org_id, None)
            .await
            .unwrap()
            .remove(0);
        let claim = org_cleanup_tasks::mark_running(&task.id)
            .await
            .unwrap()
            .unwrap();
        task.last_error = Some(org_cleanup_tasks::stall_clock_message(
            config::utils::time::now_micros() - 25 * hour,
        ));
        let quiet = record_outcome(&task, &claim, Ok(StepOutcome::Retry(pass(0)))).await;
        let after_quiet = org_cleanup_tasks::list_by_org_status(&org_id, None)
            .await
            .unwrap()
            .remove(0);
        org_cleanup_tasks::delete_by_org(&org_id).await.unwrap();

        assert_eq!(busy, Recorded::Written);
        assert_eq!(
            (after_busy.status.as_str(), after_busy.attempts),
            ("pending", 0),
            "{after_busy:?}"
        );
        assert!(
            org_cleanup_tasks::stall_clock(after_busy.last_error.as_deref()).is_some(),
            "{after_busy:?}"
        );
        assert_eq!(quiet, Recorded::Written);
        assert_eq!(after_quiet.status, "failed", "{after_quiet:?}");
        assert!(
            after_quiet
                .last_error
                .as_deref()
                .is_some_and(|e| e.contains("drain stalled")),
            "{after_quiet:?}"
        );
    }

    /// One unclaimed drain row whose last pass recorded a stall clock `hours_ago`.
    async fn drain_task_with_clock(org_id: &str, hours_ago: i64) {
        add_tasks_for(
            org_id,
            &[("drain_deleted_files", ORDER_DRAIN_DELETED_FILES)],
        )
        .await;
        set_stall_clock(org_id, hours_ago).await;
    }

    /// Moves the org's stall clock to `hours_ago`, as if that long had passed without progress.
    async fn set_stall_clock(org_id: &str, hours_ago: i64) {
        use infra::table::entity::org_cleanup_tasks::{Column, Entity};
        use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, sea_query::Expr};
        let since = config::utils::time::now_micros() - hours_ago * 3600 * 1_000_000;
        Entity::update_many()
            .col_expr(
                Column::LastError,
                Expr::value(org_cleanup_tasks::stall_clock_message(since)),
            )
            .filter(Column::OrgId.eq(org_id))
            .exec(get_orm_client_rw().await)
            .await
            .unwrap();
    }

    fn drain_passes(passes: Vec<DrainPass>) -> Arc<dyn StreamDataCleanup> {
        Arc::new(PendingRowsCleanup {
            passes: std::sync::Mutex::new(passes),
        })
    }

    /// Runs `polls` worker polls of the org's drain row; the poll that found it exhausted, if any.
    async fn polls_until_exhausted(
        org_id: &str,
        cleanup: Arc<dyn StreamDataCleanup>,
        polls: usize,
    ) -> (Option<usize>, org_cleanup_tasks::CleanupTask) {
        let read = || async {
            org_cleanup_tasks::list_by_org_status(org_id, None)
                .await
                .unwrap()
                .remove(0)
        };
        for poll in 0..polls {
            let task = read().await;
            if is_exhausted(&task) {
                return (Some(poll), task);
            }
            process_org_tasks(vec![task], Arc::clone(&cleanup)).await;
        }
        let task = read().await;
        (is_exhausted(&task).then_some(polls), task)
    }

    #[tokio::test]
    async fn test_a_stalled_drain_is_exhausted_within_ten_polls_of_the_stall_bound() {
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_drain_stalled_{}", config::utils::time::now_micros());
        drain_task_with_clock(&org_id, 25).await;
        let quiet = DrainPass {
            pending: true,
            ..Default::default()
        };
        let polls = 3 * MAX_ATTEMPTS as usize;

        let (exhausted_at, task) =
            polls_until_exhausted(&org_id, drain_passes(vec![quiet; polls]), polls).await;
        org_cleanup_tasks::delete_by_org(&org_id).await.unwrap();

        assert_eq!(
            exhausted_at,
            Some(MAX_ATTEMPTS as usize),
            "a stalled attempt restarted the stall clock: {task:?}"
        );
        assert_eq!(task.status, "failed", "{task:?}");
        assert!(
            task.last_error
                .as_deref()
                .is_some_and(|e| e.starts_with("drain stalled")),
            "{task:?}"
        );
    }

    #[tokio::test]
    async fn test_a_drain_that_removes_rows_is_never_exhausted() {
        if !meta_store().await {
            return;
        }
        let now = config::utils::time::now_micros();
        let (busy_org, mixed_org) = (
            format!("t_drain_busy_{now}"),
            format!("t_drain_mixed_{now}"),
        );
        drain_task_with_clock(&busy_org, 25).await;
        drain_task_with_clock(&mixed_org, 25).await;
        let quiet = DrainPass {
            pending: true,
            ..Default::default()
        };
        let busy = DrainPass {
            removed: 1,
            ..quiet
        };
        let polls = 3 * MAX_ATTEMPTS as usize;
        // Three stalled attempts, then a pass that removes rows restarts the clock and the budget.
        let mut mixed = vec![quiet; 3];
        mixed.push(busy);
        mixed.resize(polls, quiet);

        let (busy_exhausted, busy_task) =
            polls_until_exhausted(&busy_org, drain_passes(vec![busy; polls]), polls).await;
        let (mixed_exhausted, mixed_task) =
            polls_until_exhausted(&mixed_org, drain_passes(mixed), polls).await;
        for org in [&busy_org, &mixed_org] {
            org_cleanup_tasks::delete_by_org(org).await.unwrap();
        }

        assert_eq!(busy_exhausted, None, "{busy_task:?}");
        assert_eq!(
            (busy_task.status.as_str(), busy_task.attempts),
            ("pending", 0),
            "{busy_task:?}"
        );
        assert_eq!(mixed_exhausted, None, "{mixed_task:?}");
        assert_eq!(
            (mixed_task.status.as_str(), mixed_task.attempts),
            ("pending", 0),
            "{mixed_task:?}"
        );
        let clock = org_cleanup_tasks::stall_clock(mixed_task.last_error.as_deref());
        assert!(clock.is_some_and(|c| c >= now), "{mixed_task:?}");
    }

    #[tokio::test]
    async fn test_a_drain_that_stalls_again_after_progress_gets_its_full_budget() {
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_drain_restall_{}", config::utils::time::now_micros());
        drain_task_with_clock(&org_id, 25).await;
        let quiet = DrainPass {
            pending: true,
            ..Default::default()
        };
        let busy = DrainPass {
            removed: 1,
            ..quiet
        };
        let polls = 3 * MAX_ATTEMPTS as usize;
        let mut passes = vec![quiet; 3];
        passes.push(busy);
        passes.resize(4 + polls, quiet);
        let cleanup = drain_passes(passes);

        let (first, after_progress) = polls_until_exhausted(&org_id, Arc::clone(&cleanup), 4).await;
        set_stall_clock(&org_id, 25).await;
        let (second, task) = polls_until_exhausted(&org_id, cleanup, polls).await;
        org_cleanup_tasks::delete_by_org(&org_id).await.unwrap();

        assert_eq!(first, None, "{after_progress:?}");
        assert_eq!(after_progress.attempts, 0, "{after_progress:?}");
        assert_eq!(
            second,
            Some(MAX_ATTEMPTS as usize),
            "stalls before the last productive pass spent the budget: {task:?}"
        );
    }

    #[tokio::test]
    async fn test_an_erroring_drain_is_exhausted_after_ten_polls() {
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_drain_erroring_{}", config::utils::time::now_micros());
        add_tasks_for(
            &org_id,
            &[("drain_deleted_files", ORDER_DRAIN_DELETED_FILES)],
        )
        .await;
        let polls = 3 * MAX_ATTEMPTS as usize;

        let (exhausted_at, task) =
            polls_until_exhausted(&org_id, Arc::new(FailingStreamDataCleanup), polls).await;
        org_cleanup_tasks::delete_by_org(&org_id).await.unwrap();

        assert_eq!(exhausted_at, Some(MAX_ATTEMPTS as usize), "{task:?}");
        assert_eq!(task.last_error.as_deref(), Some("drain failed"), "{task:?}");
    }

    /// Rows of `org` left in `table`, read with one statement on either backend.
    async fn rows_of(table: &str, org: &str) -> i64 {
        use sea_orm::{ConnectionTrait, Statement};
        let conn = get_orm_client_rw().await;
        let sql = format!("SELECT COUNT(*) FROM {table} WHERE org = '{org}'");
        let row = conn
            .query_one(Statement::from_string(conn.get_database_backend(), sql))
            .await
            .unwrap()
            .unwrap();
        row.try_get_by_index::<i64>(0).unwrap()
    }

    // SQLite's batch insert skips a file row whose min_ts or max_ts is 0.
    fn live_file_meta() -> config::meta::stream::FileMeta {
        config::meta::stream::FileMeta {
            min_ts: 1,
            max_ts: 2,
            ..Default::default()
        }
    }

    async fn seed_file_rows(org: &str, stream: &str, hours: usize, stamp: Option<i64>) {
        use sea_orm::ConnectionTrait;
        let meta = config::meta::stream::FileMeta {
            min_ts: 1,
            max_ts: 2,
            records: 1,
            original_size: 1,
            compressed_size: 1,
            index_size: 1,
            ..Default::default()
        };
        for hour in 0..hours {
            let key = format!("files/{org}/logs/{stream}/2026/01/01/{hour:02}/f.parquet");
            infra::file_list::add("", &key, &meta).await.unwrap();
        }
        if let Some(stamp) = stamp {
            get_orm_client_rw()
                .await
                .execute_unprepared(&format!(
                    "UPDATE file_list SET updated_at = {stamp} WHERE stream = '{org}/logs/{stream}'"
                ))
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn test_final_file_list_pass_reaches_late_streams_without_an_org_wide_read() {
        use config::meta::stream::{FileKey, StreamStats};
        use sea_orm::ConnectionTrait;
        if !meta_store().await {
            return;
        }
        let suffix = config::utils::time::now_micros();
        let (org, kept) = (format!("tflgone{suffix}"), format!("tflkeep{suffix}"));
        add_tasks_for(
            &org,
            &[("delete_stream:logs/listed", ORDER_DELETE_STREAM_ITEM)],
        )
        .await;
        // `listed` has a task row, `stats` a stats row, `late` only rows newer than step 200.
        seed_file_rows(&org, "listed", 3, Some(1)).await;
        seed_file_rows(&org, "stats", 2, Some(1)).await;
        infra::file_list::set_stream_stats(
            &org,
            StreamType::Logs,
            "stats",
            &StreamStats::default(),
            false,
        )
        .await
        .unwrap();
        seed_file_rows(&org, "late", 5, None).await;
        let history = FileKey::new(
            0,
            String::new(),
            format!("files/{org}/logs/late/2026/01/02/00/h.parquet"),
            live_file_meta(),
            false,
        );
        infra::file_list::batch_add_history(&[history])
            .await
            .unwrap();
        infra::file_list::add_job(&org, StreamType::Logs, "late", 1)
            .await
            .unwrap();
        for stream in ["listed", "stats", "late"] {
            seed_file_rows(&kept, stream, 1, None).await;
        }

        let tasks = org_cleanup_tasks::list_by_org_status(&org, None)
            .await
            .unwrap();
        let since = late_rows_since(&tasks, suffix);
        let until = config::utils::time::now_micros() + LATE_ROW_SLACK_MICROS;
        let found = infra::file_list::list_streams_updated_since(&org, since, until)
            .await
            .unwrap();
        let streams = org_file_streams(&org, &tasks, found).await.unwrap();
        // A batch of 2 makes every stream take several bounded statements.
        delete_org_file_rows(&org, &streams, 2, false)
            .await
            .unwrap();
        let left = [
            rows_of("file_list", &org).await,
            rows_of("file_list_history", &org).await,
            rows_of("file_list_jobs", &org).await,
            rows_of("stream_stats", &org).await,
        ];
        let queued = rows_of("file_list_deleted", &org).await;
        let others = rows_of("file_list", &kept).await;
        let conn = get_orm_client_rw().await;
        for table in ["file_list", "file_list_deleted"] {
            for owner in [&org, &kept] {
                conn.execute_unprepared(&format!("DELETE FROM {table} WHERE org = '{owner}'"))
                    .await
                    .unwrap();
            }
        }
        org_cleanup_tasks::delete_by_org(&org).await.unwrap();

        assert_eq!(
            streams,
            [
                format!("{org}/logs/late"),
                format!("{org}/logs/listed"),
                format!("{org}/logs/stats"),
            ]
        );
        assert_eq!(left, [0, 0, 0, 0], "file_list, history, jobs, stats");
        assert_eq!(queued, 10, "every live file row must queue its object");
        assert_eq!(
            others, 3,
            "another org's rows of the same streams were touched"
        );
    }

    #[tokio::test]
    async fn test_first_file_list_pass_queues_an_orphan_stream_and_the_final_pass_does_not_scan() {
        use config::meta::stream::FileKey;
        use sea_orm::ConnectionTrait;
        if !meta_store().await {
            return;
        }
        let suffix = config::utils::time::now_micros();
        let (org, kept) = (format!("tflorph{suffix}"), format!("tflokeep{suffix}"));
        add_tasks_for(
            &org,
            &[
                ("delete_file_list", ORDER_DELETE_FILE_LIST),
                ("delete_file_list_final", ORDER_DELETE_FILE_LIST_FINAL),
            ],
        )
        .await;
        // The orphan has no schema, stats row or task row, and no write since the deletion began.
        seed_file_rows(&org, "orphan", 3, Some(1)).await;
        seed_file_rows(&kept, "orphan", 2, Some(1)).await;
        let history = FileKey::new(
            0,
            String::new(),
            format!("files/{org}/logs/orphan/2026/01/02/00/h.parquet"),
            live_file_meta(),
            false,
        );
        infra::file_list::batch_add_history(&[history])
            .await
            .unwrap();
        let conn = get_orm_client_rw().await;
        conn.execute_unprepared(&format!(
            "UPDATE file_list_history SET updated_at = 1 WHERE org = '{org}'"
        ))
        .await
        .unwrap();
        infra::file_list::add_job(&org, StreamType::Logs, "orphan", 1)
            .await
            .unwrap();
        let count_left = || async {
            [
                rows_of("file_list", &org).await,
                rows_of("file_list_history", &org).await,
                rows_of("file_list_jobs", &org).await,
            ]
        };

        step_delete_file_list(&org, "delete_file_list")
            .await
            .unwrap();
        let after_first = count_left().await;
        let queued = rows_of("file_list_deleted", &org).await;
        // A second old stream appearing later is invisible to the final pass, which reads no scan.
        seed_file_rows(&org, "unseen", 2, Some(1)).await;
        step_delete_file_list(&org, "delete_file_list_final")
            .await
            .unwrap();
        let after_final = rows_of("file_list", &org).await;
        let steps: Vec<String> = org_cleanup_tasks::list_by_org_status(&org, None)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.step)
            .collect();
        let others = rows_of("file_list", &kept).await;
        for table in ["file_list", "file_list_deleted"] {
            for owner in [&org, &kept] {
                conn.execute_unprepared(&format!("DELETE FROM {table} WHERE org = '{owner}'"))
                    .await
                    .unwrap();
            }
        }
        org_cleanup_tasks::delete_by_org(&org).await.unwrap();

        assert_eq!(after_first, [0, 0, 0], "file_list, history, jobs");
        assert_eq!(
            queued, 3,
            "every orphan file row must queue its object before the drain"
        );
        assert_eq!(after_final, 2, "the final pass must not scan the org");
        assert!(
            steps.iter().any(|s| s == "drain_deleted_files_final"),
            "{steps:?}"
        );
        assert_eq!(
            others, 2,
            "another org's rows of the same stream were touched"
        );
    }

    #[tokio::test]
    async fn test_history_mode_queues_the_objects_of_history_rows() {
        use config::meta::stream::FileKey;
        use sea_orm::ConnectionTrait;
        if !meta_store().await {
            return;
        }
        let org = format!("tflhist{}", config::utils::time::now_micros());
        let history: Vec<FileKey> = (0..3)
            .map(|hour| {
                FileKey::new(
                    0,
                    String::new(),
                    format!("files/{org}/logs/old/2026/01/03/{hour:02}/h.parquet"),
                    live_file_meta(),
                    false,
                )
            })
            .collect();
        infra::file_list::batch_add_history(&history).await.unwrap();
        let streams = [format!("{org}/logs/old")];
        delete_org_file_rows(&org, &streams, 2, true).await.unwrap();
        let left = rows_of("file_list_history", &org).await;
        let queued = infra::file_list::query_deleted(&org, i64::MAX, 10)
            .await
            .unwrap();
        get_orm_client_rw()
            .await
            .execute_unprepared(&format!(
                "DELETE FROM file_list_deleted WHERE org = '{org}'"
            ))
            .await
            .unwrap();

        assert_eq!(left, 0);
        let mut files: Vec<String> = queued.into_iter().map(|f| f.file).collect();
        files.sort();
        assert_eq!(
            files,
            history.iter().map(|f| f.key.clone()).collect::<Vec<_>>(),
            "history mode keeps these objects, so only the drain can delete them"
        );
    }

    #[test]
    fn test_final_file_list_pass_looks_back_to_when_the_first_pass_began() {
        let hour = 3600 * 1_000_000;
        let task = |step: &str, order: i32, status: &str, created_at: i64, updated_at: i64| {
            org_cleanup_tasks::CleanupTask {
                id: step.to_string(),
                org_id: "org".to_string(),
                org_name: "Org".to_string(),
                step: step.to_string(),
                step_order: order,
                status: status.to_string(),
                attempts: 0,
                last_error: None,
                created_at,
                updated_at,
                running_by: None,
                lease_until: None,
            }
        };
        let streams = task(
            "delete_streams",
            ORDER_DELETE_STREAMS,
            "done",
            10 * hour,
            12 * hour,
        );
        let item = |done| {
            task(
                "delete_stream:logs/a",
                ORDER_DELETE_STREAM_ITEM,
                "done",
                12 * hour,
                done,
            )
        };
        let first = task(
            "delete_file_list",
            ORDER_DELETE_FILE_LIST,
            "done",
            10 * hour,
            40 * hour,
        );
        let drain = task(
            "drain_deleted_files",
            ORDER_DRAIN_DELETED_FILES,
            "done",
            10 * hour,
            45 * hour,
        );
        // Step 200 began after the last step-150 item at 20h, though it finished at 40h.
        let tasks = [streams.clone(), item(20 * hour), first.clone(), drain];
        assert_eq!(late_rows_since(&tasks, 50 * hour), 19 * hour);
        // A predecessor stamped after step 200 finished cannot have preceded it.
        let tasks = [streams, item(42 * hour), first.clone()];
        assert_eq!(late_rows_since(&tasks, 50 * hour), 11 * hour);
        assert_eq!(late_rows_since(&[first], 50 * hour), 9 * hour);
        assert_eq!(late_rows_since(&[], 50 * hour), 49 * hour);
    }

    #[tokio::test]
    async fn test_outcome_of_a_taken_over_step_is_a_lease_loss() {
        use sea_orm::ConnectionTrait;
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_taken_over_{}", config::utils::time::now_micros());
        let (task, stale) = claimed_task(&org_id, "delete_org_record").await;
        get_orm_client_rw()
            .await
            .execute_unprepared(&format!(
                "UPDATE org_cleanup_tasks SET lease_until = 1 WHERE id = '{}'",
                task.id
            ))
            .await
            .unwrap();
        let taken = org_cleanup_tasks::mark_running(&task.id).await.unwrap();
        let recorded = record_outcome(&task, &stale, Ok(StepOutcome::Done)).await;
        org_cleanup_tasks::delete_by_org(&org_id).await.unwrap();
        assert!(taken.is_some(), "the expired lease was not taken over");
        assert_eq!(recorded, Recorded::LeaseLost);
    }

    #[test]
    fn test_parked_runs_sit_on_the_deletion_grid() {
        let hour = PARK_MICROS;
        let deleted_at = 1_000_000_000;
        for now in [
            deleted_at,
            deleted_at + 1,
            deleted_at + hour - 1,
            deleted_at + 5 * hour,
        ] {
            let parked = parked_run_at(Some(deleted_at), now);
            assert!(parked > now && parked <= now + hour, "{now} -> {parked}");
            assert!(is_parked_run(parked, deleted_at), "{now} -> {parked}");
        }
        assert!(parked_run_at(Some(deleted_at), deleted_at - 10) > deleted_at - 10);
        assert_eq!(parked_run_at(None, 7), 7 + hour);
        assert!(!is_parked_run(deleted_at + hour + 1, deleted_at));
        assert!(!is_parked_run(deleted_at, deleted_at));
        assert!(!is_parked_run(deleted_at - hour, deleted_at));
    }

    #[test]
    fn test_drain_stall_bound_is_a_day_or_four_delays() {
        let hour = 3600 * 1_000_000;
        assert!(!drain_stalled(0, 24 * hour, 120));
        assert!(drain_stalled(0, 24 * hour + 1, 120));
        assert!(!drain_stalled(0, 40 * hour, 600));
        assert!(drain_stalled(0, 40 * hour + 1, 600));
    }

    #[test]
    fn test_exhausted_means_unfinished_and_out_of_attempts() {
        let task = |status: &str, attempts: i32| org_cleanup_tasks::CleanupTask {
            id: "id".to_string(),
            org_id: "org".to_string(),
            org_name: "Org".to_string(),
            step: "delete_db_resources".to_string(),
            step_order: ORDER_DELETE_DB_RESOURCES,
            status: status.to_string(),
            attempts,
            last_error: None,
            created_at: 0,
            updated_at: 0,
            running_by: None,
            lease_until: None,
        };
        assert!(is_exhausted(&task("failed", MAX_ATTEMPTS)));
        assert!(is_exhausted(&task("pending", MAX_ATTEMPTS)));
        assert!(!is_exhausted(&task("failed", MAX_ATTEMPTS - 1)));
        assert!(!is_exhausted(&task("done", MAX_ATTEMPTS)));
        assert!(!is_exhausted(&task("running", MAX_ATTEMPTS)));
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn test_initiate_refused_under_super_cluster() {
        assert!(!super_cluster_enabled());
        let err = initiate_deletion(config::META_ORG_ID, "root@example.com")
            .await
            .unwrap_err();
        assert!(!err.to_string().contains("super-cluster"), "{err}");
    }

    #[tokio::test]
    async fn test_sweep_removes_row_before_unblocking() {
        let store = FakeTombstoneStore::with_tombstone("t1", 0, 0);
        assert_eq!(sweep_tombstones_in(&store, 100).await.unwrap(), 1);
        assert_eq!(
            *store.ops.lock().unwrap(),
            vec!["mark:t1", "remove_row:t1", "broadcast:t1", "unmark:t1"]
        );
        assert!(store.rows.lock().unwrap().is_empty());
        assert!(store.blocked.lock().unwrap().is_empty());
        assert!(store.marks.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_sweep_retries_eviction_after_broadcast_failure() {
        let store = FakeTombstoneStore::with_tombstone("t1", 1, 0);
        assert_eq!(sweep_tombstones_in(&store, 100).await.unwrap(), 0);
        // The row is gone, so only the durable mark can bring the org back to the next sweep.
        assert!(store.rows.lock().unwrap().is_empty());
        assert_eq!(*store.blocked.lock().unwrap(), vec!["t1"]);
        assert_eq!(store.marks.lock().unwrap().len(), 1);

        assert_eq!(sweep_tombstones_in(&store, 100).await.unwrap(), 1);
        assert!(store.blocked.lock().unwrap().is_empty());
        assert!(store.marks.lock().unwrap().is_empty());
    }

    #[test]
    fn test_purge_key_round_trips_generation() {
        let tombstone = Tombstone {
            org_id: "t1".to_string(),
            generation: 42,
        };
        assert_eq!(tombstone.purge_key(), "/org_cleanup/tombstone_purge/t1/42");
        assert_eq!(
            Tombstone::from_purge_key(&tombstone.purge_key()),
            Some(tombstone)
        );
        assert_eq!(
            Tombstone::from_purge_key("/org_cleanup/tombstone_purge/t1"),
            None
        );
        assert_eq!(
            Tombstone::from_purge_key("/org_cleanup/tombstone_purge//42"),
            None
        );
    }

    /// A purge whose unmark failed, then the id is re-created and enters a new deletion.
    async fn stale_mark_with_reused_id(
        status: &'static str,
        generation: i64,
    ) -> FakeTombstoneStore {
        let store = FakeTombstoneStore::with_tombstone("t1", 0, 1);
        assert_eq!(sweep_tombstones_in(&store, 100).await.unwrap(), 0);
        assert!(store.blocked.lock().unwrap().is_empty());
        assert_eq!(store.marks.lock().unwrap().len(), 1, "unmark failed");
        store.insert_row("t1", generation, status);
        store.ops.lock().unwrap().clear();
        store
    }

    #[tokio::test]
    async fn test_stale_mark_keeps_block_of_recreated_org_under_deletion() {
        for status in ["pending_deletion", "deleting"] {
            let store = stale_mark_with_reused_id(status, 50).await;
            assert_eq!(sweep_tombstones_in(&store, 100).await.unwrap(), 0);
            assert_eq!(*store.blocked.lock().unwrap(), vec!["t1"], "{status}");
            assert_eq!(store.rows.lock().unwrap().len(), 1, "{status}");
            assert!(store.marks.lock().unwrap().is_empty(), "{status}");
            assert!(
                !store
                    .ops
                    .lock()
                    .unwrap()
                    .contains(&"broadcast:t1".to_string()),
                "{status}: {:?}",
                store.ops.lock().unwrap()
            );
        }
    }

    #[tokio::test]
    async fn test_stale_mark_keeps_fresh_tombstone_of_reused_id() {
        let store = stale_mark_with_reused_id("deleted", 200).await;
        assert_eq!(sweep_tombstones_in(&store, 100).await.unwrap(), 0);
        assert_eq!(store.rows.lock().unwrap().len(), 1, "retention cut short");
        assert_eq!(*store.blocked.lock().unwrap(), vec!["t1"]);
        assert!(store.marks.lock().unwrap().is_empty());
    }

    async fn concurrent_deletion(
        org_id: String,
        rows: Arc<std::sync::Mutex<Vec<(Tombstone, &'static str)>>>,
        blocked: Arc<std::sync::Mutex<Vec<String>>>,
        ops: Arc<std::sync::Mutex<Vec<String>>>,
    ) {
        let guard = OrgLifecycleGuard::acquire(&org_id).await.unwrap();
        for row in rows.lock().unwrap().iter_mut() {
            if row.0.org_id == org_id && row.1 == "active" {
                row.1 = "deleting";
            }
        }
        ops.lock()
            .unwrap()
            .push(format!("broadcast_deleting:{org_id}"));
        blocked.lock().unwrap().push(org_id);
        guard.release().await;
    }

    #[tokio::test]
    async fn test_deletion_started_during_stale_purge_keeps_its_block() {
        let store = stale_mark_with_reused_id("active", 50).await;
        *store.deletion_on_status_read.lock().unwrap() = true;
        sweep_tombstones_in(&store, 100).await.unwrap();
        let deletion = store.deletion.lock().unwrap().take();
        if let Some(deletion) = deletion {
            deletion.await.unwrap();
        }
        let ops = store.ops.lock().unwrap().clone();
        let at = |op: &str| ops.iter().position(|o| o == op).unwrap();
        assert!(at("broadcast:t1") < at("broadcast_deleting:t1"), "{ops:?}");
        assert_eq!(*store.blocked.lock().unwrap(), vec!["t1"], "{ops:?}");
        assert_eq!(store.rows.lock().unwrap()[0].1, "deleting");
        assert!(store.marks.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_initiate_deletion_waits_for_lifecycle_lock() {
        let guard = OrgLifecycleGuard::acquire("t-lifecycle").await.unwrap();
        let started = tokio::time::timeout(
            std::time::Duration::from_millis(200),
            initiate_deletion("t-lifecycle", "root@example.com"),
        )
        .await;
        guard.release().await;
        assert!(started.is_err(), "ran under a purge's lock: {started:?}");
    }

    /// An org row with `status`, as another node's write leaves it; `deleted_at` 1 is long expired.
    async fn org_row_with_status(prefix: &str, status: &str) -> String {
        use sea_orm::ConnectionTrait;
        let org_id = format!("{prefix}_{}", config::utils::time::now_micros());
        organizations::add(
            &org_id,
            &org_id,
            config::meta::organization::OrganizationType::Custom,
        )
        .await
        .unwrap();
        get_orm_client_rw()
            .await
            .execute_unprepared(&format!(
                "UPDATE organizations SET status = '{status}', deleted_at = 1 \
                 WHERE identifier = '{org_id}'"
            ))
            .await
            .unwrap();
        organizations::invalidate_cache(Some(&org_id)).await;
        common::infra::config::ORG_STATUS_CACHE.remove(&org_id);
        org_id
    }

    async fn drop_org_row(org_id: &str) {
        org_cleanup_tasks::delete_by_org(org_id).await.unwrap();
        organizations::remove(org_id).await.unwrap();
        common::infra::config::ORG_STATUS_CACHE.remove(org_id);
    }

    #[tokio::test]
    async fn test_promote_expired_waits_for_lifecycle_lock() {
        if grace_period_days() <= 0 || super_cluster_enabled() || !meta_store().await {
            return;
        }
        let org_id = org_row_with_status("t_promote_lifecycle", "pending_deletion").await;
        let guard = OrgLifecycleGuard::acquire(&org_id).await.unwrap();
        let promoted =
            tokio::time::timeout(std::time::Duration::from_millis(200), promote_expired()).await;
        guard.release().await;
        drop_org_row(&org_id).await;
        assert!(
            promoted.is_err(),
            "promoted outside the lifecycle lock: {promoted:?}"
        );
    }

    #[tokio::test]
    async fn test_promotion_finds_a_pending_org_this_node_never_heard_of() {
        if grace_period_days() <= 0 || super_cluster_enabled() || !meta_store().await {
            return;
        }
        let org_id = org_row_with_status("t_promote_unheard", "pending_deletion").await;
        let promoted = promote_expired().await.unwrap();
        let status = organizations::get_status_uncached(&org_id).await.unwrap();
        drop_org_row(&org_id).await;
        assert!(promoted >= 1);
        assert_eq!(status.as_deref(), Some("deleting"));
    }

    #[tokio::test]
    async fn test_status_resend_reblocks_a_node_that_missed_the_broadcast() {
        if !meta_store().await {
            return;
        }
        let pending = org_row_with_status("t_resend_pending", "pending_deletion").await;
        let deleting = org_row_with_status("t_resend_deleting", "deleting").await;
        let active = org_row_with_status("t_resend_active", "active").await;
        let first = resend_blocked_statuses().await.unwrap();
        let blocked =
            [&pending, &deleting, &active].map(|org| crate::db::org_status::is_blocked(org));
        let unchanged = resend_blocked_statuses().await.unwrap();
        organizations::set_status(&pending, "deleting")
            .await
            .unwrap();
        let promoted = resend_blocked_statuses().await.unwrap();
        for org in [&pending, &deleting, &active] {
            drop_org_row(org).await;
        }
        assert_eq!(blocked, [true, true, false]);
        assert!(
            first.contains(&pending) && first.contains(&deleting),
            "{first:?}"
        );
        assert!(!first.contains(&active), "{first:?}");
        assert!(
            !unchanged.contains(&pending) && !unchanged.contains(&deleting),
            "an unchanged status was re-sent again: {unchanged:?}"
        );
        assert!(
            promoted.contains(&pending),
            "a status change was not re-sent: {promoted:?}"
        );
        assert!(!promoted.contains(&deleting), "{promoted:?}");
    }

    #[tokio::test]
    async fn test_status_resend_repeats_after_a_resurrect_and_redelete() {
        use sea_orm::ConnectionTrait;
        if !meta_store().await {
            return;
        }
        let org = org_row_with_status("t_resend_redelete", "pending_deletion").await;
        let first = resend_blocked_statuses().await.unwrap();
        let unchanged = resend_blocked_statuses().await.unwrap();
        // A resurrect and a new soft delete between two ticks leave the status, not `deleted_at`.
        get_orm_client_rw()
            .await
            .execute_unprepared(&format!(
                "UPDATE organizations SET deleted_at = 2 WHERE identifier = '{org}'"
            ))
            .await
            .unwrap();
        let redeleted = resend_blocked_statuses().await.unwrap();
        drop_org_row(&org).await;
        assert!(first.contains(&org), "{first:?}");
        assert!(!unchanged.contains(&org), "{unchanged:?}");
        assert!(
            redeleted.contains(&org),
            "a re-delete with the same status was not re-sent: {redeleted:?}"
        );
    }

    #[tokio::test]
    async fn test_resurrect_and_tombstone_wait_for_lifecycle_lock() {
        if !meta_store().await {
            return;
        }
        let org_id = org_row_with_status("t_restore_lifecycle", "pending_deletion").await;
        let guard = OrgLifecycleGuard::acquire(&org_id).await.unwrap();
        let wait = std::time::Duration::from_millis(200);
        let restored = tokio::time::timeout(wait, resurrect_org(&org_id, "root@example.com")).await;
        let tombstoned = tokio::time::timeout(wait, step_delete_org_record(&org_id)).await;
        guard.release().await;
        let status = organizations::get_status_uncached(&org_id).await.unwrap();
        drop_org_row(&org_id).await;
        assert!(
            restored.is_err(),
            "resurrected outside the lock: {restored:?}"
        );
        assert!(
            tombstoned.is_err(),
            "tombstoned outside the lock: {tombstoned:?}"
        );
        assert_eq!(status.as_deref(), Some("pending_deletion"));
    }

    #[tokio::test]
    async fn test_retry_resets_the_leftover_steps_of_a_deleted_org_without_adding_any() {
        use sea_orm::ConnectionTrait;
        if !meta_store().await {
            return;
        }
        let org_id = org_row_with_status("t_retry_tombstone", STATUS_DELETED).await;
        let finished = retry(&org_id).await;
        let last = fixed_steps(&org_id, &org_id)
            .into_iter()
            .filter(|t| t.step_order == ORDER_DELETE_ORG_RECORD)
            .collect::<Vec<_>>();
        org_cleanup_tasks::add_batch(&last).await.unwrap();
        get_orm_client_rw()
            .await
            .execute_unprepared(&format!(
                "UPDATE org_cleanup_tasks SET status = 'failed', attempts = {MAX_ATTEMPTS} \
                 WHERE org_id = '{org_id}'"
            ))
            .await
            .unwrap();
        let retried = retry(&org_id).await;
        let tasks = org_cleanup_tasks::list_by_org_status(&org_id, None)
            .await
            .unwrap();
        let status = organizations::get_status_uncached(&org_id).await.unwrap();
        drop_org_row(&org_id).await;

        assert!(finished.is_err(), "a finished org was retried");
        retried.unwrap();
        assert_eq!(tasks.len(), 1, "a deleted org got new steps");
        assert!(!is_exhausted(&tasks[0]), "step 900 kept its spent budget");
        assert_eq!(status.as_deref(), Some(STATUS_DELETED));
    }

    #[tokio::test]
    async fn test_retried_eviction_unblocks_recreated_active_org() {
        let store = FakeTombstoneStore::with_tombstone("t1", 1, 0);
        assert_eq!(sweep_tombstones_in(&store, 100).await.unwrap(), 0);
        // A node that restarted after the row went no longer blocks the id, so it can re-create it.
        store.insert_row("t1", 50, "active");
        assert_eq!(sweep_tombstones_in(&store, 100).await.unwrap(), 1);
        assert!(store.blocked.lock().unwrap().is_empty());
        assert_eq!(store.rows.lock().unwrap().len(), 1);
        assert!(store.marks.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_delete_stream_propagates_data_cleanup_error() {
        let err = step_delete_stream("org", "logs/stream", &FailingStreamDataCleanup)
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), "stream cleanup failed");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_user_fga_role_mapping() {
        use config::meta::user::UserRole;
        // These two roles hold the `allowed_user` relation, not one named after the role.
        assert_eq!(user_fga_role(&UserRole::User), "allowed_user");
        assert_eq!(user_fga_role(&UserRole::ServiceAccount), "allowed_user");
        // Every other role maps to its own name.
        assert_eq!(user_fga_role(&UserRole::Admin), "admin");
        assert_eq!(user_fga_role(&UserRole::Editor), "editor");
        assert_eq!(user_fga_role(&UserRole::Viewer), "viewer");
        assert_eq!(user_fga_role(&UserRole::Root), "root");
        assert_eq!(user_fga_role(&UserRole::SreAgent), "sre_agent");
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn test_user_fga_role_matches_relation_names() {
        use config::meta::user::UserRole;
        // Mirrors the read_targets of o2_openfga delete_user_tuples on `org:` objects.
        let valid_org_relations = ["admin", "allowed_user", "editor", "viewer", "sre_agent"];
        for role in [
            UserRole::Admin,
            UserRole::Editor,
            UserRole::Viewer,
            UserRole::User,
            UserRole::ServiceAccount,
            UserRole::SreAgent,
        ] {
            let rel = user_fga_role(&role);
            assert!(
                valid_org_relations.contains(&rel.as_str()),
                "role {role:?} mapped to unknown org relation {rel:?}"
            );
        }
    }

    #[tokio::test]
    async fn test_emit_status_audit_does_not_panic() {
        emit_status_audit("test_org", "system", "active", "pending_deletion").await;
    }

    #[tokio::test]
    async fn test_promote_expired_noop_without_db() {
        // A positive grace period reads the DB, which only a TEST_DB_URL run has.
        if grace_period_days() > 0 && std::env::var("TEST_DB_URL").is_err() {
            return;
        }
        let r = promote_expired().await;
        assert!(r.is_ok());
    }

    /// The global meta store CI configures through `ZO_META_STORE`, migrated once per binary.
    async fn meta_store() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if std::env::var("ZO_META_STORE").is_err() {
            eprintln!("skipped: needs the meta store CI configures through ZO_META_STORE");
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::db_init().await.expect("meta store");
            infra::table::migrate().await.expect("migrations");
        })
        .await;
        true
    }

    #[tokio::test]
    async fn test_promote_reads_org_from_db_not_cache() {
        use sea_orm::ConnectionTrait;
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_promote_db_{}", config::utils::time::now_micros());
        organizations::add(
            &org_id,
            &org_id,
            config::meta::organization::OrganizationType::Custom,
        )
        .await
        .unwrap();
        assert_eq!(organizations::get(&org_id).await.unwrap().status, "active");
        // Another node's soft delete changes the row but not this node's cached copy.
        get_orm_client_rw()
            .await
            .execute_unprepared(&format!(
                "UPDATE organizations SET status = 'pending_deletion', deleted_at = 1 \
                 WHERE identifier = '{org_id}'"
            ))
            .await
            .unwrap();
        let promoted = promote_pending(&org_id, config::utils::time::now_micros(), 1).await;
        let status = organizations::get_status_uncached(&org_id).await.unwrap();
        org_cleanup_tasks::delete_by_org(&org_id).await.unwrap();
        organizations::remove(&org_id).await.unwrap();
        common::infra::config::ORG_STATUS_CACHE.remove(&org_id);
        assert!(promoted, "promotion judged the cached active copy");
        assert_eq!(status.as_deref(), Some("deleting"));
    }

    /// A pending org whose soft delete happened at `deleted_at`, as another node writes it.
    async fn pending_org(org_id: &str, deleted_at: i64) {
        organizations::add(
            org_id,
            org_id,
            config::meta::organization::OrganizationType::Custom,
        )
        .await
        .unwrap();
        let flipped = organizations::set_status_if_with_deleted_at(
            org_id,
            "active",
            STATUS_PENDING_DELETION,
            Some(deleted_at),
        )
        .await
        .unwrap();
        assert!(flipped);
    }

    async fn drop_org(org_id: &str) {
        org_cleanup_tasks::delete_by_org(org_id).await.unwrap();
        infra::scheduler::delete_by_org(org_id).await.unwrap();
        organizations::remove(org_id).await.unwrap();
        common::infra::config::ORG_STATUS_CACHE.remove(org_id);
    }

    fn report_trigger(
        org_id: &str,
        key: &str,
        next_run_at: i64,
    ) -> config::meta::triggers::Trigger {
        config::meta::triggers::Trigger {
            org: org_id.to_string(),
            module: config::meta::triggers::TriggerModule::Report,
            module_key: key.to_string(),
            next_run_at,
            status: config::meta::triggers::TriggerStatus::Waiting,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn test_the_promotion_statement_rechecks_the_grace_window() {
        if !meta_store().await {
            return;
        }
        let org_id = format!("t_promote_window_{}", config::utils::time::now_micros());
        let deleted_at = 1_000_000;
        pending_org(&org_id, deleted_at).await;

        let early = enqueue_deletion(
            &org_id,
            &org_id,
            STATUS_PENDING_DELETION,
            Some(deleted_at - 1),
        )
        .await
        .unwrap();
        let after_early = organizations::get_status_uncached(&org_id).await.unwrap();
        let due = enqueue_deletion(&org_id, &org_id, STATUS_PENDING_DELETION, Some(deleted_at))
            .await
            .unwrap();
        let after_due = organizations::get_status_uncached(&org_id).await.unwrap();
        let tasks = org_cleanup_tasks::list_by_org_status(&org_id, None)
            .await
            .unwrap();
        drop_org(&org_id).await;

        assert!(
            !early,
            "a stale screen promoted an org inside its grace window"
        );
        assert_eq!(after_early.as_deref(), Some(STATUS_PENDING_DELETION));
        assert!(due);
        assert_eq!(after_due.as_deref(), Some(STATUS_DELETING));
        assert_eq!(tasks.len(), fixed_steps(&org_id, &org_id).len());
    }

    #[tokio::test]
    async fn test_resurrect_releases_triggers_on_the_grid_of_the_deleted_at_it_cleared() {
        if !meta_store().await {
            return;
        }
        let now = config::utils::time::now_micros();
        let org_id = format!("t_resurrect_grid_{now}");
        let deleted_at = now - PARK_MICROS / 2;
        pending_org(&org_id, deleted_at).await;
        let parked = deleted_at + 3 * PARK_MICROS;
        let off_grid = parked + 1;
        for (key, at) in [("parked", parked), ("off_grid", off_grid)] {
            infra::scheduler::push(report_trigger(&org_id, key, at))
                .await
                .unwrap();
        }

        let resurrected = resurrect_org(&org_id, "t@example.com").await;
        let report = config::meta::triggers::TriggerModule::Report;
        let released = infra::scheduler::get(&org_id, report.clone(), "parked").await;
        let untouched = infra::scheduler::get(&org_id, report, "off_grid").await;
        let row = organizations::get_from_db(&org_id).await;
        drop_org(&org_id).await;

        resurrected.unwrap();
        assert!(
            released.unwrap().next_run_at < parked,
            "the parked trigger stayed parked"
        );
        assert_eq!(untouched.unwrap().next_run_at, off_grid);
        let row = row.unwrap();
        assert_eq!(row.status, "active");
        assert_eq!(row.deleted_at, None);
    }

    #[tokio::test]
    async fn test_a_parked_run_is_released_only_while_its_org_row_is_active() {
        if !meta_store().await {
            return;
        }
        let now = config::utils::time::now_micros();
        let org_id = format!("t_release_active_{now}");
        pending_org(&org_id, now - PARK_MICROS / 2).await;
        let parked = report_trigger(&org_id, "parked", now + PARK_MICROS);
        infra::scheduler::push(parked.clone()).await.unwrap();
        let moved = report_trigger(&org_id, "parked", now + 2 * PARK_MICROS);

        let while_pending = infra::scheduler::release_if_org_active(&parked, now).await;
        let flipped =
            organizations::set_status_if(&org_id, STATUS_PENDING_DELETION, "active").await;
        let other_write = infra::scheduler::release_if_org_active(&moved, now).await;
        let while_active = infra::scheduler::release_if_org_active(&parked, now).await;
        let report = config::meta::triggers::TriggerModule::Report;
        let row = infra::scheduler::get(&org_id, report, "parked").await;
        drop_org(&org_id).await;

        assert!(!while_pending.unwrap(), "a blocked org's run was released");
        assert!(flipped.unwrap());
        assert!(
            !other_write.unwrap(),
            "a run another write moved was released"
        );
        assert!(while_active.unwrap());
        assert_eq!(row.unwrap().next_run_at, now);
    }

    #[tokio::test]
    async fn test_the_org_trigger_delete_returns_exactly_the_triggers_it_removed() {
        if !meta_store().await {
            return;
        }
        let now = config::utils::time::now_micros();
        let (org_id, other) = (format!("t_trig_org_{now}"), format!("t_trig_other_{now}"));
        for (org, key) in [(&org_id, "a"), (&org_id, "b"), (&other, "a")] {
            infra::scheduler::push(report_trigger(org, key, now))
                .await
                .unwrap();
        }

        let mut removed = infra::scheduler::delete_by_org(&org_id).await.unwrap();
        removed.sort_by(|x, y| x.1.cmp(&y.1));
        let again = infra::scheduler::delete_by_org(&org_id).await.unwrap();
        let kept =
            infra::scheduler::get(&other, config::meta::triggers::TriggerModule::Report, "a").await;
        infra::scheduler::delete_by_org(&other).await.unwrap();

        let keys: Vec<&str> = removed.iter().map(|(_, key)| key.as_str()).collect();
        assert_eq!(keys, ["a", "b"]);
        assert!(again.is_empty());
        assert!(kept.is_ok(), "another org's trigger went with this org's");
    }

    #[tokio::test]
    async fn test_initiate_deletion_refuses_system_orgs() {
        // The guard runs before any status change, so this holds without a DB.
        for sys_org in [config::DEFAULT_ORG, config::META_ORG_ID] {
            let r = initiate_deletion(sys_org, "test@example.com").await;
            assert!(r.is_err(), "{sys_org} must not be deletable");
            assert!(
                r.unwrap_err().to_string().contains("Cannot delete"),
                "{sys_org} rejection should be the system-org guard"
            );
        }
    }

    #[tokio::test]
    async fn test_initiate_deletion_creates_tasks() {
        // Requires test DB setup — skip if not configured
        if std::env::var("TEST_DB_URL").is_err() {
            return;
        }
        let org_id = "test_org_deletion_001";
        let result = initiate_deletion(org_id, "test@example.com").await;
        assert!(result.is_ok(), "initiate_deletion failed: {:?}", result);

        let tasks = infra::table::org_cleanup_tasks::list_by_org_status(org_id, None)
            .await
            .unwrap();
        assert!(!tasks.is_empty(), "No cleanup tasks created");

        // Verify required first steps are present
        let steps: Vec<&str> = tasks.iter().map(|t| t.step.as_str()).collect();
        assert!(
            steps.contains(&"delete_streams"),
            "Missing delete_streams step"
        );
        assert!(
            steps.contains(&"delete_org_record"),
            "Missing delete_org_record step"
        );
    }

    // The step has no injection point, so its call order is pinned against its source text.
    const SOURCE: &str = include_str!("mod.rs");

    /// A body with any of these writes, or opens a transaction, on the connection it takes.
    const WRITE_MARKERS: [&str; 24] = [
        "delete",
        "update",
        "insert",
        "upsert",
        "execute",
        ".exec(",
        "exec_with_returning",
        "begin()",
        "DELETE",
        "UPDATE",
        "INSERT",
        "mark_",
        "renew_lease",
        "disown",
        "requeue",
        "reset_",
        "add_batch",
        "remove",
        "put(",
        "save",
        "set_",
        "create_table",
        "rename",
        "move_to",
    ];

    /// Primary reads and pools main already has; the program adds none.
    const MAIN_PRIMARY_READS: [(&str, &str); 6] = [
        ("infra/src/db/mod.rs", "get_orm_client_rw"),
        ("infra/src/db/mod.rs", "connect_to_orm_rw"),
        ("infra/src/db/sqlite.rs", "connect_rw"),
        ("infra/src/table/downtimes.rs", "get_rw"),
        ("infra/src/table/org_ingestion_tokens.rs", "get_by_name_rw"),
        (
            "infra/src/table/org_ingestion_tokens.rs",
            "list_splunk_guids_by_org",
        ),
    ];

    /// Status and existence reads the teardown takes besides its `*by_org*` listings.
    const TEARDOWN_READS: [&str; 8] = [
        "exists",
        "exists_for_org",
        "get_status_uncached",
        "get_from_db",
        "list_streams_updated_between",
        "list_org_streams_by_scan",
        "list_all_for_cleanup",
        "list_folders",
    ];

    /// The body of `step_delete_db_resources`, so a match cannot come from another fn or a test.
    fn db_resources_step() -> &'static str {
        let start = SOURCE
            .find("async fn step_delete_db_resources")
            .expect("step_delete_db_resources is defined in this file");
        let body = &SOURCE[start..];
        let end = body
            .find("\nasync fn step_delete_scheduler_triggers")
            .expect("the step is followed by step_delete_scheduler_triggers");
        &body[..end]
    }

    fn fn_body<'a>(source: &'a str, name: &str) -> &'a str {
        let start = source
            .find(&format!("fn {name}("))
            .unwrap_or_else(|| panic!("fn {name} is not defined"));
        let body = &source[start..];
        &body[..body.find("\n}\n").unwrap_or(body.len())]
    }

    /// The grid `release_parked` matches in SQL, which `parked_run_at` must land on.
    fn is_parked_run(next_run_at: i64, deleted_at: i64) -> bool {
        next_run_at > deleted_at && (next_run_at - deleted_at) % PARK_MICROS == 0
    }

    /// Every fn before the source's tests, with its body up to the brace that closes it.
    fn fn_bodies(source: &str) -> Vec<(&str, &str)> {
        let code = source.split("#[cfg(test)]").next().unwrap_or(source);
        let mut bodies = Vec::new();
        for (at, _) in code.match_indices("fn ") {
            let line_start = code[..at].rfind('\n').map_or(0, |i| i + 1);
            let prefix = &code[line_start..at];
            let qualifiers = [
                "pub",
                "async",
                "pub(crate)",
                "pub(super)",
                "const",
                "unsafe",
            ];
            if !prefix
                .split_whitespace()
                .all(|word| qualifiers.contains(&word))
            {
                continue;
            }
            let rest = &code[at + 3..];
            let name = &rest[..rest
                .find(|c: char| !(c.is_alphanumeric() || c == '_'))
                .unwrap_or(rest.len())];
            let Some(open) = rest.find(['{', ';']) else {
                continue;
            };
            if rest[open..].starts_with(';') {
                continue;
            }
            let indent = prefix.len() - prefix.trim_start().len();
            let close = format!("\n{}}}\n", " ".repeat(indent));
            let body = &rest[..rest.find(&close).unwrap_or(rest.len())];
            bodies.push((name, body));
        }
        bodies
    }

    fn position_of(call: &str) -> usize {
        db_resources_step()
            .find(call)
            .unwrap_or_else(|| panic!("step_delete_db_resources never calls {call}"))
    }

    /// Every SLO table, each swept for the org being torn down, or deletion orphans its rows.
    const SLO_DELETES: [&str; 4] = [
        "slo::delete_by_org(slo_conn, org_id)",
        "slo_backfill_jobs::delete_by_org(slo_conn, org_id)",
        "slos::delete_by_org(slo_conn, org_id)",
        "slo_budget::delete_by_org(slo_conn, org_id)",
    ];

    #[test]
    fn test_db_resources_deletes_every_slo_table() {
        for call in SLO_DELETES {
            position_of(call);
        }
    }

    #[test]
    fn test_downtimes_are_deleted_before_their_folders() {
        assert!(
            position_of("delete_org_downtimes(org_id)")
                < position_of("folders::delete_by_org(org_id)")
        );
    }

    #[test]
    fn test_db_resources_deletes_the_orgs_acks_and_slack_alert_messages() {
        position_of("alert_acks::delete_by_org(org_id)");
        position_of("slack_alert_messages::delete_by_org(org_id)");
    }

    #[test]
    fn test_db_resources_deletes_the_orgs_slack_rows() {
        let step = db_resources_step();
        let call = position_of("enterprise::slack::store::delete_org(org_id)");
        assert!(
            step[..call].ends_with("#[cfg(feature = \"enterprise\")]\n    o2_enterprise::"),
            "the Slack store exists only in enterprise builds"
        );
    }

    #[test]
    fn test_slos_are_deleted_before_alerts() {
        // An alert a live SLO reads from refuses deletion, so the SLOs go first.
        let alerts = position_of("delete_org_alerts(org_id)");
        for call in SLO_DELETES {
            assert!(
                position_of(call) < alerts,
                "{call} must run before delete_org_alerts"
            );
        }
    }

    #[test]
    fn test_no_raw_table_delete_remains_for_cached_entities() {
        let step = db_resources_step();
        let imported: Vec<&str> = step
            .match_indices("use infra::table::")
            .flat_map(|(at, _)| {
                let rest = &step[at..];
                rest[..rest.find(';').unwrap()]
                    .split(|c: char| !(c.is_alphanumeric() || c == '_'))
                    .filter(|word| !word.is_empty())
            })
            .collect();
        for module in DB_LAYER_DELETES {
            assert!(
                !imported.contains(&module),
                "step_delete_db_resources imports infra::table::{module}"
            );
            assert!(
                !step.contains(&format!("infra::table::{module}::")),
                "step_delete_db_resources calls infra::table::{module} directly"
            );
        }
    }

    #[test]
    fn test_no_teardown_source_reads_the_primary_outside_a_write() {
        let mut offenders = Vec::new();
        for (path, source) in TEARDOWN_SOURCES {
            for (name, body) in fn_bodies(source) {
                if MAIN_PRIMARY_READS.contains(&(path, name)) {
                    continue;
                }
                if name.ends_with("_rw") || name.contains("from_primary") {
                    offenders.push(format!("{path}: fn {name} is a standalone primary read"));
                }
                let teardown = name.contains("by_org") || TEARDOWN_READS.contains(&name);
                let reads_rw = body.contains("get_orm_client_rw()") || body.contains("CLIENT_RW");
                if teardown && reads_rw && !WRITE_MARKERS.iter().any(|m| body.contains(m)) {
                    offenders.push(format!(
                        "{path}: fn {name} reads the write pool without a write"
                    ));
                }
            }
        }
        assert!(offenders.is_empty(), "{offenders:#?}");
    }

    #[test]
    fn test_fn_bodies_flags_a_bare_primary_read() {
        let source = "pub async fn exists(id: &str) -> bool {\n    exists_in(get_orm_client_rw().await, id).await\n}\n\nasync fn wipe(org: &str) {\n    Entity::delete_many().exec(get_orm_client_rw().await).await;\n}\n";
        let bodies = fn_bodies(source);
        assert_eq!(
            bodies.iter().map(|(n, _)| *n).collect::<Vec<_>>(),
            ["exists", "wipe"]
        );
        let flagged: Vec<_> = bodies
            .iter()
            .filter(|(_, body)| !WRITE_MARKERS.iter().any(|m| body.contains(m)))
            .map(|(n, _)| *n)
            .collect();
        assert_eq!(flagged, ["exists"]);
    }

    #[test]
    fn test_chats_held_for_their_repurge_go_with_the_tombstone() {
        use infra::table::ai_chat_sessions::REPLICA_REPURGE_WINDOW_MICROS;
        const TOMBSTONE_MICROS: i64 = ORG_TOMBSTONE_DAYS * 24 * 3600 * 1_000_000;
        const { assert!(REPLICA_REPURGE_WINDOW_MICROS + LATE_ROW_SLACK_MICROS < TOMBSTONE_MICROS) };
    }

    #[test]
    fn test_ai_chat_replicas_then_children_go_before_their_chats() {
        let sessions = position_of("ai_chat_sessions::delete_by_org_except_repurging(org_id");
        let turns = position_of("ai_chat_turns::delete_by_org(org_id)");
        let shares = position_of("ai_chat_shares::delete_by_org(org_id)");
        assert!(turns < sessions && shares < sessions);
        assert!(position_of("crate::ai_chat::purge_org_replicas(org_id)") < turns.min(shares));
    }

    #[test]
    fn test_forget_gone_org_drops_every_node_local_mark() {
        let body = fn_body(SOURCE, "forget_gone_org");
        for forget in [
            "service_graph::v4::schedule::forget_org(org_id)",
            "triggers_schema::forget_org(org_id)",
            "ai_chat::forget_org(org_id)",
            "oncall::notify::forget_org_breakers(org_id)",
        ] {
            assert!(body.contains(forget), "forget_gone_org must call {forget}");
        }
    }

    #[test]
    fn test_late_writer_queues_are_evicted_before_their_rows_go() {
        for (evict, delete) in [
            (
                "enterprise::service_streams::evict_org(org_id)",
                "ServiceStorage::delete_all(org_id)",
            ),
            (
                "llm_evaluations::agent_registry::evict_org(org_id)",
                "gen_ai_agents::delete_by_org(org_id)",
            ),
        ] {
            assert!(
                position_of(evict) < position_of(delete),
                "{evict} must run before {delete}"
            );
        }
    }

    #[test]
    fn test_functions_teardown_signals_each_listed_key() {
        let body = fn_body(
            include_str!("../../../db/src/functions.rs"),
            "delete_by_org",
        );
        assert!(
            body.contains(".list_keys(&prefix)"),
            "the functions teardown must evict each listed key before the delete"
        );
        assert!(
            body.contains("delete_if_exists(&prefix, true, db::NEED_WATCH)"),
            "the prefix delete must stay watched, so other super-cluster regions evict too"
        );
    }

    #[test]
    fn test_pipeline_teardown_deletes_the_listed_pipeline_without_a_re_read() {
        assert!(
            db_resources_step().contains("crate::pipeline::delete_listed_pipeline(p)"),
            "the pipeline teardown must delete the pipeline it listed"
        );
        let body = fn_body(include_str!("../pipeline/mod.rs"), "delete_listed_pipeline");
        assert!(
            !body.contains("get_by_id("),
            "the listed pipeline must not be re-read through the read pool"
        );
    }

    #[test]
    fn test_inline_teardown_evictions_drop_the_local_copy_first() {
        for (source, evict) in [
            (
                include_str!("../../../db/src/system_settings.rs"),
                "evict_settings",
            ),
            (
                include_str!("../../../db/src/short_url.rs"),
                "evict_short_url",
            ),
        ] {
            assert!(
                fn_body(source, evict).contains("teardown::evict(local, broadcast)"),
                "{evict} must evict through teardown::evict"
            );
        }
    }

    #[test]
    fn test_teardown_evictions_precede_row_deletes() {
        for (source, teardown) in EVICT_THEN_DELETE_USERS {
            assert!(
                fn_body(source, teardown).contains("teardown::evict_then_delete("),
                "{teardown} must evict through teardown::evict_then_delete"
            );
        }
        for (source, teardown, evict, delete) in EVICTIONS_AROUND_DELETES {
            let body = fn_body(source, teardown);
            let deleted = body
                .find(delete)
                .unwrap_or_else(|| panic!("{teardown} must call {delete}"));
            assert!(
                body.find(evict).is_some_and(|at| at < deleted),
                "{teardown} must call {evict} before {delete}"
            );
            assert!(
                body.rfind(evict).is_some_and(|at| at > deleted),
                "{teardown} must call {evict} again after {delete}"
            );
        }
    }

    #[test]
    fn test_downtime_teardown_drops_every_tuple_before_the_row_delete() {
        let body = fn_body(
            include_str!("../../../db/src/downtimes.rs"),
            "delete_by_org",
        );
        let deleted = body
            .find("table::delete_by_org(")
            .expect("the downtime teardown must delete the org's rows");
        assert!(
            body.find("remove_ownership(")
                .is_some_and(|at| at < deleted),
            "a retry lists no deleted row, so each listed row's tuple must go before the row delete"
        );
        assert!(
            body[deleted..].contains(".filter(|(id, _)| !ids.contains(id))")
                && body[deleted..].contains("remove_ownership("),
            "a row only the delete returned must still lose its tuple"
        );
        assert!(
            body.contains("list_references_by_org_with("),
            "raw references must include unreadable rows and tombstones"
        );
        assert!(
            body.contains("let removed = table::delete_by_org(")
                && body[deleted..].contains("evict_org(org, &with_removed(ids, removed))"),
            "a row written after the id listing is deleted too, so it must still be evicted"
        );
    }

    #[test]
    fn test_dashboard_teardown_deletes_the_listed_row_without_a_re_read() {
        let body = fn_body(include_str!("../dashboards/mod.rs"), "delete_by_org");
        assert!(
            body.contains("table::dashboards::delete_from_folder("),
            "the dashboard teardown deletes by the folder and id it listed"
        );
        assert!(
            !body.contains("delete_dashboard(") && !body.contains("get_by_id("),
            "the dashboard teardown must not re-read the row through the read pool"
        );
    }

    #[test]
    fn test_db_resources_deletes_query_history() {
        position_of("query_history::delete_by_org(org_id)");
    }

    #[test]
    fn test_prompt_registry_is_deleted_before_folders() {
        assert!(
            position_of("llm_prompts::delete_by_org(org_id)")
                < position_of("folders::delete_by_org(org_id)"),
            "prompt rows must be deleted before the folders they reference"
        );
    }

    #[test]
    fn test_llm_bindings_deleted_before_score_configs() {
        assert!(
            position_of("llm_eval::delete_by_org(org_id)")
                < position_of("score_configs::delete_all_by_org(org_id)"),
            "annotation queue bindings hold a RESTRICT FK to score_configs"
        );
    }

    #[test]
    fn test_the_dek_outlives_every_row_encrypted_under_it() {
        for call in [
            "llm_secrets::delete_by_org(org_id)",
            "org_ai_toolsets::delete_by_org(org_id)",
            "providers::delete_all_by_org(org_id)",
            "synthetics_checks::delete_by_org(org_id)",
            "synthetics_variables::delete_by_org(",
        ] {
            assert!(position_of(call) < position_of("delete_org_offsets_and_caches(org_id)"));
        }
        assert!(
            !db_resources_step().contains("delete_org_cipher_keys("),
            "step 300 deletes the DEK while step 850 still holds provider rows encrypted under it"
        );
        position_of("delete_org_user_cipher_keys(org_id)");
        assert!(
            !fn_body(SOURCE, "execute_step").contains("delete_org_user_cipher_keys("),
            "the user keys wait for step 850, though no row step 850 reads is encrypted with them"
        );
        let final_drain = fn_body(SOURCE, "execute_step");
        let providers = final_drain
            .find("delete_org_storage_providers(org_id)")
            .expect("step 850 deletes the storage providers");
        let keys = final_drain
            .find("delete_org_cipher_keys(org_id)")
            .expect("step 850 deletes the cipher keys");
        assert!(providers < keys, "the keys went before the provider rows");
        const { assert!(ORDER_DELETE_DB_RESOURCES < ORDER_DRAIN_DELETED_FILES_FINAL) };
    }

    #[test]
    fn test_slo_children_are_deleted_before_their_definitions() {
        // Both children find their org only through `slos`, so wiping `slos` first strands them.
        let slos = position_of("slos::delete_by_org(slo_conn, org_id)");
        assert!(
            position_of("slo::delete_by_org(slo_conn, org_id)") < slos,
            "status rows must be deleted before the SLOs that identify them"
        );
        assert!(
            position_of("slo_backfill_jobs::delete_by_org(slo_conn, org_id)") < slos,
            "backfill jobs must be deleted before the SLOs that identify them"
        );
    }

    /// Teardown uses the unguarded delete, or one straggling SLO would stall it on endless retries.
    #[test]
    fn test_org_teardown_bypasses_the_slo_source_guard() {
        let start = SOURCE
            .find("async fn delete_org_alerts")
            .expect("delete_org_alerts is defined in this file");
        let body = &SOURCE[start..];
        let end = body
            .find("\n/// Delete every cipher key")
            .expect("delete_org_alerts is followed by delete_org_cipher_keys");
        let body = &body[..end];

        assert!(
            body.contains("crate::alerts::alert::delete_by_id(conn, org_id, alert_id)"),
            "org teardown must call the unguarded delete"
        );
        assert!(
            !body.contains("delete_by_id_user"),
            "org teardown must never route through the user-facing guard"
        );
    }

    fn users_step() -> &'static str {
        let start = SOURCE
            .find("async fn step_delete_users")
            .expect("step_delete_users is defined in this file");
        let body = &SOURCE[start..];
        let end = body
            .find(
                "
/// Emit an audit entry",
            )
            .expect("step_delete_users is followed by emit_status_audit");
        &body[..end]
    }

    fn to_snake_case(ident: &str) -> String {
        let mut out = String::new();
        for (i, c) in ident.chars().enumerate() {
            if c.is_ascii_uppercase() {
                if i > 0 {
                    out.push('_');
                }
                out.push(c.to_ascii_lowercase());
            } else {
                out.push(c);
            }
        }
        out
    }

    fn fk_source_tables(lines: &[&str], at: usize, spec_tables: &[String]) -> Vec<String> {
        for line in lines[..=at].iter().rev() {
            if let Some(rest) = line.split(".from(").nth(1)
                && let Some(ident) = rest.split("::Table").next()
                && rest.contains("::Table")
            {
                let ident = ident.rsplit("::").next().unwrap_or(ident).trim();
                return vec![to_snake_case(ident)];
            }
            for marker in [
                "ALTER TABLE ",
                "CREATE TABLE IF NOT EXISTS ",
                "CREATE TABLE ",
            ] {
                if let Some(rest) = line.split(marker).nth(1) {
                    let name = rest
                        .split_whitespace()
                        .next()
                        .unwrap_or_default()
                        .trim_matches('"');
                    // workflow_folder_id.rs formats one FK onto every table of its `Spec`s.
                    if name == "{table}" {
                        return spec_tables.to_vec();
                    }
                    return vec![name.to_string()];
                }
            }
        }
        panic!("no table marker above FK line: {}", lines[at]);
    }

    /// Source tables of every non-cascading FK into `target`, across all OSS migrations.
    fn restrictive_fk_sources(target: &str) -> std::collections::BTreeSet<String> {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../infra/src/table/migration");
        let ident = format!(
            "{}{}::Table",
            target[..1].to_ascii_uppercase(),
            &target[1..]
        );
        let sql_refs = [
            format!("REFERENCES {target}("),
            format!("REFERENCES {target} "),
            format!("REFERENCES \"{target}\""),
        ];
        let sources: Vec<String> = std::fs::read_dir(dir)
            .expect("migration dir is readable")
            .map(|e| std::fs::read_to_string(e.unwrap().path()).unwrap())
            .collect();
        let spec_tables: Vec<String> = sources
            .iter()
            .flat_map(|src| src.lines())
            .filter_map(|l| l.trim().strip_prefix("table: \""))
            .map(|l| l.trim_end_matches("\",").to_string())
            .collect();
        let mut referencing = std::collections::BTreeSet::new();
        for src in &sources {
            let lines: Vec<&str> = src.lines().collect();
            for (at, line) in lines.iter().enumerate() {
                let sea_query_fk = line.contains(".to(")
                    && (line.contains(&format!("({ident}"))
                        || line.contains(&format!("::{ident}")));
                let sql_fk = sql_refs.iter().find_map(|r| line.find(r.as_str()));
                let cascades = match sql_fk {
                    Some(pos) => line[pos..]
                        .split("FOREIGN KEY")
                        .next()
                        .is_some_and(|clause| clause.contains("ON DELETE CASCADE")),
                    None => lines
                        .get(at + 1)
                        .is_some_and(|next| next.contains("ForeignKeyAction::Cascade")),
                };
                if (sea_query_fk || sql_fk.is_some()) && !cascades {
                    referencing.extend(fk_source_tables(&lines, at, &spec_tables));
                }
            }
        }
        referencing
    }

    #[test]
    fn test_coverage_children_are_deleted_before_their_parents() {
        let pairs = [
            (
                "synthetics_variables::delete_by_org(",
                "synthetics_environments::delete_by_org(",
            ),
            (
                "synthetics_agents::delete_by_org(org_id)",
                "synthetics_locations::delete_by_org(org_id)",
            ),
            (
                "anomaly_detection::models::delete_by_org(",
                "anomaly_detection::config::delete_by_org(",
            ),
            (
                "workflows::delete_children_by_org(org_id)",
                "workflows::delete_by_org(org_id)",
            ),
            (
                "synthetics_checks::delete_by_org(org_id)",
                "folders::delete_by_org(org_id)",
            ),
            (
                "status_pages::delete_by_org(org_id)",
                "folders::delete_by_org(org_id)",
            ),
            (
                "alert_incidents::delete_by_org(org_id)",
                "incident_integrations::delete_by_org(org_id)",
            ),
        ];
        for (child, parent) in pairs {
            assert!(
                position_of(child) < position_of(parent),
                "{child} must run before {parent}"
            );
        }
    }

    #[test]
    fn test_storage_providers_go_only_after_the_last_drain() {
        assert!(!db_resources_step().contains("org_storage::delete_by_org"));
        position_of("del_org_prefix_strict(org_id, &format!(\"synthetics/{org_id}/\"))");
        position_of("storage::delete_org_models(org_id)");
        const { assert!(ORDER_DELETE_DB_RESOURCES < ORDER_DRAIN_DELETED_FILES_FINAL) };
        const { assert!(ORDER_DELETE_FILE_LIST_FINAL < ORDER_DRAIN_DELETED_FILES_FINAL) };
        const { assert!(ORDER_DRAIN_DELETED_FILES_FINAL < ORDER_DELETE_ORG_RECORD) };
    }

    #[tokio::test]
    async fn test_final_drain_drops_storage_providers_only_once_nothing_is_pending() {
        use sea_orm::ConnectionTrait;
        if !meta_store().await {
            return;
        }
        let org = format!("t_final_drain_{}", config::utils::time::now_micros());
        let conn = get_orm_client_rw().await;
        conn.execute_unprepared(&format!(
            "INSERT INTO org_storage_providers (org_id, provider_type, created_at, updated_at, data) \
             VALUES ('{org}', 'AwsCredentials', 1, 1, 'x')"
        ))
        .await
        .unwrap();
        let waiting = DrainPass {
            pending: true,
            ..Default::default()
        };
        let cleanup = PendingRowsCleanup {
            passes: std::sync::Mutex::new(vec![waiting]),
        };
        let step = "drain_deleted_files_final";
        let first = execute_step(&org, &org, step, &cleanup).await.unwrap();
        let kept = rows_of_provider(&org).await;
        let second = execute_step(&org, &org, step, &cleanup).await.unwrap();
        let left = rows_of_provider(&org).await;

        assert_eq!(first, StepOutcome::Retry(waiting));
        assert_eq!(
            kept, 1,
            "a provider went while its objects were still queued"
        );
        assert_eq!(second, StepOutcome::Done);
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn test_final_drain_finishes_when_the_providers_are_already_gone() {
        if !meta_store().await {
            return;
        }
        let org = format!("t_final_drain_gone_{}", config::utils::time::now_micros());
        let cleanup = PendingRowsCleanup {
            passes: std::sync::Mutex::new(vec![]),
        };
        let outcome = execute_step(&org, &org, "drain_deleted_files_final", &cleanup).await;
        assert_eq!(outcome.unwrap(), StepOutcome::Done);
        assert_eq!(rows_of_provider(&org).await, 0);
    }

    /// The meta store, with the cipher booted so provider rows can be encrypted.
    async fn meta_store_with_cipher() -> bool {
        static ONCE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if !meta_store().await {
            return false;
        }
        ONCE.get_or_init(|| async {
            infra::table::cipher::boot(None).await.expect("cipher");
        })
        .await;
        true
    }

    const PROVIDER_DATA: &str = "{\"bucket_name\":\"b\"}";

    async fn add_provider(org: &str) {
        use infra::table::org_storage_providers::{OrgStorageProvider, ProviderType};
        infra::table::org_storage_providers::add(OrgStorageProvider {
            org_id: org.to_string(),
            provider_type: ProviderType::AwsCredentials,
            created_at: 1,
            updated_at: 1,
            data: PROVIDER_DATA.to_string(),
        })
        .await
        .unwrap();
    }

    async fn has_dek(org: &str) -> bool {
        use infra::table::cipher::{self, DEFAULT_DEK_NAME, EntryKind};
        cipher::get_data(org, EntryKind::CipherKey, DEFAULT_DEK_NAME)
            .await
            .unwrap()
            .is_some()
    }

    /// Step 300 runs through its query-cache delete, which fails here: these tests run no querier.
    async fn run_db_resources_step(org: &str) {
        let cleanup = PendingRowsCleanup {
            passes: std::sync::Mutex::new(vec![]),
        };
        if let Err(e) = run_step(org, org, "delete_db_resources", &cleanup).await {
            let e = e.to_string();
            assert!(
                e.starts_with("step_delete_db_resources/offsets_and_caches"),
                "{e}"
            );
        }
    }

    #[tokio::test]
    async fn test_the_keys_outlive_the_storage_providers() {
        if !meta_store_with_cipher().await {
            return;
        }
        let org = format!("t_keys_last_{}", config::utils::time::now_micros());
        add_provider(&org).await;
        let waiting = DrainPass {
            pending: true,
            ..Default::default()
        };
        let cleanup = PendingRowsCleanup {
            passes: std::sync::Mutex::new(vec![waiting]),
        };
        let step = "drain_deleted_files_final";

        run_db_resources_step(&org).await;
        let after_db_resources = has_dek(&org).await;
        let first = execute_step(&org, &org, step, &cleanup).await.unwrap();
        let while_draining = has_dek(&org).await;
        let second = execute_step(&org, &org, step, &cleanup).await.unwrap();

        assert!(
            after_db_resources,
            "step 300 deleted the DEK of a provider row"
        );
        assert_eq!(first, StepOutcome::Retry(waiting));
        assert!(while_draining, "the DEK went while the provider row stayed");
        assert_eq!(second, StepOutcome::Done);
        assert_eq!(rows_of_provider(&org).await, 0);
        assert!(!has_dek(&org).await, "step 850 left the org's DEK behind");
    }

    #[tokio::test]
    async fn test_user_keys_go_at_step_300_and_the_dek_at_step_850() {
        use infra::table::cipher::{self, CipherEntry, EntryKind};
        if !meta_store_with_cipher().await {
            return;
        }
        let org = format!("t_user_keys_{}", config::utils::time::now_micros());
        add_provider(&org).await;
        cipher::add(CipherEntry {
            org: org.clone(),
            created_at: 1,
            created_by: "t".to_string(),
            name: "t_user_key".to_string(),
            data: "{}".to_string(),
            kind: EntryKind::CipherKey,
            is_system: false,
        })
        .await
        .unwrap();
        let user_key = || async {
            cipher::get_data(&org, EntryKind::CipherKey, "t_user_key")
                .await
                .unwrap()
                .is_some()
        };
        let cleanup = PendingRowsCleanup {
            passes: std::sync::Mutex::new(vec![]),
        };

        run_db_resources_step(&org).await;
        let (user_key_after_300, dek_after_300) = (user_key().await, has_dek(&org).await);
        let final_drain = execute_step(&org, &org, "drain_deleted_files_final", &cleanup).await;

        assert_eq!(final_drain.unwrap(), StepOutcome::Done);
        assert!(dek_after_300, "step 300 deleted the DEK of a provider row");
        // OSS builds have no key registry to evict, so the row waits for step 850's table delete.
        assert_eq!(
            user_key_after_300,
            !cfg!(feature = "enterprise"),
            "the user keys stayed in the key registry after step 300"
        );
        assert!(!user_key().await, "step 850 left a user key behind");
        assert!(!has_dek(&org).await, "step 850 left the org's DEK behind");
    }

    #[tokio::test]
    async fn test_a_node_started_mid_deletion_loads_every_org_and_step_850_finishes() {
        use infra::table::org_storage_providers::{self, get_for_org_from_cache};
        if !meta_store_with_cipher().await {
            return;
        }
        let now = config::utils::time::now_micros();
        let deleting = format!("t_mid_deleting_{now}");
        let live = format!("t_mid_live_{now}");
        add_provider(&deleting).await;
        add_provider(&live).await;
        let cleanup = PendingRowsCleanup {
            passes: std::sync::Mutex::new(vec![]),
        };
        run_db_resources_step(&deleting).await;
        for org in [&deleting, &live] {
            org_storage_providers::remove_from_cache(org);
        }

        let started = org_storage_providers::prime_cache().await;
        let live_loaded = get_for_org_from_cache(&live).map(|p| p.data);
        let deleting_loaded = get_for_org_from_cache(&deleting).map(|p| p.data);
        let outcome =
            execute_step(&deleting, &deleting, "drain_deleted_files_final", &cleanup).await;
        let deleting_left = (rows_of_provider(&deleting).await, has_dek(&deleting).await);
        org_storage_providers::delete_by_org(&live).await.unwrap();
        org_storage_providers::remove_from_cache(&live);
        infra::table::cipher::delete_by_org(&live).await.unwrap();

        assert!(
            started.is_ok(),
            "a node started mid-deletion loaded no storage"
        );
        assert_eq!(live_loaded.as_deref(), Some(PROVIDER_DATA));
        assert_eq!(
            deleting_loaded.as_deref(),
            Some(PROVIDER_DATA),
            "the deleting org's account cannot load, so its strict drain cannot finish"
        );
        assert_eq!(outcome.unwrap(), StepOutcome::Done);
        assert_eq!(deleting_left, (0, false));
    }

    async fn rows_of_provider(org: &str) -> i64 {
        use sea_orm::{ConnectionTrait, Statement};
        let conn = get_orm_client_rw().await;
        let sql = format!("SELECT COUNT(*) FROM org_storage_providers WHERE org_id = '{org}'");
        let row = conn
            .query_one(Statement::from_string(conn.get_database_backend(), sql))
            .await
            .unwrap()
            .unwrap();
        row.try_get_by_index::<i64>(0).unwrap()
    }

    #[test]
    fn test_re_pattern_map_is_deleted_before_patterns() {
        assert!(
            position_of("re_pattern_stream_map::delete_by_org(org_id)")
                < position_of("re_pattern::delete_by_org(org_id)"),
            "re_pattern_stream_map references re_pattern"
        );
    }

    #[test]
    fn test_every_folder_fk_child_is_deleted_before_folders() {
        let folders = position_of("folders::delete_by_org(org_id)");
        for (table, call) in FOLDER_CHILD_DELETES {
            assert!(
                position_of(call) < folders,
                "{table} must be deleted before folders"
            );
        }
    }

    #[test]
    fn test_fk_list_matches_migrations() {
        let listed: std::collections::BTreeSet<String> = FOLDER_CHILD_DELETES
            .iter()
            .map(|(t, _)| t.to_string())
            .collect();
        assert_eq!(
            restrictive_fk_sources("folders"),
            listed,
            "a migration added a folders FK without a cleanup delete"
        );
        for target in ["organizations", "users"] {
            let listed: std::collections::BTreeSet<String> = ORG_AND_USER_CHILD_DELETES
                .iter()
                .filter(|(t, ..)| *t == target)
                .map(|(_, child, _)| child.to_string())
                .collect();
            assert_eq!(
                restrictive_fk_sources(target),
                listed,
                "a migration added a {target} FK without a cleanup delete"
            );
        }
    }

    #[test]
    fn test_users_step_gates_openfga_on_enabled() {
        let users = users_step();
        let gate = users
            .find("o2_openfga::config::get_config().enabled")
            .expect("step_delete_users checks that OpenFGA is enabled");
        for call in ["delete_user_tuples(", "delete_user_from_org("] {
            let at = users
                .find(call)
                .unwrap_or_else(|| panic!("step_delete_users calls {call}"));
            assert!(gate < at, "{call} must run only when OpenFGA is enabled");
        }
    }

    #[test]
    fn test_org_and_user_fk_children_are_deleted_before_users() {
        let users = users_step();
        for (target, child, call) in ORG_AND_USER_CHILD_DELETES {
            assert!(
                users.contains(call),
                "step_delete_users never empties {child} ({target})"
            );
        }
        for teardown in ["remove_member", "remove_all_members"] {
            let body = fn_body(INFRA_ORG_USERS_SOURCE, teardown);
            let membership = body
                .find("Entity::delete_many()")
                .unwrap_or_else(|| panic!("{teardown} deletes the memberships"));
            let orphaned = body
                .find("remove_orphaned_users(")
                .unwrap_or_else(|| panic!("{teardown} deletes the users it leaves in no org"));
            assert!(
                body.contains(".begin()") && membership < orphaned && body.contains("txn.commit()"),
                "{teardown} must decide and delete the user in the membership delete's transaction"
            );
        }
        let orphaned = INFRA_ORG_USERS_SOURCE
            .split("fn remove_orphaned_users<")
            .nth(1)
            .expect("remove_orphaned_users is defined");
        assert!(
            orphaned[..orphaned.find("\n}\n").unwrap()].contains("Expr::exists(membership).not()"),
            "a user with a membership in another org must survive"
        );
        let removed = users.find("org_users::remove_member(").unwrap();
        let announced = users
            .find("announce_removed_member(org_id, &member.email, user_removed)")
            .expect("step_delete_users announces each removed member");
        assert!(
            removed < announced,
            "the notifications must follow the row deletes"
        );
    }

    #[test]
    fn test_users_step_propagates_tuple_errors_before_removing_membership() {
        let users = users_step();
        let tuples = users
            .find("drop_member_tuples(org_id, &member.email, &member.role, false).await?;")
            .expect("a failed tuple delete must stop the step");
        assert!(tuples < users.find("org_users::remove_member(").unwrap());
        let drop = fn_body(SOURCE, "drop_member_tuples");
        for call in ["delete_user_tuples(", "delete_user_from_org("] {
            let at = drop.find(call).unwrap();
            let statement = &drop[at..at + drop[at..].find(';').unwrap()];
            assert!(
                statement.ends_with('?'),
                "a failed tuple delete must stop the step: {statement}"
            );
        }
    }

    #[test]
    fn test_users_step_evicts_caches_before_deleting_rows() {
        let step = fn_body(SOURCE, "step_delete_users");
        let first_delete = step
            .find("org_users::remove_member(")
            .expect("step_delete_users deletes rows");
        let at = step
            .find("crate::db::org_users::evict_cached(")
            .expect("step_delete_users evicts the membership");
        assert!(
            at < first_delete,
            "the membership must be evicted while its row exists"
        );
        assert!(
            !step.contains("crate::db::user::evict_cached("),
            "a user the transaction keeps must stay cached"
        );
        let announce = fn_body(SOURCE, "announce_removed_member");
        let removed = announce.find("if user_removed").unwrap();
        assert!(removed < announce.find("crate::db::user::evict_cached(").unwrap());
    }

    #[test]
    fn test_only_the_membership_delete_decides_the_whole_user_tuple_drop() {
        let step = fn_body(SOURCE, "step_delete_users");
        assert!(
            !step.contains("list_orgs_by_user") && !step.contains("sole_org"),
            "no listing may decide that the member holds no other org"
        );
        let removed = step
            .find("let user_removed = org_users::remove_member(")
            .expect("remove_member returns whether it removed the user");
        let before = &step[..removed];
        assert_eq!(before.matches("drop_member_tuples(").count(), 1);
        assert!(before.contains("drop_member_tuples(org_id, &member.email, &member.role, false)"));
        let after = &step[removed..];
        let gate = after.find("if user_removed {").unwrap();
        let whole = after
            .find("drop_member_tuples(org_id, &member.email, &member.role, true)")
            .expect("a removed user loses every tuple");
        assert!(
            gate < whole,
            "only a user the transaction removed loses every tuple"
        );
        assert!(step.contains(
            "drop_member_tuples(org_id, &member.email, &member.role, member.user_removed)"
        ));
    }
}
