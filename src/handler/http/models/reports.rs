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

use std::str::FromStr;

use config::{
    meta::dashboards::reports::{ReportFrequency, ReportTimerange},
    utils::json,
};
use infra::table::reports::convert_str_to_meta_report_timerange;
use serde::{Deserialize, Serialize};
use svix_ksuid::Ksuid;
use utoipa::ToSchema;

/// HTTP response body for `ListReports` endpoint.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct ListReportsResponseBody(pub Vec<ListReportsResponseBodyItem>);

/// An item in the list returned by the `ListReports` endpoint.
#[derive(Clone, Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct ListReportsResponseBodyItem {
    #[schema(value_type = String)]
    pub report_id: Ksuid,
    pub folder_id: String,
    pub folder_name: String,
    pub name: String,
    pub owner: Option<String>,
    pub description: Option<String>,
    pub created_at: i64,
    pub dashboards: Vec<ReportDashboard>,
    pub frequency: ReportFrequency,
    pub enabled: bool,
    pub org_id: String,
    pub last_triggered_at: Option<i64>,
}

impl TryFrom<Vec<infra::table::reports::ListReportsQueryResult>> for ListReportsResponseBody {
    type Error = anyhow::Error;

    fn try_from(
        value: Vec<infra::table::reports::ListReportsQueryResult>,
    ) -> Result<Self, Self::Error> {
        Ok(Self(
            value
                .into_iter()
                .map(ListReportsResponseBodyItem::try_from)
                .collect::<Result<Vec<_>, _>>()?,
        ))
    }
}

impl TryFrom<infra::table::reports::ListReportsQueryResult> for ListReportsResponseBodyItem {
    type Error = anyhow::Error;

    fn try_from(value: infra::table::reports::ListReportsQueryResult) -> Result<Self, Self::Error> {
        Ok(Self {
            report_id: Ksuid::from_str(&value.report_id).map_err(|e| anyhow::anyhow!(e))?,
            folder_id: value.folder_id.clone(),
            folder_name: value.folder_name,
            name: value.report_name,
            owner: value.report_owner,
            description: value.report_description,
            created_at: value.report_created_at,
            dashboards: vec![ReportDashboard {
                dashboard: value.dashboard_snowflake_id,
                folder: value.folder_id,
                tabs: json::from_value(value.report_dashboard_tab_names)
                    .map_err(|e| anyhow::anyhow!(e))?,
                timerange: convert_str_to_meta_report_timerange(value.report_dashboard_timerange)?,
            }],
            frequency: json::from_value(value.report_frequency).map_err(|e| anyhow::anyhow!(e))?,
            enabled: value.report_enabled,
            last_triggered_at: None,
            org_id: value.org_id,
        })
    }
}

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
pub struct ReportDashboard {
    dashboard: String,
    folder: String,
    tabs: Vec<String>,
    /// The timerange of dashboard data.
    #[serde(default)]
    timerange: ReportTimerange,
}

#[cfg(test)]
mod tests {
    use svix_ksuid::KsuidLike as _;

    use super::*;

    fn make_query_result(report_id: &str) -> infra::table::reports::ListReportsQueryResult {
        infra::table::reports::ListReportsQueryResult {
            report_id: report_id.to_string(),
            report_name: "my-report".to_string(),
            report_owner: None,
            report_description: None,
            report_created_at: 1_000_000,
            report_frequency: serde_json::json!({"interval": 1, "type": "weeks", "cron": "", "align_time": false}),
            report_dashboard_id: "dash-pk".to_string(),
            report_dashboard_tab_names: serde_json::json!([]),
            report_dashboard_timerange: serde_json::json!({"relative": {"period": "30m"}}),
            dashboard_snowflake_id: "snow-id".to_string(),
            org_id: "myorg".to_string(),
            folder_id: "folder-id".to_string(),
            folder_name: "My Folder".to_string(),
            report_enabled: true,
        }
    }

    #[test]
    fn test_try_from_valid_result() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let item = ListReportsResponseBodyItem::try_from(make_query_result(&id)).unwrap();
        assert_eq!(item.name, "my-report");
        assert_eq!(item.org_id, "myorg");
        assert_eq!(item.folder_id, "folder-id");
        assert_eq!(item.folder_name, "My Folder");
        assert!(item.enabled);
        assert!(item.owner.is_none());
    }

    #[test]
    fn test_try_from_invalid_report_id() {
        let result = ListReportsResponseBodyItem::try_from(make_query_result("not-a-ksuid"));
        assert!(result.is_err());
    }

    #[test]
    fn test_try_from_vec_valid() {
        let id1 = svix_ksuid::Ksuid::new(None, None).to_string();
        let id2 = svix_ksuid::Ksuid::new(None, None).to_string();
        let body = ListReportsResponseBody::try_from(vec![
            make_query_result(&id1),
            make_query_result(&id2),
        ])
        .unwrap();
        assert_eq!(body.0.len(), 2);
    }

    #[test]
    fn test_try_from_with_owner_and_description() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let mut result = make_query_result(&id);
        result.report_owner = Some("alice@example.com".to_string());
        result.report_description = Some("A test report".to_string());
        let item = ListReportsResponseBodyItem::try_from(result).unwrap();
        assert_eq!(item.owner, Some("alice@example.com".to_string()));
        assert_eq!(item.description, Some("A test report".to_string()));
    }

    #[test]
    fn test_try_from_dashboard_snowflake_id_propagated() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let item = ListReportsResponseBodyItem::try_from(make_query_result(&id)).unwrap();
        assert_eq!(item.dashboards.len(), 1);
        assert_eq!(item.dashboards[0].dashboard, "snow-id");
    }

    #[test]
    fn test_try_from_invalid_tab_names_json_fails() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let mut result = make_query_result(&id);
        result.report_dashboard_tab_names = serde_json::json!(42);
        let err = ListReportsResponseBodyItem::try_from(result);
        assert!(err.is_err());
    }

    #[test]
    fn test_try_from_invalid_frequency_json_fails() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let mut result = make_query_result(&id);
        result.report_frequency = serde_json::json!("not-a-valid-frequency");
        let err = ListReportsResponseBodyItem::try_from(result);
        assert!(err.is_err());
    }

    #[test]
    fn test_try_from_invalid_timerange_json_fails() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let mut result = make_query_result(&id);
        result.report_dashboard_timerange = serde_json::json!({"bad_key": true});
        let err = ListReportsResponseBodyItem::try_from(result);
        assert!(err.is_err());
    }

    #[test]
    fn test_try_from_vec_propagates_error_when_one_item_invalid() {
        let valid_id = svix_ksuid::Ksuid::new(None, None).to_string();
        let mut invalid = make_query_result(&valid_id);
        invalid.report_id = "not-a-ksuid".to_string();
        let result = ListReportsResponseBody::try_from(vec![make_query_result(&valid_id), invalid]);
        assert!(result.is_err());
    }

    #[test]
    fn test_try_from_last_triggered_at_is_always_none() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let item = ListReportsResponseBodyItem::try_from(make_query_result(&id)).unwrap();
        assert!(item.last_triggered_at.is_none());
    }
}
