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

//! `org_secret_consumers`: the consumer allowlist of a secret.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, sea_query};

pub use super::entity::org_secret_consumers::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

/// `consumer_id` that allows every consumer of a type.
pub const ANY_CONSUMER: &str = "*";

pub async fn list_consumers_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    secret_id: &str,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SecretId.eq(secret_id))
        .order_by_asc(Column::ConsumerType)
        .order_by_asc(Column::ConsumerId)
        .all(conn)
        .await?)
}

/// Adds the entry; an existing one keeps its `added_by` and `added_at`.
pub async fn add_in<C: ConnectionTrait>(conn: &C, row: ActiveModel) -> Result<(), Error> {
    Entity::insert(row)
        .on_conflict(
            sea_query::OnConflict::columns([
                Column::SecretId,
                Column::ConsumerType,
                Column::ConsumerId,
            ])
            .do_nothing()
            .to_owned(),
        )
        .do_nothing()
        .exec(conn)
        .await?;
    Ok(())
}

pub async fn remove_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    secret_id: &str,
    consumer_type: &str,
    consumer_id: &str,
) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SecretId.eq(secret_id))
        .filter(Column::ConsumerType.eq(consumer_type))
        .filter(Column::ConsumerId.eq(consumer_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
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
