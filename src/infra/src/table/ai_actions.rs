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

//! Service layer for `ai_actions`, the append-only ledger of the assistant's changes.

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    Set, sea_query::Expr,
};

pub use super::entity::ai_actions::Model;
use super::{entity::ai_actions::*, fit};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

pub const APPROVAL_APPROVED: &str = "approved";
pub const APPROVAL_STANDING: &str = "standing";
pub const APPROVAL_NONE: &str = "none";
pub const STATUS_DONE: &str = "done";
pub const STATUS_FAILED: &str = "failed";
pub const OP_CREATE: &str = "create";
pub const OP_UPDATE: &str = "update";
pub const OP_DELETE: &str = "delete";
pub const OP_OTHER: &str = "other";

/// Filters of [`list`]; `cursor` is the `(created_at, id)` of the last row already seen.
#[derive(Debug, Clone, Default)]
pub struct ListQuery {
    pub from: Option<i64>,
    pub to: Option<i64>,
    /// Only this member's rows.
    pub user_email: Option<String>,
    /// Case-sensitive substring of the tool, resource type or resource name.
    pub q: Option<String>,
    pub cursor: Option<(i64, String)>,
    pub limit: u64,
}

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
}

/// Every string cut to its column's width in migration 000003.
fn fitted(action: Model) -> Model {
    let opt = |value: Option<String>, max| value.map(|v| fit(&v, max));
    Model {
        id: fit(&action.id, 64),
        org_id: fit(&action.org_id, 256),
        session_id: opt(action.session_id, 64),
        turn_id: opt(action.turn_id, 64),
        approval_id: opt(action.approval_id, 128),
        approval_kind: fit(&action.approval_kind, 16),
        approved_by: opt(action.approved_by, 256),
        user_email: fit(&action.user_email, 256),
        tool: fit(&action.tool, 256),
        op: fit(&action.op, 16),
        resource_type: fit(&action.resource_type, 64),
        resource_id: opt(action.resource_id, 256),
        resource_name: opt(action.resource_name, 256),
        status: fit(&action.status, 16),
        message: opt(action.message, 256),
        undo_reason: opt(action.undo_reason, 64),
        undone_by: opt(action.undone_by, 256),
        undo_of: opt(action.undo_of, 64),
        ..action
    }
}

/// Stores `action` as given except its id, which is generated, and `created_at`.
pub async fn insert(action: Model) -> Result<Model, errors::Error> {
    insert_with(get_orm_client_rw().await, action).await
}

pub async fn insert_with<C: ConnectionTrait>(
    conn: &C,
    action: Model,
) -> Result<Model, errors::Error> {
    let action = fitted(Model {
        id: config::ider::uuid(),
        ..action
    });
    let record = ActiveModel {
        id: Set(action.id.clone()),
        org_id: Set(action.org_id.clone()),
        session_id: Set(action.session_id.clone()),
        turn_id: Set(action.turn_id.clone()),
        approval_id: Set(action.approval_id.clone()),
        approval_kind: Set(action.approval_kind.clone()),
        approved_by: Set(action.approved_by.clone()),
        user_email: Set(action.user_email.clone()),
        tool: Set(action.tool.clone()),
        op: Set(action.op.clone()),
        resource_type: Set(action.resource_type.clone()),
        resource_id: Set(action.resource_id.clone()),
        resource_name: Set(action.resource_name.clone()),
        before: Set(action.before.clone()),
        after: Set(action.after.clone()),
        status: Set(action.status.clone()),
        message: Set(action.message.clone()),
        undoable: Set(action.undoable),
        undo_reason: Set(action.undo_reason.clone()),
        undo_until: Set(action.undo_until),
        undone_by: Set(action.undone_by.clone()),
        undone_at: Set(action.undone_at),
        undo_of: Set(action.undo_of.clone()),
        created_at: Set(action.created_at),
    };
    Entity::insert(record).exec(conn).await.map_err(db_err)?;
    Ok(action)
}

pub async fn get(org_id: &str, id: &str) -> Result<Option<Model>, errors::Error> {
    get_with(get_orm_client_rw().await, org_id, id).await
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

/// Newest first, at most `query.limit` rows.
pub async fn list(org_id: &str, query: &ListQuery) -> Result<Vec<Model>, errors::Error> {
    list_with(get_orm_client_ro().await, org_id, query).await
}

pub async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    query: &ListQuery,
) -> Result<Vec<Model>, errors::Error> {
    let mut select = Entity::find().filter(Column::OrgId.eq(org_id));
    if let Some(from) = query.from {
        select = select.filter(Column::CreatedAt.gte(from));
    }
    if let Some(to) = query.to {
        select = select.filter(Column::CreatedAt.lt(to));
    }
    if let Some(user_email) = &query.user_email {
        select = select.filter(Column::UserEmail.eq(user_email.as_str()));
    }
    if let Some(q) = query.q.as_deref().filter(|q| !q.is_empty()) {
        select = select.filter(
            Condition::any()
                .add(Column::Tool.contains(q))
                .add(Column::ResourceType.contains(q))
                .add(Column::ResourceName.contains(q)),
        );
    }
    if let Some((at, id)) = &query.cursor {
        select = select.filter(
            Condition::any().add(Column::CreatedAt.lt(*at)).add(
                Condition::all()
                    .add(Column::CreatedAt.eq(*at))
                    .add(Column::Id.lt(id.as_str())),
            ),
        );
    }
    select
        .order_by_desc(Column::CreatedAt)
        .order_by_desc(Column::Id)
        .limit(query.limit)
        .all(conn)
        .await
        .map_err(db_err)
}

/// Clears the snapshots of rows whose undo window passed, so copies of objects do not outlive it.
pub async fn drop_expired_snapshots(now: i64) -> Result<u64, errors::Error> {
    drop_expired_snapshots_with(get_orm_client_rw().await, now).await
}

pub async fn drop_expired_snapshots_with<C: ConnectionTrait>(
    conn: &C,
    now: i64,
) -> Result<u64, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::Before, Expr::value(Option::<String>::None))
        .col_expr(Column::After, Expr::value(Option::<String>::None))
        .filter(
            Condition::any()
                .add(Column::Before.is_not_null())
                .add(Column::After.is_not_null()),
        )
        .filter(
            Condition::any()
                .add(Column::UndoUntil.lt(now))
                .add(Column::UndoUntil.is_null()),
        )
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
}

/// Deletes every row created before `cutoff`.
pub async fn delete_before(cutoff: i64) -> Result<u64, errors::Error> {
    delete_before_with(get_orm_client_rw().await, cutoff).await
}

pub async fn delete_before_with<C: ConnectionTrait>(
    conn: &C,
    cutoff: i64,
) -> Result<u64, errors::Error> {
    let result = Entity::delete_many()
        .filter(Column::CreatedAt.lt(cutoff))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected)
}

/// Claims the undo of `id`; `false` when it was already undone, so two undos never both run.
pub async fn mark_undone(
    org_id: &str,
    id: &str,
    by: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    mark_undone_with(get_orm_client_rw().await, org_id, id, by, now).await
}

pub async fn mark_undone_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
    by: &str,
    now: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::UndoneBy, Expr::value(fit(by, 256)))
        .col_expr(Column::UndoneAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .filter(Column::UndoneAt.is_null())
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected > 0)
}

/// Releases a claim from [`mark_undone`] whose reverse action then failed.
pub async fn clear_undone(org_id: &str, id: &str) -> Result<(), errors::Error> {
    clear_undone_with(get_orm_client_rw().await, org_id, id).await
}

pub async fn clear_undone_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::UndoneBy, Expr::value(Option::<String>::None))
        .col_expr(Column::UndoneAt, Expr::value(Option::<i64>::None))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

/// Marks the newest unapproved row of this chat on this object as approved; `false` if none.
pub async fn stamp_approval(
    org_id: &str,
    session_id: &str,
    target: (&str, &str),
    approval: (&str, &str),
    since: i64,
) -> Result<bool, errors::Error> {
    stamp_approval_with(
        get_orm_client_rw().await,
        org_id,
        session_id,
        target,
        approval,
        since,
    )
    .await
}

pub async fn stamp_approval_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    session_id: &str,
    (resource_type, resource_id): (&str, &str),
    (approval_id, approved_by): (&str, &str),
    since: i64,
) -> Result<bool, errors::Error> {
    let Some(row) = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SessionId.eq(session_id))
        .filter(Column::ResourceType.eq(resource_type))
        .filter(Column::ResourceId.eq(resource_id))
        .filter(Column::ApprovalId.is_null())
        .filter(Column::UndoOf.is_null())
        .filter(Column::CreatedAt.gte(since))
        .order_by_desc(Column::CreatedAt)
        .one(conn)
        .await
        .map_err(db_err)?
    else {
        return Ok(false);
    };
    Entity::update_many()
        .col_expr(Column::ApprovalId, Expr::value(fit(approval_id, 128)))
        .col_expr(Column::ApprovalKind, Expr::value(APPROVAL_APPROVED))
        .col_expr(Column::ApprovedBy, Expr::value(fit(approved_by, 256)))
        .filter(Column::Id.eq(row.id))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(true)
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

    fn action(user: &str, at: i64) -> Model {
        Model {
            id: String::new(),
            org_id: "o".to_string(),
            session_id: Some("s".to_string()),
            turn_id: None,
            approval_id: None,
            approval_kind: APPROVAL_NONE.to_string(),
            approved_by: None,
            user_email: user.to_string(),
            tool: "DeleteAlert".to_string(),
            op: OP_DELETE.to_string(),
            resource_type: "alert".to_string(),
            resource_id: Some("a1".to_string()),
            resource_name: Some("cpu".to_string()),
            before: Some("{}".to_string()),
            after: None,
            status: STATUS_DONE.to_string(),
            message: None,
            undoable: true,
            undo_reason: None,
            undo_until: Some(at + 10),
            undone_by: None,
            undone_at: None,
            undo_of: None,
            created_at: at,
        }
    }

    #[tokio::test]
    async fn pages_newest_first_and_scopes_to_a_member() {
        let db = db().await;
        for (user, at) in [("a@x", 1), ("b@x", 2), ("a@x", 3), ("a@x", 3)] {
            insert_with(&db, action(user, at)).await.unwrap();
        }
        let mut query = ListQuery {
            user_email: Some("a@x".to_string()),
            limit: 2,
            ..Default::default()
        };
        let first = list_with(&db, "o", &query).await.unwrap();
        assert_eq!(first.len(), 2);
        assert!(first.iter().all(|r| r.created_at == 3));
        let last = first.last().unwrap();
        query.cursor = Some((last.created_at, last.id.clone()));
        let second = list_with(&db, "o", &query).await.unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].created_at, 1);
        let ranged = ListQuery {
            from: Some(2),
            to: Some(3),
            limit: 10,
            ..Default::default()
        };
        assert_eq!(list_with(&db, "o", &ranged).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn an_action_is_undone_once() {
        let db = db().await;
        let row = insert_with(&db, action("a@x", 1)).await.unwrap();
        assert!(mark_undone_with(&db, "o", &row.id, "a@x", 5).await.unwrap());
        assert!(!mark_undone_with(&db, "o", &row.id, "b@x", 6).await.unwrap());
        clear_undone_with(&db, "o", &row.id).await.unwrap();
        assert!(mark_undone_with(&db, "o", &row.id, "b@x", 7).await.unwrap());
        let row = get_with(&db, "o", &row.id).await.unwrap().unwrap();
        assert_eq!(row.undone_by.as_deref(), Some("b@x"));
    }

    #[tokio::test]
    async fn an_approval_stamps_the_newest_matching_row_only() {
        let db = db().await;
        let old = insert_with(&db, action("a@x", 1)).await.unwrap();
        let new = insert_with(&db, action("a@x", 5)).await.unwrap();
        let stamped = stamp_approval_with(&db, "o", "s", ("alert", "a1"), ("ap1", "a@x"), 2)
            .await
            .unwrap();
        assert!(stamped);
        let new = get_with(&db, "o", &new.id).await.unwrap().unwrap();
        assert_eq!(new.approval_kind, APPROVAL_APPROVED);
        assert_eq!(new.approval_id.as_deref(), Some("ap1"));
        let old = get_with(&db, "o", &old.id).await.unwrap().unwrap();
        assert_eq!(old.approval_kind, APPROVAL_NONE);
        let none = stamp_approval_with(&db, "o", "s", ("alert", "zz"), ("ap2", "a@x"), 0)
            .await
            .unwrap();
        assert!(!none);
    }

    #[tokio::test]
    async fn every_field_fits_its_column() {
        let db = db().await;
        let long = "é".repeat(300);
        let row = Model {
            resource_type: long.clone(),
            resource_name: Some(long.clone()),
            approval_id: Some(long.clone()),
            tool: long.clone(),
            ..action("a@x", 1)
        };
        let stored = insert_with(&db, row).await.unwrap();
        let stored = get_with(&db, "o", &stored.id).await.unwrap().unwrap();
        assert_eq!(stored.resource_type.chars().count(), 64);
        assert_eq!(stored.resource_name.unwrap().chars().count(), 256);
        assert_eq!(stored.approval_id.unwrap().chars().count(), 128);
        assert_eq!(stored.tool.chars().count(), 256);
    }

    #[tokio::test]
    async fn snapshots_go_with_the_undo_window_and_rows_with_the_retention() {
        let db = db().await;
        let open = insert_with(&db, action("a@x", 100)).await.unwrap();
        let closed = insert_with(&db, action("a@x", 1)).await.unwrap();
        assert_eq!(drop_expired_snapshots_with(&db, 50).await.unwrap(), 1);
        let closed = get_with(&db, "o", &closed.id).await.unwrap().unwrap();
        assert!(closed.before.is_none() && closed.after.is_none());
        let open = get_with(&db, "o", &open.id).await.unwrap().unwrap();
        assert!(open.before.is_some());
        assert_eq!(drop_expired_snapshots_with(&db, 50).await.unwrap(), 0);
        assert_eq!(delete_before_with(&db, 50).await.unwrap(), 1);
        assert!(get_with(&db, "o", &closed.id).await.unwrap().is_none());
    }
}
