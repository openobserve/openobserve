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

//! Service layer for `ai_access_requests`, members asking admins for assistant access.

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set, SqlErr};

pub use super::entity::ai_access_requests::Model;
use super::{entity::ai_access_requests::*, fit};
use crate::{db::get_orm_client_rw, errors};

const MICROS_PER_DAY: i64 = 24 * 3600 * 1_000_000;

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
}

/// A request's UTC day, the unit of the once-a-day limit.
pub fn day_of(micros: i64) -> i64 {
    micros.div_euclid(MICROS_PER_DAY)
}

/// Stores the request unless the member already asked in this org today; `false` then.
pub async fn insert_if_absent(
    org_id: &str,
    user_email: &str,
    message: Option<&str>,
    now: i64,
) -> Result<bool, errors::Error> {
    insert_if_absent_with(get_orm_client_rw().await, org_id, user_email, message, now).await
}

pub async fn insert_if_absent_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    message: Option<&str>,
    now: i64,
) -> Result<bool, errors::Error> {
    let record = ActiveModel {
        id: Set(config::ider::uuid()),
        org_id: Set(fit(org_id, 256)),
        user_email: Set(fit(user_email, 256)),
        message: Set(message.map(str::to_string)),
        day: Set(day_of(now)),
        created_at: Set(now),
    };
    // A plain insert: sea-query's MySQL `ON CONFLICT DO NOTHING` is not valid SQL.
    match Entity::insert(record).exec_without_returning(conn).await {
        Ok(_) => Ok(true),
        Err(e) if matches!(e.sql_err(), Some(SqlErr::UniqueConstraintViolation(_))) => Ok(false),
        Err(e) => Err(db_err(e)),
    }
}

/// Remove every row of `org_id`, for the org's deletion; returns how many.
pub async fn delete_by_org(org_id: &str) -> Result<u64, errors::Error> {
    delete_by_org_with(get_orm_client_rw().await, org_id).await
}

pub async fn delete_by_org_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, Schema};

    use super::*;

    #[tokio::test]
    async fn one_request_per_member_and_org_per_utc_day() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        // The unique key migration 000004 creates.
        db.execute_unprepared(
            "CREATE UNIQUE INDEX uq ON ai_access_requests (org_id, user_email, day)",
        )
        .await
        .unwrap();
        let day = MICROS_PER_DAY;
        assert!(
            insert_if_absent_with(&db, "o", "a@x", Some("please"), day + 5)
                .await
                .unwrap()
        );
        assert!(
            !insert_if_absent_with(&db, "o", "a@x", None, 2 * day - 1)
                .await
                .unwrap()
        );
        assert!(
            insert_if_absent_with(&db, "p", "a@x", None, day + 9)
                .await
                .unwrap()
        );
        assert!(
            insert_if_absent_with(&db, "o", "b@x", None, day + 9)
                .await
                .unwrap()
        );
        assert!(
            insert_if_absent_with(&db, "o", "a@x", None, 2 * day)
                .await
                .unwrap()
        );
        assert_eq!(Entity::find().all(&db).await.unwrap().len(), 4);
        let long = "x".repeat(300);
        assert!(
            insert_if_absent_with(&db, "o", &long, None, day)
                .await
                .unwrap()
        );
    }
}
