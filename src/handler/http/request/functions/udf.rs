use actix_web::{delete, get, post, web, HttpResponse, Responder};
use std::io::Error;

use crate::{meta::transform::Transform, service::transform};

#[post("/{org_id}/functions/{name}")]
pub async fn save_function(
    path: web::Path<(String, String)>,
    js_func: web::Json<Transform>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let transform = js_func.into_inner();
    transform::register_transform(org_id, None, name, transform).await
}

#[get("/{org_id}/functions")]
async fn list_functions(org_id: web::Path<String>) -> impl Responder {
    transform::list_transform(org_id.into_inner(), None).await
}

#[delete("/{org_id}/functions/{name}")]
async fn delete_function(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    transform::delete_transform(org_id, None, name).await
}

#[post("/{org_id}/{stream_name}/functions/{name}")]
pub async fn save_stream_function(
    path: web::Path<(String, String, String)>,
    js_func: web::Json<Transform>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name, name) = path.into_inner();
    let transform = js_func.into_inner();
    transform::register_transform(org_id, Some(stream_name), name, transform).await
}

#[get("/{org_id}/{stream_name}/functions")]
async fn list_stream_function(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, stream_name) = path.into_inner();
    transform::list_transform(org_id, Some(stream_name)).await
}

#[delete("/{org_id}/{stream_name}/functions/{name}")]
async fn delete_stream_function(path: web::Path<(String, String, String)>) -> impl Responder {
    let (org_id, stream_name, name) = path.into_inner();
    transform::delete_transform(org_id, Some(stream_name), name).await
}
