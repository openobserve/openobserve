use actix_web::{delete, get, post, put, web, HttpRequest, HttpResponse};
use std::io::Error;

#[post("/{org_id}/dashboard/annotations")]
pub async fn create_annotations(path: web::Path<String>) -> Result<HttpResponse, Error> {
    let _org_id = path.into_inner();
    todo!()
}

#[get("/{org_id}/dashboard/annotations")]
pub async fn list_annotations(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let _org_id = path.into_inner();
    todo!()
}

#[delete("/{org_id}/dashboard/annotations")]
pub async fn delete_annotations(path: web::Path<String>, body: web::Bytes) -> Result<HttpResponse, Error> {
    let _org_id = path.into_inner();
    todo!()
}
