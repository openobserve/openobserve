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

//! Table ops for public dashboards. The anonymous serving path reads only
//! [`get_by_slug`] and [`get_snapshot`]; the rebuilder writes via
//! [`upsert_snapshot`] and [`mark_rebuilt`]. Everything is indexed — the slug
//! lookup rides the global-unique index, snapshot reads the composite PK.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, QuerySelect, prelude::Expr,
};

use super::entity::{public_dashboard_snapshots, public_dashboards};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

// ── Public serving path (generic conn; the caller owns cache + point-reads) ───

/// Resolve the share record by its globally-unique slug — no org in the URL.
pub async fn get_by_slug<C: ConnectionTrait>(
    conn: &C,
    slug: &str,
) -> Result<Option<public_dashboards::Model>, errors::Error> {
    Ok(public_dashboards::Entity::find()
        .filter(public_dashboards::Column::Slug.eq(slug))
        .one(conn)
        .await?)
}

/// Point-read the materialized snapshot for one `(dashboard, preset)`.
pub async fn get_snapshot<C: ConnectionTrait>(
    conn: &C,
    public_dashboard_id: &str,
    preset_secs: i64,
) -> Result<Option<public_dashboard_snapshots::Model>, errors::Error> {
    Ok(public_dashboard_snapshots::Entity::find_by_id((
        public_dashboard_id.to_string(),
        preset_secs,
    ))
    .one(conn)
    .await?)
}

/// Which presets currently have a built snapshot — feeds the sanitized config's
/// `available_presets`.
pub async fn list_snapshot_presets<C: ConnectionTrait>(
    conn: &C,
    public_dashboard_id: &str,
) -> Result<Vec<i64>, errors::Error> {
    Ok(public_dashboard_snapshots::Entity::find()
        .select_only()
        .column(public_dashboard_snapshots::Column::PresetSecs)
        .filter(public_dashboard_snapshots::Column::PublicDashboardId.eq(public_dashboard_id))
        .into_tuple::<i64>()
        .all(conn)
        .await?)
}

// ── Rebuilder path (generic conn) ─────────────────────────────────────────────

/// Fetch one share record by id — the rebuilder's per-trigger lookup.
pub async fn get<C: ConnectionTrait>(
    conn: &C,
    id: &str,
) -> Result<Option<public_dashboards::Model>, errors::Error> {
    Ok(public_dashboards::Entity::find_by_id(id).one(conn).await?)
}

/// Every enabled, non-draft share — the rebuilder's safety-sweep work list.
pub async fn list_enabled<C: ConnectionTrait>(
    conn: &C,
) -> Result<Vec<public_dashboards::Model>, errors::Error> {
    Ok(public_dashboards::Entity::find()
        .filter(public_dashboards::Column::Enabled.eq(true))
        .filter(public_dashboards::Column::Visibility.ne(0))
        .all(conn)
        .await?)
}

/// Insert-or-replace the snapshot row for one `(dashboard, preset)`.
pub async fn upsert_snapshot<C: ConnectionTrait>(
    conn: &C,
    public_dashboard_id: &str,
    preset_secs: i64,
    data: &str,
    now: i64,
) -> Result<(), errors::Error> {
    let res = public_dashboard_snapshots::Entity::update_many()
        .col_expr(public_dashboard_snapshots::Column::Data, Expr::value(data))
        .col_expr(
            public_dashboard_snapshots::Column::BuiltAt,
            Expr::value(now),
        )
        .filter(public_dashboard_snapshots::Column::PublicDashboardId.eq(public_dashboard_id))
        .filter(public_dashboard_snapshots::Column::PresetSecs.eq(preset_secs))
        .exec(conn)
        .await?;
    if res.rows_affected == 0 {
        let model = public_dashboard_snapshots::Model {
            public_dashboard_id: public_dashboard_id.to_string(),
            preset_secs,
            data: data.to_string(),
            built_at: now,
        };
        model.into_active_model().insert(conn).await?;
    }
    Ok(())
}

/// Drop snapshot rows for presets no longer offered (on config update).
pub async fn prune_snapshots<C: ConnectionTrait>(
    conn: &C,
    public_dashboard_id: &str,
    keep_presets: &[i64],
) -> Result<(), errors::Error> {
    let mut q = public_dashboard_snapshots::Entity::delete_many()
        .filter(public_dashboard_snapshots::Column::PublicDashboardId.eq(public_dashboard_id));
    if !keep_presets.is_empty() {
        q = q.filter(
            public_dashboard_snapshots::Column::PresetSecs.is_not_in(keep_presets.to_vec()),
        );
    }
    q.exec(conn).await?;
    Ok(())
}

/// Record a rebuild's outcome: timestamp, state, and the served / withheld
/// stream lists (both stored as JSON text, informational for the admin UI).
pub async fn mark_rebuilt<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    state: i32,
    last_authorized_streams: Option<&str>,
    unauthorized_streams: Option<&str>,
    now: i64,
) -> Result<(), errors::Error> {
    public_dashboards::Entity::update_many()
        .col_expr(public_dashboards::Column::RebuildState, Expr::value(state))
        .col_expr(public_dashboards::Column::LastRebuiltAt, Expr::value(now))
        .col_expr(
            public_dashboards::Column::LastAuthorizedStreams,
            Expr::value(last_authorized_streams.map(|s| s.to_string())),
        )
        .col_expr(
            public_dashboards::Column::UnauthorizedStreams,
            Expr::value(unauthorized_streams.map(|s| s.to_string())),
        )
        .filter(public_dashboards::Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

// ── Admin CRUD (org-scoped, service-facing; fetch conn internally) ────────────

pub async fn insert(model: &public_dashboards::Model) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    model.clone().into_active_model().insert(conn).await?;
    Ok(())
}

/// Slug uniqueness is global (the public URL carries no org); this tests a
/// candidate slug for collision before insert.
pub async fn get_by_slug_any(
    slug: &str,
) -> Result<Option<public_dashboards::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(public_dashboards::Entity::find()
        .filter(public_dashboards::Column::Slug.eq(slug))
        .one(conn)
        .await?)
}

/// The share for a dashboard (at most one), org-scoped.
pub async fn get_by_dashboard(
    org_id: &str,
    dashboard_id: &str,
) -> Result<Option<public_dashboards::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(public_dashboards::Entity::find()
        .filter(public_dashboards::Column::OrgId.eq(org_id))
        .filter(public_dashboards::Column::DashboardId.eq(dashboard_id))
        .one(conn)
        .await?)
}

pub async fn list(org_id: &str) -> Result<Vec<public_dashboards::Model>, errors::Error> {
    let conn = get_orm_client_ro().await;
    Ok(public_dashboards::Entity::find()
        .filter(public_dashboards::Column::OrgId.eq(org_id))
        .order_by_desc(public_dashboards::Column::UpdatedAt)
        .all(conn)
        .await?)
}

/// A Model loaded from the DB converts to an ActiveModel with every field
/// `Unchanged`, so `reset_all` marks all columns dirty and the mutated fields
/// actually persist (the same trap `status_pages::update_page` documents).
pub async fn update(model: &public_dashboards::Model) -> Result<(), errors::Error> {
    let conn = get_orm_client_rw().await;
    let am = model.clone().into_active_model().reset_all();
    am.update(conn).await?;
    Ok(())
}

/// Delete a share (org-scoped) and all its snapshots. Returns whether it existed.
pub async fn delete(org_id: &str, id: &str) -> Result<bool, errors::Error> {
    let conn = get_orm_client_rw().await;
    public_dashboard_snapshots::Entity::delete_many()
        .filter(public_dashboard_snapshots::Column::PublicDashboardId.eq(id))
        .exec(conn)
        .await?;
    let res = public_dashboards::Entity::delete_many()
        .filter(public_dashboards::Column::Id.eq(id))
        .filter(public_dashboards::Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}
