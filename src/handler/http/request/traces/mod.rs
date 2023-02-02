use crate::{meta, service::traces::otlp_http};
use actix_web::{http, post, web, HttpRequest, HttpResponse};

use std::io::Error;

pub const CONTENT_TYPE_JSON: &str = "application/json";
pub const CONTENT_TYPE_PROTO: &str = "application/x-protobuf";

#[post("/{org_id}/traces")]
pub async fn traces_write(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: actix_web::web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let content_type = req.headers().get("Content-Type").unwrap().to_str().unwrap();
    if content_type.eq(CONTENT_TYPE_PROTO) {
        otlp_http::traces_proto(&org_id, thread_id.into_inner(), body).await
    } else if content_type.eq(CONTENT_TYPE_JSON) {
        otlp_http::traces_json(&org_id, thread_id.into_inner(), body).await
    } else {
        Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                Some("Bad Request".to_string()),
            )),
        )
    }
}
