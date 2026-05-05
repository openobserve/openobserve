// Copyright 2026 OpenObserve Inc.
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

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct DashboardInfo {
    pub run_id: String,
    pub panel_id: String,
    pub panel_name: String,
    pub tab_id: String,
    pub tab_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dashboard_info_serialize_deserialize() {
        let info = DashboardInfo {
            run_id: "run1".to_string(),
            panel_id: "panel1".to_string(),
            panel_name: "My Panel".to_string(),
            tab_id: "tab1".to_string(),
            tab_name: "Tab 1".to_string(),
        };
        let json = serde_json::to_string(&info).unwrap();
        let back: DashboardInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(info, back);
    }

    #[test]
    fn test_dashboard_info_equality() {
        let a = DashboardInfo {
            run_id: "r".to_string(),
            panel_id: "p".to_string(),
            panel_name: "n".to_string(),
            tab_id: "t".to_string(),
            tab_name: "tn".to_string(),
        };
        let b = a.clone();
        assert_eq!(a, b);
        let c = DashboardInfo {
            run_id: "different".to_string(),
            ..b
        };
        assert_ne!(a, c);
    }

    #[test]
    fn test_dashboard_info_all_fields_in_json() {
        let info = DashboardInfo {
            run_id: "r1".to_string(),
            panel_id: "p1".to_string(),
            panel_name: "Panel".to_string(),
            tab_id: "t1".to_string(),
            tab_name: "Tab".to_string(),
        };
        let val = serde_json::to_value(&info).unwrap();
        assert_eq!(val["run_id"], "r1");
        assert_eq!(val["panel_id"], "p1");
        assert_eq!(val["panel_name"], "Panel");
        assert_eq!(val["tab_id"], "t1");
        assert_eq!(val["tab_name"], "Tab");
    }
}
