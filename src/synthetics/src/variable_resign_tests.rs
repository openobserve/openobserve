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

use std::{future::Future, pin::Pin, sync::Mutex};

use config::{
    ider::ksuid,
    meta::{
        cluster::Node,
        secret_store::{
            BindRequest, ConsumerType, Decision, GateState, SecretErrorCode, SecretKind,
            SecretStoreAuthz,
        },
        synthetics::{Synthetic, SyntheticType},
        synthetics_variables::SyntheticsVariableRequest,
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
        entity::synthetics_jobs as job_entity,
        org_secret_values as values,
        org_secrets::{self, PinMode, PrivateLocations},
        secret_consumer_auth,
        synthetics_locations::{self, KIND_PUBLIC, SyntheticsLocationRecord},
        synthetics_probe_tokens::token_sha256,
        synthetics_runs,
        synthetics_variables::{self, SyntheticsVariableRecord},
    },
};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, ConnectionTrait, DatabaseBackend, Statement};
use serde_json::json;

use crate::{
    job_api::{self, ConfigError, JobCaller, PresentedLease, ResolveRequest},
    service::{self, CheckSaveActor, CheckSecretRefusal, composition_lock},
};

const CHILD: &str = "O2_SYNTHETICS_VARIABLE_RESIGN_TEST";
const HOST: &str = "https://api.example.com";
const VALUE: &str = "store-value-7f3a";
const EDITOR: &str = "editor";
const ROLE: &str = "member";
const APP_NAME_PREFIX: &str = "o2-variable-resign-";

type Answer<'a, T> = Pin<Box<dyn Future<Output = Result<T, SecretErrorCode>> + Send + 'a>>;

struct AllowAll;

impl SecretStoreAuthz for AllowAll {
    fn check_strict<'s, 'a, 'b, 'c, 'd, 'e, 'at>(
        &'s self,
        _: &'a str,
        _: &'b str,
        _: &'c str,
        _: &'d str,
        _: &'e str,
    ) -> Answer<'at, Decision>
    where
        's: 'at,
        'a: 'at,
        'b: 'at,
        'c: 'at,
        'd: 'at,
        'e: 'at,
        Self: 'at,
    {
        Box::pin(async { Ok(Decision::Allow) })
    }

    fn list_objects<'s, 'a, 'b, 'c, 'd, 'e, 'at>(
        &'s self,
        _: &'a str,
        _: &'b str,
        _: &'c str,
        _: &'d str,
        _: &'e str,
    ) -> Answer<'at, Vec<String>>
    where
        's: 'at,
        'a: 'at,
        'b: 'at,
        'c: 'at,
        'd: 'at,
        'e: 'at,
        Self: 'at,
    {
        Box::pin(async { Ok(Vec::new()) })
    }
}

struct RecordingAuthz {
    decision: Decision,
    calls: Mutex<Vec<[String; 5]>>,
}

impl RecordingAuthz {
    fn new(decision: Decision) -> Self {
        Self {
            decision,
            calls: Mutex::default(),
        }
    }
}

impl SecretStoreAuthz for RecordingAuthz {
    fn check_strict<'s, 'a, 'b, 'c, 'd, 'e, 'at>(
        &'s self,
        org: &'a str,
        user: &'b str,
        role: &'c str,
        object: &'d str,
        verb: &'e str,
    ) -> Answer<'at, Decision>
    where
        's: 'at,
        'a: 'at,
        'b: 'at,
        'c: 'at,
        'd: 'at,
        'e: 'at,
        Self: 'at,
    {
        Box::pin(async move {
            assert_no_write_transaction().await;
            self.calls
                .lock()
                .unwrap()
                .push([org, user, role, object, verb].map(str::to_owned));
            Ok(self.decision)
        })
    }

    fn list_objects<'s, 'a, 'b, 'c, 'd, 'e, 'at>(
        &'s self,
        org: &'a str,
        user: &'b str,
        role: &'c str,
        object_type: &'d str,
        verb: &'e str,
    ) -> Answer<'at, Vec<String>>
    where
        's: 'at,
        'a: 'at,
        'b: 'at,
        'c: 'at,
        'd: 'at,
        'e: 'at,
        Self: 'at,
    {
        AllowAll.list_objects(org, user, role, object_type, verb)
    }
}

struct Store {
    org: String,
    public: String,
}

impl Store {
    async fn new() -> Self {
        infra::db_init().await.unwrap();
        infra::table::migrate().await.unwrap();
        if cipher::master_key().is_err() {
            cipher::boot(None).await.unwrap();
        }
        latch_gate().await;
        let org = format!("varresign{}", ksuid().to_lowercase());
        cipher::get_dek(&org).await.unwrap();
        let public = location().await;
        Self { org, public }
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
            created_by: Set("user".into()),
            updated_by: Set("user".into()),
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
            env_id: Set(config::meta::secret_store::ORG_ENV_ID.into()),
            env_incarnation: Set(String::new()),
            state: Set("set".into()),
            value_ref: Set(Some(ksuid())),
            value_rev: Set(ksuid()),
            value_version: Set(1),
            updated_by: Set("user".into()),
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
            value: VALUE.to_owned().into(),
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

    async fn save_bound(&self, secret_id: &str) -> Synthetic {
        let secret = org_secrets::get_secret_in(get_orm_client_rw().await, &self.org, secret_id)
            .await
            .unwrap()
            .unwrap();
        let actor = CheckSaveActor {
            user_id: "user",
            role: "admin",
            authz: &AllowAll,
        };
        let binds = vec![SecretBindOption {
            secret_id: secret.id.clone(),
            allow_this_consumer: true,
            pin: BindPin::Keep,
            expected_policy_rev: secret.policy_rev.clone(),
        }];
        let (check, _) = service::create_synthetic_with_binds(
            &self.org,
            http_check(self, "Authorization", "Bearer {{secrets.X}}"),
            "user",
            Some(actor),
            binds,
        )
        .await
        .unwrap();
        check
    }

    async fn lease(&self, check: &Synthetic) -> (String, String) {
        let job_id = ksuid();
        let token = format!("o2lease_{job_id}.{}", ksuid());
        let now = config::utils::time::now_micros();
        let run_id = ksuid();
        synthetics_runs::insert_run(
            get_orm_client_rw().await,
            synthetics_runs::InsertRunParams {
                id: &run_id,
                synthetics_id: &check.id,
                org_id: &self.org,
                scheduled_ts: now,
                trigger_type: "schedule",
                job_count: 1,
                created_at: now,
            },
        )
        .await
        .unwrap();
        job_entity::ActiveModel {
            id: Set(job_id.clone()),
            synthetics_id: Set(check.id.clone()),
            synthetics_name: Set(check.name.clone()),
            org_id: Set(self.org.clone()),
            location: Set(self.public.clone()),
            env: Set(None),
            pool: Set("pool".into()),
            scheduled_ts: Set(now),
            valid_until: Set(now + 600_000_000),
            status: Set(1),
            claimed_by: Set(Some("runner".into())),
            claimed_at: Set(Some(now)),
            lease_expires_at: Set(Some(now + 600_000_000)),
            dispatch_attempts: Set(1),
            run_id: Set(run_id),
            browser_devices: Set(None),
            steps_configured: Set(0),
            metadata: Set("{}".into()),
            result: Set(None),
            started_at: Set(None),
            completed_at: Set(None),
            lease_token_sha256: Set(Some(token_sha256(&token))),
            lease_issuer: Set(Some("dispatcher".into())),
            env_incarnation: Set(None),
        }
        .insert(get_orm_client_rw().await)
        .await
        .unwrap();
        (job_id, token)
    }

    async fn resolve(&self, check: &Synthetic) -> anyhow::Result<job_api::ResolveResponse> {
        let (job_id, token) = self.lease(check).await;
        job_api::resolve_at(
            ResolveRequest {
                job_id,
                lease_token: Some(PresentedLease::new(token)),
            },
            &JobCaller::Probe {
                org: self.org.clone(),
                token_id: None,
            },
            config::utils::time::now_micros(),
        )
        .await
    }

    async fn create_path(&self) -> String {
        service::create_variable(&self.org, None, path_request("before"), "user")
            .await
            .unwrap()
            .id
    }

    async fn edit_path(
        &self,
        id: &str,
        value: &str,
        authz: &dyn SecretStoreAuthz,
    ) -> anyhow::Result<Option<BindRequest>> {
        let actor = CheckSaveActor {
            user_id: EDITOR,
            role: ROLE,
            authz,
        };
        let (updated, request) = service::update_variable_with_actor(
            &self.org,
            None,
            id,
            path_request(value),
            false,
            Some(actor),
        )
        .await?;
        assert!(updated.is_some());
        Ok(request)
    }

    async fn stored_variable(&self, id: &str) -> SyntheticsVariableRecord {
        synthetics_variables::get(get_orm_client_rw().await, &self.org, id)
            .await
            .unwrap()
            .unwrap()
    }

    async fn auth(&self, check: &Synthetic) -> Option<secret_consumer_auth::Model> {
        secret_consumer_auth::get_in(
            get_orm_client_rw().await,
            &self.org,
            ConsumerType::SyntheticsCheck.as_str(),
            &check.id,
        )
        .await
        .unwrap()
    }
}

async fn assert_no_write_transaction() {
    let row = get_orm_client_rw()
        .await
        .query_one(Statement::from_string(
            DatabaseBackend::Postgres,
            "SELECT current_setting('application_name') AS app, EXISTS(
                SELECT 1 FROM pg_stat_activity
                WHERE application_name = current_setting('application_name')
                  AND pid <> pg_backend_pid() AND xact_start IS NOT NULL
            ) AS open_transaction",
        ))
        .await
        .unwrap()
        .unwrap();
    assert!(
        row.try_get::<String>("", "app")
            .unwrap()
            .starts_with(APP_NAME_PREFIX)
    );
    assert!(!row.try_get::<bool>("", "open_transaction").unwrap());
}

async fn write_without_resigning(row: &SyntheticsVariableRecord) {
    assert!(
        synthetics_variables::update(get_orm_client_rw().await, row)
            .await
            .unwrap()
    );
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

fn http_check(store: &Store, header: &str, value: &str) -> Synthetic {
    Synthetic {
        name: format!("http-{}", ksuid()),
        check_type: SyntheticType::Http,
        target: format!("{HOST}/{{{{PATH}}}}"),
        config: json!({"method": "GET", "headers": [{"name": header, "value": value}]}),
        locations: vec![store.public.clone()],
        alert_if_fails: 1,
        ..Default::default()
    }
}

fn path_request(value: &str) -> SyntheticsVariableRequest {
    SyntheticsVariableRequest {
        name: "PATH".into(),
        value: Some(value.into()),
        ..Default::default()
    }
}

fn assert_delivery_stale(error: &anyhow::Error) {
    assert_eq!(
        error.downcast_ref::<ConfigError>().map(|e| e.status_reason),
        Some("secret_error:delivery_stale"),
        "{error:#}"
    );
}

fn assert_bind_request(request: Option<BindRequest>) {
    assert_eq!(
        request,
        Some(BindRequest {
            saved_by: EDITOR.into(),
            refs: Vec::new(),
        })
    );
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
    let id = ksuid();
    let dir = std::env::temp_dir().join(&id);
    let separator = if dsn.contains('?') { '&' } else { '?' };
    let dsn = format!("{dsn}{separator}application_name={APP_NAME_PREFIX}{id}");
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
            &format!("variable_resign_tests::{name}"),
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
async fn authorized_edit_resigns_and_the_next_lease_resolves() {
    in_child(
        "authorized_edit_resigns_and_the_next_lease_resolves",
        || async {
            let store = Store::new().await;
            let path = store.create_path().await;
            let secret = store.secret().await;
            let check = store.save_bound(&secret.id).await;
            let before = store.auth(&check).await.unwrap();

            assert_bind_request(store.edit_path(&path, "after", &AllowAll).await.unwrap());

            let after = store.auth(&check).await.unwrap();
            assert_eq!(after.consumer_rev, before.consumer_rev + 1);
            assert_eq!(after.via, "user:dependency");
            assert_eq!(after.authorized_by, EDITOR);
            assert_ne!(after.dep_digests, before.dep_digests);
            let resolved = store.resolve(&check).await.unwrap();
            assert_eq!(resolved.synthetic.target, format!("{HOST}/after"));
            assert_eq!(
                resolved.synthetic.config["headers"][0]["value"],
                format!("Bearer {VALUE}")
            );
        },
    )
    .await;
}

#[tokio::test]
async fn direct_edit_stales_and_resigning_requires_the_signed_preimage() {
    in_child(
        "direct_edit_stales_and_resigning_requires_the_signed_preimage",
        || async {
            let store = Store::new().await;
            let path = store.create_path().await;
            let secret = store.secret().await;
            let check = store.save_bound(&secret.id).await;
            let signed = store.stored_variable(&path).await;
            let auth = store.auth(&check).await.unwrap();

            write_without_resigning(&SyntheticsVariableRecord {
                value: "unsigned".into(),
                updated_at: signed.updated_at + 1,
                ..signed.clone()
            })
            .await;
            assert_delivery_stale(&store.resolve(&check).await.unwrap_err());

            let request = store
                .edit_path(&path, "still-stale", &AllowAll)
                .await
                .unwrap();
            assert!(request.is_none());
            assert_eq!(store.auth(&check).await, Some(auth));
            assert_delivery_stale(&store.resolve(&check).await.unwrap_err());

            let mut body = check.clone();
            body.config["headers"][0]["value"] = json!("Bearer {{secrets.X}}");
            let editor = CheckSaveActor {
                user_id: EDITOR,
                role: ROLE,
                authz: &AllowAll,
            };
            service::update_synthetic_with_binds(
                &store.org,
                &check.id,
                body,
                EDITOR,
                Some(editor),
                Vec::new(),
            )
            .await
            .unwrap();
            let resolved = store.resolve(&check).await.unwrap();
            assert_eq!(resolved.synthetic.target, format!("{HOST}/still-stale"));
            assert_eq!(
                resolved.synthetic.config["headers"][0]["value"],
                format!("Bearer {VALUE}")
            );
        },
    )
    .await;
}

#[tokio::test]
async fn edit_without_secret_use_leaves_variable_unchanged() {
    in_child(
        "edit_without_secret_use_leaves_variable_unchanged",
        || async {
            let store = Store::new().await;
            let path = store.create_path().await;
            let secret = store.secret().await;
            let check = store.save_bound(&secret.id).await;
            let before = store.stored_variable(&path).await;
            let auth = store.auth(&check).await;
            let denied = RecordingAuthz::new(Decision::Deny);

            let refused = store.edit_path(&path, "denied", &denied).await.unwrap_err();
            let refused = refused.downcast_ref::<CheckSecretRefusal>().unwrap();
            assert_eq!(refused.code, SecretErrorCode::VariableFeedsSecretConsumer);
            assert_eq!(refused.code.http_status(), Some(409));
            let usage = refused
                .usage
                .as_ref()
                .expect("the blocked checks are listed");
            let hops: Vec<_> = usage
                .iter()
                .flat_map(|entry| &entry.path)
                .map(|hop| (hop.consumer_type, hop.consumer_id.as_str()))
                .collect();
            assert_eq!(hops, [(ConsumerType::SyntheticsCheck, check.id.as_str())]);
            assert_eq!(store.stored_variable(&path).await, before);
            assert_eq!(store.auth(&check).await, auth);
        },
    )
    .await;
}

#[tokio::test]
async fn three_checks_share_one_strict_check_outside_the_transaction() {
    in_child(
        "three_checks_share_one_strict_check_outside_the_transaction",
        || async {
            let store = Store::new().await;
            let path = store.create_path().await;
            let secret = store.secret().await;
            let mut checks = Vec::new();
            for _ in 0..3 {
                let check = store.save_bound(&secret.id).await;
                let rev = store.auth(&check).await.unwrap().consumer_rev;
                checks.push((check, rev));
            }
            let authz = RecordingAuthz::new(Decision::Allow);

            assert_bind_request(store.edit_path(&path, "shared", &authz).await.unwrap());

            assert_eq!(
                authz.calls.into_inner().unwrap(),
                [[
                    store.org.clone(),
                    EDITOR.into(),
                    ROLE.into(),
                    format!("secrets:{}", secret.id),
                    "GET".into(),
                ]]
            );
            for (check, rev) in checks {
                assert_eq!(store.auth(&check).await.unwrap().consumer_rev, rev + 1);
            }
        },
    )
    .await;
}

#[tokio::test]
async fn a_check_without_store_refs_needs_no_secret_authorization() {
    in_child(
        "a_check_without_store_refs_needs_no_secret_authorization",
        || async {
            let store = Store::new().await;
            let path = store.create_path().await;
            let check = service::create_synthetic(
                &store.org,
                http_check(&store, "Accept", "application/json"),
                "user",
            )
            .await
            .unwrap();
            let authz = RecordingAuthz::new(Decision::Deny);
            assert!(store.auth(&check).await.is_none());

            let request = store.edit_path(&path, "plain", &authz).await.unwrap();

            assert!(request.is_none());
            assert!(authz.calls.into_inner().unwrap().is_empty());
            assert!(store.auth(&check).await.is_none());
            let resolved = store.resolve(&check).await.unwrap();
            assert_eq!(resolved.synthetic.target, format!("{HOST}/plain"));
        },
    )
    .await;
}

#[tokio::test]
async fn a_store_ref_check_save_waits_for_a_variable_write_in_progress() {
    in_child(
        "a_store_ref_check_save_waits_for_a_variable_write_in_progress",
        || async {
            let store = Store::new().await;
            store.create_path().await;
            let secret = store.secret().await;
            let check = store.save_bound(&secret.id).await;
            let wait = std::time::Duration::from_millis(500);

            let held = composition_lock::lock(&store.org).await.unwrap();
            let plain = service::create_synthetic(
                &store.org,
                http_check(&store, "Accept", "application/json"),
                "user",
            );
            assert!(tokio::time::timeout(wait, plain).await.is_ok());
            let create = store.save_bound(&secret.id);
            tokio::pin!(create);
            assert!(tokio::time::timeout(wait, &mut create).await.is_err());
            let editor = CheckSaveActor {
                user_id: EDITOR,
                role: ROLE,
                authz: &AllowAll,
            };
            let mut body = check.clone();
            body.config["headers"][0]["value"] = json!("Bearer {{secrets.X}}");
            let update = service::update_synthetic_with_binds(
                &store.org,
                &check.id,
                body,
                EDITOR,
                Some(editor),
                Vec::new(),
            );
            tokio::pin!(update);
            assert!(tokio::time::timeout(wait, &mut update).await.is_err());
            held.release().await.unwrap();

            create.await;
            update.await.unwrap();
        },
    )
    .await;
}

#[tokio::test]
async fn resolve_sends_the_variable_values_its_digests_were_checked_on() {
    in_child(
        "resolve_sends_the_variable_values_its_digests_were_checked_on",
        || async {
            let store = Store::new().await;
            let path = store.create_path().await;
            let secret = store.secret().await;
            let check = store.save_bound(&secret.id).await;
            let signed = store.stored_variable(&path).await;
            synthetics_variables::list_cached(get_orm_client_rw().await, &store.org)
                .await
                .unwrap();
            // Another node's write: this node's cache stays warm until its invalidation arrives.
            get_orm_client_rw()
                .await
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "UPDATE synthetics_variables SET value = 'moved', updated_at = $1 WHERE id = $2",
                    [(signed.updated_at + 1).into(), path.clone().into()],
                ))
                .await
                .unwrap();
            let mut body = check.clone();
            body.config["headers"][0]["value"] = json!("Bearer {{secrets.X}}");
            let editor = CheckSaveActor {
                user_id: EDITOR,
                role: ROLE,
                authz: &AllowAll,
            };
            service::update_synthetic_with_binds(
                &store.org,
                &check.id,
                body,
                EDITOR,
                Some(editor),
                Vec::new(),
            )
            .await
            .unwrap();
            let cached = synthetics_variables::list_cached(get_orm_client_rw().await, &store.org)
                .await
                .unwrap();
            assert_eq!(cached[0].value, signed.value, "the cache must still hold the old row");

            let resolved = store.resolve(&check).await.unwrap();

            assert_eq!(resolved.synthetic.target, format!("{HOST}/moved"));
        },
    )
    .await;
}

#[tokio::test]
async fn a_variable_resign_locks_its_checks_in_one_statement_and_reads_only_named_variables() {
    in_child(
        "a_variable_resign_locks_its_checks_in_one_statement_and_reads_only_named_variables",
        || async {
            use job_api::cost;
            let store = Store::new().await;
            let path = store.create_path().await;
            for name in ["UNRELATED_A", "UNRELATED_B", "UNRELATED_C"] {
                let request = SyntheticsVariableRequest {
                    name: name.into(),
                    value: Some("unused".into()),
                    ..Default::default()
                };
                service::create_variable(&store.org, None, request, "user")
                    .await
                    .unwrap();
            }
            let secret = store.secret().await;
            let mut checks = Vec::new();
            for _ in 0..4 {
                let check = store.save_bound(&secret.id).await;
                let rev = store.auth(&check).await.unwrap().consumer_rev;
                checks.push((check, rev));
            }
            for step in ["check_lock_statement", "org_variables_read"] {
                cost::take(&store.org, step);
            }

            assert_bind_request(store.edit_path(&path, "batched", &AllowAll).await.unwrap());

            assert_eq!(cost::take(&store.org, "check_lock_statement"), 1);
            assert_eq!(cost::take(&store.org, "org_variables_read"), 0);
            for (check, rev) in &checks {
                assert_eq!(store.auth(check).await.unwrap().consumer_rev, rev + 1);
            }
            let resolved = store.resolve(&checks[0].0).await.unwrap();
            assert_eq!(resolved.synthetic.target, format!("{HOST}/batched"));
        },
    )
    .await;
}
