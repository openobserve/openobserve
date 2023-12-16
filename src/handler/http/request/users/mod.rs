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

use actix_web::{delete, get, http, post, put, web, HttpResponse};
use actix_web_httpauth::extractors::basic::BasicAuth;

use crate::{
    common::{
        meta,
        meta::user::{SignInResponse, SignInUser, UpdateUser, UserOrgRole, UserRequest},
    },
    service::users,
};

/// ListUsers
#[utoipa::path(
    context_path = "/api",
    tag = "Users",
    operation_id = "UserList",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = UserList),
    )
)]
#[get("/{org_id}/users")]
pub async fn list(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    users::list_users(&org_id).await
}

/// CreateUser
#[utoipa::path(
    context_path = "/api",
    tag = "Users",
    operation_id = "UserSave",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = UserRequest, description = "User data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/users")]
pub async fn save(
    org_id: web::Path<String>,
    user: web::Json<UserRequest>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let mut user = user.into_inner();
    user.email = user.email.trim().to_string();
    users::post_user(&org_id, user).await
}

/// UpdateUser
#[utoipa::path(
    context_path = "/api",
    tag = "Users",
    operation_id = "UserUpdate",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "User's email id"),
    ),
    request_body(content = UpdateUser, description = "User data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/users/{email_id}")]
pub async fn update(
    params: web::Path<(String, String)>,
    user: web::Json<UpdateUser>,
    credentials: BasicAuth,
) -> Result<HttpResponse, Error> {
    let (org_id, email_id) = params.into_inner();
    let email_id = email_id.trim().to_string();
    let user = user.into_inner();
    if user.eq(&UpdateUser::default()) {
        return Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                "Please specify appropriate fields to update user".to_string(),
            )),
        );
    }
    let initiator_id = credentials.user_id();
    let self_update = credentials.user_id().eq(&email_id);
    users::update_user(&org_id, &email_id, self_update, initiator_id, user).await
}

/// AddUserToOrganization
#[utoipa::path(
    context_path = "/api",
    tag = "Users",
    operation_id = "AddUserToOrg",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "User's email id"),
    ),
    request_body(content = UserOrgRole, description = "User role", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/users/{email_id}")]
pub async fn add_user_to_org(
    params: web::Path<(String, String)>,
    role: web::Json<UserOrgRole>,
    credentials: BasicAuth,
) -> Result<HttpResponse, Error> {
    let (org_id, email_id) = params.into_inner();
    let role = role.into_inner().role;
    let initiator_id = credentials.user_id();
    users::add_user_to_org(&org_id, &email_id, role, initiator_id).await
}

/// RemoveUserFromOrganization
#[utoipa::path(
    context_path = "/api",
    tag = "Users",
    operation_id = "RemoveUserFromOrg",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "User name"),
      ),
    responses(
        (status = 200, description = "Success",  content_type = "application/json", body = HttpResponse),
        (status = 404, description = "NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/users/{email_id}")]
pub async fn delete(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, email_id) = path.into_inner();
    users::remove_user_from_org(&org_id, &email_id).await
}

/// AuthenticateUser
#[utoipa::path(
    context_path = "/auth",
    tag = "Auth",
    operation_id = "UserLoginCheck",
    request_body(content = SignInUser, description = "User login", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SignInResponse),
    )
)]
#[post("/login")]
pub async fn authentication(auth: web::Json<SignInUser>) -> Result<HttpResponse, Error> {
    let mut resp = SignInResponse::default();
    match crate::handler::http::auth::validate_user(&auth.name, &auth.password).await {
        Ok(v) => {
            if v {
                resp.status = true;
            } else {
                resp.status = false;
                resp.message = "Invalid credentials".to_string();
            }
        }
        Err(_e) => {
            resp.status = false;
            resp.message = "Invalid credentials".to_string();
        }
    };
    if resp.status {
        Ok(HttpResponse::Ok().json(resp))
    } else {
        Ok(HttpResponse::Unauthorized().json(resp))
    }
}
