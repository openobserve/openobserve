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

//! The incidents AutoObserve opened, read from the meta store alone.

use axum::{
    extract::{Path, Query, rejection::QueryRejection},
    response::Response,
};
use o2_enterprise::enterprise::autoobserve::api::MAX_LIMIT;
use openobserve_core::autoobserve::incidents;
use serde::Deserialize;
use utoipa::IntoParams;

use super::{deployment_disabled, page, parse_query};
use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[derive(Debug, Default, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct IncidentsQuery {
    /// 1 to 500; 100 by default.
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/autoobserve/incidents",
    context_path = "/api",
    tag = "AutoObserve",
    operation_id = "AutoObserveListIncidents",
    summary = "List incidents AutoObserve opened",
    description = "Incidents AutoObserve opened for a stream that stopped, dropped or rose, newest first, each with its finding, the incident and the incident's analysis. `paging` says whether AutoObserve pages for this org; `has_more` says another page follows.",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name"), IncidentsQuery),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "A limit outside 1 to 500", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = Object),
        (status = 404, description = "AutoObserve is disabled for this deployment", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "AutoObserve", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List incidents AutoObserve opened", "category": "autoobserve"}))
    )
)]
pub async fn list_incidents(
    Path(org_id): Path<String>,
    query: Result<Query<IncidentsQuery>, QueryRejection>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    let query = match parse_query(query) {
        Ok(query) => query,
        Err(refused) => return refused,
    };
    let page = page(query.limit, query.offset);
    // The same bound and words as the engine-backed routes, which check it in `Page`.
    if page.limit == 0 || page.limit > MAX_LIMIT {
        return MetaHttpResponse::bad_request(format!("limit must be 1 to {MAX_LIMIT}"));
    }
    match incidents::list(&org_id, page).await {
        Ok(body) => MetaHttpResponse::json(body),
        Err(e) => {
            log::error!("[autoobserve] listing the incidents of {org_id} failed: {e}");
            MetaHttpResponse::internal_error("listing AutoObserve incidents failed")
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        Router,
        body::Body,
        http::{Request, StatusCode},
        routing,
    };
    use openobserve_core::autoobserve::incidents::AutoObserveIncidents;
    use tower::ServiceExt;

    use super::*;

    const FIXTURE: &str = include_str!(
        "../../../../../../web/src/components/autoobserve/live/__fixtures__/autoobserveIncidents.json"
    );

    async fn get(uri: &str) -> (StatusCode, String) {
        let app = Router::new().route(
            "/v2/{org_id}/autoobserve/incidents",
            routing::get(list_incidents),
        );
        let request = Request::builder().uri(uri).body(Body::empty()).unwrap();
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        (status, String::from_utf8(body.to_vec()).unwrap())
    }

    #[tokio::test]
    async fn the_route_refuses_a_limit_outside_1_to_500() {
        super::super::tests::ENGINE_ON.with(|on| on.set(Some(true)));
        for limit in [0, MAX_LIMIT + 1] {
            let (status, body) = get(&format!("/v2/o/autoobserve/incidents?limit={limit}")).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{limit}: {body}");
            assert!(body.contains("limit must be 1 to 500"), "{limit}: {body}");
        }
        let (status, _) = get("/v2/o/autoobserve/incidents?limit=abc").await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        super::super::tests::ENGINE_ON.with(|on| on.set(Some(false)));
        let (status, _) = get("/v2/o/autoobserve/incidents").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "a switched-off deployment");
    }

    #[test]
    fn the_route_body_matches_the_web_fixture() {
        let body: AutoObserveIncidents = serde_json::from_str(FIXTURE).unwrap();
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            serde_json::from_str::<serde_json::Value>(FIXTURE).unwrap()
        );
        assert!(body.items[0].investigation.summary.is_some(), "an object");
    }
}
