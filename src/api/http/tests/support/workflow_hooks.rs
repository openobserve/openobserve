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

//! Shared boot and seeding for the workflow hook test binaries, one server config per binary.

#![allow(dead_code)]

use std::{collections::HashMap, net::IpAddr, sync::LazyLock};

use axum::{
    Router,
    body::{Body, Bytes},
    http::{HeaderMap, Method, Request, StatusCode},
};
use config::{
    axum::middlewares::RealIp, cluster::LOCAL_NODE, meta::organization::OrganizationType,
    utils::time::now_micros,
};
use infra::{
    db::{NO_NEED_WATCH, get_orm_client_rw},
    secrets,
    table::{
        cipher,
        entity::{
            workflow_http_trigger_credentials::Model as CredentialRow,
            workflow_http_triggers::Model as TriggerRow,
        },
        organizations,
        workflow_http_trigger_requests::{self as ledger, LedgerInsert, NewHookRequest},
        workflow_http_triggers::{
            self as triggers, AuthMode, CredentialKind, CredentialState, ReplicatedCredential,
            ReplicatedTrigger, TriggerSnapshot,
        },
        workflows::{self, Workflow},
    },
};
use openobserve_core::workflows::http_trigger::{
    HEARTBEAT_KEY,
    credentials::{
        MintedSecret, display_prefix, mint_signing_secret, mint_token, prepare_secret, sha256_hex,
    },
    signature::{SignedContent, decode_secret, sign},
    worker::Heartbeat,
};
use tokio::sync::OnceCell;
use tower::ServiceExt;

pub static RUNTIME: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .unwrap()
});

static APP: OnceCell<Router> = OnceCell::const_new();

pub struct Seeded {
    pub org: String,
    pub trigger_id: String,
    pub workflow_id: String,
    pub secret: String,
}

impl Seeded {
    pub fn invoke_path(&self) -> String {
        format!("/api/v2/{}/workflows/hooks/{}", self.org, self.trigger_id)
    }

    pub fn poll_path(&self, run_id: &str) -> String {
        format!("{}/runs/{run_id}", self.invoke_path())
    }
}

pub struct Reply {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: Bytes,
}

impl Reply {
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_slice(&self.body).unwrap_or(serde_json::Value::Null)
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(name).and_then(|v| v.to_str().ok())
    }
}

/// Runs a test case on the binary's one runtime, so the meta-store pool outlives every case.
pub fn run<F: std::future::Future<Output = ()>>(
    env: &'static [(&'static str, &'static str)],
    case: F,
) {
    RUNTIME.block_on(async {
        boot(env).await;
        case.await;
    });
}

pub async fn boot(env: &'static [(&'static str, &'static str)]) {
    APP.get_or_init(|| async {
        let data_dir = std::env::temp_dir().join(format!(
            "o2-workflow-hooks-{}-{}",
            std::process::id(),
            now_micros()
        ));
        std::fs::create_dir_all(data_dir.join("db")).unwrap();
        let dir = format!("{}/", data_dir.display());
        set_env("ZO_LOCAL_MODE", "true");
        set_env("ZO_META_STORE", "sqlite");
        set_env("ZO_DATA_DIR", &dir);
        set_env("ZO_DATA_DB_DIR", &format!("{dir}db/"));
        set_env("ZO_WEB_URL", "https://o2.example.com");
        set_env("O2_WORKFLOWS_ENABLED", "true");
        for (key, value) in env {
            set_env(key, value);
        }
        infra::db::create_table().await.unwrap();
        infra::db_init().await.unwrap();
        infra::table::migrate().await.unwrap();
        cipher::boot(None).await.unwrap();
        openobserve_api_http::handler::http::router::create_app_router(stub_ui)
    })
    .await;
}

pub fn app() -> Router {
    APP.get().expect("boot first").clone()
}

pub async fn send(req: Request<Body>) -> Reply {
    let resp = app().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let body = axum::body::to_bytes(resp.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    Reply {
        status,
        headers,
        body,
    }
}

pub fn request(
    method: Method,
    uri: &str,
    ip: &str,
    headers: &[(&str, &str)],
    body: Body,
) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri(uri);
    for (name, value) in headers {
        builder = builder.header(*name, *value);
    }
    if !ip.is_empty() {
        builder = builder.extension(RealIp(ip.parse::<IpAddr>().unwrap()));
    }
    builder.body(body).unwrap()
}

pub fn post_token(
    path: &str,
    ip: &str,
    token: &str,
    extra: &[(&str, &str)],
    body: &[u8],
) -> Request<Body> {
    let bearer = format!("Bearer {token}");
    let mut headers = vec![
        ("authorization", bearer.as_str()),
        ("content-type", "application/json"),
    ];
    headers.extend_from_slice(extra);
    request(Method::POST, path, ip, &headers, Body::from(body.to_vec()))
}

pub fn get_token(path: &str, ip: &str, token: &str) -> Request<Body> {
    let bearer = format!("Bearer {token}");
    request(
        Method::GET,
        path,
        ip,
        &[("authorization", bearer.as_str())],
        Body::empty(),
    )
}

/// Signs at `ts` with the trigger's secret over the body for a POST or over `GET {path}` for a GET.
pub fn signed(
    method: Method,
    path: &str,
    ip: &str,
    secret: &str,
    id: &str,
    ts: i64,
    body: &[u8],
) -> Request<Body> {
    let key = decode_secret(secret).unwrap();
    let content = if method == Method::GET {
        SignedContent::Poll(path)
    } else {
        SignedContent::Invoke(body)
    };
    let signature = sign(&key, id, ts, content);
    let ts = ts.to_string();
    request(
        method,
        path,
        ip,
        &[
            ("webhook-id", id),
            ("webhook-timestamp", ts.as_str()),
            ("webhook-signature", signature.as_str()),
            ("content-type", "application/json"),
        ],
        Body::from(body.to_vec()),
    )
}

pub fn now_secs() -> i64 {
    now_micros() / 1_000_000
}

pub async fn seed_org(org: &str) {
    if organizations::find(org).await.unwrap().is_none() {
        organizations::add(org, org, OrganizationType::Custom)
            .await
            .unwrap();
    }
}

pub async fn seed_workflow(org: &str, id: &str, enabled: bool) {
    workflows::save_workflow(workflow(org, id, enabled))
        .await
        .unwrap();
}

pub async fn seed_draft(org: &str, id: &str) {
    workflows::save_draft(workflow(org, id, true))
        .await
        .unwrap();
}

/// A published Alert Fired workflow linked to `alert_id` the way the alerts API links it.
pub async fn seed_alert_workflow(org: &str, id: &str, alert_id: &str) {
    let mut workflow = workflow(org, id, true);
    workflow.nodes[0].meta = Some(HashMap::from([(
        "trigger_kind".to_string(),
        "alert_fired".to_string(),
    )]));
    workflows::save_workflow(workflow).await.unwrap();
    workflows::add_workflow_association(workflows::WorkflowAssociation {
        id: 0,
        org_id: org.to_string(),
        entity_id: alert_id.to_string(),
        entity_type: workflows::WorkflowTriggerEntity::Alert.to_string(),
        workflow_id: id.to_string(),
        trigger_type: "AlertFired".to_string(),
        created_at: now_micros(),
    })
    .await
    .unwrap();
}

/// The trigger node's kind and the workflow's (entity, entity type, trigger type) links.
pub async fn kind_and_links(
    org: &str,
    id: &str,
) -> (Option<String>, Vec<(String, String, String)>) {
    let workflow = workflows::get_by_org_wid(org, id).await.unwrap().unwrap();
    let kind = workflow.nodes[0]
        .meta
        .as_ref()
        .and_then(|meta| meta.get("trigger_kind").cloned());
    let links = workflows::get_all_associations_for_workflow(org, id)
        .await
        .unwrap()
        .into_iter()
        .map(|link| (link.entity_id, link.entity_type, link.trigger_type))
        .collect();
    (kind, links)
}

/// A token-mode trigger with one active credential, on a published, enabled workflow.
pub async fn seed_token_trigger(org: &str, name: &str) -> Seeded {
    seed_token_trigger_with(org, name, |_| {}).await
}

/// Each trigger gets its own workflow, since `workflow_id` is UNIQUE among triggers.
pub async fn seed_token_trigger_with(
    org: &str,
    name: &str,
    edit: impl FnOnce(&mut TriggerRow),
) -> Seeded {
    seed_org(org).await;
    let workflow_id = format!("wf-{name}");
    seed_workflow(org, &workflow_id, true).await;
    seed_token_trigger_for(org, name, &workflow_id, edit).await
}

pub async fn seed_token_trigger_for(
    org: &str,
    name: &str,
    workflow_id: &str,
    edit: impl FnOnce(&mut TriggerRow),
) -> Seeded {
    let trigger_id = format!("trg{name}");
    let mut row = trigger_row(org, &trigger_id, workflow_id, AuthMode::Token);
    edit(&mut row);
    let rw = get_orm_client_rw().await;
    triggers::insert_trigger(rw, row).await.unwrap();
    let minted = mint_token();
    add_token_credential(
        &trigger_id,
        org,
        &format!("cred-{name}"),
        &minted.plaintext,
        CredentialState::Active,
        None,
    )
    .await;
    Seeded {
        org: org.to_string(),
        trigger_id,
        workflow_id: workflow_id.to_string(),
        secret: minted.plaintext,
    }
}

pub async fn add_token_credential(
    trigger_id: &str,
    org: &str,
    credential_id: &str,
    token: &str,
    state: CredentialState,
    expires_at: Option<i64>,
) {
    let now = now_micros();
    let rw = get_orm_client_rw().await;
    let minted = MintedSecret {
        plaintext: token.to_string(),
        display_prefix: display_prefix(token),
        token_sha256: Some(sha256_hex(token)),
    };
    // A revoked token keeps no secret, as after a real revoke.
    let secret_ref = match state {
        CredentialState::Revoked => None,
        _ => {
            let prepared = prepare_secret(org, credential_id, CredentialKind::Token, &minted)
                .await
                .unwrap();
            let written = secrets::insert_prepared(rw, prepared).await.unwrap();
            Some(written.metadata.secret_ref)
        }
    };
    triggers::insert_credential(
        rw,
        CredentialRow {
            id: credential_id.to_string(),
            trigger_id: trigger_id.to_string(),
            org_id: org.to_string(),
            kind: CredentialKind::Token.as_str().to_string(),
            display_prefix: minted.display_prefix,
            token_sha256: minted.token_sha256,
            secret_ref,
            state: state.as_str().to_string(),
            expires_at,
            revoked_at: (state == CredentialState::Revoked).then_some(now),
            created_by: "a@acme.io".to_string(),
            created_at: now,
            updated_at: now,
            last_used_at: None,
        },
    )
    .await
    .unwrap();
}

pub async fn seed_signed_trigger(org: &str, name: &str) -> Seeded {
    seed_signed_trigger_with(org, name, 1024 * 1024).await
}

/// A signature-mode trigger stored as a replicated snapshot stores it, secret encrypted locally.
pub async fn seed_signed_trigger_with(org: &str, name: &str, max_body_bytes: i64) -> Seeded {
    seed_org(org).await;
    let workflow_id = format!("wf-{name}");
    seed_workflow(org, &workflow_id, true).await;
    let trigger_id = format!("trg{name}");
    let minted = mint_signing_secret();
    let now = now_micros();
    let snapshot = TriggerSnapshot {
        version: 1,
        origin_cluster: "local".to_string(),
        deleted: false,
        trigger: ReplicatedTrigger {
            id: trigger_id.clone(),
            org_id: org.to_string(),
            workflow_id: workflow_id.clone(),
            enabled: true,
            auth_mode: AuthMode::Signature,
            max_body_bytes,
            rate_limit_per_minute: 60,
            created_by: "a@acme.io".to_string(),
            created_at: now,
            updated_at: now,
            deleted_at: None,
        },
        credentials: vec![ReplicatedCredential {
            id: format!("cred-{name}"),
            kind: CredentialKind::SigningSecret,
            display_prefix: minted.display_prefix.clone(),
            token_sha256: None,
            state: CredentialState::Active,
            expires_at: None,
            revoked_at: None,
            created_by: "a@acme.io".to_string(),
            created_at: now,
            updated_at: now,
            secret: Some(minted.plaintext.clone()),
        }],
    };
    triggers::apply_snapshot(snapshot).await.unwrap();
    Seeded {
        org: org.to_string(),
        trigger_id,
        workflow_id,
        secret: minted.plaintext,
    }
}

pub fn trigger_row(org: &str, trigger_id: &str, workflow_id: &str, mode: AuthMode) -> TriggerRow {
    let now = now_micros();
    TriggerRow {
        id: trigger_id.to_string(),
        org_id: org.to_string(),
        workflow_id: workflow_id.to_string(),
        enabled: true,
        auth_mode: mode.as_str().to_string(),
        max_body_bytes: 1024 * 1024,
        rate_limit_per_minute: 60,
        created_by: "a@acme.io".to_string(),
        created_at: now,
        updated_at: now,
        version: 1,
        origin_cluster: "local".to_string(),
        deleted_at: None,
        last_invoked_at: None,
        rejections: None,
    }
}

pub async fn write_heartbeat() {
    let beat = Heartbeat {
        node_uuid: LOCAL_NODE.uuid.clone(),
        ts: now_micros(),
    };
    infra::db::get_db()
        .await
        .put(
            HEARTBEAT_KEY,
            serde_json::to_vec(&beat).unwrap().into(),
            NO_NEED_WATCH,
            None,
        )
        .await
        .unwrap();
}

pub async fn ledger_rows(seeded: &Seeded) -> usize {
    ledger::list_for_workflow(
        get_orm_client_rw().await,
        &seeded.org,
        &seeded.workflow_id,
        0,
        i64::MAX,
        10_000,
    )
    .await
    .unwrap()
    .iter()
    .filter(|r| r.trigger_id == seeded.trigger_id)
    .count()
}

pub async fn run_row(
    trigger_id: &str,
    run_id: &str,
) -> Option<infra::table::entity::workflow_http_trigger_requests::Model> {
    ledger::get_run(get_orm_client_rw().await, trigger_id, run_id)
        .await
        .unwrap()
}

pub async fn seed_ledger_row(seeded: &Seeded, run_id: &str) {
    let inserted = ledger::enqueue(
        get_orm_client_rw().await,
        NewHookRequest {
            trigger_id: seeded.trigger_id.clone(),
            org_id: seeded.org.clone(),
            workflow_id: seeded.workflow_id.clone(),
            run_id: run_id.to_string(),
            idem_key: None,
            body_sha256: "ab".repeat(32),
            body_bytes: 2,
            content_type: Some("application/json".to_string()),
            meta: "{}".to_string(),
            credential_id: "cred".to_string(),
            credential_prefix: "o2wh_abcd…wxyz".to_string(),
            caller_ip: "203.0.113.1".to_string(),
            received_at: now_micros(),
        },
        r#"{"meta":{},"data":[]}"#.to_string(),
    )
    .await
    .unwrap();
    assert!(matches!(inserted, LedgerInsert::Inserted));
}

fn workflow(org: &str, id: &str, enabled: bool) -> Workflow {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "org_id": org,
        "created_at": 0,
        "updated_at": 0,
        "created_by": "a@acme.io",
        "enabled": enabled,
        "name": id,
        "description": "",
        "nodes": [
            {
                "id": "trigger-1",
                "data": {"node_type": "workflow_trigger"},
                "position": {"x": 100, "y": 100},
                "io_type": "input",
            },
            {
                "id": "dest-1",
                "data": {"node_type": "destination", "destination_id": "absent", "template_override": null},
                "position": {"x": 400, "y": 100},
                "io_type": "output",
            },
        ],
        "edges": [{"id": "e1", "source": "trigger-1", "target": "dest-1"}],
    }))
    .unwrap()
}

fn set_env(key: &str, value: &str) {
    // SAFETY: set once, inside the first boot, before any thread reads the config.
    unsafe { std::env::set_var(key, value) };
}

fn stub_ui(_web_path: &str) -> Router {
    Router::new()
}
