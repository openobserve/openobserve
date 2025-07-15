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
