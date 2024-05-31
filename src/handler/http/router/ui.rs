// Copyright 2024 Zinc Labs Inc.
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

use actix_web::{route, web};
use actix_web_rust_embed_responder::{
    Compress, EmbedResponse, EmbedableFileResponse, IntoResponse,
};
use rust_embed_for_web::RustEmbed;

#[derive(RustEmbed)]
#[folder = "web/dist/"]
#[gzip = false]
#[br = false]
struct WebAssets;

#[route("/{path:.*}", method = "GET", method = "HEAD")]
pub async fn serve(path: web::Path<String>) -> EmbedResponse<EmbedableFileResponse> {
    let mut path = path.as_str();

    if !path.starts_with("src/")
        && !path.starts_with("assets/")
        && !path.starts_with("monacoeditorwork/")
        && !path.eq("favicon.ico")
    {
        path = "index.html";
    }

    WebAssets::get(path)
        .into_response()
        .use_compression(Compress::Never)
}

#[cfg(test)]
mod tests {
    use actix_web::{test, App};

    use super::*;

    #[tokio::test]
    async fn test_index_ok() {
        let app = test::init_service(App::new().service(serve)).await;
        let req = test::TestRequest::get().uri("/index.html").to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    #[tokio::test]
    async fn test_index_not_ok() {
        let app = test::init_service(App::new().service(serve)).await;
        let req = test::TestRequest::get().uri("/abc.html").to_request();

        let resp = test::call_service(&app, req).await;
        assert!(!resp.status().is_client_error());
    }
}
