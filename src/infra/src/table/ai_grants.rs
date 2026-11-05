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

//! Service layer for `ai_grants`, standing approvals a member gave the assistant.

use sea_orm::{ColumnTrait, Condition, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder, Set};

pub use super::entity::ai_grants::Model;
use super::{entity::ai_grants::*, fit};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
};

pub const SCOPE_ALWAYS: &str = "always";
pub const SCOPE_CHAT: &str = "chat";

/// A grant to store; the id and time are filled in.
#[derive(Debug, Clone, Copy)]
pub struct NewGrant<'a> {
    pub org_id: &'a str,
    pub user_email: &'a str,
    pub tool: &'a str,
    pub operation: &'a str,
    pub scope: &'a str,
    pub chat_id: Option<&'a str>,
    pub granted_by: &'a str,
}

fn db_err(e: impl ToString) -> errors::Error {
    errors::DbError::SeaORMError(e.to_string()).into()
}

/// Stores `grant` unless the same one exists, which is then returned instead.
pub async fn insert(grant: &NewGrant<'_>, now: i64) -> Result<Model, errors::Error> {
    insert_with(get_orm_client_rw().await, grant, now).await
}

pub async fn insert_with<C: ConnectionTrait>(
    conn: &C,
    grant: &NewGrant<'_>,
    now: i64,
) -> Result<Model, errors::Error> {
    let mut same = Entity::find()
        .filter(Column::OrgId.eq(grant.org_id))
        .filter(Column::UserEmail.eq(grant.user_email))
        .filter(Column::Tool.eq(grant.tool))
        .filter(Column::Operation.eq(grant.operation))
        .filter(Column::Scope.eq(grant.scope));
    same = match grant.chat_id {
        Some(chat_id) => same.filter(Column::ChatId.eq(chat_id)),
        None => same.filter(Column::ChatId.is_null()),
    };
    if let Some(existing) = same.one(conn).await.map_err(db_err)? {
        return Ok(existing);
    }
    let model = Model {
        id: config::ider::uuid(),
        org_id: fit(grant.org_id, 256),
        user_email: fit(grant.user_email, 256),
        tool: fit(grant.tool, 256),
        operation: fit(grant.operation, 128),
        scope: fit(grant.scope, 16),
        chat_id: grant.chat_id.map(|c| fit(c, 64)),
        granted_by: fit(grant.granted_by, 256),
        granted_at: now,
    };
    let record = ActiveModel {
        id: Set(model.id.clone()),
        org_id: Set(model.org_id.clone()),
        user_email: Set(model.user_email.clone()),
        tool: Set(model.tool.clone()),
        operation: Set(model.operation.clone()),
        scope: Set(model.scope.clone()),
        chat_id: Set(model.chat_id.clone()),
        granted_by: Set(model.granted_by.clone()),
        granted_at: Set(now),
    };
    Entity::insert(record).exec(conn).await.map_err(db_err)?;
    Ok(model)
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

/// Every grant of the org, or of one member when `user_email` is set; newest first.
pub async fn list(org_id: &str, user_email: Option<&str>) -> Result<Vec<Model>, errors::Error> {
    list_with(get_orm_client_ro().await, org_id, user_email).await
}

pub async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: Option<&str>,
) -> Result<Vec<Model>, errors::Error> {
    let mut query = Entity::find().filter(Column::OrgId.eq(org_id));
    if let Some(user_email) = user_email {
        query = query.filter(Column::UserEmail.eq(user_email));
    }
    query
        .order_by_desc(Column::GrantedAt)
        .order_by_desc(Column::Id)
        .all(conn)
        .await
        .map_err(db_err)
}

/// The caller's grants that apply in `chat_id`: every `always` one and that chat's own.
pub async fn active_for_turn(
    org_id: &str,
    user_email: &str,
    chat_id: Option<&str>,
) -> Result<Vec<Model>, errors::Error> {
    active_for_turn_with(get_orm_client_ro().await, org_id, user_email, chat_id).await
}

pub async fn active_for_turn_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    chat_id: Option<&str>,
) -> Result<Vec<Model>, errors::Error> {
    let mut scope = Condition::any().add(Column::Scope.eq(SCOPE_ALWAYS));
    if let Some(chat_id) = chat_id {
        scope = scope.add(
            Condition::all()
                .add(Column::Scope.eq(SCOPE_CHAT))
                .add(Column::ChatId.eq(chat_id)),
        );
    }
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .filter(scope)
        .order_by_desc(Column::GrantedAt)
        .all(conn)
        .await
        .map_err(db_err)
}

/// `false` when no such grant exists.
pub async fn delete(org_id: &str, id: &str) -> Result<bool, errors::Error> {
    delete_with(get_orm_client_rw().await, org_id, id).await
}

pub async fn delete_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await
        .map_err(db_err)?;
    Ok(result.rows_affected > 0)
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

    fn grant<'a>(user: &'a str, scope: &'a str, chat_id: Option<&'a str>) -> NewGrant<'a> {
        NewGrant {
            org_id: "o",
            user_email: user,
            tool: "UpdateDashboard",
            operation: "update",
            scope,
            chat_id,
            granted_by: user,
        }
    }

    #[tokio::test]
    async fn the_same_grant_is_stored_once() {
        let db = db().await;
        let first = insert_with(&db, &grant("a@x", SCOPE_ALWAYS, None), 1)
            .await
            .unwrap();
        let again = insert_with(&db, &grant("a@x", SCOPE_ALWAYS, None), 2)
            .await
            .unwrap();
        assert_eq!(first.id, again.id);
        assert_eq!(list_with(&db, "o", None).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_turn_sees_only_its_callers_always_grants_and_its_own_chats() {
        let db = db().await;
        let always = insert_with(&db, &grant("a@x", SCOPE_ALWAYS, None), 1)
            .await
            .unwrap();
        let this_chat = insert_with(&db, &grant("a@x", SCOPE_CHAT, Some("c1")), 2)
            .await
            .unwrap();
        insert_with(&db, &grant("a@x", SCOPE_CHAT, Some("c2")), 3)
            .await
            .unwrap();
        insert_with(&db, &grant("b@x", SCOPE_ALWAYS, None), 4)
            .await
            .unwrap();
        let ids = |grants: Vec<Model>| grants.into_iter().map(|g| g.id).collect::<Vec<_>>();
        let active = active_for_turn_with(&db, "o", "a@x", Some("c1"))
            .await
            .unwrap();
        assert_eq!(ids(active), vec![this_chat.id, always.id.clone()]);
        let no_chat = active_for_turn_with(&db, "o", "a@x", None).await.unwrap();
        assert_eq!(ids(no_chat), vec![always.id]);
        assert_eq!(list_with(&db, "o", Some("b@x")).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn delete_reports_whether_a_grant_went() {
        let db = db().await;
        let g = insert_with(&db, &grant("a@x", SCOPE_ALWAYS, None), 1)
            .await
            .unwrap();
        assert!(!delete_with(&db, "other", &g.id).await.unwrap());
        assert!(delete_with(&db, "o", &g.id).await.unwrap());
        assert!(get_with(&db, "o", &g.id).await.unwrap().is_none());
    }
}
