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

use chrono::{DateTime, FixedOffset, Utc};
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
    pub v3: Option<v3::Dashboard>,
    pub version: i32,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Dashboards {
    pub dashboards: Vec<Dashboard>,
}

pub mod reports;
pub mod v1;
pub mod v2;
pub mod v3;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    #[serde(default)]
    pub folder_id: String,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveDashboard {
    pub from: String,
    pub to: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct FolderList {
    pub list: Vec<Folder>,
}

pub const DEFAULT_FOLDER: &str = "default";

pub fn datetime_now() -> DateTime<FixedOffset> {
    Utc::now().with_timezone(&FixedOffset::east_opt(0).expect(
        "BUG", // This can't possibly fail. Can it?
    ))
}
