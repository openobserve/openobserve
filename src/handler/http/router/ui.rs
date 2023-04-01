// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::{route, web};
use actix_web_rust_embed_responder::{
    Compress, EmbedResponse, EmbedableFileResponse, IntoResponse,
};
use rust_embed_for_web::RustEmbed;

#[derive(RustEmbed)]
#[folder = "web/dist/"]
struct WebAssets;

#[route("/{path:.*}", method = "GET", method = "HEAD")]
pub async fn serve(path: web::Path<String>) -> EmbedResponse<EmbedableFileResponse> {
    let mut path = path.as_str();

    if !path.starts_with("src/") && !path.starts_with("assets/") && !path.eq("favicon.ico") {
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

    #[actix_web::test]
    async fn test_index_ok() {
        let app = test::init_service(App::new().service(serve)).await;
        let req = test::TestRequest::get().uri("/index.html").to_request();

        let resp = test::call_service(&app, req).await;
        assert!(resp.status().is_success());
    }

    #[actix_web::test]
    async fn test_index_not_ok() {
        let app = test::init_service(App::new().service(serve)).await;
        let req = test::TestRequest::get().uri("/abc.html").to_request();

        let resp = test::call_service(&app, req).await;
        assert!(!resp.status().is_client_error());
    }
}
