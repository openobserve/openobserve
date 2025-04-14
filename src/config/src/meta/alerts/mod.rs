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

use crate::{
    meta::search::SearchEventType,
    utils::json::{Map, Value},
};

pub mod alert;

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct TriggerCondition {
    /// (minutes)
    pub period: i64, // 10 minutes
    #[serde(default)]
    pub operator: Operator, // >=
    #[serde(default)]
    pub threshold: i64, // 3 times
    /// (seconds)
    #[serde(default)]
    pub frequency: i64, // 1 minute
    #[serde(default)]
    pub cron: String, // Cron Expression
    #[serde(default)]
    pub frequency_type: FrequencyType,
    #[serde(default)]
    /// (minutes)
    pub silence: i64, // silence for 10 minutes after fire an alert
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    /// (seconds)
    #[serde(default)]
    pub tolerance_in_secs: Option<i64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TriggerEvalResults {
    pub data: Option<Vec<Map<String, Value>>>,
    pub end_time: i64,
    pub query_took: Option<i64>,
}

#[derive(Clone, Default, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct CompareHistoricData {
    #[serde(rename = "offSet")]
    pub offset: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum FrequencyType {
    #[serde(rename = "cron")]
    Cron,
    #[serde(rename = "minutes")]
    #[default]
    Minutes,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct QueryCondition {
    #[serde(default)]
    #[serde(rename = "type")]
    pub query_type: QueryType,
    pub conditions: Option<ConditionList>,
    pub sql: Option<String>,
    pub promql: Option<String>,              // (cpu usage / cpu total)
    pub promql_condition: Option<Condition>, // value >= 80
    pub aggregation: Option<Aggregation>,
    #[serde(default)]
    pub vrl_function: Option<String>,
    #[serde(default)]
    pub search_event_type: Option<SearchEventType>,
    #[serde(default)]
    pub multi_time_range: Option<Vec<CompareHistoricData>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize, ToSchema)]
#[serde(untagged)]
pub enum ConditionList {
    OrNode{or: Vec<ConditionList>},
    AndNode{and: Vec<ConditionList>},
    NotNode{not: Box<ConditionList>},
    /// This variant handles data serialized in `Vec<Condition>`
    /// where all conditions are evaluated as conjunction
    LegacyConditions(Vec<ConditionList>),
    EndCondition(Condition)
}

// Define a separate iterator struct for ConditionList
pub struct ConditionListIterator {
    inner: Vec<ConditionList>,
    index: usize
}

impl Iterator for ConditionListIterator {
    type Item = ConditionList;

    fn next(&mut self) -> Option<Self::Item> {
        if self.index < self.inner.len() {
            let item = self.inner[self.index].clone();
            self.index += 1;
            Some(item)
        } else {
            None
        }
    }
}

// Implement IntoIterator for ConditionList
impl IntoIterator for ConditionList {
    type Item = ConditionList;
    type IntoIter = ConditionListIterator;

    fn into_iter(self) -> Self::IntoIter {
        let inner = match self {
            ConditionList::OrNode { or } => or,
            ConditionList::AndNode { and } => and,
            ConditionList::LegacyConditions(conditions) => conditions,
            ConditionList::NotNode { not } => vec![*not],
            ConditionList::EndCondition(condition) => vec![ConditionList::EndCondition(condition)],
        };
        ConditionListIterator { inner, index: 0 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
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
    #[serde(rename = "median")]
    Median,
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

impl std::fmt::Display for AggFunction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AggFunction::Avg => write!(f, "avg"),
            AggFunction::Min => write!(f, "min"),
            AggFunction::Max => write!(f, "max"),
            AggFunction::Sum => write!(f, "sum"),
            AggFunction::Count => write!(f, "count"),
            AggFunction::Median => write!(f, "median"),
            AggFunction::P50 => write!(f, "p50"),
            AggFunction::P75 => write!(f, "p75"),
            AggFunction::P90 => write!(f, "p90"),
            AggFunction::P95 => write!(f, "p95"),
            AggFunction::P99 => write!(f, "p99"),
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
            "median" => AggFunction::Median,
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

impl std::fmt::Display for QueryType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QueryType::Custom => write!(f, "custom"),
            QueryType::SQL => write!(f, "sql"),
            QueryType::PromQL => write!(f, "promql"),
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
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

impl std::fmt::Display for Operator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Operator::EqualTo => write!(f, "="),
            Operator::NotEqualTo => write!(f, "!="),
            Operator::GreaterThan => write!(f, ">"),
            Operator::GreaterThanEquals => write!(f, ">="),
            Operator::LessThan => write!(f, "<"),
            Operator::LessThanEquals => write!(f, "<="),
            Operator::Contains => write!(f, "contains"),
            Operator::NotContains => write!(f, "not contains"),
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_deserialize_backcompat_condition_list() {
        let backcompat_condition_list = r#"[
        {
            "column": "level",
            "operator": "=",
            "value": "error",
            "ignore_case": false
        },
        {
            "column": "job",
            "operator": "=",
            "value": "something",
            "ignore_case": false
        }
        ]"#;
        let expected_legacy_condition_list: ConditionList = serde_json::from_str(backcompat_condition_list).unwrap();
        assert_eq!(
            expected_legacy_condition_list,
            ConditionList::LegacyConditions(
                vec![
                    ConditionList::EndCondition(Condition{
                        column: "level".into(),
                        operator: Operator::EqualTo,
                        value: Value::String("error".into()),
                        ignore_case: false,
                    }),
                    ConditionList::EndCondition(Condition{
                        column: "job".to_string(),
                        operator: Operator::EqualTo,
                        value: Value::String("something".into()),
                        ignore_case: false,
                    })
                ]
            )
        );
    }

    #[test]
    fn test_deserialize_not_condition_list() {
        let and_condition_list = r#"{
            "not": {
                "and": [
                    {
                        "column": "level",
                        "operator": "=",
                        "value": "error",
                        "ignore_case": false
                    },
                    {
                        "column": "job",
                        "operator": "=",
                        "value": "something",
                        "ignore_case": false
                    }
                ]
            }
        }"#;
        let expected_not_condition_list: ConditionList = serde_json::from_str(and_condition_list).unwrap();
        assert_eq!(
            expected_not_condition_list,
            ConditionList::NotNode {
                not: { Box::new(ConditionList::AndNode {
                    and: vec![
                        ConditionList::EndCondition(Condition{
                            column: "level".into(),
                            operator: Operator::EqualTo,
                            value: Value::String("error".into()),
                            ignore_case: false,
                        }),
                        ConditionList::EndCondition(Condition{
                            column: "job".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("something".into()),
                            ignore_case: false,
                        })
                    ]
                    })
                }
            }
        );
    }

    #[test]
    fn test_deserialize_simple_condition_list() {
        let and_condition_list = r#"{
        "and": [
        {
            "column": "level",
            "operator": "=",
            "value": "error",
            "ignore_case": false
        },
        {
            "column": "job",
            "operator": "=",
            "value": "something",
            "ignore_case": false
        }
        ]}"#;
        let expected_and_condition_list: ConditionList = serde_json::from_str(and_condition_list).unwrap();
        assert_eq!(
            expected_and_condition_list,
            ConditionList::AndNode {
                and: vec![
                    ConditionList::EndCondition(Condition{
                        column: "level".into(),
                        operator: Operator::EqualTo,
                        value: Value::String("error".into()),
                        ignore_case: false,
                    }),
                    ConditionList::EndCondition(Condition{
                        column: "job".to_string(),
                        operator: Operator::EqualTo,
                        value: Value::String("something".into()),
                        ignore_case: false,
                    })
                ]
            }
        );
    }

    #[test]
    fn test_deserialize_complex_condition_list() {
        let complex_condition_list = r#"{
        "or": [
            {
                "and": [
                    {
                        "column": "column1",
                        "operator": "=",
                        "value": "value1",
                        "ignore_case": true
                    },
                    {
                        "column": "level",
                        "operator": "=",
                        "value": "error",
                        "ignore_case": false
                    }
                ]
            },
            {
                "column": "column3",
                "operator": ">",
                "value": "value3",
                "ignore_case": false
            }
        ]
        }"#;
        let expected_complex_condition_list: ConditionList = serde_json::from_str(complex_condition_list).unwrap();
        assert_eq!(
            expected_complex_condition_list,
            ConditionList::OrNode {
                or: vec![
                    ConditionList::AndNode{
                        and: vec![
                            ConditionList::EndCondition(Condition{
                                column: "column1".into(),
                                operator: Operator::EqualTo,
                                value: Value::String("value1".into()),
                                ignore_case: true,
                            }),
                            ConditionList::EndCondition(Condition{
                                column: "level".to_string(),
                                operator: Operator::EqualTo,
                                value: Value::String("error".into()),
                                ignore_case: false,
                            })
                        ]
                    },
                    ConditionList::EndCondition(Condition{
                        column: "column3".to_string(),
                        operator: Operator::GreaterThan,
                        value: Value::String("value3".into()),
                        ignore_case: false,
                    })
                ]
            }
        );
    }
}