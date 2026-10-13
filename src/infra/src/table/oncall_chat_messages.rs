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

//! Chat message rows of a page: room posts, DMs and fallback markers.

use config::meta::oncall::{ChatMessage, ChatMessageKind, ChatMessageStatus, ChatPlatform};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, TransactionTrait,
};

use super::entity::oncall_chat_messages::{Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors};

/// Inserts the row or replaces the row with its id; a unique-key clash errors. [strong]
pub async fn put(message: &ChatMessage) -> Result<(), errors::Error> {
    put_in(get_orm_client_rw().await, message).await
}

/// A page's message rows, oldest first. [strong]
pub async fn list_for_response(response_id: &str) -> Result<Vec<ChatMessage>, errors::Error> {
    list_for_response_in(get_orm_client_rw().await, response_id).await
}

/// Removes a page's message rows in one statement and returns how many went. [strong]
pub async fn delete_for_response(response_id: &str) -> Result<u64, errors::Error> {
    delete_for_response_in(get_orm_client_rw().await, response_id).await
}

/// Reads a row back into the meta type; a discriminant this build cannot read is an error.
fn to_message(m: Model) -> Result<ChatMessage, errors::Error> {
    let unreadable = |what: &str, v: i32| {
        errors::Error::Message(format!("oncall_chat_messages {}: unknown {what} {v}", m.id))
    };
    let platform =
        ChatPlatform::from_i32(m.platform).ok_or_else(|| unreadable("platform", m.platform))?;
    let kind = ChatMessageKind::from_i32(m.kind).ok_or_else(|| unreadable("kind", m.kind))?;
    let status =
        ChatMessageStatus::from_i32(m.status).ok_or_else(|| unreadable("status", m.status))?;
    Ok(ChatMessage {
        id: m.id,
        org_id: m.org_id,
        response_id: m.response_id,
        team_id: m.team_id,
        ladder_run: m.ladder_run,
        platform,
        workspace_id: m.workspace_id,
        channel_id: m.channel_id,
        message_ts: m.message_ts,
        permalink: m.permalink,
        kind,
        recipient: m.recipient,
        status,
        rendered: m.rendered,
        created_at: m.created_at,
        updated_at: m.updated_at,
    })
}

/// Maps the meta type onto a row.
fn to_model(message: &ChatMessage) -> Model {
    Model {
        id: message.id.clone(),
        org_id: message.org_id.clone(),
        response_id: message.response_id.clone(),
        team_id: message.team_id.clone(),
        ladder_run: message.ladder_run,
        platform: message.platform.to_i32(),
        workspace_id: message.workspace_id.clone(),
        channel_id: message.channel_id.clone(),
        message_ts: message.message_ts.clone(),
        permalink: message.permalink.clone(),
        kind: message.kind.to_i32(),
        recipient: message.recipient.clone(),
        status: message.status.to_i32(),
        rendered: message.rendered.clone(),
        created_at: message.created_at,
        updated_at: message.updated_at,
    }
}

/// [`put`] against a caller-supplied connection.
async fn put_in<C: TransactionTrait>(conn: &C, message: &ChatMessage) -> Result<(), errors::Error> {
    // UPDATE first, not ON CONFLICT: MySQL's upsert fires on any unique key, overwriting the clash.
    let model = to_model(message).into_active_model().reset_all();
    let txn = conn.begin().await?;
    let updated = Entity::update_many()
        .set(model.clone())
        .filter(Column::Id.eq(&message.id))
        .exec(&txn)
        .await?
        .rows_affected;
    // sqlx connects MySQL with FOUND_ROWS, so an unchanged row still counts as matched.
    if updated == 0 {
        model.insert(&txn).await?;
    }
    txn.commit().await?;
    Ok(())
}

/// [`list_for_response`] against a caller-supplied connection.
async fn list_for_response_in<C: ConnectionTrait>(
    conn: &C,
    response_id: &str,
) -> Result<Vec<ChatMessage>, errors::Error> {
    Entity::find()
        .filter(Column::ResponseId.eq(response_id))
        .order_by_asc(Column::CreatedAt)
        .order_by_asc(Column::Id)
        .all(conn)
        .await?
        .into_iter()
        .map(to_message)
        .collect()
}

/// [`delete_for_response`] against a caller-supplied connection.
async fn delete_for_response_in<C: ConnectionTrait>(
    conn: &C,
    response_id: &str,
) -> Result<u64, errors::Error> {
    let deleted = Entity::delete_many()
        .filter(Column::ResponseId.eq(response_id))
        .exec(conn)
        .await?;
    Ok(deleted.rows_affected)
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection};

    use super::*;

    /// One connection, not a pool: two connections to `sqlite::memory:` are two databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        crate::table::migration::create_oncall_chat_tables_for_test(&db)
            .await
            .unwrap();
        db
    }

    fn message(id: &str, response_id: &str, created_at: i64) -> ChatMessage {
        ChatMessage {
            id: id.into(),
            org_id: "acme".into(),
            response_id: response_id.into(),
            team_id: "team_1".into(),
            ladder_run: 1,
            platform: ChatPlatform::Slack,
            workspace_id: "T1".into(),
            channel_id: "C1".into(),
            message_ts: None,
            permalink: None,
            kind: ChatMessageKind::Room,
            recipient: None,
            status: ChatMessageStatus::Queued,
            rendered: "[]".into(),
            created_at,
            updated_at: created_at,
        }
    }

    #[tokio::test]
    async fn test_put_list_and_delete_round_trip() {
        let db = db().await;
        let room = message("m2", "r1", 200);
        let dm = ChatMessage {
            kind: ChatMessageKind::Dm,
            channel_id: "D1".into(),
            recipient: Some("ana@o2.ai".into()),
            ..message("m1", "r1", 100)
        };
        put_in(&db, &room).await.unwrap();
        put_in(&db, &dm).await.unwrap();
        put_in(&db, &message("m3", "r2", 50)).await.unwrap();
        let sent = ChatMessage {
            message_ts: Some("1700000000.000100".into()),
            permalink: Some("https://acme.slack.com/archives/C1/p1700000000000100".into()),
            status: ChatMessageStatus::Sent,
            updated_at: 300,
            ..room
        };
        put_in(&db, &sent).await.unwrap();

        assert_eq!(
            list_for_response_in(&db, "r1").await.unwrap(),
            vec![dm, sent.clone()]
        );
        assert!(
            put_in(
                &db,
                &ChatMessage {
                    id: "m4".into(),
                    ..sent
                }
            )
            .await
            .is_err(),
            "one row per posted message"
        );

        assert_eq!(delete_for_response_in(&db, "r1").await.unwrap(), 2);
        assert!(list_for_response_in(&db, "r1").await.unwrap().is_empty());
        assert_eq!(list_for_response_in(&db, "r2").await.unwrap().len(), 1);
    }
}
