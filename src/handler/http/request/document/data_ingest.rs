use crate::service::logs;
use actix_web::{post, web, HttpResponse};
use prometheus::GaugeVec;
use std::io::Error;
#[utoipa::path(
        context_path = "/api",
        responses(
            (status = 200, description = "multi ingest api", body = IngestionResponse , example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]}))
        )
    )]
#[post("/{org_id}/_bulk")]
pub async fn bulk_ingest(
    org_id: web::Path<String>,
    body: actix_web::web::Bytes,
    thread_id: web::Data<usize>,
    ingest_stats: web::Data<GaugeVec>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    logs::bulk::ingest(&org_id, body, thread_id, ingest_stats).await
}

#[utoipa::path(
        context_path = "/api",
        responses(
            (status = 200, description = "multi ingest api", body = IngestionResponse , example = json!({"code": 200,"status": [{"name": "olympics","successful": 3,"failed": 0}]}))
        )
    )]
#[post("/{org_id}/{stream_name}/_multi")]
pub async fn multi_ingest(
    path: web::Path<(String, String)>,
    body: actix_web::web::Bytes,
    thread_id: web::Data<usize>,
    ingest_stats: web::Data<GaugeVec>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    logs::multi::ingest(&org_id, &stream_name, body, thread_id, ingest_stats).await
}

#[post("/{org_id}/{stream_name}/_json")]
pub async fn json_ingest(
    path: web::Path<(String, String)>,
    body: actix_web::web::Bytes,
    thread_id: web::Data<usize>,
    ingest_stats: web::Data<GaugeVec>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name) = path.into_inner();
    logs::json::ingest(&org_id, &stream_name, body, thread_id, ingest_stats).await
}
