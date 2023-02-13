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

pub const UI_PAGES: [&str; 9] = [
    "login",
    "about",
    "users",
    "logs",
    "logstream",
    "ingestion",
    "ingestion/fluentbit",
    "ingestion/fluentd",
    "ingestion/vector",
];

#[route("/{path:.*}", method = "GET", method = "HEAD")]
pub async fn serve(path: web::Path<String>) -> EmbedResponse<EmbedableFileResponse> {
    let mut path = if path.is_empty() {
        "index.html"
    } else {
        path.as_str()
    };

    if UI_PAGES.contains(&path) {
        path = "index.html";
    }

    WebAssets::get(path)
        .into_response()
        .use_compression(Compress::Never)
}
