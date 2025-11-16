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
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub v1: Option<v1::Dashboard>,
    pub v2: Option<v2::Dashboard>,
    pub v3: Option<v3::Dashboard>,
    pub v4: Option<v4::Dashboard>,
    pub v5: Option<v5::Dashboard>,
    pub v6: Option<v6::Dashboard>,
    pub v7: Option<v7::Dashboard>,
    pub v8: Option<v8::Dashboard>,
    pub version: i32,
    pub hash: String,
    #[serde(default)]
    pub updated_at: i64,
}

/// Generate elegant setter methods for `Dashboard` fields.
macro_rules! make_setter {
    ($field:ident; $($ver:literal $vx:ident),+) => {
        #[doc = concat!("Set the ", stringify!($field), " field for the dashboard.")]
        pub fn ${concat(set_, $field)}(&mut self, $field: String) {
            match self {
                $(Self { version: $ver, $vx: Some(inner), .. } => {inner.$field = $field;})+
                _ => {}
            }
        }
    };
}

macro_rules! make_getter {
    ($field:ident; $($ver:literal $vx:ident),+) => {
        #[doc = concat!("Get the ", stringify!($field), " field for the dashboard.")]
        pub fn $field(&self) -> Option<&str> {
            match self.version {
                $($ver => self.$vx.as_ref().map(|inner| inner.$field.as_str()),)+
                _ => None,
            }
        }
    };
}

impl Dashboard {
    make_getter!(dashboard_id; 1 v1, 2 v2, 3 v3, 4 v4, 5 v5, 6 v6, 7 v7, 8 v8);
    make_setter!(dashboard_id; 1 v1, 2 v2, 3 v3, 4 v4, 5 v5, 6 v6, 7 v7, 8 v8);

    make_getter!(owner; 1 v1, 2 v2, 3 v3, 4 v4, 5 v5, 6 v6, 7 v7, 8 v8);
    make_setter!(owner; 1 v1, 2 v2, 3 v3, 4 v4, 5 v5, 6 v6, 7 v7, 8 v8);

    make_getter!(title; 1 v1, 2 v2, 3 v3, 4 v4, 5 v5, 6 v6, 7 v7, 8 v8);
    make_setter!(title; 1 v1, 2 v2, 3 v3, 4 v4, 5 v5, 6 v6, 7 v7, 8 v8);

    make_getter!(description; 1 v1, 2 v2, 3 v3, 4 v4, 5 v5, 6 v6, 7 v7, 8 v8);
    make_getter!(role; 1 v1, 2 v2, 3 v3, 4 v4, 5 v5, 6 v6, 7 v7, 8 v8);

    pub fn set_updated_at(&mut self) {
        self.updated_at = Utc::now().timestamp_micros();
    }

    /// Returns the timestamp with timezone of the time at which the dashboard
    /// was created.
    ///
    /// This value is stored in JSON for versions 1-8 of the dashboard. However
    /// future versions of the dashboard should utilize the `created_at` Unix
    /// timestamp field in the database to represent the creation timestamp.
    pub fn created_at_deprecated(&self) -> Option<DateTime<FixedOffset>> {
        match self.version {
            1 => self.v1.as_ref().map(|inner| inner.created),
            2 => self.v2.as_ref().map(|inner| inner.created),
            3 => self.v3.as_ref().map(|inner| inner.created),
            4 => self.v4.as_ref().map(|inner| inner.created),
            5 => self.v5.as_ref().map(|inner| inner.created),
            6 => self.v6.as_ref().map(|inner| inner.created),
            7 => self.v7.as_ref().map(|inner| inner.created),
            8 => self.v8.as_ref().map(|inner| inner.created),
            _ => None,
        }
    }
}

pub mod reports;
pub mod usage_report;
pub mod v1;
pub mod v2;
pub mod v3;
pub mod v4;
pub mod v5;
pub mod v6;
pub mod v7;
pub mod v8;

pub fn datetime_now() -> DateTime<FixedOffset> {
    Utc::now().with_timezone(&FixedOffset::east_opt(0).expect(
        "BUG", // This can't possibly fail. Can it?
    ))
}

/// Parameters for listing dashboards.
#[derive(Debug, Clone)]
pub struct ListDashboardsParams {
    /// The org ID surrogate key with which to filter dashboards.
    pub org_id: String,

    /// The optional folder ID surrogate key with which to filter dashboards.
    pub folder_id: Option<String>,

    /// The optional case-insensitive title substring with which to filter
    /// dashboards.
    pub title_pat: Option<String>,

    /// The optional page size and page index of results to retrieve.
    pub page_size_and_idx: Option<(u64, u64)>,
}

impl ListDashboardsParams {
    /// Returns new parameters to list dashboards for the given org ID surrogate
    /// key.
    pub fn new(org_id: &str) -> Self {
        Self {
            org_id: org_id.to_string(),
            folder_id: None,
            title_pat: None,
            page_size_and_idx: None,
        }
    }

    /// Filter dashboards by the given folder ID surrogate key.
    pub fn with_folder_id(mut self, folder_id: &str) -> Self {
        self.folder_id = Some(folder_id.to_string());
        self
    }

    /// Filter dashboards by the case-insensitive title pattern.
    ///
    /// Listed dashboards will only include dashboards with a title that
    /// contains the case-insitive title pattern.
    pub fn where_title_contains(mut self, title_pat: &str) -> Self {
        self.title_pat = Some(title_pat.to_string());
        self
    }

    /// Paginate the results by the given page size and page index.
    pub fn paginate(mut self, page_size: u64, page_idx: u64) -> Self {
        self.page_size_and_idx = Some((page_size, page_idx));
        self
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use super::*;

    #[test]
    fn test_default_version() {
        assert_eq!(default_version(), 1);
    }

    #[test]
    fn test_dashboard_version() {
        let version = DashboardVersion { version: 2 };
        assert_eq!(version.version, 2);
    }

    #[test]
    fn test_dashboard_id_methods() {
        // Test with unsupported version
        let dashboard = Dashboard {
            version: 99,
            ..Default::default()
        };
        assert_eq!(dashboard.dashboard_id(), None);
    }

    #[test]
    fn test_set_dashboard_id_v1() {
        let mut dashboard = Dashboard {
            version: 1,
            v1: Some(v1::Dashboard {
                dashboard_id: "old_id".to_string(),
                title: "Test".to_string(),
                description: "Test desc".to_string(),
                role: String::new(),
                owner: String::new(),
                created: datetime_now(),
                panels: Vec::new(),
                layouts: None,
                variables: None,
                updated_at: 0,
            }),
            ..Default::default()
        };

        dashboard.set_dashboard_id("new_dashboard_id".to_string());

        assert_eq!(dashboard.dashboard_id(), Some("new_dashboard_id"));
        assert_eq!(
            dashboard.v1.as_ref().unwrap().dashboard_id,
            "new_dashboard_id"
        );
    }

    #[test]
    fn test_set_dashboard_id_multiple_versions() {
        // Test that setter works for v1
        let v1_dashboard = v1::Dashboard {
            dashboard_id: "old_id_v1".to_string(),
            title: "Test V1".to_string(),
            description: "Test desc V1".to_string(),
            role: String::new(),
            owner: String::new(),
            created: datetime_now(),
            panels: Vec::new(),
            layouts: None,
            variables: None,
            updated_at: 0,
        };
        let mut dashboard = Dashboard::from(v1_dashboard);

        dashboard.set_dashboard_id("new_id_v1".to_string());

        assert_eq!(dashboard.dashboard_id(), Some("new_id_v1"));
        assert_eq!(dashboard.v1.as_ref().unwrap().dashboard_id, "new_id_v1");

        // Test with empty string
        dashboard.set_dashboard_id("".to_string());
        assert_eq!(dashboard.dashboard_id(), Some(""));
        assert_eq!(dashboard.v1.as_ref().unwrap().dashboard_id, "");
    }

    #[test]
    fn test_set_dashboard_id_no_inner_dashboard() {
        let mut dashboard = Dashboard {
            version: 1,
            v1: None,
            ..Default::default()
        };

        dashboard.set_dashboard_id("should_not_set".to_string());

        assert_eq!(dashboard.dashboard_id(), None);
    }

    #[test]
    fn test_set_dashboard_id_unsupported_version() {
        let mut dashboard = Dashboard {
            version: 99,
            ..Default::default()
        };

        dashboard.set_dashboard_id("should_not_set".to_string());

        assert_eq!(dashboard.dashboard_id(), None);
    }

    #[test]
    fn test_set_updated_at() {
        let mut dashboard = Dashboard::default();
        let before = Utc::now().timestamp_micros();

        dashboard.set_updated_at();

        let after = Utc::now().timestamp_micros();
        assert!(dashboard.updated_at >= before);
        assert!(dashboard.updated_at <= after);
    }

    #[test]
    fn test_owner_methods() {
        // Test with unsupported version
        let dashboard = Dashboard {
            version: 10,
            ..Default::default()
        };
        assert_eq!(dashboard.owner(), None);
    }

    #[test]
    fn test_set_owner_v1() {
        let mut dashboard = Dashboard {
            version: 1,
            v1: Some(v1::Dashboard {
                dashboard_id: "test_id".to_string(),
                title: "Test".to_string(),
                description: "Test desc".to_string(),
                role: String::new(),
                owner: "old_owner@example.com".to_string(),
                created: datetime_now(),
                panels: Vec::new(),
                layouts: None,
                variables: None,
                updated_at: 0,
            }),
            ..Default::default()
        };

        dashboard.set_owner("new_owner@example.com".to_string());

        assert_eq!(dashboard.owner(), Some("new_owner@example.com"));
        assert_eq!(
            dashboard.v1.as_ref().unwrap().owner,
            "new_owner@example.com"
        );
    }

    #[test]
    fn test_set_owner_multiple_versions() {
        // Test that setter works for v1
        let v1_dashboard = v1::Dashboard {
            dashboard_id: "test_id_v1".to_string(),
            title: "Test V1".to_string(),
            description: "Test desc V1".to_string(),
            role: String::new(),
            owner: "old_owner_v1@example.com".to_string(),
            created: datetime_now(),
            panels: Vec::new(),
            layouts: None,
            variables: None,
            updated_at: 0,
        };
        let mut dashboard = Dashboard::from(v1_dashboard);

        dashboard.set_owner("new_owner_v1@example.com".to_string());

        assert_eq!(dashboard.owner(), Some("new_owner_v1@example.com"));
        assert_eq!(
            dashboard.v1.as_ref().unwrap().owner,
            "new_owner_v1@example.com"
        );

        // Test with empty string
        dashboard.set_owner("".to_string());
        assert_eq!(dashboard.owner(), Some(""));
        assert_eq!(dashboard.v1.as_ref().unwrap().owner, "");
    }

    #[test]
    fn test_set_owner_no_inner_dashboard() {
        let mut dashboard = Dashboard {
            version: 1,
            v1: None,
            ..Default::default()
        };

        dashboard.set_owner("should_not_set@example.com".to_string());

        assert_eq!(dashboard.owner(), None);
    }

    #[test]
    fn test_set_owner_unsupported_version() {
        let mut dashboard = Dashboard {
            version: 99,
            ..Default::default()
        };

        dashboard.set_owner("should_not_set@example.com".to_string());

        assert_eq!(dashboard.owner(), None);
    }

    #[test]
    fn test_set_owner_empty_string() {
        let v1_dashboard = v1::Dashboard {
            dashboard_id: "test_id".to_string(),
            title: "Test".to_string(),
            description: "Test desc".to_string(),
            role: String::new(),
            owner: "existing_owner@example.com".to_string(),
            created: datetime_now(),
            panels: Vec::new(),
            layouts: None,
            variables: None,
            updated_at: 0,
        };
        let mut dashboard = Dashboard::from(v1_dashboard);

        dashboard.set_owner("".to_string());

        assert_eq!(dashboard.owner(), Some(""));
        assert_eq!(dashboard.v1.as_ref().unwrap().owner, "");
    }

    #[test]
    fn test_title_methods() {
        // Test with unsupported version
        let dashboard = Dashboard {
            version: 0,
            ..Default::default()
        };
        assert_eq!(dashboard.title(), None);
    }

    #[test]
    fn test_description_method() {
        // Test with no matching version
        let dashboard = Dashboard {
            version: 99,
            ..Default::default()
        };
        assert_eq!(dashboard.description(), None);
    }

    #[test]
    fn test_role_method() {
        // Test with no matching version
        let dashboard = Dashboard {
            version: 0,
            ..Default::default()
        };
        assert_eq!(dashboard.role(), None);
    }

    #[test]
    fn test_list_dashboards_params_new() {
        let params = ListDashboardsParams::new("test_org");

        assert_eq!(params.org_id, "test_org");
        assert!(params.folder_id.is_none());
        assert!(params.title_pat.is_none());
        assert!(params.page_size_and_idx.is_none());
    }

    #[test]
    fn test_list_dashboards_params_with_folder_id() {
        let params = ListDashboardsParams::new("test_org").with_folder_id("folder123");

        assert_eq!(params.org_id, "test_org");
        assert_eq!(params.folder_id, Some("folder123".to_string()));
        assert!(params.title_pat.is_none());
        assert!(params.page_size_and_idx.is_none());
    }

    #[test]
    fn test_list_dashboards_params_where_title_contains() {
        let params = ListDashboardsParams::new("test_org").where_title_contains("analytics");

        assert_eq!(params.org_id, "test_org");
        assert!(params.folder_id.is_none());
        assert_eq!(params.title_pat, Some("analytics".to_string()));
        assert!(params.page_size_and_idx.is_none());
    }

    #[test]
    fn test_list_dashboards_params_paginate() {
        let params = ListDashboardsParams::new("test_org").paginate(10, 2);

        assert_eq!(params.org_id, "test_org");
        assert!(params.folder_id.is_none());
        assert!(params.title_pat.is_none());
        assert_eq!(params.page_size_and_idx, Some((10, 2)));
    }

    #[test]
    fn test_list_dashboards_params_chaining() {
        let params = ListDashboardsParams::new("my_org")
            .with_folder_id("main_folder")
            .where_title_contains("performance")
            .paginate(20, 1);

        assert_eq!(params.org_id, "my_org");
        assert_eq!(params.folder_id, Some("main_folder".to_string()));
        assert_eq!(params.title_pat, Some("performance".to_string()));
        assert_eq!(params.page_size_and_idx, Some((20, 1)));
    }

    #[test]
    fn test_dashboard_serialization() {
        let dashboard = Dashboard {
            version: 0,
            hash: "test_hash".to_string(),
            updated_at: 1234567890,
            ..Default::default()
        };

        let json = serde_json::to_string(&dashboard).expect("Failed to serialize");
        assert!(!json.is_empty());

        let deserialized: Dashboard = serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.version, 0);
        assert_eq!(deserialized.hash, "test_hash");
        assert_eq!(deserialized.updated_at, 1234567890);
        assert_eq!(deserialized.dashboard_id(), None);
    }

    #[test]
    fn test_dashboard_version_serialization() {
        let version = DashboardVersion { version: 3 };

        let json = serde_json::to_string(&version).expect("Failed to serialize");
        assert!(json.contains("3"));

        let deserialized: DashboardVersion =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.version, 3);
    }
}
