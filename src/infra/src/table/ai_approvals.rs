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

//! Service layer for `ai_approvals`: approval cards and decisions every replica reads.

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set,
    sea_query::{Expr, OnConflict},
};

pub use super::entity::ai_approvals::Model;
use super::{entity::ai_approvals::*, fit};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

pub const STATUS_PENDING: &str = "pending";
pub const STATUS_APPROVED: &str = "approved";
pub const STATUS_DENIED: &str = "denied";
pub const STATUS_EXPIRED: &str = "expired";
/// Decided cards are kept this long (microseconds) so a reloaded chat still shows them.
pub const RETENTION_MICROS: i64 = 30 * 24 * 3600 * 1_000_000;

/// A card to store as pending; the time is filled in.
#[derive(Debug, Clone, Copy)]
pub struct NewApproval<'a> {
    pub id: &'a str,
    pub org_id: &'a str,
    pub session_id: &'a str,
    pub user_email: &'a str,
    pub tool: Option<&'a str>,
    pub card: &'a str,
    pub expires_at: i64,
}

/// A decision to record on a pending card.
#[derive(Debug, Clone, Copy)]
pub struct Decision<'a> {
    pub status: &'static str,
    pub scope: Option<&'a str>,
    pub resolved: &'a str,
}

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
}

/// Stores `approval` as pending; `false` when its id exists, which is never overwritten.
pub async fn insert_pending(approval: &NewApproval<'_>, now: i64) -> Result<bool, errors::Error> {
    insert_pending_with(get_orm_client_rw().await, approval, now).await
}

pub async fn insert_pending_with<C: ConnectionTrait>(
    conn: &C,
    approval: &NewApproval<'_>,
    now: i64,
) -> Result<bool, errors::Error> {
    let record = ActiveModel {
        id: Set(fit(approval.id, 64)),
        org_id: Set(fit(approval.org_id, 256)),
        session_id: Set(fit(approval.session_id, 64)),
        user_email: Set(fit(approval.user_email, 256)),
        tool: Set(approval.tool.map(|t| fit(t, 256))),
        status: Set(STATUS_PENDING.to_string()),
        scope: Set(None),
        card: Set(approval.card.to_string()),
        resolved: Set(None),
        expires_at: Set(approval.expires_at),
        created_at: Set(now),
        decided_at: Set(None),
    };
    let inserted = Entity::insert(record)
        .on_conflict(OnConflict::column(Column::Id).do_nothing().to_owned())
        .exec_without_returning(conn)
        .await
        .map_err(db_err)?;
    Ok(inserted > 0)
}

/// Records `decision` on the org's pending card `id`; `false` when it was already decided.
pub async fn decide(
    org_id: &str,
    id: &str,
    decision: &Decision<'_>,
    now: i64,
) -> Result<bool, errors::Error> {
    decide_with(get_orm_client_rw().await, org_id, id, decision, now).await
}

pub async fn decide_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    decision: &Decision<'_>,
    now: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::Status, Expr::value(decision.status))
        .col_expr(
            Column::Scope,
            Expr::value(decision.scope.map(|s| fit(s, 16))),
        )
        .col_expr(Column::Resolved, Expr::value(decision.resolved))
        .col_expr(Column::DecidedAt, Expr::value(Some(now)))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::Status.eq(STATUS_PENDING))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// Moves a pending card's expiry (microseconds) and stored frame to what o2-ai extended it to.
pub async fn extend(
    org_id: &str,
    id: &str,
    expires_at: i64,
    card: &str,
) -> Result<bool, errors::Error> {
    extend_with(get_orm_client_rw().await, org_id, id, expires_at, card).await
}

pub async fn extend_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    expires_at: i64,
    card: &str,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::ExpiresAt, Expr::value(expires_at))
        .col_expr(Column::Card, Expr::value(card))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::Status.eq(STATUS_PENDING))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected == 1)
}

/// The org's card `id`, decided or not.
pub async fn get(org_id: &str, id: &str) -> Result<Option<Model>, errors::Error> {
    get_with(get_orm_client_ro().await, org_id, id).await
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<Model>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .one(conn)
        .await
        .map_err(db_err)
}

/// The cards `user_email`'s chat `session_id` raised, oldest first.
pub async fn list_for_session(
    org_id: &str,
    session_id: &str,
    user_email: &str,
) -> Result<Vec<Model>, errors::Error> {
    list_for_session_with(get_orm_client_ro().await, org_id, session_id, user_email).await
}

pub async fn list_for_session_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    user_email: &str,
) -> Result<Vec<Model>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::UserEmail.eq(user_email))
        .order_by_asc(Column::CreatedAt)
        .all(conn)
        .await
        .map_err(db_err)
}

/// Expires unanswered cards past `expires_at` and deletes decided ones past retention.
pub async fn purge(now: i64) -> Result<u64, errors::Error> {
    purge_with(get_orm_client_rw().await, now).await
}

pub async fn purge_with<C: ConnectionTrait>(conn: &C, now: i64) -> Result<u64, errors::Error> {
    let expired = Entity::update_many()
        .col_expr(Column::Status, Expr::value(STATUS_EXPIRED))
        .col_expr(Column::DecidedAt, Expr::value(Some(now)))
        .filter(Column::Status.eq(STATUS_PENDING))
        .filter(Column::ExpiresAt.lt(now))
        .exec(conn)
        .await
        .map_err(db_err)?;
    let deleted = Entity::delete_many()
        .filter(Column::Status.ne(STATUS_PENDING))
        .filter(
            Condition::any()
                .add(Column::ExpiresAt.lt(now - RETENTION_MICROS))
                .add(Column::DecidedAt.lt(now - RETENTION_MICROS)),
        )
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(expired.rows_affected + deleted.rows_affected)
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

    const ORG: &str = "acme";
    const SESSION: &str = "0199e7b2-6f0c-7a3e-a1b2-c3d4e5f60718";
    const NOW: i64 = 1_760_000_000_000_000;
    const APPROVE: Decision<'static> = Decision {
        status: STATUS_APPROVED,
        scope: Some("chat"),
        resolved: r#"{"approved":true}"#,
    };

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    fn card(id: &str) -> NewApproval<'_> {
        NewApproval {
            id,
            org_id: ORG,
            session_id: SESSION,
            user_email: "alice@acme.io",
            tool: Some("UpdateAlert"),
            card: r#"{"type":"confirmation_required"}"#,
            expires_at: NOW + 600_000_000,
        }
    }

    #[tokio::test]
    async fn a_card_is_stored_once_and_decided_once() {
        let db = db().await;
        assert!(insert_pending_with(&db, &card("apr_1"), NOW).await.unwrap());
        assert!(!insert_pending_with(&db, &card("apr_1"), NOW).await.unwrap());
        assert!(decide_with(&db, ORG, "apr_1", &APPROVE, NOW).await.unwrap());
        let deny = Decision {
            status: STATUS_DENIED,
            ..APPROVE
        };
        assert!(!decide_with(&db, ORG, "apr_1", &deny, NOW).await.unwrap());
        assert!(!insert_pending_with(&db, &card("apr_1"), NOW).await.unwrap());
        let row = get_with(&db, ORG, "apr_1").await.unwrap().unwrap();
        assert_eq!(row.status, STATUS_APPROVED);
        assert_eq!(row.scope.as_deref(), Some("chat"));
        assert!(get_with(&db, "globex", "apr_1").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn an_extended_card_outlives_its_first_expiry_in_the_purge() {
        let db = db().await;
        insert_pending_with(&db, &card("apr_1"), NOW).await.unwrap();
        let later = NOW + 601_000_000;
        let extended = r#"{"expires_at":1}"#;
        assert!(
            extend_with(&db, ORG, "apr_1", later + 600_000_000, extended)
                .await
                .unwrap()
        );
        purge_with(&db, later).await.unwrap();
        let row = get_with(&db, ORG, "apr_1").await.unwrap().unwrap();
        assert_eq!(row.status, STATUS_PENDING);
        assert_eq!(row.card, extended);
        decide_with(&db, ORG, "apr_1", &APPROVE, later)
            .await
            .unwrap();
        assert!(
            !extend_with(&db, ORG, "apr_1", later + 900_000_000, "{}")
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn the_session_list_is_scoped_to_its_owner() {
        let db = db().await;
        insert_pending_with(&db, &card("apr_1"), NOW).await.unwrap();
        let rows = list_for_session_with(&db, ORG, SESSION, "alice@acme.io")
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        let others = list_for_session_with(&db, ORG, SESSION, "mallory@acme.io")
            .await
            .unwrap();
        assert!(others.is_empty());
    }

    #[tokio::test]
    async fn the_purge_expires_unanswered_cards_and_drops_old_decisions() {
        let db = db().await;
        insert_pending_with(&db, &card("apr_1"), NOW).await.unwrap();
        let later = NOW + 601_000_000;
        purge_with(&db, later).await.unwrap();
        let row = get_with(&db, ORG, "apr_1").await.unwrap().unwrap();
        assert_eq!(row.status, STATUS_EXPIRED);
        assert!(
            !decide_with(&db, ORG, "apr_1", &APPROVE, later)
                .await
                .unwrap()
        );
        purge_with(&db, later + RETENTION_MICROS + 1).await.unwrap();
        assert!(get_with(&db, ORG, "apr_1").await.unwrap().is_none());
    }
}
