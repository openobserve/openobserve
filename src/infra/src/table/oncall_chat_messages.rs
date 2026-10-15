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
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, EntityTrait, IntoActiveModel,
    QueryFilter, QueryOrder, QuerySelect, TransactionTrait,
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

/// One person's DM rows in an org's workspace, newest first, at most `limit`. [strong]
pub async fn recent_dms(
    org_id: &str,
    platform: ChatPlatform,
    workspace_id: &str,
    recipient: &str,
    limit: u64,
) -> Result<Vec<ChatMessage>, errors::Error> {
    let conn = get_orm_client_rw().await;
    recent_dms_in(conn, org_id, platform, workspace_id, recipient, limit).await
}

/// Removes a page's message rows in one statement and returns how many went. [strong]
pub async fn delete_for_response(response_id: &str) -> Result<u64, errors::Error> {
    delete_for_response_in(get_orm_client_rw().await, response_id).await
}

/// Applies a replicated message row unless a stored row sharing a key is as new (FL-3). [strong]
pub async fn put_replica(message: &ChatMessage) -> Result<(), errors::Error> {
    put_replica_in(get_orm_client_rw().await, message).await
}

/// Rows sharing the id or the posted message with `message`; an unposted row has no message key.
fn clashes(message: &ChatMessage) -> Condition {
    let same_id = Condition::any().add(Column::Id.eq(&message.id));
    let Some(ts) = &message.message_ts else {
        return same_id;
    };
    same_id.add(
        Condition::all()
            .add(Column::Platform.eq(message.platform.to_i32()))
            .add(Column::ChannelId.eq(&message.channel_id))
            .add(Column::MessageTs.eq(ts)),
    )
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

/// [`recent_dms`] against a caller-supplied connection.
async fn recent_dms_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    platform: ChatPlatform,
    workspace_id: &str,
    recipient: &str,
    limit: u64,
) -> Result<Vec<ChatMessage>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Platform.eq(platform.to_i32()))
        .filter(Column::WorkspaceId.eq(workspace_id))
        .filter(Column::Kind.eq(ChatMessageKind::Dm.to_i32()))
        .filter(Column::Recipient.eq(recipient))
        .order_by_desc(Column::CreatedAt)
        .order_by_desc(Column::Id)
        .limit(limit)
        .all(conn)
        .await?
        .into_iter()
        .map(to_message)
        .collect()
}

/// [`put_replica`] against a caller-supplied connection.
async fn put_replica_in<C: TransactionTrait>(
    conn: &C,
    message: &ChatMessage,
) -> Result<(), errors::Error> {
    let txn = conn.begin().await?;
    let stored = Entity::find().filter(clashes(message)).all(&txn).await?;
    // A tie loses too, so a replayed Put is a no-op and two regions never swap rows.
    if stored.iter().all(|m| m.updated_at < message.updated_at) {
        Entity::delete_many()
            .filter(clashes(message))
            .exec(&txn)
            .await?;
        to_model(message)
            .into_active_model()
            .reset_all()
            .insert(&txn)
            .await?;
    }
    txn.commit().await?;
    Ok(())
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
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, Statement};

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

    /// DM-8: a person's newest DM rows in one org's workspace first, at most `limit`.
    #[tokio::test]
    async fn test_recent_dms_lists_one_persons_newest_dm_rows_first() {
        let db = db().await;
        let dm = |id: &str, created_at: i64, recipient: &str| ChatMessage {
            kind: ChatMessageKind::Dm,
            channel_id: recipient.into(),
            recipient: Some(recipient.into()),
            ..message(id, "r1", created_at)
        };
        let other_workspace = ChatMessage {
            workspace_id: "T2".into(),
            ..dm("m5", 500, "U1")
        };
        let rows = [
            dm("m1", 100, "U1"),
            dm("m2", 200, "U1"),
            dm("m3", 300, "U1"),
            dm("m4", 400, "U2"),
            other_workspace,
            message("m6", "r1", 600),
        ];
        for row in &rows {
            put_in(&db, row).await.unwrap();
        }
        let ids = |found: Vec<ChatMessage>| found.into_iter().map(|m| m.id).collect::<Vec<_>>();
        let found = recent_dms_in(&db, "acme", ChatPlatform::Slack, "T1", "U1", 2)
            .await
            .unwrap();
        assert_eq!(ids(found), vec!["m3", "m2"]);
    }

    /// FL-3: in either arrival order, two regions keep the newer of two clashing rows.
    #[tokio::test]
    async fn test_two_regions_converge_on_the_newer_message_row() {
        let posted = |id: &str, updated_at: i64| ChatMessage {
            message_ts: Some("1700000000.000100".into()),
            status: ChatMessageStatus::Sent,
            updated_at,
            ..message(id, "r1", 100)
        };
        let older = posted("m1", 150);
        let same_post = posted("m2", 200);
        let done = ChatMessage {
            status: ChatMessageStatus::Done,
            ..posted("m1", 200)
        };
        for newer in [same_post, done] {
            for order in [[&older, &newer], [&newer, &older]] {
                let db = db().await;
                for put in order {
                    put_replica_in(&db, put).await.unwrap();
                }
                assert_eq!(
                    list_for_response_in(&db, "r1").await.unwrap(),
                    vec![newer.clone()],
                    "{}",
                    newer.id
                );
            }
        }
    }

    /// Unposted rows have no message key, so two queued DMs of one page never clash.
    #[tokio::test]
    async fn test_unposted_rows_only_clash_on_their_id() {
        let db = db().await;
        let first = message("m1", "r1", 100);
        let second = message("m2", "r1", 100);
        put_replica_in(&db, &first).await.unwrap();
        put_replica_in(&db, &second).await.unwrap();

        assert_eq!(
            list_for_response_in(&db, "r1").await.unwrap(),
            vec![first, second]
        );
    }

    /// Every later insert into the table aborts, as a lost connection would.
    async fn fail_inserts(db: &DatabaseConnection) {
        db.execute(Statement::from_string(
            db.get_database_backend(),
            "CREATE TRIGGER fail_insert BEFORE INSERT ON oncall_chat_messages \
             BEGIN SELECT RAISE(ABORT, 'forced'); END"
                .to_string(),
        ))
        .await
        .unwrap();
    }

    /// A replica Put whose insert fails after its delete leaves the clashing row in place.
    #[tokio::test]
    async fn test_a_failed_replica_put_leaves_the_table() {
        let db = db().await;
        let posted = |id: &str, updated_at: i64| ChatMessage {
            message_ts: Some("1700000000.000100".into()),
            updated_at,
            ..message(id, "r1", 100)
        };
        put_in(&db, &posted("m1", 100)).await.unwrap();
        let before = list_for_response_in(&db, "r1").await.unwrap();
        fail_inserts(&db).await;

        assert!(put_replica_in(&db, &posted("m2", 200)).await.is_err());

        assert_eq!(list_for_response_in(&db, "r1").await.unwrap(), before);
    }
}
