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

use config::{meta::slack::SlackInstallation, utils::json};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Iterable, QueryFilter, QueryOrder, Select, Set,
    sea_query::{Expr, OnConflict},
};

use super::{
    entity::slack_installations::{ActiveModel, Column, Entity, Model},
    slack_shared::{
        db_err, decode_all, enum_text, open, parse_enum, parse_json, seal, secrets_key,
    },
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors::Error,
};

const SECRET_COLUMNS: [Column; 6] = [
    Column::BotTokenEnc,
    Column::RefreshTokenEnc,
    Column::SigningSecretEnc,
    Column::AppTokenEnc,
    Column::ClientSecretEnc,
    Column::ConfigRefreshTokenEnc,
];

pub async fn put(row: &SlackInstallation) -> Result<(), Error> {
    put_with(get_orm_client_rw().await, row).await
}

pub async fn get(id: &str) -> Result<Option<SlackInstallation>, Error> {
    get_with(get_orm_client_ro().await, id).await
}

pub async fn get_by_team(
    app_id: &str,
    enterprise_id: &str,
    team_id: &str,
) -> Result<Option<SlackInstallation>, Error> {
    get_by_team_with(get_orm_client_ro().await, app_id, enterprise_id, team_id).await
}

pub async fn list() -> Result<Vec<SlackInstallation>, Error> {
    list_with(get_orm_client_ro().await).await
}

pub async fn list_by_ids(ids: &[String]) -> Result<Vec<SlackInstallation>, Error> {
    list_by_ids_with(get_orm_client_ro().await, ids).await
}

/// Sets `revoked_at` and nulls every `*_enc` column.
pub async fn revoke(id: &str, at: i64) -> Result<(), Error> {
    revoke_with(get_orm_client_rw().await, id, at).await
}

pub async fn delete(id: &str) -> Result<(), Error> {
    delete_with(get_orm_client_rw().await, id).await
}

pub async fn put_with<C: ConnectionTrait>(conn: &C, row: &SlackInstallation) -> Result<(), Error> {
    let key = secrets_key(plaintext_secrets(row).iter().any(Option::is_some)).await?;
    put_keyed(conn, row, key.as_deref()).await
}

pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    id: &str,
) -> Result<Option<SlackInstallation>, Error> {
    open_one(live().filter(Column::Id.eq(id)).one(conn).await?).await
}

pub async fn get_by_team_with<C: ConnectionTrait>(
    conn: &C,
    app_id: &str,
    enterprise_id: &str,
    team_id: &str,
) -> Result<Option<SlackInstallation>, Error> {
    let model = live()
        .filter(Column::AppId.eq(app_id))
        .filter(Column::EnterpriseId.eq(enterprise_id))
        .filter(Column::TeamId.eq(team_id))
        .one(conn)
        .await?;
    open_one(model).await
}

pub async fn list_with<C: ConnectionTrait>(conn: &C) -> Result<Vec<SlackInstallation>, Error> {
    open_all(live().order_by_asc(Column::Id).all(conn).await?).await
}

pub async fn list_by_ids_with<C: ConnectionTrait>(
    conn: &C,
    ids: &[String],
) -> Result<Vec<SlackInstallation>, Error> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let models = live()
        .filter(Column::Id.is_in(ids.iter().map(String::as_str)))
        .order_by_asc(Column::Id)
        .all(conn)
        .await?;
    open_all(models).await
}

pub async fn revoke_with<C: ConnectionTrait>(conn: &C, id: &str, at: i64) -> Result<(), Error> {
    let mut update = Entity::update_many()
        .col_expr(Column::RevokedAt, Expr::value(at))
        .col_expr(Column::UpdatedAt, Expr::value(at));
    for column in SECRET_COLUMNS {
        update = update.col_expr(column, Expr::value(Option::<String>::None));
    }
    update.filter(Column::Id.eq(id)).exec(conn).await?;
    Ok(())
}

pub async fn delete_with<C: ConnectionTrait>(conn: &C, id: &str) -> Result<(), Error> {
    Entity::delete_by_id(id).exec(conn).await?;
    Ok(())
}

fn live() -> Select<Entity> {
    Entity::find().filter(Column::DeletedAt.is_null())
}

async fn put_keyed<C: ConnectionTrait>(
    conn: &C,
    row: &SlackInstallation,
    key: Option<&[u8]>,
) -> Result<(), Error> {
    Entity::insert(to_active(row, key)?)
        .on_conflict(
            OnConflict::column(Column::Id)
                .update_columns(Column::iter().filter(|c| !matches!(c, Column::Id)))
                .to_owned(),
        )
        .exec_without_returning(conn)
        .await
        .map_err(db_err)?;
    Ok(())
}

async fn open_one(model: Option<Model>) -> Result<Option<SlackInstallation>, Error> {
    let Some(model) = model else {
        return Ok(None);
    };
    let key = secrets_key(stored_secrets(&model).iter().any(Option::is_some)).await?;
    from_model(model, key.as_deref()).map(Some)
}

async fn open_all(models: Vec<Model>) -> Result<Vec<SlackInstallation>, Error> {
    let needed = models
        .iter()
        .any(|m| stored_secrets(m).iter().any(Option::is_some));
    let key = secrets_key(needed).await?;
    Ok(decode_all(
        "slack_installations",
        models,
        |m| m.id.clone(),
        |m| from_model(m, key.as_deref()),
    ))
}

fn plaintext_secrets(row: &SlackInstallation) -> [Option<&str>; 6] {
    [
        row.bot_token.as_deref(),
        row.refresh_token.as_deref(),
        row.signing_secret.as_deref(),
        row.app_token.as_deref(),
        row.client_secret.as_deref(),
        row.config_refresh_token.as_deref(),
    ]
}

fn stored_secrets(model: &Model) -> [Option<String>; 6] {
    [
        model.bot_token_enc.clone(),
        model.refresh_token_enc.clone(),
        model.signing_secret_enc.clone(),
        model.app_token_enc.clone(),
        model.client_secret_enc.clone(),
        model.config_refresh_token_enc.clone(),
    ]
}

fn to_active(row: &SlackInstallation, key: Option<&[u8]>) -> Result<ActiveModel, Error> {
    let [bot, refresh, signing, app, client, config_refresh] = plaintext_secrets(row);
    Ok(ActiveModel {
        id: Set(row.id.clone()),
        app_id: Set(row.app_id.clone()),
        enterprise_id: Set(row.enterprise_id.clone()),
        team_id: Set(row.team_id.clone()),
        team_name: Set(row.team_name.clone()),
        is_enterprise_install: Set(row.is_enterprise_install),
        bot_user_id: Set(row.bot_user_id.clone()),
        bot_token_enc: Set(seal(key, bot)?),
        refresh_token_enc: Set(seal(key, refresh)?),
        token_expires_at: Set(row.token_expires_at),
        signing_secret_enc: Set(seal(key, signing)?),
        app_token_enc: Set(seal(key, app)?),
        client_id: Set(row.client_id.clone()),
        client_secret_enc: Set(seal(key, client)?),
        config_refresh_token_enc: Set(seal(key, config_refresh)?),
        manifest_options: Set(json::to_string(&row.manifest_options)?),
        auto_link_enabled: Set(row.auto_link_enabled),
        auto_link_domains: Set(json::to_string(&row.auto_link_domains)?),
        mode: Set(enum_text(&row.mode)?),
        home_region: Set(row.home_region.clone()),
        installed_by: Set(row.installed_by.clone()),
        installed_org_id: Set(row.installed_org_id.clone()),
        created_at: Set(row.created_at),
        revoked_at: Set(row.revoked_at),
        updated_at: Set(row.updated_at),
        origin_region: Set(row.origin_region.clone()),
        deleted_at: Set(row.deleted_at),
    })
}

fn from_model(model: Model, key: Option<&[u8]>) -> Result<SlackInstallation, Error> {
    let opened = stored_secrets(&model).map(|stored| open(key, stored.as_deref()));
    let credentials_readable = opened.iter().all(|(_, readable)| *readable);
    let [
        bot_token,
        refresh_token,
        signing_secret,
        app_token,
        client_secret,
        config_refresh_token,
    ] = opened.map(|(value, _)| value);
    Ok(SlackInstallation {
        id: model.id,
        app_id: model.app_id,
        enterprise_id: model.enterprise_id,
        team_id: model.team_id,
        team_name: model.team_name,
        is_enterprise_install: model.is_enterprise_install,
        bot_user_id: model.bot_user_id,
        bot_token,
        refresh_token,
        token_expires_at: model.token_expires_at,
        signing_secret,
        app_token,
        client_id: model.client_id,
        client_secret,
        config_refresh_token,
        manifest_options: parse_json(Some(&model.manifest_options))?,
        auto_link_enabled: model.auto_link_enabled,
        auto_link_domains: parse_json(Some(&model.auto_link_domains))?,
        mode: parse_enum("mode", &model.mode)?,
        home_region: model.home_region,
        installed_by: model.installed_by,
        installed_org_id: model.installed_org_id,
        created_at: model.created_at,
        revoked_at: model.revoked_at,
        updated_at: model.updated_at,
        origin_region: model.origin_region,
        deleted_at: model.deleted_at,
        credentials_readable,
    })
}

#[cfg(test)]
mod tests {
    use config::{
        meta::slack::{ManifestOptions, Mode},
        utils::encryption::decrypt_secret_value,
    };
    use sea_orm::{Database, DatabaseConnection, DbBackend, EntityTrait, Statement};

    use super::*;
    use crate::{errors::DbError, table::slack::create_tables_for_test};

    const KEY: [u8; 64] = [5u8; 64];

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_tables_for_test(&db).await.unwrap();
        db
    }

    fn installation(id: &str, team_id: &str) -> SlackInstallation {
        SlackInstallation {
            id: id.to_string(),
            app_id: "A0APP".to_string(),
            enterprise_id: String::new(),
            team_id: team_id.to_string(),
            team_name: "Acme".to_string(),
            is_enterprise_install: false,
            bot_user_id: Some("U0BOT".to_string()),
            bot_token: Some("xoxb-bot".to_string()),
            refresh_token: Some("xoxe-refresh".to_string()),
            token_expires_at: Some(1_700_000_000_000_000),
            signing_secret: Some("signing".to_string()),
            app_token: Some("xapp-1".to_string()),
            client_id: Some("123.456".to_string()),
            client_secret: Some("client-secret".to_string()),
            config_refresh_token: Some("xoxe-config".to_string()),
            manifest_options: ManifestOptions {
                app_name: "OpenObserve".to_string(),
                channel_history: true,
                command: "/o2".to_string(),
            },
            auto_link_enabled: true,
            auto_link_domains: vec!["acme.com".to_string(), "acme.io".to_string()],
            mode: Mode::Http,
            home_region: "us-east".to_string(),
            installed_by: "admin@acme.com".to_string(),
            installed_org_id: "acme".to_string(),
            created_at: 1_700,
            revoked_at: None,
            updated_at: 1_800,
            origin_region: "default".to_string(),
            deleted_at: None,
            credentials_readable: true,
        }
    }

    fn plaintext_secrets(row: &SlackInstallation) -> [Option<String>; 6] {
        [
            row.bot_token.clone(),
            row.refresh_token.clone(),
            row.signing_secret.clone(),
            row.app_token.clone(),
            row.client_secret.clone(),
            row.config_refresh_token.clone(),
        ]
    }

    fn without_secrets(row: SlackInstallation) -> SlackInstallation {
        SlackInstallation {
            bot_token: None,
            refresh_token: None,
            signing_secret: None,
            app_token: None,
            client_secret: None,
            config_refresh_token: None,
            ..row
        }
    }

    async fn stored_secrets(db: &DatabaseConnection, id: &str) -> Vec<Option<String>> {
        let columns = [
            "bot_token_enc",
            "refresh_token_enc",
            "signing_secret_enc",
            "app_token_enc",
            "client_secret_enc",
            "config_refresh_token_enc",
        ];
        let row = db
            .query_one(Statement::from_string(
                DbBackend::Sqlite,
                format!(
                    "SELECT {} FROM slack_installations WHERE id = '{id}'",
                    columns.join(", ")
                ),
            ))
            .await
            .unwrap()
            .unwrap();
        columns
            .iter()
            .map(|c| row.try_get::<Option<String>>("", c).unwrap())
            .collect()
    }

    async fn stored_model(db: &DatabaseConnection, id: &str) -> Model {
        Entity::find_by_id(id).one(db).await.unwrap().unwrap()
    }

    #[tokio::test]
    async fn unique_without_enterprise() {
        let db = db().await;
        put_with(&db, &installation("i1", "T1")).await.unwrap();
        let err = put_with(&db, &installation("i2", "T1")).await.unwrap_err();
        assert!(
            matches!(err, Error::DbError(DbError::UniqueViolation)),
            "{err}"
        );
        put_with(&db, &installation("i3", "T2")).await.unwrap();
        let mut grid = installation("i4", "T1");
        grid.enterprise_id = "E1".to_string();
        put_with(&db, &grid).await.unwrap();
        assert_eq!(list_with(&db).await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn secrets_are_stored_aesenc_under_the_dek_and_every_column_reads_back() {
        let db = db().await;
        let row = installation("i1", "T1");
        put_keyed(&db, &row, Some(&KEY)).await.unwrap();
        let stored = stored_secrets(&db, "i1").await;
        for (stored, plain) in stored.iter().zip(plaintext_secrets(&row)) {
            let stored = stored.as_deref().unwrap();
            let plain = plain.unwrap();
            assert!(stored.starts_with("AESenc:"), "{stored}");
            assert!(!stored.contains(&plain));
            assert_eq!(decrypt_secret_value(&KEY, stored).unwrap(), plain);
        }
        let read = from_model(stored_model(&db, "i1").await, Some(&KEY)).unwrap();
        assert!(read == row, "every column must read back as written");
    }

    #[tokio::test]
    async fn a_replaced_dek_marks_credentials_unreadable_and_keeps_the_row() {
        let db = db().await;
        let row = installation("i1", "T1");
        put_keyed(&db, &row, Some(&KEY)).await.unwrap();
        let read = from_model(stored_model(&db, "i1").await, Some(&[9u8; 64])).unwrap();
        let expected = SlackInstallation {
            credentials_readable: false,
            ..without_secrets(row.clone())
        };
        assert!(read == expected);
        let read = from_model(stored_model(&db, "i1").await, None).unwrap();
        assert!(
            read == expected,
            "a stored secret without a key is unreadable"
        );
    }

    #[tokio::test]
    async fn revoke_nulls_every_secret() {
        let db = db().await;
        put_keyed(&db, &installation("i1", "T1"), Some(&KEY))
            .await
            .unwrap();
        revoke_with(&db, "i1", 2_000).await.unwrap();
        assert!(stored_secrets(&db, "i1").await.iter().all(Option::is_none));
        let read = get_with(&db, "i1").await.unwrap().unwrap();
        assert_eq!(read.revoked_at, Some(2_000));
        assert_eq!(read.updated_at, 2_000);
        assert!(read.credentials_readable);
        assert!(plaintext_secrets(&read).iter().all(Option::is_none));
    }

    #[tokio::test]
    async fn no_master_key_stores_null() {
        assert!(!crate::table::cipher::is_encrypting());
        let db = db().await;
        let row = installation("i1", "T1");
        put_with(&db, &row).await.unwrap();
        assert!(stored_secrets(&db, "i1").await.iter().all(Option::is_none));
        let read = get_with(&db, "i1").await.unwrap().unwrap();
        assert!(read == without_secrets(row));
    }

    #[tokio::test]
    async fn put_replaces_by_id_and_reads_skip_deleted_rows() {
        let db = db().await;
        let mut row = installation("i1", "T1");
        put_with(&db, &row).await.unwrap();
        row.team_name = "Acme Corp".to_string();
        row.revoked_at = Some(5);
        put_with(&db, &row).await.unwrap();
        let read = get_with(&db, "i1").await.unwrap().unwrap();
        assert_eq!(
            (read.team_name.as_str(), read.revoked_at),
            ("Acme Corp", Some(5))
        );

        let mut gone = installation("i2", "T2");
        gone.deleted_at = Some(10);
        put_with(&db, &gone).await.unwrap();
        assert!(get_with(&db, "i2").await.unwrap().is_none());
        assert!(
            get_by_team_with(&db, "A0APP", "", "T2")
                .await
                .unwrap()
                .is_none()
        );
        let ids = |rows: Vec<SlackInstallation>| rows.into_iter().map(|r| r.id).collect::<Vec<_>>();
        assert_eq!(ids(list_with(&db).await.unwrap()), ["i1"]);
        let wanted = ["i1".to_string(), "i2".to_string()];
        assert_eq!(ids(list_by_ids_with(&db, &wanted).await.unwrap()), ["i1"]);
    }

    #[tokio::test]
    async fn lookups_by_team_and_ids_and_delete() {
        let db = db().await;
        for (id, team) in [("i1", "T1"), ("i2", "T2"), ("i3", "T3")] {
            put_with(&db, &installation(id, team)).await.unwrap();
        }
        let found = get_by_team_with(&db, "A0APP", "", "T2").await.unwrap();
        assert_eq!(found.map(|r| r.id), Some("i2".to_string()));
        assert!(
            get_by_team_with(&db, "A0APP", "E1", "T2")
                .await
                .unwrap()
                .is_none()
        );
        let wanted = ["i3".to_string(), "i1".to_string(), "nope".to_string()];
        let mut ids: Vec<String> = list_by_ids_with(&db, &wanted)
            .await
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        ids.sort();
        assert_eq!(ids, ["i1", "i3"]);
        assert!(list_by_ids_with(&db, &[]).await.unwrap().is_empty());
        delete_with(&db, "i2").await.unwrap();
        assert!(get_with(&db, "i2").await.unwrap().is_none());
        assert_eq!(list_with(&db).await.unwrap().len(), 2);
    }
}
