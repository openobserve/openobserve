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

//! `ai_chat_imports`: browser-recorded chats moved to the server, once per member and `client_id`.

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, PaginatorTrait, QueryFilter, QuerySelect,
    QueryTrait, Set, SqlErr, TransactionTrait,
};

pub use super::entity::ai_chat_imports::Model;
use super::{
    ai_chat_sessions::{self, NewImport},
    entity::{ai_chat_imports::*, ai_chat_sessions as sessions},
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

/// Outcome of [`import_chat`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Imported {
    /// A new chat with this session id.
    Created(String),
    /// The member imported this `client_id` before, as this session id.
    Existing(String),
}

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
}

/// Creates the chat and its import row; a `client_id` whose chat still exists creates nothing.
pub async fn import_chat(
    chat: &NewImport<'_>,
    (client_id, origin): (&str, &str),
    turns: serde_json::Value,
    now: i64,
) -> Result<Imported, errors::Error> {
    import_chat_with(
        get_orm_client_rw().await,
        chat,
        (client_id, origin),
        turns,
        now,
    )
    .await
}

pub async fn import_chat_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    chat: &NewImport<'_>,
    (client_id, origin): (&str, &str),
    turns: serde_json::Value,
    now: i64,
) -> Result<Imported, errors::Error> {
    if let Some(existing) = find_with(conn, chat.org_id, chat.user_id, client_id).await? {
        let live = ai_chat_sessions::get_with(conn, chat.org_id, &existing.session_id)
            .await?
            .is_some_and(|row| row.status == ai_chat_sessions::STATUS_ACTIVE);
        if live {
            return Ok(Imported::Existing(existing.session_id));
        }
        // The member deleted that chat, so importing it again makes a new one.
        delete_for_sessions_with(conn, chat.org_id, &[existing.session_id]).await?;
    }
    let txn = conn.begin().await.map_err(db_err)?;
    let record = ActiveModel {
        org_id: Set(chat.org_id.to_string()),
        user_id: Set(chat.user_id.to_string()),
        client_id: Set(client_id.to_string()),
        session_id: Set(chat.session_id.to_string()),
        origin: Set(origin.to_string()),
        turns: Set(turns.to_string()),
        created_at: Set(now),
    };
    if let Err(e) = Entity::insert(record).exec_without_returning(&txn).await {
        drop(txn);
        return match e.sql_err() {
            // A concurrent import of the same chat won.
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                find_with(conn, chat.org_id, chat.user_id, client_id)
                    .await?
                    .map(|m| Imported::Existing(m.session_id))
                    .ok_or_else(|| db_err(e))
            }
            _ => Err(db_err(e)),
        };
    }
    ai_chat_sessions::insert_import_with(&txn, chat, now).await?;
    txn.commit().await.map_err(db_err)?;
    Ok(Imported::Created(chat.session_id.to_string()))
}

pub async fn find_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_id: &str,
    client_id: &str,
) -> Result<Option<Model>, errors::Error> {
    Entity::find_by_id((
        org_id.to_string(),
        user_id.to_string(),
        client_id.to_string(),
    ))
    .one(conn)
    .await
    .map_err(db_err)
}

/// The imported turns of a chat, when it was imported.
pub async fn turns_for_session(
    org_id: &str,
    session_id: &str,
) -> Result<Option<serde_json::Value>, errors::Error> {
    turns_for_session_with(get_orm_client_ro().await, org_id, session_id).await
}

pub async fn turns_for_session_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
) -> Result<Option<serde_json::Value>, errors::Error> {
    let row = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .one(conn)
        .await
        .map_err(db_err)?;
    row.map(|r| serde_json::from_str(&r.turns).map_err(db_err))
        .transpose()
}

/// Whether the chat began as an import.
pub async fn is_imported(org_id: &str, session_id: &str) -> Result<bool, errors::Error> {
    is_imported_with(get_orm_client_ro().await, org_id, session_id).await
}

pub async fn is_imported_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
) -> Result<bool, errors::Error> {
    let n = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .count(conn)
        .await
        .map_err(db_err)?;
    Ok(n > 0)
}

/// How many chats the org holds as imports, for its import quota.
pub async fn count_for_org(org_id: &str) -> Result<u64, errors::Error> {
    count_for_org_with(get_orm_client_ro().await, org_id).await
}

pub async fn count_for_org_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .count(conn)
        .await
        .map_err(db_err)
}

/// The imported transcript is content of the chat: it goes when the chat is deleted.
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
        .filter(Column::SessionId.is_in(session_ids.iter().cloned()))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
}

/// Remove the import rows of chats whose index row is gone, in every org.
pub async fn purge_orphans() -> Result<u64, errors::Error> {
    purge_orphans_with(get_orm_client_rw().await).await
}

pub async fn purge_orphans_with<C: ConnectionTrait>(conn: &C) -> Result<u64, errors::Error> {
    let live = sessions::Entity::find()
        .select_only()
        .column(sessions::Column::SessionId)
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
            schema.create_table_from_entity(sessions::Entity),
        ] {
            db.execute(backend.build(&stmt)).await.unwrap();
        }
        db
    }

    fn chat<'a>(session_id: &'a str, user_id: &'a str) -> NewImport<'a> {
        NewImport {
            org_id: "o",
            session_id,
            user_id,
            user_email: "a@x",
            agent_type: "o2-ai",
            title: "Imported",
            pinned: true,
            search_text: "Why 5xx?",
        }
    }

    #[tokio::test]
    async fn a_client_id_imports_once_per_member() {
        let db = db().await;
        let first = import_chat_with(
            &db,
            &chat("s1", "u1"),
            ("c1", "none"),
            serde_json::json!([]),
            5,
        )
        .await
        .unwrap();
        assert_eq!(first, Imported::Created("s1".into()));
        let again = import_chat_with(
            &db,
            &chat("s2", "u1"),
            ("c1", "none"),
            serde_json::json!([]),
            6,
        )
        .await
        .unwrap();
        assert_eq!(again, Imported::Existing("s1".into()));
        let other = import_chat_with(
            &db,
            &chat("s3", "u2"),
            ("c1", "none"),
            serde_json::json!([]),
            7,
        )
        .await
        .unwrap();
        assert_eq!(other, Imported::Created("s3".into()));
        let row = ai_chat_sessions::get_with(&db, "o", "s1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!((row.pinned, row.pinned_at), (true, Some(5)));
        assert_eq!(row.search_text.as_deref(), Some("why 5xx?"));
        assert!(
            ai_chat_sessions::get_with(&db, "o", "s2")
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            turns_for_session_with(&db, "o", "s1").await.unwrap(),
            Some(serde_json::json!([]))
        );
    }

    #[tokio::test]
    async fn a_deleted_chat_loses_its_transcript_and_imports_again() {
        let db = db().await;
        let first = import_chat_with(
            &db,
            &chat("s1", "u1"),
            ("c1", "none"),
            serde_json::json!([1]),
            5,
        )
        .await
        .unwrap();
        assert_eq!(first, Imported::Created("s1".into()));
        assert_eq!(count_for_org_with(&db, "o").await.unwrap(), 1);
        assert!(is_imported_with(&db, "o", "s1").await.unwrap());
        assert!(!is_imported_with(&db, "o", "s9").await.unwrap());
        ai_chat_sessions::mark_deleted_with(&db, "o", "s1", "u1", 6)
            .await
            .unwrap();
        let again = import_chat_with(
            &db,
            &chat("s2", "u1"),
            ("c1", "none"),
            serde_json::json!([2]),
            7,
        )
        .await
        .unwrap();
        assert_eq!(again, Imported::Created("s2".into()));
        assert_eq!(turns_for_session_with(&db, "o", "s1").await.unwrap(), None);
        assert_eq!(
            delete_for_sessions_with(&db, "o", &["s2".to_string()])
                .await
                .unwrap(),
            1
        );
        assert_eq!(count_for_org_with(&db, "o").await.unwrap(), 0);
        import_chat_with(
            &db,
            &chat("s3", "u1"),
            ("c3", "none"),
            serde_json::json!([]),
            8,
        )
        .await
        .unwrap();
        sessions::Entity::delete_many().exec(&db).await.unwrap();
        assert_eq!(purge_orphans_with(&db).await.unwrap(), 1);
    }
}
