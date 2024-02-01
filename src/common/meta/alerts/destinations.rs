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

use std::fmt;

use hashbrown::HashMap;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::templates::Template;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Destination {
    #[serde(default)]
    pub name: String,
    pub url: String,
    pub method: HTTPType,
    #[serde(default)]
    pub skip_tls_verify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    pub template: String,
}

impl Destination {
    pub fn with_template(&self, template: Template) -> DestinationWithTemplate {
        DestinationWithTemplate {
            name: self.name.clone(),
            url: self.url.clone(),
            method: self.method.clone(),
            skip_tls_verify: self.skip_tls_verify,
            headers: self.headers.clone(),
            template,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct DestinationWithTemplate {
    pub name: String,
    pub url: String,
    pub method: HTTPType,
    #[serde(default)]
    pub skip_tls_verify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    pub template: Template,
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

impl fmt::Display for HTTPType {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {
            HTTPType::POST => write!(f, "post"),
            HTTPType::PUT => write!(f, "put"),
            HTTPType::GET => write!(f, "get"),
        }
    }
}
