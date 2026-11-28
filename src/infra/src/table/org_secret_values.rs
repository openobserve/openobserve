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

//! `org_secret_values`: the value head of a secret per environment incarnation; the
//! ciphertext itself is a `credential_values` row named by `value_ref`.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait, sea_query::Expr,
};

pub use super::entity::org_secret_values::{ActiveModel, Column, Entity, Model};
use super::{
    credential_values::{OWNER_KIND_ORG_SECRET, OWNER_KIND_ORG_SECRET_POINTER},
    entity::credential_values,
};
use crate::{db::get_orm_client_rw, errors::Error};

/// `env_id` of the org-wide value.
pub const ORG_ENV: &str = "_org";
/// Credential owner kinds a value head can own; retire, purge and sweep must cover every one.
pub const VALUE_OWNER_KINDS: [&str; 2] = [OWNER_KIND_ORG_SECRET, OWNER_KIND_ORG_SECRET_POINTER];

pub async fn get_value_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    secret_id: &str,
    env_id: &str,
    env_incarnation: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SecretId.eq(secret_id))
        .filter(Column::EnvId.eq(env_id))
        .filter(Column::EnvIncarnation.eq(env_incarnation))
        .one(conn)
        .await?)
}

pub async fn list_for_secret_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    secret_id: &str,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SecretId.eq(secret_id))
        .order_by_asc(Column::EnvId)
        .all(conn)
        .await?)
}

pub async fn list_for_env_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    env_id: &str,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::EnvId.eq(env_id))
        .order_by_asc(Column::SecretId)
        .all(conn)
        .await?)
}

pub async fn insert_in<C: ConnectionTrait>(conn: &C, row: ActiveModel) -> Result<Model, Error> {
    Ok(row.insert(conn).await?)
}

/// Writes `row` only when it belongs to `org_id`; a foreign id changes nothing.
pub async fn update_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    row: ActiveModel,
) -> Result<Option<Model>, Error> {
    match Entity::update(row)
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await
    {
        Ok(model) => Ok(Some(model)),
        Err(sea_orm::DbErr::RecordNotUpdated) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub(super) async fn retire_environment_in<C: ConnectionTrait>(
    txn: &C,
    org_id: &str,
    env_id: &str,
    incarnation: &str,
) -> Result<(), Error> {
    let environment = Condition::all()
        .add(Column::EnvId.eq(env_id))
        .add(Column::EnvIncarnation.eq(incarnation));
    Entity::update_many()
        .col_expr(Column::State, Expr::value("deleted"))
        .col_expr(Column::ValueRef, Expr::value(None::<String>))
        .col_expr(Column::BackendId, Expr::value(None::<String>))
        .filter(Column::OrgId.eq(org_id))
        .filter(environment.clone())
        .exec(txn)
        .await?;
    let owner_ids = Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Column::OrgId.eq(org_id))
        .filter(environment)
        .into_query();
    // credential_values keeps milliseconds: the sweeper compares grace_expires_at to now_ms().
    let now_ms = chrono::Utc::now().timestamp_millis();
    credential_values::Entity::update_many()
        .col_expr(credential_values::Column::State, Expr::value("retired"))
        .col_expr(
            credential_values::Column::GraceExpiresAt,
            Expr::value(now_ms),
        )
        .col_expr(credential_values::Column::UpdatedAt, Expr::value(now_ms))
        .filter(credential_values::Column::OrgId.eq(org_id))
        .filter(credential_values::Column::OwnerKind.is_in(VALUE_OWNER_KINDS))
        .filter(credential_values::Column::OwnerId.in_subquery(owner_ids))
        .filter(credential_values::Column::State.eq("current"))
        .exec(txn)
        .await?;
    Ok(())
}

pub async fn delete_for_secret_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    secret_id: &str,
) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SecretId.eq(secret_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, Error> {
    delete_by_org_in(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_in<C: ConnectionTrait>(conn: &C, org_id: &str) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}
