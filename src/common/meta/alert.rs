// Copyright 2023 Zinc Labs Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::HashMap;
use serde::{Deserialize, Serialize};
use std::fmt;
use utoipa::ToSchema;

use super::{search::Query, StreamType};
use crate::common::utils::json::{Map, Value};

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Alert {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub stream: String,
    #[schema(value_type = Option<SearchQuery>)]
    pub query: Option<Query>,
    pub condition: Condition,
    pub duration: i64,
    pub frequency: i64,
    pub time_between_alerts: i64,
    pub destination: String,
    #[serde(default)]
    pub is_real_time: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_attributes: Option<HashMap<String, String>>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_type: Option<StreamType>,
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
    pub fn to_dest_resp(&self, template: Option<DestinationTemplate>) -> AlertDestinationResponse {
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
    pub template: Option<DestinationTemplate>,
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

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum AlertDestType {
    #[default]
    #[serde(rename = "slack")]
    Slack,
    #[serde(rename = "alertmanager")]
    AlertManager,
}

impl fmt::Display for AlertDestType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            AlertDestType::Slack => write!(f, "slack"),
            AlertDestType::AlertManager => write!(f, "alertmanager"),
        }
    }
}

impl PartialEq for Alert {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name && self.stream == other.stream
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct AlertList {
    pub list: Vec<Alert>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Trigger {
    #[serde(default)]
    pub timestamp: i64,
    #[serde(default)]
    pub is_valid: bool,
    #[serde(default)]
    pub alert_name: String,
    #[serde(default)]
    pub stream: String,
    #[serde(default)]
    pub org: String,
    #[serde(default)]
    pub last_sent_at: i64,
    #[serde(default)]
    pub count: i64,
    #[serde(default)]
    pub is_ingest_time: bool,
    #[serde(default)]
    pub stream_type: StreamType,
    #[serde(default)]
    pub parent_alert_deleted: bool,
}

impl Default for Trigger {
    fn default() -> Self {
        Trigger {
            timestamp: 0,
            is_valid: true,
            alert_name: String::new(),
            stream: String::new(),
            org: String::new(),
            last_sent_at: 0,
            count: 0,
            stream_type: StreamType::Logs,
            is_ingest_time: false,
            parent_alert_deleted: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TriggerTimer {
    #[serde(default)]
    pub updated_at: i64,
    #[serde(default)]
    pub expires_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub column: String,
    pub operator: AllOperator,
    #[serde(default)]
    pub ignore_case: Option<bool>,
    #[schema(value_type = Object)]
    pub value: Value,
    pub is_numeric: Option<bool>,
}

impl Evaluate for Condition {
    fn evaluate(&self, row: Map<String, Value>) -> bool {
        if !row.contains_key(&self.column) {
            return false;
        };

        let evaluate_numeric = if self.is_numeric.is_some() {
            self.is_numeric.unwrap()
        } else {
            matches!(row.get(&self.column).unwrap(), Value::Number(_))
        };

        /* let evaluate_numeric = match row.get(&self.column).expect("column exists") {
            Value::Number(number) => number.as_f64().unwrap() > 0.0,
            Value::String(s) => s.is_empty(),
            _ => false,
        }; */

        if evaluate_numeric {
            let number = match row.get(&self.column).expect("column exists") {
                Value::Number(number) => number,
                _ => unreachable!("please make sure right value for is_numeric is set trigger"),
            };

            match self.operator {
                AllOperator::EqualTo => number.as_f64().unwrap() == get_numeric_val(&self.value),
                AllOperator::NotEqualTo => number.as_f64().unwrap() != get_numeric_val(&self.value),
                AllOperator::GreaterThan => number.as_f64().unwrap() > get_numeric_val(&self.value),
                AllOperator::GreaterThanEquals => {
                    number.as_f64().unwrap() >= get_numeric_val(&self.value)
                }
                AllOperator::LessThan => number.as_f64().unwrap() < get_numeric_val(&self.value),
                AllOperator::LessThanEquals => {
                    number.as_f64().unwrap() <= get_numeric_val(&self.value)
                }
                _ => false,
            }
        } else {
            let string = match row.get(&self.column).expect("column exists") {
                Value::String(s) => s,
                _ => unreachable!("please make sure right value for is_numeric is set trigger"),
            };

            if self.ignore_case.unwrap_or_default() {
                match self.operator {
                    AllOperator::EqualTo => {
                        string.eq_ignore_ascii_case(self.value.as_str().unwrap())
                    }
                    AllOperator::NotEqualTo => {
                        !string.eq_ignore_ascii_case(self.value.as_str().unwrap())
                    }
                    AllOperator::Contains => string
                        .to_ascii_lowercase()
                        .contains(&self.value.as_str().unwrap().to_ascii_lowercase()),
                    AllOperator::NotContains => !string
                        .to_ascii_lowercase()
                        .contains(&self.value.as_str().unwrap().to_ascii_lowercase()),
                    _ => false,
                }
            } else {
                match self.operator {
                    AllOperator::EqualTo => string.eq(self.value.as_str().unwrap()),
                    AllOperator::NotEqualTo => !string.eq(self.value.as_str().unwrap()),
                    AllOperator::Contains => string.contains(self.value.as_str().unwrap()),
                    AllOperator::NotContains => !string.contains(self.value.as_str().unwrap()),
                    _ => false,
                }
            }
        }
    }
}

fn get_numeric_val(value: &Value) -> f64 {
    if value.is_boolean() {
        f64::INFINITY
    } else if value.is_f64() {
        value.as_f64().unwrap()
    } else if value.is_i64() {
        value.as_i64().unwrap() as f64
    } else if value.is_u64() {
        value.as_u64().unwrap() as f64
    } else if value.is_string() {
        match value.as_str().unwrap().to_string().parse::<f64>() {
            Ok(val) => val,
            Err(_) => f64::INFINITY,
        }
    } else {
        f64::INFINITY
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum AllOperator {
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

impl Default for AllOperator {
    fn default() -> Self {
        Self::EqualTo
    }
}

pub trait Evaluate {
    fn evaluate(&self, row: Map<String, Value>) -> bool;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::utils::json::json;

    #[test]
    fn test_evaluate() {
        let condition = Condition {
            column: "occurrence".to_owned(),
            operator: AllOperator::GreaterThanEquals,
            ignore_case: None,
            value: json!("5"),
            is_numeric: None,
        };
        let row = json!({"Country":"USA","occurrence": 10});
        condition.evaluate(row.as_object().unwrap().clone());
    }
}
