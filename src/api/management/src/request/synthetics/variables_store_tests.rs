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

use std::future::Future;

use axum::{
    Json,
    body::to_bytes,
    extract::{Path, Query},
    http::StatusCode,
    response::Response,
};
use config::{
    ider::ksuid,
    meta::{
        cluster::Node,
        secret_store::{ConsumerType, GateState, ORG_ENV_ID, SecretKind},
        synthetics::{Synthetic, SyntheticType},
        synthetics_variables::SyntheticsVariableRequest,
        user::UserRole,
    },
};
use infra::{
    db::{get_orm_client_rw, sqlite::SqliteDb},
    secret_store::{
        bind::{BindPin, SecretBindOption},
        capability::{FgaMode, LEVEL_P1_11, STORE_FLOOR_VERSION, own_record, write_record_in},
        gate,
    },
    secrets::CURRENT,
    table::{
        cipher,
        credential_values::{self, NamedValueAd, NamedValueClass, SecretRecord, SlotClass},
        org_secret_values as values,
        org_secrets::{self, PinMode, PrivateLocations},
        org_users::OrgUserRecord,
        secret_consumer_auth,
        synthetics_locations::{self, KIND_PUBLIC, SyntheticsLocationRecord},
        synthetics_variables,
    },
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use sea_orm::{ActiveModelTrait, ActiveValue::Set};
use serde_json::json;

use super::{ForceQuery, StrictAuthz, delete_synthetics_variable, update_synthetics_variable};

const CHILD: &str = "O2_SYNTHETICS_VARIABLE_HTTP_TEST";
const ROOT: &str = "root-variable-http@example.com";
const OUTSIDER: &str = "outsider-variable-http@example.com";

struct Store {
    org: String,
    location: String,
}

impl Store {
    async fn new() -> Self {
        infra::db_init().await.unwrap();
        infra::table::migrate().await.unwrap();
        if cipher::master_key().is_err() {
            cipher::boot(None).await.unwrap();
        }
        latch_gate().await;
        common::infra::config::ORG_USERS.insert(
            format!("{}/{ROOT}", config::DEFAULT_ORG),
            OrgUserRecord {
                email: ROOT.into(),
                org_id: config::DEFAULT_ORG.into(),
                role: UserRole::Root,
                token: String::new(),
                rum_token: None,
                created_at: 1,
                allow_static_token: false,
            },
        );
        let org = format!("varhttp{}", ksuid().to_lowercase());
        cipher::get_dek(&org).await.unwrap();
        Self {
            org,
            location: location().await,
        }
    }

    async fn secret(&self) -> org_secrets::Model {
        let conn = get_orm_client_rw().await;
        let row = org_secrets::ActiveModel {
            id: Set(ksuid()),
            org_id: Set(self.org.clone()),
            name: Set("X".into()),
            kind: Set("secret".into()),
            state: Set("active".into()),
            description: Set(String::new()),
            allowed_hosts: Set("api.example.com".into()),
            pin_mode: Set(PinMode::Hosts),
            private_locations: Set(PrivateLocations::Off),
            policy_rev: Set(ksuid()),
            policy_version: Set(1),
            created_by: Set(ROOT.into()),
            updated_by: Set(ROOT.into()),
            created_at: Set(1),
            updated_at: Set(1),
            ..Default::default()
        }
        .insert(conn)
        .await
        .unwrap();
        let value = values::ActiveModel {
            id: Set(ksuid()),
            secret_id: Set(row.id.clone()),
            org_id: Set(self.org.clone()),
            env_id: Set(ORG_ENV_ID.into()),
            env_incarnation: Set(String::new()),
            state: Set("set".into()),
            value_ref: Set(Some(ksuid())),
            value_rev: Set(ksuid()),
            value_version: Set(1),
            updated_by: Set(ROOT.into()),
            backend_id: Set(None),
        }
        .insert(conn)
        .await
        .unwrap();
        let secret_ref = value.value_ref.clone().unwrap();
        let class = NamedValueClass::OrgSecret;
        let record = SecretRecord {
            id: ksuid(),
            secret_ref: secret_ref.clone(),
            org_id: self.org.clone(),
            owner_kind: class.owner_kind().into(),
            owner_id: value.id.clone(),
            purpose: "auth".into(),
            key_id: None,
            state: CURRENT.into(),
            value: "store-value".to_owned().into(),
            last_verified_at: None,
            grace_expires_at: None,
            created_at: 1,
            updated_at: 1,
        };
        let slot = SlotClass::NamedValue(NamedValueAd {
            org_id: &self.org,
            class,
            value_row_id: &value.id,
            secret_ref: &secret_ref,
            secret_id: &row.id,
            kind: SecretKind::Secret,
            env_id: &value.env_id,
            env_incarnation: &value.env_incarnation,
            value_rev: &value.value_rev,
        });
        let sealed = credential_values::encrypted_active_model(&record, &slot)
            .await
            .unwrap();
        credential_values::insert(conn, sealed).await.unwrap();
        row
    }

    async fn check_bound_to(&self, secret: &org_secrets::Model) -> Synthetic {
        let body = Synthetic {
            name: format!("http-{}", ksuid()),
            check_type: SyntheticType::Http,
            target: "https://api.example.com/{{PATH}}".into(),
            config: json!({
                "method": "GET",
                "headers": [{"name": "Authorization", "value": "Bearer {{secrets.X}}"}],
            }),
            locations: vec![self.location.clone()],
            alert_if_fails: 1,
            ..Default::default()
        };
        let authz = StrictAuthz {
            role: UserRole::Root,
        };
        let binds = vec![SecretBindOption {
            secret_id: secret.id.clone(),
            allow_this_consumer: true,
            pin: BindPin::Keep,
            expected_policy_rev: secret.policy_rev.clone(),
        }];
        openobserve_synthetics::service::create_synthetic_with_binds(
            &self.org,
            body,
            ROOT,
            Some(authz.actor(ROOT, "root")),
            binds,
        )
        .await
        .unwrap()
        .0
    }

    async fn path_variable(&self) -> String {
        openobserve_synthetics::service::create_variable(&self.org, None, path("before"), ROOT)
            .await
            .unwrap()
            .id
    }

    async fn stored_path(
        &self,
        id: &str,
    ) -> Option<synthetics_variables::SyntheticsVariableRecord> {
        synthetics_variables::get(get_orm_client_rw().await, &self.org, id)
            .await
            .unwrap()
    }

    async fn auth(&self, check: &Synthetic) -> secret_consumer_auth::Model {
        secret_consumer_auth::get_in(
            get_orm_client_rw().await,
            &self.org,
            ConsumerType::SyntheticsCheck.as_str(),
            &check.id,
        )
        .await
        .unwrap()
        .unwrap()
    }

    async fn update(&self, id: &str, user: &str, value: &str) -> Response {
        update_synthetics_variable(
            Path((self.org.clone(), id.to_owned())),
            Query(ForceQuery::default()),
            Headers(UserEmail {
                user_id: user.into(),
            }),
            Json(path(value)),
        )
        .await
    }

    async fn delete(&self, id: &str, user: &str) -> Response {
        delete_synthetics_variable(
            Path((self.org.clone(), id.to_owned())),
            Query(ForceQuery { force: true }),
            Headers(UserEmail {
                user_id: user.into(),
            }),
        )
        .await
    }
}

async fn latch_gate() {
    let coordinator = SqliteDb::new();
    let now = config::utils::time::now_micros();
    let mut record = own_record(FgaMode::On, now);
    record.level = LEVEL_P1_11;
    let mut nodes = Vec::new();
    for uuid in ["local", "peer"] {
        write_record_in(&coordinator, uuid, &record).await.unwrap();
        nodes.push(Node {
            uuid: uuid.into(),
            name: uuid.into(),
            version: STORE_FLOOR_VERSION.into(),
            ..Default::default()
        });
    }
    gate::evaluate_once_in(&coordinator, nodes, now)
        .await
        .unwrap();
    assert_eq!(gate::current().effective(), GateState::Latched);
}

async fn location() -> String {
    let id = ksuid();
    synthetics_locations::add(&SyntheticsLocationRecord {
        id: id.clone(),
        org_id: None,
        kind: KIND_PUBLIC.into(),
        provider: "test".into(),
        region: "test".into(),
        label: id.clone(),
        pool: id.clone(),
        enabled: true,
        created_at: 1,
        updated_at: 1,
    })
    .await
    .unwrap();
    synthetics_locations::invalidate_cache().await;
    id
}

fn path(value: &str) -> SyntheticsVariableRequest {
    SyntheticsVariableRequest {
        name: "PATH".into(),
        value: Some(value.into()),
        ..Default::default()
    }
}

async fn body(response: Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

async fn in_child<F: Future<Output = ()>>(name: &str, body: impl FnOnce() -> F) {
    if std::env::var(CHILD).as_deref() == Ok(name) {
        body().await;
        return;
    }
    let (Ok("postgres"), Ok(dsn)) = (
        std::env::var("ZO_META_STORE").as_deref(),
        std::env::var("ZO_META_POSTGRES_DSN"),
    ) else {
        eprintln!("skipped: needs ZO_META_STORE=postgres and ZO_META_POSTGRES_DSN");
        return;
    };
    let dir = std::env::temp_dir().join(ksuid());
    std::fs::create_dir(&dir).unwrap();
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    for (key, _) in std::env::vars_os().filter(|(key, _)| {
        let key = key.to_string_lossy();
        key.starts_with("ZO_") || key.starts_with("O2_")
    }) {
        command.env_remove(key);
    }
    let output = command
        .current_dir(&dir)
        .env(CHILD, name)
        .env("ZO_LOCAL_MODE", "true")
        .env("ZO_META_STORE", "postgres")
        .env("ZO_META_POSTGRES_DSN", dsn)
        .env("ZO_DATA_DIR", &dir)
        .env("O2_SECRET_STORE_REFS_ENABLED", "true")
        .args([
            "--exact",
            &format!("request::synthetics::variables_store_tests::{name}"),
            "--nocapture",
        ])
        .output();
    std::fs::remove_dir_all(dir).unwrap();
    let output = output.unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success() && stdout.contains("1 passed"),
        "{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[tokio::test]
async fn a_caller_with_secret_use_edits_a_variable_feeding_a_store_ref_check() {
    in_child(
        "a_caller_with_secret_use_edits_a_variable_feeding_a_store_ref_check",
        || async {
            let store = Store::new().await;
            let id = store.path_variable().await;
            let secret = store.secret().await;
            let check = store.check_bound_to(&secret).await;
            let before = store.auth(&check).await;
            let stored = store.stored_path(&id).await.unwrap();

            let response = store.update(&id, ROOT, "after").await;

            assert_eq!(response.status(), StatusCode::OK);
            let after = store.auth(&check).await;
            assert_eq!(after.consumer_rev, before.consumer_rev + 1);
            assert_eq!(after.via, "user:dependency");
            assert_eq!(after.authorized_by, ROOT);
            assert_ne!(store.stored_path(&id).await.unwrap().value, stored.value);
            assert_eq!(store.delete(&id, ROOT).await.status(), StatusCode::OK);
            assert!(store.stored_path(&id).await.is_none());
        },
    )
    .await;
}

#[tokio::test]
async fn a_caller_without_secret_use_gets_409_and_nothing_changes() {
    in_child(
        "a_caller_without_secret_use_gets_409_and_nothing_changes",
        || async {
            let store = Store::new().await;
            let id = store.path_variable().await;
            let secret = store.secret().await;
            let check = store.check_bound_to(&secret).await;
            let before = store.stored_path(&id).await;
            let auth = store.auth(&check).await;

            let response = store.update(&id, OUTSIDER, "denied").await;
            assert_eq!(response.status(), StatusCode::CONFLICT);
            assert_eq!(
                body(response).await["code"],
                "variable_feeds_secret_consumer"
            );

            let response = store.delete(&id, OUTSIDER).await;
            assert_eq!(response.status(), StatusCode::CONFLICT);
            assert_eq!(
                body(response).await["code"],
                "variable_feeds_secret_consumer"
            );

            assert_eq!(store.stored_path(&id).await, before);
            assert_eq!(store.auth(&check).await, auth);
        },
    )
    .await;
}
