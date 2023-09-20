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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct DashboardVersion {
    #[serde(default = "default_version")]
    pub version: i32,
}

fn default_version() -> i32 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, ToSchema, Default)]
pub struct Dashboard {
    pub v1: Option<v1::Dashboard>,
    pub v2: Option<v2::Dashboard>,
    pub version: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Dashboards {
    pub dashboards: Vec<Dashboard>,
}

pub mod v1;
pub mod v2;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    #[serde(default)]
    pub folder_id: String,
    pub name: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dashboards: Option<Vec<String>>,
}
