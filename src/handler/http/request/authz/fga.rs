use std::io::Error;

use actix_web::{get, post, web, HttpResponse};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::dex::meta::auth::O2EntityAuthorization;

#[cfg(feature = "enterprise")]
#[post("/{org_id}/roles")]
pub async fn create_role(
    org_id: web::Path<String>,
    role_id: web::Json<String>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let role_id = role_id.into_inner();

    match o2_enterprise::enterprise::openfga::authorizer::create_role(&role_id, &org_id).await {
        Ok(_) => Ok(HttpResponse::Ok().finish()),
        Err(err) => Ok(HttpResponse::InternalServerError().body(err.to_string())),
    }
}

#[cfg(not(feature = "enterprise"))]
#[post("/{org_id}/roles")]
pub async fn create_role(
    _org_id: web::Path<String>,
    _role_id: web::Json<String>,
) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[get("/{org_id}/roles")]
pub async fn get_roles(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    match o2_enterprise::enterprise::openfga::authorizer::get_all_roles(&org_id).await {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(HttpResponse::InternalServerError().body(err.to_string())),
    }
}

#[cfg(not(feature = "enterprise"))]
#[get("/{org_id}/roles")]
pub async fn get_roles(_org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[post("/{org_id}/roles/{role_id}/permissions")]
pub async fn add_role_permissions(
    path: web::Path<(String, String)>,
    permissions: web::Json<Vec<O2EntityAuthorization>>,
) -> Result<HttpResponse, Error> {
    let (_org_id, role_id) = path.into_inner();
    let permissions = permissions.into_inner();
    match o2_enterprise::enterprise::openfga::authorizer::add_permissions_to_role(
        &role_id,
        permissions,
    )
    .await
    {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(HttpResponse::InternalServerError().body(err.to_string())),
    }
}

#[cfg(not(feature = "enterprise"))]
#[post("/{org_id}/roles/{role_id}/permissions")]
pub async fn add_role_permissions(
    _path: web::Path<(String, String)>,
    _permissions: web::Json<Vec<String>>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[get("/{org_id}/roles/{role_id}/permissions")]
pub async fn get_all_role_permissions(
    path: web::Path<(String, String)>,
) -> Result<HttpResponse, Error> {
    let (org_id, role_id) = path.into_inner();
    match o2_enterprise::enterprise::openfga::authorizer::get_all_role_permissions(
        &org_id, &role_id,
    )
    .await
    {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(HttpResponse::InternalServerError().body(err.to_string())),
    }
}

#[cfg(not(feature = "enterprise"))]
#[get("/{org_id}/roles/{role_id}/permissions")]
pub async fn get_all_role_permissions(
    _path: web::Path<(String, String)>,
) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}
