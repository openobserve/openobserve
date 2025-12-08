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

//! System Settings Types
//!
//! This module defines the types for the multi-level settings system.
//! Settings can be stored at three levels:
//! - System: Global defaults for all organizations
//! - Org: Organization-specific overrides
//! - User: User-specific preferences within an organization
//!
//! Resolution order (most specific wins):
//! 1. User level (if user_id provided)
//! 2. Org level (if org_id provided)
//! 3. System level (global defaults)

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Setting scope levels
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SettingScope {
    /// Global system-level settings (defaults for all orgs)
    System,
    /// Organization-level settings (overrides system defaults)
    Org,
    /// User-level settings within an organization
    User,
}

impl SettingScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            SettingScope::System => "system",
            SettingScope::Org => "org",
            SettingScope::User => "user",
        }
    }
}

impl std::fmt::Display for SettingScope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for SettingScope {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "system" => Ok(SettingScope::System),
            "org" => Ok(SettingScope::Org),
            "user" => Ok(SettingScope::User),
            _ => Err(format!("Invalid setting scope: {}", s)),
        }
    }
}

/// Common setting categories for organizing settings
///
/// NOTE: This enum provides a set of common categories but is not exhaustive.
/// The `setting_category` field in `SystemSetting` is an `Option<String>` to allow
/// for custom categories beyond these predefined ones. Use these constants for
/// consistency when applicable, but feel free to use custom category strings
/// for domain-specific settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SettingCategory {
    /// Correlation and service identity settings
    Correlation,
    /// UI/UX preferences
    Ui,
    /// Alert and notification settings
    Alerts,
    /// Data retention settings
    Retention,
    /// Search settings
    Search,
    /// Ingestion settings
    Ingestion,
    /// General/miscellaneous settings
    General,
}

impl SettingCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            SettingCategory::Correlation => "correlation",
            SettingCategory::Ui => "ui",
            SettingCategory::Alerts => "alerts",
            SettingCategory::Retention => "retention",
            SettingCategory::Search => "search",
            SettingCategory::Ingestion => "ingestion",
            SettingCategory::General => "general",
        }
    }
}

impl std::fmt::Display for SettingCategory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl std::str::FromStr for SettingCategory {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "correlation" => Ok(SettingCategory::Correlation),
            "ui" => Ok(SettingCategory::Ui),
            "alerts" => Ok(SettingCategory::Alerts),
            "retention" => Ok(SettingCategory::Retention),
            "search" => Ok(SettingCategory::Search),
            "ingestion" => Ok(SettingCategory::Ingestion),
            "general" => Ok(SettingCategory::General),
            _ => Err(format!("Invalid setting category: {}", s)),
        }
    }
}

/// Well-known setting keys
pub mod keys {
    /// FQN priority dimensions for service correlation
    pub const FQN_PRIORITY_DIMENSIONS: &str = "fqn_priority_dimensions";
    /// Semantic field groups for dimension extraction
    pub const SEMANTIC_FIELD_GROUPS: &str = "semantic_field_groups";
    /// UI theme preference
    pub const THEME: &str = "theme";
    /// Scrape interval for metrics
    pub const SCRAPE_INTERVAL: &str = "scrape_interval";
    /// Trace ID field name
    pub const TRACE_ID_FIELD_NAME: &str = "trace_id_field_name";
    /// Span ID field name
    pub const SPAN_ID_FIELD_NAME: &str = "span_id_field_name";
    /// Toggle ingestion logs
    pub const TOGGLE_INGESTION_LOGS: &str = "toggle_ingestion_logs";
    /// Streaming aggregation enabled
    pub const STREAMING_AGGREGATION_ENABLED: &str = "streaming_aggregation_enabled";
    /// Enable streaming search
    pub const ENABLE_STREAMING_SEARCH: &str = "enable_streaming_search";
    /// Minimum auto refresh interval
    pub const MIN_AUTO_REFRESH_INTERVAL: &str = "min_auto_refresh_interval";
    /// Light mode theme color
    pub const LIGHT_MODE_THEME_COLOR: &str = "light_mode_theme_color";
    /// Dark mode theme color
    pub const DARK_MODE_THEME_COLOR: &str = "dark_mode_theme_color";
}

/// A system setting record
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SystemSetting {
    /// Unique identifier
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    /// Setting scope (system, org, user)
    pub scope: SettingScope,
    /// Organization ID (required for org/user scope)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub org_id: Option<String>,
    /// User ID (required for user scope)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// Setting key identifier
    pub setting_key: String,
    /// Optional category for grouping
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setting_category: Option<String>,
    /// The setting value (JSON)
    pub setting_value: serde_json::Value,
    /// Optional description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Created timestamp (microseconds)
    #[serde(default)]
    pub created_at: i64,
    /// Updated timestamp (microseconds)
    #[serde(default)]
    pub updated_at: i64,
    /// User who created this setting
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    /// User who last updated this setting
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_by: Option<String>,
}

impl SystemSetting {
    /// Create a new system-level setting
    pub fn new_system(key: impl Into<String>, value: serde_json::Value) -> Self {
        let now = chrono::Utc::now().timestamp_micros();
        Self {
            id: None,
            scope: SettingScope::System,
            org_id: None,
            user_id: None,
            setting_key: key.into(),
            setting_category: None,
            setting_value: value,
            description: None,
            created_at: now,
            updated_at: now,
            created_by: None,
            updated_by: None,
        }
    }

    /// Create a new org-level setting
    pub fn new_org(
        org_id: impl Into<String>,
        key: impl Into<String>,
        value: serde_json::Value,
    ) -> Self {
        let now = chrono::Utc::now().timestamp_micros();
        Self {
            id: None,
            scope: SettingScope::Org,
            org_id: Some(org_id.into()),
            user_id: None,
            setting_key: key.into(),
            setting_category: None,
            setting_value: value,
            description: None,
            created_at: now,
            updated_at: now,
            created_by: None,
            updated_by: None,
        }
    }

    /// Create a new user-level setting
    pub fn new_user(
        org_id: impl Into<String>,
        user_id: impl Into<String>,
        key: impl Into<String>,
        value: serde_json::Value,
    ) -> Self {
        let now = chrono::Utc::now().timestamp_micros();
        Self {
            id: None,
            scope: SettingScope::User,
            org_id: Some(org_id.into()),
            user_id: Some(user_id.into()),
            setting_key: key.into(),
            setting_category: None,
            setting_value: value,
            description: None,
            created_at: now,
            updated_at: now,
            created_by: None,
            updated_by: None,
        }
    }

    /// Set the category for this setting
    pub fn with_category(mut self, category: SettingCategory) -> Self {
        self.setting_category = Some(category.as_str().to_string());
        self
    }

    /// Set the description for this setting
    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    /// Validate the setting based on scope rules
    pub fn validate(&self) -> Result<(), String> {
        match self.scope {
            SettingScope::System => {
                if self.org_id.is_some() || self.user_id.is_some() {
                    return Err("System-level settings cannot have org_id or user_id".to_string());
                }
            }
            SettingScope::Org => {
                if self.org_id.is_none() {
                    return Err("Org-level settings require org_id".to_string());
                }
                if self.user_id.is_some() {
                    return Err("Org-level settings cannot have user_id".to_string());
                }
            }
            SettingScope::User => {
                if self.org_id.is_none() {
                    return Err("User-level settings require org_id".to_string());
                }
                if self.user_id.is_none() {
                    return Err("User-level settings require user_id".to_string());
                }
            }
        }
        Ok(())
    }
}

/// Request to create or update a setting
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SystemSettingPayload {
    /// Setting key
    pub setting_key: String,
    /// Setting value (JSON)
    pub setting_value: serde_json::Value,
    /// Optional category
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setting_category: Option<String>,
    /// Optional description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Query parameters for fetching settings
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SystemSettingQuery {
    /// Filter by specific key
    pub key: Option<String>,
    /// Filter by category
    pub category: Option<String>,
    /// User ID for user-level resolution
    pub user_id: Option<String>,
    /// Include system-level defaults in response
    #[serde(default = "default_include_defaults")]
    pub include_defaults: bool,
}

fn default_include_defaults() -> bool {
    true
}

/// Response containing resolved settings
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ResolvedSettings {
    /// The resolved settings (most specific value for each key)
    pub settings: std::collections::HashMap<String, serde_json::Value>,
    /// Source information for each setting (which level it came from)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sources: Option<std::collections::HashMap<String, SettingScope>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_setting_scope_from_str() {
        assert_eq!(
            "system".parse::<SettingScope>().unwrap(),
            SettingScope::System
        );
        assert_eq!("org".parse::<SettingScope>().unwrap(), SettingScope::Org);
        assert_eq!("user".parse::<SettingScope>().unwrap(), SettingScope::User);
        assert!("invalid".parse::<SettingScope>().is_err());
    }

    #[test]
    fn test_system_setting_validation() {
        // Valid system setting
        let system_setting = SystemSetting::new_system("test_key", serde_json::json!("value"));
        assert!(system_setting.validate().is_ok());

        // Valid org setting
        let org_setting = SystemSetting::new_org("default", "test_key", serde_json::json!("value"));
        assert!(org_setting.validate().is_ok());

        // Valid user setting
        let user_setting = SystemSetting::new_user(
            "default",
            "user@example.com",
            "test_key",
            serde_json::json!("value"),
        );
        assert!(user_setting.validate().is_ok());

        // Invalid: system with org_id
        let mut invalid = SystemSetting::new_system("test_key", serde_json::json!("value"));
        invalid.org_id = Some("default".to_string());
        assert!(invalid.validate().is_err());

        // Invalid: org without org_id
        let mut invalid = SystemSetting::new_org("default", "test_key", serde_json::json!("value"));
        invalid.org_id = None;
        assert!(invalid.validate().is_err());

        // Invalid: user without user_id
        let mut invalid = SystemSetting::new_user(
            "default",
            "user@example.com",
            "test_key",
            serde_json::json!("value"),
        );
        invalid.user_id = None;
        assert!(invalid.validate().is_err());
    }
}
