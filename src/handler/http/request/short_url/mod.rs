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
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use config::meta::short_url::{ShortenUrlRequest, ShortenUrlResponse};
use serde::Deserialize;

use crate::{
    common::utils::redirect_response::RedirectResponseBuilder,
    handler::http::request::search::error_utils::map_error_to_http_response, service::short_url,
};

/// Shorten a URL
#[utoipa::path(
    post,
    path = "/{org_id}/short",
    context_path = "/api",
    operation_id = "createShortUrl",
    summary = "Create short URL",
    description = "Generates a shortened URL from a longer original URL. This is useful for creating more manageable links for dashboards, reports, or search queries that can be easily shared via email, chat, or documentation. The short URL remains valid and can be used to redirect back to the original destination.",
    request_body(
        content = inline(ShortenUrlRequest),
        description = "The original URL to shorten",
        content_type = "application/json",
        example = json!({
            "original_url": "https://example.com/some/long/url"
        })
    ),
    responses(
        (
            status = 200,
            description = "Shortened URL",
            body = inline(ShortenUrlResponse),
            content_type = "application/json",
            example = json!({
                "short_url": "http://localhost:5080/short/ddbffcea3ad44292"
            })
        ),
        (status = 400, description = "Invalid request", content_type = "application/json")
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "ShortUrl", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    tag = "Short Url"
)]
pub async fn shorten(Path(org_id): Path<String>, Json(req): Json<ShortenUrlRequest>) -> Response {
    match short_url::shorten(&org_id, &req.original_url).await {
        Ok(short_url) => {
            let response = ShortenUrlResponse {
                short_url: short_url.clone(),
            };

            Json(response).into_response()
        }
        Err(e) => {
            log::error!("Failed to shorten URL: {e}");
            map_error_to_http_response(&e.into(), None)
        }
    }
}

#[derive(Deserialize)]
pub struct RetrieveQuery {
    #[serde(rename = "type")]
    pub type_param: Option<String>,
}

/// Retrieve the original URL from a short_id
#[utoipa::path(
    get,
    path = "/{org_id}/short/{short_id}",
    context_path = "/short",
    operation_id = "resolveShortUrl",
    summary = "Resolve short URL",
    description = "Resolves a shortened URL back to its original destination. By default, this endpoint redirects the user to the original URL. When the 'type=ui' query parameter is provided, it returns the original URL as JSON instead of performing a redirect. This is useful for applications that need to inspect or validate URLs before navigation.",
    params(
        ("short_id" = String, Path, description = "The short ID to retrieve the original URL", example = "ddbffcea3ad44292"),
        ("type" = Option<String>, Query, description = "Response type - if 'ui', returns JSON object instead of redirect", example = "ui")
    ),
    responses(
        (status = 302, description = "Redirect to original URL (if < 1024 chars) or /web/short_url/{short_id}", headers(
            ("Location" = String, description = "The original URL or /web/short_url/{short_id} to which the client is redirected")
        )),
        (status = 200, description = "JSON response when type=ui", body = String, content_type = "application/json"),
        (status = 404, description = "Short URL not found", content_type = "text/plain")
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "ShortUrl", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
    tag = "Short Url"
)]
pub async fn retrieve(
    Path((org_id, short_id)): Path<(String, String)>,
    Query(query): Query<RetrieveQuery>,
) -> Response {
    log::info!(
        "short_url::retrieve handler called for org_id: {}, short_id: {}",
        org_id,
        short_id
    );
    let original_url = short_url::retrieve(&short_id).await;

    // Check if type=ui for JSON response
    if let Some(ref type_param) = query.type_param
        && type_param == "ui"
    {
        if let Some(url) = original_url {
            return Json(url).into_response();
        } else {
            return (StatusCode::NOT_FOUND, "").into_response();
        }
    }

    // Here we redirect the legacy short urls to the new short url
    // the redirection then will be handled by the frontend using this flow
    // TODO: Remove this once we are sure there is no more legacy short urls
    if original_url.is_some() {
        let redirect_url = short_url::construct_short_url(&org_id, &short_id);
        RedirectResponseBuilder::new(&redirect_url)
            .build()
            .redirect_http()
    } else {
        let redirect = RedirectResponseBuilder::default().build();
        log::error!("Short URL not found, {}", &redirect);
        redirect.redirect_http()
    }
}
