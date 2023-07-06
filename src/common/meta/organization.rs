// Copyright 2022 Zinc Labs Inc. and Contributors
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

use super::{alert::Alert, functions::Transform, stream::Stream};

pub const DEFAULT_ORG: &str = "default";
pub const CUSTOM: &str = "custom";
pub const THRESHOLD: i64 = 9383939382;

#[derive(Serialize, ToSchema)]
pub struct Organization {
    pub identifier: String,
    pub label: String,
}

#[derive(Serialize, Clone, ToSchema)]
pub struct OrgUser {
    pub first_name: String,
    pub last_name: String,
    pub email: String,
}

#[derive(Serialize, ToSchema)]
pub struct OrgDetails {
    pub id: i64,
    pub identifier: String,
    pub name: String,
    pub user_email: String,
    pub ingest_threshold: i64,
    pub search_threshold: i64,
    #[serde(rename = "type")]
    pub org_type: String,
    #[serde(rename = "UserObj")]
    pub user_obj: OrgUser,
}

#[derive(Serialize, ToSchema)]
pub struct OrganizationResponse {
    pub data: Vec<OrgDetails>,
}

#[derive(Serialize, Deserialize, ToSchema)]
pub struct OrgSummary {
    pub streams: Vec<Stream>,
    pub functions: Vec<Transform>,
    pub alerts: Vec<Alert>,
}

#[derive(Serialize, ToSchema)]
pub struct IngestionPasscode {
    pub passcode: String,
    pub user: String,
}

#[derive(Serialize, ToSchema)]
pub struct PasscodeResponse {
    pub data: IngestionPasscode,
}
