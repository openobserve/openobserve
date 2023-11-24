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

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Destination {
    pub name: Option<String>,
    pub url: String,
    pub method: DestinationHTTPType,
    #[serde(default)]
    pub skip_tls_verify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    pub template: String,
}

impl Destination {
    pub fn to_dest_resp(
        &self,
        template: Option<super::templates::Template>,
    ) -> DestinationResponse {
        DestinationResponse {
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
pub struct DestinationResponse {
    pub name: String,
    pub url: String,
    pub method: DestinationHTTPType,
    #[serde(default)]
    pub skip_tls_verify: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    pub template: Option<super::templates::Template>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum DestinationHTTPType {
    #[default]
    #[serde(rename = "post")]
    POST,
    #[serde(rename = "put")]
    PUT,
    #[serde(rename = "get")]
    GET,
}

impl fmt::Display for DestinationHTTPType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            DestinationHTTPType::POST => write!(f, "post"),
            DestinationHTTPType::PUT => write!(f, "put"),
            DestinationHTTPType::GET => write!(f, "get"),
        }
    }
}
