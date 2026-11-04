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

//! Own test binary: the meta store, its DEK and the master key are process-wide.

use std::sync::LazyLock;

use base64::{Engine, prelude::BASE64_STANDARD};
use infra::{
    db::get_orm_client_rw,
    secrets::{self, SecretMaterial, SecretOwnerKind},
    table::{
        cipher,
        entity::llm_secrets,
        workflow_http_triggers::{
            self as triggers, ApplyOutcome, AuthMode, CredentialKind, CredentialState,
            ReplicatedCredential, ReplicatedTrigger, TriggerSnapshot,
        },
    },
};
use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter};
use sha2::{Digest, Sha256};
use tokio::sync::OnceCell;

const PLAINTEXT: &str = "whsec_cGxhaW4tdGV4dC1zaWduaW5nLXNlY3JldA==";
const TOKEN: &str = "o2wh_cGxhaW4tdGV4dC10b2tlbi12YWx1ZS1mb3ItdGVzdHM";

// One runtime for every test: the global DB pool must not outlive the runtime that opened it.
static RUNTIME: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
});
static DATA_DIR: LazyLock<tempfile::TempDir> = LazyLock::new(|| tempfile::tempdir().unwrap());
static BOOTED: OnceCell<()> = OnceCell::const_new();

async fn boot_with_master_key() {
    BOOTED
        .get_or_init(|| async {
            let data_dir = DATA_DIR.path();
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
            cipher::boot(Some(&BASE64_STANDARD.encode([7u8; 64])))
                .await
                .unwrap();
            assert!(cipher::is_encrypting());
        })
        .await;
}

fn snapshot(version: i64, state: CredentialState, secret: Option<&str>) -> TriggerSnapshot {
    TriggerSnapshot {
        version,
        origin_cluster: "r2".to_string(),
        deleted: false,
        trigger: ReplicatedTrigger {
            id: "trig-1".to_string(),
            org_id: "acme".to_string(),
            workflow_id: "wf-1".to_string(),
            enabled: true,
            auth_mode: AuthMode::Signature,
            max_body_bytes: 1_048_576,
            rate_limit_per_minute: 60,
            created_by: "a@x.io".to_string(),
            created_at: 1,
            updated_at: version,
            deleted_at: None,
        },
        credentials: vec![ReplicatedCredential {
            id: "cred-1".to_string(),
            kind: CredentialKind::SigningSecret,
            display_prefix: "whsec_cGxh…PQ==".to_string(),
            token_sha256: None,
            state,
            expires_at: None,
            revoked_at: (state == CredentialState::Revoked).then_some(version),
            created_by: "a@x.io".to_string(),
            created_at: 1,
            updated_at: version,
            secret: secret.map(str::to_string),
        }],
    }
}

fn token_snapshot() -> TriggerSnapshot {
    let mut snap = snapshot(1, CredentialState::Active, Some(TOKEN));
    snap.trigger.id = "trig-tok".to_string();
    snap.trigger.workflow_id = "wf-tok".to_string();
    snap.trigger.auth_mode = AuthMode::Token;
    let credential = &mut snap.credentials[0];
    credential.id = "cred-tok".to_string();
    credential.kind = CredentialKind::Token;
    credential.display_prefix = "o2wh_cGxh…ZXN0".to_string();
    credential.token_sha256 = Some(format!("{:x}", Sha256::digest(TOKEN.as_bytes())));
    snap
}

async fn secret_row(trigger_id: &str) -> llm_secrets::Model {
    let db = get_orm_client_rw().await;
    let stored = triggers::list_credentials(db, trigger_id).await.unwrap();
    let secret_ref = stored[0].secret_ref.clone().expect("a local secret");
    llm_secrets::Entity::find()
        .filter(llm_secrets::Column::SecretRef.eq(&secret_ref))
        .one(db)
        .await
        .unwrap()
        .expect("the secret row")
}

#[test]
fn a_signing_secret_is_encrypted_locally_on_first_sight() {
    RUNTIME.block_on(async {
        boot_with_master_key().await;
        let db = get_orm_client_rw().await;

        let first = snapshot(1, CredentialState::Active, Some(PLAINTEXT));
        let applied = triggers::apply_snapshot(first.clone()).await.unwrap();
        assert_eq!(applied, ApplyOutcome::Applied);
        let row = secret_row("trig-1").await;
        assert_eq!(
            (
                row.owner_kind.as_str(),
                row.owner_id.as_str(),
                row.purpose.as_str()
            ),
            ("workflow_trigger", "cred-1", "signing")
        );
        assert!(!row.ciphertext.contains(PLAINTEXT));
        assert_eq!(
            triggers::load_snapshot("trig-1").await.unwrap(),
            Some(first)
        );

        let redelivered = snapshot(1, CredentialState::Active, Some(PLAINTEXT));
        let stale = triggers::apply_snapshot(redelivered).await.unwrap();
        assert_eq!(stale, ApplyOutcome::Stale);

        let revoked = triggers::apply_snapshot(snapshot(2, CredentialState::Revoked, None))
            .await
            .unwrap();
        assert_eq!(revoked, ApplyOutcome::Applied);
        let left = llm_secrets::Entity::find()
            .filter(llm_secrets::Column::OwnerId.eq("cred-1"))
            .count(db)
            .await
            .unwrap();
        assert_eq!(left, 0, "a revoked credential keeps no local secret");
        let reloaded = triggers::load_snapshot("trig-1").await.unwrap().unwrap();
        assert_eq!(reloaded.credentials[0].secret, None);
    });
}

#[test]
fn a_token_is_encrypted_locally_on_first_sight_with_purpose_auth() {
    RUNTIME.block_on(async {
        boot_with_master_key().await;
        let first = token_snapshot();
        let applied = triggers::apply_snapshot(first.clone()).await.unwrap();
        assert_eq!(applied, ApplyOutcome::Applied);
        let row = secret_row("trig-tok").await;
        assert_eq!(
            (
                row.owner_kind.as_str(),
                row.owner_id.as_str(),
                row.purpose.as_str()
            ),
            ("workflow_trigger", "cred-tok", "auth")
        );
        assert!(!row.ciphertext.contains(TOKEN));
        let (_, material) = secrets::resolve_record(
            "acme",
            &row.secret_ref,
            SecretOwnerKind::WorkflowTrigger,
            "cred-tok",
            secrets::CURRENT,
        )
        .await
        .unwrap();
        assert!(matches!(material, SecretMaterial::Token { value } if value == TOKEN));
        assert_eq!(
            triggers::load_snapshot("trig-tok").await.unwrap(),
            Some(first),
            "the receiver re-emits the plaintext it stored"
        );
    });
}
