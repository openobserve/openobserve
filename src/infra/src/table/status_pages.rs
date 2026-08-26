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

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, PaginatorTrait,
    QueryFilter, QueryOrder, QuerySelect, prelude::Expr,
};

use super::entity::{
    status_page_check_snoozes, status_page_component_checks, status_page_components,
    status_page_custom_domains, status_page_notice_components, status_page_notice_updates,
    status_page_notices, status_page_snapshots, status_pages, synthetics_checks,
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// The three columns the auto-incident engine needs per mapped check —
/// deliberately not the whole row (config/secrets are KB each).
#[derive(Clone, Debug)]
pub struct CheckStateRow {
    pub id: String,
    pub last_check_status: i32,
    pub consecutive_failures: i32,
    pub last_triggered_at: i64,
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
        .column(synthetics_checks::Column::LastCheckStatus)
        .column(synthetics_checks::Column::ConsecutiveFailures)
        .column(synthetics_checks::Column::LastTriggeredAt)
        .column(synthetics_checks::Column::UpdatedAt)
        .filter(synthetics_checks::Column::Id.is_in(check_ids.iter().cloned()));
    if let Some(watermark) = since {
        q = q.filter(synthetics_checks::Column::UpdatedAt.gt(watermark));
    }
    let rows = q
        .into_tuple::<(String, i32, i32, i64, i64)>()
        .all(conn)
        .await?;
    let mut max_updated = since.unwrap_or(0);
    let out = rows
        .into_iter()
        .map(
            |(id, last_check_status, consecutive_failures, last_triggered_at, updated_at)| {
                if updated_at > max_updated {
                    max_updated = updated_at;
                }
                CheckStateRow {
                    id,
                    last_check_status,
                    consecutive_failures,
                    last_triggered_at,
                }
            },
        )
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

pub async fn list_notice_updates(
    org_id: &str,
    notice_id: &str,
) -> Result<Vec<status_page_notice_updates::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(status_page_notice_updates::Entity::find()
        .filter(status_page_notice_updates::Column::NoticeId.eq(notice_id))
        .filter(status_page_notice_updates::Column::OrgId.eq(org_id))
        .order_by_asc(status_page_notice_updates::Column::CreatedAt)
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
        let model = status_page_snapshots::Model {
            status_page_id: page_id.to_string(),
            org_id: org_id.to_string(),
            history: history.unwrap_or("{}").to_string(),
            current: current.unwrap_or("{}").to_string(),
            history_generated_at: now,
            current_generated_at: now,
        };
        model.into_active_model().insert(conn).await?;
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

/// Append-only audit row (R-4). No update/delete op exists by design.
pub async fn insert_audit(
    org_id: &str,
    actor: &str,
    action: &str,
    notice_id: Option<&str>,
    at: i64,
) -> Result<(), errors::Error> {
    use super::entity::status_page_audit_log;
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
