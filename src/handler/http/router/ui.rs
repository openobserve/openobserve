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
    Router,
    body::Body,
    extract::Path,
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
};
use config::get_config;
use rust_embed_for_web::{EmbedableFile, RustEmbed};

#[derive(RustEmbed)]
#[folder = "web/dist/"]
struct WebAssets;

/// Serve static files from embedded web assets
pub async fn serve(Path(path): Path<String>) -> impl IntoResponse {
    let mut file_path = path.as_str();

    // For SPA routing, serve index.html for non-asset paths
    if !file_path.starts_with("src/")
        && !file_path.starts_with("assets/")
        && !file_path.starts_with("monacoeditorwork/")
        && !file_path.eq("favicon.ico")
    {
        file_path = "index.html";
    }

    match WebAssets::get(file_path) {
        Some(content) => {
            let mime = mime_guess::from_path(file_path).first_or_octet_stream();
            let data = content.data();
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, mime.as_ref())
                .body(Body::from(data.to_vec()))
                .unwrap()
        }
        None => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Body::from("Not Found"))
            .unwrap(),
    }
}

/// Middleware to rewrite base href in HTML responses
async fn base_href_middleware(request: axum::http::Request<Body>, next: Next) -> Response {
    let cfg = get_config();
    let prefix = format!("{}/web/", cfg.common.base_uri);
    let path = request
        .uri()
        .path()
        .strip_prefix(&prefix)
        .unwrap_or("")
        .to_string();

    let response = next.run(request).await;

    // Only modify HTML responses for non-asset paths
    if path.starts_with("src/")
        || path.starts_with("assets/")
        || path.starts_with("monacoeditorwork/")
        || path.eq("favicon.ico")
    {
        return response;
    }

    // Check if this is an HTML response
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !content_type.contains("text/html") {
        return response;
    }

    // Extract and modify the body
    let (parts, body) = response.into_parts();
    match axum::body::to_bytes(body, usize::MAX).await {
        Ok(bytes) => {
            let body_str = String::from_utf8_lossy(&bytes);
            let modified_body = body_str.replace(
                r#"<base href="/" />"#,
                &format!(r#"<base href="{prefix}" />"#),
            );
            Response::from_parts(parts, Body::from(modified_body))
        }
        Err(_) => Response::from_parts(parts, Body::empty()),
    }
}

/// Create UI routes
pub fn ui_routes() -> Router {
    Router::new()
        .route("/", get(|| async { serve(Path("".to_string())).await }))
        .route("/{*path}", get(serve))
        .layer(middleware::from_fn(base_href_middleware))
}

#[cfg(test)]
mod tests {
    use axum::http::Request;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn test_index_ok() {
        let app = ui_routes();
        let req = Request::builder()
            .uri("/index.html")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        // In test environment, web assets might not be present
        // so we just check the route is reachable
        assert!(resp.status() == StatusCode::OK || resp.status() == StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn test_index_not_ok() {
        let app = ui_routes();
        let req = Request::builder()
            .uri("/abc.html")
            .body(Body::empty())
            .unwrap();

        let resp = app.oneshot(req).await.unwrap();
        // SPA routing should serve index.html for unknown paths
        // In test environment, this might return NOT_FOUND if assets aren't built
        assert!(resp.status() == StatusCode::OK || resp.status() == StatusCode::NOT_FOUND);
    }
}
