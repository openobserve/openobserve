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

//! Per-range build state from the querier owning each link, reached over internal gRPC.

use axum::{
    extract::{Path, Query},
    response::Response,
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use openobserve_api_common::extractors::Headers;
use openobserve_core::public_dashboards::status::{self, MAX_BATCH};
use serde::Deserialize;

use super::admin::{feature_gate, hide_unreadable_status, load_link, map_err};
use crate::service::auth::UserEmail;

#[derive(Deserialize)]
pub struct BatchParams {
    ids: Option<String>,
}

/// GET /{org_id}/dashboards/{dashboard_id}/public_links/{link_id}/status, with sources.
pub async fn link(
    Path((org_id, dashboard_id, link_id)): Path<(String, String, String)>,
    Headers(user): Headers<UserEmail>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    let link = match load_link(&org_id, &dashboard_id, &link_id).await {
        Ok(link) => link,
        Err(r) => return r,
    };
    let links = std::slice::from_ref(&link);
    let mut reports = status::reports(links, true).await;
    if let Err(e) = hide_unreadable_status(&org_id, &user.user_id, links, &mut reports).await {
        return map_err("status", e);
    }
    match reports.pop() {
        Some(report) => MetaHttpResponse::json(report),
        None => MetaHttpResponse::service_unavailable(
            "The server that holds this link's results did not answer. Try again.",
        ),
    }
}

/// GET /{org_id}/public_dashboards/status?ids=a,b — no sources; unreachable owners left out.
pub async fn batch(
    Path(org_id): Path<String>,
    Headers(user): Headers<UserEmail>,
    Query(params): Query<BatchParams>,
) -> Response {
    if let Some(r) = feature_gate() {
        return r;
    }
    let ids = match parse_ids(params.ids.as_deref()) {
        Ok(ids) => ids,
        Err(msg) => return MetaHttpResponse::bad_request(msg),
    };
    let links = match status::live_links(&org_id, &ids).await {
        Ok(links) => links,
        Err(e) => return map_err("status_batch", e),
    };
    let mut list = status::reports(&links, false).await;
    if let Err(e) = hide_unreadable_status(&org_id, &user.user_id, &links, &mut list).await {
        return map_err("status_batch", e);
    }
    MetaHttpResponse::json(serde_json::json!({ "list": list }))
}

/// Distinct non-empty ids in their order; more than [`MAX_BATCH`] is refused.
fn parse_ids(ids: Option<&str>) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    for id in ids.unwrap_or_default().split(',').map(str::trim) {
        if !id.is_empty() && !out.iter().any(|seen| seen == id) {
            out.push(id.to_string());
        }
    }
    if out.len() > MAX_BATCH {
        return Err(format!(
            "ask for at most {MAX_BATCH} public links at a time"
        ));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    #[test]
    fn gate14_the_batch_takes_at_most_fifty_distinct_ids() {
        assert_eq!(parse_ids(None).unwrap(), Vec::<String>::new());
        assert_eq!(parse_ids(Some("a, b,,a")).unwrap(), ["a", "b"]);
        let fifty: Vec<String> = (0..50).map(|i| format!("l{i}")).collect();
        assert_eq!(parse_ids(Some(&fifty.join(","))).unwrap(), fifty);
        let fifty_one = format!("{},l50", fifty.join(","));
        assert_eq!(
            parse_ids(Some(&fifty_one)).unwrap_err(),
            "ask for at most 50 public links at a time"
        );
    }

    #[tokio::test]
    async fn gate14_an_oversized_batch_is_a_400_before_any_lookup() {
        let ids: Vec<String> = (0..51).map(|i| format!("l{i}")).collect();
        let user = UserEmail {
            user_id: "u@example.com".to_string(),
        };
        let resp = batch(
            Path("o1".to_string()),
            Headers(user),
            Query(BatchParams {
                ids: Some(ids.join(",")),
            }),
        )
        .await;
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
