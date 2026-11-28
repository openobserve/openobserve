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

//! `secret_refs`: which consumer field names which secret.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};

pub use super::entity::secret_refs::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

pub async fn list_for_consumer_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    consumer_type: &str,
    consumer_id: &str,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ConsumerType.eq(consumer_type))
        .filter(Column::ConsumerId.eq(consumer_id))
        .order_by_asc(Column::Field)
        .order_by_asc(Column::SecretId)
        .all(conn)
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
        .order_by_asc(Column::ConsumerType)
        .order_by_asc(Column::ConsumerId)
        .all(conn)
        .await?)
}

/// Replaces the consumer's refs with `rows`; every row must carry `org_id` and the consumer.
pub async fn replace_for_consumer_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    consumer_type: &str,
    consumer_id: &str,
    rows: Vec<ActiveModel>,
) -> Result<(), Error> {
    delete_for_consumer_in(conn, org_id, consumer_type, consumer_id).await?;
    if !rows.is_empty() {
        Entity::insert_many(rows)
            .exec_without_returning(conn)
            .await?;
    }
    Ok(())
}

pub async fn delete_for_consumer_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    consumer_type: &str,
    consumer_id: &str,
) -> Result<u64, Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ConsumerType.eq(consumer_type))
        .filter(Column::ConsumerId.eq(consumer_id))
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
