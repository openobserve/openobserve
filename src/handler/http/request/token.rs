use std::io::Error;

use actix_web::{get, HttpResponse};

use crate::common::utils::{json, jwt};

#[get("/jwks")]
pub async fn get_jwks() -> Result<HttpResponse, Error> {
    let jwks = jwt::get_jwks().await;
    let resp: json::Value = json::from_str(&jwks).unwrap();
    Ok(HttpResponse::Ok().json(resp))
}
