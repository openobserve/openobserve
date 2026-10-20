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
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
#[cfg(any(feature = "enterprise", test))]
use {common::meta::http::HttpResponse as MetaHttpResponse, config::meta::search};

pub async fn cancel_query(
    Headers(user_email): Headers<UserEmail>,
    Path(params): Path<(String, String)>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let (org_id, trace_id) = params;
        let trace_ids = trace_id.split(',').collect::<Vec<&str>>();
        let scope = cancel_scope(&org_id, &user_email.user_id).await;
        if let Some(refusal) = refuse_foreign_cancel(&org_id, scope, &trace_ids).await {
            return refusal;
        }
        cancel_query_inner(scope, &trace_ids).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(params);
        drop(user_email);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

pub async fn cancel_multiple_query(
    Headers(user_email): Headers<UserEmail>,
    Path(params): Path<String>,
    body: Bytes,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let org_id = params;
        let trace_ids: Vec<String> = match config::utils::json::from_slice(&body) {
            Ok(v) => v,
            Err(e) => {
                return MetaHttpResponse::bad_request(e);
            }
        };
        let trace_ids = trace_ids.iter().map(|s| s.as_str()).collect::<Vec<&str>>();
        let scope = cancel_scope(&org_id, &user_email.user_id).await;
        if let Some(refusal) = refuse_foreign_cancel(&org_id, scope, &trace_ids).await {
            return refusal;
        }
        cancel_query_inner(scope, &trace_ids).await
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(params);
        drop(body);
        drop(user_email);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

pub async fn query_status(Path(org_id): Path<String>) -> Response {
    #[cfg(feature = "enterprise")]
    {
        let res = search_service::query_status().await;
        match res {
            Ok(query_status) => Json(search::QueryStatusResponse {
                status: visible_to(&org_id, query_status.status),
            })
            .into_response(),
            Err(e) => MetaHttpResponse::bad_request(e),
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(org_id);
        (StatusCode::FORBIDDEN, Json("Not Supported")).into_response()
    }
}

/// Cancels each trace id; `Some(org)` limits the cancel to that org's queries.
pub async fn cancel_query_inner(scope: Option<&str>, trace_ids: &[&str]) -> Response {
    #[cfg(feature = "enterprise")]
    {
        if trace_ids.is_empty() {
            return (StatusCode::BAD_REQUEST, Json("Invalid trace_id")).into_response();
        }
        let mut res = Vec::with_capacity(trace_ids.len());
        for trace_id in trace_ids {
            if trace_id.is_empty() {
                continue;
            }
            let ret = if get_o2_config().super_cluster.enabled {
                o2_enterprise::enterprise::super_cluster::search::cancel_query(scope, trace_id)
                    .await
            } else {
                search_service::cancel_query(scope, trace_id).await
            };
            match ret {
                Ok(status) => res.push(status),
                Err(e) => return MetaHttpResponse::bad_request(e),
            }
        }
        Json(res).into_response()
    }

    #[cfg(not(feature = "enterprise"))]
    {
        let _ = scope;
        let _ = trace_ids;
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
    let ret = if get_o2_config().super_cluster.enabled {
        o2_enterprise::enterprise::super_cluster::search::cancel_query(Some(org_id), trace_id).await
    } else {
        search_service::cancel_query(Some(org_id), trace_id).await
    };
    match ret {
        Ok(res) => {
            log::info!("[trace_id {trace_id}] query canceled: {res:?}");
        }
        Err(e) => {
            log::error!("[trace_id {trace_id}] failed to cancel query: {e}");
        }
    }
}

/// The org a cancel acts in: `None` (every org) only for a `_meta` caller allowed to cancel any.
#[cfg(feature = "enterprise")]
async fn cancel_scope<'a>(org_id: &'a str, user_id: &str) -> Option<&'a str> {
    (org_id != config::META_ORG_ID || !may_cancel_in_every_org(user_id).await).then_some(org_id)
}

/// A `_meta` cancel narrowed to `_meta` is refused when an id names only other orgs' queries.
#[cfg(feature = "enterprise")]
async fn refuse_foreign_cancel(
    org_id: &str,
    scope: Option<&str>,
    trace_ids: &[&str],
) -> Option<Response> {
    let scope = scope.filter(|_| org_id == config::META_ORG_ID)?;
    let rows = match search_service::query_status().await {
        Ok(res) => res.status,
        Err(e) => {
            log::warn!("cancel: running queries could not be listed: {e}");
            return None;
        }
    };
    foreign_cancel_refusal(scope, trace_ids, &rows)
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

/// 403 when a requested id matches (itself or `{id}-…`) only queries of orgs other than `scope`.
#[cfg(any(feature = "enterprise", test))]
fn foreign_cancel_refusal(
    scope: &str,
    trace_ids: &[&str],
    rows: &[search::QueryStatus],
) -> Option<Response> {
    let only_foreign = |id: &str| {
        let owners = rows
            .iter()
            .filter(|row| {
                row.trace_id == id
                    || row
                        .trace_id
                        .strip_prefix(id)
                        .is_some_and(|rest| rest.starts_with('-'))
            })
            .filter_map(|row| row.org_id.as_deref());
        let (mut foreign, mut own) = (false, false);
        for owner in owners {
            if owner == scope {
                own = true;
            } else {
                foreign = true;
            }
        }
        foreign && !own
    };
    trace_ids
        .iter()
        .any(|id| only_foreign(id))
        .then(|| MetaHttpResponse::forbidden("Not allowed to cancel other organizations' queries"))
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

    #[test]
    fn a_narrowed_cancel_naming_another_orgs_query_is_forbidden() {
        let meta = config::META_ORG_ID;
        let rows = vec![row("a1", Some("a")), row("m1", Some(meta)), row("n1", None)];
        let refusal = foreign_cancel_refusal(meta, &["m1", "a1"], &rows).unwrap();
        assert_eq!(refusal.status(), StatusCode::FORBIDDEN);
        assert!(foreign_cancel_refusal(meta, &["m1"], &rows).is_none());
        assert!(foreign_cancel_refusal(meta, &["n1", "gone"], &rows).is_none());
    }

    #[test]
    fn a_narrowed_cancel_of_a_parent_id_with_another_orgs_sub_queries_is_forbidden() {
        let meta = config::META_ORG_ID;
        let rows = vec![
            row("t-0", Some("a")),
            row("t-q0", Some("a")),
            row("m-0", Some(meta)),
            row("tx", Some("a")),
        ];
        let refusal = foreign_cancel_refusal(meta, &["t"], &rows).unwrap();
        assert_eq!(refusal.status(), StatusCode::FORBIDDEN);
        assert!(foreign_cancel_refusal(meta, &["m"], &rows).is_none());
        assert!(foreign_cancel_refusal(meta, &["t-1"], &rows).is_none());
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
