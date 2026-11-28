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

//! `secret_consumer_auth`: the signed authorization record of one consumer.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, QueryFilter,
    QuerySelect, sea_query::LockType,
};

pub use super::entity::secret_consumer_auth::{ActiveModel, AuthState, Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors::Error};

pub async fn get_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    consumer_type: &str,
    consumer_id: &str,
) -> Result<Option<Model>, Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ConsumerType.eq(consumer_type))
        .filter(Column::ConsumerId.eq(consumer_id))
        .one(conn)
        .await?)
}

/// The record locked `FOR UPDATE` on PostgreSQL, for a read-then-write under one transaction.
pub async fn get_for_update_in<C: ConnectionTrait>(
    txn: &C,
    org_id: &str,
    consumer_type: &str,
    consumer_id: &str,
) -> Result<Option<Model>, Error> {
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ConsumerType.eq(consumer_type))
        .filter(Column::ConsumerId.eq(consumer_id));
    if txn.get_database_backend() == DatabaseBackend::Postgres {
        query = query.lock(LockType::Update);
    }
    Ok(query.one(txn).await?)
}

pub async fn insert_in<C: ConnectionTrait>(conn: &C, row: ActiveModel) -> Result<Model, Error> {
    Ok(row.insert(conn).await?)
}

/// Writes `row` only when it belongs to `org_id`; a missing record changes nothing.
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

pub async fn delete_in<C: ConnectionTrait>(
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
