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

//! Chat installs: one workspace per org and one org per workspace, enforced by the database.

use config::meta::oncall::{ChatInstall, ChatPlatform, InstallStatus};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, QueryFilter,
    TransactionTrait, sea_query::Expr,
};

use super::entity::oncall_chat_installs::{Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors};

/// Inserts the install or replaces the row with its id; a unique-key clash errors. [strong]
pub async fn put(install: &ChatInstall) -> Result<(), errors::Error> {
    put_in(get_orm_client_rw().await, install).await
}

/// The org's install on a platform, whatever its status. [strong]
pub async fn get_for_org(
    org_id: &str,
    platform: ChatPlatform,
) -> Result<Option<ChatInstall>, errors::Error> {
    get_for_org_in(get_orm_client_rw().await, org_id, platform).await
}

/// The install holding a workspace, in whichever org, whatever its status. [strong]
pub async fn get_for_workspace(
    platform: ChatPlatform,
    workspace_id: &str,
) -> Result<Option<ChatInstall>, errors::Error> {
    get_for_workspace_in(get_orm_client_rw().await, platform, workspace_id).await
}

/// Sets an install's status and revision in one statement. [strong]
pub async fn set_status(
    id: &str,
    status: InstallStatus,
    updated_at: i64,
) -> Result<(), errors::Error> {
    set_status_in(get_orm_client_rw().await, id, status, updated_at).await
}

/// Removes the install; false means there was none. [strong]
pub async fn delete(id: &str) -> Result<bool, errors::Error> {
    delete_in(get_orm_client_rw().await, id).await
}

/// Reads a row back into the meta type; a discriminant this build cannot read is an error.
fn to_install(m: Model) -> Result<ChatInstall, errors::Error> {
    let unreadable = |what: &str, v: i32| {
        errors::Error::Message(format!("oncall_chat_installs {}: unknown {what} {v}", m.id))
    };
    let platform =
        ChatPlatform::from_i32(m.platform).ok_or_else(|| unreadable("platform", m.platform))?;
    let status = InstallStatus::from_i32(m.status).ok_or_else(|| unreadable("status", m.status))?;
    Ok(ChatInstall {
        id: m.id,
        org_id: m.org_id,
        platform,
        workspace_id: m.workspace_id,
        workspace_name: m.workspace_name,
        enterprise_id: m.enterprise_id,
        app_id: m.app_id,
        bot_user_id: m.bot_user_id,
        bot_token_cipher: m.bot_token_cipher,
        scopes: m.scopes,
        status,
        installed_by: m.installed_by,
        installed_at: m.installed_at,
        updated_at: m.updated_at,
    })
}

/// Maps the meta type onto a row.
fn to_model(install: &ChatInstall) -> Model {
    Model {
        id: install.id.clone(),
        org_id: install.org_id.clone(),
        platform: install.platform.to_i32(),
        workspace_id: install.workspace_id.clone(),
        workspace_name: install.workspace_name.clone(),
        enterprise_id: install.enterprise_id.clone(),
        app_id: install.app_id.clone(),
        bot_user_id: install.bot_user_id.clone(),
        bot_token_cipher: install.bot_token_cipher.clone(),
        scopes: install.scopes.clone(),
        status: install.status.to_i32(),
        installed_by: install.installed_by.clone(),
        installed_at: install.installed_at,
        updated_at: install.updated_at,
    }
}

/// [`put`] against a caller-supplied connection.
async fn put_in<C: TransactionTrait>(conn: &C, install: &ChatInstall) -> Result<(), errors::Error> {
    // UPDATE first, not ON CONFLICT: MySQL's upsert fires on any unique key, overwriting the clash.
    let model = to_model(install).into_active_model().reset_all();
    let txn = conn.begin().await?;
    let updated = Entity::update_many()
        .set(model.clone())
        .filter(Column::Id.eq(&install.id))
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

/// [`get_for_org`] against a caller-supplied connection.
async fn get_for_org_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    platform: ChatPlatform,
) -> Result<Option<ChatInstall>, errors::Error> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Platform.eq(platform.to_i32()))
        .one(conn)
        .await?
        .map(to_install)
        .transpose()
}

/// [`get_for_workspace`] against a caller-supplied connection.
async fn get_for_workspace_in<C: ConnectionTrait>(
    conn: &C,
    platform: ChatPlatform,
    workspace_id: &str,
) -> Result<Option<ChatInstall>, errors::Error> {
    Entity::find()
        .filter(Column::Platform.eq(platform.to_i32()))
        .filter(Column::WorkspaceId.eq(workspace_id))
        .one(conn)
        .await?
        .map(to_install)
        .transpose()
}

/// [`set_status`] against a caller-supplied connection.
async fn set_status_in<C: ConnectionTrait>(
    conn: &C,
    id: &str,
    status: InstallStatus,
    updated_at: i64,
) -> Result<(), errors::Error> {
    Entity::update_many()
        .col_expr(Column::Status, Expr::value(status.to_i32()))
        .col_expr(Column::UpdatedAt, Expr::value(updated_at))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(())
}

/// [`delete`] against a caller-supplied connection.
async fn delete_in<C: ConnectionTrait>(conn: &C, id: &str) -> Result<bool, errors::Error> {
    let deleted = Entity::delete_by_id(id).exec(conn).await?.rows_affected;
    Ok(deleted == 1)
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

    fn install(id: &str, org_id: &str, workspace_id: &str) -> ChatInstall {
        ChatInstall {
            id: id.into(),
            org_id: org_id.into(),
            platform: ChatPlatform::Slack,
            workspace_id: workspace_id.into(),
            workspace_name: "Acme".into(),
            enterprise_id: Some("E1".into()),
            app_id: "A1".into(),
            bot_user_id: "U0BOT".into(),
            bot_token_cipher: "sealed".into(),
            scopes: "chat:write,commands".into(),
            status: InstallStatus::Active,
            installed_by: "ana@o2.ai".into(),
            installed_at: 100,
            updated_at: 100,
        }
    }

    #[tokio::test]
    async fn test_put_get_set_status_and_delete_round_trip() {
        let db = db().await;
        let first = install("i1", "acme", "T1");
        put_in(&db, &first).await.unwrap();

        let by_org = get_for_org_in(&db, "acme", ChatPlatform::Slack)
            .await
            .unwrap();
        assert_eq!(by_org.as_ref(), Some(&first));
        let by_workspace = get_for_workspace_in(&db, ChatPlatform::Slack, "T1")
            .await
            .unwrap();
        assert_eq!(by_workspace.as_ref(), Some(&first));

        let renamed = ChatInstall {
            workspace_name: "Acme Inc".into(),
            updated_at: 200,
            ..first.clone()
        };
        put_in(&db, &renamed).await.unwrap();
        set_status_in(&db, "i1", InstallStatus::Revoked, 300)
            .await
            .unwrap();
        let got = get_for_org_in(&db, "acme", ChatPlatform::Slack)
            .await
            .unwrap();
        assert_eq!(
            got,
            Some(ChatInstall {
                status: InstallStatus::Revoked,
                updated_at: 300,
                ..renamed
            })
        );

        assert!(delete_in(&db, "i1").await.unwrap());
        assert!(
            !delete_in(&db, "i1").await.unwrap(),
            "nothing left to delete"
        );
        assert_eq!(
            get_for_org_in(&db, "acme", ChatPlatform::Slack)
                .await
                .unwrap(),
            None
        );
    }

    /// A delete landing between two puts of one id must not swallow the second put.
    #[tokio::test]
    async fn test_a_put_after_its_row_was_deleted_writes_the_row() {
        let db = db().await;
        put_in(&db, &install("i1", "acme", "T1")).await.unwrap();
        assert!(delete_in(&db, "i1").await.unwrap());

        let again = ChatInstall {
            status: InstallStatus::Revoked,
            updated_at: 200,
            ..install("i1", "acme", "T1")
        };
        put_in(&db, &again).await.unwrap();

        assert_eq!(
            get_for_org_in(&db, "acme", ChatPlatform::Slack)
                .await
                .unwrap(),
            Some(again)
        );
    }

    #[tokio::test]
    async fn test_one_workspace_per_org_and_one_org_per_workspace() {
        let db = db().await;
        let first = install("i1", "acme", "T1");
        put_in(&db, &first).await.unwrap();

        assert!(
            put_in(&db, &install("i2", "acme", "T2")).await.is_err(),
            "a second workspace for the same org"
        );
        assert!(
            put_in(&db, &install("i3", "globex", "T1")).await.is_err(),
            "a second org for the same workspace"
        );

        assert_eq!(
            get_for_org_in(&db, "acme", ChatPlatform::Slack)
                .await
                .unwrap(),
            Some(first)
        );
        assert_eq!(
            get_for_workspace_in(&db, ChatPlatform::Slack, "T2")
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            get_for_org_in(&db, "globex", ChatPlatform::Slack)
                .await
                .unwrap(),
            None
        );
    }
}
