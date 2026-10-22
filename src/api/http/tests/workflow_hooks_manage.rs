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

//! Own test binary: hooks on, audit on, a master key installed and OpenFGA off.

#![cfg(feature = "enterprise")]
#![allow(linker_messages)]

#[path = "support/workflow_hooks.rs"]
mod support;

use axum::http::{Method, StatusCode};
use config::meta::user::UserRole;
use infra::{
    secrets::{self, SecretMaterial, SecretOwnerKind},
    table::{workflow_http_trigger_requests::HookRunStatus, workflow_http_triggers as triggers},
};
use openobserve_core::workflows::http_trigger::credentials::sha256_hex;
use serde_json::{Value, json};
use support::*;

const ENV: &[(&str, &str)] = &[
    ("O2_WORKFLOW_HOOKS_ENABLED", "true"),
    ("ZO_WORKFLOW_HOOK_WORKER_DISABLED", "true"),
    ("O2_AUDIT_ENABLED", "true"),
    ("O2_AUDIT_BATCH_SIZE", "100000"),
    (
        "O2_MASTER_ENCRYPTION_KEY",
        "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQ==",
    ),
];
const ORG: &str = "mgmt";
const ADMIN: &str = "admin@mgmt.io";
const EDITOR: &str = "editor@mgmt.io";

fn base(workflow_id: &str) -> String {
    format!("/api/{ORG}/workflows/{workflow_id}/http_trigger")
}

async fn call(method: Method, uri: &str, email: &str, body: Option<Value>) -> Reply {
    send(as_user(method, uri, email, body)).await
}

async fn setup(workflow_id: &str) {
    seed_user(ORG, ADMIN, UserRole::Admin).await;
    seed_user(ORG, EDITOR, UserRole::Editor).await;
    seed_workflow(ORG, workflow_id, true).await;
}

/// Creates a token endpoint as the admin and returns the PUT reply.
async fn create(workflow_id: &str) -> Reply {
    setup(workflow_id).await;
    let reply = call(
        Method::PUT,
        &base(workflow_id),
        ADMIN,
        Some(json!({"enabled": true, "auth_mode": "token"})),
    )
    .await;
    assert_eq!(reply.status, StatusCode::CREATED, "{:?}", reply.json());
    reply
}

async fn dry_run(org: &str, trigger_id: &str, token: &str) -> StatusCode {
    let path = format!("/api/v2/{org}/workflows/hooks/{trigger_id}");
    send(post_token(
        &path,
        "203.0.113.9",
        token,
        &[("x-o2-dry-run", "true")],
        b"{}",
    ))
    .await
    .status
}

fn credential_id(view: &Value) -> String {
    view["credentials"][0]["id"].as_str().unwrap().to_string()
}

/// Cases share the audit queue, so each counts only the events on its own workflow.
fn reveal_events(audits: &[Value], workflow_id: &str) -> Vec<Value> {
    audits
        .iter()
        .filter(|row| {
            row["http_body"]
                .as_str()
                .is_some_and(|body| body.contains("credential_revealed"))
                && row["http_path"]
                    .as_str()
                    .is_some_and(|path| path.contains(&format!("/workflows/{workflow_id}/")))
        })
        .cloned()
        .collect()
}

#[test]
fn reveal_sets_no_store() {
    run(ENV, async {
        let created = create("wf-reveal").await.json();
        let token = created["secret"].as_str().unwrap().to_string();
        let id = credential_id(&created);
        let reveal = call(
            Method::GET,
            &format!("{}/credentials/{id}/secret", base("wf-reveal")),
            ADMIN,
            None,
        )
        .await;
        assert_eq!(reveal.status, StatusCode::OK);
        assert_eq!(reveal.header("cache-control"), Some("no-store, private"));
        let json = reveal.json();
        assert_eq!(json["secret"], token);
        assert_eq!(json["id"], id);
        assert_eq!(json["kind"], "token");
        assert_eq!(json["state"], "active");
        assert_eq!(
            json["display_prefix"],
            created["credentials"][0]["display_prefix"]
        );
        let trigger_id = created["id"].as_str().unwrap();
        assert_eq!(dry_run(ORG, trigger_id, &token).await, StatusCode::OK);
    });
}

#[test]
fn secret_bearing_mints_set_no_store() {
    run(ENV, async {
        let created = create("wf-nostore").await;
        assert_eq!(created.header("cache-control"), Some("no-store, private"));
        let update = call(
            Method::PUT,
            &base("wf-nostore"),
            ADMIN,
            Some(json!({"enabled": false, "auth_mode": "token", "rate_limit_per_minute": 5})),
        )
        .await;
        assert_eq!(update.status, StatusCode::OK);
        assert_eq!(update.json()["secret"], Value::Null);
        assert_eq!(update.json()["rate_limit_per_minute"], 5);
        assert_eq!(update.header("cache-control"), None);
        let switch = call(
            Method::PUT,
            &base("wf-nostore"),
            ADMIN,
            Some(json!({"enabled": true, "auth_mode": "signature"})),
        )
        .await;
        assert_eq!(switch.status, StatusCode::OK);
        assert_eq!(switch.header("cache-control"), Some("no-store, private"));
        assert!(
            switch.json()["secret"]
                .as_str()
                .unwrap()
                .starts_with("whsec_")
        );
        let rotate = call(
            Method::POST,
            &format!("{}/credentials", base("wf-nostore")),
            ADMIN,
            Some(json!({"overlap_seconds": 3600})),
        )
        .await;
        assert_eq!(rotate.status, StatusCode::CREATED);
        assert_eq!(rotate.header("cache-control"), Some("no-store, private"));
        let rotated = rotate.json();
        assert_eq!(rotated["kind"], "signing_secret");
        assert_eq!(rotated["state"], "active");
        assert!(rotated["secret"].as_str().unwrap().starts_with("whsec_"));
        let again = call(
            Method::POST,
            &format!("{}/credentials", base("wf-nostore")),
            ADMIN,
            Some(json!({"overlap_seconds": 0})),
        )
        .await;
        assert_eq!(again.status, StatusCode::CONFLICT);
        assert_eq!(again.json()["error_detail"], "credential_retiring");
    });
}

#[test]
fn reveal_writes_one_audit_event_without_the_value() {
    run(ENV, async {
        let created = create("wf-audit").await.json();
        let token = created["secret"].as_str().unwrap().to_string();
        let id = credential_id(&created);
        drained_audits().await;
        let path = format!("{}/credentials/{id}/secret", base("wf-audit"));
        assert_eq!(
            call(Method::GET, &path, ADMIN, None).await.status,
            StatusCode::OK
        );
        let audits = drained_audits().await;
        assert!(
            audits.iter().all(|row| !row.to_string().contains(&token)),
            "an audit row carries the value"
        );
        let events = reveal_events(&audits, "wf-audit");
        assert_eq!(events.len(), 1, "{audits:#?}");
        let event = events[0].to_string();
        for expected in [
            ADMIN,
            "credential_revealed",
            created["id"].as_str().unwrap(),
            id.as_str(),
            created["credentials"][0]["display_prefix"]
                .as_str()
                .unwrap(),
            &format!("{ORG}/workflows/wf-audit/http_trigger/credentials/{id}/secret"),
        ] {
            assert!(event.contains(expected), "{expected} missing from {event}");
        }
    });
}

#[test]
fn a_denied_reveal_is_not_audited() {
    run(ENV, async {
        let created = create("wf-denied").await.json();
        let id = credential_id(&created);
        drained_audits().await;
        let path = format!("{}/credentials/{id}/secret", base("wf-denied"));
        assert_eq!(
            call(Method::GET, &path, EDITOR, None).await.status,
            StatusCode::FORBIDDEN
        );
        let missing = format!("{}/credentials/unknown/secret", base("wf-denied"));
        assert_eq!(
            call(Method::GET, &missing, ADMIN, None).await.status,
            StatusCode::NOT_FOUND
        );
        assert!(reveal_events(&drained_audits().await, "wf-denied").is_empty());
    });
}

/// OpenFGA off: every member may edit and test, only Admin/Root may obtain a credential value.
#[test]
fn a_member_cannot_reveal_or_mint_without_admin() {
    run(ENV, async {
        setup("wf-member").await;
        let url = base("wf-member");
        let body = json!({"enabled": true, "auth_mode": "token"});
        let refused = call(Method::PUT, &url, EDITOR, Some(body.clone())).await;
        assert_eq!(refused.status, StatusCode::FORBIDDEN);
        assert_eq!(refused.json()["error_detail"], "credential_access_required");
        let unconfigured = call(Method::GET, &url, EDITOR, None).await;
        assert_eq!(unconfigured.status, StatusCode::NOT_FOUND);
        assert_eq!(unconfigured.json()["error_detail"], "not_configured");
        assert_eq!(
            unconfigured.json()["permissions"],
            json!({"edit": true, "test": true, "reveal": false})
        );
        let created = call(Method::PUT, &url, ADMIN, Some(body)).await.json();
        let id = credential_id(&created);
        assert_eq!(
            created["permissions"],
            json!({"edit": true, "test": true, "reveal": true})
        );
        let seen = call(Method::GET, &url, EDITOR, None).await;
        assert_eq!(seen.status, StatusCode::OK);
        assert_eq!(seen.json()["permissions"]["reveal"], false);
        let reveal = format!("{url}/credentials/{id}/secret");
        assert_eq!(
            call(Method::GET, &reveal, EDITOR, None).await.status,
            StatusCode::FORBIDDEN
        );
        let rotate = call(
            Method::POST,
            &format!("{url}/credentials"),
            EDITOR,
            Some(json!({"overlap_seconds": 0})),
        )
        .await;
        assert_eq!(rotate.status, StatusCode::FORBIDDEN);
        let switch = call(
            Method::PUT,
            &url,
            EDITOR,
            Some(json!({"enabled": true, "auth_mode": "signature"})),
        )
        .await;
        assert_eq!(switch.status, StatusCode::FORBIDDEN);
        let update = call(
            Method::PUT,
            &url,
            EDITOR,
            Some(json!({"enabled": false, "auth_mode": "token"})),
        )
        .await;
        assert_eq!(update.status, StatusCode::OK);
        let revoke = call(
            Method::DELETE,
            &format!("{url}/credentials/{id}"),
            EDITOR,
            None,
        )
        .await;
        assert_eq!(revoke.status, StatusCode::NO_CONTENT);
        assert_eq!(
            call(Method::GET, &reveal, ADMIN, None).await.status,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            call(Method::DELETE, &url, EDITOR, None).await.status,
            StatusCode::NO_CONTENT
        );
    });
}

#[test]
fn minting_a_token_stores_it_encrypted_and_hashed() {
    run(ENV, async {
        let created = create("wf-stored").await.json();
        let token = created["secret"].as_str().unwrap().to_string();
        assert_eq!(created["secrets_encrypted_at_rest"], true);
        let trigger_id = created["id"].as_str().unwrap();
        let rw = infra::db::get_orm_client_rw().await;
        let row = triggers::list_credentials(rw, trigger_id)
            .await
            .unwrap()
            .remove(0);
        assert_eq!(
            row.token_sha256.as_deref(),
            Some(sha256_hex(&token).as_str())
        );
        let secret_ref = row.secret_ref.clone().expect("a stored secret");
        let (meta, material) = secrets::resolve_record(
            ORG,
            &secret_ref,
            SecretOwnerKind::WorkflowTrigger,
            &row.id,
            secrets::CURRENT,
        )
        .await
        .unwrap();
        assert_eq!(meta.purpose, secrets::SecretPurpose::Auth);
        assert!(matches!(material, SecretMaterial::Token { value } if value == token));
    });
}

#[test]
fn get_put_validation_and_not_configured() {
    run(ENV, async {
        setup("wf-valid").await;
        let url = base("wf-valid");
        let missing = call(Method::GET, &url, ADMIN, None).await;
        assert_eq!(missing.status, StatusCode::NOT_FOUND);
        let body = missing.json();
        assert_eq!(body["error_detail"], "not_configured");
        assert!(body["org_rate_limit_per_minute"].as_u64().is_some());
        assert_eq!(body["secrets_encrypted_at_rest"], true);
        for (payload, code) in [
            (
                json!({"enabled": true, "auth_mode": "basic"}),
                "invalid_auth_mode",
            ),
            (
                json!({"enabled": true, "auth_mode": "token", "max_body_bytes": 2_000_000}),
                "invalid_limit",
            ),
            (
                json!({"enabled": true, "auth_mode": "token", "rate_limit_per_minute": 1_000_000}),
                "invalid_limit",
            ),
        ] {
            let reply = call(Method::PUT, &url, ADMIN, Some(payload)).await;
            assert_eq!(reply.status, StatusCode::BAD_REQUEST, "{code}");
            assert_eq!(reply.json()["error_detail"], code);
        }
        let nowhere = call(
            Method::PUT,
            &base("wf-does-not-exist"),
            ADMIN,
            Some(json!({"enabled": true, "auth_mode": "token"})),
        )
        .await;
        assert_eq!(nowhere.status, StatusCode::NOT_FOUND);
        assert_eq!(nowhere.json()["error_detail"], "workflow_not_found");
        seed_draft(ORG, "wf-draft-only").await;
        let draft = call(
            Method::PUT,
            &base("wf-draft-only"),
            ADMIN,
            Some(json!({"enabled": true, "auth_mode": "token"})),
        )
        .await;
        assert_eq!(draft.status, StatusCode::CREATED);
    });
}

#[test]
fn delete_then_invoke_401_and_recreate_revives_the_endpoint() {
    run(ENV, async {
        let created = create("wf-delete").await.json();
        let token = created["secret"].as_str().unwrap().to_string();
        let trigger_id = created["id"].as_str().unwrap().to_string();
        let url = base("wf-delete");
        assert_eq!(
            call(Method::DELETE, &url, ADMIN, None).await.status,
            StatusCode::NO_CONTENT
        );
        assert_eq!(
            dry_run(ORG, &trigger_id, &token).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            call(Method::DELETE, &url, ADMIN, None).await.status,
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            call(Method::GET, &url, ADMIN, None).await.status,
            StatusCode::NOT_FOUND
        );
        let again = call(
            Method::PUT,
            &url,
            ADMIN,
            Some(json!({"enabled": true, "auth_mode": "token"})),
        )
        .await;
        assert_eq!(again.status, StatusCode::CREATED);
        let again = again.json();
        assert_eq!(again["id"], trigger_id.as_str());
        assert_eq!(again["credentials"].as_array().unwrap().len(), 1);
        let fresh = again["secret"].as_str().unwrap();
        assert_eq!(dry_run(ORG, &trigger_id, fresh).await, StatusCode::OK);
        assert_eq!(
            dry_run(ORG, &trigger_id, &token).await,
            StatusCode::UNAUTHORIZED
        );
    });
}

#[test]
fn a_revived_endpoint_cannot_read_runs_from_before_its_tombstone() {
    run(ENV, async {
        let created = create("wf-revive-runs").await.json();
        let old = Seeded {
            org: ORG.to_string(),
            trigger_id: created["id"].as_str().unwrap().to_string(),
            workflow_id: "wf-revive-runs".to_string(),
            secret: created["secret"].as_str().unwrap().to_string(),
        };
        seed_ledger_row(&old, "run-before-delete").await;
        finish_queued_run(
            &old.trigger_id,
            "run-before-delete",
            HookRunStatus::Succeeded,
        )
        .await;
        let poll = old.poll_path("run-before-delete");
        let before = send(get_token(&poll, "203.0.113.95", &old.secret)).await;
        assert_eq!(before.status, StatusCode::OK, "{:?}", before.json());
        let url = base("wf-revive-runs");
        assert_eq!(
            call(Method::DELETE, &url, ADMIN, None).await.status,
            StatusCode::NO_CONTENT
        );
        let again = call(
            Method::PUT,
            &url,
            ADMIN,
            Some(json!({"enabled": true, "auth_mode": "token"})),
        )
        .await
        .json();
        assert_eq!(
            again["id"],
            old.trigger_id.as_str(),
            "the endpoint is revived"
        );
        let fresh = again["secret"].as_str().unwrap();
        let after = send(get_token(&poll, "203.0.113.95", fresh)).await;
        assert_eq!(after.status, StatusCode::NOT_FOUND, "{:?}", after.json());
        assert_eq!(after.json()["error_detail"], "run_not_found");
    });
}

#[test]
fn the_list_marks_http_endpoint_enabled() {
    run(ENV, async {
        create("wf-listed").await;
        seed_workflow(ORG, "wf-unlisted", true).await;
        let list = call(
            Method::GET,
            &format!("/api/{ORG}/workflows?all_folders=true"),
            ADMIN,
            None,
        )
        .await;
        assert_eq!(list.status, StatusCode::OK);
        let items = list.json();
        let flag = |id: &str| {
            items
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["id"] == id)
                .map(|item| item["http_endpoint_enabled"].clone())
        };
        assert_eq!(flag("wf-listed"), Some(Value::Bool(true)));
        assert_eq!(flag("wf-unlisted"), Some(Value::Bool(false)));
    });
}

#[test]
fn the_test_route_runs_the_hook_shaped_input_with_destinations_suppressed() {
    run(ENV, async {
        let created = create("wf-test").await.json();
        let destination = call(
            Method::POST,
            &format!("/api/{ORG}/alerts/destinations?module=pipeline"),
            ADMIN,
            Some(json!({"name": "absent", "url": "http://example.com/sink", "method": "post", "type": "http"})),
        )
        .await;
        assert!(destination.status.is_success(), "{:?}", destination.json());
        let reply = call(
            Method::POST,
            &format!("{}/test", base("wf-test")),
            ADMIN,
            Some(json!({"data": [{"event": "deploy"}]})),
        )
        .await;
        assert_eq!(reply.status, StatusCode::OK, "{:?}", reply.json());
        let body = reply.json().to_string();
        assert!(body.contains("\"event_type\":\"webhook\""), "{body}");
        assert!(body.contains("\"trigger_source\":\"http\""), "{body}");
        assert!(body.contains(created["id"].as_str().unwrap()), "{body}");
        assert!(body.contains("deploy"), "{body}");
    });
}

#[test]
fn revoking_a_credential_of_another_trigger_is_404() {
    run(ENV, async {
        let first = create("wf-scope-a").await.json();
        create("wf-scope-b").await;
        let foreign = credential_id(&first);
        let reply = call(
            Method::DELETE,
            &format!("{}/credentials/{foreign}", base("wf-scope-b")),
            ADMIN,
            None,
        )
        .await;
        assert_eq!(reply.status, StatusCode::NOT_FOUND);
        assert_eq!(reply.json()["error_detail"], "credential_not_found");
        let reveal = call(
            Method::GET,
            &format!("{}/credentials/{foreign}/secret", base("wf-scope-b")),
            ADMIN,
            None,
        )
        .await;
        assert_eq!(reveal.status, StatusCode::NOT_FOUND);
    });
}

#[test]
fn config_exposes_workflow_hooks_enabled() {
    run(ENV, async {
        seed_user(ORG, ADMIN, UserRole::Admin).await;
        let config = call(Method::GET, &format!("/api/{ORG}/config"), ADMIN, None).await;
        assert_eq!(config.status, StatusCode::OK);
        assert_eq!(config.json()["workflow_hooks_enabled"], true);
        assert_eq!(config.json()["workflows_enabled"], true);
    });
}
