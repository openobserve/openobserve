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
    EntityTrait, QueryFilter, Schema, Set,
    entity::prelude::*,
    sea_query::{Func, OnConflict, SimpleExpr},
};

use super::entity::user_auth_state::{ActiveModel, Column, Entity, Model};
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

/// `None` means the user has never failed a login — the common case, since rows are only written
/// on failure.
pub async fn get(email: &str) -> Result<Option<Model>, errors::Error> {
    let client = get_orm_client_ro().await;
    Entity::find()
        .filter(email_eq(email))
        .one(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))
}

/// Add one to the failure counter. `false` means there is no row yet and the caller should insert.
///
/// The arithmetic runs inside the database, so simultaneous failures against the same account
/// cannot lose an increment the way a read-modify-write from two nodes would.
pub async fn increment_failed_attempts(email: &str, now: i64) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let result = Entity::update_many()
        .col_expr(
            Column::FailedAttempts,
            Expr::col(Column::FailedAttempts).add(1),
        )
        .col_expr(Column::LastFailedAt, Expr::value(now))
        .filter(email_eq(email))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected > 0)
}

/// Record the first failure for a user. `false` means a concurrent request inserted the row first
/// and the caller should increment it instead.
pub async fn insert_first_failure(email: &str, now: i64) -> Result<bool, errors::Error> {
    let record = ActiveModel {
        email: Set(email.to_lowercase()),
        failed_attempts: Set(1),
        lockout_level: Set(0),
        locked_until: Set(None),
        last_failed_at: Set(Some(now)),
    };

    let client = get_orm_client_rw().await;
    let inserted = Entity::insert(record)
        .on_conflict(OnConflict::column(Column::Email).do_nothing().to_owned())
        .exec_without_returning(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(inserted > 0)
}

/// Start a lockout, and report whether this caller is the one that started it.
///
/// A compare-and-set against the state the caller read: `from_level` and `min_attempts` are part of
/// the `WHERE`, so a burst of simultaneous failures that all observe the threshold produces exactly
/// one escalation. The losers change nothing and read the winner's `locked_until`.
///
/// `failed_attempts` resets here, so the next bucket is counted from zero.
pub async fn escalate(
    email: &str,
    from_level: i32,
    min_attempts: i32,
    locked_until: i64,
) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    let result = Entity::update_many()
        .col_expr(Column::LockoutLevel, Expr::value(from_level + 1))
        .col_expr(Column::LockedUntil, Expr::value(locked_until))
        .col_expr(Column::FailedAttempts, Expr::value(0))
        .filter(email_eq(email))
        .filter(Column::LockoutLevel.eq(from_level))
        .filter(Column::FailedAttempts.gte(min_attempts))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected > 0)
}

/// Overwrite the lockout deadline, leaving the failure counters and the escalation level alone.
///
/// Unlike [`escalate`] this does not advance the level, so it expresses "this lockout is over"
/// without also making the next one longer — an account unlocked by hand, or one whose deadline a
/// test moves rather than waiting out.
pub async fn set_locked_until(
    email: &str,
    locked_until: Option<i64>,
) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    let result = Entity::update_many()
        .col_expr(Column::LockedUntil, Expr::value(locked_until))
        .filter(email_eq(email))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(result.rows_affected)
}

/// Clear every counter, including the escalation level, after a successful login.
pub async fn reset(email: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::update_many()
        .col_expr(Column::FailedAttempts, Expr::value(0))
        .col_expr(Column::LockoutLevel, Expr::value(0))
        .col_expr(Column::LockedUntil, Expr::value(Option::<i64>::None))
        .col_expr(Column::LastFailedAt, Expr::value(Option::<i64>::None))
        .filter(email_eq(email))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;

    Ok(())
}

/// Called when a user is deleted. See `user_password_history::delete_all_for_user` for why the
/// declared cascade is not enough.
pub async fn delete(email: &str) -> Result<u64, errors::Error> {
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
