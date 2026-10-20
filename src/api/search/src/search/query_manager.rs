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

use axum::{
    Json,
    body::Bytes,
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
#[cfg(any(feature = "enterprise", test))]
use config::meta::search;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use {
    common::meta::http::HttpResponse as MetaHttpResponse,
    o2_enterprise::enterprise::common::config::get_config as get_o2_config,
};

/// A query to cancel and the org it runs in.
#[cfg(feature = "enterprise")]
#[derive(serde::Deserialize)]
struct CancelTarget {
    trace_id: String,
    org_id: String,
}

#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
pub async fn cancel_query(
    Headers(user_email): Headers<UserEmail>,
    Path((org_id, trace_ids)): Path<(String, String)>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let targets = trace_ids
            .split(',')
            .map(|id| (id, org_id.as_str()))
            .collect::<Vec<_>>();
        cancel_in_org(&org_id, &user_email.user_id, &targets).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        not_supported()
    }
}

#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
pub async fn cancel_multiple_query(
    Headers(user_email): Headers<UserEmail>,
    Path(org_id): Path<String>,
    body: Bytes,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let targets: Vec<CancelTarget> = match config::utils::json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        let targets = targets
            .iter()
            .map(|target| (target.trace_id.as_str(), target.org_id.as_str()))
            .collect::<Vec<_>>();
        cancel_in_org(&org_id, &user_email.user_id, &targets).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        not_supported()
    }
}

#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
pub async fn query_status(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        match search_service::query_status().await {
            Ok(res) => Json(search::QueryStatusResponse {
                status: visible_to(&org_id, res.status),
            })
            .into_response(),
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        not_supported()
    }
}

/// Cancels each query in its own org; another org's query needs a `_meta` caller allowed to.
#[cfg(feature = "enterprise")]
async fn cancel_in_org(org_id: &str, user_id: &str, targets: &[(&str, &str)]) -> Response {
    let other_org = targets.iter().any(|(_, target_org)| *target_org != org_id);
    if other_org && !(org_id == config::META_ORG_ID && may_cancel_in_every_org(user_id).await) {
        return MetaHttpResponse::forbidden("Not allowed to cancel other organizations' queries");
    }
    let targets = targets
        .iter()
        .map(|(trace_id, target_org)| (*trace_id, Some(*target_org)))
        .collect();
    cancel_each(targets).await
}

/// Cancels each trace id; `Some(org)` limits the cancel to that org's queries.
#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
pub async fn cancel_query_inner(scope: Option<&str>, trace_ids: &[&str]) -> Response {
    #[cfg(feature = "enterprise")]
    {
        cancel_each(trace_ids.iter().map(|id| (*id, scope)).collect()).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        not_supported()
    }
}

/// Best-effort cancel of a running query and all of its internal sub-queries
/// (which share the `trace_id` as a prefix). Unlike [`cancel_query_inner`] this
/// does not build an HTTP response — it is meant for internal callers such as
/// the client-disconnect handler. Errors are logged, not returned.
#[cfg(feature = "enterprise")]
pub async fn cancel_query_internal(org_id: &str, trace_id: &str) {
    if trace_id.is_empty() {
        return;
    }
    match cancel_in_cluster(Some(org_id), trace_id).await {
        Ok(res) => log::info!("[trace_id {trace_id}] query canceled: {res:?}"),
        Err(e) => log::error!("[trace_id {trace_id}] failed to cancel query: {e}"),
    }
}

/// Cancels each trace id in its scope: `Some(org)` for that org's queries, `None` for every org's.
#[cfg(feature = "enterprise")]
async fn cancel_each(targets: Vec<(&str, Option<&str>)>) -> Response {
    if targets.is_empty() {
        return (StatusCode::BAD_REQUEST, Json("Invalid trace_id")).into_response();
    }
    let mut res = Vec::with_capacity(targets.len());
    for (trace_id, scope) in targets.into_iter().filter(|(id, _)| !id.is_empty()) {
        match cancel_in_cluster(scope, trace_id).await {
            Ok(status) => res.push(status),
            Err(e) => return MetaHttpResponse::bad_request(e),
        }
    }
    Json(res).into_response()
}

#[cfg(feature = "enterprise")]
async fn cancel_in_cluster(
    scope: Option<&str>,
    trace_id: &str,
) -> Result<search::CancelQueryResponse, infra::errors::Error> {
    if get_o2_config().super_cluster.enabled {
        o2_enterprise::enterprise::super_cluster::search::cancel_query(scope, trace_id).await
    } else {
        search_service::cancel_query(scope, trace_id).await
    }
}

/// Root, a `_meta` Admin or Editor, or an enforced `settings` write grant in `_meta`.
#[cfg(feature = "enterprise")]
async fn may_cancel_in_every_org(user_id: &str) -> bool {
    use config::{META_ORG_ID, meta::user::UserRole};

    if db::user::is_root_user(user_id) {
        return true;
    }
    if matches!(
        openobserve_core::users::get_user(Some(META_ORG_ID), user_id).await,
        Some(user) if matches!(user.role, UserRole::Admin | UserRole::Editor)
    ) {
        return true;
    }
    // Under the cloud check bypass every permission check passes, so it proves no grant.
    let cloud_check_bypassed =
        cfg!(feature = "cloud") && o2_openfga::config::get_config().cloud_ofga_check_disabled;
    !cloud_check_bypassed
        && openobserve_core::authz::rbac_enforced().await
        && openobserve_core::auth::check_permissions(
            META_ORG_ID,
            META_ORG_ID,
            user_id,
            "settings",
            "PUT",
            None,
            true,
            false,
            false,
        )
        .await
}

#[cfg(not(feature = "enterprise"))]
fn not_supported() -> Response {
    (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
}

/// The running queries an org may see: its own, or every org's from `_meta`.
#[cfg(any(feature = "enterprise", test))]
fn visible_to(org: &str, rows: Vec<search::QueryStatus>) -> Vec<search::QueryStatus> {
    if org == config::META_ORG_ID {
        return rows;
    }
    rows.into_iter()
        .filter(|row| row.org_id.as_deref() == Some(org))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(trace_id: &str, org_id: Option<&str>) -> search::QueryStatus {
        search::QueryStatus {
            trace_id: trace_id.to_string(),
            org_id: org_id.map(str::to_string),
            ..Default::default()
        }
    }

    fn trace_ids(rows: Vec<search::QueryStatus>) -> Vec<String> {
        rows.into_iter().map(|row| row.trace_id).collect()
    }

    #[test]
    fn an_org_sees_only_its_own_running_queries() {
        let rows = vec![row("a1", Some("a")), row("b1", Some("b")), row("n1", None)];
        assert_eq!(trace_ids(visible_to("a", rows.clone())), vec!["a1"]);
        assert!(visible_to("c", rows).is_empty());
    }

    #[cfg(feature = "enterprise")]
    #[test]
    fn cancel_body_needs_the_org_of_each_query() {
        let body = br#"[{"trace_id": "t1", "org_id": "a"}]"#;
        let targets: Vec<CancelTarget> = config::utils::json::from_slice(body).unwrap();
        assert_eq!(
            (targets[0].trace_id.as_str(), targets[0].org_id.as_str()),
            ("t1", "a")
        );

        let bare = config::utils::json::from_slice::<Vec<CancelTarget>>(br#"["t1"]"#);
        assert!(bare.is_err());
        let no_org =
            config::utils::json::from_slice::<Vec<CancelTarget>>(br#"[{"trace_id": "t1"}]"#);
        assert!(no_org.is_err());
    }

    #[test]
    fn meta_sees_every_running_query() {
        let rows = vec![row("a1", Some("a")), row("b1", Some("b")), row("n1", None)];
        assert_eq!(
            trace_ids(visible_to(config::META_ORG_ID, rows)),
            vec!["a1", "b1", "n1"]
        );
    }
}
