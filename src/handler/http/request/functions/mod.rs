use actix_web::{delete, get, post, web, HttpResponse, Responder};
use std::io::Error;

use crate::{meta::functions::Transform, service::functions};

#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionSave",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Function name"),
    ),
    request_body(content = Transform, description = "Function data", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/functions/{name}")]
pub async fn save_function(
    path: web::Path<(String, String)>,
    js_func: web::Json<Transform>,
) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    let transform = js_func.into_inner();
    functions::register_function(org_id, None, name, transform).await
}

#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionList",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = FunctionList),
    )
)]
#[get("/{org_id}/functions")]
async fn list_functions(org_id: web::Path<String>) -> impl Responder {
    functions::list_functions(org_id.into_inner(), None).await
}

#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionDelete",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("name" = String, Path, description = "Function name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/functions/{name}")]
async fn delete_function(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, name) = path.into_inner();
    functions::delete_function(org_id, None, name).await
}

#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionSaveForStream",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("name" = String, Path, description = "Function name"),
    ),
    request_body(content = Transform, description = "Function data", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 400, description="Failure", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/{stream_name}/functions/{name}")]
pub async fn save_stream_function(
    path: web::Path<(String, String, String)>,
    js_func: web::Json<Transform>,
) -> Result<HttpResponse, Error> {
    let (org_id, stream_name, name) = path.into_inner();
    let transform = js_func.into_inner();
    functions::register_function(org_id, Some(stream_name), name, transform).await
}

#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionListForStream",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = FunctionList),
    )
)]
#[get("/{org_id}/{stream_name}/functions")]
async fn list_stream_function(path: web::Path<(String, String)>) -> impl Responder {
    let (org_id, stream_name) = path.into_inner();
    functions::list_functions(org_id, Some(stream_name)).await
}

#[utoipa::path(
    context_path = "/api",
    tag = "Functions",
    operation_id = "FunctionDeleteForStream",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Stream name"),
        ("name" = String, Path, description = "Function name"),
    ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/{stream_name}/functions/{name}")]
async fn delete_stream_function(path: web::Path<(String, String, String)>) -> impl Responder {
    let (org_id, stream_name, name) = path.into_inner();
    functions::delete_function(org_id, Some(stream_name), name).await
}
