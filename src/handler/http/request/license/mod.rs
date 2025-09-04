use actix_web::{HttpResponse, get, post, web};
use o2_enterprise::enterprise::license::{
    LICENSE_DB_KEY, License, get_license, ingestion_used, license_expired, search_used,
};
use serde::{Deserialize, Serialize};

use crate::service::db::license;

#[derive(Serialize, Deserialize)]
struct LicenseResponse {
    key: Option<String>,
    license: Option<License>,
    installation_id: String,
    expired: bool,
    search_used: f64,
    ingestion_used: f64,
}

#[derive(Serialize, Deserialize)]
struct SaveLicenseRequest {
    key: String,
}

#[get("/license")]
pub async fn get_license_info() -> HttpResponse {
    let (key, license) = match get_license().await {
        Some((k, l)) => (Some(k), Some(l)),
        None => (None, None),
    };
    let res = LicenseResponse {
        key,
        license,
        installation_id: config::get_instance_id(),
        expired: license_expired().await,
        search_used: search_used() * 100.0, // convert to percentage
        ingestion_used: ingestion_used() * 100.0, // convert tot percentage
    };
    HttpResponse::Ok().json(res)
}

#[post("/license")]
pub async fn store_license(body: web::Bytes) -> HttpResponse {
    let req: SaveLicenseRequest = serde_json::from_slice(&body).unwrap();
    let db = infra::db::get_db().await;
    db.put(LICENSE_DB_KEY, req.key.into(), false, None)
        .await
        .unwrap();
    match license::update().await {
        Ok(_) => HttpResponse::Created().finish(),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({"message":e.to_string()}))
        }
    }
}
