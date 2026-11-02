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

//! A page's Slack message rows: room posts, DMs and the fallback marker (C8).

use config::meta::oncall::chat::{ChatMessage, ChatMessageKind, ChatMessageStatus};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, QuerySelect, TransactionTrait,
};

use super::entity::oncall_chat_messages::{Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors};

/// Inserts the row or replaces the row with its id; a second row for one posted message errors.
/// [strong]
pub async fn put(message: &ChatMessage) -> Result<(), errors::Error> {
    put_in(get_orm_client_rw().await, message).await
}

/// A page's message rows, oldest first. [strong] (reads)
pub async fn list_for_response(response_id: &str) -> Result<Vec<ChatMessage>, errors::Error> {
    list_for_response_in(get_orm_client_rw().await, response_id).await
}

/// One person's DM rows on an installation, newest first, at most `limit` (DM-7).
/// [strong] (reads)
pub async fn recent_dms(
    org_id: &str,
    installation_id: &str,
    recipient: &str,
    limit: u64,
) -> Result<Vec<ChatMessage>, errors::Error> {
    let conn = get_orm_client_rw().await;
    recent_dms_in(conn, org_id, installation_id, recipient, limit).await
}

/// A team's newest row of `kind` (and `status`, when given) across its pages (RO-2).
/// [strong] (reads)
pub async fn newest_of_team(
    org_id: &str,
    team_id: &str,
    kind: ChatMessageKind,
    status: Option<ChatMessageStatus>,
) -> Result<Option<ChatMessage>, errors::Error> {
    newest_of_team_in(get_orm_client_rw().await, org_id, team_id, kind, status).await
}

/// Reads a row back into the meta type; a kind or status this build cannot read is an error.
fn to_message(m: Model) -> Result<ChatMessage, errors::Error> {
    let unreadable = |what: &str, v: i32| {
        errors::Error::Message(format!("oncall_chat_messages {}: unknown {what} {v}", m.id))
    };
    let kind = ChatMessageKind::from_i32(m.kind).ok_or_else(|| unreadable("kind", m.kind))?;
    let status =
        ChatMessageStatus::from_i32(m.status).ok_or_else(|| unreadable("status", m.status))?;
    Ok(ChatMessage {
        id: m.id,
        org_id: m.org_id,
        response_id: m.response_id,
        team_id: m.team_id,
        ladder_run: m.ladder_run,
        installation_id: m.installation_id,
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

fn to_model(message: &ChatMessage) -> Model {
    Model {
        id: message.id.clone(),
        org_id: message.org_id.clone(),
        response_id: message.response_id.clone(),
        team_id: message.team_id.clone(),
        ladder_run: message.ladder_run,
        installation_id: message.installation_id.clone(),
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

async fn newest_of_team_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    team_id: &str,
    kind: ChatMessageKind,
    status: Option<ChatMessageStatus>,
) -> Result<Option<ChatMessage>, errors::Error> {
    let mut query = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::TeamId.eq(team_id))
        .filter(Column::Kind.eq(kind.to_i32()));
    if let Some(status) = status {
        query = query.filter(Column::Status.eq(status.to_i32()));
    }
    query
        .order_by_desc(Column::CreatedAt)
        .order_by_desc(Column::Id)
        .one(conn)
        .await?
        .map(to_message)
        .transpose()
}

async fn recent_dms_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    installation_id: &str,
    recipient: &str,
    limit: u64,
) -> Result<Vec<ChatMessage>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::InstallationId.eq(installation_id))
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

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection};

    use super::*;

    /// One connection, not a pool: two connections to `sqlite::memory:` are two databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        crate::table::migration::create_oncall_chat_messages_for_test(&db)
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
            installation_id: "inst_1".into(),
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

    /// C8: rows round-trip, update in place by id, and list per page.
    #[tokio::test]
    async fn test_put_and_list_round_trip() {
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
        assert_eq!(list_for_response_in(&db, "r2").await.unwrap().len(), 1);
    }

    /// C8 [strong]: a second row for the same posted message is refused and changes nothing.
    #[tokio::test]
    async fn test_one_row_per_posted_message() {
        let db = db().await;
        let sent = ChatMessage {
            message_ts: Some("1700000000.000100".into()),
            status: ChatMessageStatus::Sent,
            ..message("m1", "r1", 100)
        };
        put_in(&db, &sent).await.unwrap();
        let clash = ChatMessage {
            id: "m2".into(),
            ..sent.clone()
        };
        assert!(put_in(&db, &clash).await.is_err());
        let other_installation = ChatMessage {
            id: "m3".into(),
            installation_id: "inst_2".into(),
            ..sent.clone()
        };
        put_in(&db, &other_installation).await.unwrap();
        assert_eq!(
            list_for_response_in(&db, "r1").await.unwrap(),
            vec![sent, other_installation]
        );
    }

    /// DM-7: a person's newest DM rows on one installation first, at most `limit`.
    #[tokio::test]
    async fn test_recent_dms_lists_one_persons_newest_dm_rows_first() {
        let db = db().await;
        let dm = |id: &str, created_at: i64, recipient: &str| ChatMessage {
            kind: ChatMessageKind::Dm,
            recipient: Some(recipient.into()),
            ..message(id, "r1", created_at)
        };
        let other_installation = ChatMessage {
            installation_id: "inst_2".into(),
            ..dm("m5", 500, "ana@o2.ai")
        };
        let rows = [
            dm("m1", 100, "ana@o2.ai"),
            dm("m2", 200, "ana@o2.ai"),
            dm("m3", 300, "ana@o2.ai"),
            dm("m4", 400, "bob@o2.ai"),
            other_installation,
            message("m6", "r1", 600),
        ];
        for row in &rows {
            put_in(&db, row).await.unwrap();
        }
        let found = recent_dms_in(&db, "acme", "inst_1", "ana@o2.ai", 2)
            .await
            .unwrap();
        let ids: Vec<String> = found.into_iter().map(|m| m.id).collect();
        assert_eq!(ids, vec!["m3", "m2"]);
    }

    /// A stored kind or status this build cannot read is an error, not a guess.
    #[tokio::test]
    async fn test_an_unknown_stored_kind_is_an_error() {
        let db = db().await;
        put_in(&db, &message("m1", "r1", 100)).await.unwrap();
        db.execute_unprepared("UPDATE oncall_chat_messages SET kind = 9")
            .await
            .unwrap();
        assert!(list_for_response_in(&db, "r1").await.is_err());
    }

    /// RO-2: a team's newest row of a kind across its pages, sent rows only for room posts.
    #[tokio::test]
    async fn test_newest_of_team_reads_across_pages() {
        let db = db().await;
        let sent = |id: &str, page: &str, at: i64| ChatMessage {
            status: ChatMessageStatus::Sent,
            message_ts: Some(format!("{at}.0")),
            ..message(id, page, at)
        };
        let fallback = ChatMessage {
            kind: ChatMessageKind::Fallback,
            status: ChatMessageStatus::Sent,
            ..message("f1", "r2", 250)
        };
        let other_team = ChatMessage {
            team_id: "team_2".into(),
            ..sent("m9", "r3", 900)
        };
        for row in [
            sent("m1", "r1", 100),
            sent("m2", "r2", 300),
            message("m3", "r2", 400),
            fallback.clone(),
            other_team,
        ] {
            put_in(&db, &row).await.unwrap();
        }
        let room = newest_of_team_in(
            &db,
            "acme",
            "team_1",
            ChatMessageKind::Room,
            Some(ChatMessageStatus::Sent),
        )
        .await
        .unwrap();
        assert_eq!(room.map(|r| r.id).as_deref(), Some("m2"));
        let marker = newest_of_team_in(&db, "acme", "team_1", ChatMessageKind::Fallback, None)
            .await
            .unwrap();
        assert_eq!(marker, Some(fallback));
    }
}
