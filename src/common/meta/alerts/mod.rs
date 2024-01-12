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
use config::meta::stream::StreamType;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::common::utils::json::Value;

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
    pub row_template: String,
    #[serde(default)]
    pub description: String,
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
            row_template: "".to_string(),
            description: "".to_string(),
            enabled: false,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct TriggerCondition {
    pub period: i64, // 10 minutes
    #[serde(default)]
    pub operator: Operator, // >=
    #[serde(default)]
    pub threshold: i64, // 3 times
    #[serde(default)]
    pub frequency: i64, // 1 minute
    #[serde(default)]
    pub silence: i64, // silence for 10 minutes after fire an alert
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct QueryCondition {
    #[serde(default)]
    #[serde(rename = "type")]
    pub query_type: QueryType,
    pub conditions: Option<Vec<Condition>>,
    pub sql: Option<String>,
    pub promql: Option<String>,              // (cpu usage / cpu total)
    pub promql_condition: Option<Condition>, // value >= 80
    pub aggregation: Option<Aggregation>,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Aggregation {
    pub group_by: Option<Vec<String>>,
    pub function: AggFunction,
    pub having: Condition,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum AggFunction {
    #[serde(rename = "avg")]
    Avg,
    #[serde(rename = "min")]
    Min,
    #[serde(rename = "max")]
    Max,
    #[serde(rename = "sum")]
    Sum,
    #[serde(rename = "count")]
    Count,
    #[serde(rename = "p50")]
    P50,
    #[serde(rename = "p75")]
    P75,
    #[serde(rename = "p90")]
    P90,
    #[serde(rename = "p95")]
    P95,
    #[serde(rename = "p99")]
    P99,
}

impl ToString for AggFunction {
    fn to_string(&self) -> String {
        match self {
            AggFunction::Avg => "avg".to_string(),
            AggFunction::Min => "min".to_string(),
            AggFunction::Max => "max".to_string(),
            AggFunction::Sum => "sum".to_string(),
            AggFunction::Count => "count".to_string(),
            AggFunction::P50 => "p50".to_string(),
            AggFunction::P75 => "p75".to_string(),
            AggFunction::P90 => "p90".to_string(),
            AggFunction::P95 => "p95".to_string(),
            AggFunction::P99 => "p99".to_string(),
        }
    }
}

impl TryFrom<&str> for AggFunction {
    type Error = &'static str;
    fn try_from(s: &str) -> Result<Self, Self::Error> {
        Ok(match s.to_lowercase().as_str() {
            "avg" => AggFunction::Avg,
            "min" => AggFunction::Min,
            "max" => AggFunction::Max,
            "sum" => AggFunction::Sum,
            "count" => AggFunction::Count,
            "p50" => AggFunction::P50,
            "p75" => AggFunction::P75,
            "p90" => AggFunction::P90,
            "p95" => AggFunction::P95,
            "p99" => AggFunction::P99,
            _ => return Err("invalid aggregation function"),
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum QueryType {
    #[default]
    #[serde(rename = "custom")]
    Custom,
    #[serde(rename = "sql")]
    SQL,
    #[serde(rename = "promql")]
    PromQL,
}

impl ToString for QueryType {
    fn to_string(&self) -> String {
        match self {
            QueryType::Custom => "custom".to_string(),
            QueryType::SQL => "sql".to_string(),
            QueryType::PromQL => "promql".to_string(),
        }
    }
}

impl From<&str> for QueryType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "custom" => QueryType::Custom,
            "sql" => QueryType::SQL,
            "promql" => QueryType::PromQL,
            _ => QueryType::Custom,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Condition {
    pub column: String,
    pub operator: Operator,
    #[schema(value_type = Object)]
    pub value: Value,
    #[serde(default)]
    pub ignore_case: bool,
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
