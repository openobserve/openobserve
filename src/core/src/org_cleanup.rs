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

use std::{collections::HashSet, sync::Arc};

use async_trait::async_trait;
use config::{meta::stream::StreamType, spawn_pausable_job};
use infra::{db::get_orm_client_rw, dist_lock, table::org_cleanup_tasks};
use sea_orm::ConnectionTrait;

const LOCK_KEY: &str = "/org_cleanup/worker_lock";
const MAX_ATTEMPTS: i32 = 10;
/// How often the cleanup worker wakes to drain pending tasks, and how often the
/// promotion scheduler checks for soft-deleted orgs whose grace window elapsed.
/// One hour: org deletion is not latency-sensitive, and a shorter cadence just
/// adds DB polling churn across every compactor node.
const POLL_INTERVAL_SECS: u64 = 3600;

const ORDER_DELETE_STREAMS: i32 = 100;
const ORDER_DELETE_STREAM_ITEM: i32 = 150;
const ORDER_DELETE_FILE_LIST: i32 = 200;
const ORDER_DELETE_DB_RESOURCES: i32 = 300;
const ORDER_DELETE_SCHEDULER_TRIGGERS: i32 = 400;
const ORDER_DELETE_USERS: i32 = 600;
// Final step: remove the org record + OFGA tuples via the canonical delete path.
const ORDER_DELETE_ORG_RECORD: i32 = 900;

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

pub fn fixed_steps(org_id: &str, org_name: &str) -> Vec<org_cleanup_tasks::NewCleanupTask> {
    // NOTE: OFGA tuples + the org record are removed together in the final
    // `delete_org_record` step, which calls the same `remove_org` service fn the
    // delete API uses — so both paths stay in lockstep (OFGA cleanup, super-cluster
    // propagation, cloud OrgDeleted event). Billing is NOT a cleanup step: deletion
    // is refused up-front unless the org is already billing-free (see initiate_deletion).
    vec![
        ("delete_streams", ORDER_DELETE_STREAMS),
        ("delete_file_list", ORDER_DELETE_FILE_LIST),
        ("delete_db_resources", ORDER_DELETE_DB_RESOURCES),
        ("delete_scheduler_triggers", ORDER_DELETE_SCHEDULER_TRIGGERS),
        ("delete_users", ORDER_DELETE_USERS),
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

pub async fn run(stream_data_cleanup: Arc<dyn StreamDataCleanup>) -> Result<(), anyhow::Error> {
    // A compactor that crashed mid-step leaves its task marked 'running'. Since
    // list_pending only returns pending/failed rows, such a task would never be
    // re-picked and the deletion would stall forever. Reset stale 'running' rows
    // back to 'pending' on startup so they requeue. This is safe cluster-wide:
    // the per-task mark_running CAS still guarantees exactly-once execution, and
    // attempts are preserved so MAX_ATTEMPTS still applies.
    match org_cleanup_tasks::requeue_running().await {
        Ok(n) if n > 0 => {
            log::warn!("[org_cleanup] requeued {n} stale 'running' task(s) on startup")
        }
        Ok(_) => {}
        Err(e) => log::error!("[org_cleanup] failed to requeue stale running tasks: {e}"),
    }

    spawn_pausable_job!("org_cleanup_worker", POLL_INTERVAL_SECS, {
        run_once(Arc::clone(&stream_data_cleanup)).await;
    });
    Ok(())
}

async fn run_once(stream_data_cleanup: Arc<dyn StreamDataCleanup>) {
    let locker = match dist_lock::lock(LOCK_KEY, 0).await {
        Ok(l) => l,
        Err(e) => {
            log::debug!("[org_cleanup] failed to acquire lock: {e}");
            return;
        }
    };

    let tasks = match org_cleanup_tasks::list_pending(MAX_ATTEMPTS).await {
        Ok(t) => t,
        Err(e) => {
            log::error!("[org_cleanup] failed to list pending tasks: {e}");
            let _ = dist_lock::unlock(&locker).await;
            return;
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

    for f in futures {
        if let Err(e) = f.await {
            // JoinError from a spawned per-org task (panic or cancellation). The
            // step error itself is already logged inside process_org_tasks.
            log::error!("[org_cleanup] task error: {e}");
        }
    }
}

async fn process_org_tasks(
    tasks: Vec<org_cleanup_tasks::CleanupTask>,
    stream_data_cleanup: Arc<dyn StreamDataCleanup>,
) {
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
                    return;
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

        if task.status == "failed" && task.attempts >= MAX_ATTEMPTS {
            log::error!(
                "[org_cleanup] org={} step={} permanently failed after {} attempts",
                task.org_id,
                task.step,
                task.attempts
            );
            emit_failed_alert(&task.org_id, &task.step).await;
            continue;
        }

        match org_cleanup_tasks::mark_running(&task.id).await {
            Ok(true) => {}
            Ok(false) => {
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
        }

        log::info!(
            "[org_cleanup] org={} step={} attempt={}",
            task.org_id,
            task.step,
            task.attempts + 1
        );

        let result = execute_step(
            &task.org_id,
            &task.org_name,
            &task.step,
            stream_data_cleanup.as_ref(),
        )
        .await;

        match result {
            Ok(()) => {
                log::info!("[org_cleanup] org={} step={} done", task.org_id, task.step);
                if let Err(e) = org_cleanup_tasks::mark_done(&task.id).await {
                    // The step succeeded but we could not persist 'done'. It will
                    // be re-run next poll (still marked 'running' until requeued),
                    // so surface this — a silently dropped write stalls progress.
                    log::error!(
                        "[org_cleanup] org={} step={} completed but failed to mark done: {e}",
                        task.org_id,
                        task.step
                    );
                }
            }
            Err(e) => {
                log::error!(
                    "[org_cleanup] org={} step={} attempt={} error={e}",
                    task.org_id,
                    task.step,
                    task.attempts + 1
                );
                if let Err(mark_err) =
                    org_cleanup_tasks::mark_failed(&task.id, &e.to_string()).await
                {
                    log::error!(
                        "[org_cleanup] org={} step={} failed to mark failed: {mark_err}",
                        task.org_id,
                        task.step
                    );
                }
            }
        }
    }
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
) -> Result<(), anyhow::Error> {
    if step == "delete_streams" {
        step_delete_streams(org_id, org_name).await
    } else if let Some(rest) = step.strip_prefix("delete_stream:") {
        step_delete_stream(org_id, rest, stream_data_cleanup).await
    } else if step == "delete_file_list" {
        step_delete_file_list(org_id).await
    } else if step == "delete_db_resources" {
        step_delete_db_resources(org_id).await
    } else if step == "delete_scheduler_triggers" {
        step_delete_scheduler_triggers(org_id).await
    } else if step == "delete_users" {
        step_delete_users(org_id).await
    } else if step == "delete_org_record" {
        step_delete_org_record(org_id).await
    } else {
        Err(anyhow::anyhow!("unknown step: {step}"))
    }
}

async fn step_delete_streams(org_id: &str, org_name: &str) -> Result<(), anyhow::Error> {
    let streams = crate::db::schema::list(org_id, None, false).await?;

    // Enqueue one sub-task per stream
    let sub_tasks: Vec<org_cleanup_tasks::NewCleanupTask> = streams
        .iter()
        .map(|s| org_cleanup_tasks::NewCleanupTask {
            org_id: org_id.to_string(),
            org_name: org_name.to_string(),
            step: format!("delete_stream:{}/{}", s.stream_type, s.stream_name),
            step_order: ORDER_DELETE_STREAM_ITEM,
        })
        .collect();

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

async fn step_delete_file_list(org_id: &str) -> Result<(), anyhow::Error> {
    // Catch-all for any file_list rows left behind after per-stream deletion (e.g.
    // rows whose stream schema was already gone). delete_by_org moves rows into
    // file_list_deleted before removing them so the file GC deletes the S3 objects
    // — a bare delete here would orphan those files in object store.
    infra::file_list::delete_by_org(org_id).await?;
    Ok(())
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

    let alerts = crate::db::alerts::alert::list(org_id, None, None).await?;
    for alert in alerts {
        let Some(alert_id) = alert.id else { continue };
        crate::alerts::alert::delete_by_id(conn, org_id, alert_id)
            .await
            .map_err(|e| anyhow::anyhow!("alert {alert_id}: {e}"))?;
    }
    Ok(())
}

/// Delete every cipher key in an org. On enterprise builds this goes through the
/// service `db::keys::remove` path so the in-memory `REGISTRY` evicts on all nodes
/// (coordinator delete watch) and the super-cluster is notified — none of which a
/// raw table wipe does. On OSS builds (no cipher REGISTRY / db::keys module) it
/// falls back to a direct table delete.
async fn delete_org_cipher_keys(org_id: &str) -> Result<(), anyhow::Error> {
    #[cfg(feature = "enterprise")]
    {
        use infra::table::cipher::{EntryKind, ListFilter};
        let filter = ListFilter {
            org: Some(org_id.to_string()),
            kind: Some(EntryKind::CipherKey),
            name: None,
            is_system: false,
        };
        let keys = infra::table::cipher::list_filtered(filter, None).await?;
        for key in keys {
            crate::db::keys::remove(org_id, EntryKind::CipherKey, &key.name)
                .await
                .map_err(|e| anyhow::anyhow!("cipher key {}: {e}", key.name))?;
        }
    }
    #[cfg(not(feature = "enterprise"))]
    infra::table::cipher::delete_by_org(org_id).await?;
    Ok(())
}

/// Per-group service delete so stored files, caches and cluster events are torn down too.
async fn delete_org_sourcemaps(org_id: &str) -> Result<(), anyhow::Error> {
    let files = crate::db::sourcemaps::list_files(org_id, None, None, None).await?;
    let groups: HashSet<_> = files
        .into_iter()
        .map(|f| (f.service, f.env, f.version))
        .collect();
    for (service, env, version) in groups {
        crate::db::sourcemaps::delete_group(org_id, service, env, version).await?;
    }
    Ok(())
}

/// Tombstones go out first: once the rows are gone nothing is left to build them from.
async fn delete_org_workflow_http_triggers(org_id: &str) -> Result<(), anyhow::Error> {
    #[cfg(feature = "enterprise")]
    emit_org_trigger_tombstones(org_id).await?;
    let gone = delete_org_workflow_rows(get_orm_client_rw().await, org_id).await?;
    #[cfg(feature = "enterprise")]
    forget_org_triggers(org_id, &gone).await;
    #[cfg(not(feature = "enterprise"))]
    drop(gone);
    Ok(())
}

/// After the delete: a cache reload before it would find the rows and keep them for the TTL.
#[cfg(feature = "enterprise")]
async fn forget_org_triggers(org_id: &str, trigger_ids: &[String]) {
    for trigger_id in trigger_ids {
        if let Err(e) = crate::db::workflow_http_triggers::forget_local(trigger_id).await {
            log::warn!(
                "[OrgCleanup] org '{org_id}': cache of trigger {trigger_id} not evicted: {e}"
            );
        }
    }
}

#[cfg(feature = "enterprise")]
async fn emit_org_trigger_tombstones(org_id: &str) -> Result<(), anyhow::Error> {
    let snapshots = org_trigger_tombstones(
        get_orm_client_rw().await,
        org_id,
        config::utils::time::now_micros(),
        &config::get_cluster_name(),
    )
    .await?;
    for snapshot in &snapshots {
        // Not retried: a region whose org row is gone refuses the org's hooks anyway.
        if let Err(e) = crate::db::workflow_http_triggers::emit_prepared(snapshot).await {
            log::warn!(
                "[OrgCleanup] org '{org_id}': tombstone of trigger {} not sent: {e}",
                snapshot.trigger.id
            );
        }
    }
    Ok(())
}

/// Version + 1, now and the local cluster outrank the stored row, so every receiver applies it.
#[cfg(feature = "enterprise")]
async fn org_trigger_tombstones<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    now_us: i64,
    local_cluster: &str,
) -> Result<Vec<infra::table::workflow_http_triggers::TriggerSnapshot>, anyhow::Error> {
    use infra::table::workflow_http_triggers::{
        self as http_triggers, AuthMode, CredentialKind, CredentialState, ReplicatedCredential,
        ReplicatedTrigger, TriggerSnapshot,
    };

    let mut snapshots = Vec::new();
    for trigger in http_triggers::list_by_org(db, org_id).await? {
        let Some(auth_mode) = AuthMode::parse(&trigger.auth_mode) else {
            log::warn!(
                "[OrgCleanup] trigger {} has an unknown auth mode, no tombstone",
                trigger.id
            );
            continue;
        };
        let credentials = http_triggers::list_credentials(db, &trigger.id)
            .await?
            .into_iter()
            .filter_map(|credential| {
                Some(ReplicatedCredential {
                    kind: CredentialKind::parse(&credential.kind)?,
                    state: CredentialState::Revoked,
                    revoked_at: credential.revoked_at.or(Some(now_us)),
                    updated_at: now_us,
                    secret: None,
                    id: credential.id,
                    display_prefix: credential.display_prefix,
                    token_sha256: credential.token_sha256,
                    expires_at: credential.expires_at,
                    created_by: credential.created_by,
                    created_at: credential.created_at,
                })
            })
            .collect();
        snapshots.push(TriggerSnapshot {
            version: trigger.version + 1,
            origin_cluster: local_cluster.to_string(),
            deleted: true,
            trigger: ReplicatedTrigger {
                id: trigger.id,
                org_id: trigger.org_id,
                workflow_id: trigger.workflow_id,
                enabled: trigger.enabled,
                auth_mode,
                max_body_bytes: trigger.max_body_bytes,
                rate_limit_per_minute: trigger.rate_limit_per_minute,
                created_by: trigger.created_by,
                created_at: trigger.created_at,
                updated_at: now_us,
                deleted_at: trigger.deleted_at.or(Some(now_us)),
            },
            credentials,
        });
    }
    Ok(snapshots)
}

async fn delete_org_workflow_rows<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
) -> Result<Vec<String>, anyhow::Error> {
    use infra::{
        secrets::SecretOwnerKind,
        table::{llm_secrets, workflow_http_trigger_requests, workflow_http_triggers, workflows},
    };

    let trigger_ids = workflow_http_triggers::list_by_org(db, org_id)
        .await?
        .into_iter()
        .map(|trigger| trigger.id)
        .collect();
    workflow_http_trigger_requests::delete_by_org(db, org_id).await?;
    workflow_http_triggers::delete_by_org(db, org_id).await?;
    llm_secrets::delete_by_org_owner_kind(db, org_id, SecretOwnerKind::WorkflowTrigger.as_str())
        .await?;
    workflows::delete_all_for_org_in(db, org_id).await?;
    Ok(trigger_ids)
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
        alert_calibration, alert_incidents, backfill_jobs, compactor_manual_jobs, dashboards,
        destinations, distinct_values, enrichment_table_urls, enrichment_tables, folders,
        incident_events, kv_store, llm_prompts, org_storage_providers, org_telephony,
        query_history, rca_runs, rca_steering, re_pattern, re_pattern_stream_map, reports, rum_pa,
        search_queue, short_urls, slo, slo_backfill_jobs, slo_budget, slos, system_settings,
        templates, timed_annotations,
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
    // downtimes.folder_id has a FK (downtimes_folder_fk) → folders.id.
    delete_org_downtimes(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/downtimes: {e}"))?;
    #[cfg(feature = "enterprise")]
    o2_enterprise::enterprise::slack::store::delete_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/slack: {e}"))?;
    // timed_annotation_panels cascade from timed_annotations; both are deleted here
    // via the three-hop join: folders.org → dashboards.folder_id → timed_annotations.dashboard_id
    // Must run BEFORE dashboards::delete_by_org or the join finds no rows.
    timed_annotations::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/timed_annotations: {e}"))?;
    // dashboards must be deleted before folders (FK constraint)
    dashboards::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/dashboards: {e}"))?;
    // reports must be deleted before folders: reports.folder_id has a FK
    // (reports_folders_fk) → folders.id.
    reports::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/reports: {e}"))?;
    // Prompt heads also reference folders with a restrictive FK. Delete the
    // complete registry before folders so an org with prompts can be removed.
    llm_prompts::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/llm_prompts: {e}"))?;
    // workflows.folder_id and workflow_drafts.folder_id reference folders.id on Postgres.
    delete_org_workflow_http_triggers(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/workflows: {e}"))?;
    // folders are safe to delete after their dashboards, reports, prompts and workflows are gone
    folders::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/folders: {e}"))?;
    // destinations must be deleted before templates: destinations.template_id has a
    // FK (destinations_templates_fk) → templates.id, so templates cannot be removed
    // while any destination still references them.
    destinations::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/destinations: {e}"))?;
    templates::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/templates: {e}"))?;
    kv_store::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/kv_store: {e}"))?;
    rum_pa::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/rum_pa: {e}"))?;
    crate::rum_pa::service::emit_delete_org(org_id).await;
    // Delete cipher keys through the service layer so the in-memory key REGISTRY
    // evicts cluster-wide (via the coordinator delete + super-cluster propagation);
    // a raw table wipe would leave decrypted keys resident in every node's memory.
    delete_org_cipher_keys(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/cipher: {e}"))?;
    enrichment_tables::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/enrichment_tables: {e}"))?;
    enrichment_table_urls::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/enrichment_table_urls: {e}"))?;
    backfill_jobs::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/backfill_jobs: {e}"))?;
    search_queue::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/search_queue: {e}"))?;
    query_history::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/query_history: {e}"))?;
    re_pattern::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/re_pattern: {e}"))?;
    re_pattern_stream_map::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/re_pattern_stream_map: {e}"))?;
    org_storage_providers::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/org_storage_providers: {e}"))?;
    org_telephony::delete(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/org_telephony: {e}"))?;
    #[cfg(feature = "cloud")]
    trial_quota_usage::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/trial_quota_usage: {e}"))?;
    // Through the db layer, not the table layer: it also evicts the token caches
    // cluster-wide. Runs here, in delete_db_resources, so the eviction lands before
    // the later delete_org_record step tears down the org status row and its cache
    // (after which `is_blocked` falls back to false).
    crate::db::org_ingestion_tokens::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/org_ingestion_tokens: {e}"))?;
    // Same F6 pattern as the `_reset` handler: the table-layer delete alone leaves
    // every node's org cache intact forever (no TTL). On enterprise builds go
    // through the storage layer (clears local cache + super-cluster replication)
    // and emit an org-scope reload so remote nodes drop their cached copies too.
    #[cfg(feature = "enterprise")]
    {
        o2_enterprise::enterprise::service_streams::storage::ServiceStorage::delete_all(org_id)
            .await
            .map_err(|e| anyhow::anyhow!("step_delete_db_resources/service_streams: {e}"))?;
        if let Err(e) = infra::coordinator::service_streams::emit_reload_event(org_id).await {
            log::warn!(
                "[OrgCleanup] service_streams: failed to emit reload event for org '{org_id}': {e}"
            );
        }
    }
    #[cfg(not(feature = "enterprise"))]
    service_streams::delete_all(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/service_streams: {e}"))?;
    system_settings::delete_org_settings(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/system_settings: {e}"))?;

    // Delete pipelines through the service layer so derived-stream triggers,
    // backfill jobs, OFGA ownership, and the executable-pipeline caches are all
    // torn down and evicted cluster-wide — a raw infra::pipeline::delete would
    // leave those side effects (and stale cache entries) behind.
    let pipelines = infra::pipeline::list_by_org(org_id).await?;
    for p in pipelines {
        crate::pipeline::delete_pipeline(&p.id)
            .await
            .map_err(|e| anyhow::anyhow!("step_delete_db_resources/pipeline {}: {e}", p.id))?;
    }

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

    distinct_values::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/distinct_values: {e}"))?;
    short_urls::delete_by_org(org_id)
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
    o2_enterprise::enterprise::cloud::delete_org_cloud_resources(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/cloud_resources: {e}"))?;

    Ok(())
}

async fn step_delete_scheduler_triggers(org_id: &str) -> Result<(), anyhow::Error> {
    let triggers = infra::scheduler::list_by_org(org_id, None).await?;
    for t in triggers {
        infra::scheduler::delete(&t.org, t.module, &t.module_key)
            .await
            .map_err(|e| anyhow::anyhow!("scheduler delete failed: {e}"))?;
    }
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
    let members = infra::table::org_users::list_users_by_org(org_id).await?;
    for member in &members {
        let user_orgs = infra::table::org_users::list_orgs_by_user(&member.email).await?;
        let sole_org = user_orgs.len() <= 1;

        // Remove the org membership first. The `org_users_user_email_fk` foreign key
        // references users(email), so the users row cannot be deleted while this
        // membership still exists.
        if let Err(e) = infra::table::org_users::remove(org_id, &member.email).await {
            log::error!(
                "[org_cleanup] remove org_user org={org_id} user={} error: {e}",
                member.email
            );
        }

        if sole_org {
            // User belonged only to this org — delete the user entirely and its tuples.
            if let Err(e) = infra::table::users::remove(&member.email).await {
                log::error!("[org_cleanup] remove user {} error: {e}", member.email);
            }
            #[cfg(feature = "enterprise")]
            if let Err(e) = o2_openfga::authorizer::authz::delete_user_tuples(&member.email).await {
                return Err(anyhow::anyhow!(
                    "delete_user_tuples failed for {}: {e}",
                    member.email
                ));
            }
        } else {
            // User still belongs to other orgs — keep the user, but remove their OFGA
            // access tuples for *this* org so no dangling grant to the deleted org
            // remains (mirrors delete_user_from_org used on normal user removal).
            #[cfg(feature = "enterprise")]
            {
                let fga_role = user_fga_role(&member.role);
                o2_openfga::authorizer::authz::delete_user_from_org(
                    org_id,
                    &member.email,
                    &fga_role,
                )
                .await;
            }
        }
    }
    Ok(())
}

/// Emit an audit entry to the _meta org for an org status transition.
/// Fire-and-forget; never blocks the transition. Enterprise-only.
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
            response_meta: auditor::ResponseMeta {
                http_method: "SYSTEM".to_string(),
                http_path: format!("/system/org_cleanup/{from}_to_{to}"),
                http_query_params: String::new(),
                http_body: String::new(),
                http_response_code: 200,
                error_msg: None,
                trace_id: None,
            },
            delegated: None,
        })
        .await;
    }
}

pub async fn initiate_deletion(org_id: &str, initiated_by: &str) -> Result<(), anyhow::Error> {
    use crate::db::org_status;

    // The `default` and `_meta` orgs are system orgs and must never be deleted.
    // Guard here, at the single entry point, BEFORE any status mutation — otherwise
    // the org would be flipped to deleting/pending, blocked+hidden, and then the
    // terminal `remove_org` step would permanently fail on its own `default` guard,
    // leaving the org stuck in `deleting` forever.
    if org_id == config::DEFAULT_ORG || org_id == config::META_ORG_ID {
        return Err(anyhow::anyhow!("Cannot delete this organization"));
    }

    // Look up org — also gives us org_name for the cleanup tasks.
    let org = infra::table::organizations::get(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("org not found: {e}"))?;

    // Refuse deletion while billing is still active. The user must unsubscribe
    // first (and have that reflected in O2) — we do NOT self-cancel, because AWS
    // and Azure marketplace subscriptions can only be cancelled by the customer,
    // and super-org payer relationships must be unwound by the user. This makes
    // "org is billing-free" a visible precondition instead of a silent side effect.
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
        // No grace period: immediate hard delete (legacy path).
        //
        // Atomic CAS: flip status active→deleting in the DB.
        // This is the single source-of-truth guard against concurrent requests on any cluster
        // node. The in-memory cache check below is a fast-path optimisation only.
        let won_race = infra::table::organizations::set_status_if(org_id, "active", "deleting")
            .await
            .map_err(|e| anyhow::anyhow!("failed to set org status: {e}"))?;

        if !won_race {
            return Err(anyhow::anyhow!("Organization is already being deleted"));
        }

        // Insert all fixed cleanup tasks (idempotent — on_conflict do_nothing).
        let tasks = fixed_steps(org_id, &org.org_name);
        org_cleanup_tasks::add_batch(&tasks).await?;

        // Broadcast to all cluster nodes so their in-memory caches reflect the new status.
        org_status::broadcast_deleting(org_id).await?;
        emit_status_audit(org_id, initiated_by, "active", "deleting").await;

        log::info!("[org_cleanup] initiated immediate deletion for org={org_id}");
        return Ok(());
    }

    // Grace period: soft delete. Record deleted_at; do NOT enqueue cleanup yet.
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
    org_status::broadcast_pending_deletion(org_id).await?;
    emit_status_audit(org_id, initiated_by, "active", "pending_deletion").await;
    log::info!("[org_cleanup] soft-deleted org={org_id} (grace {grace_days}d)");
    Ok(())
}

async fn step_delete_org_record(org_id: &str) -> Result<(), anyhow::Error> {
    // Reuse the canonical org-delete service fn — the SAME one the delete API
    // calls — so OFGA tuple cleanup, super-cluster propagation, and the cloud
    // OrgDeleted event all happen exactly as they do for a direct delete. If the
    // delete handler ever grows a new side effect, this path inherits it for free.
    crate::organization::remove_org(org_id).await?;
    let _ = infra::table::org_cleanup_tasks::delete_by_org(org_id).await;
    crate::db::org_status::evict(org_id).await?;
    emit_status_audit(org_id, "system", "deleting", "gone").await;
    Ok(())
}

/// Resurrect a soft-deleted org: pending_deletion → active, clear deleted_at, purge
/// any cleanup tasks, and unblock it across the cluster. No data was ever touched.
/// `actor` is the email of the _meta/root user performing the resurrection (for audit).
pub async fn resurrect_org(org_id: &str, actor: &str) -> Result<(), anyhow::Error> {
    use crate::db::org_status;

    let won = infra::table::organizations::set_status_if_with_deleted_at(
        org_id,
        "pending_deletion",
        "active",
        None,
    )
    .await
    .map_err(|e| anyhow::anyhow!("failed to set org status: {e}"))?;
    if !won {
        return Err(anyhow::anyhow!(
            "Organization is not pending deletion (cannot resurrect)"
        ));
    }
    let _ = org_cleanup_tasks::delete_by_org(org_id).await;
    org_status::set_active(org_id).await?;
    emit_status_audit(org_id, actor, "pending_deletion", "active").await;
    log::info!("[org_cleanup] resurrected org={org_id} by {actor}");
    Ok(())
}

/// Promote every pending_deletion org whose grace window has elapsed to `deleting`
/// and enqueue its cleanup tasks. Returns the number promoted.
pub async fn promote_expired() -> Result<usize, anyhow::Error> {
    use crate::db::org_status;

    let grace_days = grace_period_days();
    if grace_days <= 0 {
        return Ok(0);
    }
    let window_micros = grace_days * 24 * 3600 * 1_000_000;
    let now = config::utils::time::now_micros();

    // Reuse the status cache (synced from DB + coordinator) to find pending orgs
    // instead of scanning every org from the DB. The cache only holds
    // pending_deletion/deleting orgs, so this is already the small candidate set.
    let pending_org_ids: Vec<String> = common::infra::config::ORG_STATUS_CACHE
        .iter()
        .filter(|e| *e.value() == common::meta::organization::OrgStatus::PendingDeletion)
        .map(|e| e.key().clone())
        .collect();

    let mut promoted = 0usize;
    for org_id in pending_org_ids {
        // Re-read the row for the authoritative deleted_at + org_name (the cache
        // doesn't carry them). A concurrent resurrect may have flipped it already.
        let org = match infra::table::organizations::get(&org_id).await {
            Ok(o) => o,
            Err(e) => {
                log::warn!("[org_cleanup] promote: cannot load org={org_id}: {e}");
                continue;
            }
        };
        if org.status != "pending_deletion" {
            continue;
        }
        let deleted_at = match org.deleted_at {
            Some(t) => t,
            None => continue,
        };
        if now < deleted_at + window_micros {
            continue;
        }
        let won = match infra::table::organizations::set_status_if(
            &org.identifier,
            "pending_deletion",
            "deleting",
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[org_cleanup] failed to promote org={}: {e}",
                    org.identifier
                );
                continue;
            }
        };
        if !won {
            // Another compactor won the promotion CAS for this org — expected under
            // multiple compactors; log so we know we at least attempted.
            log::debug!(
                "[org_cleanup] lost promotion race for org={} (another node promoted it)",
                org.identifier
            );
            continue;
        }
        let tasks = fixed_steps(&org.identifier, &org.org_name);
        if let Err(e) = org_cleanup_tasks::add_batch(&tasks).await {
            log::error!(
                "[org_cleanup] failed to promote org={}: {e}",
                org.identifier
            );
            continue;
        }
        if let Err(e) = org_status::broadcast_deleting(&org.identifier).await {
            log::error!(
                "[org_cleanup] failed to promote org={}: {e}",
                org.identifier
            );
            continue;
        }
        emit_status_audit(&org.identifier, "system", "pending_deletion", "deleting").await;
        log::info!("[org_cleanup] promoted org={} to deleting", org.identifier);
        promoted += 1;
    }
    Ok(promoted)
}

/// Background job: hourly, promote expired pending_deletion orgs to `deleting`.
pub async fn run_promotion_scheduler() -> Result<(), anyhow::Error> {
    spawn_pausable_job!("org_deletion_promotion", POLL_INTERVAL_SECS, {
        match promote_expired().await {
            Ok(n) if n > 0 => log::info!("[org_cleanup] promoted {n} orgs to deleting"),
            Err(e) => log::error!("[org_cleanup] promotion error: {e}"),
            _ => {}
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
    }

    #[test]
    fn test_grace_period_days_non_negative() {
        assert!(grace_period_days() >= 0);
    }

    #[test]
    fn test_fixed_steps_count() {
        let steps = fixed_steps("myorg", "My Org");
        assert_eq!(steps.len(), 6);
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
            "delete_db_resources",
            "delete_scheduler_triggers",
            "delete_users",
            "delete_org_record",
        ] {
            assert!(names.contains(expected), "missing step: {expected}");
        }
    }

    #[test]
    fn test_fixed_steps_excludes_billing_and_standalone_ofga() {
        // Billing is a pre-deletion precondition (initiate_deletion refuses if
        // billing is active), NOT a cleanup step. OFGA tuple removal is folded into
        // the final delete_org_record step (via remove_org), not a separate step.
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
        const { assert!(ORDER_DELETE_FILE_LIST < ORDER_DELETE_DB_RESOURCES) };
        const { assert!(ORDER_DELETE_DB_RESOURCES < ORDER_DELETE_SCHEDULER_TRIGGERS) };
        const { assert!(ORDER_DELETE_SCHEDULER_TRIGGERS < ORDER_DELETE_USERS) };
        // delete_org_record (OFGA + org record + billing-free precondition) runs last.
        const { assert!(ORDER_DELETE_USERS < ORDER_DELETE_ORG_RECORD) };
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
        // `User` and `ServiceAccount` are granted access via the `allowed_user`
        // relation, not a relation named after the role.
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
        // The mapped relation must be one OpenFGA recognizes on `org:` objects.
        // These mirror the read_targets in o2_openfga delete_user_tuples.
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
        // Fire-and-forget helper: must complete without panicking regardless of
        // build type (enterprise emits an audit message; OSS is a no-op).
        emit_status_audit("test_org", "system", "active", "pending_deletion").await;
    }

    #[tokio::test]
    async fn test_promote_expired_noop_without_db() {
        // With grace <= 0 (OSS default, or enterprise default when unset) promote_expired
        // short-circuits to Ok(0) without touching the DB. When a test DB has configured
        // a positive grace period, this exercises the real `list` path instead — skip in
        // that environment since no TEST_DB_URL means the DB call itself would fail.
        if grace_period_days() > 0 && std::env::var("TEST_DB_URL").is_err() {
            return;
        }
        let r = promote_expired().await;
        assert!(r.is_ok());
    }

    #[tokio::test]
    async fn test_initiate_deletion_refuses_system_orgs() {
        // `default` and `_meta` must never be deletable — the guard rejects before
        // any status mutation, so this holds even without a DB.
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

    // ===================== SLO teardown ===================================
    //
    // `step_delete_db_resources` is a flat sequence of calls against global
    // clients with no injection point, so the order it runs them in cannot be
    // observed without a live database. The order is nonetheless a correctness
    // requirement, so it is pinned against the source of the step itself.
    //
    // The limit of that technique, stated plainly: it reads the file, so it
    // sees calls that are WRITTEN, not calls that RUN. Removing a call fails
    // these tests by name, and each call's org argument is pinned too, so a
    // sweep aimed at the wrong org is caught — but a call commented out, or
    // made unreachable, still reads as present.

    const SOURCE: &str = include_str!("org_cleanup.rs");

    /// The body of `step_delete_db_resources`, so a match cannot come from a
    /// neighbouring function (or from these tests).
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

    fn position_of(call: &str) -> usize {
        db_resources_step()
            .find(call)
            .unwrap_or_else(|| panic!("step_delete_db_resources never calls {call}"))
    }

    /// Every SLO table, or org deletion orphans the rows it misses — each
    /// swept for the org being torn down, not some other one.
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
        // An SLO reads from a source alert, and a later PR refuses to delete an
        // alert that a live SLO still depends on. Org teardown must never trip
        // that guard, so the SLOs are gone before the alerts are touched.
        let alerts = position_of("delete_org_alerts(org_id)");
        for call in SLO_DELETES {
            assert!(
                position_of(call) < alerts,
                "{call} must run before delete_org_alerts"
            );
        }
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
    fn test_slo_children_are_deleted_before_their_definitions() {
        // `slo_status` and `slo_backfill_jobs` carry no org column, so both
        // resolve the org through `slos`. Wiping `slos` first would leave them
        // with nothing to resolve — and nothing deleted.
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

    /// The other half of the same requirement (S-16 PR 4). Ordering alone is
    /// not enough: `delete_by_id_user` refuses to delete an alert a live SLO
    /// measures from, and one straggler — a row a failed earlier attempt left
    /// behind, or an SLO created in the grace period — would stall the whole
    /// teardown on a retry loop that can never succeed. Teardown therefore
    /// goes through the UNGUARDED primitive, and the guard stays where it
    /// belongs: on the user's delete.
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

    mod workflow_teardown {
        use infra::{
            secrets::{self, SecretOwnerKind},
            table::{
                entity::{
                    folders, llm_secrets, workflow_associations, workflow_drafts, workflow_errors,
                    workflow_http_trigger_credentials as credentials,
                    workflow_http_trigger_requests as requests, workflow_http_triggers as triggers,
                    workflow_run_data, workflows,
                },
                workflow_http_trigger_requests::{self as ledger, NewHookRequest},
                workflow_http_triggers as http_triggers,
            },
        };
        use sea_orm::{
            ActiveModelTrait, ColumnTrait, ConnectOptions, ConnectionTrait, Database,
            DatabaseConnection, EntityTrait, NotSet, PaginatorTrait, QueryFilter, Schema, Set,
        };

        use super::{super::*, SOURCE, position_of};

        const NOW: i64 = 1_760_000_000_000_000;

        /// One connection: separate connections to `sqlite::memory:` are separate databases.
        async fn db() -> DatabaseConnection {
            let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
            opts.max_connections(1);
            let db = Database::connect(opts).await.unwrap();
            http_triggers::create_tables_for_tests(&db).await.unwrap();
            infra::table::workflows::create_tables_for_tests(&db)
                .await
                .unwrap();
            db
        }

        /// Own schema per run, with the two folder FKs the migrations add on Postgres.
        async fn pg_db() -> (DatabaseConnection, String) {
            let url = std::env::var("TEST_POSTGRES_URL").expect("TEST_POSTGRES_URL is required");
            let schema = format!("org_cleanup_{}_{}", std::process::id(), NOW);
            let admin = Database::connect(&url).await.unwrap();
            admin
                .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
                .await
                .unwrap();
            let mut opts = ConnectOptions::new(url);
            opts.max_connections(1)
                .set_schema_search_path(schema.clone());
            let db = Database::connect(opts).await.unwrap();
            http_triggers::create_tables_for_tests(&db).await.unwrap();
            infra::table::workflows::create_tables_for_tests(&db)
                .await
                .unwrap();
            let backend = db.get_database_backend();
            let folders_table = Schema::new(backend).create_table_from_entity(folders::Entity);
            db.execute(backend.build(&folders_table)).await.unwrap();
            for (table, fk) in [
                ("workflows", "workflows_folder_fk"),
                ("workflow_drafts", "workflow_drafts_folder_fk"),
            ] {
                db.execute_unprepared(&format!(
                    "ALTER TABLE {table} ADD CONSTRAINT {fk} \
                     FOREIGN KEY (folder_id) REFERENCES folders(id)"
                ))
                .await
                .unwrap();
            }
            (db, schema)
        }

        async fn delete_org_folders(
            db: &DatabaseConnection,
            org: &str,
        ) -> Result<sea_orm::DeleteResult, sea_orm::DbErr> {
            folders::Entity::delete_many()
                .filter(folders::Column::Org.eq(org))
                .exec(db)
                .await
        }

        async fn seed_trigger(db: &DatabaseConnection, org: &str) {
            let trigger_id = format!("t-{org}");
            http_triggers::insert_trigger(
                db,
                triggers::Model {
                    id: trigger_id.clone(),
                    org_id: org.to_string(),
                    workflow_id: format!("wf-{org}"),
                    enabled: true,
                    auth_mode: "signature".to_string(),
                    max_body_bytes: 1_048_576,
                    rate_limit_per_minute: 60,
                    created_by: "a@x.io".to_string(),
                    created_at: NOW - 10,
                    updated_at: NOW - 10,
                    version: 3,
                    origin_cluster: "r2".to_string(),
                    deleted_at: None,
                    last_invoked_at: None,
                    rejections: None,
                },
            )
            .await
            .unwrap();
            let credential_id = format!("c-{org}");
            let prepared =
                secrets::prepared_for_tests(org, SecretOwnerKind::WorkflowTrigger, &credential_id);
            let secret_ref = secrets::insert_prepared(db, prepared)
                .await
                .unwrap()
                .metadata
                .secret_ref;
            http_triggers::insert_credential(
                db,
                credentials::Model {
                    id: credential_id,
                    trigger_id: trigger_id.clone(),
                    org_id: org.to_string(),
                    kind: "signing_secret".to_string(),
                    display_prefix: "whsec_abcd…wxyz".to_string(),
                    token_sha256: None,
                    secret_ref: Some(secret_ref),
                    state: "active".to_string(),
                    expires_at: None,
                    revoked_at: None,
                    created_by: "a@x.io".to_string(),
                    created_at: NOW - 10,
                    updated_at: NOW - 10,
                    last_used_at: None,
                },
            )
            .await
            .unwrap();
            let request = NewHookRequest {
                trigger_id,
                org_id: org.to_string(),
                workflow_id: format!("wf-{org}"),
                run_id: format!("run-{org}"),
                idem_key: None,
                body_sha256: "cd".repeat(32),
                body_bytes: 2,
                content_type: None,
                meta: "{}".to_string(),
                credential_id: format!("c-{org}"),
                credential_prefix: "whsec_abcd…wxyz".to_string(),
                caller_ip: "203.0.113.7".to_string(),
                received_at: NOW,
            };
            ledger::enqueue(db, request, "{}".to_string())
                .await
                .unwrap();
        }

        async fn seed_workflow(db: &DatabaseConnection, org: &str) {
            let id = format!("wf-{org}");
            workflows::ActiveModel {
                id: Set(id.clone()),
                org_id: Set(org.to_string()),
                folder_id: Set("f1".to_string()),
                created_at: Set(NOW),
                updated_at: Set(NOW),
                created_by: Set("a@x.io".to_string()),
                enabled: Set(true),
                name: Set(id.clone()),
                description: Set(String::new()),
                nodes: Set("[]".to_string()),
                edges: Set("[]".to_string()),
            }
            .insert(db)
            .await
            .unwrap();
            workflow_drafts::ActiveModel {
                id: Set(format!("draft-{org}")),
                org_id: Set(org.to_string()),
                folder_id: Set("f1".to_string()),
                created_at: Set(NOW),
                updated_at: Set(NOW),
                created_by: Set("a@x.io".to_string()),
                name: Set(id.clone()),
                description: Set(String::new()),
                nodes: Set("[]".to_string()),
                edges: Set("[]".to_string()),
            }
            .insert(db)
            .await
            .unwrap();
            workflow_errors::ActiveModel {
                id: NotSet,
                cluster: Set("r1".to_string()),
                org_id: Set(org.to_string()),
                workflow_id: Set(id.clone()),
                run_id: Set(format!("err-run-{org}")),
                ran_at: Set(NOW),
                data: Set("[]".to_string()),
                input_data: Set(None),
            }
            .insert(db)
            .await
            .unwrap();
            workflow_associations::ActiveModel {
                id: NotSet,
                org_id: Set(org.to_string()),
                entity_id: Set("alert-1".to_string()),
                entity_type: Set("alert".to_string()),
                workflow_id: Set(id.clone()),
                trigger_type: Set("AlertFired".to_string()),
                created_at: Set(NOW),
            }
            .insert(db)
            .await
            .unwrap();
            workflow_run_data::ActiveModel {
                id: NotSet,
                org_id: Set(org.to_string()),
                workflow_id: Set(id),
                run_id: Set(format!("alert-run-{org}")),
                triggered_at: Set(NOW),
                data: Set("[]".to_string()),
            }
            .insert(db)
            .await
            .unwrap();
        }

        async fn hook_rows(db: &DatabaseConnection, org: &str) -> [u64; 4] {
            [
                triggers::Entity::find()
                    .filter(triggers::Column::OrgId.eq(org))
                    .count(db)
                    .await
                    .unwrap(),
                credentials::Entity::find()
                    .filter(credentials::Column::OrgId.eq(org))
                    .count(db)
                    .await
                    .unwrap(),
                requests::Entity::find()
                    .filter(requests::Column::OrgId.eq(org))
                    .count(db)
                    .await
                    .unwrap(),
                llm_secrets::Entity::find()
                    .filter(llm_secrets::Column::OrgId.eq(org))
                    .filter(llm_secrets::Column::OwnerKind.eq("workflow_trigger"))
                    .count(db)
                    .await
                    .unwrap(),
            ]
        }

        async fn workflow_rows(db: &DatabaseConnection, org: &str) -> [u64; 5] {
            [
                workflows::Entity::find()
                    .filter(workflows::Column::OrgId.eq(org))
                    .count(db)
                    .await
                    .unwrap(),
                workflow_drafts::Entity::find()
                    .filter(workflow_drafts::Column::OrgId.eq(org))
                    .count(db)
                    .await
                    .unwrap(),
                workflow_errors::Entity::find()
                    .filter(workflow_errors::Column::OrgId.eq(org))
                    .count(db)
                    .await
                    .unwrap(),
                workflow_associations::Entity::find()
                    .filter(workflow_associations::Column::OrgId.eq(org))
                    .count(db)
                    .await
                    .unwrap(),
                workflow_run_data::Entity::find()
                    .filter(workflow_run_data::Column::OrgId.eq(org))
                    .count(db)
                    .await
                    .unwrap(),
            ]
        }

        #[tokio::test]
        async fn org_delete_removes_workflow_http_trigger_rows_and_secrets() {
            let db = db().await;
            seed_trigger(&db, "gone").await;
            seed_trigger(&db, "kept").await;
            assert_eq!(hook_rows(&db, "gone").await, [1, 1, 1, 1]);

            let gone = delete_org_workflow_rows(&db, "gone").await.unwrap();
            assert_eq!(
                gone,
                ["t-gone"],
                "the deleted triggers are named for eviction"
            );
            assert_eq!(hook_rows(&db, "gone").await, [0, 0, 0, 0]);
            assert_eq!(hook_rows(&db, "kept").await, [1, 1, 1, 1]);
            assert_eq!(
                workflow_run_data::Entity::find()
                    .filter(workflow_run_data::Column::OrgId.eq("gone"))
                    .count(&db)
                    .await
                    .unwrap(),
                0,
                "the queued run's payload goes with the org"
            );
        }

        #[tokio::test]
        async fn org_delete_removes_existing_workflow_tables() {
            let db = db().await;
            seed_workflow(&db, "gone").await;
            seed_workflow(&db, "kept").await;
            assert_eq!(workflow_rows(&db, "gone").await, [1, 1, 1, 1, 1]);

            delete_org_workflow_rows(&db, "gone").await.unwrap();
            assert_eq!(workflow_rows(&db, "gone").await, [0, 0, 0, 0, 0]);
            assert_eq!(workflow_rows(&db, "kept").await, [1, 1, 1, 1, 1]);
        }

        /// SQLite never enforces the folder FKs, so only Postgres shows the delete order matters.
        #[tokio::test]
        #[ignore = "Requires test PostgreSQL database setup"]
        async fn on_postgres_the_workflow_rows_must_go_before_their_folder() {
            let (db, schema) = pg_db().await;
            folders::ActiveModel {
                id: Set("f1".to_string()),
                org: Set("gone".to_string()),
                folder_id: Set("f1".to_string()),
                name: Set("Workflows".to_string()),
                description: Set(None),
                icon: Set(None),
                r#type: Set(4),
            }
            .insert(&db)
            .await
            .unwrap();
            seed_workflow(&db, "gone").await;
            seed_trigger(&db, "gone").await;

            let folders_first = delete_org_folders(&db, "gone").await;
            assert!(
                folders_first
                    .as_ref()
                    .is_err_and(|e| e.to_string().contains("_folder_fk")),
                "the folder FK refuses while a workflow row points at it: {folders_first:?}"
            );
            delete_org_workflow_rows(&db, "gone").await.unwrap();
            delete_org_folders(&db, "gone").await.unwrap();
            assert_eq!(workflow_rows(&db, "gone").await, [0, 0, 0, 0, 0]);
            assert_eq!(hook_rows(&db, "gone").await, [0, 0, 0, 0]);
            db.execute_unprepared(&format!("DROP SCHEMA {schema} CASCADE"))
                .await
                .unwrap();
        }

        #[test]
        fn the_db_resources_step_deletes_the_orgs_workflow_rows() {
            assert!(
                position_of("delete_org_workflow_http_triggers(org_id)")
                    < position_of("folders::delete_by_org(org_id)"),
                "workflows.folder_id references folders.id (workflows_folder_fk on Postgres)"
            );
            let helper = SOURCE
                .find("async fn delete_org_workflow_http_triggers")
                .expect("the helper is defined in this file");
            let body = &SOURCE[helper..];
            let body = &body[..body.find("\n}\n").unwrap()];
            assert!(
                body.find("emit_org_trigger_tombstones(org_id)").unwrap()
                    < body.find("delete_org_workflow_rows(").unwrap(),
                "tombstones are emitted while the rows still exist"
            );
            assert!(
                body.contains("#[cfg(feature = \"enterprise\")]\n    emit_org_trigger_tombstones"),
                "the super-cluster emit exists only in enterprise builds"
            );
            assert!(
                body.find("delete_org_workflow_rows(").unwrap()
                    < body.find("forget_org_triggers(org_id, &gone)").unwrap(),
                "caches are evicted after the delete, so no reload finds the rows again"
            );
        }

        #[cfg(feature = "enterprise")]
        #[tokio::test]
        async fn org_delete_emits_a_deleted_snapshot_per_trigger_before_deleting() {
            let db = db().await;
            seed_trigger(&db, "gone").await;
            seed_trigger(&db, "kept").await;
            let snapshots = org_trigger_tombstones(&db, "gone", NOW, "r1")
                .await
                .unwrap();
            assert_eq!(snapshots.len(), 1);
            let snapshot = &snapshots[0];
            assert_eq!(snapshot.trigger.id, "t-gone");
            assert!(snapshot.deleted);
            assert_eq!(snapshot.version, 4, "local version + 1");
            assert_eq!(snapshot.trigger.updated_at, NOW);
            assert_eq!(snapshot.trigger.deleted_at, Some(NOW));
            assert_eq!(snapshot.origin_cluster, "r1");
            let local = http_triggers::get(&db, "t-gone").await.unwrap().unwrap();
            assert!(
                snapshot.supersedes(Some(&local)),
                "a receiver holding the local row applies it"
            );
            assert_eq!(snapshot.credentials.len(), 1);
            assert_eq!(
                snapshot.credentials[0].state,
                http_triggers::CredentialState::Revoked
            );
            assert_eq!(snapshot.credentials[0].secret, None);
            assert_eq!(
                hook_rows(&db, "gone").await,
                [1, 1, 1, 1],
                "nothing deleted yet"
            );
        }
    }
}
