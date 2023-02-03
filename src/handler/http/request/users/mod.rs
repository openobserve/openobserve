use crate::handler::http::auth::validate_credentials;
use crate::infra::config::CONFIG;
use crate::meta::user::SignInUser;
use crate::meta::user::UserRole;
use crate::{meta::user::User, service::users};
use actix_web::{delete, get, post, web, HttpResponse};
use ahash::AHashMap;
use serde_json::Value;
use std::io::Error;

#[utoipa::path(
    context_path = "/api",
    tag = "User",
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
    users::list_user(&org_id).await
}

#[utoipa::path(
    context_path = "/api",
    tag = "User",
    operation_id = "UserSave",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = User, description = "User data", content_type = "application/json"),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
    )
)]
#[post("/{org_id}/users")]
pub async fn save(org_id: web::Path<String>, user: web::Json<User>) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let user = user.into_inner();
    users::post_user(&org_id, user).await
}

#[utoipa::path(
    context_path = "/api",
    tag = "User",
    operation_id = "UserDelete",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("user_name" = String, Path, description = "User name"),
      ),
    responses(
        (status = 200, description="Success", content_type = "application/json", body = HttpResponse),
        (status = 404, description="NotFound", content_type = "application/json", body = HttpResponse),
    )
)]
#[delete("/{org_id}/users/{user_name}")]
pub async fn delete(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org_id, name) = path.into_inner();
    users::delete_user(&org_id, &name).await
}

#[post("/{org_id}/authentication")]
pub async fn authentication(
    org_id: web::Path<String>,
    user: web::Json<SignInUser>,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let mut ret: AHashMap<&str, Value> = AHashMap::new();
    match validate_credentials(
        &user.name,
        &user.password,
        &format!("{}/authentication", &org_id),
    )
    .await
    {
        Ok(v) => {
            if v {
                if user.name == CONFIG.auth.username {
                    ret.insert("role", Value::String(format!("{:?}", &UserRole::Admin)));
                } else if let Some(user) = users::get_user(Some(&org_id), &user.name).await {
                    // println!("{:?}", format!("{:?}", user.role));
                    ret.insert("role", Value::String(format!("{:?}", user.role)));
                }
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
