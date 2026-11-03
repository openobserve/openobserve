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

//! Accepting a hook run: idempotency, queue capacity, the ledger write and its audit event.

use std::time::Duration;

use config::utils::time::now_micros;
use infra::{
    db::get_orm_client_rw,
    table::{
        entity::workflow_http_trigger_requests::Model as LedgerRow,
        workflow_http_trigger_requests::{
            self as ledger, HookRunStatus, LedgerInsert, NewHookRequest,
        },
    },
};
use o2_enterprise::enterprise::common::auditor::{AuditMessage, Protocol, ResponseMeta};
use sea_orm::TransactionTrait;

use super::{HookReason, payload::HookInput, wake};

// Finished runs averaged for the predicted queue wait.
const MEAN_RUN_SAMPLE: u64 = 20;
const MAX_REISSUES: usize = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EnqueueOutcome {
    Accepted {
        run_id: String,
    },
    Replayed {
        run_id: String,
        status: HookRunStatus,
    },
}

#[derive(Clone, Debug)]
pub struct EnqueueRequest {
    pub request: NewHookRequest,
    pub input: HookInput,
}

enum Replay {
    Reissue,
    Same(EnqueueOutcome),
}

pub fn status_url(org_id: &str, trigger_id: &str, run_id: &str) -> String {
    let cfg = config::get_config();
    status_url_for(
        &cfg.common.web_url,
        &cfg.common.base_uri,
        org_id,
        trigger_id,
        run_id,
    )
}

pub fn predicted_wait_exceeds_ttl(
    org_queued: u64,
    org_concurrency: u64,
    mean_run_secs: f64,
    ttl: Duration,
) -> bool {
    let wait_secs = org_queued as f64 / org_concurrency.max(1) as f64 * mean_run_secs;
    wait_secs > ttl.as_secs_f64()
}

pub fn hook_audit_message(
    org_id: &str,
    trigger_id: &str,
    path: &str,
    code: u16,
    body: serde_json::Value,
) -> AuditMessage {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    AuditMessage {
        user_email: format!("hook:{trigger_id}"),
        org_id: org_id.to_string(),
        _timestamp: now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: "POST".to_string(),
            http_path: path.to_string(),
            http_query_params: String::new(),
            http_body: body.to_string(),
            http_response_code: code,
            error_msg: None,
            trace_id: None,
        },
        delegated: None,
    }
}

/// The explicit reveal event; `path` is stored in the `audited_path` form `{org}/workflows/…`.
pub fn reveal_audit_message(
    org_id: &str,
    user_email: &str,
    path: &str,
    body: serde_json::Value,
) -> AuditMessage {
    let path = path.split_once('?').map_or(path, |(path, _)| path);
    AuditMessage {
        user_email: user_email.to_string(),
        org_id: org_id.to_string(),
        _timestamp: now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: "GET".to_string(),
            http_path: path.strip_prefix('/').unwrap_or(path).to_string(),
            http_query_params: String::new(),
            http_body: body.to_string(),
            http_response_code: 200,
            error_msg: None,
            trace_id: None,
        },
        delegated: None,
    }
}

pub fn accepted_audit_body(
    run_id: &str,
    credential_prefix: &str,
    caller_ip: &str,
    idempotent_replay: bool,
) -> serde_json::Value {
    serde_json::json!({
        "run_id": run_id,
        "credential_prefix": credential_prefix,
        "caller_ip": caller_ip,
        "idempotent_replay": idempotent_replay,
    })
}

pub fn dry_run_audit_body(credential_prefix: &str, caller_ip: &str) -> serde_json::Value {
    serde_json::json!({
        "dry_run": true,
        "credential_prefix": credential_prefix,
        "caller_ip": caller_ip,
    })
}

pub fn reveal_audit_body(
    workflow_id: &str,
    trigger_id: &str,
    credential_id: &str,
    credential_prefix: &str,
    kind: &str,
    state: &str,
) -> serde_json::Value {
    serde_json::json!({
        "event": "credential_revealed",
        "workflow_id": workflow_id,
        "trigger_id": trigger_id,
        "credential_id": credential_id,
        "credential_prefix": credential_prefix,
        "kind": kind,
        "state": state,
    })
}

/// The hook bypasses `audit_middleware`, so it applies the same `audit_enabled` gate itself.
pub fn audit_gate(enabled: bool, message: impl FnOnce() -> AuditMessage) -> Option<AuditMessage> {
    enabled.then(message)
}

pub async fn write_audit(message: impl FnOnce() -> AuditMessage) {
    let enabled = o2_enterprise::enterprise::common::config::get_config()
        .common
        .audit_enabled;
    if let Some(message) = audit_gate(enabled, message) {
        audit::audit(message).await;
    }
}

pub async fn check_queue_capacity(org_id: &str) -> Result<(), HookReason> {
    let limit = &config::get_config().limit;
    let db = get_orm_client_rw().await;
    let queued = ledger::count_queued_for_org(db, org_id)
        .await
        .map_err(internal("queue count"))?;
    if queued >= limit.workflow_hook_org_queue_max {
        return Err(HookReason::QueueFull);
    }
    let mean = ledger::recent_mean_run_secs(db, org_id, MEAN_RUN_SAMPLE)
        .await
        .map_err(internal("mean run time"))?
        .unwrap_or_default();
    let ttl = Duration::from_secs(limit.workflow_hook_queue_ttl_secs);
    if predicted_wait_exceeds_ttl(queued, limit.workflow_hook_org_concurrency, mean, ttl) {
        return Err(HookReason::QueueFull);
    }
    Ok(())
}

pub async fn enqueue_run(req: EnqueueRequest) -> Result<EnqueueOutcome, HookReason> {
    let queue_max = config::get_config().limit.workflow_hook_org_queue_max;
    let outcome = enqueue_in(get_orm_client_rw().await, req, queue_max).await?;
    if matches!(outcome, EnqueueOutcome::Accepted { .. }) {
        wake::request_wake();
    }
    Ok(outcome)
}

pub async fn replay_or_conflict(
    trigger_id: &str,
    idem_key: &str,
    body_sha256: &str,
) -> Result<Option<EnqueueOutcome>, HookReason> {
    let existing = ledger::find_by_idem_key(get_orm_client_rw().await, trigger_id, idem_key)
        .await
        .map_err(internal("idempotency lookup"))?;
    match existing {
        None => Ok(None),
        Some(row) => match replay_decision(&row, body_sha256)? {
            Replay::Reissue => Ok(None),
            Replay::Same(outcome) => Ok(Some(outcome)),
        },
    }
}

/// One capped transaction per attempt; a lost key race re-reads the winner as a replay.
async fn enqueue_in<C: TransactionTrait>(
    db: &C,
    req: EnqueueRequest,
    queue_max: u64,
) -> Result<EnqueueOutcome, HookReason> {
    let payload = serde_json::to_string(&req.input).map_err(|e| {
        log::error!("[WORKFLOW_HOOK] run input does not serialise: {e}");
        HookReason::InternalError
    })?;
    let run_id = req.request.run_id.clone();
    let body_sha256 = req.request.body_sha256.clone();
    let mut expired_id = None;
    for _ in 0..=MAX_REISSUES {
        let written = ledger::enqueue_capped(
            db,
            expired_id,
            req.request.clone(),
            payload.clone(),
            queue_max,
        )
        .await;
        let winner = match written.map_err(internal("enqueue"))? {
            LedgerInsert::Inserted => return Ok(EnqueueOutcome::Accepted { run_id }),
            LedgerInsert::KeyTaken(winner) => winner,
            LedgerInsert::QueueFull => return Err(HookReason::QueueFull),
        };
        match replay_decision(&winner, &body_sha256)? {
            Replay::Same(outcome) => return Ok(outcome),
            Replay::Reissue => expired_id = Some(winner.id),
        }
    }
    log::error!("[WORKFLOW_HOOK] idempotency key of run {run_id} kept changing hands");
    Err(HookReason::InternalError)
}

/// Only an original that never ran is replaced; any other state answers with its own run.
fn replay_decision(row: &LedgerRow, body_sha256: &str) -> Result<Replay, HookReason> {
    if row.body_sha256 != body_sha256 {
        return Err(HookReason::IdempotencyKeyReused);
    }
    let Some(status) = HookRunStatus::parse(&row.status) else {
        log::error!(
            "[WORKFLOW_HOOK] ledger row {} has status {:?}",
            row.id,
            row.status
        );
        return Err(HookReason::InternalError);
    };
    if status == HookRunStatus::Expired {
        return Ok(Replay::Reissue);
    }
    Ok(Replay::Same(EnqueueOutcome::Replayed {
        run_id: row.run_id.clone(),
        status,
    }))
}

fn status_url_for(
    web_url: &str,
    base_uri: &str,
    org_id: &str,
    trigger_id: &str,
    run_id: &str,
) -> String {
    format!(
        "{}{}/api/v2/{org_id}/workflows/hooks/{trigger_id}/runs/{run_id}",
        web_url.trim_end_matches('/'),
        base_uri.trim_end_matches('/'),
    )
}

fn internal(what: &'static str) -> impl Fn(sea_orm::DbErr) -> HookReason {
    move |e| {
        log::error!("[WORKFLOW_HOOK] {what} failed: {e}");
        HookReason::InternalError
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::Database;

    use super::{super::payload::build_input, *};

    const NO_CAP: u64 = u64::MAX;

    async fn ledger_db() -> sea_orm::DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        ledger::create_tables_for_tests(&db).await.unwrap();
        db
    }

    fn request(run_id: &str, idem_key: Option<&str>, body_sha256: &str) -> EnqueueRequest {
        let input = build_input("t1", run_id, 10, &http::HeaderMap::new(), None, b"[1]");
        EnqueueRequest {
            request: NewHookRequest {
                trigger_id: "t1".to_string(),
                org_id: "acme".to_string(),
                workflow_id: "wf".to_string(),
                run_id: run_id.to_string(),
                idem_key: idem_key.map(str::to_string),
                body_sha256: body_sha256.to_string(),
                body_bytes: 3,
                content_type: None,
                meta: serde_json::to_string(&input.meta).unwrap(),
                credential_id: "c1".to_string(),
                credential_prefix: "o2wh_abcd…wxyz".to_string(),
                caller_ip: "203.0.113.7".to_string(),
                received_at: 10,
            },
            input,
        }
    }

    #[test]
    fn status_url_is_absolute_with_base_uri() {
        assert_eq!(
            status_url_for("https://o2.example.com/", "/o2", "acme", "t1", "r1"),
            "https://o2.example.com/o2/api/v2/acme/workflows/hooks/t1/runs/r1"
        );
        assert_eq!(
            status_url_for("http://localhost:5080", "", "acme", "t1", "r1"),
            "http://localhost:5080/api/v2/acme/workflows/hooks/t1/runs/r1"
        );
        assert_eq!(
            status_url_for("http://h", "/", "acme", "t1", "r1"),
            "http://h/api/v2/acme/workflows/hooks/t1/runs/r1"
        );
    }

    #[test]
    fn predicted_wait_over_ttl_is_queue_full() {
        let ttl = Duration::from_secs(3600);
        assert!(!predicted_wait_exceeds_ttl(10, 2, 60.0, ttl));
        assert!(predicted_wait_exceeds_ttl(200, 2, 60.0, ttl));
        assert!(
            !predicted_wait_exceeds_ttl(120, 2, 60.0, ttl),
            "exactly the TTL still fits"
        );
        assert!(
            !predicted_wait_exceeds_ttl(500, 2, 0.0, ttl),
            "no finished runs yet"
        );
        assert!(
            predicted_wait_exceeds_ttl(61, 0, 60.0, ttl),
            "zero concurrency counts as one"
        );
    }

    #[test]
    fn accepted_audit_has_no_query_and_names_the_hook() {
        let body = accepted_audit_body("r1", "o2wh_abcd…wxyz", "203.0.113.7", false);
        let message = hook_audit_message(
            "acme",
            "t1",
            "/api/v2/acme/workflows/hooks/t1?token=o2wh_leak",
            202,
            body.clone(),
        );
        assert_eq!(message.user_email, "hook:t1");
        assert_eq!(message.org_id, "acme");
        assert_eq!(
            message.response_meta.http_path,
            "/api/v2/acme/workflows/hooks/t1"
        );
        assert_eq!(message.response_meta.http_query_params, "");
        assert_eq!(message.response_meta.http_response_code, 202);
        assert_eq!(message.response_meta.http_method, "POST");
        let stored: serde_json::Value =
            serde_json::from_str(&message.response_meta.http_body).unwrap();
        assert_eq!(stored, body);
        assert_eq!(
            stored["idempotent_replay"], false,
            "the body names the run, the credential prefix and the caller"
        );
    }

    #[test]
    fn dry_run_audit_is_marked() {
        let body = dry_run_audit_body("o2wh_abcd…wxyz", "203.0.113.7");
        assert_eq!(body["dry_run"], true);
        let message = hook_audit_message("acme", "t1", "/p", 200, body);
        assert_eq!(message.response_meta.http_response_code, 200);
    }

    #[test]
    fn reveal_audit_message_never_carries_the_value() {
        let secret = "o2wh_c2VjcmV0LXRva2VuLXZhbHVlLW5ldmVyLWF1ZGl0ZWQ";
        let body = reveal_audit_body("wf-1", "t1", "c1", "o2wh_c2Vj…ZWQ", "token", "retiring");
        let message = reveal_audit_message(
            "acme",
            "u@acme.io",
            "/acme/workflows/wf-1/http_trigger/credentials/c1/secret?show=1",
            body,
        );
        assert_eq!(
            (message.user_email.as_str(), message.org_id.as_str()),
            ("u@acme.io", "acme")
        );
        let meta = &message.response_meta;
        assert_eq!(
            (meta.http_method.as_str(), meta.http_response_code),
            ("GET", 200)
        );
        assert_eq!(
            meta.http_path,
            "acme/workflows/wf-1/http_trigger/credentials/c1/secret"
        );
        assert_eq!(meta.http_query_params, "");
        let audited: serde_json::Value = serde_json::from_str(&meta.http_body).unwrap();
        assert_eq!(
            audited,
            serde_json::json!({
                "event": "credential_revealed",
                "workflow_id": "wf-1",
                "trigger_id": "t1",
                "credential_id": "c1",
                "credential_prefix": "o2wh_c2Vj…ZWQ",
                "kind": "token",
                "state": "retiring",
            })
        );
        let printed = format!("{message:?}");
        assert!(!printed.contains(secret), "{printed}");
        assert!(!printed.contains(&secret[9..]), "{printed}");
    }

    #[test]
    fn no_audit_when_disabled() {
        let build = || hook_audit_message("acme", "t1", "/p", 202, serde_json::json!({}));
        assert!(audit_gate(false, build).is_none());
        assert!(audit_gate(true, build).is_some());
    }

    #[tokio::test]
    async fn a_db_error_before_commit_maps_to_internal_error() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        assert_eq!(
            enqueue_in(&db, request("r1", None, "h1"), NO_CAP).await,
            Err(HookReason::InternalError)
        );
    }

    #[tokio::test]
    async fn an_accepted_run_stores_the_whole_step_input() {
        let db = ledger_db().await;
        let req = request("r1", None, "h1");
        let expected = serde_json::to_value(&req.input).unwrap();
        assert_eq!(
            enqueue_in(&db, req, NO_CAP).await,
            Ok(EnqueueOutcome::Accepted {
                run_id: "r1".to_string()
            })
        );
        let payload = ledger::read_payload(&db, "acme", "wf", "r1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&payload).unwrap(),
            expected
        );
        let row = ledger::get_run(&db, "t1", "r1").await.unwrap().unwrap();
        assert_eq!(row.status, "queued");
    }

    #[tokio::test]
    async fn a_lost_key_race_answers_like_a_replay() {
        let db = ledger_db().await;
        enqueue_in(&db, request("r1", Some("k"), "h1"), NO_CAP)
            .await
            .unwrap();
        assert_eq!(
            enqueue_in(&db, request("r2", Some("k"), "h1"), NO_CAP).await,
            Ok(EnqueueOutcome::Replayed {
                run_id: "r1".to_string(),
                status: HookRunStatus::Queued
            })
        );
        assert_eq!(
            enqueue_in(&db, request("r3", Some("k"), "h2"), NO_CAP).await,
            Err(HookReason::IdempotencyKeyReused)
        );
    }

    #[tokio::test]
    async fn an_expired_original_is_reissued_as_a_new_run() {
        let db = ledger_db().await;
        enqueue_in(&db, request("r1", Some("k"), "h1"), NO_CAP)
            .await
            .unwrap();
        let original = ledger::get_run(&db, "t1", "r1").await.unwrap().unwrap();
        assert!(
            ledger::finish_unclaimed(&db, original.id, HookRunStatus::Expired, None, 20)
                .await
                .unwrap()
        );
        assert_eq!(
            replay_decision(
                &ledger::get_run(&db, "t1", "r1").await.unwrap().unwrap(),
                "h1"
            )
            .map(|d| matches!(d, Replay::Reissue)),
            Ok(true)
        );
        assert_eq!(
            enqueue_in(&db, request("r2", Some("k"), "h1"), NO_CAP).await,
            Ok(EnqueueOutcome::Accepted {
                run_id: "r2".to_string()
            })
        );
        let old = ledger::get_run(&db, "t1", "r1").await.unwrap().unwrap();
        assert_eq!(old.idem_key, None);
    }

    #[tokio::test]
    async fn the_org_queue_cap_is_checked_by_the_enqueue_itself() {
        let db = ledger_db().await;
        assert!(matches!(
            enqueue_in(&db, request("r1", None, "h1"), 1).await,
            Ok(EnqueueOutcome::Accepted { .. })
        ));
        assert_eq!(
            enqueue_in(&db, request("r2", None, "h2"), 1).await,
            Err(HookReason::QueueFull)
        );
        assert!(ledger::get_run(&db, "t1", "r2").await.unwrap().is_none());
    }

    #[test]
    fn enqueue_never_publishes_a_workflow_trigger() {
        let src = include_str!("enqueue.rs");
        let production = src.split("#[cfg(test)]").next().unwrap();
        for forbidden in [
            "send_workflow_trigger",
            "/workflow_trigger/",
            "get_coordinator",
        ] {
            assert!(!production.contains(forbidden), "{forbidden}");
        }
    }
}
