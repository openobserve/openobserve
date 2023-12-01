// Copyright 2023 Zinc Labs Inc.
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

use ahash::HashMap;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::utils::json::Value;

use super::StreamType;

pub mod destinations;
pub mod templates;
pub mod triggers;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Alert {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub org_id: String,
    #[serde(default)]
    pub stream_type: StreamType,
    #[serde(default)]
    pub stream_name: String,
    #[serde(default)]
    pub is_real_time: bool,
    #[serde(default)]
    pub query_condition: QueryCondition,
    #[serde(default)]
    pub trigger_condition: TriggerCondition,
    pub destinations: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_attributes: Option<HashMap<String, String>>,
    #[serde(default)]
    pub enabled: bool,
}

impl PartialEq for Alert {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name
            && self.stream_type == other.stream_type
            && self.stream_name == other.stream_name
    }
}

impl Default for Alert {
    fn default() -> Self {
        Self {
            name: "".to_string(),
            org_id: "".to_string(),
            stream_type: StreamType::default(),
            stream_name: "".to_string(),
            is_real_time: false,
            query_condition: QueryCondition::default(),
            trigger_condition: TriggerCondition::default(),
            destinations: vec![],
            context_attributes: None,
            enabled: false,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct TriggerCondition {
    pub period: i64,        // 10 minutes
    pub operator: Operator, // >=
    pub threshold: i64,     // 3 times
    #[serde(default)]
    pub frequency: i64, // 1 minute
    #[serde(default)]
    pub silence: i64, // silence for 10 minutes after fire an alert
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct QueryCondition {
    pub conditions: Option<Vec<Condition>>,
    pub sql: Option<String>,
    pub promql: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub column: String,
    pub operator: Operator,
    #[schema(value_type = Object)]
    pub value: Value,
    #[serde(default)]
    pub ignore_case: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum Operator {
    #[serde(rename = "=")]
    EqualTo,
    #[serde(rename = "!=")]
    NotEqualTo,
    #[serde(rename = ">")]
    GreaterThan,
    #[serde(rename = ">=")]
    GreaterThanEquals,
    #[serde(rename = "<")]
    LessThan,
    #[serde(rename = "<=")]
    LessThanEquals,
    Contains,
    NotContains,
}

impl Default for Operator {
    fn default() -> Self {
        Self::EqualTo
    }
}

impl ToString for Operator {
    fn to_string(&self) -> String {
        match self {
            Operator::EqualTo => "=".to_string(),
            Operator::NotEqualTo => "!=".to_string(),
            Operator::GreaterThan => ">".to_string(),
            Operator::GreaterThanEquals => ">=".to_string(),
            Operator::LessThan => "<".to_string(),
            Operator::LessThanEquals => "<=".to_string(),
            Operator::Contains => "contains".to_string(),
            Operator::NotContains => "not contains".to_string(),
        }
    }
}
