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

//! Own test binary: hooks on, no worker, a small per-IP budget; every case uses its own IP and org.

#![cfg(feature = "enterprise")]
#![allow(linker_messages)]

#[path = "support/workflow_hooks.rs"]
mod support;

use axum::{
    body::Body,
    http::{Method, StatusCode},
};
use common::{infra::config::ORG_STATUS_CACHE, meta::organization::OrgStatus};
use config::utils::time::now_micros;
use db::workflow_http_triggers::{TRIGGER_KEY_PREFIX, notify_local};
use infra::{
    coordinator::get_coordinator,
    db::get_orm_client_rw,
    secrets::{self, SecretMaterial, SecretOwnerKind, SecretPurpose},
    table::{
        workflow_http_trigger_requests::{
            self as ledger, HookRunStatus, LedgerInsert, NewHookRequest,
        },
        workflow_http_triggers::{self as triggers, CredentialState, TOMBSTONE_TTL_US},
    },
};
use openobserve_core::workflows::http_trigger::{
    credentials::{mint_signing_secret, sha256_hex},
    sweeper,
};
use support::*;

const ENV: &[(&str, &str)] = &[
    ("O2_WORKFLOW_HOOKS_ENABLED", "true"),
    ("ZO_WORKFLOW_HOOK_WORKER_DISABLED", "true"),
    ("ZO_WORKFLOW_HOOK_IP_RPM", "200"),
];
const UNAUTHORIZED: &str = r#"{"code":401,"message":"Unauthorized","error_detail":"unauthorized"}"#;
const BODY: &[u8] = br#"{"event":"deploy"}"#;
const MIB: usize = 1024 * 1024;

fn assert_uniform_401(reply: &Reply, case: &str) -> String {
    assert_eq!(reply.status, StatusCode::UNAUTHORIZED, "{case}");
    assert_eq!(
        std::str::from_utf8(&reply.body).unwrap(),
        UNAUTHORIZED,
        "{case}"
    );
    reply
        .header("www-authenticate")
        .unwrap_or_else(|| panic!("{case}: no WWW-Authenticate"))
        .to_string()
}

fn assert_reason(reply: &Reply, status: StatusCode, reason: &str) {
    assert_eq!(reply.status, status, "{:?}", reply.json());
    assert_eq!(reply.json()["error_detail"], reason, "{:?}", reply.json());
    assert_eq!(reply.json()["code"], status.as_u16());
}

#[test]
fn create_app_router_builds_with_workflow_hook_routes() {
    run(ENV, async {
        let reply = send(post_token(
            "/api/v2/o/workflows/hooks/x",
            "203.0.113.1",
            "o2wh_x",
            &[],
            BODY,
        ))
        .await;
        assert_uniform_401(&reply, "unknown trigger on the real app");
    });
}

#[test]
fn prepare_secret_encrypts_under_the_org_dek() {
    run(ENV, async {
        let seeded = seed_token_trigger("prepsecret", "prepsecret").await;
        let rw = get_orm_client_rw().await;
        let row = triggers::list_credentials(rw, &seeded.trigger_id)
            .await
            .unwrap()
            .remove(0);
        assert_eq!(row.token_sha256, Some(sha256_hex(&seeded.secret)));
        let secret_ref = row
            .secret_ref
            .clone()
            .expect("a token row holds its secret_ref");
        let held = secrets::list_for_owner(&seeded.org, SecretOwnerKind::WorkflowTrigger, &row.id)
            .await
            .unwrap();
        assert_eq!(held.len(), 1);
        assert_eq!(
            (held[0].secret_ref.as_str(), held[0].purpose),
            (secret_ref.as_str(), SecretPurpose::Auth)
        );
        let (_, material) = secrets::resolve_record(
            &seeded.org,
            &secret_ref,
            SecretOwnerKind::WorkflowTrigger,
            &row.id,
            secrets::CURRENT,
        )
        .await
        .unwrap();
        assert!(matches!(material, SecretMaterial::Token { value } if value == seeded.secret));
        let accepted = send(post_token(
            &seeded.invoke_path(),
            "203.0.113.90",
            &seeded.secret,
            &[],
            BODY,
        ))
        .await;
        assert_eq!(
            accepted.status,
            StatusCode::ACCEPTED,
            "{:?}",
            accepted.json()
        );
    });
}

#[test]
fn a_get_on_the_invoke_url_is_405() {
    run(ENV, async {
        let reply = send(get_token(
            "/api/v2/o/workflows/hooks/x",
            "203.0.113.2",
            "o2wh_x",
        ))
        .await;
        assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED);
        let reply = send(request(
            Method::PUT,
            "/api/v2/o/workflows/hooks/x",
            "203.0.113.2",
            &[],
            Body::empty(),
        ))
        .await;
        assert_eq!(reply.status, StatusCode::METHOD_NOT_ALLOWED);
    });
}

#[test]
fn every_identity_failure_returns_the_same_401() {
    run(ENV, async {
        let ip = "203.0.113.3";
        let a = seed_token_trigger("idn", "idA").await;
        let expired = "o2wh_expiredExpiredExpiredExpiredExpiredExpi";
        let revoked = "o2wh_revokedRevokedRevokedRevokedRevokedRevo";
        add_token_credential(
            &a.trigger_id,
            "idn",
            "cred-idA-exp",
            expired,
            CredentialState::Retiring,
            Some(now_micros() - 1),
        )
        .await;
        add_token_credential(
            &a.trigger_id,
            "idn",
            "cred-idA-rev",
            revoked,
            CredentialState::Revoked,
            None,
        )
        .await;
        let tomb =
            seed_token_trigger_with("idn", "idTomb", |row| row.deleted_at = Some(now_micros()))
                .await;
        seed_workflow("ghost", "wf-idGhost", true).await;
        let ghost = seed_token_trigger_for("ghost", "idGhost", "wf-idGhost", |_| {}).await;
        seed_org("idn2").await;
        let signed = seed_signed_trigger("idn", "idSig").await;
        let wrong_secret = mint_signing_secret().plaintext;

        let cases = vec![
            (
                "unknown trigger",
                post_token("/api/v2/idn/workflows/hooks/nope", ip, &a.secret, &[], BODY),
            ),
            (
                "other org",
                post_token(
                    &format!("/api/v2/idn2/workflows/hooks/{}", a.trigger_id),
                    ip,
                    &a.secret,
                    &[],
                    BODY,
                ),
            ),
            (
                "tombstoned trigger",
                post_token(&tomb.invoke_path(), ip, &tomb.secret, &[], BODY),
            ),
            (
                "missing org row",
                post_token(&ghost.invoke_path(), ip, &ghost.secret, &[], BODY),
            ),
            (
                "missing credential",
                request(Method::POST, &a.invoke_path(), ip, &[], Body::from(BODY)),
            ),
            (
                "invalid token",
                post_token(&a.invoke_path(), ip, "o2wh_wrong", &[], BODY),
            ),
            (
                "expired credential",
                post_token(&a.invoke_path(), ip, expired, &[], BODY),
            ),
            (
                "revoked credential",
                post_token(&a.invoke_path(), ip, revoked, &[], BODY),
            ),
            (
                "token on a signed trigger",
                post_token(&signed.invoke_path(), ip, &a.secret, &[], BODY),
            ),
            (
                "bad signature",
                signed_request(&signed.invoke_path(), ip, &wrong_secret, now_secs(), BODY),
            ),
            (
                "stale timestamp",
                signed_request(
                    &signed.invoke_path(),
                    ip,
                    &signed.secret,
                    now_secs() - 301,
                    BODY,
                ),
            ),
        ];
        let mut challenges = Vec::new();
        for (case, req) in cases {
            challenges.push(assert_uniform_401(&send(req).await, case));
        }
        challenges.dedup();
        assert_eq!(
            challenges.len(),
            1,
            "one WWW-Authenticate for every case: {challenges:?}"
        );
        let ok = send(signed_request(
            &signed.invoke_path(),
            ip,
            &signed.secret,
            now_secs(),
            BODY,
        ))
        .await;
        assert_ne!(
            ok.status,
            StatusCode::UNAUTHORIZED,
            "the control call verifies: {:?}",
            ok.json()
        );
    });
}

#[test]
fn an_org_being_deleted_answers_the_uniform_401() {
    run(ENV, async {
        write_heartbeat().await;
        let ip = "203.0.113.240";
        for (org, status) in [
            ("orgdel", OrgStatus::Deleting),
            ("orgpend", OrgStatus::PendingDeletion),
        ] {
            let a = seed_token_trigger(org, &format!("{org}A")).await;
            let run_id = format!("{org}-run");
            seed_ledger_row(&a, &run_id).await;
            ORG_STATUS_CACHE.insert(org.to_string(), status);
            let dry = [("x-o2-dry-run", "true")];
            for (case, req) in [
                (
                    "invoke",
                    post_token(&a.invoke_path(), ip, &a.secret, &[], BODY),
                ),
                (
                    "dry run",
                    post_token(&a.invoke_path(), ip, &a.secret, &dry, BODY),
                ),
                (
                    "run status",
                    get_token(&a.poll_path(&run_id), ip, &a.secret),
                ),
            ] {
                assert_uniform_401(&send(req).await, &format!("{org} {case}"));
            }
            assert_eq!(ledger_rows(&a).await, 1, "{org}: nothing new is queued");
            ORG_STATUS_CACHE.remove(org);
            let control = send(post_token(&a.invoke_path(), ip, &a.secret, &[], BODY)).await;
            assert_eq!(
                control.status,
                StatusCode::ACCEPTED,
                "{org}: the same call is accepted once the org is active: {:?}",
                control.json()
            );
        }
    });
}

#[test]
fn credential_in_url_is_400_before_lookup() {
    run(ENV, async {
        let ip = "203.0.113.4";
        let a = seed_token_trigger("ciu", "ciuA").await;
        let existing = send(post_token(
            &format!("{}?token=x", a.invoke_path()),
            ip,
            &a.secret,
            &[],
            BODY,
        ))
        .await;
        assert_reason(&existing, StatusCode::BAD_REQUEST, "credential_in_url");
        let unknown = send(post_token(
            "/api/v2/ciu/workflows/hooks/nope?Api_Key=x",
            ip,
            &a.secret,
            &[],
            BODY,
        ))
        .await;
        assert_eq!(
            (unknown.status, &unknown.body),
            (existing.status, &existing.body)
        );
        let in_path = send(post_token(
            "/api/v2/ciu/workflows/hooks/o2wh_abc",
            ip,
            &a.secret,
            &[],
            BODY,
        ))
        .await;
        assert_reason(&in_path, StatusCode::BAD_REQUEST, "credential_in_url");
        let value = send(get_token(
            &format!("{}?x=whsec_abc", a.poll_path("r")),
            ip,
            &a.secret,
        ))
        .await;
        assert_reason(&value, StatusCode::BAD_REQUEST, "credential_in_url");
        let key_param = send(post_token(
            &format!("{}?key=deploy", a.invoke_path()),
            ip,
            &a.secret,
            &[("x-o2-dry-run", "true")],
            BODY,
        ))
        .await;
        assert_eq!(key_param.status, StatusCode::OK, "{:?}", key_param.json());
    });
}

#[test]
fn a_token_in_x_api_key_is_401() {
    run(ENV, async {
        let a = seed_token_trigger("xak", "xakA").await;
        let req = request(
            Method::POST,
            &a.invoke_path(),
            "203.0.113.5",
            &[("x-api-key", &a.secret)],
            Body::from(BODY),
        );
        assert_uniform_401(&send(req).await, "x-api-key");
        let basic = format!("Basic {}", a.secret);
        let req = request(
            Method::POST,
            &a.invoke_path(),
            "203.0.113.5",
            &[("authorization", &basic)],
            Body::from(BODY),
        );
        assert_uniform_401(&send(req).await, "basic scheme");
    });
}

#[test]
fn a_session_cookie_alone_is_401() {
    run(ENV, async {
        let a = seed_token_trigger("cookie", "cookieA").await;
        let cookie = format!("auth_tokens={}; auth_ext=x", a.secret);
        let req = request(
            Method::POST,
            &a.invoke_path(),
            "203.0.113.6",
            &[("cookie", &cookie)],
            Body::from(BODY),
        );
        assert_uniform_401(&send(req).await, "cookie");
    });
}

#[test]
fn preauth_answers_do_not_depend_on_the_trigger_id() {
    run(ENV, async {
        let ip = "198.51.100.200";
        let a = seed_token_trigger("pre", "preA").await;
        let unknown = "/api/v2/pre/workflows/hooks/nope".to_string();
        let oversized = |path: &str| {
            let len = (MIB + 1).to_string();
            request(
                Method::POST,
                path,
                "198.51.100.201",
                &[("authorization", "Bearer o2wh_x"), ("content-length", &len)],
                Body::from(BODY),
            )
        };
        let big_existing = send(oversized(&a.invoke_path())).await;
        let big_unknown = send(oversized(&unknown)).await;
        assert_reason(
            &big_existing,
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        );
        assert_eq!(
            (big_existing.status, &big_existing.body),
            (big_unknown.status, &big_unknown.body)
        );

        let mut last = None;
        for _ in 0..200 {
            last = Some(
                send(post_token(
                    &format!("{}?secret=1", a.invoke_path()),
                    ip,
                    "o2wh_x",
                    &[],
                    BODY,
                ))
                .await
                .status,
            );
        }
        assert_eq!(last, Some(StatusCode::BAD_REQUEST));
        let limited_existing = send(post_token(&a.invoke_path(), ip, &a.secret, &[], BODY)).await;
        let limited_unknown = send(post_token(&unknown, ip, &a.secret, &[], BODY)).await;
        assert_reason(
            &limited_existing,
            StatusCode::TOO_MANY_REQUESTS,
            "rate_limited",
        );
        assert_eq!(
            (limited_existing.status, &limited_existing.body),
            (limited_unknown.status, &limited_unknown.body)
        );
        assert!(limited_existing.header("retry-after").is_some());
        assert_eq!(
            limited_existing.header("retry-after"),
            limited_unknown.header("retry-after")
        );
    });
}

#[test]
fn payload_too_large_ordering_in_both_modes() {
    run(ENV, async {
        let ip = "203.0.113.8";
        let token = seed_token_trigger_with("ptl", "ptlTok", |row| row.max_body_bytes = 1024).await;
        let big = vec![b'x'; 2048];
        assert_uniform_401(
            &send(post_token(
                &token.invoke_path(),
                ip,
                "o2wh_wrong",
                &[],
                &big,
            ))
            .await,
            "token mode checks the token first",
        );
        assert_reason(
            &send(post_token(
                &token.invoke_path(),
                ip,
                &token.secret,
                &[],
                &big,
            ))
            .await,
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        );

        let signed = seed_signed_trigger_with("ptl", "ptlSig", 1024).await;
        let wrong = mint_signing_secret().plaintext;
        assert_reason(
            &send(signed_request(
                &signed.invoke_path(),
                ip,
                &wrong,
                now_secs(),
                &big,
            ))
            .await,
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        );
        assert_reason(
            &send(signed_request(
                &signed.invoke_path(),
                ip,
                &signed.secret,
                now_secs(),
                &big,
            ))
            .await,
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        );
        assert_uniform_401(
            &send(signed_request(
                &signed.invoke_path(),
                ip,
                &wrong,
                now_secs(),
                BODY,
            ))
            .await,
            "signature mode under the cap",
        );
    });
}

#[test]
fn a_body_over_the_trigger_cap_is_413_after_auth() {
    run(ENV, async {
        write_heartbeat().await;
        let ip = "203.0.113.9";
        let a = seed_token_trigger_with("cap", "capA", |row| row.max_body_bytes = 1024).await;
        let over = vec![b' '; 1025];
        assert_reason(
            &send(post_token(&a.invoke_path(), ip, &a.secret, &[], &over)).await,
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        );
        let exact = vec![b' '; 1024];
        let reply = send(post_token(&a.invoke_path(), ip, &a.secret, &[], &exact)).await;
        assert_eq!(reply.status, StatusCode::ACCEPTED, "{:?}", reply.json());
    });
}

#[test]
fn a_content_length_over_one_mib_is_413() {
    run(ENV, async {
        write_heartbeat().await;
        let ip = "203.0.113.10";
        let a = seed_token_trigger("clen", "clenA").await;
        let len = (MIB + 1).to_string();
        let req = request(
            Method::POST,
            &a.invoke_path(),
            ip,
            &[
                ("authorization", &format!("Bearer {}", a.secret)),
                ("content-length", &len),
            ],
            Body::from(BODY),
        );
        assert_reason(
            &send(req).await,
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        );
        let mut body = vec![b' '; MIB];
        body[0] = b'"';
        body[MIB - 1] = b'"';
        let reply = send(post_token(&a.invoke_path(), ip, &a.secret, &[], &body)).await;
        assert_eq!(
            reply.status,
            StatusCode::ACCEPTED,
            "exactly the hard cap fits: {:?}",
            reply.json()
        );
    });
}

#[test]
fn a_chunked_body_over_one_mib_without_content_length_is_413() {
    run(ENV, async {
        let ip = "203.0.113.11";
        let a = seed_token_trigger("chunk", "chunkA").await;
        let chunks =
            (0..17).map(|_| Ok::<_, std::io::Error>(bytes::Bytes::from(vec![b'x'; 64 * 1024])));
        let body = Body::from_stream(futures::stream::iter(chunks));
        let bearer = format!("Bearer {}", a.secret);
        let req = request(
            Method::POST,
            &a.invoke_path(),
            ip,
            &[("authorization", &bearer)],
            body,
        );
        assert!(req.headers().get("content-length").is_none());
        assert_reason(
            &send(req).await,
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        );
        let signed = seed_signed_trigger("chunk", "chunkSig").await;
        let chunks =
            (0..17).map(|_| Ok::<_, std::io::Error>(bytes::Bytes::from(vec![b'x'; 64 * 1024])));
        let ts = now_secs().to_string();
        let req = request(
            Method::POST,
            &signed.invoke_path(),
            ip,
            &[
                ("webhook-id", "msg_chunk"),
                ("webhook-timestamp", &ts),
                ("webhook-signature", "v1,AAAA"),
            ],
            Body::from_stream(futures::stream::iter(chunks)),
        );
        assert_reason(
            &send(req).await,
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
        );
    });
}

#[test]
fn the_trigger_limit_answers_429_with_retry_after() {
    run(ENV, async {
        let ip = "203.0.113.12";
        let a = seed_token_trigger_with("lim", "limA", |row| row.rate_limit_per_minute = 2).await;
        let dry = [("x-o2-dry-run", "true")];
        for _ in 0..2 {
            assert_eq!(
                send(post_token(&a.invoke_path(), ip, &a.secret, &dry, BODY))
                    .await
                    .status,
                StatusCode::OK
            );
        }
        let limited = send(post_token(&a.invoke_path(), ip, &a.secret, &dry, BODY)).await;
        assert_reason(&limited, StatusCode::TOO_MANY_REQUESTS, "rate_limited");
        assert!(
            limited
                .header("retry-after")
                .unwrap()
                .parse::<u64>()
                .unwrap()
                >= 1
        );
        let polls: Vec<StatusCode> = futures::future::join_all(
            (0..9).map(|_| send(get_token(&a.poll_path("none"), ip, &a.secret))),
        )
        .await
        .into_iter()
        .map(|r| r.status)
        .collect();
        assert_eq!(
            polls
                .iter()
                .filter(|s| **s == StatusCode::NOT_FOUND)
                .count(),
            8,
            "polls get four times the trigger limit: {polls:?}"
        );
        assert_eq!(
            polls
                .iter()
                .filter(|s| **s == StatusCode::TOO_MANY_REQUESTS)
                .count(),
            1
        );
    });
}

#[test]
fn a_dry_run_writes_nothing_and_counts_against_the_limit() {
    run(ENV, async {
        write_heartbeat().await;
        let ip = "203.0.113.13";
        let a = seed_token_trigger_with("dry", "dryA", |row| row.rate_limit_per_minute = 1).await;
        let reply = send(post_token(
            &a.invoke_path(),
            ip,
            &a.secret,
            &[("x-o2-dry-run", "true")],
            BODY,
        ))
        .await;
        assert_eq!(reply.status, StatusCode::OK, "{:?}", reply.json());
        assert_eq!(reply.json()["dry_run"], true);
        assert_eq!(reply.json()["accepted"], true);
        assert_eq!(ledger_rows(&a).await, 0, "a dry run writes no ledger row");
        let next = send(post_token(&a.invoke_path(), ip, &a.secret, &[], BODY)).await;
        assert_reason(&next, StatusCode::TOO_MANY_REQUESTS, "rate_limited");
        assert_eq!(ledger_rows(&a).await, 0);
    });
}

#[test]
fn the_dry_run_input_has_the_hook_shape() {
    run(ENV, async {
        let a = seed_token_trigger("shape", "shapeA").await;
        let reply = send(post_token(
            &format!("{}?k=v", a.invoke_path()),
            "203.0.113.14",
            &a.secret,
            &[("x-o2-dry-run", "true"), ("x-custom", "dropped")],
            BODY,
        ))
        .await;
        assert_eq!(reply.status, StatusCode::OK, "{:?}", reply.json());
        let input = &reply.json()["input"];
        let meta = &input["meta"];
        assert_eq!(meta["event_type"], "webhook");
        assert_eq!(meta["trigger_source"], "http");
        assert_eq!(meta["trigger_id"], a.trigger_id.as_str());
        assert!(!meta["run_id"].as_str().unwrap().is_empty());
        assert!(meta["received_at"].as_i64().unwrap() > 1_000_000_000_000_000);
        assert_eq!(meta["query"], serde_json::json!({"k": "v"}));
        assert_eq!(meta["headers"]["content-type"], "application/json");
        assert_eq!(meta["headers"]["x-o2-dry-run"], "true");
        assert!(meta["headers"].get("authorization").is_none());
        assert!(meta["headers"].get("x-custom").is_none());
        assert_eq!(input["data"], serde_json::json!([{"event": "deploy"}]));
        assert_eq!(input.as_object().unwrap().len(), 2);
    });
}

#[test]
fn an_invoke_returns_202_with_location() {
    run(ENV, async {
        write_heartbeat().await;
        let a = seed_token_trigger("acc", "accA").await;
        let reply = send(post_token(
            &a.invoke_path(),
            "203.0.113.15",
            &a.secret,
            &[],
            BODY,
        ))
        .await;
        assert_eq!(reply.status, StatusCode::ACCEPTED, "{:?}", reply.json());
        let body = reply.json();
        let run_id = body["run_id"].as_str().unwrap().to_string();
        let status_url = format!(
            "https://o2.example.com/api/v2/acc/workflows/hooks/{}/runs/{run_id}",
            a.trigger_id
        );
        assert_eq!(
            body,
            serde_json::json!({"run_id": run_id, "status": "queued", "status_url": status_url})
        );
        assert_eq!(reply.header("location"), Some(status_url.as_str()));
        let row = run_row(&a.trigger_id, &run_id).await.unwrap();
        assert_eq!(row.status, "queued");
        assert_eq!(row.credential_id, "cred-accA");
        assert_eq!(row.caller_ip, "203.0.113.15");
        assert_eq!(row.body_bytes, BODY.len() as i64);
        let payload =
            ledger::read_payload(get_orm_client_rw().await, "acc", &a.workflow_id, &run_id)
                .await
                .unwrap()
                .unwrap();
        let payload: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(payload["data"], serde_json::json!([{"event": "deploy"}]));
        assert_eq!(payload["meta"]["run_id"], run_id.as_str());
    });
}

#[test]
fn an_alert_fired_workflow_accepts_http_runs_and_keeps_its_alert_link() {
    run(ENV, async {
        write_heartbeat().await;
        seed_org("kind").await;
        seed_alert_workflow("kind", "wf-kindA", "alert-kindA").await;
        let before = kind_and_links("kind", "wf-kindA").await;
        assert_eq!(
            before,
            (
                Some("alert_fired".to_string()),
                vec![(
                    "alert-kindA".to_string(),
                    "alert".to_string(),
                    "AlertFired".to_string()
                )]
            )
        );
        let a = seed_token_trigger_for("kind", "kindA", "wf-kindA", |_| {}).await;
        let dry = send(post_token(
            &a.invoke_path(),
            "203.0.113.40",
            &a.secret,
            &[("x-o2-dry-run", "true")],
            BODY,
        ))
        .await;
        assert_eq!(dry.status, StatusCode::OK, "{:?}", dry.json());
        assert_eq!(dry.json()["input"]["meta"]["trigger_source"], "http");
        let reply = send(post_token(
            &a.invoke_path(),
            "203.0.113.40",
            &a.secret,
            &[],
            BODY,
        ))
        .await;
        assert_eq!(reply.status, StatusCode::ACCEPTED, "{:?}", reply.json());
        let run_id = reply.json()["run_id"].as_str().unwrap().to_string();
        let payload = ledger::read_payload(get_orm_client_rw().await, "kind", "wf-kindA", &run_id)
            .await
            .unwrap()
            .unwrap();
        let payload: serde_json::Value = serde_json::from_str(&payload).unwrap();
        assert_eq!(payload["meta"]["trigger_source"], "http");
        assert_eq!(payload["data"], serde_json::json!([{"event": "deploy"}]));
        assert_eq!(kind_and_links("kind", "wf-kindA").await, before);
    });
}

#[test]
fn a_replay_returns_the_same_run_id_with_idempotent_replayed() {
    run(ENV, async {
        write_heartbeat().await;
        let ip = "203.0.113.16";
        let a = seed_token_trigger("rep", "repA").await;
        let key = [("idempotency-key", "deploy-42")];
        let first = send(post_token(&a.invoke_path(), ip, &a.secret, &key, BODY)).await;
        assert_eq!(first.status, StatusCode::ACCEPTED, "{:?}", first.json());
        let again = send(post_token(&a.invoke_path(), ip, &a.secret, &key, BODY)).await;
        assert_eq!(again.status, StatusCode::OK, "{:?}", again.json());
        assert_eq!(again.json()["run_id"], first.json()["run_id"]);
        assert_eq!(again.json()["status"], "queued");
        assert_eq!(again.header("idempotent-replayed"), Some("true"));
        assert_eq!(again.header("location"), first.header("location"));
        assert_eq!(ledger_rows(&a).await, 1);
    });
}

#[test]
fn a_replay_of_an_expired_original_starts_a_new_run() {
    run(ENV, async {
        write_heartbeat().await;
        let ip = "203.0.113.17";
        let a = seed_token_trigger("exp", "expA").await;
        let key = [("idempotency-key", "deploy-43")];
        let first = send(post_token(&a.invoke_path(), ip, &a.secret, &key, BODY)).await;
        let first_run = first.json()["run_id"].as_str().unwrap().to_string();
        let row = run_row(&a.trigger_id, &first_run).await.unwrap();
        assert!(
            ledger::finish_unclaimed(
                get_orm_client_rw().await,
                row.id,
                HookRunStatus::Expired,
                None,
                now_micros()
            )
            .await
            .unwrap()
        );
        let again = send(post_token(&a.invoke_path(), ip, &a.secret, &key, BODY)).await;
        assert_eq!(again.status, StatusCode::ACCEPTED, "{:?}", again.json());
        let second_run = again.json()["run_id"].as_str().unwrap().to_string();
        assert_ne!(second_run, first_run);
        assert!(again.header("idempotent-replayed").is_none());
        assert_eq!(
            run_row(&a.trigger_id, &first_run).await.unwrap().idem_key,
            None
        );
        assert_eq!(
            run_row(&a.trigger_id, &second_run)
                .await
                .unwrap()
                .idem_key
                .as_deref(),
            Some("deploy-43")
        );
    });
}

#[test]
fn the_same_key_with_a_different_body_is_422() {
    run(ENV, async {
        write_heartbeat().await;
        let ip = "203.0.113.18";
        let a = seed_token_trigger("reuse", "reuseA").await;
        let key = [("idempotency-key", "deploy-44")];
        assert_eq!(
            send(post_token(&a.invoke_path(), ip, &a.secret, &key, BODY))
                .await
                .status,
            StatusCode::ACCEPTED
        );
        let other = send(post_token(
            &a.invoke_path(),
            ip,
            &a.secret,
            &key,
            br#"{"event":"other"}"#,
        ))
        .await;
        assert_reason(
            &other,
            StatusCode::UNPROCESSABLE_ENTITY,
            "idempotency_key_reused",
        );
    });
}

#[test]
fn an_invalid_idempotency_key_is_400() {
    run(ENV, async {
        let a = seed_token_trigger("badkey", "badkeyA").await;
        let long = "k".repeat(256);
        let reply = send(post_token(
            &a.invoke_path(),
            "203.0.113.19",
            &a.secret,
            &[("idempotency-key", &long)],
            BODY,
        ))
        .await;
        assert_reason(&reply, StatusCode::BAD_REQUEST, "invalid_idempotency_key");
    });
}

#[test]
fn a_disabled_endpoint_is_403() {
    run(ENV, async {
        let a = seed_token_trigger_with("off", "offA", |row| row.enabled = false).await;
        let reply = send(post_token(
            &a.invoke_path(),
            "203.0.113.20",
            &a.secret,
            &[],
            BODY,
        ))
        .await;
        assert_reason(&reply, StatusCode::FORBIDDEN, "endpoint_disabled");
        assert_eq!(
            reply.json()["hint"],
            "Turn the endpoint on in the workflow's HTTP endpoint settings"
        );
        let bad = send(post_token(
            &a.invoke_path(),
            "203.0.113.20",
            "o2wh_wrong",
            &[],
            BODY,
        ))
        .await;
        assert_uniform_401(&bad, "403 only after a valid credential");
    });
}

#[test]
fn a_draft_only_workflow_is_403_not_published() {
    run(ENV, async {
        seed_org("draft").await;
        seed_draft("draft", "wf-draftA").await;
        let a = seed_token_trigger_for("draft", "draftA", "wf-draftA", |_| {}).await;
        let reply = send(post_token(
            &a.invoke_path(),
            "203.0.113.21",
            &a.secret,
            &[],
            BODY,
        ))
        .await;
        assert_reason(&reply, StatusCode::FORBIDDEN, "workflow_not_published");
    });
}

#[test]
fn a_disabled_workflow_is_403() {
    run(ENV, async {
        seed_org("paused").await;
        seed_workflow("paused", "wf-pausedA", false).await;
        let a = seed_token_trigger_for("paused", "pausedA", "wf-pausedA", |_| {}).await;
        let reply = send(post_token(
            &a.invoke_path(),
            "203.0.113.22",
            &a.secret,
            &[],
            BODY,
        ))
        .await;
        assert_reason(&reply, StatusCode::FORBIDDEN, "workflow_disabled");
    });
}

#[test]
fn the_status_poll_returns_the_stored_status() {
    run(ENV, async {
        let ip = "203.0.113.23";
        let a = seed_token_trigger("poll", "pollA").await;
        seed_ledger_row(&a, "run-poll-1").await;
        let reply = send(get_token(&a.poll_path("run-poll-1"), ip, &a.secret)).await;
        assert_eq!(reply.status, StatusCode::OK, "{:?}", reply.json());
        let body = reply.json();
        assert_eq!(body["run_id"], "run-poll-1");
        assert_eq!(body["status"], "queued");
        assert!(body["received_at"].as_i64().unwrap() > 0);
        assert!(body["finished_at"].is_null());
        assert!(body["error"].is_null());
        assert!(body["idempotency_key"].is_null());
        let row = run_row(&a.trigger_id, "run-poll-1").await.unwrap();
        ledger::finish_unclaimed(
            get_orm_client_rw().await,
            row.id,
            HookRunStatus::Failed,
            Some("workflow_disabled"),
            now_micros(),
        )
        .await
        .unwrap();
        let body = send(get_token(&a.poll_path("run-poll-1"), ip, &a.secret))
            .await
            .json();
        assert_eq!(
            (body["status"].as_str(), body["error"].as_str()),
            (Some("failed"), Some("workflow_disabled"))
        );
        let missing = send(get_token(&a.poll_path("run-nope"), ip, &a.secret)).await;
        assert_reason(&missing, StatusCode::NOT_FOUND, "run_not_found");
        assert_uniform_401(
            &send(get_token(&a.poll_path("run-poll-1"), ip, "o2wh_wrong")).await,
            "poll with a bad token",
        );
    });
}

#[test]
fn a_run_received_before_the_trigger_was_created_is_404() {
    run(ENV, async {
        let ip = "203.0.113.94";
        let a = seed_token_trigger("prerev", "prerevA").await;
        let rw = get_orm_client_rw().await;
        let created_at = triggers::get(rw, &a.trigger_id)
            .await
            .unwrap()
            .unwrap()
            .created_at;
        let old = NewHookRequest {
            trigger_id: a.trigger_id.clone(),
            org_id: a.org.clone(),
            workflow_id: a.workflow_id.clone(),
            run_id: "run-before-revive".to_string(),
            idem_key: Some("old-key".to_string()),
            body_sha256: "ab".repeat(32),
            body_bytes: 2,
            content_type: None,
            meta: "{}".to_string(),
            credential_id: "old-cred".to_string(),
            credential_prefix: "o2wh_abcd…wxyz".to_string(),
            caller_ip: "203.0.113.1".to_string(),
            received_at: created_at - 1,
        };
        let inserted = ledger::enqueue(rw, old, "{}".to_string()).await.unwrap();
        assert!(matches!(inserted, LedgerInsert::Inserted));
        let reply = send(get_token(&a.poll_path("run-before-revive"), ip, &a.secret)).await;
        assert_reason(&reply, StatusCode::NOT_FOUND, "run_not_found");
    });
}

#[test]
fn sweeping_a_tombstone_drops_its_cache_key() {
    run(ENV, async {
        let a = seed_token_trigger("sweepkey", "sweepkeyA").await;
        let rw = get_orm_client_rw().await;
        let long_ago = now_micros() - TOMBSTONE_TTL_US - 1_000_000;
        triggers::tombstone_for_workflow(rw, &a.workflow_id, long_ago)
            .await
            .unwrap();
        notify_local(&a.trigger_id).await.unwrap();
        let key = format!("{TRIGGER_KEY_PREFIX}{}", a.trigger_id);
        assert!(get_coordinator().await.get(&key).await.is_ok());
        sweeper::sweep_tombstones(now_micros()).await.unwrap();
        assert!(triggers::get(rw, &a.trigger_id).await.unwrap().is_none());
        assert!(
            get_coordinator().await.get(&key).await.is_err(),
            "the swept trigger leaves no coordinator key behind"
        );
    });
}

#[test]
fn another_triggers_run_is_404() {
    run(ENV, async {
        let ip = "203.0.113.24";
        let a = seed_token_trigger("scope", "scopeA").await;
        let b = seed_token_trigger("scope", "scopeB").await;
        seed_ledger_row(&b, "run-of-b").await;
        assert_reason(
            &send(get_token(&a.poll_path("run-of-b"), ip, &a.secret)).await,
            StatusCode::NOT_FOUND,
            "run_not_found",
        );
        assert_eq!(
            send(get_token(&b.poll_path("run-of-b"), ip, &b.secret))
                .await
                .status,
            StatusCode::OK
        );
    });
}

#[test]
fn a_credential_cannot_invoke_another_trigger() {
    run(ENV, async {
        let a = seed_token_trigger("cross", "crossA").await;
        let b = seed_token_trigger("cross", "crossB").await;
        assert_uniform_401(
            &send(post_token(
                &b.invoke_path(),
                "203.0.113.25",
                &a.secret,
                &[],
                BODY,
            ))
            .await,
            "A's token on B",
        );
    });
}

#[test]
fn a_credential_cannot_read_another_triggers_run() {
    run(ENV, async {
        let a = seed_token_trigger("crossread", "crossreadA").await;
        let b = seed_token_trigger("crossread", "crossreadB").await;
        seed_ledger_row(&b, "run-b").await;
        assert_uniform_401(
            &send(get_token(&b.poll_path("run-b"), "203.0.113.26", &a.secret)).await,
            "A's token on B's poll",
        );
        assert_reason(
            &send(get_token(&a.poll_path("run-b"), "203.0.113.26", &a.secret)).await,
            StatusCode::NOT_FOUND,
            "run_not_found",
        );
    });
}

#[test]
fn a_signed_invoke_and_poll_are_accepted() {
    run(ENV, async {
        write_heartbeat().await;
        let ip = "203.0.113.27";
        let s = seed_signed_trigger("sig", "sigA").await;
        let reply = send(signed(
            Method::POST,
            &s.invoke_path(),
            ip,
            &s.secret,
            "msg_sig_1",
            now_secs(),
            BODY,
        ))
        .await;
        assert_eq!(reply.status, StatusCode::ACCEPTED, "{:?}", reply.json());
        let run_id = reply.json()["run_id"].as_str().unwrap().to_string();
        assert_eq!(
            run_row(&s.trigger_id, &run_id)
                .await
                .unwrap()
                .idem_key
                .as_deref(),
            Some("msg_sig_1")
        );
        let poll_path = s.poll_path(&run_id);
        let poll = send(signed(
            Method::GET,
            &poll_path,
            ip,
            &s.secret,
            "msg_poll_1",
            now_secs(),
            b"",
        ))
        .await;
        assert_eq!(poll.status, StatusCode::OK, "{:?}", poll.json());
        assert_eq!(poll.json()["idempotency_key"], "msg_sig_1");
        let replay = send(signed(
            Method::POST,
            &s.invoke_path(),
            ip,
            &s.secret,
            "msg_sig_1",
            now_secs(),
            BODY,
        ))
        .await;
        assert_eq!(
            replay.status,
            StatusCode::OK,
            "the webhook-id is the idempotency key"
        );
        assert_eq!(replay.json()["run_id"], run_id.as_str());
    });
}

#[test]
fn a_signed_poll_cannot_replay_as_an_invoke() {
    run(ENV, async {
        write_heartbeat().await;
        let ip = "203.0.113.28";
        let s = seed_signed_trigger("sigx", "sigxA").await;
        seed_ledger_row(&s, "run-x").await;
        let poll_path = s.poll_path("run-x");
        let poll = signed(
            Method::GET,
            &poll_path,
            ip,
            &s.secret,
            "msg_x",
            now_secs(),
            b"",
        );
        let headers = poll.headers().clone();
        let mut invoke = request(
            Method::POST,
            &s.invoke_path(),
            ip,
            &[],
            Body::from(format!("GET {poll_path}")),
        );
        for name in ["webhook-id", "webhook-timestamp", "webhook-signature"] {
            invoke.headers_mut().insert(name, headers[name].clone());
        }
        assert_uniform_401(&send(invoke).await, "a poll signature on the invoke URL");
        let signed_invoke = signed(
            Method::POST,
            &s.invoke_path(),
            ip,
            &s.secret,
            "msg_y",
            now_secs(),
            BODY,
        );
        let headers = signed_invoke.headers().clone();
        let mut get = request(Method::GET, &poll_path, ip, &[], Body::empty());
        for name in ["webhook-id", "webhook-timestamp", "webhook-signature"] {
            get.headers_mut().insert(name, headers[name].clone());
        }
        assert_uniform_401(&send(get).await, "an invoke signature on the poll URL");
    });
}

fn signed_request(
    path: &str,
    ip: &str,
    secret: &str,
    ts: i64,
    body: &[u8],
) -> axum::http::Request<Body> {
    signed(
        Method::POST,
        path,
        ip,
        secret,
        &format!("msg_{}", now_micros()),
        ts,
        body,
    )
}
