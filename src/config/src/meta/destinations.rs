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

use std::fmt;

use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
#[serde(rename_all = "snake_case")]
pub struct Destination {
    pub id: Option<svix_ksuid::Ksuid>,
    pub org_id: String,
    pub name: String,
    pub module: Module,
}

impl Destination {
    pub fn is_alert_destinations(&self) -> bool {
        matches!(&self.module, Module::Alert { .. })
    }
}

#[derive(Serialize, Debug, Deserialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum Module {
    Alert {
        template: String,
        destination_type: DestinationType,
    },
    Pipeline {
        endpoint: Endpoint,
    },
}

impl Default for Module {
    fn default() -> Self {
        Module::Alert {
            template: "".to_string(),
            destination_type: DestinationType::Http(Endpoint::default()),
        }
    }
}
impl std::fmt::Display for Module {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Module::Alert { .. } => "alert",
            Module::Pipeline { .. } => "pipeline",
        };
        write!(f, "{s}")
    }
}

#[derive(Serialize, Debug, Deserialize, Clone)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum DestinationType {
    Http(Endpoint),
    Email(Email),
    Sns(AwsSns),
}

impl Default for DestinationType {
    fn default() -> Self {
        DestinationType::Http(Endpoint::default())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Email {
    pub recipients: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq, Eq, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Endpoint {
    pub url: String,
    #[serde(default)]
    pub method: HTTPType,
    #[serde(default)]
    pub skip_tls_verify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_format: Option<HTTPOutputFormat>,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct AwsSns {
    pub sns_topic_arn: String,
    pub aws_region: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum HTTPType {
    #[default]
    #[serde(rename = "post")]
    POST,
    #[serde(rename = "put")]
    PUT,
    #[serde(rename = "get")]
    GET,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum HTTPOutputFormat {
    #[default]
    #[serde(rename = "json")]
    JSON,
    #[serde(rename = "ndjson")]
    NDJSON,
}

impl fmt::Display for HTTPType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            HTTPType::POST => write!(f, "post"),
            HTTPType::PUT => write!(f, "put"),
            HTTPType::GET => write!(f, "get"),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(default)]
#[serde(rename_all = "snake_case")]
pub struct Template {
    pub id: Option<svix_ksuid::Ksuid>,
    pub org_id: String,
    pub name: String,
    pub is_default: bool,
    #[serde(rename = "type")]
    pub template_type: TemplateType,
    pub body: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub enum TemplateType {
    #[default]
    #[serde(rename = "http")]
    Http,
    #[serde(rename = "email")]
    Email { title: String },
    #[serde(rename = "sns")]
    Sns,
}

impl fmt::Display for TemplateType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TemplateType::Http => write!(f, "http"),
            TemplateType::Email { .. } => write!(f, "email"),
            TemplateType::Sns => write!(f, "sns"),
        }
    }
}
