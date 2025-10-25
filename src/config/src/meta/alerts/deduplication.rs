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
use utoipa::ToSchema;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_window_minutes: Option<i64>,

    /// Optional alert grouping configuration
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grouping: Option<GroupingConfig>,
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

fn default_max_group_size() -> usize {
    100
}

fn default_group_wait() -> i64 {
    30
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deduplication_config_default() {
        let config = DeduplicationConfig::default();
        assert!(!config.enabled);
        assert!(config.fingerprint_fields.is_empty());
        assert_eq!(config.time_window_minutes, None);
        assert_eq!(config.grouping, None);
    }

    #[test]
    fn test_grouping_config_default() {
        let config = GroupingConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.max_group_size, 100);
        assert_eq!(config.send_strategy, SendStrategy::FirstWithCount);
        assert_eq!(config.group_wait_seconds, 30);
    }

    #[test]
    fn test_send_strategy_serialization() {
        let strategy = SendStrategy::FirstWithCount;
        let json = serde_json::to_string(&strategy).unwrap();
        assert_eq!(json, r#""first_with_count""#);

        let strategy = SendStrategy::Summary;
        let json = serde_json::to_string(&strategy).unwrap();
        assert_eq!(json, r#""summary""#);

        let strategy = SendStrategy::All;
        let json = serde_json::to_string(&strategy).unwrap();
        assert_eq!(json, r#""all""#);
    }

    #[test]
    fn test_deduplication_config_serialization() {
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
    fn test_deduplication_config_minimal_serialization() {
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
    }
}
