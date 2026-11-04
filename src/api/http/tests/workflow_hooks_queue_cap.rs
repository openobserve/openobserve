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

//! Own test binary: an org queue of one, a written heartbeat and no worker to drain the queue.

#![cfg(feature = "enterprise")]
#![allow(linker_messages)]

#[path = "support/workflow_hooks.rs"]
mod support;

use axum::http::StatusCode;
use support::*;

const ENV: &[(&str, &str)] = &[
    ("O2_WORKFLOW_HOOKS_ENABLED", "true"),
    ("ZO_WORKFLOW_HOOK_WORKER_DISABLED", "true"),
    ("ZO_WORKFLOW_HOOK_ORG_QUEUE_MAX", "1"),
];
const BODY: &[u8] = br#"{"event":"deploy"}"#;

#[test]
fn a_full_org_queue_answers_503_queue_full() {
    run(ENV, async {
        write_heartbeat().await;
        let ip = "203.0.113.41";
        let a = seed_token_trigger("qcap", "qcapA").await;
        let key = [("idempotency-key", "first")];
        let first = send(post_token(&a.invoke_path(), ip, &a.secret, &key, BODY)).await;
        assert_eq!(first.status, StatusCode::ACCEPTED, "{:?}", first.json());
        let full = send(post_token(&a.invoke_path(), ip, &a.secret, &[], BODY)).await;
        assert_eq!(
            full.status,
            StatusCode::SERVICE_UNAVAILABLE,
            "{:?}",
            full.json()
        );
        assert_eq!(full.json()["error_detail"], "queue_full");
        assert_eq!(full.header("retry-after"), Some("30"));
        let replay = send(post_token(&a.invoke_path(), ip, &a.secret, &key, BODY)).await;
        assert_eq!(
            replay.status,
            StatusCode::OK,
            "a replay is answered before the queue check"
        );
        assert_eq!(ledger_rows(&a).await, 1);
    });
}

#[test]
fn concurrent_calls_never_overshoot_the_org_queue() {
    run(ENV, async {
        write_heartbeat().await;
        let a = seed_token_trigger("qcap2", "qcap2A").await;
        let calls: Vec<_> = (0..8)
            .map(|i| {
                let key = format!("concurrent-{i}");
                let req = post_token(
                    &a.invoke_path(),
                    "203.0.113.43",
                    &a.secret,
                    &[("idempotency-key", key.as_str())],
                    BODY,
                );
                tokio::task::spawn(send(req))
            })
            .collect();
        let mut statuses = Vec::new();
        for call in calls {
            let resp = call.await.unwrap();
            if resp.status == StatusCode::SERVICE_UNAVAILABLE {
                assert_eq!(
                    resp.header("retry-after"),
                    Some("30"),
                    "every 503 queue_full"
                );
            }
            statuses.push(resp.status);
        }
        let accepted = statuses
            .iter()
            .filter(|s| **s == StatusCode::ACCEPTED)
            .count();
        assert_eq!(accepted, 1, "{statuses:?}");
        assert!(
            statuses
                .iter()
                .all(|s| *s == StatusCode::ACCEPTED || *s == StatusCode::SERVICE_UNAVAILABLE),
            "{statuses:?}"
        );
        assert_eq!(ledger_rows(&a).await, 1);
    });
}
