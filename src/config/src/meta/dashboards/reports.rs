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

#[derive(Serialize, Debug, Default, Deserialize, Clone, ToSchema, PartialEq)]
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
#[serde(rename_all = "lowercase")]
pub enum ReportTimerangeType {
    #[default]
    Relative,
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
#[serde(rename_all = "lowercase")]
pub enum ReportFrequencyType {
    Once,
    Hours,
    Days,
    #[default]
    Weeks,
    Months,
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
    pub fn into_params(self, org_id: &str) -> ListReportsParams {
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

    #[test]
    fn test_report_destination_serialization() {
        let destination = ReportDestination::Email("test@example.com".to_string());
        let serialized = serde_json::to_string(&destination).unwrap();
        assert_eq!(serialized, r#"{"email":"test@example.com"}"#);

        let deserialized: ReportDestination = serde_json::from_str(&serialized).unwrap();
        assert!(matches!(deserialized, ReportDestination::Email(_)));
    }

    #[test]
    fn test_report_dashboard_variable_default() {
        let variable = ReportDashboardVariable {
            key: "test_key".to_string(),
            value: "test_value".to_string(),
            id: Some("test_id".to_string()),
        };

        assert_eq!(variable.key, "test_key");
        assert_eq!(variable.value, "test_value");
        assert_eq!(variable.id, Some("test_id".to_string()));
    }

    #[test]
    fn test_report_dashboard_serialization() {
        let dashboard = ReportDashboard {
            dashboard: "test_dashboard".to_string(),
            folder: "test_folder".to_string(),
            tabs: vec!["tab1".to_string(), "tab2".to_string()],
            variables: vec![ReportDashboardVariable {
                key: "var1".to_string(),
                value: "value1".to_string(),
                id: None,
            }],
            timerange: ReportTimerange::default(),
        };

        let serialized = serde_json::to_string(&dashboard).unwrap();
        let deserialized: ReportDashboard = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.dashboard, "test_dashboard");
        assert_eq!(deserialized.folder, "test_folder");
        assert_eq!(deserialized.tabs.len(), 2);
        assert_eq!(deserialized.variables.len(), 1);
    }

    #[test]
    fn test_report_timerange_default() {
        let timerange = ReportTimerange::default();
        assert_eq!(timerange.range_type, ReportTimerangeType::Relative);
        assert_eq!(timerange.period, "1w");
        assert_eq!(timerange.from, 0);
        assert_eq!(timerange.to, 0);
    }

    #[test]
    fn test_report_timerange_absolute() {
        let timerange = ReportTimerange {
            range_type: ReportTimerangeType::Absolute,
            period: "".to_string(),
            from: 1640995200000000, // 2022-01-01 00:00:00 UTC in microseconds
            to: 1641081600000000,   // 2022-01-02 00:00:00 UTC in microseconds
        };

        assert_eq!(timerange.range_type, ReportTimerangeType::Absolute);
        assert_eq!(timerange.from, 1640995200000000);
        assert_eq!(timerange.to, 1641081600000000);
    }

    #[test]
    fn test_report_timerange_type_default() {
        assert_eq!(
            ReportTimerangeType::default(),
            ReportTimerangeType::Relative
        );
    }

    #[test]
    fn test_report_frequency_default() {
        let frequency = ReportFrequency::default();
        assert_eq!(frequency.interval, 1);
        assert_eq!(frequency.cron, "");
        assert_eq!(frequency.frequency_type, ReportFrequencyType::Weeks);
        assert_eq!(frequency.align_time, default_align_time());
    }

    #[test]
    fn test_report_frequency_cron() {
        let frequency = ReportFrequency {
            interval: 0,
            cron: "0 0 * * *".to_string(),
            frequency_type: ReportFrequencyType::Cron,
            align_time: false,
        };

        assert_eq!(frequency.cron, "0 0 * * *");
        assert_eq!(frequency.frequency_type, ReportFrequencyType::Cron);
        assert!(!frequency.align_time);
    }

    #[test]
    fn test_report_default() {
        let report = Report::default();
        assert!(report.name.is_empty());
        assert!(report.title.is_empty());
        assert!(report.org_id.is_empty());
        assert!(report.destinations.is_empty());
        assert!(report.dashboards.is_empty());
        assert!(report.description.is_empty());
        assert!(report.message.is_empty());
        assert!(!report.enabled);
        assert_eq!(report.media_type, ReportMediaType::Pdf);
        assert!(report.timezone.is_empty());
        assert_eq!(report.tz_offset, 0);
        assert!(report.updated_at.is_none());
        assert!(report.owner.is_empty());
        assert!(report.last_edited_by.is_empty());
    }

    #[test]
    fn test_report_with_data() {
        let now = Utc::now().timestamp_micros();
        let report = Report {
            name: "test_report".to_string(),
            title: "Test Report".to_string(),
            org_id: "test_org".to_string(),
            frequency: ReportFrequency::default(),
            start: now,
            dashboards: vec![ReportDashboard {
                dashboard: "dashboard1".to_string(),
                folder: "folder1".to_string(),
                tabs: vec!["tab1".to_string()],
                variables: vec![],
                timerange: ReportTimerange::default(),
            }],
            destinations: vec![ReportDestination::Email("test@example.com".to_string())],
            description: "Test description".to_string(),
            message: "Test message".to_string(),
            enabled: true,
            media_type: ReportMediaType::Pdf,
            timezone: "UTC".to_string(),
            tz_offset: 0,
            created_at: datetime_now(),
            updated_at: None,
            owner: "test_owner".to_string(),
            last_edited_by: "test_editor".to_string(),
        };

        assert_eq!(report.name, "test_report");
        assert_eq!(report.title, "Test Report");
        assert_eq!(report.org_id, "test_org");
        assert_eq!(report.start, now);
        assert_eq!(report.dashboards.len(), 1);
        assert_eq!(report.destinations.len(), 1);
        assert_eq!(report.description, "Test description");
        assert_eq!(report.message, "Test message");
        assert!(report.enabled);
        assert_eq!(report.timezone, "UTC");
        assert_eq!(report.tz_offset, 0);
        assert_eq!(report.owner, "test_owner");
        assert_eq!(report.last_edited_by, "test_editor");
    }

    #[test]
    fn test_report_serialization() {
        let report = Report {
            name: "test_report".to_string(),
            title: "Test Report".to_string(),
            org_id: "test_org".to_string(),
            frequency: ReportFrequency::default(),
            start: Utc::now().timestamp_micros(),
            dashboards: vec![],
            destinations: vec![ReportDestination::Email("test@example.com".to_string())],
            description: "Test description".to_string(),
            message: "Test message".to_string(),
            enabled: true,
            media_type: ReportMediaType::Pdf,
            timezone: "UTC".to_string(),
            tz_offset: 0,
            created_at: datetime_now(),
            updated_at: None,
            owner: "test_owner".to_string(),
            last_edited_by: "test_editor".to_string(),
        };

        let serialized = serde_json::to_string(&report).unwrap();
        let deserialized: Report = serde_json::from_str(&serialized).unwrap();

        assert_eq!(deserialized.name, "test_report");
        assert_eq!(deserialized.title, "Test Report");
        assert_eq!(deserialized.org_id, "test_org");
        assert!(deserialized.enabled);
    }

    #[test]
    fn test_report_email_details() {
        let email_details = ReportEmailDetails {
            recipients: vec![
                "user1@example.com".to_string(),
                "user2@example.com".to_string(),
            ],
            title: "Test Email".to_string(),
            name: "test_name".to_string(),
            message: "Test message".to_string(),
            dashb_url: "https://example.com/dashboard".to_string(),
        };

        assert_eq!(email_details.recipients.len(), 2);
        assert_eq!(email_details.title, "Test Email");
        assert_eq!(email_details.name, "test_name");
        assert_eq!(email_details.message, "Test message");
        assert_eq!(email_details.dashb_url, "https://example.com/dashboard");
    }

    #[test]
    fn test_http_report_payload() {
        let email_details = ReportEmailDetails {
            recipients: vec!["test@example.com".to_string()],
            title: "Test".to_string(),
            name: "test".to_string(),
            message: "test".to_string(),
            dashb_url: "https://example.com".to_string(),
        };

        let payload = HttpReportPayload {
            dashboards: vec![ReportDashboard {
                dashboard: "dashboard1".to_string(),
                folder: "folder1".to_string(),
                tabs: vec!["tab1".to_string()],
                variables: vec![],
                timerange: ReportTimerange::default(),
            }],
            email_details: email_details.clone(),
        };

        assert_eq!(payload.dashboards.len(), 1);
        assert_eq!(payload.email_details.recipients, email_details.recipients);
    }

    #[test]
    fn test_list_reports_params_new() {
        let params = ListReportsParams::new("test_org");
        assert_eq!(params.org_id, "test_org");
        assert!(params.folder_snowflake_id.is_none());
        assert!(params.dashboard_snowflake_id.is_none());
        assert!(params.page_size_and_idx.is_none());
        assert!(params.has_destinations.is_none());
    }

    #[test]
    fn test_list_reports_params_builder_methods() {
        let params = ListReportsParams::new("test_org")
            .in_folder("folder_123")
            .for_dashboard("dashboard_456")
            .has_destinations(true)
            .paginate(10, 0);

        assert_eq!(params.org_id, "test_org");
        assert_eq!(params.folder_snowflake_id, Some("folder_123".to_string()));
        assert_eq!(
            params.dashboard_snowflake_id,
            Some("dashboard_456".to_string())
        );
        assert_eq!(params.has_destinations, Some(true));
        assert_eq!(params.page_size_and_idx, Some((10, 0)));
    }

    #[test]
    fn test_list_report_item() {
        let item = ListReportItem {
            name: "test_report".to_string(),
            owner: "test_owner".to_string(),
            description: Some("Test description".to_string()),
            last_triggered_at: 1640995200000000,
        };

        assert_eq!(item.name, "test_report");
        assert_eq!(item.owner, "test_owner");
        assert_eq!(item.description, Some("Test description".to_string()));
        assert_eq!(item.last_triggered_at, 1640995200000000);
    }

    #[test]
    fn test_report_list_filters() {
        let filters = ReportListFilters {
            dashboard: Some("dashboard_123".to_string()),
            folder: Some("folder_456".to_string()),
            destination_less: Some(true),
        };

        let params = filters.into_params("test_org");
        assert_eq!(params.org_id, "test_org");
        assert_eq!(
            params.dashboard_snowflake_id,
            Some("dashboard_123".to_string())
        );
        assert_eq!(params.folder_snowflake_id, Some("folder_456".to_string()));
        assert_eq!(params.has_destinations, Some(false)); // destination_less = true means has_destinations = false
    }

    #[test]
    fn test_report_timerange_equality() {
        let timerange1 = ReportTimerange {
            range_type: ReportTimerangeType::Relative,
            period: "1w".to_string(),
            from: 0,
            to: 0,
        };

        let timerange2 = ReportTimerange {
            range_type: ReportTimerangeType::Relative,
            period: "1w".to_string(),
            from: 0,
            to: 0,
        };

        assert_eq!(timerange1, timerange2);
    }

    #[test]
    fn test_report_frequency_type_equality() {
        assert_eq!(ReportFrequencyType::Once, ReportFrequencyType::Once);
        assert_ne!(ReportFrequencyType::Once, ReportFrequencyType::Weeks);
        assert_ne!(ReportFrequencyType::Hours, ReportFrequencyType::Days);
    }

    #[test]
    fn test_report_media_type_clone() {
        let media_type = ReportMediaType::Pdf;
        let cloned = media_type.clone();
        assert_eq!(media_type, cloned);
    }

    #[test]
    fn test_report_dashboard_variable_equality() {
        let var1 = ReportDashboardVariable {
            key: "test_key".to_string(),
            value: "test_value".to_string(),
            id: Some("test_id".to_string()),
        };

        let var2 = ReportDashboardVariable {
            key: "test_key".to_string(),
            value: "test_value".to_string(),
            id: Some("test_id".to_string()),
        };

        assert_eq!(var1, var2);
    }

    #[test]
    fn test_report_dashboard_variable_without_id() {
        let variable = ReportDashboardVariable {
            key: "test_key".to_string(),
            value: "test_value".to_string(),
            id: None,
        };

        assert_eq!(variable.key, "test_key");
        assert_eq!(variable.value, "test_value");
        assert!(variable.id.is_none());
    }

    #[test]
    fn test_report_timerange_type_serialization() {
        let relative = ReportTimerangeType::Relative;
        let absolute = ReportTimerangeType::Absolute;

        let relative_json = serde_json::to_string(&relative).unwrap();
        let absolute_json = serde_json::to_string(&absolute).unwrap();

        assert_eq!(relative_json, r#""relative""#);
        assert_eq!(absolute_json, r#""absolute""#);
    }

    #[test]
    fn test_report_frequency_type_serialization() {
        let once = ReportFrequencyType::Once;
        let weeks = ReportFrequencyType::Weeks;
        let cron = ReportFrequencyType::Cron;

        let once_json = serde_json::to_string(&once).unwrap();
        let weeks_json = serde_json::to_string(&weeks).unwrap();
        let cron_json = serde_json::to_string(&cron).unwrap();

        assert_eq!(once_json, r#""once""#);
        assert_eq!(weeks_json, r#""weeks""#);
        assert_eq!(cron_json, r#""cron""#);
    }
}
