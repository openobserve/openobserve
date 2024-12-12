// Copyright 2024 OpenObserve Inc.
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

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct Destination {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub module: Module,
}

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Module {
    Alert {
        template_id: String,
        #[serde(flatten)]
        destination_type: DestinationType,
    },
    Pipeline {
        pipeline_id: String,
        endpoint: Endpoint,
    },
}

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DestinationType {
    Http(Endpoint),
    Email(Email),
    Sns(AwsSns),
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Email {
    pub recipients: Vec<String>,
    pub title: String,
}

#[derive(Serialize, Debug, PartialEq, Eq, Deserialize, Clone, ToSchema)]
pub struct Endpoint {
    pub url: String,
    #[serde(default)]
    pub method: HTTPType,
    #[serde(default)]
    pub skip_tls_verify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HTTPType {
    #[default]
    POST,
    PUT,
    GET,
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

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct AwsSns {
    pub sns_topic_arn: String,
    pub aws_region: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Template {
    pub id: String,
    pub org_id: String,
    pub name: String,
    #[serde(rename = "isDefault")]
    #[serde(default)]
    pub is_default: bool,
    pub body: String,
    #[serde(rename = "type")]
    pub destination_type: TemplateType,
}

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TemplateType {
    Http,
    Email { title: String },
}
