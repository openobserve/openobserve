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

//! Service layer for `ai_chat_shares`, links that let others read a persisted AI chat.

use base64::Engine;
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set,
    sea_query::{Expr, Query},
};

pub use super::entity::ai_chat_shares::Model;
use super::entity::{ai_chat_sessions, ai_chat_shares::*};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

pub const MODE_SNAPSHOT: &str = "snapshot";
pub const MODE_LIVE: &str = "live";
pub const VISIBILITY_ORG: &str = "org";
pub const VISIBILITY_PUBLIC: &str = "public";
/// Length of a share token: 16 random bytes, URL-safe base64 without padding.
pub const TOKEN_LEN: usize = 22;

/// Everything a new share needs; ids, counters and timestamps are filled in.
#[derive(Debug, Clone)]
pub struct NewShare<'a> {
    pub org_id: &'a str,
    pub session_id: &'a str,
    pub created_by: &'a str,
    pub mode: &'a str,
    pub snapshot_seq: Option<i64>,
    pub visibility: &'a str,
    pub expires_at: Option<i64>,
}

/// The settings an owner may change on a share; all three are written as given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShareSettings {
    pub mode: String,
    pub snapshot_seq: Option<i64>,
    pub expires_at: Option<i64>,
}

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
}

/// A fresh, unguessable share token (128 random bits).
pub fn generate_token() -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(config::utils::rand::random_bytes(TOKEN_LEN * 6 / 8))
}

/// Whether `token` has the shape [`generate_token`] produces, so a malformed one skips the lookup.
pub fn is_valid_token(token: &str) -> bool {
    token.len() == TOKEN_LEN
        && token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The share's own half of "active": not revoked and not expired at `now`.
pub fn is_live(share: &Model, now: i64) -> bool {
    share.revoked_at.is_none() && share.expires_at.is_none_or(|at| at > now)
}

/// The last committed seq the share shows, given its chat's current watermark.
pub fn visible_seq(share: &Model, chat_last_committed_seq: i64) -> i64 {
    match share.snapshot_seq {
        Some(seq) if share.mode == MODE_SNAPSHOT => seq.min(chat_last_committed_seq),
        _ => chat_last_committed_seq,
    }
}

fn not_revoked_or_expired(now: i64) -> Condition {
    Condition::all().add(Column::RevokedAt.is_null()).add(
        Condition::any()
            .add(Column::ExpiresAt.is_null())
            .add(Column::ExpiresAt.gt(now)),
    )
}

pub async fn insert(share: &NewShare<'_>, now: i64) -> Result<Model, errors::Error> {
    insert_with(get_orm_client_rw().await, share, now).await
}

pub async fn insert_with<C: ConnectionTrait>(
    conn: &C,
    share: &NewShare<'_>,
    now: i64,
) -> Result<Model, errors::Error> {
    let id = config::ider::uuid();
    let record = ActiveModel {
        id: Set(id.clone()),
        org_id: Set(share.org_id.to_string()),
        session_id: Set(share.session_id.to_string()),
        created_by: Set(share.created_by.to_string()),
        token: Set(generate_token()),
        mode: Set(share.mode.to_string()),
        snapshot_seq: Set(share.snapshot_seq),
        visibility: Set(share.visibility.to_string()),
        expires_at: Set(share.expires_at),
        revoked_at: Set(None),
        access_count: Set(0),
        last_accessed_at: Set(None),
        created_at: Set(now),
        updated_at: Set(now),
    };
    Entity::insert(record).exec(conn).await.map_err(db_err)?;
    get_with(conn, share.org_id, &id)
        .await?
        .ok_or_else(|| errors::Error::Message("ai_chat_shares row vanished after insert".into()))
}

pub async fn get(org_id: &str, id: &str) -> Result<Option<Model>, errors::Error> {
    get_with(get_orm_client_ro().await, org_id, id).await
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Model>, errors::Error> {
    Entity::find_by_id(id.to_string())
        .filter(Column::OrgId.eq(org_id))
        .one(conn)
        .await
        .map_err(db_err)
}

/// The share holding `token`, in any org and state; the caller decides whether to serve it.
pub async fn get_by_token(token: &str) -> Result<Option<Model>, errors::Error> {
    get_by_token_with(get_orm_client_ro().await, token).await
}

pub async fn get_by_token_with<C: ConnectionTrait>(
    conn: &C,
    token: &str,
) -> Result<Option<Model>, errors::Error> {
    Entity::find()
        .filter(Column::Token.eq(token))
        .one(conn)
        .await
        .map_err(db_err)
}

/// Unrevoked, unexpired shares of one chat, newest first.
pub async fn list_live_for_session(
    org_id: &str,
    session_id: &str,
    now: i64,
) -> Result<Vec<Model>, errors::Error> {
    list_live_for_session_with(get_orm_client_ro().await, org_id, session_id, now).await
}

pub async fn list_live_for_session_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    now: i64,
) -> Result<Vec<Model>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(not_revoked_or_expired(now))
        .order_by_desc(Column::CreatedAt)
        .all(conn)
        .await
        .map_err(db_err)
}

/// Unrevoked, unexpired shares `created_by` made in `org_id`, newest first.
pub async fn list_live_for_creator(
    org_id: &str,
    created_by: &str,
    now: i64,
) -> Result<Vec<Model>, errors::Error> {
    list_live_for_creator_with(get_orm_client_ro().await, org_id, created_by, now).await
}

pub async fn list_live_for_creator_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    created_by: &str,
    now: i64,
) -> Result<Vec<Model>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::CreatedBy.eq(created_by))
        .filter(not_revoked_or_expired(now))
        .order_by_desc(Column::CreatedAt)
        .all(conn)
        .await
        .map_err(db_err)
}

/// Write `settings` to an unrevoked share. Returns `false` when there is none.
pub async fn update(
    org_id: &str,
    id: &str,
    settings: &ShareSettings,
    now: i64,
) -> Result<bool, errors::Error> {
    update_with(get_orm_client_rw().await, org_id, id, settings, now).await
}

pub async fn update_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    settings: &ShareSettings,
    now: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::Mode, Expr::value(settings.mode.clone()))
        .col_expr(Column::SnapshotSeq, Expr::value(settings.snapshot_seq))
        .col_expr(Column::ExpiresAt, Expr::value(settings.expires_at))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::RevokedAt.is_null())
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// Revoke one share. Returns `false` when it does not exist or already was.
pub async fn revoke(org_id: &str, id: &str, now: i64) -> Result<bool, errors::Error> {
    revoke_with(get_orm_client_rw().await, org_id, id, now).await
}

pub async fn revoke_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::RevokedAt, Expr::value(Some(now)))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::RevokedAt.is_null())
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// Revoke every share of the given chats (they were deleted); returns how many.
pub async fn revoke_for_sessions(
    org_id: &str,
    session_ids: &[String],
    now: i64,
) -> Result<u64, errors::Error> {
    revoke_for_sessions_with(get_orm_client_rw().await, org_id, session_ids, now).await
}

pub async fn revoke_for_sessions_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_ids: &[String],
    now: i64,
) -> Result<u64, errors::Error> {
    let mut revoked = 0;
    for chunk in session_ids.chunks(500) {
        revoked += Entity::update_many()
            .col_expr(Column::RevokedAt, Expr::value(Some(now)))
            .col_expr(Column::UpdatedAt, Expr::value(now))
            .filter(Column::OrgId.eq(org_id))
            .filter(Column::SessionId.is_in(chunk.iter().cloned()))
            .filter(Column::RevokedAt.is_null())
            .exec(conn)
            .await
            .map_err(db_err)?
            .rows_affected;
    }
    Ok(revoked)
}

/// Count one read of a share.
pub async fn record_access(id: &str, now: i64) -> Result<(), errors::Error> {
    record_access_with(get_orm_client_rw().await, id, now).await
}

pub async fn record_access_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    now: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(
            Column::AccessCount,
            Expr::col(Column::AccessCount).add(1i64),
        )
        .col_expr(Column::LastAccessedAt, Expr::value(Some(now)))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Remove the shares of `org_id` whose chat row the retention sweep removed; returns how many.
pub async fn purge_orphans(org_id: &str) -> Result<u64, errors::Error> {
    purge_orphans_with(get_orm_client_rw().await, org_id).await
}

pub async fn purge_orphans_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    let chats = Query::select()
        .column(ai_chat_sessions::Column::SessionId)
        .from(ai_chat_sessions::Entity)
        .and_where(ai_chat_sessions::Column::OrgId.eq(org_id))
        .to_owned();
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.not_in_subquery(chats))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn db() -> sea_orm::DatabaseConnection {
        use sea_orm::{Database, Schema};

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

    const ORG: &str = "org";
    const SID: &str = "01234567-89ab-7def-8123-456789abcdef";
    const ALICE: &str = "2Q8vXqYk1W0r8aLiceUserId000";

    fn new_share<'a>(mode: &'a str, expires_at: Option<i64>) -> NewShare<'a> {
        NewShare {
            org_id: ORG,
            session_id: SID,
            created_by: ALICE,
            mode,
            snapshot_seq: (mode == MODE_SNAPSHOT).then_some(4),
            visibility: VISIBILITY_ORG,
            expires_at,
        }
    }

    #[test]
    fn tokens_are_url_safe_unique_and_recognized() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), TOKEN_LEN);
        assert_ne!(a, b);
        assert!(is_valid_token(&a));
        assert!(!is_valid_token("short"));
        assert!(!is_valid_token(&format!("{}=", &a[..TOKEN_LEN - 1])));
        assert!(!is_valid_token(&"/".repeat(TOKEN_LEN)));
    }

    fn share(mode: &str, snapshot_seq: Option<i64>) -> Model {
        Model {
            id: "id".into(),
            org_id: ORG.into(),
            session_id: SID.into(),
            created_by: ALICE.into(),
            token: generate_token(),
            mode: mode.into(),
            snapshot_seq,
            visibility: VISIBILITY_ORG.into(),
            expires_at: None,
            revoked_at: None,
            access_count: 0,
            last_accessed_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn a_share_is_live_until_revoked_or_expired() {
        let mut s = share(MODE_LIVE, None);
        assert!(is_live(&s, 100));
        s.expires_at = Some(100);
        assert!(!is_live(&s, 100));
        assert!(is_live(&s, 99));
        s.expires_at = None;
        s.revoked_at = Some(50);
        assert!(!is_live(&s, 10));
    }

    #[test]
    fn a_snapshot_is_cut_at_its_seq_and_live_follows_the_chat() {
        assert_eq!(visible_seq(&share(MODE_SNAPSHOT, Some(4)), 9), 4);
        assert_eq!(visible_seq(&share(MODE_LIVE, None), 9), 9);
        // Never past what the chat has committed.
        assert_eq!(visible_seq(&share(MODE_SNAPSHOT, Some(12)), 9), 9);
    }

    #[tokio::test]
    async fn listing_shows_only_live_shares_and_updates_skip_revoked_ones() {
        let db = db().await;
        let live = insert_with(&db, &new_share(MODE_LIVE, None), 10)
            .await
            .unwrap();
        let snap = insert_with(&db, &new_share(MODE_SNAPSHOT, Some(500)), 11)
            .await
            .unwrap();
        let expired = insert_with(&db, &new_share(MODE_LIVE, Some(50)), 12)
            .await
            .unwrap();
        assert_eq!(snap.snapshot_seq, Some(4));
        assert_eq!(snap.access_count, 0);
        assert!(
            get_with(&db, "other-org", &live.id)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            get_by_token_with(&db, &live.token)
                .await
                .unwrap()
                .unwrap()
                .id,
            live.id
        );

        let ids = |rows: Vec<Model>| rows.into_iter().map(|r| r.id).collect::<Vec<_>>();
        assert_eq!(
            ids(list_live_for_session_with(&db, ORG, SID, 100)
                .await
                .unwrap()),
            vec![snap.id.clone(), live.id.clone()]
        );
        assert_eq!(
            ids(list_live_for_creator_with(&db, ORG, ALICE, 40)
                .await
                .unwrap()),
            vec![expired.id.clone(), snap.id.clone(), live.id.clone()]
        );

        let settings = ShareSettings {
            mode: MODE_SNAPSHOT.into(),
            snapshot_seq: Some(7),
            expires_at: None,
        };
        assert!(
            update_with(&db, ORG, &live.id, &settings, 20)
                .await
                .unwrap()
        );
        let row = get_with(&db, ORG, &live.id).await.unwrap().unwrap();
        assert_eq!(
            (row.mode.as_str(), row.snapshot_seq),
            (MODE_SNAPSHOT, Some(7))
        );

        assert!(revoke_with(&db, ORG, &live.id, 30).await.unwrap());
        assert!(!revoke_with(&db, ORG, &live.id, 31).await.unwrap());
        assert!(
            !update_with(&db, ORG, &live.id, &settings, 32)
                .await
                .unwrap()
        );
        assert_eq!(
            ids(list_live_for_session_with(&db, ORG, SID, 100)
                .await
                .unwrap()),
            vec![snap.id.clone()]
        );
    }

    #[tokio::test]
    async fn deleting_chats_revokes_their_shares_and_orphans_are_purged() {
        let db = db().await;
        crate::table::ai_chat_sessions::get_or_create_with(&db, ORG, SID, ALICE, "a@x", "o2", 1)
            .await
            .unwrap();
        let kept = insert_with(&db, &new_share(MODE_LIVE, None), 10)
            .await
            .unwrap();
        let mut orphan = new_share(MODE_LIVE, None);
        orphan.session_id = "gone";
        let orphan = insert_with(&db, &orphan, 11).await.unwrap();

        assert_eq!(
            revoke_for_sessions_with(&db, ORG, &[SID.to_string()], 20)
                .await
                .unwrap(),
            1
        );
        let row = get_with(&db, ORG, &kept.id).await.unwrap().unwrap();
        assert_eq!(row.revoked_at, Some(20));

        assert_eq!(purge_orphans_with(&db, ORG).await.unwrap(), 1);
        assert!(get_with(&db, ORG, &orphan.id).await.unwrap().is_none());
        assert!(get_with(&db, ORG, &kept.id).await.unwrap().is_some());
    }

    #[tokio::test]
    async fn reads_are_counted() {
        let db = db().await;
        let s = insert_with(&db, &new_share(MODE_LIVE, None), 10)
            .await
            .unwrap();
        record_access_with(&db, &s.id, 20).await.unwrap();
        record_access_with(&db, &s.id, 30).await.unwrap();
        let row = get_with(&db, ORG, &s.id).await.unwrap().unwrap();
        assert_eq!((row.access_count, row.last_accessed_at), (2, Some(30)));
    }
}
