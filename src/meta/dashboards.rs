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

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DashboardList {
    pub list: Vec<NamedDashboard>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NamedDashboard {
    // XXX-REVIEW: Do we need this field (and the encompassing struct) at all?
    // AFAICS, name equals `Dashboard::dashboard_id`, so there's a duplication.
    pub name: String,
    pub details: Dashboard,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub title: String,
    pub dashboard_id: String,
    pub description: String,
    pub role: String,
    pub owner: String,
    pub created: DateTime<FixedOffset>,
    pub panels: Vec<Panel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Panel {
    pub id: String,
    #[serde(rename = "type")]
    pub type_name: String,
    pub fields: PanelFields,
    pub config: PanelConfig,
    pub query: String,
    pub custom_query: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelFields {
    pub stream: String,
    pub stream_type: String,
    pub x: Vec<AxisItem>,
    pub y: Vec<AxisItem>,
    // XXX-REVIEW
    pub filter: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisItem {
    pub label: String,
    pub alias: String,
    pub column: String,
    pub color: Option<String>,
    pub aggregation_function: AggregationFunc,
}

// XXX-TODO: REVISEME
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AggregationFunc {
    Count,
    Histogram,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PanelConfig {
    title: String,
    description: String,
    show_legends: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::json;

    // XXX-FIXME
    #[test]
    fn test_dashboard() {
        let dashboard = Dashboard {
            name: "test".to_string(),
            details: "test".to_string(),
        };
        assert_eq!(dashboard.name, "test");
        assert_eq!(dashboard.details, "test");

        let dashboard_str = json::to_string(&dashboard.clone()).unwrap();
        let dashboard2: Dashboard = json::from_str(&dashboard_str).unwrap();
        assert_eq!(dashboard.name, dashboard2.name);
        assert_eq!(format!("{:?}", dashboard), format!("{:?}", dashboard2));

        let dslist = DashboardList {
            list: vec![dashboard.clone()],
        };
        assert!(!dslist.list.is_empty());
        let dslist_str = json::to_string(&dslist.clone()).unwrap();
        let dslist2: DashboardList = json::from_str(&dslist_str).unwrap();
        assert_eq!(dslist.list.len(), dslist2.list.len());
        assert_eq!(format!("{:?}", dslist), format!("{:?}", dslist2));
    }
}
