// Copyright 2025 OpenObserve Inc.
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

use actix_web::{HttpResponse, get, post, web};
use o2_enterprise::enterprise::license::{
    LICENSE_DB_KEY, License, check_license, get_license, ingestion_used, license_expired,
    search_used,
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
        ingestion_used: ingestion_used() * 100.0, // convert to percentage
    };
    HttpResponse::Ok().json(res)
}

#[post("/license")]
pub async fn store_license(body: web::Bytes) -> HttpResponse {
    let req: SaveLicenseRequest = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({"message":e.to_string()}));
        }
    };

    let license = match License::load_from_str(&req.key) {
        Ok(l) => l,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({"message":e.to_string()}));
        }
    };

    let (k, license) = match check_license(&req.key, &license).await {
        Ok(v) => v,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({"message":e.to_string()}));
        }
    };

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
