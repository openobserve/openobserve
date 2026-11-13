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

//! Table ops for status pages: the reads the rebuilder batches per tick and
//! the notice/snapshot writes it makes only when something changed.
//!
//! Everything here is bounded and indexed — no unbounded scans, no
//! request-time callers. The public serving path reads only
//! [`get_page_by_slug`] and [`get_snapshot`].

use std::collections::HashSet;

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, TransactionTrait,
    prelude::Expr,
    sea_query::{LockType, Query},
};

use super::entity::{
    status_page_audit_log, status_page_check_snoozes, status_page_component_checks,
    status_page_components, status_page_custom_domains, status_page_notice_components,
    status_page_notice_updates, status_page_notices, status_page_snapshots, status_pages,
    synthetics_checks,
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// The columns the auto-incident engine needs per mapped check —
/// deliberately not the whole row (config/secrets are KB each).
#[derive(Clone, Debug)]
pub struct CheckStateRow {
    pub id: String,
    pub org_id: String,
    /// Badge of the latest run; the No data rule reads it, the engine never does.
    pub last_check_status: i32,
    /// Consecutive Down run verdicts.
    pub down_runs: i32,
    /// Consecutive Up run verdicts.
    pub up_runs: i32,
    pub last_triggered_at: i64,
    /// `scheduled_ts` of the newest finalized run.
    pub status_run_ts: i64,
    /// `RunClass` DB integer of the newest finalized run.
    pub last_run_class: i32,
    /// `scheduled_ts` of the first run in the current `last_run_class`.
    pub last_run_class_at: i64,
    /// `scheduled_ts` of the newest finalized run that tested the site. 0 = none.
    pub last_tested_at: i64,
    /// Finish time of the run that started the current Up streak. A false alarm hold matches it.
    pub recovered_at: i64,
    /// A writer of this build wrote the streaks. When false, no false alarm hold may apply,
    /// because an older build can have missed a recovery. See `StatusStreaks::signed`.
    pub signed: bool,
    /// Seconds between scheduled runs; 0 for cron.
    pub interval_secs: i64,
    pub created_at: i64,
}

pub async fn get_page_by_slug<C: ConnectionTrait>(
    conn: &C,
    slug: &str,
) -> Result<Option<status_pages::Model>, errors::Error> {
    Ok(status_pages::Entity::find()
        .filter(status_pages::Column::Slug.eq(slug))
        .one(conn)
        .await?)
}

pub async fn get_snapshot<C: ConnectionTrait>(
    conn: &C,
    page_id: &str,
) -> Result<Option<status_page_snapshots::Model>, errors::Error> {
    Ok(status_page_snapshots::Entity::find_by_id(page_id)
        .one(conn)
        .await?)
}

/// Every non-draft page — the rebuilder's work list.
pub async fn list_published_pages<C: ConnectionTrait>(
    conn: &C,
) -> Result<Vec<status_pages::Model>, errors::Error> {
    Ok(status_pages::Entity::find()
        .filter(status_pages::Column::Visibility.ne(0))
        .all(conn)
        .await?)
}

pub async fn list_components<C: ConnectionTrait>(
    conn: &C,
    page_ids: &[String],
) -> Result<Vec<status_page_components::Model>, errors::Error> {
    Ok(status_page_components::Entity::find()
        .filter(status_page_components::Column::StatusPageId.is_in(page_ids.iter().cloned()))
        .all(conn)
        .await?)
}

pub async fn list_component_checks<C: ConnectionTrait>(
    conn: &C,
    component_ids: &[String],
) -> Result<Vec<status_page_component_checks::Model>, errors::Error> {
    Ok(status_page_component_checks::Entity::find()
        .filter(
            status_page_component_checks::Column::ComponentId.is_in(component_ids.iter().cloned()),
        )
        .all(conn)
        .await?)
}

/// Batched check-state read for the engine — three columns per check, never
/// the multi-KB definition.
///
/// `since`: when `Some(watermark)`, returns only rows whose `updated_at` moved
/// strictly after the watermark — the delta read the rebuilder uses every tick
/// so its cost tracks status *changes*, not the mapped-check count. `None` is a
/// full read of the given ids (the periodic safety sweep, which also catches
/// deletions and refreshes `last_triggered_at` for the dead-probe rule).
/// Returns `(rows, max_updated_at_seen)` so the caller can advance its watermark
/// without a second query.
pub async fn get_check_states<C: ConnectionTrait>(
    conn: &C,
    check_ids: &[String],
    since: Option<i64>,
) -> Result<(Vec<CheckStateRow>, i64), errors::Error> {
    let mut q = synthetics_checks::Entity::find()
        .select_only()
        .column(synthetics_checks::Column::Id)
        .column(synthetics_checks::Column::OrgId)
        .column(synthetics_checks::Column::LastCheckStatus)
        .column(synthetics_checks::Column::StatusDownRuns)
        .column(synthetics_checks::Column::StatusUpRuns)
        .column(synthetics_checks::Column::LastTriggeredAt)
        .column(synthetics_checks::Column::UpdatedAt)
        .column(synthetics_checks::Column::StatusRunTs)
        .column(synthetics_checks::Column::LastRunClass)
        .column(synthetics_checks::Column::LastRunClassAt)
        .column(synthetics_checks::Column::LastTestedAt)
        .column(synthetics_checks::Column::StatusRecoveredAt)
        .column(synthetics_checks::Column::StatusStreakSig)
        .column(synthetics_checks::Column::Frequency)
        .column(synthetics_checks::Column::CreatedAt)
        .filter(synthetics_checks::Column::Id.is_in(check_ids.iter().cloned()));
    if let Some(watermark) = since {
        q = q.filter(synthetics_checks::Column::UpdatedAt.gt(watermark));
    }
    // Thirteen columns: more than a tuple read takes.
    #[derive(sea_orm::FromQueryResult)]
    struct Row {
        id: String,
        org_id: String,
        last_check_status: i32,
        status_down_runs: i32,
        status_up_runs: i32,
        last_triggered_at: i64,
        updated_at: i64,
        status_run_ts: i64,
        last_run_class: i32,
        last_run_class_at: i64,
        last_tested_at: i64,
        status_recovered_at: i64,
        status_streak_sig: i64,
        frequency: serde_json::Value,
        created_at: i64,
    }
    let rows = q.into_model::<Row>().all(conn).await?;
    let mut max_updated = since.unwrap_or(0);
    let out = rows
        .into_iter()
        .map(|r| {
            if r.updated_at > max_updated {
                max_updated = r.updated_at;
            }
            let interval_secs =
                serde_json::from_value::<config::meta::synthetics::SyntheticFrequency>(r.frequency)
                    .map(|f| f.interval_secs())
                    .unwrap_or(0);
            CheckStateRow {
                id: r.id,
                org_id: r.org_id,
                last_check_status: r.last_check_status,
                down_runs: r.status_down_runs,
                up_runs: r.status_up_runs,
                last_triggered_at: r.last_triggered_at,
                status_run_ts: r.status_run_ts,
                last_run_class: r.last_run_class,
                last_run_class_at: r.last_run_class_at,
                last_tested_at: r.last_tested_at,
                recovered_at: r.status_recovered_at,
                signed: r.status_streak_sig
                    == super::synthetics_checks::streak_sig(
                        r.status_down_runs,
                        r.status_up_runs,
                        r.status_run_ts,
                        r.last_run_class,
                        r.status_recovered_at,
                    ),
                interval_secs,
                created_at: r.created_at,
            }
        })
        .collect();
    Ok((out, max_updated))
}

/// Notices the engine and snapshots need: not deleted, and open or resolved
/// after `resolved_cutoff` (90d for history; the merge window rides within).
pub async fn list_notices_since<C: ConnectionTrait>(
    conn: &C,
    resolved_cutoff: i64,
) -> Result<Vec<status_page_notices::Model>, errors::Error> {
    Ok(status_page_notices::Entity::find()
        .filter(status_page_notices::Column::DeletedAt.is_null())
        .filter(
            status_page_notices::Column::ResolvedAt
                .is_null()
                .or(status_page_notices::Column::ResolvedAt.gt(resolved_cutoff)),
        )
        .all(conn)
        .await?)
}

pub async fn list_notice_components<C: ConnectionTrait>(
    conn: &C,
    notice_ids: &[String],
) -> Result<Vec<status_page_notice_components::Model>, errors::Error> {
    Ok(status_page_notice_components::Entity::find()
        .filter(status_page_notice_components::Column::NoticeId.is_in(notice_ids.iter().cloned()))
        .all(conn)
        .await?)
}

/// Batched read for the rebuilder: every posted update across a shard's
/// notices in one query, oldest first so the caller can group-by-notice
/// without a second sort.
pub async fn list_notice_updates_for<C: ConnectionTrait>(
    conn: &C,
    notice_ids: &[String],
) -> Result<Vec<status_page_notice_updates::Model>, errors::Error> {
    Ok(status_page_notice_updates::Entity::find()
        .filter(status_page_notice_updates::Column::NoticeId.is_in(notice_ids.iter().cloned()))
        .order_by_asc(status_page_notice_updates::Column::CreatedAt)
        .all(conn)
        .await?)
}

pub async fn list_active_snoozes<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<Vec<status_page_check_snoozes::Model>, errors::Error> {
    Ok(status_page_check_snoozes::Entity::find()
        .filter(status_page_check_snoozes::Column::SnoozedUntil.gt(now))
        .all(conn)
        .await?)
}

pub async fn insert_notice<C: ConnectionTrait>(
    conn: &C,
    model: status_page_notices::Model,
) -> Result<(), errors::Error> {
    model.into_active_model().insert(conn).await?;
    Ok(())
}

pub async fn insert_notice_component<C: ConnectionTrait>(
    conn: &C,
    model: status_page_notice_components::Model,
) -> Result<(), errors::Error> {
    model.into_active_model().insert(conn).await?;
    Ok(())
}

/// Notices for the admin plane: an org's manual + auto notices, newest first,
/// not soft-deleted. Unlike [`list_notices_since`] this has no resolved-age
/// cutoff — the admin list shows full history, not just the rebuilder's
/// 90-day snapshot window.
pub async fn list_notices_for_org(
    org_id: &str,
) -> Result<Vec<status_page_notices::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(status_page_notices::Entity::find()
        .filter(status_page_notices::Column::OrgId.eq(org_id))
        .filter(status_page_notices::Column::DeletedAt.is_null())
        .order_by_desc(status_page_notices::Column::StartsAt)
        .all(conn)
        .await?)
}

pub async fn get_notice_by_id(
    org_id: &str,
    id: &str,
) -> Result<Option<status_page_notices::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(status_page_notices::Entity::find_by_id(id)
        .filter(status_page_notices::Column::OrgId.eq(org_id))
        .filter(status_page_notices::Column::DeletedAt.is_null())
        .one(conn)
        .await?)
}

/// [`get_notice_by_id`] from the primary. A read right after a write must not see a replica
/// that lags behind it.
pub async fn get_notice_by_id_primary(
    org_id: &str,
    id: &str,
) -> Result<Option<status_page_notices::Model>, errors::Error> {
    let conn = get_orm_client_rw().await;
    Ok(status_page_notices::Entity::find_by_id(id)
        .filter(status_page_notices::Column::OrgId.eq(org_id))
        .filter(status_page_notices::Column::DeletedAt.is_null())
        .one(conn)
        .await?)
}

/// Full-row replace for the admin write path (create/edit/mark-false-positive
/// all go through here) — unlike [`update_notice_runtime`] this is not a
/// column-selective patch, so the caller supplies the complete model.
pub async fn put_notice(model: &status_page_notices::Model) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    let am = model.clone().into_active_model().reset_all();
    am.update(conn).await?;
    Ok(())
}

pub async fn replace_notice_components(
    org_id: &str,
    notice_id: &str,
    component_ids: &[String],
) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    status_page_notice_components::Entity::delete_many()
        .filter(status_page_notice_components::Column::NoticeId.eq(notice_id))
        .exec(conn)
        .await?;
    for component_id in component_ids {
        status_page_notice_components::Model {
            id: config::ider::generate(),
            notice_id: notice_id.to_string(),
            component_id: component_id.clone(),
            org_id: org_id.to_string(),
        }
        .into_active_model()
        .insert(conn)
        .await?;
    }
    Ok(())
}

pub async fn soft_delete_notice(org_id: &str, id: &str, at: i64) -> Result<bool, errors::Error> {
    let conn = get_orm_client_rw().await;
    let res = status_page_notices::Entity::update_many()
        .col_expr(status_page_notices::Column::DeletedAt, Expr::value(at))
        .col_expr(status_page_notices::Column::UpdatedAt, Expr::value(at))
        .filter(status_page_notices::Column::Id.eq(id))
        .filter(status_page_notices::Column::OrgId.eq(org_id))
        .filter(status_page_notices::Column::DeletedAt.is_null())
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

pub async fn insert_notice_update(
    model: status_page_notice_updates::Model,
) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    model.into_active_model().insert(conn).await?;
    Ok(())
}

/// Admin history view for one notice, newest first — unlike
/// [`list_notice_updates_for`], which the rebuilder needs oldest-first to
/// build the public timeline.
pub async fn list_notice_updates(
    org_id: &str,
    notice_id: &str,
) -> Result<Vec<status_page_notice_updates::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(status_page_notice_updates::Entity::find()
        .filter(status_page_notice_updates::Column::NoticeId.eq(notice_id))
        .filter(status_page_notice_updates::Column::OrgId.eq(org_id))
        .order_by_desc(status_page_notice_updates::Column::CreatedAt)
        .all(conn)
        .await?)
}

/// Org-wide upsert-by-check: snoozing a false positive silences it on every
/// page, so the row is keyed on `synthetics_id` alone (unique index).
pub async fn upsert_check_snooze(
    org_id: &str,
    synthetics_id: &str,
    snoozed_until: i64,
    owner: Option<&str>,
    now: i64,
) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    status_page_check_snoozes::Entity::insert(
        status_page_check_snoozes::Model {
            id: config::ider::generate(),
            org_id: org_id.to_string(),
            synthetics_id: synthetics_id.to_string(),
            snoozed_until,
            owner: owner.map(str::to_string),
            created_at: now,
        }
        .into_active_model(),
    )
    .on_conflict(
        sea_orm::sea_query::OnConflict::column(status_page_check_snoozes::Column::SyntheticsId)
            .update_columns([
                status_page_check_snoozes::Column::SnoozedUntil,
                status_page_check_snoozes::Column::Owner,
            ])
            .to_owned(),
    )
    .exec(conn)
    .await?;
    Ok(())
}

/// Ends a check's org-wide snooze, so an undone false alarm can reopen at once.
pub async fn delete_check_snooze(org_id: &str, synthetics_id: &str) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    status_page_check_snoozes::Entity::delete_many()
        .filter(status_page_check_snoozes::Column::OrgId.eq(org_id))
        .filter(status_page_check_snoozes::Column::SyntheticsId.eq(synthetics_id))
        .exec(conn)
        .await?;
    Ok(())
}

/// The one notice writer the rebuilder uses for open/re-open/recover/resolve:
/// state, resolved_at, segments, and the recovery streak move together.
pub async fn update_notice_runtime<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    state: i32,
    resolved_at: Option<i64>,
    segments: &str,
    auto_recovery_streak: i32,
    now: i64,
) -> Result<(), errors::Error> {
    status_page_notices::Entity::update_many()
        .col_expr(status_page_notices::Column::State, Expr::value(state))
        .col_expr(
            status_page_notices::Column::ResolvedAt,
            Expr::value(resolved_at),
        )
        .col_expr(status_page_notices::Column::Segments, Expr::value(segments))
        .col_expr(
            status_page_notices::Column::AutoRecoveryStreak,
            Expr::value(auto_recovery_streak),
        )
        .col_expr(status_page_notices::Column::UpdatedAt, Expr::value(now))
        .filter(status_page_notices::Column::Id.eq(id))
        // A tick that read the notice before a false alarm mark must not write its old open
        // state over the mark.
        .filter(status_page_notices::Column::FalseAlarmAt.is_null())
        .exec(conn)
        .await?;
    Ok(())
}

/// Writes a false alarm mark only if the notice still holds the `state`, `resolved_at` and empty
/// mark that the caller read, and only the columns the mark owns. Returns false when another
/// write came first, so the caller can read again.
pub async fn mark_notice_false_alarm(
    before: &status_page_notices::Model,
    after: &status_page_notices::Model,
) -> Result<bool, errors::Error> {
    let conn = get_orm_client_rw().await;
    let resolved_was = match before.resolved_at {
        Some(at) => status_page_notices::Column::ResolvedAt.eq(at),
        None => status_page_notices::Column::ResolvedAt.is_null(),
    };
    let res = status_page_notices::Entity::update_many()
        .col_expr(status_page_notices::Column::State, Expr::value(after.state))
        .col_expr(
            status_page_notices::Column::ResolvedAt,
            Expr::value(after.resolved_at),
        )
        .col_expr(
            status_page_notices::Column::Segments,
            Expr::value(after.segments.clone()),
        )
        .col_expr(
            status_page_notices::Column::ExcludedFromUptime,
            Expr::value(after.excluded_from_uptime),
        )
        .col_expr(
            status_page_notices::Column::FalseAlarmBy,
            Expr::value(after.false_alarm_by.clone()),
        )
        .col_expr(
            status_page_notices::Column::FalseAlarmAt,
            Expr::value(after.false_alarm_at),
        )
        .col_expr(
            status_page_notices::Column::FalseAlarmReason,
            Expr::value(after.false_alarm_reason.clone()),
        )
        .col_expr(
            status_page_notices::Column::FalseAlarmRecoveredAt,
            Expr::value(after.false_alarm_recovered_at),
        )
        .col_expr(
            status_page_notices::Column::UpdatedAt,
            Expr::value(after.updated_at),
        )
        .filter(status_page_notices::Column::Id.eq(before.id.as_str()))
        .filter(status_page_notices::Column::OrgId.eq(before.org_id.as_str()))
        .filter(status_page_notices::Column::FalseAlarmAt.is_null())
        .filter(status_page_notices::Column::State.eq(before.state))
        .filter(resolved_was)
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

/// Disarms every false alarm hold. Part of [`super::synthetics_checks::reset_false_alarm_holds`].
pub async fn disarm_false_alarm_holds<C: ConnectionTrait>(conn: &C) -> Result<(), errors::Error> {
    status_page_notices::Entity::update_many()
        .col_expr(
            status_page_notices::Column::FalseAlarmRecoveredAt,
            Expr::value(Option::<i64>::None),
        )
        .filter(status_page_notices::Column::FalseAlarmRecoveredAt.is_not_null())
        .exec(conn)
        .await?;
    Ok(())
}

/// Column-selective snapshot write: pass only the half that changed, so a
/// status flip never rewrites the TOASTed history column (the hot/cold split
/// the WAL math depends on). Inserts the row when it does not exist yet.
pub async fn upsert_snapshot<C: ConnectionTrait>(
    conn: &C,
    page_id: &str,
    org_id: &str,
    history: Option<&str>,
    current: Option<&str>,
    now: i64,
) -> Result<(), errors::Error> {
    let mut update = status_page_snapshots::Entity::update_many();
    if let Some(h) = history {
        update = update
            .col_expr(status_page_snapshots::Column::History, Expr::value(h))
            .col_expr(
                status_page_snapshots::Column::HistoryGeneratedAt,
                Expr::value(now),
            );
    }
    if let Some(c) = current {
        update = update
            .col_expr(status_page_snapshots::Column::Current, Expr::value(c))
            .col_expr(
                status_page_snapshots::Column::CurrentGeneratedAt,
                Expr::value(now),
            );
    }
    if history.is_none() && current.is_none() {
        return Ok(());
    }
    let res = update
        .filter(status_page_snapshots::Column::StatusPageId.eq(page_id))
        .exec(conn)
        .await?;
    if res.rows_affected == 0 {
        // First snapshot for this page: both halves are required.
        insert_snapshot_of_live_page(
            conn,
            page_id,
            org_id,
            history.unwrap_or("{}"),
            current.unwrap_or("{}"),
            now,
        )
        .await?;
    }
    Ok(())
}

// ── Admin CRUD ops (org-scoped, service-facing; fetch conn internally) ────────

pub async fn insert_page(model: &status_pages::Model) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    model.clone().into_active_model().insert(conn).await?;
    Ok(())
}

/// Get a page BY ID, scoped to org (R-3: an id from another org returns None).
pub async fn get_page_by_id(
    org_id: &str,
    id: &str,
) -> Result<Option<status_pages::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(status_pages::Entity::find_by_id(id)
        .filter(status_pages::Column::OrgId.eq(org_id))
        .one(conn)
        .await?)
}

/// Slug uniqueness is global (the public URL carries no org), so this lookup is
/// deliberately org-agnostic — used only to test a candidate slug for collision.
pub async fn get_page_by_slug_any(
    slug: &str,
) -> Result<Option<status_pages::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(status_pages::Entity::find()
        .filter(status_pages::Column::Slug.eq(slug))
        .one(conn)
        .await?)
}

pub async fn list_pages(org_id: &str) -> Result<Vec<status_pages::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(status_pages::Entity::find()
        .filter(status_pages::Column::OrgId.eq(org_id))
        .order_by_desc(status_pages::Column::UpdatedAt)
        .all(conn)
        .await?)
}

pub async fn update_page(model: &status_pages::Model) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    // A Model loaded from the DB converts to an ActiveModel with every field
    // `Unchanged`, so a plain `.update()` writes NOTHING. `reset_all` marks all
    // columns dirty so the mutated fields actually persist. (This bit the
    // password/visibility update: the API reported success while the DB kept
    // visibility=0.)
    let am = model.clone().into_active_model().reset_all();
    am.update(conn).await?;
    Ok(())
}

/// Delete a page (org-scoped) and its components/mappings. Returns whether the
/// page existed.
pub async fn delete_page(org_id: &str, id: &str) -> Result<bool, errors::Error> {
    let conn = get_orm_client_rw().await;
    let comp_ids: Vec<String> = status_page_components::Entity::find()
        .select_only()
        .column(status_page_components::Column::Id)
        .filter(status_page_components::Column::StatusPageId.eq(id))
        .filter(status_page_components::Column::OrgId.eq(org_id))
        .into_tuple::<String>()
        .all(conn)
        .await?;
    if !comp_ids.is_empty() {
        status_page_component_checks::Entity::delete_many()
            .filter(status_page_component_checks::Column::ComponentId.is_in(comp_ids.clone()))
            .exec(conn)
            .await?;
    }
    status_page_components::Entity::delete_many()
        .filter(status_page_components::Column::StatusPageId.eq(id))
        .filter(status_page_components::Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    let res = status_pages::Entity::delete_many()
        .filter(status_pages::Column::Id.eq(id))
        .filter(status_pages::Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

/// Hard-deletes an org's status-page rows, children first; deleting its domains frees their claims.
pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    let txn = get_orm_client_rw().await.begin().await?;
    status_page_audit_log::Entity::delete_many()
        .filter(status_page_audit_log::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    status_page_check_snoozes::Entity::delete_many()
        .filter(status_page_check_snoozes::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    status_page_component_checks::Entity::delete_many()
        .filter(status_page_component_checks::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    status_page_notice_components::Entity::delete_many()
        .filter(status_page_notice_components::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    status_page_notice_updates::Entity::delete_many()
        .filter(status_page_notice_updates::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    status_page_notices::Entity::delete_many()
        .filter(status_page_notices::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    status_page_components::Entity::delete_many()
        .filter(status_page_components::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    status_page_custom_domains::Entity::delete_many()
        .filter(status_page_custom_domains::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    // Pages before snapshots: a snapshot insert that locked its page commits before this
    // delete can take the page, so the snapshot delete below sees that row.
    status_pages::Entity::delete_many()
        .filter(status_pages::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    status_page_snapshots::Entity::delete_many()
        .filter(status_page_snapshots::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(())
}

/// A page's components with each one's mapped check ids, for the admin detail
/// GET (so the edit UI can render the existing mapping).
pub async fn list_components_with_checks(
    org_id: &str,
    page_id: &str,
) -> Result<Vec<config::meta::status_pages::ComponentView>, errors::Error> {
    let conn = get_orm_client_ro().await;
    let comps = status_page_components::Entity::find()
        .filter(status_page_components::Column::StatusPageId.eq(page_id))
        .filter(status_page_components::Column::OrgId.eq(org_id))
        .order_by_asc(status_page_components::Column::SortOrder)
        .all(conn)
        .await?;
    let comp_ids: Vec<String> = comps.iter().map(|c| c.id.clone()).collect();
    let mappings = status_page_component_checks::Entity::find()
        .filter(status_page_component_checks::Column::ComponentId.is_in(comp_ids))
        .all(conn)
        .await?;
    Ok(comps
        .into_iter()
        .map(|c| config::meta::status_pages::ComponentView {
            check_ids: mappings
                .iter()
                .filter(|m| m.component_id == c.id)
                .map(|m| m.synthetics_id.clone())
                .collect(),
            id: c.id,
            name: c.name,
            description: c.description,
        })
        .collect())
}

pub async fn count_components(org_id: &str, page_id: &str) -> Result<i64, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(status_page_components::Entity::find()
        .filter(status_page_components::Column::StatusPageId.eq(page_id))
        .filter(status_page_components::Column::OrgId.eq(org_id))
        .count(conn)
        .await? as i64)
}

/// The distinct pages a set of components belong to — a notice's write path
/// needs this to know which pages' cached snapshots to refresh out of band
/// (a notice is org-scoped and can touch components across several pages).
pub async fn pages_for_components(
    org_id: &str,
    component_ids: &[String],
) -> Result<Vec<String>, errors::Error> {
    let conn = get_orm_client_ro().await;
    let ids: std::collections::HashSet<String> = status_page_components::Entity::find()
        .select_only()
        .column(status_page_components::Column::StatusPageId)
        .filter(status_page_components::Column::Id.is_in(component_ids.iter().cloned()))
        .filter(status_page_components::Column::OrgId.eq(org_id))
        .into_tuple::<String>()
        .all(conn)
        .await?
        .into_iter()
        .collect();
    Ok(ids.into_iter().collect())
}

// ── Super-cluster apply (raw writes; called by the OSS applier, anti-loop) ────
// These deserialize a replicated row and upsert/delete it by primary key. They
// go through the entity layer directly and NEVER the service layer (which
// re-publishes). Snapshots are never applied here — region-local by design.

pub async fn apply_upsert(org_id: &str, tbl: &str, json: &str) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    macro_rules! upsert {
        ($ent:path, $model:ty) => {{
            let model: $model = serde_json::from_str(json)
                .map_err(|e| errors::Error::Message(format!("apply_upsert {tbl}: {e}")))?;
            // Last-write-wins by PK: delete-if-exists then insert keeps it simple
            // and idempotent across the 5 heterogeneous tables.
            let am = model.into_active_model();
            <$ent>::insert(am)
                .on_conflict(
                    sea_orm::sea_query::OnConflict::column(
                        <$ent as sea_orm::EntityTrait>::Column::iter()
                            .next()
                            .unwrap(),
                    )
                    .update_columns(<$ent as sea_orm::EntityTrait>::Column::iter())
                    .to_owned(),
                )
                .exec(conn)
                .await?;
        }};
    }
    use sea_orm::Iterable;

    use super::entity::{
        status_page_check_snoozes, status_page_component_checks, status_page_components,
        status_page_notice_components, status_page_notice_updates, status_page_notices,
        status_pages,
    };
    let _ = org_id; // org is embedded in the row; kept for symmetry/logging
    match tbl {
        "status_pages" => upsert!(status_pages::Entity, status_pages::Model),
        "status_page_components" => {
            upsert!(
                status_page_components::Entity,
                status_page_components::Model
            )
        }
        "status_page_component_checks" => upsert!(
            status_page_component_checks::Entity,
            status_page_component_checks::Model
        ),
        "status_page_notices" => upsert!(status_page_notices::Entity, status_page_notices::Model),
        "status_page_notice_components" => upsert!(
            status_page_notice_components::Entity,
            status_page_notice_components::Model
        ),
        "status_page_notice_updates" => upsert!(
            status_page_notice_updates::Entity,
            status_page_notice_updates::Model
        ),
        "status_page_check_snoozes" => upsert!(
            status_page_check_snoozes::Entity,
            status_page_check_snoozes::Model
        ),
        other => {
            log::warn!("[SUPER_CLUSTER] status_pages apply_upsert: unknown table {other}");
        }
    }
    Ok(())
}

pub async fn apply_delete(org_id: &str, tbl: &str, id: &str) -> Result<(), errors::Error> {
    match tbl {
        "status_pages" => {
            delete_page(org_id, id).await?;
        }
        "status_page_notices" => {
            let conn = get_orm_client_rw().await;
            status_page_notices::Entity::delete_many()
                .filter(status_page_notices::Column::Id.eq(id))
                .filter(status_page_notices::Column::OrgId.eq(org_id))
                .exec(conn)
                .await?;
        }
        other => {
            log::warn!("[SUPER_CLUSTER] status_pages apply_delete: unhandled table {other}");
        }
    }
    Ok(())
}

pub async fn apply_replace_components(
    org_id: &str,
    page_id: &str,
    json: &str,
) -> Result<(), errors::Error> {
    let inputs: Vec<config::meta::status_pages::ComponentInput> = serde_json::from_str(json)
        .map_err(|e| errors::Error::Message(format!("apply_replace_components: {e}")))?;
    replace_components(org_id, page_id, &inputs, config::utils::time::now_micros()).await
}

/// The `overall` status from a page's already-built snapshot, for the admin
/// list health chip. None if no snapshot exists yet (draft / never rebuilt).
pub async fn get_snapshot_overall(
    org_id: &str,
    page_id: &str,
) -> Result<Option<config::meta::status_pages::ComponentStatus>, errors::Error> {
    let conn = get_orm_client_ro().await;
    let Some(row) = status_page_snapshots::Entity::find_by_id(page_id)
        .filter(status_page_snapshots::Column::OrgId.eq(org_id))
        .one(conn)
        .await?
    else {
        return Ok(None);
    };
    // `current` is the serialized SnapshotCurrent; pull just `overall`.
    #[derive(serde::Deserialize)]
    struct OverallOnly {
        overall: config::meta::status_pages::ComponentStatus,
    }
    Ok(serde_json::from_str::<OverallOnly>(&row.current)
        .ok()
        .map(|o| o.overall))
}

/// Append-only audit row (R-4); only an org deletion removes rows.
pub async fn insert_audit(
    org_id: &str,
    actor: &str,
    action: &str,
    notice_id: Option<&str>,
    at: i64,
) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    status_page_audit_log::Model {
        id: config::ider::generate(),
        org_id: org_id.to_string(),
        notice_id: notice_id.map(str::to_string),
        // Action codes are stored as small ints; the string label is folded in
        // via a stable mapping so the log is queryable without a string column
        // explosion. 0 create,1 update,2 delete,3 rotate_slug,4 set_components.
        action: action_code(action),
        actor: actor.to_string(),
        at,
        detail: Some(action.to_string()),
    }
    .into_active_model()
    .insert(conn)
    .await?;
    Ok(())
}

fn action_code(action: &str) -> i32 {
    match action {
        "create_page" => 0,
        "update_page" => 1,
        "delete_page" => 2,
        "rotate_slug" => 3,
        "set_components" => 4,
        "create_notice" => 5,
        "update_notice" => 6,
        "delete_notice" => 7,
        "notice_update" => 8,
        "mark_false_positive" => 9,
        "create_domain" => 10,
        "delete_domain" => 11,
        "verify_domain" => 12,
        "undo_false_positive" => 13,
        _ => 99,
    }
}

/// Belt-and-braces org check for a synthetics check id (R-3 defense in depth).
pub async fn synthetics_check_belongs_to_org(
    org_id: &str,
    check_id: &str,
) -> Result<bool, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(synthetics_checks::Entity::find_by_id(check_id)
        .filter(synthetics_checks::Column::OrgId.eq(org_id))
        .count(conn)
        .await?
        > 0)
}

/// Bulk-replace a page's components and their check-mappings. Components with a
/// matching id are updated in place (stable id — so open notices' joins never
/// dangle mid-outage); id-less ones are created; components no longer present
/// are deleted along with their mappings.
pub async fn replace_components(
    org_id: &str,
    page_id: &str,
    inputs: &[config::meta::status_pages::ComponentInput],
    now: i64,
) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;

    let existing: Vec<String> = status_page_components::Entity::find()
        .select_only()
        .column(status_page_components::Column::Id)
        .filter(status_page_components::Column::StatusPageId.eq(page_id))
        .filter(status_page_components::Column::OrgId.eq(org_id))
        .into_tuple::<String>()
        .all(conn)
        .await?;
    let kept: std::collections::HashSet<&str> =
        inputs.iter().filter_map(|c| c.id.as_deref()).collect();

    let dropped: Vec<String> = existing
        .iter()
        .filter(|id| !kept.contains(id.as_str()))
        .cloned()
        .collect();
    if !dropped.is_empty() {
        status_page_component_checks::Entity::delete_many()
            .filter(status_page_component_checks::Column::ComponentId.is_in(dropped.clone()))
            .exec(conn)
            .await?;
        status_page_components::Entity::delete_many()
            .filter(status_page_components::Column::Id.is_in(dropped))
            .exec(conn)
            .await?;
    }

    for (order, input) in inputs.iter().enumerate() {
        let comp_id = match &input.id {
            Some(id) if existing.iter().any(|e| e == id) => {
                let mut am = status_page_components::ActiveModel {
                    id: sea_orm::ActiveValue::Unchanged(id.clone()),
                    ..Default::default()
                };
                am.name = sea_orm::ActiveValue::Set(input.name.clone());
                am.description = sea_orm::ActiveValue::Set(input.description.clone());
                am.sort_order = sea_orm::ActiveValue::Set(order as i32);
                am.updated_at = sea_orm::ActiveValue::Set(now);
                am.update(conn).await?;
                id.clone()
            }
            _ => {
                let id = config::ider::generate();
                status_page_components::Model {
                    id: id.clone(),
                    status_page_id: page_id.to_string(),
                    org_id: org_id.to_string(),
                    name: input.name.clone(),
                    description: input.description.clone(),
                    sort_order: order as i32,
                    backfill_days: None,
                    created_at: now,
                    updated_at: now,
                }
                .into_active_model()
                .insert(conn)
                .await?;
                id
            }
        };
        status_page_component_checks::Entity::delete_many()
            .filter(status_page_component_checks::Column::ComponentId.eq(comp_id.clone()))
            .exec(conn)
            .await?;
        for check_id in &input.check_ids {
            status_page_component_checks::Model {
                id: config::ider::generate(),
                component_id: comp_id.clone(),
                synthetics_id: check_id.clone(),
                org_id: org_id.to_string(),
            }
            .into_active_model()
            .insert(conn)
            .await?;
        }
    }
    Ok(())
}

/// Insert a domain claim after checking live-uniqueness. Not a single atomic
/// DB constraint (see the migration's note on portable partial indexes) — the
/// existence check and the insert are covered by the same table-wide write
/// lock the other mutation paths in this file use, so a second concurrent
/// claim for the same domain blocks behind the first rather than racing it.
pub async fn insert_domain_if_unclaimed(
    model: &status_page_custom_domains::Model,
) -> Result<bool, errors::Error> {
    let conn = get_orm_client_rw().await;
    let claimed = status_page_custom_domains::Entity::find()
        .filter(status_page_custom_domains::Column::Domain.eq(model.domain.clone()))
        .filter(status_page_custom_domains::Column::ReleasedAt.is_null())
        .count(conn)
        .await?
        > 0;
    if claimed {
        return Ok(false);
    }
    model.clone().into_active_model().insert(conn).await?;
    Ok(true)
}

pub async fn list_domains_for_page(
    org_id: &str,
    page_id: &str,
) -> Result<Vec<status_page_custom_domains::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(status_page_custom_domains::Entity::find()
        .filter(status_page_custom_domains::Column::OrgId.eq(org_id))
        .filter(status_page_custom_domains::Column::StatusPageId.eq(page_id))
        .filter(status_page_custom_domains::Column::ReleasedAt.is_null())
        .order_by_asc(status_page_custom_domains::Column::CreatedAt)
        .all(conn)
        .await?)
}

pub async fn get_domain_by_id(
    org_id: &str,
    id: &str,
) -> Result<Option<status_page_custom_domains::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(status_page_custom_domains::Entity::find_by_id(id)
        .filter(status_page_custom_domains::Column::OrgId.eq(org_id))
        .one(conn)
        .await?)
}

/// Pending/failed domains due a verification pass — the loop's own delta
/// filter, so a fast tick interval stays cheap even with many settled
/// domains. `before` bounds staleness: a row already checked this tick isn't
/// picked up again until the next one.
pub async fn list_domains_due_for_check<C: ConnectionTrait>(
    conn: &C,
    before: i64,
    limit: u64,
) -> Result<Vec<status_page_custom_domains::Model>, errors::Error> {
    Ok(status_page_custom_domains::Entity::find()
        .filter(status_page_custom_domains::Column::ReleasedAt.is_null())
        .filter(status_page_custom_domains::Column::VerificationState.ne(1))
        .filter(
            status_page_custom_domains::Column::LastCheckedAt
                .is_null()
                .or(status_page_custom_domains::Column::LastCheckedAt.lt(before)),
        )
        .order_by_asc(status_page_custom_domains::Column::LastCheckedAt)
        .limit(limit)
        .all(conn)
        .await?)
}

pub async fn update_domain(model: &status_page_custom_domains::Model) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    let am = model.clone().into_active_model().reset_all();
    am.update(conn).await?;
    Ok(())
}

/// Tombstone (never hard-delete, see the entity doc comment). Returns whether
/// a live row existed to release.
pub async fn release_domain(org_id: &str, id: &str, at: i64) -> Result<bool, errors::Error> {
    let conn = get_orm_client_rw().await;
    let Some(existing) = status_page_custom_domains::Entity::find_by_id(id)
        .filter(status_page_custom_domains::Column::OrgId.eq(org_id))
        .filter(status_page_custom_domains::Column::ReleasedAt.is_null())
        .one(conn)
        .await?
    else {
        return Ok(false);
    };
    let mut am = existing.into_active_model();
    am.released_at = sea_orm::ActiveValue::Set(Some(at));
    am.verification_state = sea_orm::ActiveValue::Set(0);
    am.updated_at = sea_orm::ActiveValue::Set(at);
    am.update(conn).await?;
    Ok(true)
}

/// The public hot-path lookup: a live claim for this Host, in ANY
/// verification state. Deliberately not verified-only — the host-routing
/// middleware needs to distinguish "not our domain, fall through to normal
/// app routing" (no row at all) from "our domain, but not yet servable"
/// (a row whose `verification_state != 1`), and only the caller can safely
/// tell those apart, since falling through on the latter would let an
/// unverified/released domain reach the app's own UI/API instead of the
/// neutral holding response the design requires.
pub async fn get_domain_claim_by_host<C: ConnectionTrait>(
    conn: &C,
    domain: &str,
) -> Result<Option<status_page_custom_domains::Model>, errors::Error> {
    Ok(status_page_custom_domains::Entity::find()
        .filter(status_page_custom_domains::Column::Domain.eq(domain))
        .filter(status_page_custom_domains::Column::ReleasedAt.is_null())
        .one(conn)
        .await?)
}

/// The check ids attached to a status page, narrowed to the ids the caller asks about.
///
/// `Some(&[])` answers with nothing rather than falling back to an unfiltered read: reading the
/// whole join table would hand every check in the cluster the status allowance.
pub async fn mapped_check_ids<C: ConnectionTrait>(
    conn: &C,
    filter: Option<&[String]>,
) -> Result<HashSet<String>, errors::Error> {
    if filter.is_some_and(<[String]>::is_empty) {
        return Ok(HashSet::new());
    }
    let mut query = status_page_component_checks::Entity::find()
        .select_only()
        .column(status_page_component_checks::Column::SyntheticsId)
        .distinct();
    if let Some(ids) = filter {
        query = query.filter(
            status_page_component_checks::Column::SyntheticsId
                .is_in(ids.iter().map(String::as_str)),
        );
    }
    let ids: Vec<String> = query.into_tuple().all(conn).await?;
    Ok(ids.into_iter().collect())
}

/// A caller read the page before its deletion may have run, so the insert reads it again.
/// KEY SHARE holds a concurrent delete of the page until this row is visible to it.
async fn insert_snapshot_of_live_page<C: ConnectionTrait>(
    conn: &C,
    page_id: &str,
    org_id: &str,
    history: &str,
    current: &str,
    now: i64,
) -> Result<(), errors::Error> {
    let mut live_page = Query::select();
    live_page
        .exprs([
            Expr::val(page_id),
            Expr::val(org_id),
            Expr::val(history),
            Expr::val(current),
            Expr::val(now),
            Expr::val(now),
        ])
        .from(status_pages::Entity)
        .and_where(status_pages::Column::Id.eq(page_id))
        .lock(LockType::KeyShare);
    let mut insert = Query::insert();
    insert
        .into_table(status_page_snapshots::Entity)
        .columns([
            status_page_snapshots::Column::StatusPageId,
            status_page_snapshots::Column::OrgId,
            status_page_snapshots::Column::History,
            status_page_snapshots::Column::Current,
            status_page_snapshots::Column::HistoryGeneratedAt,
            status_page_snapshots::Column::CurrentGeneratedAt,
        ])
        .select_from(live_page)
        .map_err(|e| errors::Error::Message(e.to_string()))?;
    conn.execute(conn.get_database_backend().build(&insert))
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveValue, ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    /// One connection, not a pool: two connections to `sqlite::memory:` are two databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(
            backend.build(&schema.create_table_from_entity(status_page_component_checks::Entity)),
        )
        .await
        .unwrap();
        db
    }

    async fn map_check(db: &DatabaseConnection, id: &str, component_id: &str, check_id: &str) {
        status_page_component_checks::ActiveModel {
            id: ActiveValue::Set(id.to_string()),
            component_id: ActiveValue::Set(component_id.to_string()),
            synthetics_id: ActiveValue::Set(check_id.to_string()),
            org_id: ActiveValue::Set("acme".to_string()),
        }
        .insert(db)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn mapped_check_ids_filters_to_the_given_ids() {
        let db = db().await;
        map_check(&db, "m1", "c1", "chk_1").await;
        map_check(&db, "m2", "c1", "chk_2").await;

        let asked = ["chk_1".to_string(), "chk_9".to_string()];
        let found = mapped_check_ids(&db, Some(&asked)).await.unwrap();

        assert_eq!(found, HashSet::from(["chk_1".to_string()]));
    }

    #[tokio::test]
    async fn mapped_check_ids_deduplicates_a_check_on_two_components() {
        let db = db().await;
        map_check(&db, "m1", "c1", "chk_1").await;
        map_check(&db, "m2", "c2", "chk_1").await;

        let asked = ["chk_1".to_string()];
        assert_eq!(
            mapped_check_ids(&db, Some(&asked)).await.unwrap(),
            HashSet::from(["chk_1".to_string()]),
        );
    }

    #[tokio::test]
    async fn mapped_check_ids_of_an_empty_filter_returns_nothing() {
        let db = db().await;
        map_check(&db, "m1", "c1", "chk_1").await;

        assert!(
            mapped_check_ids(&db, Some(&[])).await.unwrap().is_empty(),
            "an empty ask must not degrade into reading the whole table",
        );
    }

    #[tokio::test]
    async fn mapped_check_ids_reads_every_row_when_nothing_is_asked_for() {
        let db = db().await;
        map_check(&db, "m1", "c1", "chk_1").await;
        map_check(&db, "m2", "c1", "chk_2").await;

        let found = mapped_check_ids(&db, None).await.unwrap();

        assert_eq!(found.len(), 2);
    }

    async fn snapshot_db() -> DatabaseConnection {
        let db = db().await;
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for table in [
            schema.create_table_from_entity(status_pages::Entity),
            schema.create_table_from_entity(status_page_snapshots::Entity),
        ] {
            db.execute(backend.build(&table)).await.unwrap();
        }
        db
    }

    async fn insert_test_page(db: &DatabaseConnection, id: &str) {
        status_pages::Model {
            id: id.to_string(),
            org_id: "acme".to_string(),
            name: id.to_string(),
            slug: id.to_string(),
            description: None,
            visibility: 1,
            password_hash: None,
            noindex: true,
            show_uptime_percent: false,
            show_timeline_bars: false,
            show_response_time: false,
            confirm_failures: 1,
            confirm_recovery: 1,
            confirm_after_secs: None,
            brand_name: None,
            accent_color: None,
            logo_img: None,
            favicon_img: None,
            tracking_since: None,
            owner: None,
            created_at: 1,
            updated_at: 1,
        }
        .into_active_model()
        .insert(db)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn the_first_snapshot_of_a_page_is_inserted() {
        let db = snapshot_db().await;
        insert_test_page(&db, "p1").await;

        upsert_snapshot(&db, "p1", "acme", Some("[]"), None, 5)
            .await
            .unwrap();

        let row = get_snapshot(&db, "p1").await.unwrap().unwrap();
        assert_eq!((row.history.as_str(), row.current.as_str()), ("[]", "{}"));
    }

    #[tokio::test]
    async fn a_snapshot_write_after_its_page_is_deleted_inserts_nothing() {
        let db = snapshot_db().await;

        upsert_snapshot(&db, "gone", "acme", Some("[]"), Some("{}"), 5)
            .await
            .unwrap();

        assert!(get_snapshot(&db, "gone").await.unwrap().is_none());
    }
}
