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

//! Store refs end to end on a real PostgreSQL meta store: a bound save, then a leased resolve.

use std::{future::Future, pin::Pin};

use config::{
    ider::ksuid,
    meta::{
        cluster::Node,
        secret_store::{
            ConsumerType, Decision, GateState, SecretErrorCode, SecretKind, SecretStoreAuthz,
        },
        synthetics::{Synthetic, SyntheticAuth, SyntheticType, SyntheticVariable},
        synthetics_variables::{
            SyntheticsEnvironmentRequest, SyntheticsVariableKind, SyntheticsVariableRequest,
        },
    },
};
use infra::{
    db::{get_orm_client_rw, sqlite::SqliteDb},
    secret_store::{
        bind::{BindPin, SecretBindOption},
        capability::{FgaMode, LEVEL_P1_11, STORE_FLOOR_VERSION, own_record, write_record_in},
        gate,
        lease_notice::runner_lease_notice,
        reauthorize, respell,
    },
    secrets::CURRENT,
    table::{
        cipher,
        credential_values::{self, NamedValueAd, NamedValueClass, SecretRecord, SlotClass},
        entity::{synthetics_agents as agent_entity, synthetics_jobs as job_entity},
        org_secret_values as values,
        org_secrets::{self, PinMode, PrivateLocations},
        secret_consumer_auth, secret_refs,
        secret_store_job_markers::{
            AGENT_TOKEN_CUTOVER, META_ORG, SYNTHETICS_WRITE_ONLY, TOKENLESS_RECORDER,
            get_marker_in, insert_if_absent_in,
        },
        synthetics_agents::{self, SyntheticsAgentRecord},
        synthetics_checks,
        synthetics_environments::SyntheticsEnvironmentRecord,
        synthetics_locations::{self, KIND_PRIVATE, KIND_PUBLIC, SyntheticsLocationRecord},
        synthetics_probe_tokens::{self, SyntheticsProbeTokenRecord, token_sha256},
        synthetics_runs,
    },
};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait};
use serde_json::json;

use crate::{
    job_api::{self, AttemptError, ConfigError, JobCaller, PresentedLease, ResolveRequest},
    service::{CheckSaveActor, CheckSecretRefusal, respell::CheckRespell},
};

const CHILD: &str = "O2_SYNTHETICS_STORE_REF_TEST";
const HOST: &str = "https://api.example.com";
const VALUE: &str = "store-value-7f3a";
const PASSWORD: &str = "inline-pw-91c2";
const DAY_US: i64 = 24 * 3_600_000_000;

struct AllowAll;

type Answer<'a, T> = Pin<Box<dyn Future<Output = Result<T, SecretErrorCode>> + Send + 'a>>;

// The crate has no `async_trait` dependency; this is the macro's expansion written out.
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
        let org = format!("ssref{}", ksuid().to_lowercase());
        cipher::get_dek(&org).await.unwrap();
        let public = location(&org, KIND_PUBLIC).await;
        Self { org, public }
    }

    /// A secret named `name` with one org-scoped value.
    async fn secret(&self, name: &str, private: PrivateLocations) -> org_secrets::Model {
        let conn = get_orm_client_rw().await;
        let row = org_secrets::ActiveModel {
            id: Set(ksuid()),
            org_id: Set(self.org.clone()),
            name: Set(name.into()),
            kind: Set("secret".into()),
            state: Set("active".into()),
            description: Set(String::new()),
            allowed_hosts: Set("api.example.com".into()),
            pin_mode: Set(PinMode::Hosts),
            private_locations: Set(private),
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
        self.set_value(&row, config::meta::secret_store::ORG_ENV_ID, "", VALUE)
            .await;
        row
    }

    /// Seals `plaintext` as the secret's value in `env_id`.
    async fn set_value(
        &self,
        row: &org_secrets::Model,
        env_id: &str,
        incarnation: &str,
        plaintext: &str,
    ) {
        let conn = get_orm_client_rw().await;
        let value = values::ActiveModel {
            id: Set(ksuid()),
            secret_id: Set(row.id.clone()),
            org_id: Set(self.org.clone()),
            env_id: Set(env_id.into()),
            env_incarnation: Set(incarnation.into()),
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
            value: plaintext.to_owned().into(),
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
    }

    async fn save(
        &self,
        body: Synthetic,
        secret: &org_secrets::Model,
    ) -> anyhow::Result<Synthetic> {
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
        crate::service::create_synthetic_with_binds(&self.org, body, "user", Some(actor), binds)
            .await
            .map(|(saved, _)| saved)
    }

    /// A dispatcher lease on a fresh job of `check`; returns the job id and its token.
    async fn lease(&self, check: &Synthetic) -> (String, String) {
        let (job_id, token) = self.claim(check, "runner", Some("dispatcher")).await;
        (job_id, token.unwrap())
    }

    /// A job of `check` claimed by `claimed_by`; with no `issuer` it is a tokenless legacy claim.
    async fn claim(
        &self,
        check: &Synthetic,
        claimed_by: &str,
        issuer: Option<&str>,
    ) -> (String, Option<String>) {
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
            claimed_by: Set(Some(claimed_by.into())),
            claimed_at: Set(Some(now)),
            lease_expires_at: Set(Some(now + 30 * DAY_US)),
            dispatch_attempts: Set(1),
            run_id: Set(run_id),
            browser_devices: Set(None),
            steps_configured: Set(0),
            metadata: Set("{}".into()),
            result: Set(None),
            started_at: Set(None),
            completed_at: Set(None),
            lease_token_sha256: Set(issuer.map(|_| token_sha256(&token))),
            lease_issuer: Set(issuer.map(str::to_owned)),
            env_incarnation: Set(None),
        }
        .insert(get_orm_client_rw().await)
        .await
        .unwrap();
        (job_id, issuer.map(|_| token))
    }

    async fn resolve(
        &self,
        job_id: &str,
        token: Option<&str>,
    ) -> anyhow::Result<job_api::ResolveResponse> {
        self.resolve_at(job_id, token, config::utils::time::now_micros())
            .await
    }

    async fn resolve_at(
        &self,
        job_id: &str,
        token: Option<&str>,
        now: i64,
    ) -> anyhow::Result<job_api::ResolveResponse> {
        self.resolve_as(job_id, token, now, None).await
    }

    /// A resolve by a probe that authenticated with the o2syn_ token `caller_token`.
    async fn resolve_as(
        &self,
        job_id: &str,
        token: Option<&str>,
        now: i64,
        caller_token: Option<&str>,
    ) -> anyhow::Result<job_api::ResolveResponse> {
        let req = ResolveRequest {
            job_id: job_id.to_owned(),
            lease_token: token.map(|t| PresentedLease::new(t.to_owned())),
        };
        job_api::resolve_at(
            req,
            &JobCaller::Probe {
                org: self.org.clone(),
                token_id: caller_token.map(str::to_owned),
            },
            now,
        )
        .await
    }

    /// An agent on the public location registered with a fresh token created at `token_created_at`.
    async fn agent(&self, token_created_at: i64) -> String {
        self.agent_with_token(token_created_at).await.0
    }

    /// An o2syn_ token of the org created at `created_at`, registered to no agent.
    async fn token(&self, created_at: i64) -> String {
        let token_id = ksuid();
        synthetics_probe_tokens::add(&SyntheticsProbeTokenRecord {
            id: token_id.clone(),
            org_id: self.org.clone(),
            name: format!("t-{token_id}"),
            token: format!("o2syn_{}", ksuid()),
            is_default: false,
            enabled: true,
            created_by: "user".into(),
            created_at,
            updated_at: created_at,
        })
        .await
        .unwrap();
        token_id
    }

    /// [`Self::agent`], returning the agent id and its token id.
    async fn agent_with_token(&self, token_created_at: i64) -> (String, String) {
        let token_id = ksuid();
        synthetics_probe_tokens::add(&SyntheticsProbeTokenRecord {
            id: token_id.clone(),
            org_id: self.org.clone(),
            name: format!("t-{token_id}"),
            token: format!("o2syn_{}", ksuid()),
            is_default: false,
            enabled: true,
            created_by: "user".into(),
            created_at: token_created_at,
            updated_at: token_created_at,
        })
        .await
        .unwrap();
        let id = ksuid();
        synthetics_agents::register(&SyntheticsAgentRecord {
            id: id.clone(),
            org_id: self.org.clone(),
            location_id: self.public.clone(),
            name: id.clone(),
            version: None,
            capabilities: None,
            token_id: Some(token_id.clone()),
            last_seen_at: 1,
            created_at: 1,
        })
        .await
        .unwrap();
        (id, token_id)
    }
}

/// Two live nodes at the P1-11 level latch the gate the way the evaluator does in production.
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

async fn location(org: &str, kind: &str) -> String {
    let id = ksuid();
    synthetics_locations::add(&SyntheticsLocationRecord {
        id: id.clone(),
        org_id: (kind == KIND_PRIVATE).then(|| org.to_owned()),
        kind: kind.into(),
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

fn http_check(store: &Store, header: &str) -> Synthetic {
    Synthetic {
        name: format!("http-{}", ksuid()),
        check_type: SyntheticType::Http,
        target: format!("{HOST}/health"),
        config: json!({"method": "GET", "headers": [{"name": "Authorization", "value": header}]}),
        locations: vec![store.public.clone()],
        alert_if_fails: 1,
        ..Default::default()
    }
}

/// An HTTP check with no write-only value.
fn plain_check(store: &Store) -> Synthetic {
    Synthetic {
        config: json!({"method": "GET", "headers": [{"name": "Accept", "value": "application/json"}]}),
        ..http_check(store, "")
    }
}

/// An HTTP check whose only write-only value is an inline Basic password.
fn inline_check(store: &Store) -> Synthetic {
    Synthetic {
        auth: Some(SyntheticAuth::Basic {
            username: "probe".into(),
            password: PASSWORD.into(),
        }),
        ..plain_check(store)
    }
}

/// Starts the banner period and the agent-token cutover if no boot has; returns the period start.
async fn boot_markers() -> i64 {
    let conn = get_orm_client_rw().await;
    let now = config::utils::time::now_micros();
    insert_if_absent_in(conn, META_ORG, TOKENLESS_RECORDER, now)
        .await
        .unwrap();
    insert_if_absent_in(conn, META_ORG, AGENT_TOKEN_CUTOVER, now - 1_000_000)
        .await
        .unwrap();
    get_marker_in(conn, META_ORG, TOKENLESS_RECORDER)
        .await
        .unwrap()
        .unwrap()
        .done_at
}

async fn tokenless_stamp(agent_id: &str) -> Option<i64> {
    agent_entity::Entity::find_by_id(agent_id)
        .one(get_orm_client_rw().await)
        .await
        .unwrap()
        .unwrap()
        .last_tokenless_credential_resolve_at
}

fn ack_with_error(job_id: &str, error: &str) -> job_api::AckRequest {
    job_api::AckRequest {
        job_id: job_id.to_owned(),
        lease_token: None,
        claimed_by: None,
        status: "error".to_owned(),
        response_time_ms: 0.0,
        error: Some(error.to_owned()),
        trigger_type: "schedule".to_owned(),
        status_reason: None,
        attempts: 0,
        error_source: String::new(),
        steps_executed: 0,
        steps_defined: 0,
        browser_ms: 0,
    }
}

fn config_reason(error: &anyhow::Error) -> Option<&'static str> {
    error.downcast_ref::<ConfigError>().map(|e| e.status_reason)
}

/// Runs `name` in a child process: refs-enabled config and the meta pool are process-wide.
async fn in_child<F: Future<Output = ()>>(name: &str, body: impl FnOnce() -> F) {
    in_child_with_lease_config(name, "v1.3.0-rc1", 0, body).await;
}

async fn in_child_with_lease_config<F: Future<Output = ()>>(
    name: &str,
    min_runner_version: &str,
    lambda_runner_contract: u32,
    body: impl FnOnce() -> F,
) {
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
        .env("O2_SYNTHETICS_LEASE_MIN_RUNNER_VERSION", min_runner_version)
        .env(
            "O2_SYNTHETICS_LAMBDA_RUNNER_CONTRACT",
            lambda_runner_contract.to_string(),
        )
        .args([
            "--exact",
            &format!("store_ref_tests::{name}"),
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
async fn origins_backfill_task_writes_its_marker_after_durable_latch() {
    in_child(
        "origins_backfill_task_writes_its_marker_after_durable_latch",
        || async {
            use infra::table::secret_store_job_markers::{self as markers, Column};
            use sea_orm::{ColumnTrait, QueryFilter};

            let _store = Store::new().await;
            markers::Entity::delete_many()
                .filter(Column::OrgId.eq(META_ORG))
                .filter(Column::Job.is_in([markers::ORIGINS_BACKFILL, SYNTHETICS_WRITE_ONLY]))
                .exec(get_orm_client_rw().await)
                .await
                .unwrap();
            crate::origins_backfill::run_with_latch(crate::StopToken::never(), || async {
                Ok(true)
            })
            .await;
            assert!(
                get_marker_in(
                    get_orm_client_rw().await,
                    META_ORG,
                    infra::table::secret_store_job_markers::ORIGINS_BACKFILL,
                )
                .await
                .unwrap()
                .is_some()
            );
        },
    )
    .await;
}

async fn unlatched_store() -> Store {
    use infra::table::secret_store_job_markers::{self as markers, Column};
    use sea_orm::{ColumnTrait, QueryFilter};

    let store = Store::new().await;
    infra::table::organizations::add(
        &store.org,
        &store.org,
        config::meta::organization::OrganizationType::Custom,
    )
    .await
    .unwrap();
    markers::Entity::delete_many()
        .filter(Column::OrgId.eq(META_ORG))
        .filter(Column::Job.is_in([markers::ORIGINS_BACKFILL, SYNTHETICS_WRITE_ONLY]))
        .exec(get_orm_client_rw().await)
        .await
        .unwrap();
    infra::db::get_coordinator()
        .await
        .delete_if_exists("/secret_store/sys/gate", false, false)
        .await
        .unwrap();
    gate::force_state_for_tests(Some(gate::GateView {
        state: GateState::Closed,
        suspended: false,
    }));
    store
}

async fn latch_write_only() {
    gate::force_state_for_tests(None);
    latch_gate().await;
    insert_if_absent_in(
        get_orm_client_rw().await,
        META_ORG,
        SYNTHETICS_WRITE_ONLY,
        config::utils::time::now_micros(),
    )
    .await
    .unwrap();
}

fn inline_body_check(store: &Store, target: &str) -> Synthetic {
    Synthetic {
        target: target.into(),
        config: json!({
            "method": "POST", "follow_redirects": true, "body": "{\"ping\":\"pong\"}",
            "headers": [{"name": "X-Key", "value": "header-value", "secure": true}]
        }),
        ..inline_check(store)
    }
}

#[tokio::test]
async fn origins_backfill_binds_main_way_slots_and_allows_same_host_keeps() {
    in_child(
        "origins_backfill_binds_main_way_slots_and_allows_same_host_keeps",
        || async {
            let store = unlatched_store().await;
            let request = |value: &str| SyntheticsVariableRequest {
                name: "HOST".into(),
                value: Some(value.into()),
                kind: Some(SyntheticsVariableKind::Plain),
                ..Default::default()
            };
            let variable = crate::service::create_variable(
                &store.org,
                None,
                request("api.example.com"),
                "user",
            )
            .await
            .unwrap();
            let body = inline_body_check(&store, "https://{{HOST}}/");
            let check = crate::service::create_synthetic(&store.org, body.clone(), "user")
                .await
                .unwrap();
            let conn = get_orm_client_rw().await;
            let original = synthetics_checks::get(conn, &store.org, &check.id)
                .await
                .unwrap()
                .unwrap();
            assert!(
                original
                    .config_secrets
                    .keys()
                    .all(|key| !key.starts_with("#m/"))
            );
            assert_eq!(
                crate::service::write_only_slot_keys(&original),
                ["auth/password", "header/x-key", "body"]
            );
            latch_write_only().await;
            let (job_id, token) = store.lease(&check).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.synthetic.target, "https://api.example.com/");
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
            crate::origins_backfill::run_origins_backfill()
                .await
                .unwrap();
            let stored = synthetics_checks::get(conn, &store.org, &check.id)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(stored.updated_at, original.updated_at);
            let dek = cipher::get_dek(&store.org).await.unwrap();
            for key in crate::service::write_only_slot_keys(&original) {
                let ciphertext = &stored.config_secrets[&format!("#m/{key}")];
                let plaintext = crate::service::decrypt_secret(&dek, ciphertext).unwrap();
                let meta: config::meta::synthetics::SlotMeta =
                    serde_json::from_str(&plaintext).unwrap();
                assert_eq!(meta.updated_at, original.updated_at);
                assert_eq!(meta.updated_by, "user");
                assert_eq!(
                    meta.origins.unwrap()["_org"],
                    ["https://api.example.com:443"]
                );
            }
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.allowed_hosts, ["https://api.example.com:443"]);
            assert_eq!(served.synthetic.target, "https://api.example.com/");
            assert_eq!(served.synthetic.config["body"], "{\"ping\":\"pong\"}");
            let mut kept = body;
            kept.folder_id.clone_from(&check.folder_id);
            kept.auth = Some(SyntheticAuth::Basic {
                username: "probe".into(),
                password: config::meta::synthetics::KEEP_MARKER.into(),
            });
            kept.config["body"] = json!({"keep": true});
            kept.config["headers"][0]["value"] = json!({"keep": true});
            crate::service::update_synthetic_as(&store.org, &check.id, kept, "editor")
                .await
                .unwrap();
            crate::service::update_variable(
                &store.org,
                None,
                &variable.id,
                request("other.example.com"),
                true,
            )
            .await
            .unwrap();
            let refused = store.resolve(&job_id, Some(&token)).await.unwrap_err();
            assert_eq!(
                config_reason(&refused),
                Some("secret_error:slot_origin_changed")
            );
            assert!(!format!("{refused:#}").contains(PASSWORD));
        },
    )
    .await;
}

#[tokio::test]
async fn main_way_inline_http_resolves_before_and_after_origins_backfill() {
    in_child(
        "main_way_inline_http_resolves_before_and_after_origins_backfill",
        || async {
            let store = unlatched_store().await;
            let check = crate::service::create_synthetic(
                &store.org,
                inline_body_check(&store, "http://api.example.com/"),
                "user",
            )
            .await
            .unwrap();
            let (job_id, token) = store.lease(&check).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.synthetic.target, "http://api.example.com/");
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
            assert_eq!(served.synthetic.config["body"], "{\"ping\":\"pong\"}");
            assert!(served.allowed_hosts.is_empty());
            assert_eq!(served.synthetic.config["follow_redirects"], true);
            latch_write_only().await;
            crate::origins_backfill::run_origins_backfill()
                .await
                .unwrap();
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.synthetic.target, "http://api.example.com/");
            assert_eq!(served.allowed_hosts, ["http://api.example.com:80"]);
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
            assert_eq!(served.synthetic.config["body"], "{\"ping\":\"pong\"}");
            let conn = get_orm_client_rw().await;
            let mut stored = synthetics_checks::get(conn, &store.org, &check.id)
                .await
                .unwrap()
                .unwrap();
            assert!(stored.config_secrets.remove("#m/body").is_some());
            synthetics_checks::update_row(conn, &store.org, &check.id, &stored)
                .await
                .unwrap();
            synthetics_checks::invalidate_and_publish(&store.org, &check.id).await;
            let refused = store.resolve(&job_id, Some(&token)).await.unwrap_err();
            assert_eq!(
                config_reason(&refused),
                Some("secret_error:slot_origin_changed")
            );
        },
    )
    .await;
}

#[tokio::test]
async fn main_way_inline_checks_preserve_capture_and_redirects_before_latch() {
    in_child(
        "main_way_inline_checks_preserve_capture_and_redirects_before_latch",
        || async {
            let store = unlatched_store().await;
            let browser = Synthetic {
                check_type: SyntheticType::Browser,
                collect_rum_data: true,
                session_replay: true,
                config: json!({
                    "steps": [
                        {"id": "s0", "action": "navigate", "url": format!("{HOST}/")},
                        {"id": "s1", "action": "fill", "locator": {"candidates": [
                            {"kind": "css", "value": "#search"}
                        ]}, "value": "search text"}
                    ],
                    "capture": {"screenshot": "always", "trace": "always", "video": "always"}
                }),
                ..plain_check(&store)
            };
            let browser = crate::service::create_synthetic(&store.org, browser, "user")
                .await
                .unwrap();
            let (job_id, token) = store.lease(&browser).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(
                served.synthetic.config["capture"],
                browser.config["capture"]
            );
            assert!(served.synthetic.collect_rum_data);
            assert!(served.synthetic.session_replay);

            let http = Synthetic {
                config: json!({
                    "method": "POST", "follow_redirects": true, "body": "{\"ping\":\"pong\"}"
                }),
                ..plain_check(&store)
            };
            let http = crate::service::create_synthetic(&store.org, http, "user")
                .await
                .unwrap();
            let (job_id, token) = store.lease(&http).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(
                served.synthetic.config["follow_redirects"],
                http.config["follow_redirects"]
            );
        },
    )
    .await;
}

#[tokio::test]
async fn origins_backfill_decrypts_a_main_way_local_host_before_binding() {
    in_child(
        "origins_backfill_decrypts_a_main_way_local_host_before_binding",
        || async {
            let store = unlatched_store().await;
            let body = Synthetic {
                variables: vec![SyntheticVariable {
                    name: "HOST".into(),
                    value: "api.example.com".into(),
                    secure: false,
                    ..Default::default()
                }],
                ..inline_body_check(&store, "https://{{HOST}}/")
            };
            let check = crate::service::create_synthetic(&store.org, body, "user")
                .await
                .unwrap();
            let original = synthetics_checks::get(get_orm_client_rw().await, &store.org, &check.id)
                .await
                .unwrap()
                .unwrap();
            assert!(
                original.variables[0]
                    .value
                    .starts_with(config::utils::encryption::SECRET_PREFIX)
            );
            latch_write_only().await;
            crate::origins_backfill::run_origins_backfill()
                .await
                .unwrap();
            let (job_id, token) = store.lease(&check).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.synthetic.target, "https://api.example.com/");
            assert_eq!(served.allowed_hosts, ["https://api.example.com:443"]);
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
            assert_eq!(served.synthetic.config["body"], "{\"ping\":\"pong\"}");
        },
    )
    .await;
}

#[tokio::test]
async fn origins_backfill_creates_a_dek_for_a_main_way_body_only_check() {
    in_child(
        "origins_backfill_creates_a_dek_for_a_main_way_body_only_check",
        || async {
            use infra::table::entity::synthetics_checks::Entity;

            let store = unlatched_store().await;
            cipher::delete_by_org(&store.org).await.unwrap();
            let body = Synthetic {
                target: "http://api.example.com/".into(),
                config: json!({"method": "POST", "body": "{\"ping\":\"pong\"}"}),
                ..plain_check(&store)
            };
            let check = crate::service::create_synthetic(&store.org, body, "user")
                .await
                .unwrap();
            assert!(
                cipher::get_existing_dek(&store.org)
                    .await
                    .unwrap()
                    .is_none()
            );
            let conn = get_orm_client_rw().await;
            let row = Entity::find_by_id(&check.id)
                .one(conn)
                .await
                .unwrap()
                .unwrap();
            let raw: serde_json::Value = serde_json::from_str(&row.secrets).unwrap();
            assert!(raw.get("config").is_none());
            latch_write_only().await;
            crate::origins_backfill::run_origins_backfill()
                .await
                .unwrap();
            assert!(
                cipher::get_existing_dek(&store.org)
                    .await
                    .unwrap()
                    .is_some()
            );
            let stored = synthetics_checks::get(conn, &store.org, &check.id)
                .await
                .unwrap()
                .unwrap();
            assert!(stored.config_secrets.contains_key("#m/body"));
            let (job_id, token) = store.lease(&check).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.synthetic.target, "http://api.example.com/");
            assert_eq!(served.allowed_hosts, ["http://api.example.com:80"]);
            assert_eq!(served.synthetic.config["body"], "{\"ping\":\"pong\"}");
        },
    )
    .await;
}

#[tokio::test]
async fn origins_backfill_creates_a_missing_config_and_skips_an_unresolved_host() {
    in_child(
        "origins_backfill_creates_a_missing_config_and_skips_an_unresolved_host",
        || async {
            use infra::table::entity::synthetics_checks::Entity;

            let store = unlatched_store().await;
            let healthy = Synthetic {
                target: "http://api.example.com/".into(),
                config: json!({"method": "POST", "body": "{\"ping\":\"pong\"}"}),
                ..plain_check(&store)
            };
            let healthy = crate::service::create_synthetic(&store.org, healthy, "user")
                .await
                .unwrap();
            let conn = get_orm_client_rw().await;
            let row = Entity::find_by_id(&healthy.id)
                .one(conn)
                .await
                .unwrap()
                .unwrap();
            let raw: serde_json::Value = serde_json::from_str(&row.secrets).unwrap();
            assert!(raw.get("config").is_none());
            let variable = crate::service::create_variable(
                &store.org,
                None,
                SyntheticsVariableRequest {
                    name: "HOST".into(),
                    value: Some("api.example.com".into()),
                    kind: Some(SyntheticsVariableKind::Plain),
                    ..Default::default()
                },
                "user",
            )
            .await
            .unwrap();
            let unresolved = crate::service::create_synthetic(
                &store.org,
                inline_body_check(&store, "https://{{HOST}}/"),
                "user",
            )
            .await
            .unwrap();
            assert!(
                crate::service::delete_variable(&store.org, None, &variable.id, true)
                    .await
                    .unwrap()
            );
            latch_write_only().await;
            crate::origins_backfill::run_origins_backfill()
                .await
                .unwrap();
            assert!(
                get_marker_in(
                    conn,
                    META_ORG,
                    infra::table::secret_store_job_markers::ORIGINS_BACKFILL,
                )
                .await
                .unwrap()
                .is_some()
            );
            let stored = synthetics_checks::get(conn, &store.org, &healthy.id)
                .await
                .unwrap()
                .unwrap();
            assert!(stored.config_secrets.contains_key("#m/body"));
            let (job_id, token) = store.lease(&healthy).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.synthetic.target, "http://api.example.com/");
            assert_eq!(served.synthetic.config["body"], "{\"ping\":\"pong\"}");
            assert_eq!(served.allowed_hosts, ["http://api.example.com:80"]);
            let stored = synthetics_checks::get(conn, &store.org, &unresolved.id)
                .await
                .unwrap()
                .unwrap();
            assert!(
                stored
                    .config_secrets
                    .keys()
                    .all(|key| !key.starts_with("#m/"))
            );
            let (job_id, token) = store.lease(&unresolved).await;
            let refused = store.resolve(&job_id, Some(&token)).await.unwrap_err();
            assert_eq!(
                config_reason(&refused),
                Some("secret_error:slot_origin_changed")
            );
        },
    )
    .await;
}

#[tokio::test]
async fn a_store_ref_on_plain_http_is_still_refused() {
    in_child("a_store_ref_on_plain_http_is_still_refused", || async {
        let store = Store::new().await;
        let secret = store.secret("API_KEY", PrivateLocations::Off).await;
        let check = Synthetic {
            target: "http://api.example.com/".into(),
            ..http_check(&store, "Bearer {{secrets.API_KEY}}")
        };
        let refused = store.save(check, &secret).await.unwrap_err();
        assert_eq!(
            refused.downcast_ref::<CheckSecretRefusal>().unwrap().code,
            SecretErrorCode::InsecureTransport
        );
    })
    .await;
}

#[tokio::test]
async fn a_leased_resolve_sends_the_value_and_never_the_ref() {
    in_child(
        "a_leased_resolve_sends_the_value_and_never_the_ref",
        || async {
            let store = Store::new().await;
            let secret = store.secret("API_KEY", PrivateLocations::Off).await;
            let check = store
                .save(http_check(&store, "Bearer {{secrets.API_KEY}}"), &secret)
                .await
                .unwrap();

            let (job_id, token) = store.lease(&check).await;
            let resolved = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(
                resolved.synthetic.config["headers"][0]["value"],
                format!("Bearer {VALUE}")
            );
            assert_eq!(resolved.allowed_hosts, ["https://api.example.com:443"]);
            assert_eq!(resolved.synthetic.config["follow_redirects"], false);
            let wire = serde_json::to_string(&resolved).unwrap();
            assert!(!wire.contains("{{secrets."), "{wire}");

            let mut ack = ack_with_error(&job_id, &format!("401 for Bearer {VALUE} at {HOST}"));
            job_api::redact_ack_error(&mut ack, &store.org).await;
            let scrubbed = ack.error.unwrap();
            assert!(!scrubbed.contains(VALUE), "{scrubbed}");
            assert!(scrubbed.contains(HOST), "{scrubbed}");

            let (job_id, _) = store.lease(&check).await;
            let refused = store.resolve(&job_id, None).await.unwrap_err();
            assert_eq!(
                refused.downcast_ref::<AttemptError>(),
                Some(&AttemptError::ProbeUpgradeRequired)
            );

            // A definition edit no bound save signed: the value is never sent.
            let conn = get_orm_client_rw().await;
            let mut edited = synthetics_checks::get(conn, &store.org, &check.id)
                .await
                .unwrap()
                .unwrap();
            edited.target = format!("{HOST}/other");
            synthetics_checks::update_row(conn, &store.org, &check.id, &edited)
                .await
                .unwrap();
            synthetics_checks::invalidate_and_publish(&store.org, &check.id).await;
            let (job_id, token) = store.lease(&check).await;
            let stale = store.resolve(&job_id, Some(&token)).await.unwrap_err();
            assert_eq!(config_reason(&stale), Some("secret_error:delivery_stale"));
            assert!(!format!("{stale:#}").contains(VALUE));
        },
    )
    .await;
}

#[tokio::test]
async fn a_private_parent_cannot_embed_a_child_ref_to_a_private_off_secret() {
    in_child(
        "a_private_parent_cannot_embed_a_child_ref_to_a_private_off_secret",
        || async {
            let store = Store::new().await;
            let secret = store.secret("STEP_SECRET", PrivateLocations::Off).await;
            let nav = json!({"id": "s0", "action": "navigate", "url": format!("{HOST}/")});
            let child = Synthetic {
                name: format!("child-{}", ksuid()),
                check_type: SyntheticType::Browser,
                target: format!("{HOST}/"),
                config: json!({"steps": [
                    nav,
                    {"id": "s1", "action": "fill", "locator": {"candidates": [{"kind": "css", "value": "#p"}]}, "value": "{{secrets.STEP_SECRET}}"}
                ]}),
                        locations: vec![store.public.clone()],
                alert_if_fails: 1,
                ..Default::default()
            };
            let child = store.save(child, &secret).await.unwrap();

            let private = location(&store.org, KIND_PRIVATE).await;
            let parent = Synthetic {
                name: format!("parent-{}", ksuid()),
                check_type: SyntheticType::Browser,
                target: format!("{HOST}/"),
                config: json!({"steps": [
                    nav,
                    {"id": "s1", "action": "subtest", "subtest": {"id": child.id}}
                ]}),
                        locations: vec![private.clone()],
                alert_if_fails: 1,
                ..Default::default()
            };
            let refused = store.save(parent, &secret).await.unwrap_err();
            let refusal = refused
                .downcast_ref::<CheckSecretRefusal>()
                .unwrap_or_else(|| panic!("not a store refusal: {refused:#}"));
            assert_eq!(refusal.code, SecretErrorCode::SecretPrivateLocationRefused);
            assert_eq!(refusal.secret.as_deref(), Some("STEP_SECRET"));
            assert_eq!(refusal.locations.as_deref(), Some(&[private][..]));
        },
    )
    .await;
}

#[tokio::test]
async fn an_old_agent_gets_inline_values_in_the_banner_period_stamped_and_audited() {
    in_child(
        "an_old_agent_gets_inline_values_in_the_banner_period_stamped_and_audited",
        || async {
            let store = Store::new().await;
            let start = boot_markers().await;
            let during = start + 3_600_000_000;
            let now = config::utils::time::now_micros();
            let inline = crate::service::create_synthetic(&store.org, inline_check(&store), "user")
                .await
                .unwrap();
            let plain = crate::service::create_synthetic(&store.org, plain_check(&store), "user")
                .await
                .unwrap();

            let agent = store.agent(now).await;
            let (job_id, _) = store.claim(&inline, &agent, None).await;
            let served = store.resolve_at(&job_id, None, during).await.unwrap();
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
            assert_eq!(tokenless_stamp(&agent).await, Some(during));
            let audit = served.agent_audit.clone().expect("one agent_resolve event");
            assert_eq!(audit.agent_id, agent);
            assert_eq!(audit.location_id, store.public);
            assert_eq!(audit.check_id, inline.id);
            assert_eq!(audit.job_id, job_id);
            assert_eq!(audit.attempt, 1);
            assert!(audit.secret_ids.is_empty());
            assert!(!audit.inline_slots.is_empty());
            assert!(!audit.target().contains(PASSWORD), "{}", audit.target());
            assert!(
                !serde_json::to_string(&served)
                    .unwrap()
                    .contains("agent_resolve")
            );

            // No write-only value: served, not stamped, not audited.
            let other = store.agent(now).await;
            let (job_id, _) = store.claim(&plain, &other, None).await;
            let served = store.resolve_at(&job_id, None, during).await.unwrap();
            assert!(served.agent_audit.is_none());
            assert_eq!(tokenless_stamp(&other).await, None);

            // A dispatcher attempt writes no agent_resolve event.
            let (job_id, token) = store.lease(&inline).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert!(served.agent_audit.is_none());
        },
    )
    .await;
}

#[tokio::test]
async fn opted_in_latched_store_refuses_tokenless_inline_credentials_after_seven_days() {
    in_child(
        "opted_in_latched_store_refuses_tokenless_inline_credentials_after_seven_days",
        || async {
            let store = Store::new().await;
            let after = boot_markers().await + 8 * DAY_US;
            let now = config::utils::time::now_micros();
            let inline = crate::service::create_synthetic(&store.org, inline_check(&store), "user")
                .await
                .unwrap();
            let plain = crate::service::create_synthetic(&store.org, plain_check(&store), "user")
                .await
                .unwrap();
            let agent = store.agent(now).await;

            let (job_id, _) = store.claim(&inline, &agent, None).await;
            let refused = store.resolve_at(&job_id, None, after).await.unwrap_err();
            assert_eq!(
                refused.downcast_ref::<AttemptError>(),
                Some(&AttemptError::ProbeUpgradeRequired)
            );
            assert!(!format!("{refused:#}").contains(PASSWORD));
            let (job_id, _) = store.claim(&plain, &agent, None).await;
            store.resolve_at(&job_id, None, after).await.unwrap();

            let (job_id, token) = store.lease(&inline).await;
            let served = store
                .resolve_at(&job_id, Some(&token), after)
                .await
                .unwrap();
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
        },
    )
    .await;
}

#[tokio::test]
async fn empty_lease_opt_in_keeps_tokenless_inline_credentials_after_seven_days() {
    in_child_with_lease_config(
        "empty_lease_opt_in_keeps_tokenless_inline_credentials_after_seven_days",
        "",
        0,
        || async {
            let store = Store::new().await;
            let after = boot_markers().await + 8 * DAY_US;
            let inline = crate::service::create_synthetic(&store.org, inline_check(&store), "user")
                .await
                .unwrap();
            let (job_id, _) = store.claim(&inline, "runner", None).await;
            let served = store.resolve_at(&job_id, None, after).await.unwrap();
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
            assert!(
                runner_lease_notice(get_orm_client_rw().await)
                    .await
                    .unwrap()
                    .is_none()
            );
        },
    )
    .await;
}

#[tokio::test]
async fn lease_opt_in_without_latch_keeps_tokenless_inline_credentials_after_seven_days() {
    in_child(
        "lease_opt_in_without_latch_keeps_tokenless_inline_credentials_after_seven_days",
        || async {
            let store = Store::new().await;
            let after = boot_markers().await + 8 * DAY_US;
            let inline = crate::service::create_synthetic(&store.org, inline_check(&store), "user")
                .await
                .unwrap();
            infra::db::get_coordinator()
                .await
                .delete_if_exists("/secret_store/sys/gate", false, false)
                .await
                .unwrap();
            gate::force_state_for_tests(Some(gate::GateView {
                state: GateState::Closed,
                suspended: false,
            }));
            let (job_id, _) = store.claim(&inline, "runner", None).await;
            let served = store.resolve_at(&job_id, None, after).await.unwrap();
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
            assert!(
                runner_lease_notice(get_orm_client_rw().await)
                    .await
                    .unwrap()
                    .is_none()
            );
        },
    )
    .await;
}

#[tokio::test]
async fn an_agent_on_a_pre_cutover_token_gets_no_write_only_value() {
    in_child(
        "an_agent_on_a_pre_cutover_token_gets_no_write_only_value",
        || async {
            let store = Store::new().await;
            let during = boot_markers().await + 3_600_000_000;
            let inline = crate::service::create_synthetic(&store.org, inline_check(&store), "user")
                .await
                .unwrap();
            let plain = crate::service::create_synthetic(&store.org, plain_check(&store), "user")
                .await
                .unwrap();

            let old = store.agent(1).await;
            let (job_id, _) = store.claim(&inline, &old, None).await;
            let refused = store.resolve_at(&job_id, None, during).await.unwrap_err();
            assert_eq!(
                config_reason(&refused),
                Some("secret_error:agent_token_rotation_required")
            );
            assert!(!format!("{refused:#}").contains(PASSWORD));
            assert_eq!(tokenless_stamp(&old).await, None);
            let (job_id, _) = store.claim(&plain, &old, None).await;
            store.resolve_at(&job_id, None, during).await.unwrap();

            // Re-registered with a rotated token.
            let rotated = store.agent(config::utils::time::now_micros()).await;
            let (job_id, _) = store.claim(&inline, &rotated, None).await;
            store.resolve_at(&job_id, None, during).await.unwrap();
        },
    )
    .await;
}

#[tokio::test]
async fn an_agent_lease_audits_the_store_secret_ids_and_no_value() {
    in_child(
        "an_agent_lease_audits_the_store_secret_ids_and_no_value",
        || async {
            let store = Store::new().await;
            boot_markers().await;
            let secret = store.secret("AUDITED", PrivateLocations::On).await;
            let check = store
                .save(http_check(&store, "Bearer {{secrets.AUDITED}}"), &secret)
                .await
                .unwrap();
            let agent = store.agent(config::utils::time::now_micros()).await;
            let (job_id, token) = store.claim(&check, &agent, Some("agent")).await;
            let token = token.unwrap();
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            let audit = served.agent_audit.expect("one agent_resolve event");
            assert_eq!(audit.secret_ids, vec![secret.id]);
            let target = audit.target();
            assert!(target.starts_with("secret.agent_resolve "), "{target}");
            for leaked in [VALUE, token.as_str(), &token_sha256(&token)] {
                assert!(!target.contains(leaked), "{target}");
            }
        },
    )
    .await;
}

#[tokio::test]
async fn a_write_only_placeholder_in_a_url_is_refused_at_save_and_resolve() {
    in_child(
        "a_write_only_placeholder_in_a_url_is_refused_at_save_and_resolve",
        || async {
            let store = Store::new().await;
            let start = boot_markers().await;
            let pin = SyntheticVariable {
                name: "PIN".into(),
                value: "4711".into(),
                secure: true,
                example: String::new(),
            };
            let with_target = |target: &str, secure: bool| Synthetic {
                target: target.into(),
                variables: vec![SyntheticVariable {
                    secure,
                    ..pin.clone()
                }],
                ..plain_check(&store)
            };
            for target in [
                format!("{HOST}/x?k={{{{PIN}}}}"),
                format!("{HOST}/x?k={{{{_AUTH_TOKEN}}}}"),
            ] {
                let refused = crate::service::create_synthetic(
                    &store.org,
                    with_target(&target, true),
                    "user",
                )
                .await
                .unwrap_err();
                let refusal = refused
                    .downcast_ref::<CheckSecretRefusal>()
                    .unwrap_or_else(|| panic!("not a store refusal: {refused:#}"));
                assert_eq!(refusal.code, SecretErrorCode::RefNotAllowedInField);
            }
            let query = format!("{HOST}/x?k={{{{PIN}}}}");
            crate::service::create_synthetic(&store.org, with_target(&query, false), "user")
                .await
                .unwrap();

            // A check saved before the rule: served in the banner period, refused after it.
            let saved = crate::service::create_synthetic(
                &store.org,
                with_target(&format!("{HOST}/x"), true),
                "user",
            )
            .await
            .unwrap();
            let conn = get_orm_client_rw().await;
            let mut edited = synthetics_checks::get(conn, &store.org, &saved.id)
                .await
                .unwrap()
                .unwrap();
            edited.target = query;
            synthetics_checks::update_row(conn, &store.org, &saved.id, &edited)
                .await
                .unwrap();
            synthetics_checks::invalidate_and_publish(&store.org, &saved.id).await;
            let (job_id, token) = store.lease(&saved).await;
            store
                .resolve_at(&job_id, Some(&token), start + DAY_US)
                .await
                .unwrap();
            let (job_id, token) = store.lease(&saved).await;
            let refused = store
                .resolve_at(&job_id, Some(&token), start + 8 * DAY_US)
                .await
                .unwrap_err();
            assert_eq!(
                config_reason(&refused),
                Some("secret_error:ref_not_allowed_in_field")
            );
            assert!(!format!("{refused:#}").contains("4711"));
        },
    )
    .await;
}

#[test]
fn a_token_without_a_post_cutover_row_needs_rotation() {
    use job_api::token_rotation_required as needs;
    assert!(!needs(Some(1), None));
    assert!(!needs(None, None));
    assert!(needs(Some(1), Some(5)));
    assert!(!needs(Some(5), Some(5)));
    assert!(needs(None, Some(5)));
}

/// The same vectors are the runner-side acceptance data for `runner_contract=1`.
#[test]
fn allowed_hosts_follow_the_runner_contract_fixture() {
    use config::meta::secret_store::grammar::PinPattern;

    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/runner_contract_v1.json")).unwrap();
    for case in fixture["allowed_hosts"].as_array().unwrap() {
        let pins: Vec<Vec<PinPattern>> = case["pins"]
            .as_array()
            .unwrap()
            .iter()
            .map(|list| {
                list.as_array()
                    .unwrap()
                    .iter()
                    .map(|pin| PinPattern::parse(pin.as_str().unwrap()).unwrap())
                    .collect()
            })
            .collect();
        let got = job_api::allowed_hosts(&pins, case["target"].as_str().unwrap());
        match case["error"].as_str() {
            Some(code) => assert_eq!(got.map_err(|c| c.as_str()), Err(code), "{case}"),
            None => {
                let got = got.unwrap_or_else(|c| panic!("{case}: {c}"));
                assert_eq!(serde_json::json!(got), case["allowed_hosts"], "{case}");
                for refused in case["refused"].as_array().into_iter().flatten() {
                    let request = refused["request"].as_str().unwrap();
                    assert!(
                        !got.iter()
                            .any(|origin| PinPattern::parse(origin).unwrap().matches(request)),
                        "{case}: {request}"
                    );
                }
            }
        }
    }
}

async fn rename_secret(secret: &org_secrets::Model, to: &str) {
    let mut row: org_secrets::ActiveModel = secret.clone().into();
    row.name = Set(to.into());
    row.update(get_orm_client_rw().await).await.unwrap();
}

async fn respell_check(store: &Store, check: &Synthetic) -> bool {
    let key = reauthorize::k_auth_for(&store.org).await.unwrap();
    respell::respell_consumer(
        &store.org,
        ConsumerType::SyntheticsCheck,
        &check.id,
        &CheckRespell,
        &key,
    )
    .await
    .unwrap()
}

async fn consumer_auth(store: &Store, check: &Synthetic) -> secret_consumer_auth::Model {
    secret_consumer_auth::get_in(
        get_orm_client_rw().await,
        &store.org,
        ConsumerType::SyntheticsCheck.as_str(),
        &check.id,
    )
    .await
    .unwrap()
    .unwrap()
}

/// The row as stored, with sealed values opened: the text a respell must have rewritten.
async fn stored_text(store: &Store, check: &Synthetic) -> serde_json::Value {
    let mut row = synthetics_checks::get(get_orm_client_rw().await, &store.org, &check.id)
        .await
        .unwrap()
        .unwrap();
    crate::service::decrypt_synthetic_secrets(&store.org, &mut row)
        .await
        .unwrap();
    serde_json::to_value(&row).unwrap()
}

#[tokio::test]
async fn a_secret_rename_respells_the_check_and_keeps_its_signature() {
    in_child(
        "a_secret_rename_respells_the_check_and_keeps_its_signature",
        || async {
            let store = Store::new().await;
            let secret = store.secret("API_KEY", PrivateLocations::Off).await;
            let check = store
                .save(http_check(&store, "Bearer {{secrets.API_KEY}}"), &secret)
                .await
                .unwrap();
            let before = consumer_auth(&store, &check).await;

            rename_secret(&secret, "API_TOKEN").await;
            assert!(respell_check(&store, &check).await);

            let after = consumer_auth(&store, &check).await;
            assert_eq!(after.consumer_rev, before.consumer_rev + 1);
            assert_eq!(after.delivery_digest, before.delivery_digest);
            assert_eq!(after.via, "system:respell");
            let row = stored_text(&store, &check).await;
            assert_eq!(
                row["config"]["headers"][0]["value"],
                "Bearer {{secrets.API_TOKEN}}"
            );
            assert_eq!(row["updated_at"], json!(check.updated_at));
            let refs = secret_refs::list_for_consumer_in(
                get_orm_client_rw().await,
                &store.org,
                ConsumerType::SyntheticsCheck.as_str(),
                &check.id,
            )
            .await
            .unwrap();
            assert!(refs.iter().all(|r| r.token_name == "API_TOKEN"));
            assert!(!respell_check(&store, &check).await);

            let (job_id, token) = store.lease(&check).await;
            let resolved = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(
                resolved.synthetic.config["headers"][0]["value"],
                format!("Bearer {VALUE}")
            );
        },
    )
    .await;
}

/// A child with a step ref, and two parents splicing it in: `p1` also has its own step ref.
async fn composed_checks(store: &Store) -> (org_secrets::Model, [Synthetic; 3]) {
    let secret = store.secret("STEP_SECRET", PrivateLocations::Off).await;
    let nav = json!({"id": "s0", "action": "navigate", "url": format!("{HOST}/")});
    let fill = |id: &str| {
        json!({
            "id": id,
            "action": "fill",
            "locator": {"candidates": [{"kind": "css", "value": "#p"}]},
            "value": "{{secrets.STEP_SECRET}}",
        })
    };
    let browser = |name: &str, steps: serde_json::Value| Synthetic {
        name: format!("{name}-{}", ksuid()),
        check_type: SyntheticType::Browser,
        target: format!("{HOST}/"),
        config: json!({ "steps": steps }),
        locations: vec![store.public.clone()],
        alert_if_fails: 1,
        ..Default::default()
    };
    let mut saved = Vec::new();
    let child = browser("child", json!([nav, fill("s1")]));
    saved.push(store.save(child, &secret).await.unwrap());
    let mut secret = secret;
    let subtest = json!({"id": "p2", "action": "subtest", "subtest": {"id": saved[0].id}});
    for body in [
        browser("p1", json!([nav, fill("p1"), subtest])),
        browser("p2", json!([nav, subtest])),
    ] {
        secret = org_secrets::get_secret_in(get_orm_client_rw().await, &store.org, &secret.id)
            .await
            .unwrap()
            .unwrap();
        saved.push(store.save(body, &secret).await.unwrap());
    }
    let checks: [Synthetic; 3] = saved.try_into().unwrap();
    (secret, checks)
}

async fn assert_resolves(store: &Store, check: &Synthetic) {
    let (job_id, token) = store.lease(check).await;
    let resolved = store.resolve(&job_id, Some(&token)).await.unwrap();
    let wire = serde_json::to_string(&resolved.synthetic).unwrap();
    assert!(
        wire.contains(VALUE) && !wire.contains("{{secrets."),
        "{wire}"
    );
}

#[tokio::test]
async fn a_parent_respell_renames_its_child_and_every_parent_stays_signed() {
    in_child(
        "a_parent_respell_renames_its_child_and_every_parent_stays_signed",
        || async {
            let store = Store::new().await;
            let (secret, [child, p1, p2]) = composed_checks(&store).await;
            let before = consumer_auth(&store, &p1).await;
            let child_auth = consumer_auth(&store, &child).await;

            rename_secret(&secret, "STEP_TOKEN").await;
            assert!(respell_check(&store, &p1).await);

            let after = consumer_auth(&store, &p1).await;
            assert_eq!(after.consumer_rev, before.consumer_rev + 1);
            assert_eq!(after.delivery_digest, before.delivery_digest);
            let row = stored_text(&store, &p1).await;
            assert_eq!(row["config"]["steps"][1]["value"], "{{secrets.STEP_TOKEN}}");
            assert_eq!(row["config"]["steps"][2]["action"], "subtest");
            let child_row = stored_text(&store, &child).await;
            assert_eq!(
                child_row["config"]["steps"][1]["value"],
                "{{secrets.STEP_TOKEN}}"
            );
            assert_eq!(consumer_auth(&store, &child).await, child_auth);
            assert!(!respell_check(&store, &child).await);
            assert!(!respell_check(&store, &p2).await);
            for check in [&child, &p1, &p2] {
                assert_resolves(&store, check).await;
            }
        },
    )
    .await;
}

#[tokio::test]
async fn a_child_respell_first_keeps_its_parents_signed() {
    in_child("a_child_respell_first_keeps_its_parents_signed", || async {
        let store = Store::new().await;
        let (secret, [child, p1, p2]) = composed_checks(&store).await;
        let p2_auth = consumer_auth(&store, &p2).await;

        rename_secret(&secret, "STEP_TOKEN").await;
        assert!(respell_check(&store, &child).await);

        assert!(!respell_check(&store, &p2).await);
        assert_eq!(consumer_auth(&store, &p2).await, p2_auth);
        assert!(respell_check(&store, &p1).await);
        let row = stored_text(&store, &p1).await;
        assert_eq!(row["config"]["steps"][1]["value"], "{{secrets.STEP_TOKEN}}");
        for check in [&child, &p1, &p2] {
            assert_resolves(&store, check).await;
        }
    })
    .await;
}

async fn move_job_to(job_id: &str, env: &SyntheticsEnvironmentRecord) {
    let mut job: job_entity::ActiveModel = job_entity::Entity::find_by_id(job_id.to_owned())
        .one(get_orm_client_rw().await)
        .await
        .unwrap()
        .unwrap()
        .into();
    job.env = Set(Some(env.id.clone()));
    job.env_incarnation = Set(Some(env.incarnation()));
    job.update(get_orm_client_rw().await).await.unwrap();
}

#[tokio::test]
async fn an_environment_job_resolves_that_environments_value() {
    in_child(
        "an_environment_job_resolves_that_environments_value",
        || async {
            let store = Store::new().await;
            crate::service::create_environment(
                &store.org,
                SyntheticsEnvironmentRequest {
                    name: "staging".into(),
                    ..Default::default()
                },
                "user",
            )
            .await
            .unwrap();
            let staging = crate::service::get_environment(&store.org, "staging")
                .await
                .unwrap()
                .unwrap();
            let secret = store.secret("API_KEY", PrivateLocations::Off).await;
            store
                .set_value(
                    &secret,
                    &staging.id,
                    &staging.incarnation(),
                    "staging-value",
                )
                .await;
            let body = Synthetic {
                environments: vec![staging.id.clone()],
                ..http_check(&store, "Bearer {{secrets.API_KEY}}")
            };
            let check = store.save(body, &secret).await.unwrap();

            let (job_id, token) = store.lease(&check).await;
            move_job_to(&job_id, &staging).await;
            let resolved = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(
                resolved.synthetic.config["headers"][0]["value"],
                "Bearer staging-value"
            );

            // Bound to staging only: an org-scoped job has no signed dependency entry to match.
            let (job_id, token) = store.lease(&check).await;
            let refused = store.resolve(&job_id, Some(&token)).await.unwrap_err();
            assert_eq!(config_reason(&refused), Some("secret_error:delivery_stale"));

            let org_wide = store
                .save(
                    http_check(&store, "Bearer {{secrets.API_KEY}}"),
                    &secret_now(&store, &secret).await,
                )
                .await
                .unwrap();
            let (job_id, token) = store.lease(&org_wide).await;
            let resolved = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(
                resolved.synthetic.config["headers"][0]["value"],
                format!("Bearer {VALUE}")
            );
        },
    )
    .await;
}

#[tokio::test]
async fn a_shared_secret_variable_in_a_url_is_refused_at_save_also_through_a_child() {
    in_child(
        "a_shared_secret_variable_in_a_url_is_refused_at_save_also_through_a_child",
        || async {
            let store = Store::new().await;
            let local = vec![SyntheticVariable {
                name: "TOKEN".into(),
                value: "plain".into(),
                secure: false,
                example: String::new(),
            }];
            let browser = |steps: serde_json::Value| Synthetic {
                name: format!("browser-{}", ksuid()),
                check_type: SyntheticType::Browser,
                target: format!("{HOST}/"),
                config: json!({ "steps": steps }),
                locations: vec![store.public.clone()],
                alert_if_fails: 1,
                variables: local.clone(),
                ..Default::default()
            };
            let child = crate::service::create_synthetic(
                &store.org,
                browser(json!([
                    {"id": "s0", "action": "navigate", "url": format!("{HOST}/{{{{TOKEN}}}}")}
                ])),
                "user",
            )
            .await
            .unwrap();
            crate::service::create_environment(
                &store.org,
                SyntheticsEnvironmentRequest {
                    name: "staging".into(),
                    ..Default::default()
                },
                "user",
            )
            .await
            .unwrap();
            let staging = crate::service::get_environment(&store.org, "staging")
                .await
                .unwrap();
            crate::service::create_variable(
                &store.org,
                staging.as_ref(),
                SyntheticsVariableRequest {
                    name: "TOKEN".into(),
                    value: Some("t0ken-c4fe".into()),
                    kind: Some(SyntheticsVariableKind::Secret),
                    ..Default::default()
                },
                "user",
            )
            .await
            .unwrap();

            let direct = Synthetic {
                target: format!("{HOST}/x?k={{{{TOKEN}}}}"),
                variables: local.clone(),
                ..plain_check(&store)
            };
            let parent = browser(json!([
                {"id": "p0", "action": "navigate", "url": format!("{HOST}/")},
                {"id": "p1", "action": "subtest", "subtest": {"id": child.id}}
            ]));
            for body in [direct, parent] {
                let refused = crate::service::create_synthetic(&store.org, body, "user")
                    .await
                    .unwrap_err();
                let refusal = refused
                    .downcast_ref::<CheckSecretRefusal>()
                    .unwrap_or_else(|| panic!("not a store refusal: {refused:#}"));
                assert_eq!(refusal.code, SecretErrorCode::RefNotAllowedInField);
            }
        },
    )
    .await;
}

async fn secret_now(store: &Store, secret: &org_secrets::Model) -> org_secrets::Model {
    org_secrets::get_secret_in(get_orm_client_rw().await, &store.org, &secret.id)
        .await
        .unwrap()
        .unwrap()
}

/// T01 (R2-02): a probe on an unrotated token gets no write-only value of a rotated agent's job.
#[tokio::test]
async fn an_old_token_cannot_resolve_a_rotated_agents_job() {
    in_child(
        "an_old_token_cannot_resolve_a_rotated_agents_job",
        || async {
            let store = Store::new().await;
            let during = boot_markers().await + 3_600_000_000;
            let inline = crate::service::create_synthetic(&store.org, inline_check(&store), "user")
                .await
                .unwrap();
            let (agent, fresh) = store
                .agent_with_token(config::utils::time::now_micros())
                .await;
            let old = store.token(1).await;

            let (job_id, _) = store.claim(&inline, &agent, None).await;
            let refused = store
                .resolve_as(&job_id, None, during, Some(&old))
                .await
                .unwrap_err();
            assert_eq!(
                config_reason(&refused),
                Some("secret_error:agent_token_rotation_required")
            );
            let served = store
                .resolve_as(&job_id, None, during, Some(&fresh))
                .await
                .unwrap();
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
        },
    )
    .await;
}

/// Inline credentials retain HTTP support when write-only host pinning is live.
#[tokio::test]
async fn an_inline_value_gets_allowed_hosts_for_https_and_http() {
    in_child(
        "an_inline_value_gets_allowed_hosts_for_https_and_http",
        || async {
            let store = Store::new().await;
            let inline = crate::service::create_synthetic(&store.org, inline_check(&store), "user")
                .await
                .unwrap();
            let (job_id, token) = store.lease(&inline).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.allowed_hosts, ["https://api.example.com:443"]);
            assert_eq!(served.synthetic.config["follow_redirects"], false);

            let plain_http = Synthetic {
                target: "http://api.example.com/health".into(),
                ..inline_check(&store)
            };
            let plain_http = crate::service::create_synthetic(&store.org, plain_http, "user")
                .await
                .unwrap();
            let (job_id, token) = store.lease(&plain_http).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.allowed_hosts, ["http://api.example.com:80"]);
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
        },
    )
    .await;
}

/// T08: a shared `kind=secret` variable gets the lease, rotation, capture-off, audit and
/// ack-redaction rules of an inline write-only value.
#[tokio::test]
async fn a_shared_secret_variable_is_delivered_under_the_write_only_rules() {
    in_child(
        "a_shared_secret_variable_is_delivered_under_the_write_only_rules",
        || async {
            const SHARED: &str = "shared-s3cr3t-55e1";
            let store = Store::new().await;
            let start = boot_markers().await;
            crate::service::create_environment(
                &store.org,
                SyntheticsEnvironmentRequest {
                    name: "prod".into(),
                    ..Default::default()
                },
                "user",
            )
            .await
            .unwrap();
            let prod = crate::service::get_environment(&store.org, "prod")
                .await
                .unwrap()
                .unwrap();
            crate::service::create_variable(
                &store.org,
                Some(&prod),
                SyntheticsVariableRequest {
                    name: "API_TOKEN".into(),
                    value: Some(SHARED.into()),
                    kind: Some(SyntheticsVariableKind::Secret),
                    ..Default::default()
                },
                "user",
            )
            .await
            .unwrap();
            let body = Synthetic {
                collect_rum_data: true,
                config: json!({"method": "GET", "headers": [
                    {"name": "X-Trace", "value": "{{API_TOKEN}}", "secure": false}
                ]}),
                environments: vec![prod.id.clone()],
                ..plain_check(&store)
            };
            let check = crate::service::create_synthetic(&store.org, body, "user")
                .await
                .unwrap();

            let agent = store.agent(config::utils::time::now_micros()).await;
            let (job_id, _) = store.claim(&check, &agent, None).await;
            move_job_to(&job_id, &prod).await;
            let served = store
                .resolve_at(&job_id, None, start + 3_600_000_000)
                .await
                .unwrap();
            assert_eq!(served.env_inject["API_TOKEN"], SHARED);
            assert!(!served.synthetic.collect_rum_data);
            let audit = served.agent_audit.expect("one agent_resolve event");
            assert_eq!(audit.secret_variables, ["API_TOKEN"]);
            assert!(!audit.target().contains(SHARED));
            let mut ack = ack_with_error(&job_id, &format!("401 for Bearer {SHARED}"));
            job_api::redact_ack_error(&mut ack, &store.org).await;
            let scrubbed = ack.error.unwrap();
            assert!(!scrubbed.contains(SHARED), "{scrubbed}");

            let old = store.agent(1).await;
            let (job_id, _) = store.claim(&check, &old, None).await;
            move_job_to(&job_id, &prod).await;
            let refused = store
                .resolve_at(&job_id, None, start + 3_600_000_000)
                .await
                .unwrap_err();
            assert_eq!(
                config_reason(&refused),
                Some("secret_error:agent_token_rotation_required")
            );

            let (job_id, _) = store.claim(&check, &agent, None).await;
            move_job_to(&job_id, &prod).await;
            let refused = store
                .resolve_at(&job_id, None, start + 8 * DAY_US)
                .await
                .unwrap_err();
            assert_eq!(
                refused.downcast_ref::<AttemptError>(),
                Some(&AttemptError::ProbeUpgradeRequired)
            );
        },
    )
    .await;
}

/// T02: a value changed after delivery cannot be matched in the ack, so the whole error goes.
#[tokio::test]
async fn an_ack_after_a_mid_run_change_withholds_the_whole_error() {
    in_child(
        "an_ack_after_a_mid_run_change_withholds_the_whole_error",
        || async {
            let store = Store::new().await;
            let inline = crate::service::create_synthetic(&store.org, inline_check(&store), "user")
                .await
                .unwrap();
            let (job_id, token) = store.lease(&inline).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.env_inject["_AUTH_PASSWORD"], PASSWORD);
            assert!(served.metadata.get("_secret_delivery").is_none());

            let mut ack = ack_with_error(&job_id, &format!("401 for {PASSWORD} at {HOST}"));
            job_api::redact_ack_error(&mut ack, &store.org).await;
            let scrubbed = ack.error.unwrap();
            assert!(
                !scrubbed.contains(PASSWORD) && scrubbed.contains(HOST),
                "{scrubbed}"
            );

            let rotated = Synthetic {
                auth: Some(SyntheticAuth::Basic {
                    username: "probe".into(),
                    password: "rotated-pw-0d1e".into(),
                }),
                ..inline.clone()
            };
            crate::service::update_synthetic(&store.org, &inline.id, rotated)
                .await
                .unwrap();
            let mut ack = ack_with_error(&job_id, &format!("401 for {PASSWORD} at {HOST}"));
            ack.status_reason = Some(format!("bad {PASSWORD}"));
            job_api::redact_ack_error(&mut ack, &store.org).await;
            assert_eq!(ack.error.as_deref(), Some("[REDACTED]"));
            assert_eq!(ack.status_reason, None);

            let mut foreign = ack_with_error(&job_id, &format!("401 for {PASSWORD}"));
            job_api::redact_ack_error(&mut foreign, "another-org").await;
            assert!(foreign.error.unwrap().contains(PASSWORD));
        },
    )
    .await;
}

/// T03: an embedded child's value typed for one host never travels a parent journey to another.
#[tokio::test]
async fn an_embedded_childs_value_follows_the_parents_hosts() {
    in_child(
        "an_embedded_childs_value_follows_the_parents_hosts",
        || async {
            const OTHER: &str = "https://other.example.com";
            const STEP_PW: &str = "child-pw-3b7a";
            let store = Store::new().await;
            let browser = |steps: serde_json::Value| Synthetic {
                name: format!("browser-{}", ksuid()),
                check_type: SyntheticType::Browser,
                target: format!("{HOST}/"),
                config: json!({ "steps": steps }),
                locations: vec![store.public.clone()],
                alert_if_fails: 1,
                ..Default::default()
            };
            let child = crate::service::create_synthetic(
                &store.org,
                browser(json!([
                    {"id": "c0", "action": "navigate", "url": format!("{HOST}/login")},
                    {"id": "c1", "action": "fill",
                     "locator": {"candidates": [{"kind": "css", "value": "#p"}]},
                     "value": STEP_PW}
                ])),
                "user",
            )
            .await
            .unwrap();
            let subtest = json!({"id": "p1", "action": "subtest", "subtest": {"id": child.id}});
            let elsewhere = Synthetic {
                target: format!("{OTHER}/"),
                ..browser(json!([
                    {"id": "p0", "action": "navigate", "url": format!("{OTHER}/")},
                    subtest
                ]))
            };
            let refused = crate::service::create_synthetic(&store.org, elsewhere.clone(), "user")
                .await
                .unwrap_err();
            let refusal = refused
                .downcast_ref::<crate::service::SlotRefusal>()
                .unwrap_or_else(|| panic!("not a slot refusal: {refused:#}"));
            assert_eq!(refusal.code, SecretErrorCode::SlotValueRequiredOnHostChange);

            let same_host = browser(json!([
                {"id": "p0", "action": "navigate", "url": format!("{HOST}/")},
                subtest
            ]));
            let parent = crate::service::create_synthetic(&store.org, same_host, "user")
                .await
                .unwrap();
            let (job_id, token) = store.lease(&parent).await;
            store.resolve(&job_id, Some(&token)).await.unwrap();

            // A parent row moved to another host past the save check is refused at resolve.
            let conn = get_orm_client_rw().await;
            let mut edited = synthetics_checks::get(conn, &store.org, &parent.id)
                .await
                .unwrap()
                .unwrap();
            edited.config["steps"][0]["url"] = format!("{OTHER}/").into();
            synthetics_checks::update_row(conn, &store.org, &parent.id, &edited)
                .await
                .unwrap();
            synthetics_checks::invalidate_and_publish(&store.org, &parent.id).await;
            let (job_id, token) = store.lease(&parent).await;
            let refused = store.resolve(&job_id, Some(&token)).await.unwrap_err();
            assert_eq!(
                config_reason(&refused),
                Some(job_api::REASON_SLOT_ORIGIN_CHANGED)
            );
            assert!(!format!("{refused:#}").contains(STEP_PW));
        },
    )
    .await;
}

#[tokio::test]
async fn a_store_bound_resolve_prepares_and_resolves_the_check_once() {
    in_child(
        "a_store_bound_resolve_prepares_and_resolves_the_check_once",
        || async {
            use job_api::cost;
            let store = Store::new().await;
            let secret = store.secret("API_KEY", PrivateLocations::Off).await;
            let check = store
                .save(http_check(&store, "Bearer {{secrets.API_KEY}}"), &secret)
                .await
                .unwrap();
            let (job_id, token) = store.lease(&check).await;
            for step in [
                "prepare_delivery",
                "store_resolution",
                "org_variables_read",
                "store_dependency_read",
                "bound_secret_ids_read",
                "carried_pins_read",
            ] {
                cost::take(&store.org, step);
            }

            let resolved = store.resolve(&job_id, Some(&token)).await.unwrap();
            // The bound ids and pins come from the rows the resolver already read.
            assert_eq!(cost::take(&store.org, "bound_secret_ids_read"), 0);
            assert_eq!(cost::take(&store.org, "carried_pins_read"), 0);
            assert_eq!(
                resolved.synthetic.config["headers"][0]["value"],
                format!("Bearer {VALUE}")
            );
            assert_eq!(cost::take(&store.org, "prepare_delivery"), 1);
            assert_eq!(cost::take(&store.org, "store_resolution"), 1);
            assert!(cost::take(&store.org, "org_variables_read") <= 1);
            // The ref alone already requires a lease, so the dependency read is skipped.
            assert_eq!(cost::take(&store.org, "store_dependency_read"), 0);

            // The marker stamped from the delivered values matches what the ack recomputes.
            let mut ack = ack_with_error(&job_id, &format!("401 for Bearer {VALUE} at {HOST}"));
            job_api::redact_ack_error(&mut ack, &store.org).await;
            let scrubbed = ack.error.unwrap();
            assert!(
                !scrubbed.contains(VALUE) && scrubbed.contains(HOST),
                "{scrubbed}"
            );
        },
    )
    .await;
}

#[tokio::test]
async fn a_child_save_reads_its_parents_bindings_in_one_statement() {
    in_child(
        "a_child_save_reads_its_parents_bindings_in_one_statement",
        || async {
            use job_api::cost;
            let store = Store::new().await;
            let (secret, [child, p1, p2]) = composed_checks(&store).await;
            let secret = secret_now(&store, &secret).await;
            let mut body = child.clone();
            body.config["steps"][1]["value"] = json!("{{secrets.STEP_SECRET}}");
            cost::take(&store.org, "parent_refs_statement");

            let actor = CheckSaveActor {
                user_id: "user",
                role: "admin",
                authz: &AllowAll,
            };
            crate::service::update_synthetic_with_binds(
                &store.org,
                &child.id,
                body,
                "user",
                Some(actor),
                vec![SecretBindOption {
                    secret_id: secret.id.clone(),
                    allow_this_consumer: true,
                    pin: BindPin::Keep,
                    expected_policy_rev: secret.policy_rev.clone(),
                }],
            )
            .await
            .unwrap();

            assert_eq!(cost::take(&store.org, "parent_refs_statement"), 1);
            for check in [&child, &p1, &p2] {
                assert_resolves(&store, check).await;
            }
        },
    )
    .await;
}

#[tokio::test]
async fn a_save_response_hides_only_secure_header_values() {
    in_child(
        "a_save_response_hides_only_secure_header_values",
        || async {
            let store = Store::new().await;
            insert_if_absent_in(
                get_orm_client_rw().await,
                META_ORG,
                SYNTHETICS_WRITE_ONLY,
                1,
            )
            .await
            .unwrap();
            let check = Synthetic {
                config: json!({"method": "GET", "headers": [
                    {"name": "X-Inline-Token", "value": PASSWORD, "secure": true},
                    {"name": "X-Plain", "value": "plain-visible"},
                ]}),
                ..plain_check(&store)
            };
            let created = crate::service::create_synthetic(&store.org, check, "user")
                .await
                .unwrap();
            let headers = &created.config["headers"];
            assert_eq!(headers[1]["value"], "plain-visible");
            assert_eq!(headers[0]["value"]["set"], true);
            assert!(!serde_json::to_string(&created).unwrap().contains(PASSWORD));
        },
    )
    .await;
}

#[tokio::test]
async fn the_check_loader_reports_the_url_a_send_reaches() {
    in_child(
        "the_check_loader_reports_the_url_a_send_reaches",
        || async {
            use respell::RespellTarget;
            use sea_orm::TransactionTrait;

            let store = Store::new().await;
            let created = crate::service::create_synthetic(&store.org, plain_check(&store), "user")
                .await
                .unwrap();
            let txn = get_orm_client_rw().await.begin().await.unwrap();
            let loader = crate::service::respell::CheckRespell;
            assert_eq!(
                loader
                    .request_urls(&txn, &store.org, &created.id)
                    .await
                    .unwrap(),
                [format!("{HOST}/health")]
            );
            assert!(
                loader
                    .request_urls(&txn, &store.org, "missing")
                    .await
                    .unwrap()
                    .is_empty()
            );
        },
    )
    .await;
}

/// An HTTP check whose only secret is the shared `LEGACY_KEY` in a non-secure header.
fn shared_header_check(store: &Store) -> Synthetic {
    Synthetic {
        config: json!({"method": "GET", "headers": [
            {"name": "X-Trace", "value": "Bearer {{LEGACY_KEY}}", "secure": false}
        ]}),
        ..plain_check(store)
    }
}

/// A shared secret keeps HTTP support; changing its value withholds unverifiable ACK text.
#[tokio::test]
async fn a_shared_secret_allows_http_and_a_changed_value_withholds_the_ack() {
    in_child(
        "a_shared_secret_allows_http_and_a_changed_value_withholds_the_ack",
        || async {
            const OLD: &str = "legacy-v1-5d0e";
            const NEW: &str = "legacy-v2-9a1b";
            let store = Store::new().await;
            let request = |value: &str| SyntheticsVariableRequest {
                name: "LEGACY_KEY".into(),
                value: Some(value.into()),
                kind: Some(SyntheticsVariableKind::Secret),
                ..Default::default()
            };
            crate::service::create_environment(
                &store.org,
                SyntheticsEnvironmentRequest {
                    name: "prod".into(),
                    ..Default::default()
                },
                "user",
            )
            .await
            .unwrap();
            let prod = crate::service::get_environment(&store.org, "prod")
                .await
                .unwrap()
                .unwrap();
            let variable =
                crate::service::create_variable(&store.org, Some(&prod), request(OLD), "user")
                    .await
                    .unwrap();
            let in_prod = |body: Synthetic| Synthetic {
                environments: vec![prod.id.clone()],
                ..body
            };

            let plain = in_prod(Synthetic {
                target: "http://api.example.com/health".into(),
                ..shared_header_check(&store)
            });
            let plain = crate::service::create_synthetic(&store.org, plain, "user")
                .await
                .unwrap();
            let (job_id, token) = store.lease(&plain).await;
            move_job_to(&job_id, &prod).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.allowed_hosts, ["http://api.example.com:80"]);
            assert_eq!(served.env_inject["LEGACY_KEY"], OLD);

            let body = in_prod(shared_header_check(&store));
            let check = crate::service::create_synthetic(&store.org, body, "user")
                .await
                .unwrap();
            let (job_id, token) = store.lease(&check).await;
            move_job_to(&job_id, &prod).await;
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.env_inject["LEGACY_KEY"], OLD);
            assert_eq!(served.allowed_hosts, ["https://api.example.com:443"]);
            assert_eq!(served.synthetic.config["follow_redirects"], false);

            crate::service::update_variable(
                &store.org,
                Some(&prod),
                &variable.id,
                request(NEW),
                true,
            )
            .await
            .unwrap();
            let served = store.resolve(&job_id, Some(&token)).await.unwrap();
            assert_eq!(served.env_inject["LEGACY_KEY"], NEW);
            let mut ack = ack_with_error(&job_id, &format!("401 for Bearer {OLD}"));
            ack.error_source = format!("Bearer {OLD}");
            job_api::redact_ack_error(&mut ack, &store.org).await;
            let scrubbed = ack.error.unwrap();
            assert!(!scrubbed.contains(OLD), "{scrubbed}");
            assert_eq!(ack.error_source, "");
            let config = crate::alerting::ERROR_SOURCE_CONFIG;
            let mut ack = ack_with_error(&job_id, "timeout");
            ack.error_source = config.into();
            job_api::redact_ack_error(&mut ack, &store.org).await;
            assert_eq!(ack.error_source, "", "a reserved code is scrubbed too");

            // An unverifiable attempt drops every code; a fresh one keeps a clean code.
            let (job_id, token) = store.lease(&check).await;
            move_job_to(&job_id, &prod).await;
            store.resolve(&job_id, Some(&token)).await.unwrap();
            let mut ack = ack_with_error(&job_id, "timeout");
            ack.error_source = "probe".into();
            job_api::redact_ack_error(&mut ack, &store.org).await;
            assert_eq!(ack.error_source, "probe");
            let mut ack = ack_with_error(&job_id, "timeout");
            ack.error_source = config.into();
            job_api::redact_ack_error(&mut ack, &store.org).await;
            assert_eq!(ack.error_source, config);
        },
    )
    .await;
}

/// N04: a lease that expires while the resolve works releases no value.
#[tokio::test]
async fn a_lease_that_expires_during_resolve_releases_nothing() {
    in_child(
        "a_lease_that_expires_during_resolve_releases_nothing",
        || async {
            let store = Store::new().await;
            let check = crate::service::create_synthetic(&store.org, inline_check(&store), "user")
                .await
                .unwrap();
            let (job_id, token) = store.lease(&check).await;
            let now = config::utils::time::now_micros();
            let conn = get_orm_client_rw().await;
            let mut job: job_entity::ActiveModel = job_entity::Entity::find_by_id(&job_id)
                .one(conn)
                .await
                .unwrap()
                .unwrap()
                .into();
            job.lease_expires_at = Set(Some(now + 1));
            job.update(conn).await.unwrap();

            let refused = store
                .resolve_at(&job_id, Some(&token), now)
                .await
                .unwrap_err();
            assert_eq!(
                refused.downcast_ref::<AttemptError>(),
                Some(&AttemptError::Superseded)
            );
        },
    )
    .await;
}

/// T02: a value sent that the check on record no longer holds leaves the marker unverifiable.
#[tokio::test]
async fn a_check_edited_during_resolve_stamps_an_unverifiable_marker() {
    in_child(
        "a_check_edited_during_resolve_stamps_an_unverifiable_marker",
        || async {
            let store = Store::new().await;
            let check = crate::service::create_synthetic(&store.org, inline_check(&store), "user")
                .await
                .unwrap();
            let (job_id, _) = store.lease(&check).await;
            let conn = get_orm_client_rw().await;
            let job = job_entity::Entity::find_by_id(&job_id)
                .one(conn)
                .await
                .unwrap()
                .unwrap();
            let marker = |inline: &str| {
                let delivered = job_api::Delivered {
                    inline: zeroize::Zeroizing::new(vec![inline.to_owned()]),
                    legacy: Default::default(),
                    store: None,
                };
                job_api::delivery_marker(conn, &job, delivered)
            };
            let current = marker(PASSWORD).await.unwrap();
            assert_ne!(current, job_api::UNVERIFIABLE_DELIVERY);
            assert_eq!(
                marker("edited-away-pw").await.as_deref(),
                Some(job_api::UNVERIFIABLE_DELIVERY)
            );

            // A store ref or shared placeholder dropped mid-resolve: its sent value is not on
            // record.
            let dropped = |legacy: Vec<String>, store: Option<Vec<String>>| {
                let delivered = job_api::Delivered {
                    inline: zeroize::Zeroizing::new(vec![PASSWORD.to_owned()]),
                    legacy: zeroize::Zeroizing::new(legacy),
                    store: store.map(job_api::StoreValues::for_tests),
                };
                job_api::delivery_marker(conn, &job, delivered)
            };
            for (legacy, store) in [
                (vec!["dropped-shared-v".to_owned()], None),
                (Vec::new(), Some(vec!["dropped-store-v".to_owned()])),
            ] {
                assert_eq!(
                    dropped(legacy, store).await.as_deref(),
                    Some(job_api::UNVERIFIABLE_DELIVERY)
                );
            }
        },
    )
    .await;
}
