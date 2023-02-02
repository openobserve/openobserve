use crate::{meta, service::metrics};
use actix_web::{http, post, web, HttpRequest, HttpResponse};
use std::io::Error;

#[post("/{org_id}/prometheus/write")]
pub async fn prometheus_write(
    org_id: web::Path<String>,
    thread_id: web::Data<usize>,
    req: HttpRequest,
    body: actix_web::web::Bytes,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    /* for header in _req.headers() {
        println!("{:?}", header)
    } */
    let content_type = req.headers().get("Content-Type").unwrap().to_str().unwrap();
    if content_type.eq("application/x-protobuf") {
        metrics::prometheus_write_proto(&org_id, thread_id, body).await
    } else {
        Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                Some("Bad Request".to_string()),
            )),
        )
    }
    /* else if {
        prom::prometheus_write(&org_id, body).await
    } else if content_type.eq("text/plain") || content_type.eq("application/openmetrics-text") {
        prom::prometheus_write_text(&org_id, body).await
    } */
}
