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

use sea_orm::{
    ColumnTrait, EntityTrait, NotSet, Order, QueryFilter, QueryOrder, QuerySelect, Schema, Set,
    entity::prelude::*,
    sea_query::{Func, SimpleExpr},
};

use super::entity::user_password_history::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::{self, DbError, Error},
};

pub async fn create_table() -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    let builder = client.get_database_backend();

    let schema = Schema::new(builder);
    let create_table_stmt = schema
        .create_table_from_entity(Entity)
        .if_not_exists()
        .take();

    client
        .execute(builder.build(&create_table_stmt))
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

pub async fn add(email: &str, password_hash: &str) -> Result<(), errors::Error> {
    let record = ActiveModel {
        id: NotSet,
        email: Set(email.to_lowercase()),
        password_hash: Set(password_hash.to_string()),
        created_at: Set(chrono::Utc::now().timestamp_micros()),
    };

    let client = get_orm_client_rw().await;
    Entity::insert(record)
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// The `limit` most recently recorded hashes, newest first.
pub async fn list_recent(email: &str, limit: u64) -> Result<Vec<Model>, errors::Error> {
    if limit == 0 {
        return Ok(vec![]);
    }
    let client = get_orm_client_ro().await;
    Entity::find()
        .filter(email_eq(email))
        .order_by(Column::CreatedAt, Order::Desc)
        .order_by(Column::Id, Order::Desc)
        .limit(limit)
        .all(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Drop everything older than the `retain` most recent hashes.
pub async fn prune(email: &str, retain: u64) -> Result<u64, errors::Error> {
    let kept = list_recent(email, retain).await?;
    let Some(oldest_kept) = kept.last() else {
        // retain == 0 means keep nothing; an empty history has nothing to prune either.
        if retain > 0 {
            return Ok(0);
        }
        return delete_all_for_user(email).await;
    };

    let client = get_orm_client_rw().await;
    let result = Entity::delete_many()
        .filter(email_eq(email))
        .filter(Column::Id.lt(oldest_kept.id))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected)
}

/// Called when a user is deleted. The schema declares `ON DELETE CASCADE`, but SQLite ships with
/// `PRAGMA foreign_keys` off, so the cleanup cannot be left to the database.
pub async fn delete_all_for_user(email: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    let result = Entity::delete_many()
        .filter(email_eq(email))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected)
}

fn email_eq(email: &str) -> SimpleExpr {
    Expr::expr(Func::lower(Expr::col(Column::Email))).eq(email.to_lowercase())
}
