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

//! Chat links: one per person and one per platform user within an org's workspace.

use config::meta::oncall::{ChatIdentity, ChatPlatform};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, EntityTrait, IntoActiveModel,
    QueryFilter, TransactionTrait,
};

use super::entity::oncall_chat_identities::{Column, Entity, Model};
use crate::{db::get_orm_client_rw, errors};

/// Inserts the link or replaces the row with its id; a unique-key clash errors. [strong]
pub async fn put(identity: &ChatIdentity) -> Result<(), errors::Error> {
    put_in(get_orm_client_rw().await, identity).await
}

/// The link for a platform user in an org's workspace, linked or not. [strong]
pub async fn get_for_user(
    org_id: &str,
    platform: ChatPlatform,
    workspace_id: &str,
    platform_user_id: &str,
) -> Result<Option<ChatIdentity>, errors::Error> {
    get_for_user_in(
        get_orm_client_rw().await,
        org_id,
        platform,
        workspace_id,
        platform_user_id,
    )
    .await
}

/// The link for an email in an org's workspace, linked or not. [strong]
pub async fn get_for_email(
    org_id: &str,
    platform: ChatPlatform,
    workspace_id: &str,
    user_email: &str,
) -> Result<Option<ChatIdentity>, errors::Error> {
    get_for_email_in(
        get_orm_client_rw().await,
        org_id,
        platform,
        workspace_id,
        user_email,
    )
    .await
}

/// The linked (never unlinked) rows of an org's workspace. [strong]
pub async fn list_linked(
    org_id: &str,
    platform: ChatPlatform,
    workspace_id: &str,
) -> Result<Vec<ChatIdentity>, errors::Error> {
    list_linked_in(get_orm_client_rw().await, org_id, platform, workspace_id).await
}

/// Removes the link; false means there was none. [strong]
pub async fn delete(id: &str) -> Result<bool, errors::Error> {
    delete_in(get_orm_client_rw().await, id).await
}

/// Applies a replicated link unless a stored row sharing a key is as new (FL-3). [strong]
pub async fn put_replica(identity: &ChatIdentity) -> Result<(), errors::Error> {
    put_replica_in(get_orm_client_rw().await, identity).await
}

/// Rows of one org's workspace on one platform.
fn scoped(org_id: &str, platform: ChatPlatform, workspace_id: &str) -> sea_orm::Select<Entity> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Platform.eq(platform.to_i32()))
        .filter(Column::WorkspaceId.eq(workspace_id))
}

/// Rows sharing the id or either unique key with `identity`.
fn clashes(identity: &ChatIdentity) -> Condition {
    let workspace = Condition::all()
        .add(Column::OrgId.eq(&identity.org_id))
        .add(Column::Platform.eq(identity.platform.to_i32()))
        .add(Column::WorkspaceId.eq(&identity.workspace_id));
    Condition::any()
        .add(Column::Id.eq(&identity.id))
        .add(
            workspace
                .clone()
                .add(Column::UserEmail.eq(&identity.user_email)),
        )
        .add(workspace.add(Column::PlatformUserId.eq(&identity.platform_user_id)))
}

/// Reads a row back into the meta type; a platform this build cannot read is an error.
fn to_identity(m: Model) -> Result<ChatIdentity, errors::Error> {
    let platform = ChatPlatform::from_i32(m.platform).ok_or_else(|| {
        errors::Error::Message(format!(
            "oncall_chat_identities {}: unknown platform {}",
            m.id, m.platform
        ))
    })?;
    Ok(ChatIdentity {
        id: m.id,
        org_id: m.org_id,
        platform,
        workspace_id: m.workspace_id,
        platform_user_id: m.platform_user_id,
        enterprise_user_id: m.enterprise_user_id,
        user_email: m.user_email,
        linked_at: m.linked_at,
        unlinked_at: m.unlinked_at,
        changed_at: m.changed_at,
    })
}

/// Maps the meta type onto a row.
fn to_model(identity: &ChatIdentity) -> Model {
    Model {
        id: identity.id.clone(),
        org_id: identity.org_id.clone(),
        platform: identity.platform.to_i32(),
        workspace_id: identity.workspace_id.clone(),
        platform_user_id: identity.platform_user_id.clone(),
        enterprise_user_id: identity.enterprise_user_id.clone(),
        user_email: identity.user_email.clone(),
        linked_at: identity.linked_at,
        unlinked_at: identity.unlinked_at,
        changed_at: identity.changed_at,
    }
}

/// [`put`] against a caller-supplied connection.
async fn put_in<C: TransactionTrait>(
    conn: &C,
    identity: &ChatIdentity,
) -> Result<(), errors::Error> {
    // UPDATE first, not ON CONFLICT: MySQL's upsert fires on any unique key, overwriting the clash.
    let model = to_model(identity).into_active_model().reset_all();
    let txn = conn.begin().await?;
    let updated = Entity::update_many()
        .set(model.clone())
        .filter(Column::Id.eq(&identity.id))
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

/// [`get_for_user`] against a caller-supplied connection.
async fn get_for_user_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    platform: ChatPlatform,
    workspace_id: &str,
    platform_user_id: &str,
) -> Result<Option<ChatIdentity>, errors::Error> {
    let found = scoped(org_id, platform, workspace_id)
        .filter(Column::PlatformUserId.eq(platform_user_id))
        .one(conn)
        .await?;
    found.map(to_identity).transpose()
}

/// [`get_for_email`] against a caller-supplied connection.
async fn get_for_email_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    platform: ChatPlatform,
    workspace_id: &str,
    user_email: &str,
) -> Result<Option<ChatIdentity>, errors::Error> {
    let found = scoped(org_id, platform, workspace_id)
        .filter(Column::UserEmail.eq(user_email))
        .one(conn)
        .await?;
    found.map(to_identity).transpose()
}

/// [`list_linked`] against a caller-supplied connection.
async fn list_linked_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    platform: ChatPlatform,
    workspace_id: &str,
) -> Result<Vec<ChatIdentity>, errors::Error> {
    scoped(org_id, platform, workspace_id)
        .filter(Column::UnlinkedAt.is_null())
        .all(conn)
        .await?
        .into_iter()
        .map(to_identity)
        .collect()
}

/// [`delete`] against a caller-supplied connection.
async fn delete_in<C: ConnectionTrait>(conn: &C, id: &str) -> Result<bool, errors::Error> {
    let deleted = Entity::delete_by_id(id).exec(conn).await?.rows_affected;
    Ok(deleted == 1)
}

/// [`put_replica`] against a caller-supplied connection.
async fn put_replica_in<C: TransactionTrait>(
    conn: &C,
    identity: &ChatIdentity,
) -> Result<(), errors::Error> {
    let txn = conn.begin().await?;
    let stored = Entity::find().filter(clashes(identity)).all(&txn).await?;
    // A tie loses too, so a replayed Put is a no-op and two regions never swap rows.
    if stored.iter().all(|m| m.changed_at < identity.changed_at) {
        Entity::delete_many()
            .filter(clashes(identity))
            .exec(&txn)
            .await?;
        to_model(identity)
            .into_active_model()
            .reset_all()
            .insert(&txn)
            .await?;
    }
    txn.commit().await?;
    Ok(())
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

    fn identity(id: &str, user: &str, email: &str) -> ChatIdentity {
        ChatIdentity {
            id: id.into(),
            org_id: "acme".into(),
            platform: ChatPlatform::Slack,
            workspace_id: "T1".into(),
            platform_user_id: user.into(),
            enterprise_user_id: None,
            user_email: email.into(),
            linked_at: 100,
            unlinked_at: None,
            changed_at: 100,
        }
    }

    /// DM-1: the linked rows of one org's workspace, never an unlinked one or another workspace's.
    #[tokio::test]
    async fn test_list_linked_keeps_only_linked_rows_of_the_workspace() {
        let db = db().await;
        let ana = identity("l1", "U1", "ana@o2.ai");
        let bo = ChatIdentity {
            unlinked_at: Some(200),
            ..identity("l2", "U2", "bo@o2.ai")
        };
        let elsewhere = ChatIdentity {
            workspace_id: "T2".into(),
            ..identity("l3", "U3", "cy@o2.ai")
        };
        for row in [&ana, &bo, &elsewhere] {
            put_in(&db, row).await.unwrap();
        }
        let linked = list_linked_in(&db, "acme", ChatPlatform::Slack, "T1")
            .await
            .unwrap();
        assert_eq!(linked, vec![ana]);
    }

    #[tokio::test]
    async fn test_put_get_and_delete_round_trip() {
        let db = db().await;
        let ana = identity("l1", "U1", "ana@o2.ai");
        put_in(&db, &ana).await.unwrap();
        let unlinked = ChatIdentity {
            unlinked_at: Some(200),
            changed_at: 200,
            ..ana.clone()
        };
        put_in(&db, &unlinked).await.unwrap();

        let by_email = get_for_email_in(&db, "acme", ChatPlatform::Slack, "T1", "ana@o2.ai")
            .await
            .unwrap();
        assert_eq!(by_email.as_ref(), Some(&unlinked));
        let by_user = get_for_user_in(&db, "acme", ChatPlatform::Slack, "T1", "U1")
            .await
            .unwrap();
        assert_eq!(by_user, Some(unlinked));
        assert!(
            put_in(&db, &identity("l2", "U1", "bo@o2.ai"))
                .await
                .is_err(),
            "one link per platform user"
        );
        assert!(
            put_in(&db, &identity("l3", "U2", "ana@o2.ai"))
                .await
                .is_err(),
            "one link per email"
        );

        assert!(delete_in(&db, "l1").await.unwrap());
        assert!(
            !delete_in(&db, "l1").await.unwrap(),
            "nothing left to delete"
        );
        let gone = get_for_user_in(&db, "acme", ChatPlatform::Slack, "T1", "U1")
            .await
            .unwrap();
        assert_eq!(gone, None);
    }

    /// Every row in the table, by id.
    async fn rows(db: &DatabaseConnection) -> Vec<ChatIdentity> {
        let mut all: Vec<ChatIdentity> = Entity::find()
            .all(db)
            .await
            .unwrap()
            .into_iter()
            .map(|m| to_identity(m).unwrap())
            .collect();
        all.sort_by(|a, b| a.id.cmp(&b.id));
        all
    }

    /// FL-3: whichever order two regions receive clashing links in, both keep the newer one.
    #[tokio::test]
    async fn test_two_regions_converge_on_the_newer_link() {
        let older = identity("l1", "U1", "ana@o2.ai");
        let same_email = ChatIdentity {
            changed_at: 200,
            ..identity("l2", "U2", "ana@o2.ai")
        };
        let same_user = ChatIdentity {
            changed_at: 200,
            ..identity("l3", "U1", "bo@o2.ai")
        };
        let unlinked = ChatIdentity {
            unlinked_at: Some(200),
            changed_at: 200,
            ..older.clone()
        };
        for newer in [same_email, same_user, unlinked] {
            for order in [[&older, &newer], [&newer, &older]] {
                let db = db().await;
                for put in order {
                    put_replica_in(&db, put).await.unwrap();
                }
                assert_eq!(rows(&db).await, vec![newer.clone()], "{}", newer.id);
            }
        }
    }

    /// Every later insert into the table aborts, as a lost connection would.
    async fn fail_inserts(db: &DatabaseConnection) {
        db.execute(Statement::from_string(
            db.get_database_backend(),
            "CREATE TRIGGER fail_insert BEFORE INSERT ON oncall_chat_identities \
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
        put_in(&db, &identity("l1", "U1", "ana@o2.ai"))
            .await
            .unwrap();
        let before = rows(&db).await;
        fail_inserts(&db).await;

        let newer = ChatIdentity {
            changed_at: 200,
            ..identity("l2", "U2", "ana@o2.ai")
        };
        assert!(put_replica_in(&db, &newer).await.is_err());

        assert_eq!(rows(&db).await, before);
    }
}
