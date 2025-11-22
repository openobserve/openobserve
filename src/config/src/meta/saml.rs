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

use serde::{Deserialize, Serialize};

/// SAML Configuration stored in database
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct SamlConfig {
    /// Enable/disable SAML authentication
    #[serde(default)]
    pub enabled: bool,

    /// Service Provider Entity ID (unique identifier for OpenObserve)
    #[serde(default)]
    pub sp_entity_id: String,

    /// Assertion Consumer Service URL (callback URL)
    #[serde(default)]
    pub acs_url: String,

    /// Identity Provider metadata XML
    #[serde(default)]
    pub idp_metadata_xml: String,

    /// Default organization for new SAML users
    #[serde(default = "default_org")]
    pub default_org: String,

    /// Default role for new SAML users (admin, editor, viewer)
    #[serde(default = "default_role")]
    pub default_role: String,

    /// SAML attribute name for email
    #[serde(default = "default_email_attr")]
    pub email_attribute: String,

    /// SAML attribute name for display name
    #[serde(default = "default_name_attr")]
    pub name_attribute: String,

    /// Allow IdP-initiated login
    #[serde(default = "default_true")]
    pub allow_idp_initiated: bool,
}

impl Default for SamlConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            sp_entity_id: String::new(),
            acs_url: String::new(),
            idp_metadata_xml: String::new(),
            default_org: default_org(),
            default_role: default_role(),
            email_attribute: default_email_attr(),
            name_attribute: default_name_attr(),
            allow_idp_initiated: true,
        }
    }
}

fn default_org() -> String {
    "default".to_string()
}

fn default_role() -> String {
    "admin".to_string()
}

fn default_email_attr() -> String {
    "email".to_string()
}

fn default_name_attr() -> String {
    "name".to_string()
}

fn default_true() -> bool {
    true
}

/// Request to update SAML configuration
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct UpdateSamlConfigRequest {
    pub enabled: Option<bool>,
    pub sp_entity_id: Option<String>,
    pub acs_url: Option<String>,
    pub idp_metadata_xml: Option<String>,
    pub default_org: Option<String>,
    pub default_role: Option<String>,
    pub email_attribute: Option<String>,
    pub name_attribute: Option<String>,
    pub allow_idp_initiated: Option<bool>,
}
