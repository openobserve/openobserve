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

//! `ai_chat_feedback`: a member's vote and comment on one turn, stored and deleted with the chat.

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QuerySelect, QueryTrait,
    Set, SqlErr, sea_query::Expr,
};

pub use super::entity::ai_chat_feedback::Model;
use super::entity::{ai_chat_feedback::*, ai_chat_sessions};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

pub const RATING_UP: &str = "up";
pub const RATING_DOWN: &str = "down";
/// Longer comments are cut, so one vote cannot grow a chat without bound.
pub const MAX_COMMENT_CHARS: usize = 4000;

/// One vote to store; the times are filled in.
#[derive(Debug, Clone, Copy)]
pub struct NewFeedback<'a> {
    pub org_id: &'a str,
    pub session_id: &'a str,
    pub turn_id: &'a str,
    pub user_id: &'a str,
    pub rating: &'a str,
    pub comment: Option<&'a str>,
}

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
}

/// Stores the vote; a second vote of the same member on the same turn replaces the first.
pub async fn upsert(feedback: &NewFeedback<'_>, now: i64) -> Result<(), errors::Error> {
    upsert_with(get_orm_client_rw().await, feedback, now).await
}

pub async fn upsert_with<C: ConnectionTrait>(
    conn: &C,
    feedback: &NewFeedback<'_>,
    now: i64,
) -> Result<(), errors::Error> {
    let comment = feedback
        .comment
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(|c| c.chars().take(MAX_COMMENT_CHARS).collect::<String>());
    let record = ActiveModel {
        org_id: Set(feedback.org_id.to_string()),
        session_id: Set(feedback.session_id.to_string()),
        turn_id: Set(feedback.turn_id.to_string()),
        user_id: Set(feedback.user_id.to_string()),
        rating: Set(feedback.rating.to_string()),
        comment: Set(comment.clone()),
        created_at: Set(now),
        updated_at: Set(now),
    };
    match Entity::insert(record).exec_without_returning(conn).await {
        Ok(_) => Ok(()),
        Err(e) if matches!(e.sql_err(), Some(SqlErr::UniqueConstraintViolation(_))) => {
            Entity::update_many()
                .col_expr(Column::Rating, Expr::value(feedback.rating.to_string()))
                .col_expr(Column::Comment, Expr::value(comment))
                .col_expr(Column::UpdatedAt, Expr::value(now))
                .filter(Column::OrgId.eq(feedback.org_id))
                .filter(Column::SessionId.eq(feedback.session_id))
                .filter(Column::TurnId.eq(feedback.turn_id))
                .filter(Column::UserId.eq(feedback.user_id))
                .exec(conn)
                .await
                .map_err(db_err)?;
            Ok(())
        }
        Err(e) => Err(db_err(e)),
    }
}

/// The votes `user_id` left on a chat's turns.
pub async fn list_for_session(
    org_id: &str,
    session_id: &str,
    user_id: &str,
) -> Result<Vec<Model>, errors::Error> {
    list_for_session_with(get_orm_client_ro().await, org_id, session_id, user_id).await
}

pub async fn list_for_session_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    user_id: &str,
) -> Result<Vec<Model>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::UserId.eq(user_id))
        .all(conn)
        .await
        .map_err(db_err)
}

/// Removes every vote on the listed chats, which were just deleted.
pub async fn delete_for_sessions(
    org_id: &str,
    session_ids: &[String],
) -> Result<u64, errors::Error> {
    delete_for_sessions_with(get_orm_client_rw().await, org_id, session_ids).await
}

pub async fn delete_for_sessions_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_ids: &[String],
) -> Result<u64, errors::Error> {
    if session_ids.is_empty() {
        return Ok(0);
    }
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.is_in(session_ids.iter().map(String::as_str)))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
}

/// Remove the votes of chats whose index row is gone, in every org.
pub async fn purge_orphans() -> Result<u64, errors::Error> {
    purge_orphans_with(get_orm_client_rw().await).await
}

pub async fn purge_orphans_with<C: ConnectionTrait>(conn: &C) -> Result<u64, errors::Error> {
    let live = ai_chat_sessions::Entity::find()
        .select_only()
        .column(ai_chat_sessions::Column::SessionId)
        .into_query();
    let result = Entity::delete_many()
        .filter(Condition::all().add(Column::SessionId.not_in_subquery(live)))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
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
        let schema = Schema::new(backend);
        for stmt in [
            schema.create_table_from_entity(Entity),
            schema.create_table_from_entity(ai_chat_sessions::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        db
    }

    fn vote<'a>(user_id: &'a str, rating: &'a str, comment: Option<&'a str>) -> NewFeedback<'a> {
        NewFeedback {
            org_id: "o",
            session_id: "s",
            turn_id: "t",
            user_id,
            rating,
            comment,
        }
    }

    #[tokio::test]
    async fn one_vote_per_member_and_turn_the_latest_wins() {
        let db = db().await;
        upsert_with(&db, &vote("u1", RATING_UP, None), 1)
            .await
            .unwrap();
        upsert_with(&db, &vote("u1", RATING_DOWN, Some(" wrong stream ")), 2)
            .await
            .unwrap();
        upsert_with(&db, &vote("u2", RATING_UP, None), 3)
            .await
            .unwrap();
        let mine = list_for_session_with(&db, "o", "s", "u1").await.unwrap();
        assert_eq!(mine.len(), 1);
        assert_eq!(
            (mine[0].rating.as_str(), mine[0].comment.as_deref()),
            (RATING_DOWN, Some("wrong stream"))
        );
        assert_eq!((mine[0].created_at, mine[0].updated_at), (1, 2));
        assert_eq!(
            delete_for_sessions_with(&db, "o", &["s".to_string()])
                .await
                .unwrap(),
            2
        );
        assert!(
            list_for_session_with(&db, "o", "s", "u2")
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn votes_of_a_purged_chat_go_with_it() {
        let db = db().await;
        upsert_with(&db, &vote("u1", RATING_UP, None), 1)
            .await
            .unwrap();
        assert_eq!(purge_orphans_with(&db).await.unwrap(), 1);
    }
}
