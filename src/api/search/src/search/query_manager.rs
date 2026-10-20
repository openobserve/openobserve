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
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
#[cfg(feature = "enterprise")]
use {
    common::meta::http::HttpResponse as MetaHttpResponse,
    config::{META_ORG_ID, meta::search, meta::user::UserRole},
    o2_enterprise::enterprise::common::config::get_config as get_o2_config,
};

/// A query to cancel and the org it runs in.
#[cfg(feature = "enterprise")]
#[derive(serde::Deserialize)]
struct QueryToCancel {
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
        let queries = trace_ids
            .split(',')
            .map(|id| (id, org_id.as_str()))
            .collect::<Vec<_>>();
        cancel_in_org(&org_id, &user_email.user_id, &queries).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
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
        let queries: Vec<QueryToCancel> = match config::utils::json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => return MetaHttpResponse::bad_request(e),
        };
        let queries = queries
            .iter()
            .map(|query| (query.trace_id.as_str(), query.org_id.as_str()))
            .collect::<Vec<_>>();
        cancel_in_org(&org_id, &user_email.user_id, &queries).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
pub async fn query_status(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        // only the _meta Query Management page lists running queries, and it lists every org's
        if org_id != META_ORG_ID {
            return MetaHttpResponse::forbidden(
                "Query status is only available in the _meta organization",
            );
        }
        match search_service::query_status().await {
            Ok(res) => Json(res).into_response(),
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

/// Cancels each query in its own org; another org's query needs a `_meta` caller allowed to.
#[cfg(feature = "enterprise")]
async fn cancel_in_org(org_id: &str, user_id: &str, queries: &[(&str, &str)]) -> Response {
    let other_org = queries.iter().any(|(_, query_org)| *query_org != org_id);
    if other_org && !(org_id == META_ORG_ID && can_cancel_other_orgs(user_id).await) {
        return MetaHttpResponse::forbidden("Not allowed to cancel other organizations' queries");
    }
    cancel_each(queries).await
}

/// Cancels each trace id in `org_id`.
#[cfg_attr(not(feature = "enterprise"), allow(unused_variables))]
pub async fn cancel_query_inner(org_id: &str, trace_ids: &[&str]) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let queries = trace_ids.iter().map(|id| (*id, org_id)).collect::<Vec<_>>();
        cancel_each(&queries).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
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
    match cancel_in_cluster(org_id, trace_id).await {
        Ok(res) => log::info!("[trace_id {trace_id}] query canceled: {res:?}"),
        Err(e) => log::error!("[trace_id {trace_id}] failed to cancel query: {e}"),
    }
}

/// Cancels each trace id in the org it runs in.
#[cfg(feature = "enterprise")]
async fn cancel_each(queries: &[(&str, &str)]) -> Response {
    if queries.is_empty() {
        return (StatusCode::BAD_REQUEST, Json("Invalid trace_id")).into_response();
    }
    let mut res = Vec::with_capacity(queries.len());
    for (trace_id, org_id) in queries.iter().filter(|(id, _)| !id.is_empty()) {
        match cancel_in_cluster(org_id, trace_id).await {
            Ok(status) => res.push(status),
            Err(e) => return MetaHttpResponse::bad_request(e),
        }
    }
    Json(res).into_response()
}

#[cfg(feature = "enterprise")]
async fn cancel_in_cluster(
    org_id: &str,
    trace_id: &str,
) -> Result<search::CancelQueryResponse, infra::errors::Error> {
    if get_o2_config().super_cluster.enabled {
        o2_enterprise::enterprise::super_cluster::search::cancel_query(org_id, trace_id).await
    } else {
        search_service::cancel_query(org_id, trace_id).await
    }
}

/// Root, a `_meta` Admin or Editor, or an enforced `settings` write grant in `_meta`.
#[cfg(feature = "enterprise")]
async fn can_cancel_other_orgs(user_id: &str) -> bool {
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

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use super::*;

    #[test]
    fn cancel_body_needs_the_org_of_each_query() {
        let body = br#"[{"trace_id": "t1", "org_id": "a"}]"#;
        let queries: Vec<QueryToCancel> = config::utils::json::from_slice(body).unwrap();
        assert_eq!(
            (queries[0].trace_id.as_str(), queries[0].org_id.as_str()),
            ("t1", "a")
        );

        let bare = config::utils::json::from_slice::<Vec<QueryToCancel>>(br#"["t1"]"#);
        assert!(bare.is_err());
        let no_org =
            config::utils::json::from_slice::<Vec<QueryToCancel>>(br#"[{"trace_id": "t1"}]"#);
        assert!(no_org.is_err());
    }
}
