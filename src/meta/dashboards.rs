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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Dashboard {
    pub name: String,
    pub details: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DashboardList {
    pub list: Vec<Dashboard>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::json;

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
