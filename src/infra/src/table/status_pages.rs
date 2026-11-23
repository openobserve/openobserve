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
    ActiveModelTrait,
    ActiveValue::Set,
    ColumnTrait, Condition, ConnectionTrait, DatabaseBackend, DbErr, EntityTrait, IntoActiveModel,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, SqlErr, Statement, TransactionTrait,
    UpdateMany,
    prelude::Expr,
    sea_query::{Func, LockType, NullOrdering, Query, SimpleExpr},
};

use super::entity::{
    status_page_audit_log, status_page_check_snoozes, status_page_component_checks,
    status_page_components, status_page_custom_domains, status_page_domain_certs,
    status_page_notice_components, status_page_notice_updates, status_page_notices,
    status_page_snapshots, status_pages, synthetics_checks,
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// `verification_state` of a claim.
pub const VERIFICATION_PENDING: i32 = 0;
pub const VERIFIED: i32 = 1;
pub const VERIFICATION_FAILED: i32 = 2;

/// `verification_failure_reason` of a failed claim.
pub const FAILURE_RECORD_MISSING: i32 = 0;
pub const FAILURE_VALUE_MISMATCH: i32 = 1;
pub const FAILURE_DNS_LOOKUP: i32 = 2;
pub const FAILURE_HELD_BY_ANOTHER_ORG: i32 = 3;
pub const FAILURE_PROOF_LOST: i32 = 4;

/// `release_reason` of a released claim.
pub const RELEASED_BY_ORG: i32 = 1;
pub const RELEASED_EXPIRED: i32 = 2;
pub const RELEASED_PAGE_DELETED: i32 = 3;

const MICROS_PER_HOUR: i64 = 3_600 * 1_000_000;
/// A claim with no ownership proof is released this long after its last manual check.
pub const CLAIM_TTL_MICROS: i64 = 7 * 24 * MICROS_PER_HOUR;
/// A holder's proof is checked again this often.
pub const HOLDER_RECHECK_MICROS: i64 = 6 * MICROS_PER_HOUR;
/// How long an expired claim stays in its page's list.
pub const EXPIRED_LISTED_MICROS: i64 = 30 * 24 * MICROS_PER_HOUR;
/// A repair pass completes at most this many claims; the next tick takes the rest.
const REPAIR_BATCH: u64 = 200;
/// A claim's CNAME label: 16 lowercase base32 characters, because DNS ignores case.
const CNAME_LABEL_LEN: usize = 16;
const CNAME_LABEL_ALPHABET: &[u8; 32] = b"abcdefghijklmnopqrstuvwxyz234567";

/// What a new claim became; only `Created` wrote a row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClaimInsert {
    Created,
    HostnameTaken,
    CapReached,
    PageGone,
}

/// What deleting a page removed: whether the page row existed, and the hostnames of the holders
/// its claims released, whose certificates went in the same transaction.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct PageDeleted {
    pub existed: bool,
    pub hostnames: Vec<String>,
}

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
    mark_notice_false_alarm_on(get_orm_client_rw().await, before, after).await
}

/// [`mark_notice_false_alarm`] on a given connection.
pub async fn mark_notice_false_alarm_on<C: ConnectionTrait>(
    conn: &C,
    before: &status_page_notices::Model,
    after: &status_page_notices::Model,
) -> Result<bool, errors::Error> {
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
    get_page_by_id_in(get_orm_client_ro().await, org_id, id).await
}

pub async fn get_page_by_id_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<status_pages::Model>, errors::Error> {
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

/// Delete a page (org-scoped), its components/mappings and, in the same transaction, its claims
/// and the certificates of the holders among them.
pub async fn delete_page<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<PageDeleted, errors::Error> {
    let txn = conn.begin().await?;
    let comp_ids: Vec<String> = status_page_components::Entity::find()
        .select_only()
        .column(status_page_components::Column::Id)
        .filter(status_page_components::Column::StatusPageId.eq(id))
        .filter(status_page_components::Column::OrgId.eq(org_id))
        .into_tuple::<String>()
        .all(&txn)
        .await?;
    if !comp_ids.is_empty() {
        status_page_component_checks::Entity::delete_many()
            .filter(status_page_component_checks::Column::ComponentId.is_in(comp_ids.clone()))
            .exec(&txn)
            .await?;
    }
    status_page_components::Entity::delete_many()
        .filter(status_page_components::Column::StatusPageId.eq(id))
        .filter(status_page_components::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    // The page row goes first so a claim insert that locked it commits before the release below.
    let res = status_pages::Entity::delete_many()
        .filter(status_pages::Column::Id.eq(id))
        .filter(status_pages::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    let hostnames =
        release_page_claims(&txn, org_id, id, config::utils::time::now_micros()).await?;
    txn.commit().await?;
    Ok(PageDeleted {
        existed: res.rows_affected > 0,
        hostnames,
    })
}

/// Hard-deletes an org's status-page rows, children first; deleting its domains frees their claims.
/// The org's certificate rows go in the same transaction; their hostnames come back.
pub async fn delete_by_org(org_id: &str) -> Result<Vec<String>, errors::Error> {
    delete_by_org_in(get_orm_client_rw().await, org_id).await
}

/// [`delete_by_org`] on the caller's connection, in one transaction.
pub async fn delete_by_org_in<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<Vec<String>, errors::Error> {
    let txn = conn.begin().await?;
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
    // Pages first, as a claim insert locks them, so no claim commits after the scan below; then
    // claims, as a release does, so the claim and certificate locks never wait in a cycle.
    status_pages::Entity::find()
        .select_only()
        .column(status_pages::Column::Id)
        .filter(status_pages::Column::OrgId.eq(org_id))
        .order_by_asc(status_pages::Column::Id)
        .lock_exclusive()
        .into_tuple::<String>()
        .all(&txn)
        .await?;
    status_page_custom_domains::Entity::find()
        .select_only()
        .column(status_page_custom_domains::Column::Id)
        .filter(status_page_custom_domains::Column::OrgId.eq(org_id))
        .order_by_asc(status_page_custom_domains::Column::Id)
        .lock_exclusive()
        .into_tuple::<String>()
        .all(&txn)
        .await?;
    let mut hostnames: Vec<String> = Vec::new();
    if super::status_page_domains::certs_enabled() {
        // The page and claim locks above keep any claim, grant or import for this org out.
        hostnames = status_page_domain_certs::Entity::find()
            .select_only()
            .column(status_page_domain_certs::Column::Hostname)
            .filter(status_page_domain_certs::Column::OrgId.eq(org_id))
            .into_tuple()
            .all(&txn)
            .await?;
        status_page_domain_certs::Entity::delete_many()
            .filter(status_page_domain_certs::Column::OrgId.eq(org_id))
            .exec(&txn)
            .await?;
    }
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
    Ok(hostnames)
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
            delete_page(get_orm_client_rw().await, org_id, id).await?;
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
        "release_shadowed" => 14,
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

/// Inserts a claim unless the hostname, the org's cap or the page forbids it, or it has no label.
/// Locking the org's pages makes its concurrent creates, and a page deletion, run one at a time.
pub async fn insert_domain_claim<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    model: &status_page_custom_domains::Model,
    second_claim_allowed: bool,
    org_cap: u64,
) -> Result<ClaimInsert, errors::Error> {
    if model.cname_label.is_none() {
        return Err(errors::Error::Message(
            "a custom domain claim needs a cname label".to_string(),
        ));
    }
    let txn = conn.begin().await?;
    lock_hostname(&txn, &model.domain).await?;
    let pages: Vec<String> = status_pages::Entity::find()
        .select_only()
        .column(status_pages::Column::Id)
        .filter(status_pages::Column::OrgId.eq(&model.org_id))
        .order_by_asc(status_pages::Column::Id)
        .lock_exclusive()
        .into_tuple()
        .all(&txn)
        .await?;
    if !pages.contains(&model.status_page_id) {
        return Ok(ClaimInsert::PageGone);
    }
    let same_host =
        live_claims().filter(status_page_custom_domains::Column::Domain.eq(&model.domain));
    let own = same_host
        .clone()
        .filter(status_page_custom_domains::Column::OrgId.eq(&model.org_id))
        .count(&txn)
        .await?;
    if own > 0 || (!second_claim_allowed && same_host.count(&txn).await? > 0) {
        return Ok(ClaimInsert::HostnameTaken);
    }
    let held = live_claims()
        .filter(status_page_custom_domains::Column::OrgId.eq(&model.org_id))
        .count(&txn)
        .await?;
    if held >= org_cap {
        return Ok(ClaimInsert::CapReached);
    }
    status_page_custom_domains::Entity::insert(model.clone().into_active_model())
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(ClaimInsert::Created)
}

/// A new claim's CNAME label: 16 characters of `a-z2-7` from the OS random source, 80 bits, so
/// no two claims share one in practice and the unique index settles the rest.
pub fn new_cname_label() -> String {
    config::utils::rand::os_random_bytes(CNAME_LABEL_LEN)
        .into_iter()
        .map(|b| char::from(CNAME_LABEL_ALPHABET[usize::from(b & 31)]))
        .collect()
}

/// A page's unreleased claims, plus the ones that expired in the last 30 days.
pub async fn list_domains_for_page<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    page_id: &str,
    now: i64,
) -> Result<Vec<status_page_custom_domains::Model>, errors::Error> {
    use status_page_custom_domains::Column;
    let recently_expired = Condition::all()
        .add(Column::ReleaseReason.eq(RELEASED_EXPIRED))
        .add(Column::ReleaseSeal.gte(now - EXPIRED_LISTED_MICROS));
    Ok(status_page_custom_domains::Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::StatusPageId.eq(page_id))
        .filter(Condition::any().add(unreleased()).add(recently_expired))
        .order_by_asc(Column::CreatedAt)
        .all(conn)
        .await?)
}

pub async fn get_domain_by_id<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<status_page_custom_domains::Model>, errors::Error> {
    Ok(status_page_custom_domains::Entity::find_by_id(id)
        .filter(status_page_custom_domains::Column::OrgId.eq(org_id))
        .one(conn)
        .await?)
}

/// Unreleased claims due a check: non-holders on every tick, holders every 6 hours. A claim the
/// repair has not completed is a non-holder, so it is due too. Released claims are never due.
pub async fn list_domains_due_for_check<C: ConnectionTrait>(
    conn: &C,
    now: i64,
    limit: u64,
) -> Result<Vec<status_page_custom_domains::Model>, errors::Error> {
    use status_page_custom_domains::Column;
    let checked_before = |at: i64| {
        Condition::any()
            .add(Column::LastCheckedAt.is_null())
            .add(Column::LastCheckedAt.lt(at))
    };
    let due = Condition::any()
        .add(
            Condition::all()
                .add(Column::HeldDomain.is_null())
                .add(checked_before(now)),
        )
        .add(
            Condition::all()
                .add(Column::HeldDomain.is_not_null())
                .add(checked_before(now - HOLDER_RECHECK_MICROS)),
        );
    Ok(status_page_custom_domains::Entity::find()
        .filter(unreleased())
        .filter(due)
        .order_by_with_nulls(
            Column::LastCheckedAt,
            sea_orm::Order::Asc,
            NullOrdering::First,
        )
        .limit(limit)
        .all(conn)
        .await?)
}

/// The holder of a hostname: the only claim that routing, certificates and the listener consider.
pub async fn get_domain_claim_by_host<C: ConnectionTrait>(
    conn: &C,
    domain: &str,
) -> Result<Option<status_page_custom_domains::Model>, errors::Error> {
    Ok(status_page_custom_domains::Entity::find()
        .filter(status_page_custom_domains::Column::HeldDomain.eq(domain))
        .filter(unreleased())
        .one(conn)
        .await?)
}

/// The proof was found: the claim holds its hostname, or keeps it. False when another claim holds
/// the hostname, or the claim is released.
pub async fn grant_domain<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    run_claim_update(conn, grant_update(id, now)).await
}

/// Lapses the holder and grants the claimant its hostname, both or neither. The decision comes
/// from one DNS answer; the holder is the one seen before it, identified by its `verified_at`,
/// which every grant moves, so a holder that was displaced and regained the hostname is not it.
pub async fn displace_holder<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    holder_id: &str,
    claimant_id: &str,
    host: &str,
    holder_verified_at: Option<i64>,
    now: i64,
) -> Result<bool, errors::Error> {
    use status_page_custom_domains::Column;
    let txn = conn.begin().await?;
    let lapse = live_claim_update(holder_id)
        .filter(Column::HeldDomain.eq(host))
        .filter(verified_at_is(holder_verified_at))
        .set(status_page_custom_domains::ActiveModel {
            verification_state: Set(VERIFICATION_FAILED),
            verification_failure_reason: Set(Some(FAILURE_PROOF_LOST)),
            held_domain: Set(None),
            expires_at: Set(Some(now + CLAIM_TTL_MICROS)),
            updated_at: Set(now),
            ..Default::default()
        })
        .col_expr(
            Column::ProofFailedSince,
            first_set(Column::ProofFailedSince, now),
        );
    if !run_claim_update(&txn, lapse).await? {
        return Ok(false);
    }
    if !run_claim_update(
        &txn,
        grant_update(claimant_id, now).filter(Column::Domain.eq(host)),
    )
    .await?
    {
        return Ok(false);
    }
    txn.commit().await?;
    Ok(true)
}

/// A non-holder's check failed with `reason`. A holder is never failed by a check.
pub async fn fail_domain<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    reason: i32,
    now: i64,
) -> Result<bool, errors::Error> {
    use status_page_custom_domains::Column;
    let update = live_claim_update(id)
        .filter(Column::HeldDomain.is_null())
        .set(status_page_custom_domains::ActiveModel {
            verification_state: Set(VERIFICATION_FAILED),
            verification_failure_reason: Set(Some(reason)),
            last_checked_at: Set(Some(now)),
            updated_at: Set(now),
            ..Default::default()
        });
    run_claim_update(conn, update).await
}

/// A holder's check got a negative answer: only the first failure time is kept, nothing lapses.
pub async fn record_holder_proof_failure<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    use status_page_custom_domains::Column;
    let update = live_claim_update(id)
        .filter(Column::HeldDomain.is_not_null())
        .set(checked_at(now))
        .col_expr(
            Column::ProofFailedSince,
            first_set(Column::ProofFailedSince, now),
        );
    run_claim_update(conn, update).await
}

/// A check got no answer: the claim keeps every other column.
pub async fn record_resolver_error<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    run_claim_update(conn, live_claim_update(id).set(checked_at(now))).await
}

/// "Verify now" on a non-holder moves its expiry to 7 days from `now`; the loop never does.
pub async fn extend_claim_expiry<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    use status_page_custom_domains::Column;
    let update = live_claim_update(id)
        .filter(Column::HeldDomain.is_null())
        .set(status_page_custom_domains::ActiveModel {
            expires_at: Set(Some(now + CLAIM_TTL_MICROS)),
            updated_at: Set(now),
            ..Default::default()
        });
    run_claim_update(conn, update).await
}

/// Releases one claim in the caller's transaction and returns its hostname when it was the holder.
/// The holder's certificate row goes with it; the caller emits the cert event after commit.
pub async fn release_domain_in<C: ConnectionTrait>(
    txn: &C,
    org_id: &str,
    id: &str,
    at: i64,
    reason: i32,
) -> Result<Option<String>, errors::Error> {
    match find_unreleased_claim(txn, org_id, id).await? {
        Some(claim) => release_claim(txn, &claim, at, reason).await,
        None => Ok(None),
    }
}

/// Releases an org's claim in its own transaction. `None` when no unreleased claim existed;
/// otherwise the hostname when the claim was the holder, whose certificate went with it.
pub async fn release_domain<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    at: i64,
    reason: i32,
) -> Result<Option<Option<String>>, errors::Error> {
    let txn = conn.begin().await?;
    let Some(claim) = find_unreleased_claim(&txn, org_id, id).await? else {
        return Ok(None);
    };
    let hostname = release_claim(&txn, &claim, at, reason).await?;
    txn.commit().await?;
    Ok(Some(hostname))
}

/// Releases every non-holder whose expiry has passed; returns how many.
pub async fn release_expired_claims<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<u64, errors::Error> {
    use status_page_custom_domains::Column;
    let update = release_update(now, RELEASED_EXPIRED)
        .filter(unreleased())
        .filter(Column::HeldDomain.is_null())
        .filter(Column::ExpiresAt.lte(now));
    Ok(update.exec(conn).await?.rows_affected)
}

/// Releases every non-holder of a hostname that another claim holds; returns how many. Run
/// before a rollback to a release that reads claims by hostname alone.
pub async fn release_shadowed_claims<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<u64, errors::Error> {
    use status_page_custom_domains::Column;
    let holders = Query::select()
        .column(Column::HeldDomain)
        .from(status_page_custom_domains::Entity)
        .cond_where(unreleased())
        .and_where(Column::HeldDomain.is_not_null())
        .to_owned();
    let update = release_update(now, RELEASED_EXPIRED)
        .filter(unreleased())
        .filter(Column::HeldDomain.is_null())
        .filter(Column::Domain.in_subquery(holders));
    Ok(update.exec(conn).await?.rows_affected)
}

/// Completes what an older build left half done, on every verifier tick: its releases (sealed,
/// their hostname freed), its verifications (granted or failed), its claims with no expiry.
pub async fn repair_claims<C: ConnectionTrait>(conn: &C, now: i64) -> Result<(), errors::Error> {
    seal_legacy_releases(conn).await?;
    promote_and_expire(conn, now).await
}

/// [`repair_claims`] for the time an older node is online, whose unlocked insert can leave two
/// claims for one hostname: after the seal it keeps one per hostname, by the migration's rule.
pub async fn repair_claims_settling_duplicates<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<(), errors::Error> {
    seal_legacy_releases(conn).await?;
    super::migration::settle_duplicates(conn, now, false).await?;
    promote_and_expire(conn, now).await
}

/// The claim table as the migrations leave it, for tests in any crate.
#[cfg(any(test, feature = "test-utils"))]
pub async fn create_domains_table_for_tests(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), sea_orm::DbErr> {
    super::migration::create_status_page_custom_domains_table(db).await
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

fn unreleased() -> Condition {
    use status_page_custom_domains::Column;
    Condition::all()
        .add(Column::ReleasedAt.is_null())
        .add(Column::ReleaseSeal.is_null())
}

fn live_claims() -> sea_orm::Select<status_page_custom_domains::Entity> {
    status_page_custom_domains::Entity::find().filter(unreleased())
}

/// Every claim write starts here, so none can touch a released row.
fn live_claim_update(id: &str) -> UpdateMany<status_page_custom_domains::Entity> {
    status_page_custom_domains::Entity::update_many()
        .filter(status_page_custom_domains::Column::Id.eq(id))
        .filter(unreleased())
}

/// `column = COALESCE(column, now)`: the first value stays.
fn first_set(column: status_page_custom_domains::Column, now: i64) -> SimpleExpr {
    Func::coalesce([
        SimpleExpr::from(Expr::col(column)),
        SimpleExpr::from(Expr::val(now)),
    ])
    .into()
}

/// `now`, or one more than the current value when that is not before `now`: strictly forward on
/// every grant, so the value tells two grants of one claim apart even within one microsecond.
fn moved_forward(column: status_page_custom_domains::Column, now: i64) -> SimpleExpr {
    sea_orm::sea_query::CaseStatement::new()
        .case(
            Condition::any().add(column.is_null()).add(column.lt(now)),
            Expr::value(now),
        )
        .finally(Expr::col(column).add(1))
        .into()
}

fn checked_at(now: i64) -> status_page_custom_domains::ActiveModel {
    status_page_custom_domains::ActiveModel {
        last_checked_at: Set(Some(now)),
        updated_at: Set(now),
        ..Default::default()
    }
}

/// `held_domain = domain` in the statement that marks the claim verified; the unique index lets
/// one claim win.
fn grant_update(id: &str, now: i64) -> UpdateMany<status_page_custom_domains::Entity> {
    use status_page_custom_domains::Column;
    live_claim_update(id)
        .filter(
            Condition::any()
                .add(Column::HeldDomain.is_null())
                .add(Expr::col(Column::HeldDomain).equals(Column::Domain)),
        )
        .set(status_page_custom_domains::ActiveModel {
            verification_state: Set(VERIFIED),
            verification_failure_reason: Set(None),
            last_checked_at: Set(Some(now)),
            updated_at: Set(now),
            proof_failed_since: Set(None),
            expires_at: Set(None),
            ..Default::default()
        })
        .col_expr(Column::HeldDomain, Expr::col(Column::Domain).into())
        .col_expr(Column::VerifiedAt, moved_forward(Column::VerifiedAt, now))
}

fn release_update(at: i64, reason: i32) -> UpdateMany<status_page_custom_domains::Entity> {
    status_page_custom_domains::Entity::update_many().set(status_page_custom_domains::ActiveModel {
        released_at: Set(Some(at)),
        release_seal: Set(Some(at)),
        release_reason: Set(Some(reason)),
        held_domain: Set(None),
        updated_at: Set(at),
        ..Default::default()
    })
}

/// A lost unique-index race is an answer (false), not an error.
async fn run_claim_update<C: ConnectionTrait>(
    conn: &C,
    update: UpdateMany<status_page_custom_domains::Entity>,
) -> Result<bool, errors::Error> {
    match update.exec(conn).await {
        Ok(done) => Ok(done.rows_affected > 0),
        Err(e) if is_unique_violation(&e) => Ok(false),
        Err(e) => Err(e.into()),
    }
}

fn is_unique_violation(e: &DbErr) -> bool {
    matches!(e.sql_err(), Some(SqlErr::UniqueConstraintViolation(_)))
}

async fn find_unreleased_claim<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<status_page_custom_domains::Model>, errors::Error> {
    Ok(live_claims()
        .filter(status_page_custom_domains::Column::Id.eq(id))
        .filter(status_page_custom_domains::Column::OrgId.eq(org_id))
        .lock_exclusive()
        .one(conn)
        .await?)
}

/// Serialises the claims of one hostname on PostgreSQL; SQLite already runs one writer at a time.
async fn lock_hostname<C: ConnectionTrait>(txn: &C, domain: &str) -> Result<(), errors::Error> {
    if txn.get_database_backend() == DatabaseBackend::Postgres {
        txn.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            [domain.into()],
        ))
        .await?;
    }
    Ok(())
}

/// Sets both release marks and clears `held_domain`; the hostname comes back when it was held,
/// and the holder's certificate row is deleted. `cname_label` stays, so no claim ever gets it
/// again.
async fn release_claim<C: ConnectionTrait>(
    txn: &C,
    claim: &status_page_custom_domains::Model,
    at: i64,
    reason: i32,
) -> Result<Option<String>, errors::Error> {
    let update = release_update(at, reason)
        .filter(status_page_custom_domains::Column::Id.eq(&claim.id))
        .filter(unreleased());
    let released = update.exec(txn).await?.rows_affected > 0;
    let Some(hostname) = claim.held_domain.as_ref().filter(|_| released) else {
        return Ok(None);
    };
    if super::status_page_domains::certs_enabled() {
        status_page_domain_certs::Entity::delete_many()
            .filter(status_page_domain_certs::Column::Hostname.eq(hostname))
            .filter(status_page_domain_certs::Column::ClaimId.eq(&claim.id))
            .exec(txn)
            .await?;
    }
    Ok(Some(hostname.clone()))
}

async fn release_page_claims<C: ConnectionTrait>(
    txn: &C,
    org_id: &str,
    page_id: &str,
    at: i64,
) -> Result<Vec<String>, errors::Error> {
    let claims = live_claims()
        .filter(status_page_custom_domains::Column::OrgId.eq(org_id))
        .filter(status_page_custom_domains::Column::StatusPageId.eq(page_id))
        .lock_exclusive()
        .all(txn)
        .await?;
    let mut hostnames = Vec::new();
    for claim in &claims {
        hostnames.extend(release_claim(txn, claim, at, RELEASED_PAGE_DELETED).await?);
    }
    Ok(hostnames)
}

/// A claim an older build marked verified has no holder yet: grant it, or fail it when another
/// claim holds the hostname. The older claim goes first.
async fn complete_old_verifications<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<(), errors::Error> {
    use status_page_custom_domains::Column;
    let claims = live_claims()
        .filter(Column::VerificationState.eq(VERIFIED))
        .filter(Column::HeldDomain.is_null())
        .order_by_asc(Column::CreatedAt)
        .order_by_asc(Column::Id)
        .limit(REPAIR_BATCH)
        .all(conn)
        .await?;
    complete_claims(conn, &claims, now).await
}

/// Grants or fails each claim only while it is still the unheld row repair selected, so a check
/// that got there first keeps its newer result.
async fn complete_claims<C: ConnectionTrait>(
    conn: &C,
    claims: &[status_page_custom_domains::Model],
    now: i64,
) -> Result<(), errors::Error> {
    use status_page_custom_domains::Column;
    for claim in claims {
        let grant = grant_update(&claim.id, now)
            .filter(Column::HeldDomain.is_null())
            .filter(Column::VerificationState.eq(VERIFIED))
            .filter(verified_at_is(claim.verified_at));
        if !run_claim_update(conn, grant).await? {
            let fail = live_claim_update(&claim.id)
                .filter(Column::HeldDomain.is_null())
                .filter(Column::VerificationState.eq(VERIFIED))
                .filter(verified_at_is(claim.verified_at))
                .set(status_page_custom_domains::ActiveModel {
                    verification_state: Set(VERIFICATION_FAILED),
                    verification_failure_reason: Set(Some(FAILURE_HELD_BY_ANOTHER_ORG)),
                    last_checked_at: Set(Some(now)),
                    updated_at: Set(now),
                    ..Default::default()
                });
            run_claim_update(conn, fail).await?;
        }
    }
    Ok(())
}

fn verified_at_is(seen: Option<i64>) -> Condition {
    use status_page_custom_domains::Column;
    match seen {
        Some(at) => Condition::all().add(Column::VerifiedAt.eq(at)),
        None => Condition::all().add(Column::VerifiedAt.is_null()),
    }
}

/// Seals a release an older build did and frees its holder slot; lifts a release mark an older
/// verifier's whole-row write removed from a sealed claim.
async fn seal_legacy_releases<C: ConnectionTrait>(conn: &C) -> Result<(), errors::Error> {
    use status_page_custom_domains::Column;
    let seal = status_page_custom_domains::Entity::update_many()
        .set(status_page_custom_domains::ActiveModel {
            release_reason: Set(Some(RELEASED_BY_ORG)),
            held_domain: Set(None),
            ..Default::default()
        })
        .col_expr(Column::ReleaseSeal, Expr::col(Column::ReleasedAt).into())
        .filter(Column::ReleasedAt.is_not_null())
        .filter(Column::ReleaseSeal.is_null());
    seal.exec(conn).await?;
    let relift = status_page_custom_domains::Entity::update_many()
        .set(status_page_custom_domains::ActiveModel {
            verification_state: Set(VERIFICATION_PENDING),
            held_domain: Set(None),
            ..Default::default()
        })
        .col_expr(Column::ReleasedAt, Expr::col(Column::ReleaseSeal).into())
        .filter(Column::ReleaseSeal.is_not_null())
        .filter(Column::ReleasedAt.is_null());
    relift.exec(conn).await?;
    Ok(())
}

/// The survivor of a legacy verification is granted by the guarded repair; claims with no expiry
/// get one; claims an older build inserted get their label.
async fn promote_and_expire<C: ConnectionTrait>(conn: &C, now: i64) -> Result<(), errors::Error> {
    use status_page_custom_domains::Column;
    complete_old_verifications(conn, now).await?;
    let start_expiry = status_page_custom_domains::Entity::update_many()
        .set(status_page_custom_domains::ActiveModel {
            expires_at: Set(Some(now + CLAIM_TTL_MICROS)),
            ..Default::default()
        })
        .filter(unreleased())
        .filter(Column::HeldDomain.is_null())
        .filter(Column::ExpiresAt.is_null());
    start_expiry.exec(conn).await?;
    give_missing_labels(conn).await
}

/// A pod of the previous release inserts claims without a label. Each write names the unlabeled
/// row, so no label changes; one that collides waits for the next tick.
async fn give_missing_labels<C: ConnectionTrait>(conn: &C) -> Result<(), errors::Error> {
    use status_page_custom_domains::Column;
    let unlabeled: Vec<String> = live_claims()
        .select_only()
        .column(Column::Id)
        .filter(Column::CnameLabel.is_null())
        .order_by_asc(Column::CreatedAt)
        .order_by_asc(Column::Id)
        .limit(REPAIR_BATCH)
        .into_tuple()
        .all(conn)
        .await?;
    for id in unlabeled {
        let give = live_claim_update(&id)
            .filter(Column::CnameLabel.is_null())
            .set(status_page_custom_domains::ActiveModel {
                cname_label: Set(Some(new_cname_label())),
                ..Default::default()
            });
        run_claim_update(conn, give).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveValue, ConnectOptions, Database, DatabaseConnection, Schema};
    use status_page_custom_domains as claims;

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
        insert_org_page(db, "acme", id).await;
    }

    async fn insert_org_page(db: &DatabaseConnection, org_id: &str, id: &str) {
        status_pages::Model {
            id: id.to_string(),
            org_id: org_id.to_string(),
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

    async fn notices_db() -> DatabaseConnection {
        let db = db().await;
        let backend = db.get_database_backend();
        db.execute(
            backend
                .build(&Schema::new(backend).create_table_from_entity(status_page_notices::Entity)),
        )
        .await
        .unwrap();
        db
    }

    fn open_notice() -> status_page_notices::Model {
        status_page_notices::Model {
            id: "n1".into(),
            org_id: "org1".into(),
            kind: 0,
            impact: 0,
            source: 0,
            title: String::new(),
            body: String::new(),
            state: 1,
            starts_at: 0,
            resolved_at: None,
            segments: "[]".into(),
            excluded_from_uptime: false,
            deleted_at: None,
            auto_check_id: Some("mon-1".into()),
            auto_recovery_streak: 0,
            owner: None,
            false_alarm_by: None,
            false_alarm_at: None,
            false_alarm_reason: None,
            false_alarm_recovered_at: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn marked(
        before: &status_page_notices::Model,
        by: &str,
        at: i64,
        stamp: i64,
    ) -> status_page_notices::Model {
        status_page_notices::Model {
            state: 2,
            resolved_at: Some(at),
            excluded_from_uptime: true,
            false_alarm_by: Some(by.into()),
            false_alarm_at: Some(at),
            false_alarm_reason: Some("probe".into()),
            false_alarm_recovered_at: Some(stamp),
            updated_at: at,
            ..before.clone()
        }
    }

    #[tokio::test]
    async fn of_two_marks_from_the_same_read_only_the_first_writes() {
        let db = notices_db().await;
        let before = open_notice();
        let am: status_page_notices::ActiveModel = before.clone().into();
        am.reset_all().insert(&db).await.unwrap();

        // Two users read the open notice, then both mark it.
        let first = marked(&before, "a@b.c", 100, 7);
        let second = marked(&before, "x@y.z", 101, 9);
        assert!(
            mark_notice_false_alarm_on(&db, &before, &first)
                .await
                .unwrap()
        );
        assert!(
            !mark_notice_false_alarm_on(&db, &before, &second)
                .await
                .unwrap(),
            "the second mark must read again, not overwrite the first"
        );

        let n = status_page_notices::Entity::find_by_id("n1")
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(n.false_alarm_by.as_deref(), Some("a@b.c"));
        assert_eq!(
            n.false_alarm_recovered_at,
            Some(7),
            "one stamp, from the first mark"
        );
        assert_eq!((n.state, n.resolved_at), (2, Some(100)));
    }

    #[tokio::test]
    async fn of_two_marks_on_a_resolved_notice_only_the_first_writes() {
        let db = notices_db().await;
        // Resolved already, so a mark keeps state and resolved_at and only the empty-mark
        // guard stops the second one.
        let before = status_page_notices::Model {
            state: 2,
            resolved_at: Some(50),
            ..open_notice()
        };
        let am: status_page_notices::ActiveModel = before.clone().into();
        am.reset_all().insert(&db).await.unwrap();

        let keep = |m: status_page_notices::Model| status_page_notices::Model {
            resolved_at: Some(50),
            ..m
        };
        let first = keep(marked(&before, "a@b.c", 100, 7));
        let second = keep(marked(&before, "x@y.z", 101, 9));
        assert!(
            mark_notice_false_alarm_on(&db, &before, &first)
                .await
                .unwrap()
        );
        assert!(
            !mark_notice_false_alarm_on(&db, &before, &second)
                .await
                .unwrap(),
            "the second mark must not overwrite the first"
        );
        let n = status_page_notices::Entity::find_by_id("n1")
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(n.false_alarm_by.as_deref(), Some("a@b.c"));
        assert_eq!(n.false_alarm_at, Some(100));
        assert_eq!(n.false_alarm_recovered_at, Some(7));
        assert_eq!((n.state, n.resolved_at), (2, Some(50)));
    }

    #[tokio::test]
    async fn a_mark_from_a_read_before_a_tick_resolved_the_notice_does_not_write() {
        let db = notices_db().await;
        let before = open_notice();
        let am: status_page_notices::ActiveModel = before.clone().into();
        am.reset_all().insert(&db).await.unwrap();

        // The rebuilder resolves the notice after the user read it.
        update_notice_runtime(&db, "n1", 2, Some(90), "[]", 0, 90)
            .await
            .unwrap();
        assert!(
            !mark_notice_false_alarm_on(&db, &before, &marked(&before, "a@b.c", 100, 7))
                .await
                .unwrap()
        );
        let n = status_page_notices::Entity::find_by_id("n1")
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(n.false_alarm_at, None);
        assert_eq!(
            n.false_alarm_recovered_at, None,
            "no hold armed from a stale read"
        );
    }

    const HOST: &str = "status.example.com";
    const T0: i64 = 1_000_000_000_000;
    const DAY: i64 = 24 * 3_600 * 1_000_000;

    /// Two orgs, each with a page, and the claim table as the real migrations leave it.
    async fn claims_db() -> DatabaseConnection {
        super::super::status_page_domains::force_certs_for_tests(true);
        let db = snapshot_db().await;
        let backend = db.get_database_backend();
        let components =
            Schema::new(backend).create_table_from_entity(status_page_components::Entity);
        db.execute(backend.build(&components)).await.unwrap();
        create_domains_table_for_tests(&db).await.unwrap();
        insert_org_page(&db, "org-a", "pa").await;
        insert_org_page(&db, "org-a", "pa2").await;
        insert_org_page(&db, "org-b", "pb").await;
        db
    }

    #[tokio::test]
    async fn with_built_in_tls_off_no_certificate_query_runs_on_release_or_org_deletion() {
        let db = org_deletion_db().await;
        super::super::status_page_domains::force_certs_for_tests(false);
        add(&db, "a", "org-a", "pa", HOST).await;
        grant_domain(&db, "a", T0).await.unwrap();
        add_cert(&db, HOST, Some(("a", "org-a"))).await;

        let released = release_domain(&db, "org-a", "a", T0 + 1, RELEASED_BY_ORG)
            .await
            .unwrap();
        let hostnames = delete_by_org_in(&db, "org-a").await.unwrap();

        assert_eq!(released, Some(Some(HOST.to_string())));
        assert!(hostnames.is_empty());
        assert_eq!(cert_hosts(&db).await, [HOST.to_string()]);
    }

    fn claim(id: &str, org_id: &str, page_id: &str, domain: &str) -> claims::Model {
        claims::Model {
            id: id.to_string(),
            org_id: org_id.to_string(),
            status_page_id: page_id.to_string(),
            domain: domain.to_string(),
            verification_token: format!("o2v_{id}"),
            cname_label: Some(new_cname_label()),
            created_at: T0,
            updated_at: T0,
            expires_at: Some(T0 + CLAIM_TTL_MICROS),
            ..Default::default()
        }
    }

    async fn add_cert(db: &DatabaseConnection, hostname: &str, claim: Option<(&str, &str)>) {
        status_page_domain_certs::Model {
            hostname: hostname.to_string(),
            claim_id: claim.map(|(id, _)| id.to_string()),
            org_id: claim.map(|(_, org)| org.to_string()),
            ca_directory: String::new(),
            cert_chain: "chain".to_string(),
            private_key: "sealed".to_string(),
            fingerprint: format!("fp-{hostname}"),
            previous_fingerprint: None,
            not_before: T0,
            not_after: T0 + 30 * DAY,
            renew_at: None,
            source: "imported".to_string(),
            created_at: T0,
            updated_at: T0,
        }
        .into_active_model()
        .insert(db)
        .await
        .unwrap();
    }

    async fn cert_hosts(db: &DatabaseConnection) -> Vec<String> {
        let mut hosts: Vec<String> = status_page_domain_certs::Entity::find()
            .select_only()
            .column(status_page_domain_certs::Column::Hostname)
            .into_tuple()
            .all(db)
            .await
            .unwrap();
        hosts.sort();
        hosts
    }

    async fn org_deletion_db() -> DatabaseConnection {
        let db = claims_db().await;
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for table in [
            schema.create_table_from_entity(status_page_audit_log::Entity),
            schema.create_table_from_entity(status_page_check_snoozes::Entity),
            schema.create_table_from_entity(status_page_notice_components::Entity),
            schema.create_table_from_entity(status_page_notice_updates::Entity),
            schema.create_table_from_entity(status_page_notices::Entity),
        ] {
            db.execute(backend.build(&table)).await.unwrap();
        }
        db
    }

    #[test]
    fn a_new_label_is_sixteen_characters_of_a_to_z_and_2_to_7_and_never_repeats() {
        let labels: HashSet<String> = (0..500).map(|_| new_cname_label()).collect();

        assert_eq!(labels.len(), 500);
        for label in &labels {
            assert_eq!(label.len(), 16, "{label}");
            assert!(
                label
                    .bytes()
                    .all(|b| matches!(b, b'a'..=b'z' | b'2'..=b'7')),
                "{label}"
            );
        }
    }

    #[tokio::test]
    async fn a_claim_without_a_label_is_refused_and_writes_nothing() {
        let db = claims_db().await;
        let unlabeled = claims::Model {
            cname_label: None,
            ..claim("a", "org-a", "pa", HOST)
        };

        let inserted = insert_domain_claim(&db, &unlabeled, true, 20).await;

        assert!(inserted.is_err());
        let written = claims::Entity::find_by_id("a").one(&db).await.unwrap();
        assert!(written.is_none());
    }

    #[tokio::test]
    async fn release_keeps_the_label_and_no_claim_can_take_it_afterwards() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        let label = row(&db, "a")
            .await
            .cname_label
            .expect("a claim has a label");
        grant_domain(&db, "a", T0).await.unwrap();

        release_domain(&db, "org-a", "a", T0 + 1, RELEASED_BY_ORG)
            .await
            .unwrap();

        assert_eq!(row(&db, "a").await.cname_label, Some(label.clone()));
        let reuse = claims::Model {
            cname_label: Some(label),
            ..claim("b", "org-b", "pb", HOST)
        };
        assert!(insert_domain_claim(&db, &reuse, true, 20).await.is_err());
    }

    #[tokio::test]
    async fn repair_fills_a_missing_label_and_changes_no_existing_one() {
        let db = claims_db().await;
        add(&db, "labeled", "org-a", "pa", HOST).await;
        let kept = row(&db, "labeled").await.cname_label;
        for (id, host) in [("old", "old.example.com"), ("old2", "old2.example.com")] {
            let unlabeled = claims::Model {
                cname_label: None,
                ..claim(id, "org-a", "pa", host)
            };
            let inserted = claims::Entity::insert(unlabeled.into_active_model())
                .exec(&db)
                .await;
            inserted.unwrap();
        }
        let gone = claims::Model {
            cname_label: None,
            ..claim("gone", "org-b", "pb", "gone.example.com")
        };
        claims::Entity::insert(gone.into_active_model())
            .exec(&db)
            .await
            .unwrap();
        release_domain(&db, "org-b", "gone", T0, RELEASED_BY_ORG)
            .await
            .unwrap();

        repair_claims(&db, T0 + 1).await.unwrap();
        let first = row(&db, "old").await.cname_label;
        repair_claims_settling_duplicates(&db, T0 + 2)
            .await
            .unwrap();

        let first = first.expect("repair gave the claim a label");
        assert_eq!(first.len(), 16);
        assert!(
            first
                .bytes()
                .all(|b| matches!(b, b'a'..=b'z' | b'2'..=b'7'))
        );
        assert_eq!(row(&db, "old").await.cname_label, Some(first.clone()));
        let second = row(&db, "old2").await.cname_label.expect("filled too");
        assert_ne!(second, first);
        assert_eq!(row(&db, "labeled").await.cname_label, kept);
        assert_eq!(
            row(&db, "gone").await.cname_label,
            None,
            "released rows stay as they were"
        );
    }

    #[tokio::test]
    async fn release_deletes_the_holders_certificate_row_with_the_claim_in_one_transaction() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        add(&db, "other", "org-b", "pb", "other.example.com").await;
        grant_domain(&db, "a", T0).await.unwrap();
        grant_domain(&db, "other", T0).await.unwrap();
        add_cert(&db, HOST, Some(("a", "org-a"))).await;
        add_cert(&db, "other.example.com", Some(("other", "org-b"))).await;
        add_cert(&db, "domains.example.com", None).await;

        let txn = db.begin().await.unwrap();
        let named = release_domain_in(&txn, "org-a", "a", T0 + 1, RELEASED_BY_ORG)
            .await
            .unwrap();
        txn.rollback().await.unwrap();

        assert_eq!(named.as_deref(), Some(HOST));
        assert_eq!(
            cert_hosts(&db).await.len(),
            3,
            "a rolled back release deletes nothing"
        );
        assert_eq!(holder_of(&db, HOST).await.as_deref(), Some("a"));
        let released = release_domain(&db, "org-a", "a", T0 + 2, RELEASED_BY_ORG)
            .await
            .unwrap();
        assert_eq!(released, Some(Some(HOST.to_string())));
        assert_eq!(
            cert_hosts(&db).await,
            ["domains.example.com", "other.example.com"].map(String::from)
        );
    }

    #[tokio::test]
    async fn page_deletion_deletes_the_certificates_of_its_holders_and_returns_their_hostnames() {
        let db = claims_db().await;
        add(&db, "held", "org-a", "pa", HOST).await;
        add(&db, "pending", "org-a", "pa", "pending.example.com").await;
        add(&db, "elsewhere", "org-a", "pa2", "elsewhere.example.com").await;
        grant_domain(&db, "held", T0).await.unwrap();
        grant_domain(&db, "elsewhere", T0).await.unwrap();
        add_cert(&db, HOST, Some(("held", "org-a"))).await;
        add_cert(&db, "elsewhere.example.com", Some(("elsewhere", "org-a"))).await;

        let deleted = delete_page(&db, "org-a", "pa").await.unwrap();

        assert_eq!(
            deleted,
            PageDeleted {
                existed: true,
                hostnames: vec![HOST.to_string()]
            }
        );
        assert_eq!(cert_hosts(&db).await, ["elsewhere.example.com".to_string()]);
    }

    #[tokio::test]
    async fn org_deletion_deletes_the_orgs_certificate_rows_and_returns_their_hostnames() {
        let db = org_deletion_db().await;
        add(&db, "a1", "org-a", "pa", HOST).await;
        add(&db, "a2", "org-a", "pa2", "second.example.com").await;
        add(&db, "b", "org-b", "pb", "other.example.com").await;
        add_cert(&db, HOST, Some(("a1", "org-a"))).await;
        add_cert(&db, "second.example.com", Some(("a2", "org-a"))).await;
        add_cert(&db, "other.example.com", Some(("b", "org-b"))).await;
        add_cert(&db, "domains.example.com", None).await;

        let mut hostnames = delete_by_org_in(&db, "org-a").await.unwrap();

        hostnames.sort();
        assert_eq!(hostnames, ["second.example.com", HOST].map(String::from));
        assert_eq!(
            cert_hosts(&db).await,
            ["domains.example.com", "other.example.com"].map(String::from)
        );
        assert!(
            claims::Entity::find_by_id("a1")
                .one(&db)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            claims::Entity::find_by_id("b")
                .one(&db)
                .await
                .unwrap()
                .is_some()
        );
    }

    async fn add(db: &DatabaseConnection, id: &str, org_id: &str, page_id: &str, domain: &str) {
        let inserted = insert_domain_claim(db, &claim(id, org_id, page_id, domain), true, 20).await;
        assert_eq!(inserted.unwrap(), ClaimInsert::Created, "claim {id}");
    }

    async fn row(db: &DatabaseConnection, id: &str) -> claims::Model {
        claims::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    async fn holder_of(db: &DatabaseConnection, domain: &str) -> Option<String> {
        get_domain_claim_by_host(db, domain)
            .await
            .unwrap()
            .map(|c| c.id)
    }

    async fn due_ids(db: &DatabaseConnection, now: i64) -> Vec<String> {
        let mut ids: Vec<String> = list_domains_due_for_check(db, now, 100)
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.id)
            .collect();
        ids.sort();
        ids
    }

    #[tokio::test]
    async fn two_verifications_at_once_give_one_holder() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        add(&db, "b", "org-b", "pb", HOST).await;

        let (a, b) = tokio::join!(grant_domain(&db, "a", T0), grant_domain(&db, "b", T0));

        let granted = [a.unwrap(), b.unwrap()];
        assert_eq!(granted.iter().filter(|g| **g).count(), 1, "{granted:?}");
        let holders = claims::Entity::find()
            .filter(claims::Column::HeldDomain.eq(HOST))
            .all(&db)
            .await
            .unwrap();
        assert_eq!(holders.len(), 1);
        assert_eq!(holder_of(&db, HOST).await, Some(holders[0].id.clone()));
        let loser = if holders[0].id == "a" { "b" } else { "a" };
        assert_eq!(
            row(&db, loser).await.verification_state,
            VERIFICATION_PENDING
        );
    }

    #[tokio::test]
    async fn a_pending_claim_of_one_org_does_not_stop_another() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;

        add(&db, "b", "org-b", "pb", HOST).await;

        assert!(grant_domain(&db, "b", T0).await.unwrap());
        assert_eq!(holder_of(&db, HOST).await.as_deref(), Some("b"));
        assert_eq!(row(&db, "a").await.held_domain, None);
    }

    #[tokio::test]
    async fn a_second_claim_is_refused_while_the_caller_says_it_may_not_be_allowed() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;

        let second = insert_domain_claim(&db, &claim("b", "org-b", "pb", HOST), false, 20).await;

        assert_eq!(second.unwrap(), ClaimInsert::HostnameTaken);
        assert!(
            claims::Entity::find_by_id("b")
                .one(&db)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn an_org_never_has_two_claims_for_one_hostname() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;

        let again = insert_domain_claim(&db, &claim("a2", "org-a", "pa2", HOST), true, 20).await;

        assert_eq!(again.unwrap(), ClaimInsert::HostnameTaken);
    }

    #[tokio::test]
    async fn the_org_cap_counts_unreleased_claims_only() {
        let db = claims_db().await;
        add(&db, "a1", "org-a", "pa", "one.example.com").await;
        add(&db, "a2", "org-a", "pa", "two.example.com").await;
        let third = claim("a3", "org-a", "pa", "three.example.com");
        assert_eq!(
            insert_domain_claim(&db, &third, true, 2).await.unwrap(),
            ClaimInsert::CapReached
        );

        release_domain(&db, "org-a", "a1", T0, RELEASED_BY_ORG)
            .await
            .unwrap();

        assert_eq!(
            insert_domain_claim(&db, &third, true, 2).await.unwrap(),
            ClaimInsert::Created
        );
    }

    #[tokio::test]
    async fn a_claim_for_a_page_that_is_not_the_orgs_is_refused() {
        let db = claims_db().await;
        for (org, page) in [("org-a", "pb"), ("org-a", "no-such-page"), ("org-c", "pa")] {
            let refused = insert_domain_claim(&db, &claim("x", org, page, HOST), true, 20).await;
            assert_eq!(refused.unwrap(), ClaimInsert::PageGone, "{org} {page}");
        }
        assert!(claims::Entity::find().all(&db).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn get_domain_claim_by_host_returns_only_the_holder() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        assert_eq!(
            holder_of(&db, HOST).await,
            None,
            "a pending claim holds nothing"
        );

        grant_domain(&db, "a", T0).await.unwrap();

        assert_eq!(holder_of(&db, HOST).await.as_deref(), Some("a"));
    }

    #[tokio::test]
    async fn displacement_lapses_the_holder_and_grants_the_claimant_together() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        add(&db, "b", "org-b", "pb", HOST).await;
        grant_domain(&db, "a", T0).await.unwrap();
        record_holder_proof_failure(&db, "a", T0 + 5).await.unwrap();

        let displaced = displace_holder(&db, "a", "b", HOST, Some(T0), T0 + 9).await;
        assert!(displaced.unwrap());

        let lapsed = row(&db, "a").await;
        assert_eq!(lapsed.verification_state, VERIFICATION_FAILED);
        assert_eq!(lapsed.verification_failure_reason, Some(FAILURE_PROOF_LOST));
        assert_eq!(lapsed.held_domain, None);
        assert_eq!(lapsed.expires_at, Some(T0 + 9 + CLAIM_TTL_MICROS));
        assert_eq!(
            lapsed.proof_failed_since,
            Some(T0 + 5),
            "the first failure time stays"
        );
        let granted = row(&db, "b").await;
        assert_eq!(granted.held_domain.as_deref(), Some(HOST));
        assert_eq!(granted.verification_state, VERIFIED);
        assert_eq!(granted.expires_at, None);
        assert_eq!(holder_of(&db, HOST).await.as_deref(), Some("b"));
    }

    #[tokio::test]
    async fn a_displacement_that_cannot_grant_leaves_the_holder_alone() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        add(&db, "b", "org-b", "pb", HOST).await;
        grant_domain(&db, "a", T0).await.unwrap();
        release_domain(&db, "org-b", "b", T0 + 1, RELEASED_BY_ORG)
            .await
            .unwrap();
        let before = row(&db, "a").await;

        let displaced = displace_holder(&db, "a", "b", HOST, Some(T0), T0 + 9).await;
        assert!(!displaced.unwrap());

        assert_eq!(row(&db, "a").await, before, "the lapse was rolled back");
        assert_eq!(holder_of(&db, HOST).await.as_deref(), Some("a"));
    }

    #[tokio::test]
    async fn a_displacement_names_the_holder_it_read() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        add(&db, "b", "org-b", "pb", HOST).await;
        add(&db, "c", "org-b", "pb", "other.example.com").await;
        grant_domain(&db, "a", T0).await.unwrap();

        let wrong_holder = displace_holder(&db, "c", "b", HOST, None, T0 + 9)
            .await
            .unwrap();
        let wrong_host = displace_holder(&db, "a", "b", "other.example.com", Some(T0), T0 + 9)
            .await
            .unwrap();

        assert!(!wrong_holder && !wrong_host);
        assert_eq!(holder_of(&db, HOST).await.as_deref(), Some("a"));
    }

    #[tokio::test]
    async fn release_sets_both_marks_and_clears_the_holder() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        grant_domain(&db, "a", T0).await.unwrap();

        assert!(
            release_domain(&db, "org-a", "a", T0 + 1, RELEASED_BY_ORG)
                .await
                .unwrap()
                .is_some()
        );

        let released = row(&db, "a").await;
        assert_eq!(released.released_at, Some(T0 + 1));
        assert_eq!(released.release_seal, Some(T0 + 1));
        assert_eq!(released.release_reason, Some(RELEASED_BY_ORG));
        assert_eq!(released.held_domain, None);
        assert_eq!(holder_of(&db, HOST).await, None);
        assert!(
            release_domain(&db, "org-a", "a", T0 + 2, RELEASED_BY_ORG)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn release_domain_in_names_the_hostname_only_for_a_holder_of_the_org() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        add(&db, "b", "org-b", "pb", HOST).await;
        grant_domain(&db, "a", T0).await.unwrap();

        let other_org = release_domain_in(&db, "org-b", "a", T0 + 1, RELEASED_BY_ORG).await;
        let pending = release_domain_in(&db, "org-b", "b", T0 + 1, RELEASED_BY_ORG).await;
        let holder = release_domain_in(&db, "org-a", "a", T0 + 1, RELEASED_BY_ORG).await;
        let again = release_domain_in(&db, "org-a", "a", T0 + 2, RELEASED_BY_ORG).await;

        assert_eq!(other_org.unwrap(), None);
        assert_eq!(
            pending.unwrap(),
            None,
            "a pending claim has no hostname to free"
        );
        assert_eq!(holder.unwrap().as_deref(), Some(HOST));
        assert_eq!(again.unwrap(), None);
        assert!(row(&db, "b").await.release_seal.is_some());
        assert_eq!(
            row(&db, "a").await.release_seal,
            Some(T0 + 1),
            "released once"
        );
    }

    #[tokio::test]
    async fn every_writer_is_a_no_op_on_a_released_row() {
        let db = claims_db().await;
        add(&db, "gone", "org-a", "pa", HOST).await;
        add(&db, "keeps", "org-b", "pb", "keeps.example.com").await;
        add(&db, "claimant", "org-b", "pb", "other.example.com").await;
        grant_domain(&db, "gone", T0).await.unwrap();
        release_domain(&db, "org-a", "gone", T0 + 1, RELEASED_BY_ORG)
            .await
            .unwrap();
        let before = row(&db, "gone").await;

        let writers = [
            grant_domain(&db, "gone", T0 + 2).await,
            fail_domain(&db, "gone", FAILURE_VALUE_MISMATCH, T0 + 2).await,
            record_holder_proof_failure(&db, "gone", T0 + 2).await,
            record_resolver_error(&db, "gone", T0 + 2).await,
            extend_claim_expiry(&db, "gone", T0 + 2).await,
            displace_holder(&db, "gone", "claimant", HOST, Some(T0), T0 + 2).await,
            displace_holder(&db, "keeps", "gone", HOST, None, T0 + 2).await,
        ];

        assert!(
            writers.iter().all(|w| matches!(w, Ok(false))),
            "{writers:?}"
        );
        assert_eq!(row(&db, "gone").await, before);
        assert_eq!(
            row(&db, "claimant").await.verification_state,
            VERIFICATION_PENDING
        );
        assert_eq!(
            release_domain_in(&db, "org-a", "gone", T0 + 3, RELEASED_BY_ORG)
                .await
                .unwrap(),
            None
        );
        assert_eq!(row(&db, "gone").await, before);
    }

    /// The previous release's `update_domain`: a whole-row write of the columns it knew.
    async fn old_update_domain(db: &DatabaseConnection, m: &claims::Model) {
        claims::ActiveModel {
            id: ActiveValue::Unchanged(m.id.clone()),
            org_id: Set(m.org_id.clone()),
            status_page_id: Set(m.status_page_id.clone()),
            domain: Set(m.domain.clone()),
            verification_token: Set(m.verification_token.clone()),
            verification_state: Set(m.verification_state),
            verification_failure_reason: Set(m.verification_failure_reason),
            verified_at: Set(m.verified_at),
            released_at: Set(m.released_at),
            last_checked_at: Set(m.last_checked_at),
            created_at: Set(m.created_at),
            updated_at: Set(m.updated_at),
            ..Default::default()
        }
        .update(db)
        .await
        .unwrap();
    }

    /// The previous release's `release_domain`: sets `released_at` and leaves everything else.
    async fn old_release_domain(db: &DatabaseConnection, org_id: &str, id: &str, at: i64) -> bool {
        let found = claims::Entity::find_by_id(id)
            .filter(claims::Column::OrgId.eq(org_id))
            .filter(claims::Column::ReleasedAt.is_null())
            .one(db)
            .await
            .unwrap();
        let Some(existing) = found else {
            return false;
        };
        let mut am = existing.into_active_model();
        am.released_at = Set(Some(at));
        am.verification_state = Set(VERIFICATION_PENDING);
        am.updated_at = Set(at);
        am.update(db).await.unwrap();
        true
    }

    /// The previous release's `get_domain_claim_by_host`: any unreleased claim for the hostname.
    async fn old_get_domain_claim_by_host(
        db: &DatabaseConnection,
        domain: &str,
    ) -> Option<claims::Model> {
        claims::Entity::find()
            .filter(claims::Column::Domain.eq(domain))
            .filter(claims::Column::ReleasedAt.is_null())
            .one(db)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn a_whole_row_write_of_the_previous_release_after_a_new_release_leaves_the_row_released()
    {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        let read_by_an_old_pod = row(&db, "a").await;
        release_domain(&db, "org-a", "a", T0 + 1, RELEASED_BY_ORG)
            .await
            .unwrap();

        old_update_domain(&db, &read_by_an_old_pod).await;

        let after = row(&db, "a").await;
        assert_eq!(
            after.released_at, None,
            "the old write undid the first mark"
        );
        assert_eq!(after.release_seal, Some(T0 + 1), "the second mark survived");
        assert_eq!(due_ids(&db, T0 + 2 * DAY).await, Vec::<String>::new());
        assert!(!grant_domain(&db, "a", T0 + 2).await.unwrap());
        assert!(
            list_domains_for_page(&db, "org-a", "pa", T0 + 2)
                .await
                .unwrap()
                .is_empty()
        );
        repair_claims(&db, T0 + 3).await.unwrap();
        assert_eq!(row(&db, "a").await.release_seal, Some(T0 + 1));
        assert_eq!(row(&db, "a").await.held_domain, None);
    }

    #[tokio::test]
    async fn a_release_by_the_previous_release_is_sealed_by_repair() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        add(&db, "b", "org-b", "pb", HOST).await;
        grant_domain(&db, "a", T0).await.unwrap();

        assert!(old_release_domain(&db, "org-a", "a", T0 + 1).await);

        assert_eq!(
            old_get_domain_claim_by_host(&db, HOST)
                .await
                .map(|c| c.id)
                .as_deref(),
            Some("b")
        );
        assert_eq!(holder_of(&db, HOST).await, None);
        assert!(
            !grant_domain(&db, "b", T0 + 2).await.unwrap(),
            "the old release left held_domain, which still holds the hostname"
        );
        repair_claims(&db, T0 + 3).await.unwrap();
        let sealed = row(&db, "a").await;
        assert_eq!(sealed.release_seal, Some(T0 + 1));
        assert_eq!(sealed.released_at, Some(T0 + 1));
        assert_eq!(sealed.release_reason, Some(RELEASED_BY_ORG));
        assert_eq!(sealed.held_domain, None);
        assert!(grant_domain(&db, "b", T0 + 4).await.unwrap());
    }

    #[tokio::test]
    async fn a_verification_by_the_previous_release_is_completed_by_repair() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        let mut verified = row(&db, "a").await;
        verified.verification_state = VERIFIED;
        verified.verified_at = Some(T0 + 1);

        old_update_domain(&db, &verified).await;

        assert_eq!(
            old_get_domain_claim_by_host(&db, HOST)
                .await
                .map(|c| c.id)
                .as_deref(),
            Some("a")
        );
        assert_eq!(
            holder_of(&db, HOST).await,
            None,
            "no holder until the repair"
        );
        repair_claims(&db, T0 + 2).await.unwrap();
        let holder = row(&db, "a").await;
        assert_eq!(holder.held_domain.as_deref(), Some(HOST));
        assert_eq!(holder.expires_at, None);
        assert_eq!(holder_of(&db, HOST).await.as_deref(), Some("a"));
    }

    #[tokio::test]
    async fn a_successful_verification_of_the_previous_release_after_a_new_release_is_lifted_by_repair()
     {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        let mut verified = row(&db, "a").await;
        verified.verification_state = VERIFIED;
        release_domain(&db, "org-a", "a", T0 + 1, RELEASED_BY_ORG)
            .await
            .unwrap();

        old_update_domain(&db, &verified).await;

        let legacy = old_get_domain_claim_by_host(&db, HOST).await;
        assert!(
            legacy.is_some(),
            "until repair an old router sees the claim"
        );
        repair_claims(&db, T0 + 2).await.unwrap();
        assert!(old_get_domain_claim_by_host(&db, HOST).await.is_none());
        let after = row(&db, "a").await;
        assert_eq!(after.released_at, Some(T0 + 1));
        assert_eq!(after.verification_state, VERIFICATION_PENDING);
        assert_eq!(holder_of(&db, HOST).await, None);
    }

    #[tokio::test]
    async fn repair_leaves_a_claim_whose_proof_failed_since_it_was_read() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        let mut verified = row(&db, "a").await;
        verified.verification_state = VERIFIED;
        old_update_domain(&db, &verified).await;
        fail_domain(&db, "a", FAILURE_RECORD_MISSING, T0 + 1)
            .await
            .unwrap();

        repair_claims(&db, T0 + 2).await.unwrap();

        let after = row(&db, "a").await;
        assert_eq!(after.held_domain, None);
        assert_eq!(after.verification_state, VERIFICATION_FAILED);
        assert_eq!(
            after.verification_failure_reason,
            Some(FAILURE_RECORD_MISSING)
        );
    }

    #[tokio::test]
    async fn an_old_verification_of_a_hostname_another_claim_holds_becomes_held_by_another() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        add(&db, "b", "org-b", "pb", HOST).await;
        grant_domain(&db, "a", T0).await.unwrap();
        let mut verified = row(&db, "b").await;
        verified.verification_state = VERIFIED;
        old_update_domain(&db, &verified).await;

        repair_claims(&db, T0 + 2).await.unwrap();

        let loser = row(&db, "b").await;
        assert_eq!(loser.held_domain, None);
        assert_eq!(loser.verification_state, VERIFICATION_FAILED);
        assert_eq!(
            loser.verification_failure_reason,
            Some(FAILURE_HELD_BY_ANOTHER_ORG)
        );
        assert_eq!(holder_of(&db, HOST).await.as_deref(), Some("a"));
    }

    #[tokio::test]
    async fn repair_gives_a_claim_an_older_release_inserted_an_expiry_and_leaves_holders_alone() {
        let db = claims_db().await;
        let mut from_an_old_pod = claim("old", "org-a", "pa", HOST);
        from_an_old_pod.expires_at = None;
        claims::Entity::insert(from_an_old_pod.into_active_model())
            .exec(&db)
            .await
            .unwrap();
        add(&db, "holder", "org-b", "pb", "held.example.com").await;
        grant_domain(&db, "holder", T0).await.unwrap();

        repair_claims(&db, T0 + 5).await.unwrap();
        repair_claims(&db, T0 + 9).await.unwrap();

        assert_eq!(
            row(&db, "old").await.expires_at,
            Some(T0 + 5 + CLAIM_TTL_MICROS)
        );
        assert_eq!(row(&db, "holder").await.expires_at, None);
    }

    #[tokio::test]
    async fn page_deletion_releases_its_claims_in_the_same_transaction() {
        let db = claims_db().await;
        add(&db, "held", "org-a", "pa", HOST).await;
        add(&db, "pending", "org-a", "pa", "pending.example.com").await;
        add(&db, "elsewhere", "org-a", "pa2", "elsewhere.example.com").await;
        grant_domain(&db, "held", T0).await.unwrap();

        assert!(delete_page(&db, "org-a", "pa").await.unwrap().existed);

        for id in ["held", "pending"] {
            let released = row(&db, id).await;
            assert!(
                released.released_at.is_some() && released.release_seal.is_some(),
                "{id}"
            );
            assert_eq!(released.release_reason, Some(RELEASED_PAGE_DELETED), "{id}");
            assert_eq!(released.held_domain, None, "{id}");
        }
        assert!(row(&db, "elsewhere").await.release_seal.is_none());
        let page = get_page_by_id_in(&db, "org-a", "pa").await.unwrap();
        assert!(page.is_none());
        add(&db, "next", "org-b", "pb", HOST).await;
        assert!(
            grant_domain(&db, "next", T0 + 1).await.unwrap(),
            "the hostname is free again"
        );
    }

    #[tokio::test]
    async fn expired_claims_are_listed_for_thirty_days_only() {
        let db = claims_db().await;
        add(&db, "idle", "org-a", "pa", "idle.example.com").await;
        add(&db, "by-org", "org-a", "pa", "byorg.example.com").await;
        add(&db, "live", "org-a", "pa", "live.example.com").await;
        grant_domain(&db, "live", T0).await.unwrap();
        release_domain(&db, "org-a", "by-org", T0, RELEASED_BY_ORG)
            .await
            .unwrap();
        let expiry = T0 + CLAIM_TTL_MICROS;
        assert_eq!(release_expired_claims(&db, expiry).await.unwrap(), 1);
        let ids = |rows: Vec<claims::Model>| rows.into_iter().map(|c| c.id).collect::<Vec<_>>();

        let soon = list_domains_for_page(&db, "org-a", "pa", expiry + 29 * DAY)
            .await
            .unwrap();
        let later = list_domains_for_page(&db, "org-a", "pa", expiry + 31 * DAY)
            .await
            .unwrap();

        assert_eq!(ids(soon), ["idle", "live"].map(String::from));
        assert_eq!(ids(later), ["live".to_string()]);
        let expired = row(&db, "idle").await;
        assert_eq!(expired.release_reason, Some(RELEASED_EXPIRED));
        assert_eq!(expired.release_seal, Some(expiry));
    }

    #[tokio::test]
    async fn only_a_non_holder_past_its_expiry_is_released_by_expiry() {
        let db = claims_db().await;
        add(&db, "idle", "org-a", "pa", "idle.example.com").await;
        add(&db, "holder", "org-a", "pa", HOST).await;
        add(&db, "fresh", "org-b", "pb", "fresh.example.com").await;
        grant_domain(&db, "holder", T0).await.unwrap();
        extend_claim_expiry(&db, "fresh", T0 + DAY).await.unwrap();

        let released = release_expired_claims(&db, T0 + CLAIM_TTL_MICROS)
            .await
            .unwrap();

        assert_eq!(released, 1);
        assert!(row(&db, "idle").await.release_seal.is_some());
        assert!(row(&db, "holder").await.release_seal.is_none());
        assert!(row(&db, "fresh").await.release_seal.is_none());
    }

    #[tokio::test]
    async fn verify_now_extends_a_non_holder_and_never_a_holder() {
        let db = claims_db().await;
        add(&db, "idle", "org-a", "pa", "idle.example.com").await;
        add(&db, "holder", "org-a", "pa", HOST).await;
        grant_domain(&db, "holder", T0).await.unwrap();

        assert!(
            extend_claim_expiry(&db, "idle", T0 + 3 * DAY)
                .await
                .unwrap()
        );
        assert!(
            !extend_claim_expiry(&db, "holder", T0 + 3 * DAY)
                .await
                .unwrap()
        );

        assert_eq!(
            row(&db, "idle").await.expires_at,
            Some(T0 + 3 * DAY + CLAIM_TTL_MICROS)
        );
        assert_eq!(row(&db, "holder").await.expires_at, None);
    }

    #[tokio::test]
    async fn no_check_outcome_but_the_manual_one_extends_the_expiry() {
        let db = claims_db().await;
        add(&db, "idle", "org-a", "pa", "idle.example.com").await;
        let before = row(&db, "idle").await.expires_at;

        fail_domain(&db, "idle", FAILURE_RECORD_MISSING, T0 + DAY)
            .await
            .unwrap();
        record_resolver_error(&db, "idle", T0 + 2 * DAY)
            .await
            .unwrap();

        assert_eq!(row(&db, "idle").await.expires_at, before);
    }

    #[tokio::test]
    async fn the_due_list_follows_the_holder_state() {
        let db = claims_db().await;
        let now = T0 + 10 * HOLDER_RECHECK_MICROS;
        let hour = HOLDER_RECHECK_MICROS / 6;
        let insert = |id: &str,
                      domain: &str,
                      held: bool,
                      state: i32,
                      checked: Option<i64>,
                      released: Option<i64>| {
            let mut c = claim(id, "org-a", "pa", domain);
            c.held_domain = held.then(|| domain.to_string());
            c.verification_state = state;
            c.last_checked_at = checked;
            c.release_seal = released;
            c.released_at = released;
            claims::Entity::insert(c.into_active_model()).exec(&db)
        };
        insert("pending-never", "a.example.com", false, 0, None, None)
            .await
            .unwrap();
        insert(
            "pending-this-tick",
            "b.example.com",
            false,
            0,
            Some(now),
            None,
        )
        .await
        .unwrap();
        insert(
            "pending-last-tick",
            "c.example.com",
            false,
            2,
            Some(now - 1),
            None,
        )
        .await
        .unwrap();
        insert(
            "holder-an-hour-ago",
            "d.example.com",
            true,
            1,
            Some(now - hour),
            None,
        )
        .await
        .unwrap();
        insert(
            "holder-6h-ago",
            "e.example.com",
            true,
            1,
            Some(now - HOLDER_RECHECK_MICROS - 1),
            None,
        )
        .await
        .unwrap();
        insert(
            "old-verification",
            "f.example.com",
            false,
            1,
            Some(now),
            None,
        )
        .await
        .unwrap();
        insert("released", "g.example.com", false, 0, None, Some(T0))
            .await
            .unwrap();

        let due = due_ids(&db, now).await;

        assert_eq!(
            due,
            ["holder-6h-ago", "pending-last-tick", "pending-never"].map(String::from)
        );
        let later = due_ids(&db, now + 1).await;
        assert!(
            later.contains(&"pending-this-tick".to_string()),
            "non-holders are due on every tick"
        );
        assert!(
            later.contains(&"old-verification".to_string()),
            "so is a claim awaiting repair"
        );
        assert!(
            !later.contains(&"released".to_string()),
            "a released claim is never due"
        );
    }

    #[tokio::test]
    async fn a_holders_negative_answer_records_the_first_failure_once_and_lapses_nothing() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        grant_domain(&db, "a", T0).await.unwrap();

        record_holder_proof_failure(&db, "a", T0 + 10)
            .await
            .unwrap();
        record_holder_proof_failure(&db, "a", T0 + 20)
            .await
            .unwrap();

        let holder = row(&db, "a").await;
        assert_eq!(holder.proof_failed_since, Some(T0 + 10));
        assert_eq!(holder.last_checked_at, Some(T0 + 20));
        assert_eq!(
            (holder.verification_state, holder.held_domain.as_deref()),
            (VERIFIED, Some(HOST))
        );
        assert!(
            grant_domain(&db, "a", T0 + 30).await.unwrap(),
            "the proof is found again"
        );
        assert_eq!(row(&db, "a").await.proof_failed_since, None);
    }

    #[tokio::test]
    async fn a_resolver_error_changes_only_the_check_time() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        grant_domain(&db, "a", T0).await.unwrap();
        let before = row(&db, "a").await;

        record_resolver_error(&db, "a", T0 + 7).await.unwrap();

        let after = row(&db, "a").await;
        assert_eq!(
            after,
            claims::Model {
                last_checked_at: Some(T0 + 7),
                updated_at: T0 + 7,
                ..before
            }
        );
    }

    #[tokio::test]
    async fn a_failed_check_fails_a_non_holder_and_never_a_holder() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        add(&db, "b", "org-b", "pb", HOST).await;
        grant_domain(&db, "a", T0).await.unwrap();

        assert!(
            fail_domain(&db, "b", FAILURE_HELD_BY_ANOTHER_ORG, T0 + 1)
                .await
                .unwrap()
        );
        assert!(
            !fail_domain(&db, "a", FAILURE_RECORD_MISSING, T0 + 1)
                .await
                .unwrap()
        );

        let failed = row(&db, "b").await;
        assert_eq!(failed.verification_state, VERIFICATION_FAILED);
        assert_eq!(
            failed.verification_failure_reason,
            Some(FAILURE_HELD_BY_ANOTHER_ORG)
        );
        assert_eq!(failed.last_checked_at, Some(T0 + 1));
        assert_eq!(row(&db, "a").await.verification_state, VERIFIED);
    }

    #[tokio::test]
    async fn release_shadowed_frees_only_the_non_holders_of_a_held_hostname() {
        let db = claims_db().await;
        add(&db, "holder", "org-a", "pa", HOST).await;
        add(&db, "shadowed", "org-b", "pb", HOST).await;
        add(&db, "alone", "org-b", "pb", "alone.example.com").await;
        grant_domain(&db, "holder", T0).await.unwrap();

        assert_eq!(release_shadowed_claims(&db, T0 + 1).await.unwrap(), 1);

        assert_eq!(
            row(&db, "shadowed").await.release_reason,
            Some(RELEASED_EXPIRED)
        );
        assert!(row(&db, "shadowed").await.release_seal.is_some());
        assert!(row(&db, "holder").await.release_seal.is_none());
        assert!(row(&db, "alone").await.release_seal.is_none());
        assert_eq!(release_shadowed_claims(&db, T0 + 2).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn a_stale_repair_snapshot_does_not_overwrite_a_newer_grant() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        let mut verified = row(&db, "a").await;
        verified.verification_state = VERIFIED;
        old_update_domain(&db, &verified).await;
        let snapshot = row(&db, "a").await;
        grant_domain(&db, "a", T0 + 5).await.unwrap();
        record_holder_proof_failure(&db, "a", T0 + 6).await.unwrap();
        let before = row(&db, "a").await;

        complete_claims(&db, &[snapshot], T0 + 9).await.unwrap();

        assert_eq!(
            row(&db, "a").await,
            before,
            "the newer check keeps its result"
        );
    }

    #[tokio::test]
    async fn a_displacement_names_the_holder_generation_it_saw() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        add(&db, "b", "org-b", "pb", HOST).await;
        let third = claim("c", "org-b", "pb", HOST);
        claims::Entity::insert(third.into_active_model())
            .exec(&db)
            .await
            .unwrap();
        grant_domain(&db, "a", T0).await.unwrap();
        let seen = row(&db, "a").await.verified_at;
        // Every grant below happens at the same microsecond.
        displace_holder(&db, "a", "c", HOST, seen, T0)
            .await
            .unwrap();
        let at_c = row(&db, "c").await.verified_at;
        displace_holder(&db, "c", "a", HOST, at_c, T0)
            .await
            .unwrap();

        let stale = displace_holder(&db, "a", "b", HOST, seen, T0).await;

        assert!(!stale.unwrap());
        assert_eq!(holder_of(&db, HOST).await.as_deref(), Some("a"));
        assert_ne!(row(&db, "a").await.verified_at, seen);
    }

    #[tokio::test]
    async fn every_grant_moves_verified_at_strictly_forward() {
        let db = claims_db().await;
        add(&db, "a", "org-a", "pa", HOST).await;
        let mut seen = Vec::new();

        for now in [T0, T0, T0 - 5, T0 + 9] {
            grant_domain(&db, "a", now).await.unwrap();
            seen.push(row(&db, "a").await.verified_at.unwrap());
        }

        assert_eq!(seen, [T0, T0 + 1, T0 + 2, T0 + 9]);
    }

    /// A PostgreSQL schema of its own from `ZO_TEST_POSTGRES_DSN`, so no test shares a migration
    /// or rows with another; the test is skipped when the variable is unset.
    struct Pg {
        db: DatabaseConnection,
        admin: DatabaseConnection,
        schema: String,
    }

    impl Pg {
        /// Waits until some session is blocked by the transaction of backend `pid`.
        async fn wait_until_blocked_by(&self, pid: i64) {
            let blocked = Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "SELECT count(*)::bigint AS n FROM pg_stat_activity \
                 WHERE $1 = ANY(pg_blocking_pids(pid))",
                [pid.into()],
            );
            for _ in 0..100 {
                let row = self
                    .admin
                    .query_one(blocked.clone())
                    .await
                    .unwrap()
                    .unwrap();
                if row.try_get::<i64>("", "n").unwrap() > 0 {
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            panic!("no session became blocked by backend {pid}");
        }

        async fn drop_schema(&self) {
            let drop = format!("DROP SCHEMA {} CASCADE", self.schema);
            self.admin.execute_unprepared(&drop).await.unwrap();
        }
    }

    async fn backend_pid<C: ConnectionTrait>(conn: &C) -> i64 {
        let pid = Statement::from_string(
            DatabaseBackend::Postgres,
            "SELECT pg_backend_pid()::bigint AS pid",
        );
        let row = conn.query_one(pid).await.unwrap().unwrap();
        row.try_get("", "pid").unwrap()
    }

    async fn postgres() -> Option<Pg> {
        let dsn = std::env::var("ZO_TEST_POSTGRES_DSN").ok()?;
        let admin = Database::connect(ConnectOptions::new(dsn.clone()))
            .await
            .unwrap();
        let schema = format!("pgtest_{}", config::ider::generate().to_lowercase());
        admin
            .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
            .await
            .unwrap();
        let mut opts = ConnectOptions::new(dsn);
        opts.max_connections(8)
            .set_schema_search_path(schema.clone());
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        let pages = Schema::new(backend).create_table_from_entity(status_pages::Entity);
        db.execute(backend.build(&pages)).await.unwrap();
        create_domains_table_for_tests(&db).await.unwrap();
        Some(Pg { db, admin, schema })
    }

    #[tokio::test]
    async fn postgres_a_create_waits_for_the_hostname_lock_and_then_sees_the_other_claim() {
        let Some(pg) = postgres().await else {
            return;
        };
        let (org_a, org_b) = (config::ider::generate(), config::ider::generate());
        let (page_a, page_b) = (config::ider::generate(), config::ider::generate());
        insert_org_page(&pg.db, &org_a, &page_a).await;
        insert_org_page(&pg.db, &org_b, &page_b).await;
        let host = format!("{}.pg.example.com", config::ider::generate());
        let first = claim(&config::ider::generate(), &org_a, &page_a, &host);
        let second = claim(&config::ider::generate(), &org_b, &page_b, &host);
        // The first create holds the hostname lock and has not inserted yet.
        let txn = pg.db.begin().await.unwrap();
        lock_hostname(&txn, &host).await.unwrap();

        let pid = backend_pid(&txn).await;

        let competing = insert_domain_claim(&pg.db, &second, false, 20);
        tokio::pin!(competing);
        tokio::select! {
            done = &mut competing => panic!("the create finished while the lock was held: {done:?}"),
            () = pg.wait_until_blocked_by(pid) => {}
        }
        claims::Entity::insert(first.into_active_model())
            .exec(&txn)
            .await
            .unwrap();
        txn.commit().await.unwrap();
        assert_eq!(competing.await.unwrap(), ClaimInsert::HostnameTaken);
        pg.drop_schema().await;
    }

    #[tokio::test]
    async fn postgres_org_cleanup_waits_for_a_claim_being_created_and_removes_its_certificate() {
        let Some(pg) = postgres().await else {
            return;
        };
        super::super::status_page_domains::force_certs_for_tests(true);
        let backend = pg.db.get_database_backend();
        let schema = Schema::new(backend);
        for table in [
            schema.create_table_from_entity(status_page_components::Entity),
            schema.create_table_from_entity(status_page_audit_log::Entity),
            schema.create_table_from_entity(status_page_check_snoozes::Entity),
            schema.create_table_from_entity(status_page_notice_components::Entity),
            schema.create_table_from_entity(status_page_notice_updates::Entity),
            schema.create_table_from_entity(status_page_notices::Entity),
            schema.create_table_from_entity(status_page_snapshots::Entity),
            schema.create_table_from_entity(status_page_component_checks::Entity),
        ] {
            pg.db.execute(backend.build(&table)).await.unwrap();
        }
        let (org, page) = (config::ider::generate(), config::ider::generate());
        insert_org_page(&pg.db, &org, &page).await;
        let host = format!("{}.pg.example.com", config::ider::generate());
        let id = config::ider::generate();
        // A create that has locked the org's pages and has not inserted its claim yet.
        let txn = pg.db.begin().await.unwrap();
        status_pages::Entity::find()
            .filter(status_pages::Column::OrgId.eq(&org))
            .lock_exclusive()
            .all(&txn)
            .await
            .unwrap();
        let pid = backend_pid(&txn).await;

        let cleanup = delete_by_org_in(&pg.db, &org);
        tokio::pin!(cleanup);
        tokio::select! {
            done = &mut cleanup => panic!("the cleanup finished while a create held the pages: {done:?}"),
            () = pg.wait_until_blocked_by(pid) => {}
        }
        let held = claims::Model {
            held_domain: Some(host.clone()),
            verification_state: VERIFIED,
            ..claim(&id, &org, &page, &host)
        };
        claims::Entity::insert(held.into_active_model())
            .exec(&txn)
            .await
            .unwrap();
        status_page_domain_certs::Model {
            hostname: host.clone(),
            claim_id: Some(id),
            org_id: Some(org.clone()),
            ca_directory: String::new(),
            cert_chain: "chain".to_string(),
            private_key: "sealed".to_string(),
            fingerprint: "fp".to_string(),
            previous_fingerprint: None,
            not_before: T0,
            not_after: T0 + DAY,
            renew_at: None,
            source: "imported".to_string(),
            created_at: T0,
            updated_at: T0,
        }
        .into_active_model()
        .insert(&txn)
        .await
        .unwrap();
        txn.commit().await.unwrap();

        assert_eq!(cleanup.await.unwrap(), vec![host]);
        assert!(cert_hosts(&pg.db).await.is_empty());
        pg.drop_schema().await;
    }

    #[tokio::test]
    async fn postgres_a_grant_waits_for_a_release_that_has_read_the_claim() {
        let Some(pg) = postgres().await else {
            return;
        };
        let (org, page, id) = (
            config::ider::generate(),
            config::ider::generate(),
            config::ider::generate(),
        );
        insert_org_page(&pg.db, &org, &page).await;
        let host = format!("{}.pg.example.com", config::ider::generate());
        let pending = claim(&id, &org, &page, &host);
        let inserted = insert_domain_claim(&pg.db, &pending, true, 20).await;
        assert_eq!(inserted.unwrap(), ClaimInsert::Created);
        let txn = pg.db.begin().await.unwrap();
        let read = find_unreleased_claim(&txn, &org, &id)
            .await
            .unwrap()
            .unwrap();
        let pid = backend_pid(&txn).await;
        let race = grant_domain(&pg.db, &id, T0 + 1);
        tokio::pin!(race);
        tokio::select! {
            done = &mut race => panic!("the grant finished while the row was locked: {done:?}"),
            () = pg.wait_until_blocked_by(pid) => {}
        }

        let freed = release_claim(&txn, &read, T0, RELEASED_BY_ORG)
            .await
            .unwrap();
        txn.commit().await.unwrap();

        assert_eq!(freed, None, "the claim held nothing when it was read");
        assert!(!race.await.unwrap(), "the grant found a released row");
        let after = row(&pg.db, &id).await;
        assert!(after.release_seal.is_some() && after.held_domain.is_none());
        pg.drop_schema().await;
    }
}
