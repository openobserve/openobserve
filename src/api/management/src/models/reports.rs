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
    meta::dashboards::reports::{Report, ReportFrequency, ReportTimerange},
    utils::json,
};
use infra::table::reports::{LastRun, convert_str_to_meta_report_timerange};
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
    /// True when the report has no recipients and only warms the dashboard cache.
    pub is_cached: bool,
    /// Deprecated: the scheduler's pickup time, set even when the send failed. Use `last_run_at`.
    pub last_triggered_at: Option<i64>,
    #[serde(flatten)]
    pub last_run: LastRunFields,
}

/// The outcome of a report's latest run and when the next one is due.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub struct LastRunFields {
    /// End of the latest run, Unix µs; null before the first run.
    pub last_run_at: Option<i64>,
    /// succeeded, error or skipped; null before the first run.
    pub last_run_status: Option<String>,
    pub last_run_error: Option<String>,
    /// Due time of the next scheduled run, Unix µs.
    pub next_run_at: Option<i64>,
}

impl LastRunFields {
    pub fn new(last_run: Option<LastRun>, next_run_at: Option<i64>) -> Self {
        let (last_run_at, last_run_status, last_run_error) = match last_run {
            Some(run) => (Some(run.at), Some(run.status), run.error),
            None => (None, None, None),
        };
        Self {
            last_run_at,
            last_run_status,
            last_run_error,
            next_run_at,
        }
    }
}

/// HTTP response body for the v2 `GetReport` endpoint: the report plus its last run.
#[derive(Clone, Debug, Serialize, ToSchema)]
pub struct GetReportResponseBody {
    #[serde(flatten)]
    pub report: Report,
    #[serde(flatten)]
    pub last_run: LastRunFields,
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
            is_cached: value
                .destinations
                .as_array()
                .is_none_or(|destinations| destinations.is_empty()),
            last_triggered_at: None,
            org_id: value.org_id,
            last_run: LastRunFields::new(
                value.last_run_at.map(|at| LastRun {
                    at,
                    status: value.last_run_status.unwrap_or_default(),
                    error: value.last_run_error,
                }),
                None,
            ),
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
            destinations: serde_json::json!([{"email": "a@b.c"}]),
            last_run_at: None,
            last_run_status: None,
            last_run_error: None,
        }
    }

    #[test]
    fn test_try_from_carries_the_last_run() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let mut row = make_query_result(&id);
        row.last_run_at = Some(42);
        row.last_run_status = Some("error".to_string());
        row.last_run_error = Some("boom".to_string());
        let item = ListReportsResponseBodyItem::try_from(row).unwrap();
        let json = serde_json::to_value(&item).unwrap();
        assert_eq!(json["last_run_at"], 42);
        assert_eq!(json["last_run_status"], "error");
        assert_eq!(json["last_run_error"], "boom");
        assert!(json["next_run_at"].is_null());
    }

    #[test]
    fn test_is_cached_follows_the_destinations_column() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let emailed = ListReportsResponseBodyItem::try_from(make_query_result(&id)).unwrap();
        assert!(!emailed.is_cached);
        let mut row = make_query_result(&id);
        row.destinations = serde_json::json!([]);
        assert!(
            ListReportsResponseBodyItem::try_from(row)
                .unwrap()
                .is_cached
        );
    }

    #[test]
    fn test_never_run_report_has_null_last_run() {
        let id = svix_ksuid::Ksuid::new(None, None).to_string();
        let item = ListReportsResponseBodyItem::try_from(make_query_result(&id)).unwrap();
        assert_eq!(item.last_run, LastRunFields::default());
    }

    #[test]
    fn test_get_response_keeps_the_report_fields_at_the_top_level() {
        let body = GetReportResponseBody {
            report: Report {
                name: "r".to_string(),
                ..Default::default()
            },
            last_run: LastRunFields::new(None, Some(7)),
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["name"], "r");
        assert_eq!(json["next_run_at"], 7);
        assert!(json["last_run_status"].is_null());
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
