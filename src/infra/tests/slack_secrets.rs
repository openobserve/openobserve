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

//! Own test binary: installing the process-wide master key would break other infra tests.

use base64::{Engine, prelude::BASE64_STANDARD};
use config::{
    meta::slack::{ManifestOptions, Mode, SlackInstallation, SlackLinkRequest},
    utils::encryption::decrypt_secret_value,
};
use infra::{
    db::get_orm_client_rw,
    table::{
        cipher::{self, DEFAULT_DEK_NAME, EntryKind},
        slack_installations, slack_link_requests,
    },
};
use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement};

const INSTALLATION_SECRETS: [&str; 6] = [
    "bot_token_enc",
    "refresh_token_enc",
    "signing_secret_enc",
    "app_token_enc",
    "client_secret_enc",
    "config_refresh_token_enc",
];

fn installation() -> SlackInstallation {
    SlackInstallation {
        id: "I1".to_string(),
        app_id: "A0APP".to_string(),
        team_id: "T1".to_string(),
        team_name: "Acme".to_string(),
        bot_user_id: Some("U0BOT".to_string()),
        bot_token: Some("xoxb-bot".to_string()),
        refresh_token: Some("xoxe-refresh".to_string()),
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
        mode: Mode::Socket,
        home_region: "default".to_string(),
        installed_by: "admin@acme.com".to_string(),
        installed_org_id: "acme".to_string(),
        created_at: 10,
        updated_at: 20,
        origin_region: "default".to_string(),
        credentials_readable: true,
        ..Default::default()
    }
}

fn plaintexts(row: &SlackInstallation) -> [Option<String>; 6] {
    [
        row.bot_token.clone(),
        row.refresh_token.clone(),
        row.signing_secret.clone(),
        row.app_token.clone(),
        row.client_secret.clone(),
        row.config_refresh_token.clone(),
    ]
}

async fn raw_column(
    conn: &DatabaseConnection,
    table: &str,
    column: &str,
    id: &str,
) -> Option<String> {
    let sql = format!("SELECT {column} FROM {table} WHERE id = '{id}'");
    conn.query_one(Statement::from_string(DbBackend::Sqlite, sql))
        .await
        .unwrap()
        .expect("row exists")
        .try_get::<Option<String>>("", column)
        .unwrap()
}

async fn boot_with_master_key(data_dir: &std::path::Path) {
    let dir = format!("{}/", data_dir.display());
    // SAFETY: set before any thread reads the config, which is loaded once on first use.
    unsafe {
        std::env::set_var("ZO_LOCAL_MODE", "true");
        std::env::set_var("ZO_META_STORE", "sqlite");
        std::env::set_var("ZO_DATA_DIR", &dir);
        std::env::set_var("ZO_DATA_DB_DIR", format!("{dir}db/"));
    }
    std::fs::create_dir_all(data_dir.join("db")).unwrap();
    infra::db::create_table().await.unwrap();
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    assert!(!cipher::is_encrypting());
    let master_key = BASE64_STANDARD.encode([9u8; 64]);
    cipher::boot(Some(&master_key)).await.unwrap();
    assert!(cipher::is_encrypting(), "the master key is installed");
}

async fn installation_round_trip(conn: &DatabaseConnection, meta_dek: &[u8]) {
    let row = installation();
    slack_installations::put_with(conn, &row).await.unwrap();
    for (column, plaintext) in INSTALLATION_SECRETS.iter().zip(plaintexts(&row)) {
        let stored = raw_column(conn, "slack_installations", column, "I1")
            .await
            .unwrap();
        assert!(stored.starts_with("AESenc:"), "{column}: {stored}");
        let plaintext = plaintext.unwrap();
        assert!(!stored.contains(&plaintext), "{column} stored in clear");
        assert_eq!(
            decrypt_secret_value(meta_dek, &stored).unwrap(),
            plaintext,
            "{column}"
        );
    }
    let read = slack_installations::get_with(conn, "I1")
        .await
        .unwrap()
        .unwrap();
    assert!(read == row, "read back differs from what was written");
    assert!(read.credentials_readable);

    readable_after_the_installing_org_loses_its_keys(conn, &row).await;

    slack_installations::revoke_with(conn, "I1", 30)
        .await
        .unwrap();
    for column in INSTALLATION_SECRETS {
        assert_eq!(
            raw_column(conn, "slack_installations", column, "I1").await,
            None,
            "{column}"
        );
    }
    let revoked = slack_installations::get_with(conn, "I1")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(revoked.revoked_at, Some(30));
    assert!(plaintexts(&revoked).iter().all(Option::is_none));
    assert!(revoked.credentials_readable);
}

/// AC-2.4: the installing org's keys go with the org, and the secrets must not go with them.
async fn readable_after_the_installing_org_loses_its_keys(
    conn: &DatabaseConnection,
    row: &SlackInstallation,
) {
    let org = row.installed_org_id.as_str();
    cipher::get_dek(org).await.unwrap();
    assert!(org_dek_stored(org).await, "the installing org has a DEK");
    cipher::delete_by_org(org).await.unwrap();
    assert!(
        !org_dek_stored(org).await,
        "the installing org's DEK is gone"
    );
    let read = slack_installations::get_with(conn, &row.id)
        .await
        .unwrap()
        .unwrap();
    assert!(read.credentials_readable);
    assert!(
        read == *row,
        "secrets unreadable after the installing org's keys went"
    );
    let stored = raw_column(conn, "slack_installations", "bot_token_enc", &row.id)
        .await
        .unwrap();
    let uncached_meta_dek = cipher::get_or_create_dek("_meta").await.unwrap();
    assert_eq!(
        decrypt_secret_value(&uncached_meta_dek, &stored).unwrap(),
        "xoxb-bot"
    );
    let new_org_dek = cipher::get_or_create_dek(org).await.unwrap();
    assert!(decrypt_secret_value(&new_org_dek, &stored).is_err());
}

async fn org_dek_stored(org: &str) -> bool {
    cipher::get_data(org, EntryKind::CipherKey, DEFAULT_DEK_NAME)
        .await
        .unwrap()
        .is_some()
}

async fn link_request_round_trip(conn: &DatabaseConnection, meta_dek: &[u8]) {
    let request = SlackLinkRequest {
        id: "R1".to_string(),
        installation_id: "I1".to_string(),
        external_user_id: "U1".to_string(),
        workspace_user_id: "U1".to_string(),
        question: Some("why is checkout slow?".to_string()),
        oidc_nonce: Some("nonce-1".to_string()),
        held_action: None,
        created_at: 10,
        expires_at: 20,
        updated_at: 10,
        origin_region: "default".to_string(),
        ..Default::default()
    };
    slack_link_requests::put_with(conn, &request).await.unwrap();
    let stored = raw_column(conn, "slack_link_requests", "question_enc", "R1")
        .await
        .unwrap();
    assert!(stored.starts_with("AESenc:"), "{stored}");
    assert_eq!(
        decrypt_secret_value(meta_dek, &stored).unwrap(),
        "why is checkout slow?"
    );
    let read = slack_link_requests::get_with(conn, "R1")
        .await
        .unwrap()
        .unwrap();
    assert!(read == request, "read back differs from what was written");

    slack_link_requests::mark_discarded_with(conn, "R1", 15)
        .await
        .unwrap();
    assert_eq!(
        raw_column(conn, "slack_link_requests", "question_enc", "R1").await,
        None
    );
}

#[tokio::test]
async fn secrets_are_encrypted_under_the_meta_dek_when_a_master_key_is_set() {
    let data_dir = tempfile::tempdir().unwrap();
    boot_with_master_key(data_dir.path()).await;
    let conn = get_orm_client_rw().await;
    let meta_dek = cipher::get_dek("_meta").await.unwrap();
    installation_round_trip(conn, &meta_dek).await;
    link_request_round_trip(conn, &meta_dek).await;
}
