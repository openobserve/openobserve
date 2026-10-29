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

//! Service layer for `ai_turn_marks`: cluster-visible facts about a running assistant turn.

use std::collections::HashMap;

use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set};

pub use super::entity::ai_turn_marks::Model;
use super::{entity::ai_turn_marks::*, fit};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// A turn of `user_email` runs `session_id`.
pub const KIND_TURN: &str = "turn";
/// The turn asked `user_email` to confirm a call of the tool in `value`.
pub const KIND_CONFIRMATION: &str = "confirmation";
/// `user_email` answered the session's pending confirmation at `created_at`.
pub const KIND_ANSWERED: &str = "answered";

/// One mark to store; the id and time are filled in.
#[derive(Debug, Clone, Copy)]
pub struct NewMark<'a> {
    pub org_id: &'a str,
    pub session_id: &'a str,
    pub user_email: &'a str,
    pub kind: &'static str,
    pub value: Option<&'a str>,
    pub expires_at: i64,
}

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
}

/// Stores `mark` and returns its id.
pub async fn insert(mark: &NewMark<'_>, now: i64) -> Result<String, errors::Error> {
    insert_with(get_orm_client_rw().await, mark, now).await
}

pub async fn insert_with<C: ConnectionTrait>(
    conn: &C,
    mark: &NewMark<'_>,
    now: i64,
) -> Result<String, errors::Error> {
    let id = config::ider::uuid();
    let record = ActiveModel {
        id: Set(id.clone()),
        org_id: Set(fit(mark.org_id, 256)),
        session_id: Set(fit(mark.session_id, 64)),
        user_email: Set(fit(mark.user_email, 256)),
        kind: Set(mark.kind.to_string()),
        value: Set(mark.value.map(|v| fit(v, 256))),
        expires_at: Set(mark.expires_at),
        created_at: Set(now),
    };
    Entity::insert(record)
        .exec_without_returning(conn)
        .await
        .map_err(db_err)?;
    Ok(id)
}

/// Whether an unexpired mark of this kind (and `value`, when given) exists.
pub async fn exists(
    org_id: &str,
    session_id: &str,
    user_email: &str,
    kind: &str,
    value: Option<&str>,
    now: i64,
) -> Result<bool, errors::Error> {
    exists_with(
        get_orm_client_ro().await,
        (org_id, session_id, user_email),
        kind,
        value,
        now,
    )
    .await
}

pub async fn exists_with<C: ConnectionTrait>(
    conn: &C,
    key: (&str, &str, &str),
    kind: &str,
    value: Option<&str>,
    now: i64,
) -> Result<bool, errors::Error> {
    let found = matching(key, kind, value, now)
        .one(conn)
        .await
        .map_err(db_err)?;
    Ok(found.is_some())
}

/// Consumes the matching unexpired marks; `false` when none, so two takers never both win.
pub async fn take(
    org_id: &str,
    session_id: &str,
    user_email: &str,
    kind: &str,
    value: Option<&str>,
    now: i64,
) -> Result<bool, errors::Error> {
    take_with(
        get_orm_client_rw().await,
        (org_id, session_id, user_email),
        kind,
        value,
        now,
    )
    .await
}

pub async fn take_with<C: ConnectionTrait>(
    conn: &C,
    (org_id, session_id, user_email): (&str, &str, &str),
    kind: &str,
    value: Option<&str>,
    now: i64,
) -> Result<bool, errors::Error> {
    let mut delete = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::UserEmail.eq(user_email))
        .filter(Column::Kind.eq(kind))
        .filter(Column::ExpiresAt.gt(now));
    if let Some(value) = value {
        delete = delete.filter(Column::Value.eq(value));
    }
    let result = delete.exec(conn).await.map_err(db_err)?;
    Ok(result.rows_affected > 0)
}

pub async fn delete(id: &str) -> Result<(), errors::Error> {
    delete_with(get_orm_client_rw().await, id).await
}

pub async fn delete_with<C: ConnectionTrait>(conn: &C, id: &str) -> Result<(), errors::Error> {
    Entity::delete_by_id(id).exec(conn).await.map_err(db_err)?;
    Ok(())
}

/// The creation times of the unexpired marks of `kind` per listed session of `user_email`.
pub async fn created_per_session(
    org_id: &str,
    user_email: &str,
    kind: &str,
    session_ids: &[String],
    now: i64,
) -> Result<HashMap<String, Vec<i64>>, errors::Error> {
    created_per_session_with(
        get_orm_client_ro().await,
        (org_id, user_email),
        kind,
        session_ids,
        now,
    )
    .await
}

pub async fn created_per_session_with<C: ConnectionTrait>(
    conn: &C,
    (org_id, user_email): (&str, &str),
    kind: &str,
    session_ids: &[String],
    now: i64,
) -> Result<HashMap<String, Vec<i64>>, errors::Error> {
    if session_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let rows = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .filter(Column::Kind.eq(kind))
        .filter(Column::SessionId.is_in(session_ids.iter().map(String::as_str)))
        .filter(Column::ExpiresAt.gt(now))
        .all(conn)
        .await
        .map_err(db_err)?;
    let mut created: HashMap<String, Vec<i64>> = HashMap::new();
    for row in rows {
        created
            .entry(row.session_id)
            .or_default()
            .push(row.created_at);
    }
    for times in created.values_mut() {
        times.sort_unstable();
    }
    Ok(created)
}

/// Removes every expired mark, e.g. of a node that died mid-turn.
pub async fn delete_expired(now: i64) -> Result<u64, errors::Error> {
    delete_expired_with(get_orm_client_rw().await, now).await
}

pub async fn delete_expired_with<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<u64, errors::Error> {
    let result = Entity::delete_many()
        .filter(Column::ExpiresAt.lte(now))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
}

fn matching(
    (org_id, session_id, user_email): (&str, &str, &str),
    kind: &str,
    value: Option<&str>,
    now: i64,
) -> sea_orm::Select<Entity> {
    let select = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::UserEmail.eq(user_email))
        .filter(Column::Kind.eq(kind))
        .filter(Column::ExpiresAt.gt(now));
    match value {
        Some(value) => select.filter(Column::Value.eq(value)),
        None => select,
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
    use sea_orm::{Database, DatabaseConnection, Schema};

    use super::*;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    fn mark(kind: &'static str, value: Option<&'static str>) -> NewMark<'static> {
        NewMark {
            org_id: "o",
            session_id: "s",
            user_email: "a@x",
            kind,
            value,
            expires_at: 100,
        }
    }

    #[tokio::test]
    async fn a_turn_mark_binds_only_its_member_until_it_expires_or_ends() {
        let db = db().await;
        let id = insert_with(&db, &mark(KIND_TURN, None), 1).await.unwrap();
        let bound = |user: &'static str, now| {
            let db = &db;
            async move {
                exists_with(db, ("o", "s", user), KIND_TURN, None, now)
                    .await
                    .unwrap()
            }
        };
        assert!(bound("a@x", 50).await);
        assert!(!bound("m@x", 50).await);
        assert!(!bound("a@x", 100).await);
        delete_with(&db, &id).await.unwrap();
        assert!(!bound("a@x", 50).await);
    }

    #[tokio::test]
    async fn a_confirmation_is_taken_once_and_only_for_its_tool() {
        let db = db().await;
        insert_with(&db, &mark(KIND_CONFIRMATION, Some("UpdateDashboard")), 1)
            .await
            .unwrap();
        let key = ("o", "s", "a@x");
        let take = |tool| take_with(&db, key, KIND_CONFIRMATION, Some(tool), 50);
        assert!(!take("DeleteAlert").await.unwrap());
        assert!(take("UpdateDashboard").await.unwrap());
        assert!(!take("UpdateDashboard").await.unwrap());
        insert_with(&db, &mark(KIND_TURN, None), 1).await.unwrap();
        assert_eq!(delete_expired_with(&db, 100).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn every_answer_of_each_listed_session_is_read() {
        let db = db().await;
        for at in [5, 9] {
            insert_with(&db, &mark(KIND_ANSWERED, None), at)
                .await
                .unwrap();
        }
        let other = NewMark {
            session_id: "t",
            ..mark(KIND_ANSWERED, None)
        };
        insert_with(&db, &other, 7).await.unwrap();
        let sessions = ["s".to_string(), "t".to_string(), "u".to_string()];
        let created = created_per_session_with(&db, ("o", "a@x"), KIND_ANSWERED, &sessions, 50)
            .await
            .unwrap();
        assert_eq!(
            created,
            HashMap::from([("s".to_string(), vec![5, 9]), ("t".to_string(), vec![7])])
        );
        let someone_else =
            created_per_session_with(&db, ("o", "m@x"), KIND_ANSWERED, &sessions, 50)
                .await
                .unwrap();
        assert!(someone_else.is_empty());
    }
}
