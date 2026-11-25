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

//! `autoresolve`: saved AutoResolve definitions and their triggers.

use config::meta::autoresolve::TriggerKind;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DbErr, EntityTrait, QueryFilter, QueryOrder,
    Set, SqlErr, UpdateMany,
    sea_query::{Expr, SimpleExpr},
};

use super::entity::autoresolve::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{DbError, Error},
};

/// The row a saved AutoResolve is inserted as.
#[derive(Debug, Clone)]
pub struct NewAutoResolve {
    pub id: String,
    pub org: String,
    pub region: String,
    pub name: String,
    pub goal: String,
    /// A JSON array of connection ids.
    pub connection_ids: String,
    /// A JSON object of connection id to name, so a connection removed later keeps its name.
    pub connection_names: String,
    pub trigger_kind: TriggerKind,
    pub trigger_alert_id: Option<String>,
    pub trigger_enabled: bool,
    pub trigger_approved_by: Option<String>,
    pub trigger_approved_at_us: Option<i64>,
    pub created_by: String,
    pub from_run_id: Option<String>,
    pub now_us: i64,
}

/// Columns an update sets; `None` leaves a column alone, and the nullable ones take `Some(None)`
/// to clear.
#[derive(Debug, Clone, Default)]
pub struct AutoResolvePatch {
    pub name: Option<String>,
    pub goal: Option<String>,
    pub connection_ids: Option<String>,
    pub connection_names: Option<String>,
    pub trigger_kind: Option<TriggerKind>,
    pub trigger_alert_id: Option<Option<String>>,
    pub trigger_enabled: Option<bool>,
    pub trigger_approved_by: Option<Option<String>>,
    pub trigger_approved_at_us: Option<Option<i64>>,
    pub updated_at_us: i64,
    /// Writes only while the row still has this `updated_at_us`, so a write based on a stale
    /// read misses.
    pub if_updated_at_us: Option<i64>,
}

impl AutoResolvePatch {
    fn apply(self, update: UpdateMany<Entity>) -> UpdateMany<Entity> {
        let update = update.col_expr(Column::UpdatedAtUs, Expr::value(self.updated_at_us));
        let update = set(update, Column::Name, self.name);
        let update = set(update, Column::Goal, self.goal);
        let update = set(update, Column::ConnectionIds, self.connection_ids);
        let update = set(update, Column::ConnectionNames, self.connection_names);
        let update = set(
            update,
            Column::TriggerKind,
            self.trigger_kind.map(|k| k.as_str().to_string()),
        );
        let update = set(update, Column::TriggerAlertId, self.trigger_alert_id);
        let update = set(update, Column::TriggerEnabled, self.trigger_enabled);
        let update = set(update, Column::TriggerApprovedBy, self.trigger_approved_by);
        set(
            update,
            Column::TriggerApprovedAtUs,
            self.trigger_approved_at_us,
        )
    }
}

/// A taken `(org, name)` fails with `DbError::UniqueViolation`.
pub async fn insert(flow: NewAutoResolve) -> Result<Model, Error> {
    insert_with(get_orm_client_rw().await, flow).await
}

pub async fn insert_with<C: ConnectionTrait>(
    conn: &C,
    flow: NewAutoResolve,
) -> Result<Model, Error> {
    ActiveModel {
        id: Set(flow.id),
        org: Set(flow.org),
        region: Set(flow.region),
        name: Set(flow.name),
        goal: Set(flow.goal),
        connection_ids: Set(flow.connection_ids),
        connection_names: Set(flow.connection_names),
        trigger_kind: Set(flow.trigger_kind.as_str().to_string()),
        trigger_alert_id: Set(flow.trigger_alert_id),
        trigger_enabled: Set(flow.trigger_enabled),
        trigger_approved_by: Set(flow.trigger_approved_by),
        trigger_approved_at_us: Set(flow.trigger_approved_at_us),
        created_by: Set(flow.created_by),
        created_at_us: Set(flow.now_us),
        updated_at_us: Set(flow.now_us),
        from_run_id: Set(flow.from_run_id),
    }
    .insert(conn)
    .await
    .map_err(unique_violation)
}

pub async fn get(org: &str, id: &str) -> Result<Option<Model>, Error> {
    get_with(get_orm_client_rw().await, org, id).await
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find_by_id(id.to_string())
        .filter(Column::Org.eq(org))
        .one(conn)
        .await?)
}

pub async fn list(org: &str) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::Org.eq(org))
        .order_by_asc(Column::Name)
        .all(get_orm_client_ro().await)
        .await?)
}

/// The enabled AutoResolves of this region that fire on this kind of trigger for this alert.
pub async fn list_triggered(
    org: &str,
    region: &str,
    kind: TriggerKind,
    alert_id: &str,
) -> Result<Vec<Model>, Error> {
    list_triggered_with(get_orm_client_rw().await, org, region, kind, alert_id).await
}

pub async fn list_triggered_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    region: &str,
    kind: TriggerKind,
    alert_id: &str,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Region.eq(region))
        .filter(Column::TriggerKind.eq(kind.as_str()))
        .filter(Column::TriggerAlertId.eq(alert_id))
        .filter(Column::TriggerEnabled.eq(true))
        .all(conn)
        .await?)
}

/// False when the AutoResolve does not exist or moved past `if_updated_at_us`; a taken name fails
/// with `DbError::UniqueViolation`.
pub async fn update(org: &str, id: &str, patch: AutoResolvePatch) -> Result<bool, Error> {
    update_with(get_orm_client_rw().await, org, id, patch).await
}

pub async fn update_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
    patch: AutoResolvePatch,
) -> Result<bool, Error> {
    let read_at = patch.if_updated_at_us;
    let mut update = patch
        .apply(Entity::update_many())
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id));
    if let Some(at) = read_at {
        update = update.filter(Column::UpdatedAtUs.eq(at));
    }
    let res = update.exec(conn).await.map_err(unique_violation)?;
    Ok(res.rows_affected == 1)
}

/// False when the AutoResolve does not exist.
pub async fn delete(org: &str, id: &str) -> Result<bool, Error> {
    delete_with(get_orm_client_rw().await, org, id).await
}

pub async fn delete_with<C: ConnectionTrait>(conn: &C, org: &str, id: &str) -> Result<bool, Error> {
    let res = Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

pub async fn delete_by_org(org: &str) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(res.rows_affected)
}

fn set<V: Into<SimpleExpr>>(
    update: UpdateMany<Entity>,
    col: Column,
    value: Option<V>,
) -> UpdateMany<Entity> {
    match value {
        Some(v) => update.col_expr(col, Expr::value(v)),
        None => update,
    }
}

fn unique_violation(e: DbErr) -> Error {
    match e.sql_err() {
        Some(SqlErr::UniqueConstraintViolation(_)) => Error::DbError(DbError::UniqueViolation),
        _ => e.into(),
    }
}
