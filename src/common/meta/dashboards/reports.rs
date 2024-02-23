// Copyright 2023 Zinc Labs Inc.
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

use chrono::Utc;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

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

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
pub struct ReportDashboardVariable {
    pub name: String,
    pub value: String,
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

#[derive(Serialize, Debug, Default, Deserialize, Clone, ToSchema)]
pub enum ReportTimerangeType {
    #[default]
    #[serde(rename = "relative")]
    Relative,
    #[serde(rename = "absolute")]
    Absolute,
}

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
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
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct ReportFrequency {
    /// Frequency interval in the `frequency_type` unit
    pub interval: i64,
    #[serde(rename = "type")]
    #[serde(default)]
    pub frequency_type: ReportFrequencyType,
}

impl Default for ReportFrequency {
    fn default() -> Self {
        Self {
            interval: 1,
            frequency_type: ReportFrequencyType::default(),
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
    /// User email for chromedriver login
    #[serde(default)]
    pub user: String,
    /// User password for chromedriver login
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub timezone: String,
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
            user: "".to_string(),
            password: "".to_string(),
            timezone: "".to_string(),
        }
    }
}
