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

use std::collections::HashMap;

use axum::{
    extract::{Path, Request},
    http::{Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};

/// Extract the org_id (first path segment) from a request path. Shared by the
/// blocking check and the cloud trial "late check" below so both agree on how the
/// org is derived.
fn extract_org_id(path: &str) -> &str {
    let mut segments = path.split('/');
    match segments.next() {
        Some("v2") => segments.next().unwrap_or(""),
        first => first.unwrap_or(""),
    }
}

/// The cleanup retry of the path's own org, which its Admins call while it is blocked.
fn is_own_cleanup_retry(method: &Method, path: &str) -> bool {
    let segments: Vec<&str> = path.split('/').collect();
    *method == Method::POST
        && matches!(
            segments.as_slice(),
            [org, "org_cleanup_tasks", target, "retry"] if !org.is_empty() && org == target
        )
}

pub async fn blocked_orgs_middleware(request: Request, next: Next) -> Response {
    let path = request
        .uri()
        .path()
        .strip_prefix("/")
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");

    // Extract org_id as first path segment.
    // Skip the check for known non-org top-level path prefixes that share this router.
    const SYSTEM_PREFIXES: &[&str] = &["organizations", "invites", "proxy"];
    let org_id = extract_org_id(path);

    if !org_id.is_empty()
        && !SYSTEM_PREFIXES.contains(&org_id)
        && db::org_status::is_blocked(org_id)
        && !is_own_cleanup_retry(request.method(), path)
    {
        // "deleted", not "being deleted": this gate also covers the soft-delete
        // (pending_deletion) grace window, during which the org is invisible and
        // inaccessible to the end user — to them it is simply deleted, even though
        // we retain the data for the recovery window.
        return (StatusCode::FORBIDDEN, "Organization is deleted").into_response();
    }

    #[cfg(feature = "cloud")]
    {
        use config::cluster::LOCAL_NODE;
        use openobserve_core::organization;

        if LOCAL_NODE.is_ingester()
            && config::router::INGESTER_ROUTES
                .iter()
                .any(|r| path.ends_with(r))
        {
            match organization::is_org_in_free_trial_period(org_id).await {
                Ok(ongoing) => {
                    if !ongoing {
                        log::info!("{org_id} blocked in middleware");
                        return (
                            StatusCode::TOO_MANY_REQUESTS,
                            "organization has expired its trial period",
                        )
                            .into_response();
                    }
                }
                Err(e) => {
                    log::error!("error in middleware while checking for trial period : {e}");
                }
            }
        }
    }

    next.run(request).await
}

/// Gate for routes outside the `/api` tree, which `blocked_orgs_middleware` never sees.
pub async fn blocked_org_param(
    Path(params): Path<HashMap<String, String>>,
    request: Request,
    next: Next,
) -> Response {
    if params
        .get("org_id")
        .is_some_and(|org_id| db::org_status::is_blocked(org_id))
    {
        return (StatusCode::FORBIDDEN, "Organization is deleted").into_response();
    }
    next.run(request).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_org_id_extracted_from_path() {
        assert_eq!(super::extract_org_id("myorg/api/logs"), "myorg");
    }

    #[test]
    fn test_extract_org_id_skips_v2_prefix() {
        assert_eq!(super::extract_org_id("v2/t1/alerts"), "t1");
        assert_eq!(super::extract_org_id("v2"), "");
    }

    #[test]
    fn test_empty_path_gives_empty_org_id() {
        assert_eq!(super::extract_org_id(""), "");
    }

    #[test]
    fn test_only_the_own_org_cleanup_retry_is_exempt() {
        use axum::http::Method;

        use super::is_own_cleanup_retry;
        assert!(is_own_cleanup_retry(
            &Method::POST,
            "o1/org_cleanup_tasks/o1/retry"
        ));
        for (method, path) in [
            (Method::GET, "o1/org_cleanup_tasks/o1/retry"),
            (Method::POST, "o1/org_cleanup_tasks/o2/retry"),
            (Method::POST, "o1/org_cleanup_tasks/o1"),
            (Method::POST, "o1/org_cleanup_tasks/o1/retry/x"),
            (Method::POST, "o1/streams/o1/retry"),
            (Method::POST, "v2/o1/org_cleanup_tasks/o1/retry"),
            (Method::POST, "/org_cleanup_tasks//retry"),
        ] {
            assert!(!is_own_cleanup_retry(&method, path), "{method} {path}");
        }
    }

    #[tokio::test]
    async fn test_blocked_org_reaches_only_its_own_cleanup_retry() {
        use axum::{Router, body::Body, http::Request, middleware, routing::any};
        use common::{infra::config::ORG_STATUS_CACHE, meta::organization::OrgStatus};
        use tower::ServiceExt;

        let app = Router::new()
            .route("/{*rest}", any(|| async { "handler" }))
            .layer(middleware::from_fn(super::blocked_orgs_middleware));
        let org = "gate-retry-blocked-org";
        ORG_STATUS_CACHE.insert(org.to_string(), OrgStatus::Deleting);
        let mut statuses = vec![];
        for (method, uri) in [
            ("POST", format!("/{org}/org_cleanup_tasks/{org}/retry")),
            ("POST", format!("/{org}/org_cleanup_tasks/other/retry")),
            ("GET", format!("/{org}/org_cleanup_tasks/{org}")),
            ("POST", format!("/{org}/streams")),
        ] {
            let request = Request::builder()
                .method(method)
                .uri(&uri)
                .body(Body::empty())
                .unwrap();
            let status = app.clone().oneshot(request).await.unwrap().status();
            statuses.push((uri, status.as_u16()));
        }
        ORG_STATUS_CACHE.remove(org);
        let codes: Vec<u16> = statuses.iter().map(|(_, s)| *s).collect();
        assert_eq!(codes, [200, 403, 403, 403], "{statuses:?}");
    }

    #[test]
    fn test_non_blocked_org_is_allowed_by_cache() {
        // ORG_STATUS_CACHE starts empty; is_blocked for an unknown org returns false
        assert!(!db::org_status::is_blocked("someorg"));
    }
}
