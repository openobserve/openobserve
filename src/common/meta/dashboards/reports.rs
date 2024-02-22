use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
pub enum ReportDestination {
    Email(String), // Supports email only
}

#[derive(Serialize, Debug, Default, Deserialize, Clone, ToSchema)]
pub enum ReportMediaType {
    #[default]
    Pdf, // Supports Pdf only
}

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
pub enum ReportDashboardTab {
    One(String), // Supports only one tab id
}

#[derive(Serialize, Debug, Deserialize, Clone, ToSchema)]
pub struct ReportDashboard {
    pub dashboard: String,
    pub folder: String,
    pub tabs: ReportDashboardTab,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct Report {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub org_id: String,
    /// The timerange of dashboard data.
    #[serde(default)]
    pub timerange: i64,
    /// Frequency of report generation. E.g. - Weekly.
    #[serde(default)]
    pub frequency: i64,
    /// Start time of report generation.
    #[serde(default)]
    pub start: i64,
    pub dashboards: Vec<ReportDashboard>,
    pub destinations: Vec<ReportDestination>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub media_type: ReportMediaType,
}

impl Default for Report {
    fn default() -> Self {
        Self {
            name: "".to_string(),
            org_id: "".to_string(),
            timerange: Duration::days(7).num_microseconds().unwrap(), // 1 week
            frequency: Duration::days(7).num_microseconds().unwrap(), // 1 week
            start: Utc::now().timestamp_micros(),                     // Now
            destinations: vec![],
            dashboards: vec![],
            description: "".to_string(),
            enabled: false,
            media_type: ReportMediaType::default(),
        }
    }
}
