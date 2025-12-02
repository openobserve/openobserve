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
    LICENSE_DB_KEY, License, check_license, get_license, ingestion_limit_exceeded_count,
    ingestion_used, license_expired,
};
use serde::{Deserialize, Serialize};

use crate::{
    common::utils::auth::UserEmail, handler::http::extractors::Headers, service::db::license,
};

#[derive(Serialize, Deserialize)]
struct LicenseResponse {
    key: Option<String>,
    license: Option<License>,
    installation_id: String,
    expired: bool,
    ingestion_used: f64,
    ingestion_exceeded: u8,
}

struct SaveLicenseRequest {
    key: License,
    raw_key: String,
}

impl<'de> Deserialize<'de> for SaveLicenseRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Helper {
            key: String,
        }

        let helper = Helper::deserialize(deserializer)?;
        let license = License::load_from_str(&helper.key).map_err(serde::de::Error::custom)?;

        Ok(SaveLicenseRequest {
            key: license,
            raw_key: helper.key,
        })
    }
}

async fn check_license_permission(user_id: &str, method: &str) -> Result<(), anyhow::Error> {
    use o2_openfga::meta::mapping::OFGA_MODELS;

    use crate::{
        common::utils::auth::{AuthExtractor, is_root_user},
        service::users::get_user,
    };

    if !is_root_user(user_id) {
        let user = match get_user(Some("_meta"), user_id).await {
            Some(v) => v,
            None => return Err(anyhow::anyhow!("Unauthorized access to license")),
        };
        if !crate::handler::http::auth::validator::check_permissions(
            user_id,
            AuthExtractor {
                auth: "".to_string(),
                method: method.to_string(),
                o2_type: format!(
                    "{}:_all__meta",
                    OFGA_MODELS
                        .get("license")
                        .map_or("license", |model| model.key),
                ),
                org_id: "_meta".to_string(),
                bypass_check: false,
                parent_id: "".to_string(),
            },
            user.role,
            user.is_external,
        )
        .await
        {
            return Err(anyhow::anyhow!("Unauthorized Access to license"));
        }
    }
    Ok(())
}

#[get("/license")]
pub async fn get_license_info(Headers(_email): Headers<UserEmail>) -> HttpResponse {
    // we want anyone to be able to see the license info, so we bypass
    // all the permission checks here.
    let (key, license) = match get_license().await {
        Some((k, l)) => (Some(k), Some(l)),
        None => (None, None),
    };
    let res = LicenseResponse {
        key,
        license,
        installation_id: config::get_instance_id(),
        expired: license_expired().await,
        ingestion_exceeded: ingestion_limit_exceeded_count(),
        ingestion_used: ingestion_used() * 100.0, // convert to percentage
    };
    HttpResponse::Ok().json(res)
}

#[post("/license")]
pub async fn store_license(
    web::Json(req): web::Json<SaveLicenseRequest>,
    Headers(user_email): Headers<UserEmail>,
) -> HttpResponse {
    let email = user_email.user_id;
    if check_license_permission(&email, "PUT").await.is_err() {
        return HttpResponse::Forbidden().json("Unauthorized Access to license");
    }

    if let Err(e) = check_license(&req.key).await {
        return HttpResponse::BadRequest().json(serde_json::json!({"message":e.to_string()}));
    };

    let db = infra::db::get_db().await;
    db.put(LICENSE_DB_KEY, req.raw_key.into(), false, None)
        .await
        .unwrap();
    match license::update().await {
        Ok(_) => HttpResponse::Created().finish(),
        Err(e) => {
            HttpResponse::InternalServerError().json(serde_json::json!({"message":e.to_string()}))
        }
    }
}
