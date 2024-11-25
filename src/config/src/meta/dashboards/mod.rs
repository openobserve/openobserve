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

use chrono::{DateTime, FixedOffset, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

type OrdF64 = ordered_float::OrderedFloat<f64>;

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
    pub v4: Option<v4::Dashboard>,
    pub v5: Option<v5::Dashboard>,
    pub version: i32,
    pub hash: String,
}

impl Dashboard {
    pub fn dashboard_id(&self) -> Option<String> {
        match self.version {
            1 => self.v1.as_ref().map(|inner| inner.dashboard_id.clone()),
            2 => self.v2.as_ref().map(|inner| inner.dashboard_id.clone()),
            3 => self.v3.as_ref().map(|inner| inner.dashboard_id.clone()),
            4 => self.v4.as_ref().map(|inner| inner.dashboard_id.clone()),
            5 => self.v5.as_ref().map(|inner| inner.dashboard_id.clone()),
            _ => None,
        }
    }

    pub fn owner(&self) -> Option<String> {
        match self.version {
            1 => self.v1.as_ref().map(|inner| inner.owner.clone()),
            2 => self.v2.as_ref().map(|inner| inner.owner.clone()),
            3 => self.v3.as_ref().map(|inner| inner.owner.clone()),
            4 => self.v4.as_ref().map(|inner| inner.owner.clone()),
            5 => self.v5.as_ref().map(|inner| inner.owner.clone()),
            _ => None,
        }
    }

    pub fn title(&self) -> Option<String> {
        match self.version {
            1 => self.v1.as_ref().map(|inner| inner.title.clone()),
            2 => self.v2.as_ref().map(|inner| inner.title.clone()),
            3 => self.v3.as_ref().map(|inner| inner.title.clone()),
            4 => self.v4.as_ref().map(|inner| inner.title.clone()),
            5 => self.v5.as_ref().map(|inner| inner.title.clone()),
            _ => None,
        }
    }

    pub fn set_title(&mut self, title: String) {
        match self.version {
            1 => self.v1.as_mut().map(|inner| inner.title = title),
            2 => self.v2.as_mut().map(|inner| inner.title = title),
            3 => self.v3.as_mut().map(|inner| inner.title = title),
            4 => self.v4.as_mut().map(|inner| inner.title = title),
            5 => self.v5.as_mut().map(|inner| inner.title = title),
            _ => None,
        };
    }

    pub fn description(&self) -> Option<String> {
        match self.version {
            1 => self.v1.as_ref().map(|inner| inner.description.clone()),
            2 => self.v2.as_ref().map(|inner| inner.description.clone()),
            3 => self.v3.as_ref().map(|inner| inner.description.clone()),
            4 => self.v4.as_ref().map(|inner| inner.description.clone()),
            5 => self.v5.as_ref().map(|inner| inner.description.clone()),
            _ => None,
        }
    }

    pub fn role(&self) -> Option<String> {
        match self.version {
            1 => self.v1.as_ref().map(|inner| inner.role.clone()),
            2 => self.v2.as_ref().map(|inner| inner.role.clone()),
            3 => self.v3.as_ref().map(|inner| inner.role.clone()),
            4 => self.v4.as_ref().map(|inner| inner.role.clone()),
            5 => self.v5.as_ref().map(|inner| inner.role.clone()),
            _ => None,
        }
    }

    pub fn created_at_deprecated(&self) -> Option<DateTime<FixedOffset>> {
        match self.version {
            1 => self.v1.as_ref().map(|inner| inner.created.clone()),
            2 => self.v2.as_ref().map(|inner| inner.created.clone()),
            3 => self.v3.as_ref().map(|inner| inner.created.clone()),
            4 => self.v4.as_ref().map(|inner| inner.created.clone()),
            5 => self.v5.as_ref().map(|inner| inner.created.clone()),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Dashboards {
    pub dashboards: Vec<Dashboard>,
}

pub mod reports;
pub mod v1;
pub mod v2;
pub mod v3;
pub mod v4;
pub mod v5;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveDashboard {
    pub from: String,
    pub to: String,
}

pub fn datetime_now() -> DateTime<FixedOffset> {
    Utc::now().with_timezone(&FixedOffset::east_opt(0).expect(
        "BUG", // This can't possibly fail. Can it?
    ))
}
