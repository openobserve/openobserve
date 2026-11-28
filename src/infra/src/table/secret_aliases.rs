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

//! `secret_aliases`: old names a renamed secret still answers to until `expires_at`.

use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter};

pub use super::entity::secret_aliases::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

/// The alias row for `name` that has not expired at `now`.
pub async fn get_alias_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    name: &str,
    now: i64,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .filter(Column::ExpiresAt.gt(now))
        .one(conn)
        .await?)
}

pub async fn insert_in<C: ConnectionTrait>(conn: &C, row: ActiveModel) -> Result<Model, Error> {
    Ok(row.insert(conn).await?)
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

pub async fn delete_name_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    name: &str,
) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
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
