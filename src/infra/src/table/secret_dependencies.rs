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

//! `secret_dependencies`: the legacy names and `vars:{secret_id}` keys a consumer depends on.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};

pub use super::entity::secret_dependencies::{ActiveModel, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

/// The `dep_key` of a dependency on a store variable.
pub fn var_dep_key(secret_id: &str) -> String {
    format!("vars:{secret_id}")
}

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
        .order_by_asc(Column::DepKey)
        .all(conn)
        .await?)
}

/// The consumers that depend on `dep_key`.
pub async fn list_by_dep_key_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    dep_key: &str,
) -> Result<Vec<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::DepKey.eq(dep_key))
        .order_by_asc(Column::ConsumerType)
        .order_by_asc(Column::ConsumerId)
        .all(conn)
        .await?)
}

/// Replaces the consumer's dependencies with `dep_keys`.
pub async fn replace_for_consumer_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    consumer_type: &str,
    consumer_id: &str,
    dep_keys: &[String],
) -> Result<(), Error> {
    use sea_orm::Set;

    delete_for_consumer_in(conn, org_id, consumer_type, consumer_id).await?;
    if dep_keys.is_empty() {
        return Ok(());
    }
    let rows = dep_keys.iter().map(|dep_key| ActiveModel {
        org_id: Set(org_id.to_string()),
        consumer_type: Set(consumer_type.to_string()),
        consumer_id: Set(consumer_id.to_string()),
        dep_key: Set(dep_key.clone()),
    });
    Entity::insert_many(rows)
        .exec_without_returning(conn)
        .await?;
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
