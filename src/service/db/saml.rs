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

use config::{meta::saml::SamlConfig, utils::json};
use infra::errors::{Error, Result};

use crate::service::db;

/// Database key prefix for SAML configuration
pub const SAML_CONFIG_KEY: &str = "/saml/config";

/// Get SAML configuration from database or environment variables
pub async fn get() -> Result<SamlConfig> {
    // Try to get from database first
    match db::get(SAML_CONFIG_KEY).await {
        Ok(data) => {
            let config: SamlConfig = json::from_slice(&data)?;
            Ok(config)
        }
        Err(_) => {
            // Fall back to environment variables
            let cfg = config::get_config();
            Ok(SamlConfig {
                enabled: cfg.auth.saml_enabled,
                sp_entity_id: cfg.auth.saml_sp_entity_id.clone(),
                acs_url: cfg.auth.saml_acs_url.clone(),
                idp_metadata_xml: cfg.auth.saml_idp_metadata_xml.clone(),
                default_org: cfg.auth.saml_default_org.clone(),
                default_role: cfg.auth.saml_default_role.clone(),
                email_attribute: cfg.auth.saml_email_attribute.clone(),
                name_attribute: cfg.auth.saml_name_attribute.clone(),
                allow_idp_initiated: true,
            })
        }
    }
}

/// Set SAML configuration in database
pub async fn set(config: &SamlConfig) -> Result<()> {
    let data = json::to_vec(config)?;
    db::put(SAML_CONFIG_KEY, data.into(), db::NEED_WATCH, None).await
}

/// Delete SAML configuration from database
pub async fn delete() -> Result<()> {
    db::delete(SAML_CONFIG_KEY, false, db::NEED_WATCH, None).await
}

/// Check if SAML is enabled (from DB or env vars)
pub async fn is_enabled() -> bool {
    match get().await {
        Ok(config) => config.enabled,
        Err(_) => config::get_config().auth.saml_enabled,
    }
}
