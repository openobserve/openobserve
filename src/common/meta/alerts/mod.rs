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
use std::fmt;
use utoipa::ToSchema;

use super::StreamType;
use crate::common::utils::json::Value;

pub mod destinations;
pub mod templates;
pub mod triggers;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Alert {
    #[serde(default)]
    pub name: String,
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

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct TriggerCondition {
    pub period: i64,        // 10 minutes
    pub operator: Operator, // >=
    pub threshold: i64,     // 3 times
    pub frequency: i64,     // 1 minute
    pub silence: i64,       // silence for 10 minutes after fire an alert
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct AlertDestination {
    pub name: Option<String>,
    pub url: String,
    pub method: AlertHTTPType,
    #[serde(default)]
    pub skip_tls_verify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    pub template: String,
}

impl AlertDestination {
    pub fn to_dest_resp(&self, template: DestinationTemplate) -> AlertDestinationResponse {
        AlertDestinationResponse {
            url: self.url.clone(),
            method: self.method.clone(),
            skip_tls_verify: self.skip_tls_verify,
            headers: self.headers.clone(),
            template,
            name: self.name.clone().unwrap(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct AlertDestinationResponse {
    pub name: String,
    pub url: String,
    pub method: AlertHTTPType,
    #[serde(default)]
    pub skip_tls_verify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    pub template: DestinationTemplate,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum AlertHTTPType {
    #[default]
    #[serde(rename = "post")]
    POST,
    #[serde(rename = "put")]
    PUT,
    #[serde(rename = "get")]
    GET,
}

impl fmt::Display for AlertHTTPType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            AlertHTTPType::POST => write!(f, "post"),
            AlertHTTPType::PUT => write!(f, "put"),
            AlertHTTPType::GET => write!(f, "get"),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct DestinationTemplate {
    pub name: Option<String>,
    #[schema(value_type = Object)]
    pub body: Value,
    #[serde(rename = "isDefault")]
    #[serde(default)]
    pub is_default: Option<bool>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Trigger {
    pub next_run_at: i64,
    pub is_silenced: bool,
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
    #[serde(default)]
    pub ignore_case: Option<bool>,
    #[schema(value_type = Object)]
    pub value: Value,
    pub is_numeric: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum Operator {
    #[serde(alias = "=")]
    EqualTo,
    #[serde(alias = "!=")]
    NotEqualTo,
    #[serde(alias = ">")]
    GreaterThan,
    #[serde(alias = ">=")]
    GreaterThanEquals,
    #[serde(alias = "<")]
    LessThan,
    #[serde(alias = "<=")]
    LessThanEquals,
    Contains,
    NotContains,
}

impl Default for Operator {
    fn default() -> Self {
        Self::EqualTo
    }
}
