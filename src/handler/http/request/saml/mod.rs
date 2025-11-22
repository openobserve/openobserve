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

use std::io::Error;

use actix_web::{HttpResponse, delete, get, http, put, web};
use config::meta::saml::{SamlConfig, UpdateSamlConfigRequest};

use crate::{
    common::meta,
    service::db::saml as saml_db,
};

/// GetSamlConfig
#[utoipa::path(
    context_path = "/api",
    tag = "SAML",
    operation_id = "GetSamlConfig",
    summary = "Get SAML configuration",
    description = "Retrieves the current SAML authentication configuration from the database. \
                   Returns SAML settings including IdP metadata, SP configuration, and user provisioning defaults.",
    security(
        ("Authorization"= [])
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SamlConfig),
        (status = 404, description = "Not found"),
    )
)]
#[get("/saml/config")]
pub async fn get_config() -> Result<HttpResponse, Error> {
    match saml_db::get().await {
        Ok(config) => Ok(HttpResponse::Ok().json(config)),
        Err(e) => {
            log::error!("Error getting SAML config: {}", e);
            Ok(HttpResponse::NotFound().json(meta::http::HttpResponse::error(
                http::StatusCode::NOT_FOUND,
                "SAML configuration not found".to_string(),
            )))
        }
    }
}

/// UpdateSamlConfig
#[utoipa::path(
    context_path = "/api",
    tag = "SAML",
    operation_id = "UpdateSamlConfig",
    summary = "Update SAML configuration",
    description = "Updates the SAML authentication configuration. Allows partial updates - only specified fields \
                   will be modified. Requires admin privileges. Changes take effect immediately without requiring \
                   application restart.",
    security(
        ("Authorization"= [])
    ),
    request_body(
        content = inline(UpdateSamlConfigRequest),
        description = "SAML configuration update",
        content_type = "application/json"
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SamlConfig),
        (status = 400, description = "Bad request"),
    )
)]
#[put("/saml/config")]
pub async fn update_config(
    req: web::Json<UpdateSamlConfigRequest>,
) -> Result<HttpResponse, Error> {
    // Get current config or create default
    let mut config = saml_db::get().await.unwrap_or_default();

    // Update only provided fields
    if let Some(enabled) = req.enabled {
        config.enabled = enabled;
    }
    if let Some(sp_entity_id) = &req.sp_entity_id {
        config.sp_entity_id = sp_entity_id.clone();
    }
    if let Some(acs_url) = &req.acs_url {
        config.acs_url = acs_url.clone();
    }
    if let Some(idp_metadata_xml) = &req.idp_metadata_xml {
        config.idp_metadata_xml = idp_metadata_xml.clone();
    }
    if let Some(default_org) = &req.default_org {
        config.default_org = default_org.clone();
    }
    if let Some(default_role) = &req.default_role {
        config.default_role = default_role.clone();
    }
    if let Some(email_attribute) = &req.email_attribute {
        config.email_attribute = email_attribute.clone();
    }
    if let Some(name_attribute) = &req.name_attribute {
        config.name_attribute = name_attribute.clone();
    }
    if let Some(allow_idp_initiated) = req.allow_idp_initiated {
        config.allow_idp_initiated = allow_idp_initiated;
    }

    // Validate required fields if enabled
    if config.enabled {
        if config.sp_entity_id.is_empty() {
            return Ok(HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                "SP Entity ID is required when SAML is enabled".to_string(),
            )));
        }
        if config.acs_url.is_empty() {
            return Ok(HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                "ACS URL is required when SAML is enabled".to_string(),
            )));
        }
        if config.idp_metadata_xml.is_empty() {
            return Ok(HttpResponse::BadRequest().json(meta::http::HttpResponse::error(
                http::StatusCode::BAD_REQUEST,
                "IdP metadata XML is required when SAML is enabled".to_string(),
            )));
        }
    }

    // Save to database
    match saml_db::set(&config).await {
        Ok(_) => {
            log::info!("SAML configuration updated successfully");
            Ok(HttpResponse::Ok().json(config))
        }
        Err(e) => {
            log::error!("Error saving SAML config: {}", e);
            Ok(HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to save SAML configuration: {}", e),
            )))
        }
    }
}

/// DeleteSamlConfig
#[utoipa::path(
    context_path = "/api",
    tag = "SAML",
    operation_id = "DeleteSamlConfig",
    summary = "Delete SAML configuration",
    description = "Deletes the SAML configuration from the database and disables SAML authentication. \
                   This will fall back to environment variable configuration if present, or disable SAML entirely. \
                   Requires admin privileges.",
    security(
        ("Authorization"= [])
    ),
    responses(
        (status = 200, description = "Success"),
        (status = 500, description = "Internal error"),
    )
)]
#[delete("/saml/config")]
pub async fn delete_config() -> Result<HttpResponse, Error> {
    match saml_db::delete().await {
        Ok(_) => {
            log::info!("SAML configuration deleted successfully");
            Ok(HttpResponse::Ok().json(meta::http::HttpResponse::message(
                http::StatusCode::OK.as_u16(),
                "SAML configuration deleted successfully".to_string(),
            )))
        }
        Err(e) => {
            log::error!("Error deleting SAML config: {}", e);
            Ok(HttpResponse::InternalServerError().json(meta::http::HttpResponse::error(
                http::StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to delete SAML configuration: {}", e),
            )))
        }
    }
}
