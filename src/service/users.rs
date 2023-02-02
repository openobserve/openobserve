use actix_web::{
    http::{self, StatusCode},
    HttpResponse,
};
use std::io::Error;
use uuid::Uuid;

use crate::infra::config::USERS;
use crate::meta::user::{User, UserList, UserResponse};
use crate::{common::auth::get_hash, meta::http::HttpResponse as MetaHttpResponse};

use super::db;

pub async fn post_user(org_id: &str, mut user: User) -> Result<HttpResponse, Error> {
    let salt = Uuid::new_v4().to_string();
    user.password = get_hash(&user.password, &salt);
    user.salt = salt;
    db::user::set(org_id, user).await.unwrap();
    Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
        http::StatusCode::OK.into(),
        "User saved successfully".to_string(),
    )))
}

pub async fn get_user(org_id: Option<&str>, name: &str) -> Option<User> {
    let mut local_org = "";
    let user_key = match org_id {
        Some(org) => {
            local_org = org;
            format!("{}/{}", org, name)
        }
        None => name.to_owned(),
    };
    let user = USERS.get(&user_key);
    match user {
        Some(loc_user) => Some(loc_user.value().clone()),
        None => {
            let res = db::user::get(Some(local_org), name).await;
            if res.is_err() {
                None
            } else {
                res.unwrap()
            }
        }
    }
}

pub async fn list_user(org_id: &str) -> Result<HttpResponse, Error> {
    let mut user_list: Vec<UserResponse> = vec![];
    for user in USERS.iter() {
        if user.key().contains(org_id) {
            user_list.push(UserResponse {
                name: user.value().name.clone(),
                role: user.value().role.clone(),
            })
        }
    }
    Ok(HttpResponse::Ok().json(UserList { list: user_list }))
}

pub async fn delete_user(org_id: &str, name: &str) -> Result<HttpResponse, Error> {
    let result = db::user::delete(org_id, name).await;
    match result {
        Ok(_) => Ok(HttpResponse::Ok().json(MetaHttpResponse::message(
            http::StatusCode::OK.into(),
            "User deleted".to_string(),
        ))),
        Err(err) => Ok(HttpResponse::NotFound().json(MetaHttpResponse::error(
            StatusCode::NOT_FOUND.into(),
            Some(err.to_string()),
        ))),
    }
}
