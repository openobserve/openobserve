// Copyright 2026 OpenObserve Inc.
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

use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;

use crate::stats::MemorySize;

/// Deserializes an optional i32, accepting null, integer, or empty string (as None).
fn deserialize_optional_i32<'de, D>(deserializer: D) -> Result<Option<i32>, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Ok(Some(i as i32))
            } else if let Some(f) = n.as_f64() {
                Ok(Some(f.round() as i32))
            } else {
                Err(serde::de::Error::custom("invalid number for i32"))
            }
        }
        serde_json::Value::String(s) if s.is_empty() => Ok(None),
        serde_json::Value::String(s) => s.parse::<i32>().map(Some).map_err(|_| {
            serde::de::Error::custom(format!("invalid value for time_window_minutes: '{s}'"))
        }),
        _ => Err(serde::de::Error::custom("expected null, number, or string")),
    }
}

/// Organization-level deduplication configuration (Global settings)
///
/// This configuration is stored at the organization level and defines:
/// - Whether deduplication is enabled globally
/// - Semantic field groups that map field name variations to canonical dimensions
/// - Cross-alert deduplication based on shared semantic dimensions
/// - Default time window for deduplication
///
/// Per-alert fingerprint fields are stored in the Alert.deduplication field.
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Default)]
#[serde(default)]
pub struct GlobalDeduplicationConfig {
    /// Enable/disable deduplication globally for this organization
    #[serde(default)]
    pub enabled: bool,

    /// Enable cross-alert deduplication based on shared semantic dimensions
    ///
    /// When true, alerts from DIFFERENT alert rules that share semantic dimensions
    /// will be deduplicated if one already fired recently.
    ///
    /// Example:
    /// - Alert A fires: {host: "srv01", service: "api"}
    /// - Alert B fires 30s later: {host: "srv01", region: "us-east"}
    /// - If cross_alert_dedup=true: Alert B suppressed (shares "host" dimension)
    /// - If cross_alert_dedup=false: Both sent (per-alert dedup only)
    #[serde(default)]
    pub alert_dedup_enabled: bool,

    /// Semantic group IDs to use for cross-alert fingerprinting
    ///
    /// When cross_alert_dedup is enabled, these semantic group IDs are used
    /// to generate fingerprints across all alerts (instead of per-alert fingerprint_fields).
    /// Must reference IDs from semantic field groups (stored in system_settings).
    ///
    /// Example: ["host", "service"] means fingerprint = hash(host_value + service_value)
    /// Required when cross_alert_dedup is true.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alert_fingerprint_groups: Vec<String>,

    /// Default time window in minutes for deduplication
    ///
    /// Alerts with the same fingerprint within this window are suppressed.
    /// If None, defaults to 2x the alert evaluation frequency.
    /// Can be overridden per-alert.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_i32"
    )]
    pub time_window_minutes: Option<i32>,

    /// Time window for hierarchical incident upgrade (minutes)
    /// Incidents created within this window can be upgraded from weak to strong correlation keys.
    #[serde(default = "default_upgrade_window")]
    pub upgrade_window_minutes: u64,
}

fn default_upgrade_window() -> u64 {
    30
}

/// Per-alert deduplication configuration (from main branch)
///
/// This is stored on each Alert and specifies which fields to use for fingerprinting.
/// This matches the structure from the main branch exactly.
/// Configuration for alert deduplication
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Default)]
#[serde(default)]
pub struct DeduplicationConfig {
    /// Enable/disable deduplication
    #[serde(default)]
    pub enabled: bool,

    /// Fields from query results to use for fingerprinting
    /// If empty, auto-detect based on query type:
    /// - Custom: Fields from query conditions
    /// - SQL: GROUP BY columns
    /// - PromQL: All label dimensions
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fingerprint_fields: Vec<String>,

    /// Time window in minutes for deduplication
    /// If None, defaults to 2x alert frequency
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_i32"
    )]
    pub time_window_minutes: Option<i32>,

    /// Optional alert grouping configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grouping: Option<GroupingConfig>,
}

impl MemorySize for DeduplicationConfig {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<DeduplicationConfig>() + self.fingerprint_fields.mem_size()
    }
}

/// Configuration for alert grouping
#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct GroupingConfig {
    /// Enable alert grouping
    #[serde(default)]
    pub enabled: bool,

    /// Maximum number of alerts in a single group
    #[serde(default = "default_max_group_size")]
    pub max_group_size: usize,

    /// How to send grouped notifications
    #[serde(default)]
    pub send_strategy: SendStrategy,

    /// Initial wait time before sending first notification (seconds)
    #[serde(default = "default_group_wait")]
    pub group_wait_seconds: i64,
}

impl MemorySize for GroupingConfig {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<GroupingConfig>()
    }
}

impl Default for GroupingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            max_group_size: default_max_group_size(),
            send_strategy: SendStrategy::default(),
            group_wait_seconds: default_group_wait(),
        }
    }
}

/// Strategy for sending grouped alert notifications
#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SendStrategy {
    /// Send only the first alert with a count of others
    #[default]
    #[serde(rename = "first_with_count")]
    FirstWithCount,

    /// Send an aggregated summary of all alerts
    Summary,

    /// Send all alerts in one notification
    All,
}

impl std::str::FromStr for SendStrategy {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "first_with_count" => Ok(Self::FirstWithCount),
            "summary" => Ok(Self::Summary),
            "all" => Ok(Self::All),
            _ => Ok(Self::default()),
        }
    }
}

fn default_max_group_size() -> usize {
    100
}

fn default_group_wait() -> i64 {
    30
}

impl GlobalDeduplicationConfig {
    /// Validate the organization-level deduplication configuration
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }

        // Require at least one fingerprint group when cross-alert dedup is enabled
        if self.alert_dedup_enabled && self.alert_fingerprint_groups.is_empty() {
            return Err(
                "cross_alert_fingerprint_groups is required when cross_alert_dedup is enabled"
                    .to_string(),
            );
        }

        Ok(())
    }

    pub fn default_with_presets() -> Self {
        Self {
            enabled: false,
            alert_dedup_enabled: false,
            alert_fingerprint_groups: vec![],
            time_window_minutes: None,
            upgrade_window_minutes: default_upgrade_window(),
        }
    }
}

impl DeduplicationConfig {
    /// Validate the per-alert deduplication configuration
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }

        // Fingerprint fields can be empty (will auto-detect)
        if self.fingerprint_fields.len() > 10 {
            return Err("Maximum 10 fingerprint fields allowed per alert".to_string());
        }

        // Time window must be positive if set
        if let Some(window) = self.time_window_minutes
            && window <= 0
        {
            return Err("Time window must be positive".to_string());
        }

        // Validate grouping config if present
        if let Some(grouping) = &self.grouping
            && grouping.enabled
        {
            if grouping.max_group_size == 0 {
                return Err("Max group size must be at least 1".to_string());
            }
            if grouping.group_wait_seconds < 0 {
                return Err("Group wait seconds must be non-negative".to_string());
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_per_alert_deduplication_config_default() {
        let config = DeduplicationConfig::default();
        assert!(!config.enabled);
        assert!(config.fingerprint_fields.is_empty());
        assert_eq!(config.time_window_minutes, None);
        assert_eq!(config.grouping, None);
    }

    #[test]
    fn test_organization_deduplication_config_default() {
        let config = GlobalDeduplicationConfig::default();
        assert!(!config.enabled);
        assert!(!config.alert_dedup_enabled);
        assert_eq!(config.time_window_minutes, None);
    }

    #[test]
    fn test_organization_deduplication_config_validation() {
        let config = GlobalDeduplicationConfig {
            enabled: true,
            alert_dedup_enabled: false,
            alert_fingerprint_groups: vec![],
            time_window_minutes: Some(10),
            ..Default::default()
        };

        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_per_alert_deduplication_config_validation() {
        let mut config = DeduplicationConfig {
            enabled: true,
            fingerprint_fields: vec!["hostname".to_string(), "service".to_string()],
            time_window_minutes: Some(10),
            grouping: None,
        };

        assert!(config.validate().is_ok());

        // Test too many fingerprint fields
        config.fingerprint_fields = (0..15).map(|i| format!("field{}", i)).collect();
        assert!(config.validate().is_err());

        // Test negative time window
        config.fingerprint_fields = vec!["hostname".to_string()];
        config.time_window_minutes = Some(-1);
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_organization_deduplication_config_serialization() {
        let config = GlobalDeduplicationConfig {
            enabled: true,
            alert_dedup_enabled: true,
            alert_fingerprint_groups: vec![],
            time_window_minutes: Some(10),
            ..Default::default()
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        let deserialized: GlobalDeduplicationConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, deserialized);
    }

    #[test]
    fn test_per_alert_deduplication_config_serialization() {
        let config = DeduplicationConfig {
            enabled: true,
            fingerprint_fields: vec!["service".to_string(), "hostname".to_string()],
            time_window_minutes: Some(10),
            grouping: Some(GroupingConfig {
                enabled: true,
                max_group_size: 50,
                send_strategy: SendStrategy::Summary,
                group_wait_seconds: 60,
            }),
        };

        let json = serde_json::to_string_pretty(&config).unwrap();
        let deserialized: DeduplicationConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(config, deserialized);
    }

    #[test]
    fn test_per_alert_config_minimal_serialization() {
        let config = DeduplicationConfig {
            enabled: true,
            ..Default::default()
        };

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["enabled"], true);
        // fingerprint_fields should be omitted when empty
        assert!(json.get("fingerprint_fields").is_none());
        // time_window_minutes should be omitted when None
        assert!(json.get("time_window_minutes").is_none());
        // grouping should be omitted when None
        assert!(json.get("grouping").is_none());
    }

    #[test]
    fn test_organization_config_minimal_serialization() {
        let config = GlobalDeduplicationConfig {
            enabled: true,
            ..Default::default()
        };

        let json = serde_json::to_value(&config).unwrap();
        assert_eq!(json["enabled"], true);
        // semantic_field_groups no longer part of dedup config
        assert!(json.get("semantic_field_groups").is_none());
        // time_window_minutes should be omitted when None
        assert!(json.get("time_window_minutes").is_none());
        // alert_dedup_enabled should be false by default
        assert_eq!(
            json.get("alert_dedup_enabled").and_then(|v| v.as_bool()),
            Some(false)
        );
    }

    #[test]
    fn test_send_strategy_from_str() {
        use std::str::FromStr;
        assert_eq!(
            SendStrategy::from_str("first_with_count").unwrap(),
            SendStrategy::FirstWithCount
        );
        assert_eq!(
            SendStrategy::from_str("summary").unwrap(),
            SendStrategy::Summary
        );
        assert_eq!(SendStrategy::from_str("all").unwrap(), SendStrategy::All);
        // unknown → default (FirstWithCount)
        assert_eq!(
            SendStrategy::from_str("UNKNOWN").unwrap(),
            SendStrategy::default()
        );
        assert_eq!(SendStrategy::from_str("").unwrap(), SendStrategy::default());
    }

    #[test]
    fn test_global_dedup_config_validate_disabled_ok() {
        let config = GlobalDeduplicationConfig {
            enabled: false,
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_global_dedup_config_validate_cross_alert_no_groups_err() {
        let config = GlobalDeduplicationConfig {
            enabled: true,
            alert_dedup_enabled: true,
            alert_fingerprint_groups: vec![],
            ..Default::default()
        };
        let result = config.validate();
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .contains("cross_alert_fingerprint_groups")
        );
    }

    #[test]
    fn test_global_dedup_config_validate_cross_alert_with_groups_ok() {
        let config = GlobalDeduplicationConfig {
            enabled: true,
            alert_dedup_enabled: true,
            alert_fingerprint_groups: vec!["field1".to_string()],
            ..Default::default()
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_global_dedup_config_default_with_presets() {
        let config = GlobalDeduplicationConfig::default_with_presets();
        assert!(!config.enabled);
        assert!(!config.alert_dedup_enabled);
        assert!(config.alert_fingerprint_groups.is_empty());
        assert!(config.time_window_minutes.is_none());
    }

    #[test]
    fn test_per_alert_dedup_config_validate_disabled_ok() {
        let config = DeduplicationConfig {
            enabled: false,
            fingerprint_fields: vec!["field1".to_string(); 15], // > 10 but disabled
            ..Default::default()
        };
        // disabled → skip all validation
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_per_alert_dedup_config_validate_grouping_zero_size_err() {
        let config = DeduplicationConfig {
            enabled: true,
            fingerprint_fields: vec![],
            time_window_minutes: None,
            grouping: Some(GroupingConfig {
                enabled: true,
                max_group_size: 0,
                send_strategy: SendStrategy::All,
                group_wait_seconds: 10,
            }),
        };
        let result = config.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Max group size"));
    }

    #[test]
    fn test_per_alert_dedup_config_validate_grouping_negative_wait_err() {
        let config = DeduplicationConfig {
            enabled: true,
            fingerprint_fields: vec![],
            time_window_minutes: None,
            grouping: Some(GroupingConfig {
                enabled: true,
                max_group_size: 5,
                send_strategy: SendStrategy::Summary,
                group_wait_seconds: -1,
            }),
        };
        let result = config.validate();
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Group wait seconds"));
    }

    #[test]
    fn test_per_alert_dedup_config_validate_grouping_disabled_skip() {
        // grouping present but enabled=false → skip grouping validation
        let config = DeduplicationConfig {
            enabled: true,
            fingerprint_fields: vec![],
            time_window_minutes: None,
            grouping: Some(GroupingConfig {
                enabled: false,
                max_group_size: 0, // would fail if checked
                send_strategy: SendStrategy::All,
                group_wait_seconds: -1, // would fail if checked
            }),
        };
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_deduplication_config_mem_size() {
        let config = DeduplicationConfig {
            enabled: true,
            fingerprint_fields: vec!["host".to_string(), "service".to_string()],
            time_window_minutes: Some(5),
            grouping: None,
        };
        let size = config.mem_size();
        assert!(size >= std::mem::size_of::<DeduplicationConfig>());
    }

    #[test]
    fn test_grouping_config_mem_size() {
        let config = GroupingConfig::default();
        let size = config.mem_size();
        assert_eq!(size, std::mem::size_of::<GroupingConfig>());
    }

    #[test]
    fn test_deserialize_optional_i32_string_number() {
        // time_window_minutes as a JSON string containing a number
        let json = r#"{"enabled":false,"time_window_minutes":"15"}"#;
        let config: GlobalDeduplicationConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.time_window_minutes, Some(15));
    }

    #[test]
    fn test_deserialize_optional_i32_empty_string_returns_none() {
        // Empty string → None
        let json = r#"{"enabled":false,"time_window_minutes":""}"#;
        let config: GlobalDeduplicationConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.time_window_minutes, None);
    }

    #[test]
    fn test_deserialize_optional_i32_null_returns_none() {
        // null → None
        let json = r#"{"enabled":false,"time_window_minutes":null}"#;
        let config: GlobalDeduplicationConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.time_window_minutes, None);
    }

    #[test]
    fn test_deserialize_optional_i32_invalid_string_returns_error() {
        // Invalid string → error
        let json = r#"{"enabled":false,"time_window_minutes":"not_a_number"}"#;
        let result: Result<GlobalDeduplicationConfig, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_deserialize_optional_i32_boolean_returns_error() {
        // Boolean type → error (hits the `_ => Err` branch)
        let json = r#"{"enabled":false,"time_window_minutes":true}"#;
        let result: Result<GlobalDeduplicationConfig, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_deduplication_config_empty_fields_absent_from_json() {
        let config = DeduplicationConfig::default();
        let json = serde_json::to_value(&config).unwrap();
        let obj = json.as_object().unwrap();
        // Vec::is_empty → absent
        assert!(!obj.contains_key("fingerprint_fields"));
        // Option::is_none → absent
        assert!(!obj.contains_key("time_window_minutes"));
        assert!(!obj.contains_key("grouping"));
    }

    #[test]
    fn test_deduplication_config_set_fields_present_in_json() {
        let config = DeduplicationConfig {
            enabled: true,
            fingerprint_fields: vec!["host".to_string()],
            time_window_minutes: Some(30),
            grouping: Some(GroupingConfig {
                enabled: true,
                max_group_size: 10,
                send_strategy: SendStrategy::Summary,
                group_wait_seconds: 30,
            }),
        };
        let json = serde_json::to_value(&config).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("fingerprint_fields"));
        assert!(obj.contains_key("time_window_minutes"));
        assert!(obj.contains_key("grouping"));
    }

    #[test]
    fn test_global_dedup_config_empty_fields_absent_from_json() {
        let config = GlobalDeduplicationConfig::default();
        let json = serde_json::to_value(&config).unwrap();
        let obj = json.as_object().unwrap();
        // Vec::is_empty → absent
        assert!(!obj.contains_key("alert_fingerprint_groups"));
        // Option::is_none → absent
        assert!(!obj.contains_key("time_window_minutes"));
    }

    #[test]
    fn test_global_dedup_config_set_fields_present_in_json() {
        let config = GlobalDeduplicationConfig {
            enabled: true,
            alert_dedup_enabled: false,
            alert_fingerprint_groups: vec!["host".to_string()],
            time_window_minutes: Some(60),
            ..Default::default()
        };
        let json = serde_json::to_value(&config).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("alert_fingerprint_groups"));
        assert!(obj.contains_key("time_window_minutes"));
    }

    #[test]
    fn test_default_upgrade_window() {
        assert_eq!(default_upgrade_window(), 30);
    }

    #[test]
    fn test_default_max_group_size() {
        assert_eq!(default_max_group_size(), 100);
    }

    #[test]
    fn test_default_group_wait() {
        assert_eq!(default_group_wait(), 30);
    }
}
