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
