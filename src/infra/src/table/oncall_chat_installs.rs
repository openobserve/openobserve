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

use config::{
    meta::oncall::{ChatInstall, ChatPlatform, InstallStatus},
    utils::encryption::Algorithm,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, EntityTrait, IntoActiveModel,
    QueryFilter, TransactionTrait, sea_query::Expr,
};

use super::{
    cipher,
    entity::oncall_chat_installs::{Column, Entity, Model},
};
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

/// Stores the install with `bot_token` sealed. [weak: may leave the org DEK row; a retry reuses it]
pub async fn put_with_token(install: &ChatInstall, bot_token: &str) -> Result<(), errors::Error> {
    put_with_token_in(
        get_orm_client_rw().await,
        cipher::is_encrypting(),
        async || cipher::get_dek(&install.org_id).await,
        install,
        bot_token,
    )
    .await
}

/// The install's bot token in the clear. [weak: may create the org DEK row; a retry reuses it]
pub async fn bot_token(install: &ChatInstall) -> Result<String, errors::Error> {
    let dek = cipher::get_dek(&install.org_id).await?;
    open_token(install, &dek)
}

/// Applies a replicated install (FL-3). [weak: may leave the org DEK row; a retry reuses it]
pub async fn put_replica_with_token(
    install: &ChatInstall,
    bot_token: &str,
) -> Result<(), errors::Error> {
    put_replica_with_token_in(
        get_orm_client_rw().await,
        cipher::is_encrypting(),
        async || cipher::get_dek(&install.org_id).await,
        install,
        bot_token,
    )
    .await
}

/// Applies a replicated disconnect; a workspace install outranking the deleted one stays. [strong]
pub async fn delete_replica(
    org_id: &str,
    platform: ChatPlatform,
    workspace_id: &str,
    updated_at: i64,
    installed_at: i64,
) -> Result<bool, errors::Error> {
    delete_replica_in(
        get_orm_client_rw().await,
        org_id,
        platform,
        workspace_id,
        updated_at,
        installed_at,
    )
    .await
}

/// Refuses unless DEKs are wrapped under a master key: a DEK alone exists with secrets off too.
fn require_encryption(is_encrypting: bool) -> Result<(), errors::Error> {
    if is_encrypting {
        return Ok(());
    }
    Err(errors::Error::Message(
        "chat installs need O2_MASTER_ENCRYPTION_KEY set and stored secrets on".to_string(),
    ))
}

/// The install with `bot_token` sealed, once the master key and the org DEK are both there.
async fn sealed(
    encrypting: bool,
    dek: impl AsyncFnOnce() -> Result<Vec<u8>, errors::Error>,
    install: &ChatInstall,
    bot_token: &str,
) -> Result<ChatInstall, errors::Error> {
    require_encryption(encrypting)?;
    with_sealed_token(install, bot_token, &dek().await?)
}

/// The install with `bot_token` sealed under `dek` as its stored cipher text.
fn with_sealed_token(
    install: &ChatInstall,
    bot_token: &str,
    dek: &[u8],
) -> Result<ChatInstall, errors::Error> {
    let bot_token_cipher = Algorithm::Aes256Siv
        .encrypt(dek, bot_token)
        .map_err(|e| errors::Error::Message(format!("oncall_chat_installs {}: {e}", install.id)))?;
    Ok(ChatInstall {
        bot_token_cipher,
        ..install.clone()
    })
}

/// Opens the stored cipher text with `dek`.
fn open_token(install: &ChatInstall, dek: &[u8]) -> Result<String, errors::Error> {
    Algorithm::Aes256Siv
        .decrypt(dek, &install.bot_token_cipher)
        .map_err(|e| errors::Error::Message(format!("oncall_chat_installs {}: {e}", install.id)))
}

/// FL-3's order between two writes of installs that share a key.
fn rank(m: &Model) -> (i64, i64, &str) {
    (m.updated_at, m.installed_at, &m.org_id)
}

/// Rows sharing the id or either unique key with `install`.
fn clashes(install: &ChatInstall) -> Condition {
    let platform = install.platform.to_i32();
    Condition::any()
        .add(Column::Id.eq(&install.id))
        .add(
            Condition::all()
                .add(Column::Platform.eq(platform))
                .add(Column::WorkspaceId.eq(&install.workspace_id)),
        )
        .add(
            Condition::all()
                .add(Column::OrgId.eq(&install.org_id))
                .add(Column::Platform.eq(platform)),
        )
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

/// [`put_replica_with_token`] against a caller-supplied connection, the token already sealed.
async fn put_replica_in<C: TransactionTrait>(
    conn: &C,
    install: &ChatInstall,
) -> Result<(), errors::Error> {
    let incoming = to_model(install);
    let txn = conn.begin().await?;
    let stored = Entity::find().filter(clashes(install)).all(&txn).await?;
    // A tie loses too, so a replayed Put is a no-op and two regions never swap rows.
    if stored.iter().all(|m| rank(m) < rank(&incoming)) {
        Entity::delete_many()
            .filter(clashes(install))
            .exec(&txn)
            .await?;
        incoming
            .into_active_model()
            .reset_all()
            .insert(&txn)
            .await?;
    }
    txn.commit().await?;
    Ok(())
}

/// [`put_with_token`] against a caller-supplied connection, key state and DEK.
async fn put_with_token_in<C: TransactionTrait>(
    conn: &C,
    encrypting: bool,
    dek: impl AsyncFnOnce() -> Result<Vec<u8>, errors::Error>,
    install: &ChatInstall,
    bot_token: &str,
) -> Result<(), errors::Error> {
    put_in(conn, &sealed(encrypting, dek, install, bot_token).await?).await
}

/// [`put_replica_with_token`] against a caller-supplied connection, key state and DEK.
async fn put_replica_with_token_in<C: TransactionTrait>(
    conn: &C,
    encrypting: bool,
    dek: impl AsyncFnOnce() -> Result<Vec<u8>, errors::Error>,
    install: &ChatInstall,
    bot_token: &str,
) -> Result<(), errors::Error> {
    put_replica_in(conn, &sealed(encrypting, dek, install, bot_token).await?).await
}

/// [`delete_replica`] against a caller-supplied connection.
async fn delete_replica_in<C: TransactionTrait>(
    conn: &C,
    org_id: &str,
    platform: ChatPlatform,
    workspace_id: &str,
    updated_at: i64,
    installed_at: i64,
) -> Result<bool, errors::Error> {
    let txn = conn.begin().await?;
    let stored = Entity::find()
        .filter(Column::Platform.eq(platform.to_i32()))
        .filter(Column::WorkspaceId.eq(workspace_id))
        .one(&txn)
        .await?;
    // A reconnect that outranks the disconnected install survives it, as a newer Put would.
    let Some(stored) = stored.filter(|m| rank(m) <= (updated_at, installed_at, org_id)) else {
        txn.commit().await?;
        return Ok(false);
    };
    Entity::delete_by_id(&stored.id).exec(&txn).await?;
    txn.commit().await?;
    Ok(true)
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

    /// The sealing key of one region's org; two bytes give two regions.
    fn dek(byte: u8) -> Vec<u8> {
        vec![byte; 64]
    }

    /// Every row in the table, by id.
    async fn rows(db: &DatabaseConnection) -> Vec<Model> {
        let mut all = Entity::find().all(db).await.unwrap();
        all.sort_by(|a, b| a.id.cmp(&b.id));
        all
    }

    #[test]
    fn test_put_with_token_refuses_unless_encrypting() {
        assert!(require_encryption(false).is_err());
        assert!(require_encryption(true).is_ok());
    }

    /// IN-13, FL-2: the stored token is never plaintext; each region opens only its own seal.
    #[tokio::test]
    async fn test_the_token_is_stored_sealed_and_reseals_under_another_org_key() {
        let db = db().await;
        let token = "xoxb-123-secret";
        put_in(
            &db,
            &with_sealed_token(&install("i1", "acme", "T1"), token, &dek(7)).unwrap(),
        )
        .await
        .unwrap();

        let stored = get_for_org_in(&db, "acme", ChatPlatform::Slack)
            .await
            .unwrap()
            .unwrap();
        assert!(
            !stored.bot_token_cipher.contains(token),
            "{}",
            stored.bot_token_cipher
        );
        let wire = open_token(&stored, &dek(7)).unwrap();
        assert_eq!(wire, token);
        assert!(open_token(&stored, &dek(8)).is_err());

        let other_region = with_sealed_token(&stored, &wire, &dek(8)).unwrap();
        assert_ne!(other_region.bot_token_cipher, stored.bot_token_cipher);
        assert_eq!(open_token(&other_region, &dek(8)).unwrap(), token);
    }

    /// FL-3: whichever order two regions receive clashing installs in, both keep the same row.
    #[tokio::test]
    async fn test_two_regions_converge_on_the_newer_install() {
        let older = install("i1", "acme", "T1");
        let same_org = ChatInstall {
            workspace_id: "T2".into(),
            updated_at: 200,
            ..install("i2", "acme", "T2")
        };
        let same_workspace = ChatInstall {
            updated_at: 200,
            ..install("i3", "globex", "T1")
        };
        for newer in [same_org, same_workspace] {
            let mut held = Vec::new();
            for order in [[&older, &newer], [&newer, &older]] {
                let db = db().await;
                for put in order {
                    put_replica_in(&db, put).await.unwrap();
                }
                held.push(rows(&db).await);
            }
            assert_eq!(held[0], held[1], "{}", newer.id);
            assert_eq!(held[0], vec![to_model(&newer)], "{}", newer.id);
        }
    }

    /// FL-3: `set_status` bumps `updated_at`, so revoked beats the earlier active Put.
    #[tokio::test]
    async fn test_a_revoked_put_beats_the_earlier_active_put_in_either_order() {
        let active = install("i1", "acme", "T1");
        let revoked = ChatInstall {
            status: InstallStatus::Revoked,
            updated_at: 300,
            ..active.clone()
        };
        for order in [[&active, &revoked], [&revoked, &active]] {
            let db = db().await;
            for put in order {
                put_replica_in(&db, put).await.unwrap();
            }
            let got = get_for_org_in(&db, "acme", ChatPlatform::Slack)
                .await
                .unwrap();
            assert_eq!(got.as_ref(), Some(&revoked));
        }
    }

    /// FL-3: installs tied on `(updated_at, installed_at)` are ordered by `org_id`.
    #[tokio::test]
    async fn test_a_tie_on_time_goes_to_the_greater_org_id() {
        let acme = install("i1", "acme", "T1");
        let globex = install("i2", "globex", "T1");
        for order in [[&acme, &globex], [&globex, &acme]] {
            let db = db().await;
            for put in order {
                put_replica_in(&db, put).await.unwrap();
            }
            assert_eq!(rows(&db).await, vec![to_model(&globex)]);
        }
    }

    /// Every later write of `event` to the table aborts, as a lost connection would.
    async fn fail(db: &DatabaseConnection, event: &str) {
        db.execute(Statement::from_string(
            db.get_database_backend(),
            format!(
                "CREATE TRIGGER fail_{event} BEFORE {event} ON oncall_chat_installs \
                 BEGIN SELECT RAISE(ABORT, 'forced'); END"
            ),
        ))
        .await
        .unwrap();
    }

    /// The disconnect of `install` as it travels: its workspace and its rank.
    async fn delete_of(db: &DatabaseConnection, install: &ChatInstall) -> bool {
        delete_replica_in(
            db,
            &install.org_id,
            install.platform,
            &install.workspace_id,
            install.updated_at,
            install.installed_at,
        )
        .await
        .unwrap()
    }

    /// A disconnect never removes a newer reconnect from another region, in any order.
    #[tokio::test]
    async fn test_a_disconnect_never_removes_a_newer_reconnect() {
        let old = install("i1", "acme", "T1");
        let reconnect = ChatInstall {
            installed_at: 200,
            updated_at: 200,
            ..install("i2", "acme", "T1")
        };

        let reconnected_here = db().await;
        put_in(&reconnected_here, &reconnect).await.unwrap();
        assert!(!delete_of(&reconnected_here, &old).await);
        assert_eq!(rows(&reconnected_here).await, vec![to_model(&reconnect)]);

        for delete_first in [true, false] {
            let bystander = db().await;
            put_in(&bystander, &old).await.unwrap();
            if delete_first {
                assert!(delete_of(&bystander, &old).await);
            }
            put_replica_in(&bystander, &reconnect).await.unwrap();
            if !delete_first {
                assert!(!delete_of(&bystander, &old).await);
            }
            assert_eq!(
                rows(&bystander).await,
                vec![to_model(&reconnect)],
                "delete first: {delete_first}"
            );
        }
    }

    /// No master key or no DEK means an error and no row, on both sealing paths.
    #[tokio::test]
    async fn test_a_token_put_without_a_key_writes_nothing() {
        let db = db().await;
        let i1 = install("i1", "acme", "T1");
        assert!(
            put_with_token_in(&db, false, async || Ok(dek(7)), &i1, "xoxb")
                .await
                .is_err()
        );
        assert!(
            put_with_token_in(
                &db,
                true,
                async || Err(errors::Error::Message("no dek".into())),
                &i1,
                "xoxb"
            )
            .await
            .is_err()
        );
        assert!(
            put_replica_with_token_in(&db, false, async || Ok(dek(7)), &i1, "xoxb")
                .await
                .is_err()
        );
        assert!(
            put_replica_with_token_in(
                &db,
                true,
                async || Err(errors::Error::Message("no dek".into())),
                &i1,
                "xoxb"
            )
            .await
            .is_err()
        );
        assert!(rows(&db).await.is_empty());
    }

    /// A replica Put whose insert fails after its delete leaves the clashing row in place.
    #[tokio::test]
    async fn test_a_failed_replica_put_leaves_the_table() {
        let db = db().await;
        put_in(&db, &install("i1", "acme", "T1")).await.unwrap();
        let before = rows(&db).await;
        fail(&db, "INSERT").await;

        let newer = ChatInstall {
            updated_at: 200,
            ..install("i2", "acme", "T2")
        };
        assert!(put_replica_in(&db, &newer).await.is_err());

        assert_eq!(rows(&db).await, before);
    }

    /// A replica disconnect that fails leaves the install in place.
    #[tokio::test]
    async fn test_a_failed_replica_delete_leaves_the_table() {
        let db = db().await;
        let i1 = install("i1", "acme", "T1");
        put_in(&db, &i1).await.unwrap();
        let before = rows(&db).await;
        fail(&db, "DELETE").await;

        assert!(
            delete_replica_in(&db, "acme", ChatPlatform::Slack, "T1", 100, 100)
                .await
                .is_err()
        );

        assert_eq!(rows(&db).await, before);
    }
}
