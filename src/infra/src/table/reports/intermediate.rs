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

//! Defines intermediate data types for translating between service layer data
//! structures and the database.

use std::num::TryFromIntError;

use config::{
    meta::{
        alerts::default_align_time,
        dashboards::reports::{
            ReportDashboardVariable as MetaReportDashboardVariable,
            ReportDestination as MetaReportDestination, ReportFrequency as MetaReportFrequency,
            ReportFrequencyType as MetaReportFrequencyType, ReportTimerange as MetaReportTimeRange,
            ReportTimerangeType as MetaReportTimeRangeType,
        },
    },
    utils::json,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct ReportDestinations(pub Vec<ReportDestination>);

impl From<ReportDestinations> for Vec<MetaReportDestination> {
    fn from(value: ReportDestinations) -> Self {
        value.0.into_iter().map(|d| d.into()).collect()
    }
}

impl From<Vec<MetaReportDestination>> for ReportDestinations {
    fn from(value: Vec<MetaReportDestination>) -> Self {
        Self(value.into_iter().map(|d| d.into()).collect())
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportDestination {
    Email(String),
}

impl From<ReportDestination> for MetaReportDestination {
    fn from(value: ReportDestination) -> Self {
        match value {
            ReportDestination::Email(email) => Self::Email(email),
        }
    }
}

impl From<MetaReportDestination> for ReportDestination {
    fn from(value: MetaReportDestination) -> Self {
        match value {
            MetaReportDestination::Email(email) => Self::Email(email),
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ReportFrequencyType {
    Once,
    Hours,
    Days,
    #[default]
    Weeks,
    Months,
    Cron,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ReportFrequency {
    /// Frequency interval in the `frequency_type` unit
    #[serde(default)]
    pub interval: u32,
    /// Cron expression
    #[serde(default)]
    pub cron: String,
    #[serde(default)]
    #[serde(rename = "type")]
    pub frequency_type: ReportFrequencyType,
    #[serde(default = "default_align_time")]
    pub align_time: bool,
}

impl TryFrom<MetaReportFrequency> for ReportFrequency {
    type Error = TryFromIntError;

    fn try_from(value: MetaReportFrequency) -> Result<Self, Self::Error> {
        let freq = Self {
            interval: value.interval.try_into()?,
            cron: value.cron,
            frequency_type: value.frequency_type.into(),
            align_time: value.align_time,
        };
        Ok(freq)
    }
}

impl From<MetaReportFrequencyType> for ReportFrequencyType {
    fn from(value: MetaReportFrequencyType) -> Self {
        match value {
            MetaReportFrequencyType::Once => Self::Once,
            MetaReportFrequencyType::Hours => Self::Hours,
            MetaReportFrequencyType::Days => Self::Days,
            MetaReportFrequencyType::Weeks => Self::Weeks,
            MetaReportFrequencyType::Months => Self::Months,
            MetaReportFrequencyType::Cron => Self::Cron,
        }
    }
}

impl From<ReportFrequency> for MetaReportFrequency {
    fn from(value: ReportFrequency) -> Self {
        match value.frequency_type {
            ReportFrequencyType::Once => Self {
                frequency_type: MetaReportFrequencyType::Once,
                interval: 0,
                cron: "".to_string(),
                align_time: value.align_time,
            },
            ReportFrequencyType::Hours => Self {
                frequency_type: MetaReportFrequencyType::Hours,
                interval: value.interval.into(),
                cron: "".to_string(),
                align_time: value.align_time,
            },
            ReportFrequencyType::Days => Self {
                frequency_type: MetaReportFrequencyType::Days,
                interval: value.interval.into(),
                cron: "".to_string(),
                align_time: value.align_time,
            },
            ReportFrequencyType::Weeks => Self {
                frequency_type: MetaReportFrequencyType::Weeks,
                interval: value.interval.into(),
                cron: "".to_string(),
                align_time: value.align_time,
            },
            ReportFrequencyType::Months => Self {
                frequency_type: MetaReportFrequencyType::Months,
                interval: value.interval.into(),
                cron: "".to_string(),
                align_time: value.align_time,
            },
            ReportFrequencyType::Cron => Self {
                frequency_type: MetaReportFrequencyType::Cron,
                interval: 0,
                cron: value.cron,
                align_time: value.align_time,
            },
        }
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct TabNames(pub Vec<String>);

impl From<TabNames> for Vec<String> {
    fn from(value: TabNames) -> Self {
        value.0
    }
}

impl From<Vec<String>> for TabNames {
    fn from(value: Vec<String>) -> Self {
        Self(value)
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct ReportDashboardVariables(pub Vec<ReportDashboardVariable>);

impl From<ReportDashboardVariables> for Vec<MetaReportDashboardVariable> {
    fn from(value: ReportDashboardVariables) -> Self {
        value.0.into_iter().map(|v| v.into()).collect()
    }
}

impl From<Vec<MetaReportDashboardVariable>> for ReportDashboardVariables {
    fn from(value: Vec<MetaReportDashboardVariable>) -> Self {
        Self(value.into_iter().map(|v| v.into()).collect())
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct ReportDashboardVariable {
    pub key: String,
    pub value: String,
    pub id: Option<String>,
}

impl From<ReportDashboardVariable> for MetaReportDashboardVariable {
    fn from(value: ReportDashboardVariable) -> Self {
        Self {
            key: value.key,
            value: value.value,
            id: value.id,
        }
    }
}

impl From<MetaReportDashboardVariable> for ReportDashboardVariable {
    fn from(value: MetaReportDashboardVariable) -> Self {
        Self {
            key: value.key,
            value: value.value,
            id: value.id,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReportTimerange {
    Relative { period: String },
    Absolute { from: i64, to: i64 },
}

impl From<ReportTimerange> for MetaReportTimeRange {
    fn from(value: ReportTimerange) -> Self {
        match value {
            ReportTimerange::Relative { period } => Self {
                range_type: MetaReportTimeRangeType::Relative,
                period,
                from: 0,
                to: 0,
            },
            ReportTimerange::Absolute { from, to } => Self {
                range_type: MetaReportTimeRangeType::Absolute,
                period: "".to_string(),
                from,
                to,
            },
        }
    }
}

impl From<MetaReportTimeRange> for ReportTimerange {
    fn from(value: MetaReportTimeRange) -> Self {
        match value.range_type {
            MetaReportTimeRangeType::Relative => Self::Relative {
                period: value.period,
            },
            MetaReportTimeRangeType::Absolute => Self::Absolute {
                from: value.from,
                to: value.to,
            },
        }
    }
}

pub fn convert_str_to_meta_report_timerange(
    value: serde_json::Value,
) -> Result<MetaReportTimeRange, anyhow::Error> {
    let timerange: ReportTimerange = json::from_value(value).map_err(|e| anyhow::anyhow!(e))?;
    let timerange: MetaReportTimeRange = timerange.into();
    Ok(timerange)
}

#[cfg(test)]
mod tests {
    use config::meta::dashboards::reports::{
        ReportDashboardVariable as MetaReportDashboardVariable,
        ReportDestination as MetaReportDestination, ReportFrequency as MetaReportFrequency,
        ReportFrequencyType as MetaReportFrequencyType, ReportTimerange as MetaReportTimeRange,
        ReportTimerangeType as MetaReportTimeRangeType,
    };

    use super::*;

    // ── ReportFrequencyType conversions ──────────────────────────────────────

    #[test]
    fn frequency_type_once_roundtrip() {
        let meta = MetaReportFrequencyType::Once;
        let db: ReportFrequencyType = meta.into();
        assert!(matches!(db, ReportFrequencyType::Once));
    }

    #[test]
    fn frequency_type_hours_roundtrip() {
        let meta = MetaReportFrequencyType::Hours;
        let db: ReportFrequencyType = meta.into();
        assert!(matches!(db, ReportFrequencyType::Hours));
    }

    #[test]
    fn frequency_type_days_roundtrip() {
        let meta = MetaReportFrequencyType::Days;
        let db: ReportFrequencyType = meta.into();
        assert!(matches!(db, ReportFrequencyType::Days));
    }

    #[test]
    fn frequency_type_weeks_roundtrip() {
        let meta = MetaReportFrequencyType::Weeks;
        let db: ReportFrequencyType = meta.into();
        assert!(matches!(db, ReportFrequencyType::Weeks));
    }

    #[test]
    fn frequency_type_months_roundtrip() {
        let meta = MetaReportFrequencyType::Months;
        let db: ReportFrequencyType = meta.into();
        assert!(matches!(db, ReportFrequencyType::Months));
    }

    #[test]
    fn frequency_type_cron_roundtrip() {
        let meta = MetaReportFrequencyType::Cron;
        let db: ReportFrequencyType = meta.into();
        assert!(matches!(db, ReportFrequencyType::Cron));
    }

    // ── ReportFrequency → MetaReportFrequency ────────────────────────────────

    #[test]
    fn frequency_once_to_meta() {
        let db = ReportFrequency {
            interval: 0,
            cron: String::new(),
            frequency_type: ReportFrequencyType::Once,
            align_time: false,
        };
        let meta: MetaReportFrequency = db.into();
        assert_eq!(meta.frequency_type, MetaReportFrequencyType::Once);
        assert_eq!(meta.interval, 0);
    }

    #[test]
    fn frequency_hours_to_meta() {
        let db = ReportFrequency {
            interval: 2,
            cron: String::new(),
            frequency_type: ReportFrequencyType::Hours,
            align_time: false,
        };
        let meta: MetaReportFrequency = db.into();
        assert_eq!(meta.frequency_type, MetaReportFrequencyType::Hours);
        assert_eq!(meta.interval, 2);
    }

    #[test]
    fn frequency_days_to_meta() {
        let db = ReportFrequency {
            interval: 3,
            cron: String::new(),
            frequency_type: ReportFrequencyType::Days,
            align_time: false,
        };
        let meta: MetaReportFrequency = db.into();
        assert_eq!(meta.frequency_type, MetaReportFrequencyType::Days);
        assert_eq!(meta.interval, 3);
    }

    #[test]
    fn frequency_weeks_to_meta() {
        let db = ReportFrequency {
            interval: 1,
            cron: String::new(),
            frequency_type: ReportFrequencyType::Weeks,
            align_time: true,
        };
        let meta: MetaReportFrequency = db.into();
        assert_eq!(meta.frequency_type, MetaReportFrequencyType::Weeks);
        assert_eq!(meta.interval, 1);
        assert!(meta.align_time);
    }

    #[test]
    fn frequency_months_to_meta() {
        let db = ReportFrequency {
            interval: 6,
            cron: String::new(),
            frequency_type: ReportFrequencyType::Months,
            align_time: false,
        };
        let meta: MetaReportFrequency = db.into();
        assert_eq!(meta.frequency_type, MetaReportFrequencyType::Months);
        assert_eq!(meta.interval, 6);
    }

    #[test]
    fn frequency_cron_to_meta() {
        let db = ReportFrequency {
            interval: 0,
            cron: "0 9 * * 1".to_string(),
            frequency_type: ReportFrequencyType::Cron,
            align_time: false,
        };
        let meta: MetaReportFrequency = db.into();
        assert_eq!(meta.frequency_type, MetaReportFrequencyType::Cron);
        assert_eq!(meta.cron, "0 9 * * 1");
    }

    // ── MetaReportFrequency → ReportFrequency (TryFrom) ──────────────────────

    #[test]
    fn meta_frequency_to_db_ok() {
        let meta = MetaReportFrequency {
            frequency_type: MetaReportFrequencyType::Hours,
            interval: 4,
            cron: String::new(),
            align_time: false,
        };
        let db: ReportFrequency = meta.try_into().unwrap();
        assert_eq!(db.interval, 4);
        assert!(matches!(db.frequency_type, ReportFrequencyType::Hours));
    }

    // ── ReportDestination conversions ────────────────────────────────────────

    #[test]
    fn destination_email_db_to_meta() {
        let db = ReportDestination::Email("user@example.com".to_string());
        let meta: MetaReportDestination = db.into();
        assert!(matches!(meta, MetaReportDestination::Email(e) if e == "user@example.com"));
    }

    #[test]
    fn destination_email_meta_to_db() {
        let meta = MetaReportDestination::Email("user@example.com".to_string());
        let db: ReportDestination = meta.into();
        assert!(matches!(db, ReportDestination::Email(e) if e == "user@example.com"));
    }

    #[test]
    fn destinations_vec_roundtrip() {
        let meta_vec = vec![MetaReportDestination::Email("a@b.com".to_string())];
        let db: ReportDestinations = meta_vec.into();
        let back: Vec<MetaReportDestination> = db.into();
        assert!(matches!(&back[0], MetaReportDestination::Email(e) if e == "a@b.com"));
    }

    // ── ReportTimerange conversions ──────────────────────────────────────────

    #[test]
    fn timerange_relative_db_to_meta() {
        let db = ReportTimerange::Relative {
            period: "15m".to_string(),
        };
        let meta: MetaReportTimeRange = db.into();
        assert_eq!(meta.range_type, MetaReportTimeRangeType::Relative);
        assert_eq!(meta.period, "15m");
    }

    #[test]
    fn timerange_absolute_db_to_meta() {
        let db = ReportTimerange::Absolute {
            from: 1000,
            to: 2000,
        };
        let meta: MetaReportTimeRange = db.into();
        assert_eq!(meta.range_type, MetaReportTimeRangeType::Absolute);
        assert_eq!(meta.from, 1000);
        assert_eq!(meta.to, 2000);
    }

    #[test]
    fn timerange_relative_meta_to_db() {
        let meta = MetaReportTimeRange {
            range_type: MetaReportTimeRangeType::Relative,
            period: "1h".to_string(),
            from: 0,
            to: 0,
        };
        let db: ReportTimerange = meta.into();
        assert!(matches!(db, ReportTimerange::Relative { period } if period == "1h"));
    }

    #[test]
    fn timerange_absolute_meta_to_db() {
        let meta = MetaReportTimeRange {
            range_type: MetaReportTimeRangeType::Absolute,
            period: String::new(),
            from: 100,
            to: 200,
        };
        let db: ReportTimerange = meta.into();
        assert!(matches!(db, ReportTimerange::Absolute { from, to } if from == 100 && to == 200));
    }

    #[test]
    fn convert_str_to_meta_report_timerange_relative() {
        let json = serde_json::json!({"relative": {"period": "30m"}});
        let result = convert_str_to_meta_report_timerange(json).unwrap();
        assert_eq!(result.range_type, MetaReportTimeRangeType::Relative);
        assert_eq!(result.period, "30m");
    }

    #[test]
    fn convert_str_to_meta_report_timerange_absolute() {
        let json = serde_json::json!({"absolute": {"from": 500, "to": 1000}});
        let result = convert_str_to_meta_report_timerange(json).unwrap();
        assert_eq!(result.range_type, MetaReportTimeRangeType::Absolute);
        assert_eq!(result.from, 500);
        assert_eq!(result.to, 1000);
    }

    // ── ReportDashboardVariable conversions ──────────────────────────────────

    #[test]
    fn dashboard_variable_db_to_meta() {
        let db = ReportDashboardVariable {
            key: "env".to_string(),
            value: "prod".to_string(),
            id: Some("v1".to_string()),
        };
        let meta: MetaReportDashboardVariable = db.into();
        assert_eq!(meta.key, "env");
        assert_eq!(meta.value, "prod");
        assert_eq!(meta.id, Some("v1".to_string()));
    }

    #[test]
    fn dashboard_variable_meta_to_db() {
        let meta = MetaReportDashboardVariable {
            key: "region".to_string(),
            value: "us-east".to_string(),
            id: None,
        };
        let db: ReportDashboardVariable = meta.into();
        assert_eq!(db.key, "region");
        assert_eq!(db.id, None);
    }

    // ── TabNames conversions ─────────────────────────────────────────────────

    #[test]
    fn tab_names_from_vec() {
        let tabs = vec!["tab1".to_string(), "tab2".to_string()];
        let names: TabNames = tabs.clone().into();
        let back: Vec<String> = names.into();
        assert_eq!(back, tabs);
    }
}
