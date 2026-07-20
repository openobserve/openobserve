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

/// Extract the org_id (first path segment) from a request path. Shared by the
/// blocking check and the cloud trial "late check" below so both agree on how the
/// org is derived.
fn extract_org_id(path: &str) -> &str {
    path.split('/').next().unwrap_or("")
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
        && openobserve_core::db::org_status::is_blocked(org_id)
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
    fn test_non_blocked_org_is_allowed_by_cache() {
        // ORG_STATUS_CACHE starts empty; is_blocked for an unknown org returns false
        assert!(!openobserve_core::db::org_status::is_blocked("someorg"));
    }
}
