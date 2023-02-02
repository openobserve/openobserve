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
