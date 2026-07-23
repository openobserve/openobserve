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

use config::spawn_pausable_job;
use infra::{dist_lock, table::org_cleanup_tasks};

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

pub async fn run() -> Result<(), anyhow::Error> {
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
        run_once().await;
    });
    Ok(())
}

async fn run_once() {
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
            tokio::spawn(process_org_tasks(org_tasks))
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

async fn process_org_tasks(tasks: Vec<org_cleanup_tasks::CleanupTask>) {
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

        let result = execute_step(&task.org_id, &task.org_name, &task.step).await;

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

async fn execute_step(org_id: &str, org_name: &str, step: &str) -> Result<(), anyhow::Error> {
    if step == "delete_streams" {
        step_delete_streams(org_id, org_name).await
    } else if let Some(rest) = step.strip_prefix("delete_stream:") {
        step_delete_stream(org_id, rest).await
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

async fn step_delete_stream(org_id: &str, type_and_name: &str) -> Result<(), anyhow::Error> {
    use config::meta::stream::StreamType;

    let (stream_type_str, stream_name) = type_and_name
        .split_once('/')
        .ok_or_else(|| anyhow::anyhow!("invalid stream key: {type_and_name}"))?;

    let stream_type = StreamType::from(stream_type_str);

    // Reuse the compactor's stream-deletion primitive instead of hand-rolling a
    // file_list scan. It removes local-disk files, file_list rows, and dump files
    // over the canonical (BASE_TIME, now) range — avoiding the invalid/overflowing
    // (0, i64::MAX) range that query_for_dump rejects.
    crate::compaction::retention::delete_all(org_id, stream_type, stream_name).await?;

    // Delete the schema entry (delete_all removes data, not the stream definition).
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

/// Delete every alert in an org through the service layer so the ALERTS /
/// STREAM_ALERTS caches evict cluster-wide (via the coordinator delete event) and
/// each alert's scheduler trigger + OFGA ownership is removed — none of which a
/// raw table wipe would do.
async fn delete_org_alerts(org_id: &str) -> Result<(), anyhow::Error> {
    use infra::db::{ORM_CLIENT, connect_to_orm};
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
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

async fn step_delete_db_resources(org_id: &str) -> Result<(), anyhow::Error> {
    #[cfg(feature = "cloud")]
    use infra::table::trial_quota_usage;
    use infra::table::{
        action_scripts, alert_incidents, backfill_jobs, compactor_manual_jobs, dashboards,
        destinations, distinct_values, enrichment_table_urls, enrichment_tables, folders,
        incident_events, kv_store, org_ingestion_tokens, org_storage_providers, re_pattern,
        re_pattern_stream_map, reports, search_queue, service_streams, short_urls, system_settings,
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
    // Delete alerts through the service layer (not a raw table wipe) so the
    // ALERTS/STREAM_ALERTS in-memory caches evict cluster-wide via the coordinator
    // delete event, and each alert's scheduler trigger is torn down. A direct table
    // delete would leave stale alerts in every node's memory until the next restart.
    delete_org_alerts(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/alerts: {e}"))?;
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
    // folders safe to delete after dashboards, timed_annotations, and reports are gone
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
    action_scripts::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/action_scripts: {e}"))?;
    kv_store::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/kv_store: {e}"))?;
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
    re_pattern::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/re_pattern: {e}"))?;
    re_pattern_stream_map::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/re_pattern_stream_map: {e}"))?;
    org_storage_providers::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/org_storage_providers: {e}"))?;
    #[cfg(feature = "cloud")]
    trial_quota_usage::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/trial_quota_usage: {e}"))?;
    org_ingestion_tokens::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/org_ingestion_tokens: {e}"))?;
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
    compactor_manual_jobs::delete_by_org(org_id)
        .await
        .map_err(|e| anyhow::anyhow!("step_delete_db_resources/compactor_manual_jobs: {e}"))?;
    // Delete the S3 result objects backing this org's search jobs BEFORE dropping
    // the DB rows — the result paths are derived from each job's created_at/trace_id,
    // so once the rows are gone the objects can no longer be located and would leak.
    // (search_jobs service is enterprise-only; OSS just drops the rows below.)
    #[cfg(feature = "enterprise")]
    crate::search_jobs::delete_org_result_files(org_id)
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
}
