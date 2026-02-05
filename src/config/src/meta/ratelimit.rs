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

use std::{collections::HashMap, time::Instant};

use anyhow::Context;
use bytes::Bytes;
use sea_orm::FromQueryResult;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub const DEFAULT_STAT_INTERVAL_MS: i64 = 1000;

pub struct CachedUserRoles {
    pub roles: Vec<String>,
    pub expires_at: Instant,
}

#[derive(FromQueryResult, Default, Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct RatelimitRule {
    pub org: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_group_operation: Option<String>,
    pub threshold: i32,
    /// Time window for rate limiting in milliseconds.
    /// Default is 1000ms (1 second) for per-second rate limiting.
    /// For hierarchical rate limiting, use multiple rules with different intervals:
    /// - 1000 = 1 second
    /// - 60000 = 1 minute
    /// - 3600000 = 1 hour
    pub stat_interval_ms: Option<i64>,
}

impl TryFrom<&Bytes> for RatelimitRule {
    type Error = anyhow::Error;

    fn try_from(bytes: &Bytes) -> Result<Self, Self::Error> {
        serde_json::from_slice(bytes).context("Failed to deserialize RatelimitRule")
    }
}

#[derive(Debug)]
pub struct RatelimitRuleUpdater(pub HashMap<String, HashMap<String, i32>>);

impl RatelimitRule {
    pub fn from_updater(
        org: &str,
        role: &str,
        updater: &RatelimitRuleUpdater,
        stat_interval_ms: Option<i64>,
    ) -> Vec<RatelimitRule> {
        let interval = stat_interval_ms.unwrap_or(DEFAULT_STAT_INTERVAL_MS);
        updater
            .0
            .iter()
            .flat_map(|(group_name, operations)| {
                operations
                    .iter()
                    .map(|(operation, threshold)| RatelimitRule {
                        org: org.to_string(),
                        rule_type: Some(RatelimitRuleType::Exact.to_string()),
                        rule_id: Some(crate::ider::generate()),
                        user_role: Some(role.to_string()),
                        user_id: Some(".*".to_string()),
                        api_group_name: Some(group_name.clone()),
                        api_group_operation: Some(operation.clone().to_lowercase()),
                        threshold: *threshold,
                        stat_interval_ms: Some(interval),
                    })
            })
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RatelimitRuleType {
    Exact,
    Regex,
}

impl From<&str> for RatelimitRuleType {
    fn from(s: &str) -> Self {
        match s {
            "exact" => RatelimitRuleType::Exact,
            "regex" => RatelimitRuleType::Regex,
            _ => RatelimitRuleType::Exact, // Default to Exact for invalid input
        }
    }
}

impl std::fmt::Display for RatelimitRuleType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            RatelimitRuleType::Exact => write!(f, "exact"),
            RatelimitRuleType::Regex => write!(f, "regex"),
        }
    }
}

impl RatelimitRule {
    pub fn get_resource(&self) -> String {
        get_resource_from_params(
            self.get_org(),
            self.get_rule_type(),
            self.get_user_role(),
            self.get_api_group_name(),
            self.get_api_group_operation(),
            self.get_user_id(),
        )
    }

    pub fn get_rule_id(&self) -> &str {
        self.rule_id.as_deref().unwrap_or_default()
    }
    pub fn get_org(&self) -> &str {
        &self.org
    }
    pub fn get_rule_type(&self) -> &str {
        self.rule_type.as_deref().unwrap_or_default()
    }
    pub fn get_user_role(&self) -> &str {
        self.user_role.as_deref().unwrap_or_default()
    }
    pub fn get_user_id(&self) -> &str {
        self.user_id.as_deref().unwrap_or_default()
    }
    pub fn get_api_group_name(&self) -> &str {
        self.api_group_name.as_deref().unwrap_or_default()
    }
    pub fn get_api_group_operation(&self) -> &str {
        self.api_group_operation.as_deref().unwrap_or_default()
    }
    pub fn get_threshold(&self) -> i32 {
        self.threshold
    }
    pub fn get_stat_interval_ms(&self) -> u32 {
        self.stat_interval_ms.unwrap_or(DEFAULT_STAT_INTERVAL_MS) as u32
    }
}

pub fn get_resource_from_params(
    org: &str,
    rule_type: &str,
    user_role: &str,
    api_group_name: &str,
    api_group_operation: &str,
    user_id: &str,
) -> String {
    format!("{org}:{rule_type}:{user_role}:{api_group_name}:{api_group_operation}:{user_id}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Interval {
    Second,
    Minute,
    Hour,
}

#[derive(Debug)]
pub struct InvalidIntervalError(pub String);

impl std::fmt::Display for InvalidIntervalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Invalid interval: {}, only support second/minute/hour",
            self.0
        )
    }
}

impl std::error::Error for InvalidIntervalError {}

impl TryFrom<&str> for Interval {
    type Error = InvalidIntervalError;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "second" => Ok(Interval::Second),
            "minute" => Ok(Interval::Minute),
            "hour" => Ok(Interval::Hour),
            _ => Err(InvalidIntervalError(s.to_string())),
        }
    }
}

impl Interval {
    pub fn get_interval_ms(&self) -> i64 {
        match self {
            Interval::Second => 1000,
            Interval::Minute => 60000,
            Interval::Hour => 3600000,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use bytes::Bytes;

    use super::*;

    #[test]
    fn test_cached_user_roles_creation() {
        let roles = vec!["admin".to_string(), "user".to_string()];
        let expires_at = Instant::now() + Duration::from_secs(3600);

        let cached_roles = CachedUserRoles {
            roles: roles.clone(),
            expires_at,
        };

        assert_eq!(cached_roles.roles, roles);
        assert!(cached_roles.expires_at > Instant::now());
    }

    #[test]
    fn test_ratelimit_rule_default() {
        let rule = RatelimitRule::default();
        assert_eq!(rule.org, "");
        assert_eq!(rule.rule_type, None);
        assert_eq!(rule.rule_id, None);
        assert_eq!(rule.user_role, None);
        assert_eq!(rule.user_id, None);
        assert_eq!(rule.api_group_name, None);
        assert_eq!(rule.api_group_operation, None);
        assert_eq!(rule.threshold, 0);
        assert_eq!(rule.stat_interval_ms, None);
    }

    #[test]
    fn test_ratelimit_rule_creation() {
        let rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("rule123".to_string()),
            user_role: Some("admin".to_string()),
            user_id: Some("user123".to_string()),
            api_group_name: Some("search".to_string()),
            api_group_operation: Some("query".to_string()),
            threshold: 100,
            stat_interval_ms: None,
        };

        assert_eq!(rule.org, "test_org");
        assert_eq!(rule.rule_type, Some("exact".to_string()));
        assert_eq!(rule.rule_id, Some("rule123".to_string()));
        assert_eq!(rule.user_role, Some("admin".to_string()));
        assert_eq!(rule.user_id, Some("user123".to_string()));
        assert_eq!(rule.api_group_name, Some("search".to_string()));
        assert_eq!(rule.api_group_operation, Some("query".to_string()));
        assert_eq!(rule.threshold, 100);
    }

    #[test]
    fn test_ratelimit_rule_try_from_bytes_valid() {
        let rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("rule123".to_string()),
            user_role: Some("admin".to_string()),
            user_id: Some("user123".to_string()),
            api_group_name: Some("search".to_string()),
            api_group_operation: Some("query".to_string()),
            threshold: 100,
            stat_interval_ms: None,
        };

        let json = serde_json::to_string(&rule).unwrap();
        let bytes = Bytes::from(json);

        let parsed_rule = RatelimitRule::try_from(&bytes).unwrap();
        assert_eq!(parsed_rule.org, rule.org);
        assert_eq!(parsed_rule.rule_type, rule.rule_type);
        assert_eq!(parsed_rule.threshold, rule.threshold);
    }

    #[test]
    fn test_ratelimit_rule_try_from_bytes_invalid() {
        let invalid_json = Bytes::from("invalid json");
        let result = RatelimitRule::try_from(&invalid_json);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Failed to deserialize RatelimitRule")
        );
    }

    #[test]
    fn test_ratelimit_rule_updater() {
        let mut operations = HashMap::new();
        operations.insert("query".to_string(), 100);
        operations.insert("insert".to_string(), 50);

        let mut groups = HashMap::new();
        groups.insert("search".to_string(), operations.clone());
        groups.insert("ingest".to_string(), operations.clone());

        let updater = RatelimitRuleUpdater(groups);
        assert_eq!(updater.0.len(), 2);
        assert!(updater.0.contains_key("search"));
        assert!(updater.0.contains_key("ingest"));
    }

    #[test]
    fn test_ratelimit_rule_from_updater() {
        let mut operations = HashMap::new();
        operations.insert("QUERY".to_string(), 100);
        operations.insert("INSERT".to_string(), 50);

        let mut groups = HashMap::new();
        groups.insert("search".to_string(), operations.clone());
        groups.insert("ingest".to_string(), operations.clone());

        let updater = RatelimitRuleUpdater(groups);
        let rules = RatelimitRule::from_updater("test_org", "admin", &updater, None);

        assert_eq!(rules.len(), 4); // 2 groups × 2 operations

        for rule in &rules {
            assert_eq!(rule.org, "test_org");
            assert_eq!(rule.rule_type, Some("exact".to_string()));
            assert!(rule.rule_id.is_some());
            assert_eq!(rule.user_role, Some("admin".to_string()));
            assert_eq!(rule.user_id, Some(".*".to_string()));
            assert!(rule.api_group_name.is_some());
            assert!(rule.api_group_operation.is_some());
            assert!(rule.threshold > 0);
        }

        // Check that operations are lowercase
        let query_rules: Vec<_> = rules
            .iter()
            .filter(|r| r.api_group_operation == Some("query".to_string()))
            .collect();
        assert_eq!(query_rules.len(), 2);

        let insert_rules: Vec<_> = rules
            .iter()
            .filter(|r| r.api_group_operation == Some("insert".to_string()))
            .collect();
        assert_eq!(insert_rules.len(), 2);
    }

    #[test]
    fn test_ratelimit_rule_type_from_str() {
        assert!(matches!(
            RatelimitRuleType::from("exact"),
            RatelimitRuleType::Exact
        ));
        assert!(matches!(
            RatelimitRuleType::from("regex"),
            RatelimitRuleType::Regex
        ));
        assert!(matches!(
            RatelimitRuleType::from("invalid"),
            RatelimitRuleType::Exact
        ));
        assert!(matches!(
            RatelimitRuleType::from(""),
            RatelimitRuleType::Exact
        ));
    }

    #[test]
    fn test_ratelimit_rule_type_display() {
        assert_eq!(RatelimitRuleType::Exact.to_string(), "exact");
        assert_eq!(RatelimitRuleType::Regex.to_string(), "regex");
    }

    #[test]
    fn test_ratelimit_rule_getters() {
        let rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("rule123".to_string()),
            user_role: Some("admin".to_string()),
            user_id: Some("user123".to_string()),
            api_group_name: Some("search".to_string()),
            api_group_operation: Some("query".to_string()),
            threshold: 100,
            stat_interval_ms: None,
        };

        assert_eq!(rule.get_rule_id(), "rule123");
        assert_eq!(rule.get_org(), "test_org");
        assert_eq!(rule.get_rule_type(), "exact");
        assert_eq!(rule.get_user_role(), "admin");
        assert_eq!(rule.get_user_id(), "user123");
        assert_eq!(rule.get_api_group_name(), "search");
        assert_eq!(rule.get_api_group_operation(), "query");
        assert_eq!(rule.get_threshold(), 100);
    }

    #[test]
    fn test_ratelimit_rule_getters_none_values() {
        let rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: None,
            rule_id: None,
            user_role: None,
            user_id: None,
            api_group_name: None,
            api_group_operation: None,
            threshold: 50,
            stat_interval_ms: None,
        };

        assert_eq!(rule.get_rule_id(), "");
        assert_eq!(rule.get_org(), "test_org");
        assert_eq!(rule.get_rule_type(), "");
        assert_eq!(rule.get_user_role(), "");
        assert_eq!(rule.get_user_id(), "");
        assert_eq!(rule.get_api_group_name(), "");
        assert_eq!(rule.get_api_group_operation(), "");
        assert_eq!(rule.get_threshold(), 50);
    }

    #[test]
    fn test_ratelimit_rule_get_resource() {
        let rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("rule123".to_string()),
            user_role: Some("admin".to_string()),
            user_id: Some("user123".to_string()),
            api_group_name: Some("search".to_string()),
            api_group_operation: Some("query".to_string()),
            threshold: 100,
            stat_interval_ms: None,
        };

        let expected = "test_org:exact:admin:search:query:user123";
        assert_eq!(rule.get_resource(), expected);
    }

    #[test]
    fn test_ratelimit_rule_get_resource_with_none_values() {
        let rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: None,
            rule_id: None,
            user_role: None,
            user_id: None,
            api_group_name: None,
            api_group_operation: None,
            threshold: 50,
            stat_interval_ms: None,
        };

        let expected = "test_org:::::";
        assert_eq!(rule.get_resource(), expected);
    }

    #[test]
    fn test_get_resource_from_params() {
        let resource =
            get_resource_from_params("test_org", "exact", "admin", "search", "query", "user123");

        assert_eq!(resource, "test_org:exact:admin:search:query:user123");
    }

    #[test]
    fn test_get_resource_from_params_empty_values() {
        let resource = get_resource_from_params("", "", "", "", "", "");
        assert_eq!(resource, ":::::");
    }

    #[test]
    fn test_get_resource_from_params_special_characters() {
        let resource = get_resource_from_params(
            "org:with:colons",
            "exact",
            "admin",
            "search",
            "query",
            "user:123",
        );

        assert_eq!(
            resource,
            "org:with:colons:exact:admin:search:query:user:123"
        );
    }

    #[test]
    fn test_serialization_deserialization() {
        let rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("rule123".to_string()),
            user_role: Some("admin".to_string()),
            user_id: Some("user123".to_string()),
            api_group_name: Some("search".to_string()),
            api_group_operation: Some("query".to_string()),
            threshold: 100,
            stat_interval_ms: None,
        };

        // Test serialization
        let json = serde_json::to_string(&rule).expect("Failed to serialize");
        assert!(!json.is_empty());

        // Test deserialization
        let deserialized: RatelimitRule =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.org, rule.org);
        assert_eq!(deserialized.rule_type, rule.rule_type);
        assert_eq!(deserialized.rule_id, rule.rule_id);
        assert_eq!(deserialized.user_role, rule.user_role);
        assert_eq!(deserialized.user_id, rule.user_id);
        assert_eq!(deserialized.api_group_name, rule.api_group_name);
        assert_eq!(deserialized.api_group_operation, rule.api_group_operation);
        assert_eq!(deserialized.threshold, rule.threshold);
    }

    #[test]
    fn test_serialization_skips_none_values() {
        let rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: None,
            rule_id: None,
            user_role: None,
            user_id: None,
            api_group_name: None,
            api_group_operation: None,
            threshold: 100,
            stat_interval_ms: None,
        };

        let json = serde_json::to_string(&rule).expect("Failed to serialize");

        // Check that None values are not included in JSON
        assert!(!json.contains("rule_type"));
        assert!(!json.contains("rule_id"));
        assert!(!json.contains("user_role"));
        assert!(!json.contains("user_id"));
        assert!(!json.contains("api_group_name"));
        assert!(!json.contains("api_group_operation"));

        // Check that required fields are included
        assert!(json.contains("org"));
        assert!(json.contains("threshold"));
    }

    #[test]
    fn test_stat_interval_ms_field() {
        let rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("rule123".to_string()),
            user_role: Some("admin".to_string()),
            user_id: Some("user123".to_string()),
            api_group_name: Some("search".to_string()),
            api_group_operation: Some("query".to_string()),
            threshold: 100,
            stat_interval_ms: Some(60000), // 1 minute
        };

        assert_eq!(rule.stat_interval_ms, Some(60000));
        assert_eq!(rule.get_stat_interval_ms(), 60000);
    }

    #[test]
    fn test_stat_interval_ms_default() {
        let rule = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("rule123".to_string()),
            user_role: Some("admin".to_string()),
            user_id: Some("user123".to_string()),
            api_group_name: Some("search".to_string()),
            api_group_operation: Some("query".to_string()),
            threshold: 100,
            stat_interval_ms: None,
        };

        assert_eq!(rule.stat_interval_ms, None);
        assert_eq!(rule.get_stat_interval_ms(), DEFAULT_STAT_INTERVAL_MS as u32);
    }

    #[test]
    fn test_hierarchical_rate_limiting() {
        // Create 3 rules for the same resource but different time windows
        let rule_1_sec = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("rule_1s".to_string()),
            user_role: Some("admin".to_string()),
            user_id: Some("user123".to_string()),
            api_group_name: Some("search".to_string()),
            api_group_operation: Some("query".to_string()),
            threshold: 1,
            stat_interval_ms: Some(DEFAULT_STAT_INTERVAL_MS),
        };

        let rule_1_min = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("rule_1m".to_string()),
            user_role: Some("admin".to_string()),
            user_id: Some("user123".to_string()),
            api_group_name: Some("search".to_string()),
            api_group_operation: Some("query".to_string()),
            threshold: 10,
            stat_interval_ms: Some(60000), // 1 minute
        };

        let rule_1_hour = RatelimitRule {
            org: "test_org".to_string(),
            rule_type: Some("exact".to_string()),
            rule_id: Some("rule_1h".to_string()),
            user_role: Some("admin".to_string()),
            user_id: Some("user123".to_string()),
            api_group_name: Some("search".to_string()),
            api_group_operation: Some("query".to_string()),
            threshold: 20,
            stat_interval_ms: Some(3600000), // 1 hour
        };

        // All three rules should have the same resource identifier
        // (so they apply to the same endpoint)
        assert_eq!(rule_1_sec.get_resource(), rule_1_min.get_resource());
        assert_eq!(rule_1_min.get_resource(), rule_1_hour.get_resource());

        // But different intervals
        assert_eq!(rule_1_sec.get_stat_interval_ms(), 1000);
        assert_eq!(rule_1_min.get_stat_interval_ms(), 60000);
        assert_eq!(rule_1_hour.get_stat_interval_ms(), 3600000);

        // And different thresholds
        assert_eq!(rule_1_sec.threshold, 1);
        assert_eq!(rule_1_min.threshold, 10);
        assert_eq!(rule_1_hour.threshold, 20);
    }
}
