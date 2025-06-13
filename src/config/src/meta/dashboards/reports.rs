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

use super::datetime_now;
use crate::meta::alerts::default_align_time;

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
pub enum ReportDestination {
    #[serde(rename = "email")]
    Email(String), // Supports email only
}

#[derive(Serialize, Debug, Default, Deserialize, Clone, ToSchema)]
pub enum ReportMediaType {
    #[default]
    #[serde(rename = "pdf")]
    Pdf, // Supports Pdf only
}

#[derive(Serialize, Debug, Default, Deserialize, Clone, ToSchema, PartialEq, Eq)]
pub struct ReportDashboardVariable {
    pub key: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
pub struct ReportDashboard {
    pub dashboard: String,
    pub folder: String,
    pub tabs: Vec<String>,
    #[serde(default)]
    pub variables: Vec<ReportDashboardVariable>,
    /// The timerange of dashboard data.
    #[serde(default)]
    pub timerange: ReportTimerange,
}

#[derive(Serialize, Debug, Default, Deserialize, Clone, ToSchema, PartialEq, Eq)]
pub enum ReportTimerangeType {
    #[default]
    #[serde(rename = "relative")]
    Relative,
    #[serde(rename = "absolute")]
    Absolute,
}

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema, PartialEq, Eq)]
pub struct ReportTimerange {
    #[serde(rename = "type")]
    pub range_type: ReportTimerangeType,
    pub period: String, // 15m, 4M etc. For relative.
    pub from: i64,      // For absolute, in microseconds
    pub to: i64,        // For absolute, in microseconds
}

impl Default for ReportTimerange {
    fn default() -> Self {
        Self {
            range_type: ReportTimerangeType::default(),
            period: "1w".to_string(),
            from: 0,
            to: 0,
        }
    }
}

#[derive(Serialize, Debug, Default, Deserialize, PartialEq, Clone, ToSchema)]
pub enum ReportFrequencyType {
    #[serde(rename = "once")]
    Once,
    #[serde(rename = "hours")]
    Hours,
    #[serde(rename = "days")]
    Days,
    #[serde(rename = "weeks")]
    #[default]
    Weeks,
    #[serde(rename = "months")]
    Months,
    #[serde(rename = "cron")]
    Cron,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ReportFrequency {
    /// Frequency interval in the `frequency_type` unit
    #[serde(default)]
    pub interval: i64,
    /// Cron expression
    #[serde(default)]
    pub cron: String,
    #[serde(rename = "type")]
    #[serde(default)]
    pub frequency_type: ReportFrequencyType,
    #[serde(default = "default_align_time")]
    pub align_time: bool,
}

impl Default for ReportFrequency {
    fn default() -> Self {
        Self {
            interval: 1,
            cron: "".to_string(),
            frequency_type: Default::default(),
            align_time: default_align_time(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub title: String,
    pub org_id: String,
    /// Frequency of report generation. E.g. - Weekly.
    #[serde(default)]
    pub frequency: ReportFrequency,
    /// Start time of report generation in UNIX microseconds.
    #[serde(default)]
    pub start: i64,
    pub dashboards: Vec<ReportDashboard>,
    pub destinations: Vec<ReportDestination>,
    #[serde(default)]
    pub description: String,
    /// Message to include in the email
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub media_type: ReportMediaType,
    #[serde(default)]
    pub timezone: String,
    /// Fixed timezone offset in minutes
    #[serde(default)]
    #[serde(rename = "timezoneOffset")]
    pub tz_offset: i32,
    #[serde(default = "datetime_now")]
    #[schema(value_type = String, format = DateTime)]
    pub created_at: DateTime<FixedOffset>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = String, format = DateTime)]
    pub updated_at: Option<DateTime<FixedOffset>>,
    pub owner: String,
    pub last_edited_by: String,
}

impl Default for Report {
    fn default() -> Self {
        Self {
            name: "".to_string(),
            title: "".to_string(),
            org_id: "".to_string(),
            frequency: ReportFrequency::default(),
            start: Utc::now().timestamp_micros(), // Now
            destinations: vec![],
            dashboards: vec![],
            description: "".to_string(),
            message: "".to_string(),
            enabled: false,
            media_type: ReportMediaType::default(),
            timezone: "".to_string(),
            tz_offset: 0, // UTC
            created_at: datetime_now(),
            updated_at: None,
            owner: "".to_string(),
            last_edited_by: "".to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[cfg_attr(test, derive(PartialEq))]
pub struct ReportEmailDetails {
    #[serde(alias = "recepients")]
    pub recipients: Vec<String>,
    pub title: String,
    pub name: String,
    pub message: String,
    pub dashb_url: String,
}

#[derive(Serialize, Debug, Deserialize, Clone)]
pub struct HttpReportPayload {
    pub dashboards: Vec<ReportDashboard>,
    pub email_details: ReportEmailDetails,
}

/// Parameters for listing reports.
#[derive(Debug, Clone)]
pub struct ListReportsParams {
    /// The org ID primary key with which to filter reports.
    pub org_id: String,

    /// The optional folder ID snowflake primary key with which to filter reports.
    ///
    /// When set the list will only include reports that belong to the specified reports folder.
    pub folder_snowflake_id: Option<String>,

    /// The optional dashboard ID snowflake primary key with which to filter reports.
    ///
    /// When set the list will only include reports that are associated with the specified
    /// dashboard.
    pub dashboard_snowflake_id: Option<String>,

    /// The optional page size and page index of results to retrieve.
    pub page_size_and_idx: Option<(u64, u64)>,

    /// When set to `true` the list will only include reports that have destinations. When set to
    /// `false` the list will only include reports that do not have destinations.
    pub has_destinations: Option<bool>,
}

impl ListReportsParams {
    /// Returns new parameters to list reports for the given org ID primary key.
    pub fn new(org_id: &str) -> Self {
        Self {
            org_id: org_id.to_owned(),
            folder_snowflake_id: None,
            dashboard_snowflake_id: None,
            page_size_and_idx: None,
            has_destinations: None,
        }
    }

    /// Filter reports that belong to the specified reports folder.
    pub fn in_folder(mut self, folder_snowflake_id: &str) -> Self {
        self.folder_snowflake_id = Some(folder_snowflake_id.to_string());
        self
    }

    /// Filter reports by that are associated with the specified dashboard.
    pub fn for_dashboard(mut self, dashboard_snowflake_id: &str) -> Self {
        self.dashboard_snowflake_id = Some(dashboard_snowflake_id.to_string());
        self
    }

    /// Filter reports by whether they have any destinations or not.
    pub fn has_destinations(mut self, has_destinations: bool) -> Self {
        self.has_destinations = Some(has_destinations);
        self
    }

    /// Paginate the results by the given page size and page index.
    pub fn paginate(mut self, page_size: u64, page_idx: u64) -> Self {
        self.page_size_and_idx = Some((page_size, page_idx));
        self
    }
}

/// An item in a list of reports which only includes a subset of all the report fields.
#[derive(Debug, Clone)]
pub struct ListReportItem {
    pub name: String,
    pub owner: String,
    pub description: Option<String>,

    /// The last time the report was triggered in Unix microseconds.
    pub last_triggered_at: i64,
}

#[derive(Debug, Clone)]
pub struct ReportListFilters {
    pub dashboard: Option<String>,
    pub folder: Option<String>,
    pub destination_less: Option<bool>,
}

impl ReportListFilters {
    pub fn into_parmas(self, org_id: &str) -> ListReportsParams {
        ListReportsParams {
            org_id: org_id.to_string(),
            folder_snowflake_id: self.folder,
            dashboard_snowflake_id: self.dashboard,
            has_destinations: self.destination_less.map(|v| !v),
            page_size_and_idx: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_recipients_backwards_compatibility() {
        // The serde alias allows loading data created before the typo was fixed.
        let email_details = ReportEmailDetails {
            recipients: vec!["foo@example.com".to_string()],
            title: "title".to_string(),
            name: "name".to_string(),
            message: "message".to_string(),
            dashb_url: "https://example.com/dashb_url".to_string(),
        };
        let json = serde_json::to_string(&email_details).unwrap();
        let json_using_alias = json.replace("recipients", "recepients");
        let email_details_from_alias: ReportEmailDetails =
            serde_json::from_str(&json_using_alias).unwrap();
        assert_eq!(email_details, email_details_from_alias);
    }
}
