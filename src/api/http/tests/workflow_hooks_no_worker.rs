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

//! Own test binary: hooks on and no worker heartbeat, so nothing may be enqueued.

#![cfg(feature = "enterprise")]
#![allow(linker_messages)]

#[path = "support/workflow_hooks.rs"]
mod support;

use std::time::Duration;

use axum::{
    body::{Body, Bytes},
    http::{Method, StatusCode},
};
use futures::StreamExt;
use openobserve_api_management::request::workflows::hook_limits::LIMITERS;
use support::*;

const ENV: &[(&str, &str)] = &[
    ("O2_WORKFLOW_HOOKS_ENABLED", "true"),
    ("ZO_WORKFLOW_HOOK_WORKER_DISABLED", "true"),
];
const BODY: &[u8] = br#"{"event":"deploy"}"#;

#[test]
fn a_hook_without_a_live_worker_is_503_worker_unavailable() {
    run(ENV, async {
        let a = seed_token_trigger("nowork", "noworkA").await;
        let reply = send(post_token(
            &a.invoke_path(),
            "203.0.113.40",
            &a.secret,
            &[],
            BODY,
        ))
        .await;
        assert_eq!(
            reply.status,
            StatusCode::SERVICE_UNAVAILABLE,
            "{:?}",
            reply.json()
        );
        assert_eq!(reply.json()["error_detail"], "worker_unavailable");
        assert_eq!(reply.header("retry-after"), Some("30"));
        assert_eq!(
            ledger_rows(&a).await,
            0,
            "nothing is enqueued without a worker"
        );
        let dry = send(post_token(
            &a.invoke_path(),
            "203.0.113.40",
            &a.secret,
            &[("x-o2-dry-run", "true")],
            BODY,
        ))
        .await;
        assert_eq!(dry.status, StatusCode::OK, "a dry run needs no worker");
    });
}

#[test]
fn a_stalled_body_releases_its_preauth_permit() {
    run(ENV, async {
        let full = LIMITERS.preauth.available_permits();
        let signed = seed_signed_trigger("stall", "stallA").await;
        let unknown = "/api/v2/stall/workflows/hooks/no-such-trigger".to_string();
        for (path, expected) in [
            (signed.invoke_path(), StatusCode::REQUEST_TIMEOUT),
            (unknown, StatusCode::UNAUTHORIZED),
        ] {
            let first = futures::stream::once(async { Ok::<_, std::io::Error>(Bytes::from("{")) });
            let stalled = Body::from_stream(first.chain(futures::stream::pending()));
            let ts = now_secs().to_string();
            let headers = [
                ("content-type", "application/json"),
                ("content-length", "65536"),
                ("webhook-id", "msg_stalled"),
                ("webhook-timestamp", ts.as_str()),
                ("webhook-signature", "v1,c3RhbGxlZA=="),
            ];
            let req = request(Method::POST, &path, "203.0.113.93", &headers, stalled);
            let reply = tokio::time::timeout(Duration::from_secs(20), send(req))
                .await
                .unwrap_or_else(|_| panic!("{path}: no answer within the body read deadline"));
            assert_eq!(reply.status, expected, "{path}: {:?}", reply.json());
        }
        assert_eq!(
            LIMITERS.preauth.available_permits(),
            full,
            "every pre-auth permit is back"
        );
    });
}
