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

//! Own test binary: hooks on, no worker, audit off and no master key; no `triggers` stream exists.

#![cfg(feature = "enterprise")]
#![allow(linker_messages)]

#[path = "support/workflow_hooks.rs"]
mod support;

use axum::http::{Method, StatusCode};
use config::meta::user::UserRole;
use infra::table::workflow_http_trigger_requests::HookRunStatus;
use serde_json::{Value, json};
use support::*;

const ENV: &[(&str, &str)] = &[
    ("O2_WORKFLOW_HOOKS_ENABLED", "true"),
    ("ZO_WORKFLOW_HOOK_WORKER_DISABLED", "true"),
    ("O2_AUDIT_ENABLED", "false"),
];
const ORG: &str = "hist";
const ADMIN: &str = "admin@hist.io";

async fn history(workflow_id: &str) -> Vec<Value> {
    let reply = send(as_user(
        Method::GET,
        &format!("/api/{ORG}/workflows/{workflow_id}/history"),
        ADMIN,
        None,
    ))
    .await;
    assert_eq!(reply.status, StatusCode::OK, "{:?}", reply.json());
    reply.json().as_array().cloned().unwrap_or_default()
}

fn by_run<'a>(rows: &'a [Value], run_id: &str) -> &'a Value {
    rows.iter()
        .find(|row| row["run_id"] == run_id)
        .unwrap_or_else(|| panic!("{run_id} missing from {rows:#?}"))
}

#[test]
fn history_lists_queued_running_expired_and_worker_lost_rows() {
    run(ENV, async {
        seed_user(ORG, ADMIN, UserRole::Admin).await;
        let seeded = seed_token_trigger(ORG, "hist1").await;
        for run_id in ["r-queued", "r-running", "r-expired", "r-lost"] {
            seed_ledger_row(&seeded, run_id).await;
        }
        claim_run(&seeded.trigger_id, "r-lost", "node-gone").await;
        assert_eq!(reap_runs().await, 1);
        claim_run(&seeded.trigger_id, "r-running", "node-a").await;
        finish_queued_run(&seeded.trigger_id, "r-expired", HookRunStatus::Expired).await;

        let rows = history(&seeded.workflow_id).await;
        assert_eq!(rows.len(), 4, "{rows:#?}");
        for (run_id, status, error) in [
            ("r-queued", "queued", Value::Null),
            ("r-running", "running", Value::Null),
            ("r-expired", "expired", Value::Null),
            ("r-lost", "failed", json!("worker_lost")),
        ] {
            let row = by_run(&rows, run_id);
            assert_eq!(row["status"], status, "{run_id}");
            assert_eq!(row["error"], error, "{run_id}");
            assert_eq!(row["event_type"], "Webhook", "{run_id}");
            assert_eq!(
                row["source_id"],
                format!("hook:{}", seeded.trigger_id),
                "{run_id}"
            );
            let facts = &row["http_request"];
            assert_eq!(facts["credential_prefix"], "o2wh_abcd…wxyz");
            assert_eq!(facts["caller_ip"], "203.0.113.1");
            assert_eq!(facts["content_type"], "application/json");
            assert_eq!(facts["body_bytes"], 2);
            assert_eq!(facts["status"], status);
        }
    });
}

#[test]
fn ledger_rows_stay_in_history_after_the_trigger_is_swept() {
    run(ENV, async {
        seed_user(ORG, ADMIN, UserRole::Admin).await;
        seed_workflow(ORG, "wf-swept", true).await;
        seed_run(ORG, "wf-swept", "trgSweptAway", "r-old").await;
        let rows = history("wf-swept").await;
        assert_eq!(rows.len(), 1, "{rows:#?}");
        assert_eq!(rows[0]["run_id"], "r-old");
        assert_eq!(rows[0]["status"], "queued");
    });
}

#[test]
fn no_reveal_audit_when_audit_is_off() {
    run(ENV, async {
        seed_user(ORG, ADMIN, UserRole::Admin).await;
        seed_workflow(ORG, "wf-quiet", true).await;
        let url = format!("/api/{ORG}/workflows/wf-quiet/http_trigger");
        let created = send(as_user(
            Method::PUT,
            &url,
            ADMIN,
            Some(json!({"enabled": true, "auth_mode": "token"})),
        ))
        .await
        .json();
        assert_eq!(created["secrets_encrypted_at_rest"], false);
        let id = created["credentials"][0]["id"].as_str().unwrap();
        let reveal = send(as_user(
            Method::GET,
            &format!("{url}/credentials/{id}/secret"),
            ADMIN,
            None,
        ))
        .await;
        assert_eq!(reveal.status, StatusCode::OK);
        assert!(
            drained_audits()
                .await
                .iter()
                .all(|row| !row.to_string().contains("credential_revealed"))
        );
    });
}
