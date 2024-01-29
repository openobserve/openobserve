// Copyright 2023 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.
use std::io::Error;

use actix_web::{get, post, put, web, HttpResponse};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::dex::meta::auth::RolePermissionRequest;

use crate::common::meta::user::{UserGroup, UserGroupRequest, UserRoleRequest};

#[cfg(feature = "enterprise")]
#[post("/{org_id}/roles")]
pub async fn create_role(
    org_id: web::Path<String>,
    user_req: web::Json<UserRoleRequest>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let user_req = user_req.into_inner();

    match o2_enterprise::enterprise::openfga::authorizer::create_role(&user_req.name, &org_id).await
    {
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
#[put("/{org_id}/roles/{role_id}/permissions")]
pub async fn update_role_permissions(
    path: web::Path<(String, String)>,
    permissions: web::Json<RolePermissionRequest>,
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
pub async fn update_role_permissions(
    _path: web::Path<(String, String)>,
    _permissions: web::Json<String>,
) -> Result<HttpResponse, actix_web::Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[get("/{org_id}/roles/{role_id}/permissions/{resource}")]
pub async fn get_role_permissions(
    path: web::Path<(String, String, String)>,
) -> Result<HttpResponse, Error> {
    let (org_id, role_id, resource) = path.into_inner();
    match o2_enterprise::enterprise::openfga::authorizer::get_role_permissions(
        &org_id, &role_id, &resource,
    )
    .await
    {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(HttpResponse::InternalServerError().body(err.to_string())),
    }
}

#[cfg(not(feature = "enterprise"))]
#[get("/{org_id}/roles/{role_id}/permissions/{resource}")]
pub async fn get_role_permissions(
    _path: web::Path<(String, String)>,
) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[post("/{org_id}/groups")]
pub async fn create_group(
    org_id: web::Path<String>,
    user_group: web::Json<UserGroup>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let user_grp = user_group.into_inner();

    match o2_enterprise::enterprise::openfga::authorizer::create_group(
        &org_id,
        &user_grp.name,
        user_grp.users.unwrap_or_default(),
    )
    .await
    {
        Ok(_) => Ok(HttpResponse::Ok().finish()),
        Err(err) => Ok(HttpResponse::InternalServerError().body(err.to_string())),
    }
}

#[cfg(not(feature = "enterprise"))]
#[post("/{org_id}/groups")]
pub async fn create_group(
    _org_id: web::Path<String>,
    _user_group: web::Json<UserGroup>,
) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[put("/{org_id}/groups/{group_name}")]
pub async fn update_group(
    path: web::Path<(String, String)>,
    user_group: web::Json<UserGroupRequest>,
) -> Result<HttpResponse, Error> {
    let (org_id, group_name) = path.into_inner();
    let user_grp = user_group.into_inner();

    match o2_enterprise::enterprise::openfga::authorizer::update_group(
        &org_id,
        &group_name,
        user_grp.add_users,
        user_grp.remove_users,
        user_grp.add_roles,
        user_grp.remove_roles,
    )
    .await
    {
        Ok(_) => Ok(HttpResponse::Ok().finish()),
        Err(err) => Ok(HttpResponse::InternalServerError().body(err.to_string())),
    }
}

#[cfg(not(feature = "enterprise"))]
#[put("/{org_id}/groups/{group_name}")]
pub async fn update_group(
    _org_id: web::Path<String>,
    _user_group: web::Json<UserGroupRequest>,
) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[get("/{org_id}/groups")]
pub async fn get_groups(path: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = path.into_inner();

    match o2_enterprise::enterprise::openfga::authorizer::get_all_groups(&org_id).await {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(HttpResponse::InternalServerError().body(err.to_string())),
    }
}

#[cfg(not(feature = "enterprise"))]
#[get("/{org_id}/groups")]
pub async fn get_groups(_path: web::Path<String>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[get("/{org_id}/groups/{group_name}")]
pub async fn get_group_details(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (_org_id, group_name) = path.into_inner();

    match o2_enterprise::enterprise::openfga::authorizer::get_group_details(&group_name).await {
        Ok(res) => Ok(HttpResponse::Ok().json(res)),
        Err(err) => Ok(HttpResponse::InternalServerError().body(err.to_string())),
    }
}

#[cfg(not(feature = "enterprise"))]
#[get("/{org_id}/groups/{group_name}")]
pub async fn get_group_details(_path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}

#[cfg(feature = "enterprise")]
#[get("/{org_id}/resources")]
pub async fn get_resources(_org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let resources = o2_enterprise::enterprise::openfga::meta::mapping::OFGA_MODELS
        .values()
        .collect::<Vec<&&str>>();
    Ok(HttpResponse::Ok().json(resources))
}

#[cfg(not(feature = "enterprise"))]
#[get("/{org_id}/resources")]
pub async fn get_resources(_org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    Ok(HttpResponse::Forbidden().json("Not Supported"))
}
