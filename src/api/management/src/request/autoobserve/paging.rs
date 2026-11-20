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

//! The org's paging opt-in (R5): whether a stopped stream opens an incident and pages on-call.

use std::num::NonZeroU32;

use axum::{
    Json,
    body::Bytes,
    extract::{Path, RawQuery},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use o2_enterprise::enterprise::autoobserve::{
    api::ApiError, paging_settings, plugins::stream::StreamPager,
};
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;

use super::{deployment_disabled, serve};
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// The web shows `message` beside the disabled toggle and keys on `error`.
pub const UNAVAILABLE_ERROR: &str = "paging_unavailable";
pub const UNAVAILABLE_MESSAGE: &str = "Paging is turned off for this deployment.";
const UNKNOWN_TEAM_MESSAGE: &str = "There is no on-call team with this id in this organization.";

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct PagingBody {
    pub page_on_stop: bool,
    /// Left out, the stored budget is kept; 0 is refused because `page_on_stop` is the off switch.
    #[serde(default)]
    #[schema(value_type = Option<u32>, minimum = 1)]
    pub pages_per_day: Option<NonZeroU32>,
    /// Left out, the saved team is kept; `null` or "" clears it.
    #[serde(default, deserialize_with = "present")]
    #[schema(value_type = Option<String>)]
    pub team_id: Option<Option<String>>,
}

/// The setting as stored, with the paging team's name while that team exists.
#[derive(Serialize)]
struct PagingAnswer {
    #[serde(flatten)]
    setting: paging_settings::PagingView,
    #[serde(skip_serializing_if = "Option::is_none")]
    team_name: Option<String>,
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/settings/paging",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveGetPagingSettings",
    summary = "Read whether AutoObserve pages for this organization",
    description = "`page_on_stop` says whether a stream that stops sending data opens an incident and pages on-call through the organization's routing rules. It is off until someone turns it on. `pages_per_day` is the organization's page budget: at most that many AutoObserve pages reach a team in any `O2_AUTOOBSERVE_PAGE_BUDGET_WINDOW_HOURS` window; an organization that set none reads `O2_AUTOOBSERVE_PAGES_PER_DAY`. A stop past the budget still opens an incident and gets its analysis, but pages nobody. `available` says whether this deployment lets AutoObserve page at all (`O2_AUTOOBSERVE_PAGING_ENABLED`); while it is false nothing pages, whatever the organization chose. `team_id`, when set, is the on-call team every AutoObserve page goes to, ahead of ownership rules and the default team; other alerts never use it. `team_name` is that team's name; a `team_id` without a `team_name` means the team was deleted, and AutoObserve pages route as if none were set.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_paging_settings(Path(org_id): Path<String>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let deployment = StreamPager::shipped().is_some();
    serve(|deps| async move {
        let setting = paging_settings::get_paging(&deps, &org_id, deployment).await;
        with_team_name(&org_id, setting).await
    })
    .await
}

#[utoipa::path(
    put,
    path = "/v2/{org_id}/autoobserve/settings/paging",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObservePutPagingSettings",
    summary = "Turn AutoObserve paging on or off for this organization",
    description = "With `page_on_stop` true, a stream that stops sending data opens an incident and pages on-call: the team in `team_id` when one is set, otherwise an ownership rule on the stream's service, otherwise the organization's default team, otherwise it waits on the unrouted queue. Streams that stop together share one incident and one page. `pages_per_day`, optional and at least 1, caps how many AutoObserve pages reach a team in any `O2_AUTOOBSERVE_PAGE_BUDGET_WINDOW_HOURS` window; left out, the stored value is kept. A stop past it still opens an incident and gets its analysis, but pages nobody. `team_id` sends AutoObserve pages, and no other alert's, to that on-call team; left out, the saved team is kept, and `null` or an empty string clears it. A `team_id` that is not an on-call team of this organization is refused. Needs the permission that changes on-call routing.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    request_body(content = inline(PagingBody), content_type = "application/json"),
    responses(
        (status = 200, description = "The setting as stored", content_type = "application/json", body = Object),
        (status = 400, description = "A query string, an invalid body, or a `team_id` that is not an on-call team of this organization", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 409, description = "Paging is turned off for this deployment: `{error: \"paging_unavailable\", message}`", content_type = "application/json", body = Object),
        (status = 500, description = "The write failed", content_type = "application/json", body = Object),
        (status = 503, description = "The engine is not running on this node", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn put_paging_settings(
    Path(org_id): Path<String>,
    RawQuery(query): RawQuery,
    body: Bytes,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    if query.as_deref().is_some_and(|q| !q.is_empty()) {
        return MetaHttpResponse::bad_request("a paging settings PUT takes no query string");
    }
    let body: PagingBody = match serde_json::from_slice(&body) {
        Ok(body) => body,
        Err(e) => return MetaHttpResponse::bad_request(format!("invalid paging body: {e}")),
    };
    let team = body
        .team_id
        .as_ref()
        .map(|t| t.as_deref().map(str::trim).filter(|t| !t.is_empty()));
    if let Some(Some(team_id)) = team {
        match infra::table::oncall_teams::get(&org_id, team_id).await {
            Ok(Some(_)) => {}
            Ok(None) => return MetaHttpResponse::bad_request(UNKNOWN_TEAM_MESSAGE),
            Err(e) => {
                log::error!(
                    "[AUTOOBSERVE] org {org_id}: reading on-call team {team_id} failed: {e}"
                );
                return MetaHttpResponse::internal_error("reading the on-call team failed");
            }
        }
    }
    if StreamPager::shipped().is_none() {
        return unavailable();
    }
    serve(|deps| async move {
        let saved = paging_settings::put_paging(
            &deps,
            &org_id,
            body.page_on_stop,
            body.pages_per_day,
            team,
            true,
        )
        .await?;
        with_team_name(&org_id, saved).await
    })
    .await
}

/// A failed read errs, because a missing `team_name` tells the caller the team was deleted.
async fn with_team_name(
    org_id: &str,
    setting: paging_settings::PagingView,
) -> Result<PagingAnswer, ApiError> {
    let team_name = match setting.team_id.as_deref() {
        Some(team_id) => infra::table::oncall_teams::get(org_id, team_id)
            .await
            .map_err(|e| ApiError::Storage(e.to_string()))?
            .map(|t| t.name),
        None => None,
    };
    Ok(PagingAnswer { setting, team_name })
}

/// Tells a `team_id` left out (keep the saved team) from an explicit `null` (clear it).
fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}

/// A save the deployment would ignore is refused, so the org never believes it pages.
fn unavailable() -> Response {
    let body = serde_json::json!({"error": UNAVAILABLE_ERROR, "message": UNAVAILABLE_MESSAGE});
    (StatusCode::CONFLICT, Json(body)).into_response()
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        routing,
    };
    use tower::ServiceExt;

    use super::*;

    async fn send(method: &str, uri: &str, body: &str) -> (StatusCode, String) {
        let app = Router::new().route(
            "/v2/{org_id}/autoobserve/settings/paging",
            routing::get(get_paging_settings).put(put_paging_settings),
        );
        let request = Request::builder()
            .method(method)
            .uri(uri)
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn a_put_refuses_a_bad_body_or_a_query_before_the_engine_is_asked() {
        super::super::tests::ENGINE_ON.with(|on| on.set(Some(true)));
        let uri = "/v2/o/autoobserve/settings/paging";
        for body in [
            "",
            "{}",
            r#"{"page_on_stop":"yes"}"#,
            r#"{"page_on_stop":true,"x":1}"#,
            r#"{"page_on_stop":true,"pages_per_day":0}"#,
            r#"{"page_on_stop":true,"pages_per_day":-1}"#,
            r#"{"page_on_stop":true,"pages_per_day":"1"}"#,
            r#"{"page_on_stop":true,"team_id":5}"#,
        ] {
            let (status, text) = send("PUT", uri, body).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {text}");
            assert!(text.contains("invalid paging body"), "{body}: {text}");
        }
        let (status, _) = send("PUT", &format!("{uri}?x=1"), r#"{"page_on_stop":true}"#).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let (status, text) = send("PUT", uri, r#"{"page_on_stop":true}"#).await;
        assert_eq!(
            status,
            StatusCode::CONFLICT,
            "paging is off by default: {text}"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&text).unwrap(),
            serde_json::json!({
                "error": "paging_unavailable",
                "message": "Paging is turned off for this deployment."
            })
        );
        super::super::tests::ENGINE_ON.with(|on| on.set(Some(false)));
        for method in ["GET", "PUT"] {
            let (status, _) = send(method, uri, r#"{"page_on_stop":true}"#).await;
            assert_eq!(
                status,
                StatusCode::NOT_FOUND,
                "{method} on a switched-off deployment"
            );
        }
    }

    #[tokio::test]
    async fn a_put_naming_a_team_the_org_does_not_have_is_refused() {
        use sea_orm::{ConnectionTrait, Schema};

        super::super::tests::ENGINE_ON.with(|on| on.set(Some(true)));
        std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
        let conn = infra::db::get_orm_client_rw().await;
        let backend = conn.get_database_backend();
        let mut table = Schema::new(backend)
            .create_table_from_entity(infra::table::entity::oncall_teams::Entity);
        conn.execute(backend.build(table.if_not_exists()))
            .await
            .unwrap();
        let org = format!("o{}", config::ider::generate().to_lowercase());
        let own = infra::table::oncall_teams::create(&org, "ao", "UTC", None)
            .await
            .unwrap();
        let other = infra::table::oncall_teams::create(&format!("{org}-other"), "ao", "UTC", None)
            .await
            .unwrap();
        let put = |team: &str| format!(r#"{{"page_on_stop":true,"team_id":{team}}}"#);
        // CONFLICT is the deployment's paging switch, reached only past the team check.
        let cases = [
            (put(r#""no-such-team""#), StatusCode::BAD_REQUEST),
            (put(&format!(r#""{}""#, other.id)), StatusCode::BAD_REQUEST),
            (put(&format!(r#""{}""#, own.id)), StatusCode::CONFLICT),
            (put("null"), StatusCode::CONFLICT),
            (put(r#""""#), StatusCode::CONFLICT),
        ];
        let uri = format!("/v2/{org}/autoobserve/settings/paging");
        for (body, want) in cases {
            let (status, text) = send("PUT", &uri, &body).await;
            assert_eq!(status, want, "{body}: {text}");
            if want == StatusCode::BAD_REQUEST {
                assert!(text.contains("no on-call team"), "{body}: {text}");
            }
        }
    }
}
