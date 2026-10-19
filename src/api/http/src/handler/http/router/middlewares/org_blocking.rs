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

use axum::{extract::Request, middleware::Next, response::Response};
use openobserve_core::auth::{org_from_path, routed_path};

fn extract_org_id(path: &str) -> &str {
    // `org_from_path` reads at most three segments, so a fixed array avoids a per-request Vec.
    let mut path_columns = [""; 3];
    let mut len = 0;
    for (column, segment) in path_columns.iter_mut().zip(path.split('/')) {
        *column = segment;
        len += 1;
    }
    org_from_path(&path_columns[..len])
}

pub async fn blocked_orgs_middleware(request: Request, next: Next) -> Response {
    let path = routed_path(request.uri().path());

    // Skip the check for known non-org top-level path prefixes that share this router.
    const SYSTEM_PREFIXES: &[&str] = &["organizations", "invites", "proxy"];
    let org_id = extract_org_id(path);

    if !org_id.is_empty()
        && !SYSTEM_PREFIXES.contains(&org_id)
        && db::org_status::is_blocked(org_id)
    {
        use axum::{http::StatusCode, response::IntoResponse};
        // "deleted", not "being deleted": this gate also covers the soft-delete
        // (pending_deletion) grace window, during which the org is invisible and
        // inaccessible to the end user — to them it is simply deleted, even though
        // we retain the data for the recovery window.
        return (StatusCode::FORBIDDEN, "Organization is deleted").into_response();
    }

    #[cfg(feature = "cloud")]
    {
        use axum::{http::StatusCode, response::IntoResponse};
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

#[cfg(test)]
mod tests {
    #[test]
    fn test_org_id_extracted_from_path() {
        assert_eq!(super::extract_org_id("myorg/api/logs"), "myorg");
    }

    #[test]
    fn test_empty_path_gives_empty_org_id() {
        assert_eq!(super::extract_org_id(""), "");
    }

    #[test]
    fn test_v2_module_path_gives_its_org() {
        assert_eq!(super::extract_org_id("v2/myorg/alerts"), "myorg");
        assert_eq!(super::extract_org_id("v2/myorg/streams"), "v2");
    }

    #[test]
    fn test_short_and_long_paths_resolve_as_org_from_path() {
        for path in [
            "myorg",
            "v2",
            "v2/myorg",
            "v2/myorg/alerts/a/b/c",
            "a/b/c/d/e",
            "/x",
        ] {
            let columns: Vec<&str> = path.split('/').collect();
            let expected = openobserve_core::auth::org_from_path(&columns);
            assert_eq!(super::extract_org_id(path), expected, "{path}");
        }
    }

    #[tokio::test]
    async fn test_blocked_org_is_refused_on_a_v2_route() {
        use axum::{
            Router,
            body::Body,
            http::{Request, StatusCode},
            middleware,
            routing::get,
        };
        use common::{infra::config::ORG_STATUS_CACHE, meta::organization::OrgStatus};
        use tower::ServiceExt;

        let org = "org-blocking-v2-route";
        ORG_STATUS_CACHE.insert(org.to_string(), OrgStatus::PendingDeletion);
        let app = Router::new()
            .route("/v2/{org_id}/alerts", get(|| async { "ok" }))
            .layer(middleware::from_fn(super::blocked_orgs_middleware));
        let request = Request::get(format!("/v2/{org}/alerts"))
            .body(Body::empty())
            .unwrap();
        let status = app.oneshot(request).await.unwrap().status();
        ORG_STATUS_CACHE.remove(org);
        assert_eq!(status, StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_non_blocked_org_is_allowed_by_cache() {
        // ORG_STATUS_CACHE starts empty; is_blocked for an unknown org returns false
        assert!(!db::org_status::is_blocked("someorg"));
    }
}
