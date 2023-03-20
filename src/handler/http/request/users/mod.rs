// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::{delete, get, http, post, put, web, HttpResponse};
use actix_web_httpauth::extractors::basic::BasicAuth;
use ahash::AHashMap;
use serde_json::Value;
use std::io::Error;

use crate::meta;
use crate::meta::user::SignInUser;
use crate::meta::user::UpdateUser;
use crate::meta::user::UserOrgRole;
use crate::meta::user::UserRequest;
use crate::service::users;

/** List all users of an organization */
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
        (status = 200, description="Success", content_type = "application/json", body = UserList),
    )
)]
#[get("/{org_id}/users")]
pub async fn list(org_id: web::Path<String>) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    users::list_users(&org_id).await
}

/** Create new user for an organization */
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/users")]
pub async fn save(
    org_id: web::Path<String>,
    user: web::Json<UserRequest>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let user = user.into_inner();
    users::post_user(&org_id, user).await
}

/** Update existing user belonging to an organization */
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
    )
)]
#[put("/{org_id}/users/{email_id}")]
pub async fn update(
    params: web::Path<(String, String)>,
    user: web::Json<UpdateUser>,
    credentials: BasicAuth,
) -> Result<HttpResponse, Error> {
    let (org_id, email_id) = params.into_inner();
    let user = user.into_inner();
    if user.eq(&UpdateUser::default()) {
        return Ok(
            HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST.into(),
                Some("Please specify appropriate fields to update user".to_string()),
            )),
        );
    }
    let initiator_id = credentials.user_id();
    let self_update = credentials.user_id().eq(&email_id);
    users::update_user(&org_id, &email_id, self_update, initiator_id, user).await
}

/** Add existing user to an organization */
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
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

/** Remove a user from an organization */
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
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/users/{email_id}")]
pub async fn delete(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, email_id) = path.into_inner();
    users::remove_user_from_org(&org_id, &email_id).await
}

/** Authenticate a user */
#[post("/user")]
pub async fn authentication(user: web::Json<SignInUser>) -> Result<HttpResponse, Error> {
    let mut ret: AHashMap<&str, Value> = AHashMap::new();

    match crate::handler::http::auth::validate_user(&user.name, &user.password).await {
        Ok(v) => {
            if v {
                ret.insert("status", Value::Bool(true));
            } else {
                ret.insert("status", Value::Bool(false));
                ret.insert("message", Value::String("Invalid credentials".to_string()));
            }
        }
        Err(_e) => {
            ret.insert("status", Value::Bool(false));
            ret.insert("message", Value::String("Invalid credentials".to_string()));
        }
    };

    Ok(HttpResponse::Ok().json(ret))
}
