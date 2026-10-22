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

//! Own test binary: workflows on, hooks off, so the hook routes are never registered.

#![cfg(feature = "enterprise")]
#![allow(linker_messages)]

#[path = "support/workflow_hooks.rs"]
mod support;

use axum::{
    body::Body,
    http::{Method, StatusCode},
};
use config::meta::user::UserRole;
use support::*;

const ENV: &[(&str, &str)] = &[("O2_WORKFLOW_HOOKS_ENABLED", "false")];

/// Unmatched `/api` paths fall to the authenticated plane, which answers before any route lookup.
#[test]
fn hook_routes_are_404_when_hooks_are_off() {
    run(ENV, async {
        for (method, path) in [
            (Method::POST, "/api/v2/acme/workflows/hooks/t1?token=x"),
            (
                Method::GET,
                "/api/v2/acme/workflows/hooks/t1/runs/r1?token=x",
            ),
        ] {
            let reply = send(request(method, path, "203.0.113.42", &[], Body::empty())).await;
            assert!(
                matches!(
                    reply.status,
                    StatusCode::NOT_FOUND | StatusCode::UNAUTHORIZED
                ),
                "{path}: {}",
                reply.status
            );
            assert!(
                !String::from_utf8_lossy(&reply.body).contains("credential_in_url"),
                "{path}: the hook handler answered"
            );
        }
    });
}

/// The proxy auth layer also guards the fallback, so an unknown route answers as this control does.
#[test]
fn management_routes_are_404_when_hooks_are_off() {
    run(ENV, async {
        seed_user("acme", "admin@acme.io", UserRole::Admin).await;
        seed_workflow("acme", "wf-off", true).await;
        let control = send(as_user(
            Method::GET,
            "/api/acme/workflows/wf-off/no_such_route",
            "admin@acme.io",
            None,
        ))
        .await;
        assert!(
            matches!(
                control.status,
                StatusCode::NOT_FOUND | StatusCode::UNAUTHORIZED
            ),
            "{}",
            control.status
        );
        let base = "/api/acme/workflows/wf-off/http_trigger";
        let put = serde_json::json!({"enabled": true, "auth_mode": "token"});
        for (method, path, body) in [
            (Method::GET, base.to_string(), None),
            (Method::PUT, base.to_string(), Some(put)),
            (Method::DELETE, base.to_string(), None),
            (
                Method::POST,
                format!("{base}/credentials"),
                Some(serde_json::json!({"overlap_seconds": 0})),
            ),
            (Method::DELETE, format!("{base}/credentials/c1"), None),
            (Method::GET, format!("{base}/credentials/c1/secret"), None),
            (
                Method::POST,
                format!("{base}/test"),
                Some(serde_json::json!({"data": []})),
            ),
        ] {
            let reply = send(as_user(method.clone(), &path, "admin@acme.io", body)).await;
            assert_eq!(
                (reply.status, &reply.body),
                (control.status, &control.body),
                "{method} {path}"
            );
        }
        let config = send(as_user(
            Method::GET,
            "/api/acme/config",
            "admin@acme.io",
            None,
        ))
        .await;
        assert_eq!(config.status, StatusCode::OK);
        assert_eq!(config.json()["workflow_hooks_enabled"], false);
    });
}
