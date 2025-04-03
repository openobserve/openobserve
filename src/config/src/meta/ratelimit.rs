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
    ) -> Vec<RatelimitRule> {
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
}

pub fn get_resource_from_params(
    org: &str,
    rule_type: &str,
    user_role: &str,
    api_group_name: &str,
    api_group_operation: &str,
    user_id: &str,
) -> String {
    format!(
        "{}:{}:{}:{}:{}:{}",
        org, rule_type, user_role, api_group_name, api_group_operation, user_id
    )
}
