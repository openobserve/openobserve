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

use std::str::FromStr;

use chrono::{Duration, FixedOffset, Offset, Timelike, Utc};
use chrono_tz::Tz;
use cron::Schedule;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    meta::search::SearchEventType,
    utils::{
        json::{Map, Value},
        rand::get_rand_num_within,
    },
};

pub mod alert;
pub mod deduplication;
pub mod incidents;

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Default)]
#[serde(default)]
pub struct TriggerCondition {
    /// (minutes)
    pub period: i64, // 10 minutes
    #[serde(default)]
    pub operator: Operator, // >=
    #[serde(default)]
    pub threshold: i64, // 3 times
    /// (seconds)
    #[serde(default)]
    pub frequency: i64, // 1 minute
    #[serde(default)]
    pub cron: String, // Cron Expression
    #[serde(default)]
    pub frequency_type: FrequencyType,
    #[serde(default)]
    /// (minutes)
    pub silence: i64, // silence for 10 minutes after fire an alert
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timezone: Option<String>,
    /// (seconds)
    #[serde(default)]
    pub tolerance_in_secs: Option<i64>,
    #[serde(default = "default_align_time")]
    pub align_time: bool,
}

pub fn default_align_time() -> bool {
    true
}

/// Get the current timezone offset in minutes for a given IANA timezone string
/// This automatically accounts for DST transitions
/// Falls back to the provided timezone_offset if parsing fails
fn get_timezone_from_string(
    timezone_str: Option<&str>,
    fallback_offset: i32,
) -> Result<Tz, FixedOffset> {
    if let Some(tz_str) = timezone_str
        && let Ok(tz) = tz_str.parse::<Tz>()
    {
        return Ok(tz);
    }
    // Fallback to FixedOffset for backward compatibility
    Err(FixedOffset::east_opt(fallback_offset * 60).unwrap())
}

/// Get timezone offset in minutes from a Tz timezone at a specific point in time
/// This is important for DST: the offset can be different in winter vs summer
fn get_offset_minutes_from_tz(tz: &Tz, at_time: chrono::DateTime<Utc>) -> i32 {
    let local_time = at_time.with_timezone(tz);
    local_time.offset().fix().local_minus_utc() / 60
}

impl TriggerCondition {
    // TODO: Currently, the frequency for alert is in seconds, but the
    // frequency for derived stream is in minutes. This needs to be fixed for alert.
    /// freq_in_secs is true if the frequency is in seconds, false if it is in minutes
    pub fn get_next_trigger_time_non_aligned(
        &self,
        freq_in_secs: bool,
        timezone_offset: i32,
        apply_silence: bool,
        start_from: Option<i64>,
    ) -> Result<i64, anyhow::Error> {
        let frequency = if freq_in_secs {
            self.frequency
        } else {
            self.frequency * 60
        };
        let tolerance = match self.tolerance_in_secs {
            Some(tolerance) if tolerance > 0 => {
                Duration::seconds(get_rand_num_within(0, tolerance as u64) as i64)
                    .num_microseconds()
                    .unwrap()
            }
            _ => 0,
        };
        let start_utc = start_from.map_or(Ok(Utc::now()), |from| {
            chrono::DateTime::<Utc>::from_timestamp_micros(from).ok_or(anyhow::anyhow!(
                "Error converting start_from value to timestamp"
            ))
        })?;

        if self.frequency_type == FrequencyType::Cron {
            let schedule = Schedule::from_str(&self.cron)?;

            // Try to parse timezone string and get current offset (DST-aware)
            // If parsing fails, fallback to the provided timezone_offset for backward compatibility
            let current_offset_minutes =
                match get_timezone_from_string(self.timezone.as_deref(), timezone_offset) {
                    Ok(tz) => {
                        // Using Tz - DST-aware timezone, get the current offset
                        get_offset_minutes_from_tz(&tz, start_utc)
                    }
                    Err(_) => {
                        // Fallback to provided timezone_offset for backward compatibility
                        timezone_offset
                    }
                };

            // Create FixedOffset with the calculated or provided offset
            let tz_offset = FixedOffset::east_opt(current_offset_minutes * 60).unwrap();

            if apply_silence {
                let silence = start_utc + Duration::try_minutes(self.silence).unwrap();
                let silence = silence.with_timezone(&tz_offset);
                // Check for the cron timestamp after the silence period
                Ok(schedule.after(&silence).next().unwrap().timestamp_micros() + tolerance)
            } else {
                // This is important, if provided start_utc was `Some`, it should use the next run
                // after the start_utc. If it was `None`, it should use the next run after the
                // current time.
                let start_utc = start_utc.with_timezone(&tz_offset);
                // Check for the cron timestamp in the future
                Ok(schedule
                    .after(&start_utc)
                    .next()
                    .unwrap()
                    .timestamp_micros()
                    + tolerance)
            }
        } else if apply_silence {
            // silence is in minutes, frequency is in seconds
            // When the silence period is less than the frequency, the alert runs after the silence
            // period completely ignoring the frequency. So, if frequency is 60 mins and
            // silence is 10 mins, the condition is satisfied, in that case, the alert
            // will run after 10 mins of silence period. To avoid this scenario, we
            // should use the max of (frequency, silence) as the next_run_at.
            // Silence period is in minutes, and the frequency is in seconds.
            let delta = std::cmp::max(frequency, self.silence * 60);
            Ok(start_utc.timestamp_micros()
                + Duration::try_seconds(delta)
                    .unwrap()
                    .num_microseconds()
                    .unwrap()
                + tolerance)
        } else {
            Ok(start_utc.timestamp_micros()
                + Duration::try_seconds(frequency)
                    .unwrap()
                    .num_microseconds()
                    .unwrap()
                + tolerance)
        }
    }

    /// Aligns the next trigger time to the previous interval boundary
    /// `next_run_at` is the timestamp to align
    /// `timezone_offset` is the timezone offset in minutes
    /// `frequency` is the frequency in seconds
    /// Returns the aligned timestamp
    /// Next trigger time should align with the pipeline timezone time
    /// if the frequency is 5 mins., and it is 11:03:00 now, the next trigger time should be
    /// 11:05:00
    pub fn align_time(
        next_run_at: i64,
        timezone_offset: i32,
        frequency: Option<i64>,
        timezone_str: Option<&str>,
    ) -> i64 {
        // Try to get DST-aware timezone offset if timezone string is provided
        let dt_utc = chrono::DateTime::from_timestamp_micros(next_run_at).unwrap_or_default();

        let current_offset_minutes = match get_timezone_from_string(timezone_str, timezone_offset) {
            Ok(tz) => {
                // Using Tz - DST-aware timezone, get the offset at next_run_at time
                get_offset_minutes_from_tz(&tz, dt_utc)
            }
            Err(_) => {
                // Fallback to provided timezone_offset for backward compatibility
                timezone_offset
            }
        };

        // Convert the timestamp to a DateTime with the calculated timezone offset
        let timezone = FixedOffset::east_opt(current_offset_minutes * 60).unwrap();
        let dt = dt_utc.with_timezone(&timezone);

        // Get the minute and second of the next_run_at time
        let minute = dt.minute() as i64;
        let second = dt.second() as i64;

        let minutes_to_subtract = match frequency {
            Some(freq) if freq > 0 => {
                // Convert frequency from seconds to minutes
                let mut frequency_minutes = freq / 60;

                // in case received frequency is less than 60 s
                if frequency_minutes == 0 {
                    frequency_minutes = 1;
                }

                // Calculate how many minutes to subtract to reach the previous interval boundary
                let minutes_to_subtract = minute % frequency_minutes;

                // If we're exactly at an interval boundary and seconds are 0, don't adjust
                if minutes_to_subtract == 0 && second == 0 {
                    0
                } else {
                    minutes_to_subtract
                }
            }
            _ => 0,
        };

        // Create a new DateTime with the aligned time
        let aligned_dt = dt
            .checked_sub_signed(chrono::Duration::minutes(minutes_to_subtract))
            .unwrap_or(dt)
            .with_second(0)
            .unwrap_or(dt)
            .with_nanosecond(0)
            .unwrap_or(dt);

        // Convert back to microsecond timestamp
        aligned_dt.timestamp_micros()
    }

    /// Get the next trigger time aligned to the previous interval boundary
    /// `freq_in_secs` is true if the frequency is in seconds, false if it is in minutes
    /// `timezone_offset` is the timezone offset in minutes
    /// `apply_silence` is true if the silence period is applied, false otherwise
    pub fn get_aligned_next_trigger_time(
        &self,
        freq_in_secs: bool,
        timezone_offset: i32,
        apply_silence: bool,
        start_from: Option<i64>,
    ) -> Result<i64, anyhow::Error> {
        let next_run_at = self.get_next_trigger_time_non_aligned(
            freq_in_secs,
            timezone_offset,
            apply_silence,
            start_from,
        )?;
        // Cron frequency is handled by the cron library, so we don't need to align it
        if self.frequency_type != FrequencyType::Cron {
            // `align_time` expects frequency in seconds, so convert if necessary
            let frequency = if freq_in_secs {
                self.frequency
            } else {
                self.frequency * 60
            };
            Ok(Self::align_time(
                next_run_at,
                timezone_offset,
                Some(frequency),
                self.timezone.as_deref(),
            ))
        } else {
            Ok(next_run_at)
        }
    }

    pub fn get_next_trigger_time(
        &self,
        freq_in_secs: bool,
        timezone_offset: i32,
        apply_silence: bool,
        start_from: Option<i64>,
    ) -> Result<i64, anyhow::Error> {
        if self.align_time {
            self.get_aligned_next_trigger_time(
                freq_in_secs,
                timezone_offset,
                apply_silence,
                start_from,
            )
        } else {
            self.get_next_trigger_time_non_aligned(
                freq_in_secs,
                timezone_offset,
                apply_silence,
                start_from,
            )
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TriggerEvalResults {
    pub data: Option<Vec<Map<String, Value>>>,
    pub end_time: i64,
    pub query_took: Option<i64>,
}

#[derive(Clone, Default, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct CompareHistoricData {
    #[serde(rename = "offSet")]
    pub offset: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum FrequencyType {
    #[serde(rename = "cron")]
    Cron,
    #[serde(rename = "minutes")]
    #[default]
    Minutes,
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq, Default)]
pub struct QueryCondition {
    #[serde(default)]
    #[serde(rename = "type")]
    pub query_type: QueryType,
    #[schema(value_type = Option<Object>)]
    pub conditions: Option<AlertConditionParams>,
    pub sql: Option<String>,
    pub promql: Option<String>,              // (cpu usage / cpu total)
    pub promql_condition: Option<Condition>, // value >= 80
    pub aggregation: Option<Aggregation>,
    #[serde(default)]
    pub vrl_function: Option<String>,
    #[serde(default)]
    pub search_event_type: Option<SearchEventType>,
    #[serde(default)]
    pub multi_time_range: Option<Vec<CompareHistoricData>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize, ToSchema)]
#[serde(untagged)]
pub enum ConditionList {
    OrNode {
        or: Vec<ConditionList>,
    },
    AndNode {
        and: Vec<ConditionList>,
    },
    NotNode {
        not: Box<ConditionList>,
    },
    /// This variant handles data serialized in `Vec<Condition>`
    /// where all conditions are evaluated as conjunction
    #[serde(serialize_with = "serialize_legacy_conditions")]
    LegacyConditions(Vec<Condition>),
    EndCondition(Condition),
}

// Custom serializer function to serialize LegacyConditions as AndNode
fn serialize_legacy_conditions<S>(
    conditions: &[Condition],
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    use serde::ser::SerializeMap;

    // Transform the Vec<Condition> into EndCondition variants
    let end_conditions: Vec<ConditionList> = conditions
        .iter()
        .map(|condition| ConditionList::EndCondition(condition.clone()))
        .collect();

    // If there are no conditions, serialize as an empty "and" array
    if end_conditions.is_empty() {
        let mut map = serializer.serialize_map(Some(1))?;
        map.serialize_entry("and", &Vec::<ConditionList>::new())?;
        map.end()
    } else {
        // Serialize as an AndNode
        let mut map = serializer.serialize_map(Some(1))?;
        map.serialize_entry("and", &end_conditions)?;
        map.end()
    }
}

impl ConditionList {
    /// Calculates the depth of the condition list tree
    /// An EndCondition has depth 1
    /// Other nodes have depth 1 + max depth of their children
    pub fn depth(&self) -> usize {
        match self {
            ConditionList::OrNode { or } => {
                let mut max_child_depth = 0;
                for child in or {
                    let child_depth = child.depth();
                    max_child_depth = max_child_depth.max(child_depth);
                }
                max_child_depth + 1
            }
            ConditionList::LegacyConditions(_) => 1,
            ConditionList::AndNode { and } => {
                let mut max_child_depth = 0;
                for child in and {
                    let child_depth = child.depth();
                    max_child_depth = max_child_depth.max(child_depth);
                }
                max_child_depth + 1
            }
            ConditionList::NotNode { not } => not.depth() + 1,
            ConditionList::EndCondition(_) => 1,
        }
    }

    /// Checks if the condition list is empty (has no actual conditions)
    /// Used for validation to ensure condition nodes have meaningful conditions
    pub fn has_conditions(&self) -> bool {
        match self {
            ConditionList::OrNode { or } => !or.is_empty(),
            ConditionList::AndNode { and } => !and.is_empty(),
            ConditionList::LegacyConditions(conditions) => !conditions.is_empty(),
            ConditionList::NotNode { .. } => true,
            ConditionList::EndCondition(_) => true,
        }
    }
}

// Define a separate iterator struct for ConditionList
pub struct ConditionListIterator {
    inner: Vec<ConditionList>,
    index: usize,
}

impl Iterator for ConditionListIterator {
    type Item = ConditionList;

    fn next(&mut self) -> Option<Self::Item> {
        if self.index < self.inner.len() {
            let item = self.inner[self.index].clone();
            self.index += 1;
            Some(item)
        } else {
            None
        }
    }
}

// Implement IntoIterator for ConditionList
impl IntoIterator for ConditionList {
    type Item = ConditionList;
    type IntoIter = ConditionListIterator;

    fn into_iter(self) -> Self::IntoIter {
        let inner = match self {
            ConditionList::OrNode { or } => or,
            ConditionList::AndNode { and } => and,
            ConditionList::LegacyConditions(conditions) => conditions
                .into_iter()
                .map(ConditionList::EndCondition)
                .collect(),
            ConditionList::NotNode { not } => vec![*not],
            ConditionList::EndCondition(condition) => vec![ConditionList::EndCondition(condition)],
        };
        ConditionListIterator { inner, index: 0 }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema, PartialEq)]
pub struct Aggregation {
    pub group_by: Option<Vec<String>>,
    pub function: AggFunction,
    pub having: Condition,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum AggFunction {
    #[serde(rename = "avg")]
    Avg,
    #[serde(rename = "min")]
    Min,
    #[serde(rename = "max")]
    Max,
    #[serde(rename = "sum")]
    Sum,
    #[serde(rename = "count")]
    Count,
    #[serde(rename = "median")]
    Median,
    #[serde(rename = "p50")]
    P50,
    #[serde(rename = "p75")]
    P75,
    #[serde(rename = "p90")]
    P90,
    #[serde(rename = "p95")]
    P95,
    #[serde(rename = "p99")]
    P99,
}

impl std::fmt::Display for AggFunction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AggFunction::Avg => write!(f, "avg"),
            AggFunction::Min => write!(f, "min"),
            AggFunction::Max => write!(f, "max"),
            AggFunction::Sum => write!(f, "sum"),
            AggFunction::Count => write!(f, "count"),
            AggFunction::Median => write!(f, "median"),
            AggFunction::P50 => write!(f, "p50"),
            AggFunction::P75 => write!(f, "p75"),
            AggFunction::P90 => write!(f, "p90"),
            AggFunction::P95 => write!(f, "p95"),
            AggFunction::P99 => write!(f, "p99"),
        }
    }
}

impl TryFrom<&str> for AggFunction {
    type Error = &'static str;
    fn try_from(s: &str) -> Result<Self, Self::Error> {
        Ok(match s.to_lowercase().as_str() {
            "avg" => AggFunction::Avg,
            "min" => AggFunction::Min,
            "max" => AggFunction::Max,
            "sum" => AggFunction::Sum,
            "count" => AggFunction::Count,
            "median" => AggFunction::Median,
            "p50" => AggFunction::P50,
            "p75" => AggFunction::P75,
            "p90" => AggFunction::P90,
            "p95" => AggFunction::P95,
            "p99" => AggFunction::P99,
            _ => return Err("invalid aggregation function"),
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize, ToSchema)]
pub enum QueryType {
    #[default]
    #[serde(rename = "custom")]
    Custom,
    #[serde(rename = "sql")]
    SQL,
    #[serde(rename = "promql")]
    PromQL,
}

impl std::fmt::Display for QueryType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QueryType::Custom => write!(f, "custom"),
            QueryType::SQL => write!(f, "sql"),
            QueryType::PromQL => write!(f, "promql"),
        }
    }
}

impl From<&str> for QueryType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "custom" => QueryType::Custom,
            "sql" => QueryType::SQL,
            "promql" => QueryType::PromQL,
            _ => QueryType::Custom,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct Condition {
    pub column: String,
    pub operator: Operator,
    #[schema(value_type = Object)]
    pub value: Value,
    #[serde(default)]
    pub ignore_case: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum Operator {
    #[serde(rename = "=")]
    #[default]
    EqualTo,
    #[serde(rename = "!=")]
    NotEqualTo,
    #[serde(rename = ">")]
    GreaterThan,
    #[serde(rename = ">=")]
    GreaterThanEquals,
    #[serde(rename = "<")]
    LessThan,
    #[serde(rename = "<=")]
    LessThanEquals,
    #[serde(rename = "contains")]
    #[serde(alias = "Contains")]
    Contains,
    #[serde(rename = "not_contains")]
    #[serde(alias = "NotContains")]
    NotContains,
}

impl std::fmt::Display for Operator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Operator::EqualTo => write!(f, "="),
            Operator::NotEqualTo => write!(f, "!="),
            Operator::GreaterThan => write!(f, ">"),
            Operator::GreaterThanEquals => write!(f, ">="),
            Operator::LessThan => write!(f, "<"),
            Operator::LessThanEquals => write!(f, "<="),
            Operator::Contains => write!(f, "contains"),
            Operator::NotContains => write!(f, "not contains"),
        }
    }
}

// Condition system v2 for pipeline conditions with linear evaluation
// This provides an alternative to the tree-based ConditionList (v1) for expressing
// mixed boolean operations with natural left-to-right ordering

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogicalOperator {
    And,
    Or,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize, ToSchema)]
#[serde(tag = "filterType", rename_all = "lowercase")]
pub enum ConditionItem {
    Condition {
        column: String,
        operator: Operator,
        #[schema(value_type = Object)]
        value: Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        ignore_case: Option<bool>,
        #[serde(rename = "logicalOperator")]
        logical_operator: LogicalOperator,
    },
    Group {
        #[serde(rename = "logicalOperator")]
        logical_operator: LogicalOperator,
        conditions: Vec<ConditionItem>,
    },
}

impl ConditionItem {
    /// Get the logical operator for this condition item
    pub fn logical_operator(&self) -> &LogicalOperator {
        match self {
            ConditionItem::Condition {
                logical_operator, ..
            } => logical_operator,
            ConditionItem::Group {
                logical_operator, ..
            } => logical_operator,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConditionGroup {
    pub filter_type: String, // Always "group"
    #[serde(rename = "logicalOperator")]
    pub logical_operator: LogicalOperator,
    pub conditions: Vec<ConditionItem>,
}

impl ConditionGroup {
    /// Checks if the condition group has conditions
    pub fn has_conditions(&self) -> bool {
        !self.conditions.is_empty()
    }

    /// Validates the condition group structure
    pub fn validate(&self) -> Result<(), String> {
        if self.filter_type != "group" {
            return Err(format!(
                "Invalid filterType: expected 'group', got '{}'",
                self.filter_type
            ));
        }

        if !self.has_conditions() {
            return Err("Condition Group should have atleast 1 condition".to_owned());
        }
        Ok(())
    }
}

/// Versioned condition parameters for alerts
/// Supports both v1 (tree-based ConditionList) and v2 (linear ConditionGroup)
#[derive(Clone, Debug, PartialEq, ToSchema)]
pub enum AlertConditionParams {
    /// v1 format: Tree-based ConditionList (default when no version field)
    V1(ConditionList),
    /// v2 format: Linear ConditionGroup (version: 2)
    V2(ConditionGroup),
}

impl<'de> Deserialize<'de> for AlertConditionParams {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        use serde::de::Error;
        use serde_json::Value;

        let value = Value::deserialize(deserializer)?;

        // Get version field, default to 1 if not present
        let version = value.get("version").and_then(|v| v.as_u64()).unwrap_or(1);

        match version {
            1 => {
                let conditions: ConditionList = serde_json::from_value(value).map_err(|e| {
                    D::Error::custom(format!("Failed to parse V1 conditions: {}", e))
                })?;
                Ok(AlertConditionParams::V1(conditions))
            }
            2 => {
                // Get conditions field
                let conditions_value = value
                    .get("conditions")
                    .ok_or_else(|| D::Error::custom("conditions field missing for v2"))?;

                let conditions: ConditionGroup = serde_json::from_value(conditions_value.clone())
                    .map_err(|e| {
                    D::Error::custom(format!("Failed to parse V2 conditions: {}", e))
                })?;
                Ok(AlertConditionParams::V2(conditions))
            }
            _ => Err(D::Error::custom(format!(
                "Unsupported version: {}",
                version
            ))),
        }
    }
}

impl Serialize for AlertConditionParams {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;

        match self {
            AlertConditionParams::V1(conditions) => {
                // V1: Serialize directly as ConditionList (no version field)
                conditions.serialize(serializer)
            }
            AlertConditionParams::V2(conditions) => {
                // V2: Include version field
                let mut state = serializer.serialize_struct("AlertConditionParams", 2)?;
                state.serialize_field("version", &2)?;
                state.serialize_field("conditions", conditions)?;
                state.end()
            }
        }
    }
}

#[cfg(test)]
mod test {
    use chrono::{DateTime, FixedOffset, TimeZone};

    use super::*;

    #[test]
    fn test_align_time() {
        // Test case 1: Align to 5-minute intervals
        let timezone = FixedOffset::east_opt(0).unwrap(); // UTC
        let dt = timezone.with_ymd_and_hms(2025, 1, 1, 11, 3, 0).unwrap();
        let next_run_at = dt.timestamp_micros();
        let aligned_time = TriggerCondition::align_time(next_run_at, 0, Some(300), None); // 5 minutes in seconds
        let aligned_dt = DateTime::from_timestamp_micros(aligned_time).unwrap();
        assert_eq!(aligned_dt.hour(), 11);
        assert_eq!(aligned_dt.minute(), 0);
        assert_eq!(aligned_dt.second(), 0);

        // Test case 2: Align to 1-hour intervals
        let dt = timezone.with_ymd_and_hms(2025, 1, 1, 17, 19, 30).unwrap();
        let next_run_at = dt.timestamp_micros();
        let aligned_time = TriggerCondition::align_time(next_run_at, 0, Some(3600), None); // 1 hour in seconds
        let aligned_dt = DateTime::from_timestamp_micros(aligned_time).unwrap();
        assert_eq!(aligned_dt.hour(), 17);
        assert_eq!(aligned_dt.minute(), 0);
        assert_eq!(aligned_dt.second(), 0);

        // Test case 3: Align to 1-minute intervals
        let dt = timezone.with_ymd_and_hms(2025, 1, 1, 17, 19, 11).unwrap();
        let next_run_at = dt.timestamp_micros();
        let aligned_time = TriggerCondition::align_time(next_run_at, 0, Some(60), None); // 1 minute in seconds
        let aligned_dt = DateTime::from_timestamp_micros(aligned_time).unwrap();
        assert_eq!(aligned_dt.hour(), 17);
        assert_eq!(aligned_dt.minute(), 19);
        assert_eq!(aligned_dt.second(), 0);

        // Test case 4: Already at interval boundary
        let dt = timezone.with_ymd_and_hms(2025, 1, 1, 17, 0, 0).unwrap();
        let next_run_at = dt.timestamp_micros();
        let aligned_time = TriggerCondition::align_time(next_run_at, 0, Some(3600), None); // 1 hour in seconds
        let aligned_dt = DateTime::from_timestamp_micros(aligned_time).unwrap();
        assert_eq!(aligned_dt.hour(), 17);
        assert_eq!(aligned_dt.minute(), 0);
        assert_eq!(aligned_dt.second(), 0);

        // Test case 5: Different timezone (UTC+8)
        let timezone = FixedOffset::east_opt(8 * 60 * 60).unwrap(); // UTC+8
        let dt = timezone.with_ymd_and_hms(2025, 1, 1, 17, 19, 30).unwrap();
        let next_run_at = dt.timestamp_micros();
        // `align_time` expects frequency in minutes, so convert 8 hours to minutes
        let aligned_time = TriggerCondition::align_time(next_run_at, 8 * 60, Some(3600), None); // 1 hour in seconds
        let aligned_dt = DateTime::from_timestamp_micros(aligned_time)
            .unwrap()
            .with_timezone(&timezone);
        assert_eq!(aligned_dt.hour(), 17);
        assert_eq!(aligned_dt.minute(), 0);
        assert_eq!(aligned_dt.second(), 0);
    }

    #[test]
    fn test_align_time_with_dst_aware_timezone() {
        // Test that align_time uses DST-aware timezone offset when timezone string is provided
        use chrono::TimeZone;

        // Winter date: January 15, 2025, 11:03:00 in Los Angeles (PST)
        let winter_date_pst = chrono_tz::America::Los_Angeles
            .with_ymd_and_hms(2025, 1, 15, 11, 3, 0)
            .unwrap();
        let winter_timestamp = winter_date_pst.timestamp_micros();

        // Test with DST-aware timezone string
        let aligned_winter = TriggerCondition::align_time(
            winter_timestamp,
            -480,      // PST fallback
            Some(300), // 5 minutes
            Some("America/Los_Angeles"),
        );
        let aligned_winter_dt = DateTime::from_timestamp_micros(aligned_winter)
            .unwrap()
            .with_timezone(&chrono_tz::America::Los_Angeles);

        // Should align to 11:00 AM
        assert_eq!(aligned_winter_dt.hour(), 11);
        assert_eq!(aligned_winter_dt.minute(), 0);
        assert_eq!(aligned_winter_dt.second(), 0);

        // Summer date: July 15, 2025, 11:03:00 in Los Angeles (PDT)
        let summer_date_pdt = chrono_tz::America::Los_Angeles
            .with_ymd_and_hms(2025, 7, 15, 11, 3, 0)
            .unwrap();
        let summer_timestamp = summer_date_pdt.timestamp_micros();

        // Test with DST-aware timezone string
        let aligned_summer = TriggerCondition::align_time(
            summer_timestamp,
            -420,      // PDT fallback
            Some(300), // 5 minutes
            Some("America/Los_Angeles"),
        );
        let aligned_summer_dt = DateTime::from_timestamp_micros(aligned_summer)
            .unwrap()
            .with_timezone(&chrono_tz::America::Los_Angeles);

        // Should also align to 11:00 AM
        assert_eq!(aligned_summer_dt.hour(), 11);
        assert_eq!(aligned_summer_dt.minute(), 0);
        assert_eq!(aligned_summer_dt.second(), 0);

        // The UTC times should be different due to DST
        let winter_utc = DateTime::from_timestamp_micros(aligned_winter).unwrap();
        let summer_utc = DateTime::from_timestamp_micros(aligned_summer).unwrap();

        // Winter: 11 AM PST = 7 PM UTC (UTC-8)
        assert_eq!(winter_utc.hour(), 19);
        // Summer: 11 AM PDT = 6 PM UTC (UTC-7)
        assert_eq!(summer_utc.hour(), 18);

        // Test fallback behavior: without timezone string, should use fixed offset
        let aligned_no_tz = TriggerCondition::align_time(
            winter_timestamp,
            -480,
            Some(300),
            None, // No timezone string
        );
        let aligned_no_tz_dt = DateTime::from_timestamp_micros(aligned_no_tz)
            .unwrap()
            .with_timezone(&FixedOffset::west_opt(8 * 60 * 60).unwrap());

        assert_eq!(aligned_no_tz_dt.hour(), 11);
        assert_eq!(aligned_no_tz_dt.minute(), 0);
    }

    #[test]
    fn test_get_next_trigger_time_non_aligned() {
        // Test case 1: Regular frequency (5 minutes)
        let condition = TriggerCondition {
            frequency: 300, // 5 minutes in seconds
            frequency_type: FrequencyType::Minutes,
            ..Default::default()
        };
        let result = condition
            .get_next_trigger_time_non_aligned(true, 0, false, None)
            .unwrap();
        let dt = DateTime::from_timestamp_micros(result).unwrap();
        let after_5_minutes = Utc::now() + Duration::minutes(5);
        assert_eq!(dt.minute(), after_5_minutes.minute());

        // Test case 2: Cron expression
        let condition = TriggerCondition {
            frequency: 300,
            frequency_type: FrequencyType::Cron,
            cron: "0 */5 * * * *".to_string(), // Every 5 minutes
            ..Default::default()
        };
        let result = condition
            .get_next_trigger_time_non_aligned(true, 0, false, None)
            .unwrap();
        let dt = DateTime::from_timestamp_micros(result).unwrap();
        assert_eq!(dt.minute() % 5, 0);
        assert_eq!(dt.second(), 0);

        // Test case 3: With silence period
        let condition = TriggerCondition {
            frequency: 300,
            silence: 10, // 10 minutes silence
            ..Default::default()
        };
        let result = condition
            .get_next_trigger_time_non_aligned(true, 0, true, None)
            .unwrap();
        let dt = DateTime::from_timestamp_micros(result).unwrap();
        // The next trigger should be after the silence period
        let now = Utc::now();
        let silence_end = now + Duration::minutes(10);
        assert_eq!(dt.minute(), silence_end.minute());

        // Test case 4: With tolerance
        let condition = TriggerCondition {
            frequency: 300,
            tolerance_in_secs: Some(60), // 1 minute tolerance
            ..Default::default()
        };
        let result = condition
            .get_next_trigger_time_non_aligned(true, 0, false, None)
            .unwrap();
        let dt = DateTime::from_timestamp_micros(result).unwrap();
        // The next trigger should be within the tolerance range
        let now = Utc::now();
        let expected = now + Duration::minutes(5);
        let min_expected = expected - Duration::minutes(1);
        let max_expected = expected + Duration::minutes(1);
        assert!(dt >= min_expected && dt <= max_expected);
    }

    #[test]
    fn test_get_aligned_next_trigger_time() {
        // Test case 1: Regular frequency with alignment
        let condition = TriggerCondition {
            frequency: 300, // 5 minutes in seconds
            frequency_type: FrequencyType::Minutes,
            ..Default::default()
        };

        // Mock the current time for testing
        let result = condition
            .get_aligned_next_trigger_time(true, 0, false, None)
            .unwrap();
        let dt = DateTime::from_timestamp_micros(result).unwrap();

        // The next trigger should be aligned to the previous 5-minute boundary
        // If current time is 11:03:00, the next trigger should be at 11:05:00
        let now = Utc::now();
        let expected = now + Duration::minutes(6);
        assert!(dt < expected);
        assert_eq!(dt.minute() % 5, 0);
        assert_eq!(dt.second(), 0);

        // Test case 2: Cron expression (should not be aligned)
        let condition = TriggerCondition {
            frequency: 300,
            frequency_type: FrequencyType::Cron,
            cron: "0 */5 * * * *".to_string(), // Every 5 minutes at 0th second
            ..Default::default()
        };

        // For cron expressions, the time should not be aligned by our function
        // as it's handled by the cron library
        let result = condition
            .get_aligned_next_trigger_time(true, 0, false, None)
            .unwrap();
        let dt = DateTime::from_timestamp_micros(result).unwrap();

        // The next trigger should still be at a 5-minute boundary, but this is
        // handled by the cron library, not our alignment function
        assert_eq!(dt.minute() % 5, 0);
        assert_eq!(dt.second(), 0);
    }

    #[test]
    fn test_deserialize_backcompat_condition_list() {
        let test_cases = vec![
            (
                r#"[{"value": "10", "column": "e2e", "operator": "=", "ignore_case": false}]"#,
                ConditionList::LegacyConditions(vec![Condition {
                    column: "e2e".into(),
                    operator: Operator::EqualTo,
                    value: Value::String("10".into()),
                    ignore_case: false,
                }]),
            ),
            (
                r#"[{"value": "monitor", "column": "k8s_namespace_name", "operator": "not_contains", "ignore_case": false}]"#,
                ConditionList::LegacyConditions(vec![Condition {
                    column: "k8s_namespace_name".into(),
                    operator: Operator::NotContains,
                    value: Value::String("monitor".into()),
                    ignore_case: false,
                }]),
            ),
            (
                r#"[{"value": "something", "column": "body", "operator": "contains", "ignore_case": false}]"#,
                ConditionList::LegacyConditions(vec![Condition {
                    column: "body".into(),
                    operator: Operator::Contains,
                    value: Value::String("something".into()),
                    ignore_case: false,
                }]),
            ),
            (
                r#"[{"value": "error", "column": "level", "operator": "=", "ignore_case": false}]"#,
                ConditionList::LegacyConditions(vec![Condition {
                    column: "level".into(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".into()),
                    ignore_case: false,
                }]),
            ),
            (r#"[]"#, ConditionList::LegacyConditions(vec![])),
        ];

        for (json, expected) in test_cases {
            println!("Testing: {json}");
            let deserialized: ConditionList = serde_json::from_str(json).unwrap_or_else(|e| {
                panic!("Failed to deserialize '{json}': {e}");
            });

            // Use pattern matching to verify enum variant
            assert!(
                matches!(deserialized, ConditionList::LegacyConditions(_)),
                "Expected LegacyConditions variant for '{json}'"
            );

            // Then verify equality with the expected value
            assert_eq!(deserialized, expected, "Value mismatch for '{json}'");
        }

        // Test the full backcompat case
        let backcompat_condition_list = r#"[
        {
            "column": "level",
            "operator": "=",
            "value": "error",
            "ignore_case": false
        },
        {
            "column": "job",
            "operator": "=",
            "value": "something",
            "ignore_case": false
        }
        ]"#;

        let expected_legacy_condition_list: ConditionList =
            serde_json::from_str(backcompat_condition_list).unwrap();
        assert_eq!(
            expected_legacy_condition_list,
            ConditionList::LegacyConditions(vec![
                Condition {
                    column: "level".into(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".into()),
                    ignore_case: false,
                },
                Condition {
                    column: "job".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("something".into()),
                    ignore_case: false,
                }
            ])
        );
    }

    #[test]
    fn test_deserialize_not_condition_list() {
        let and_condition_list = r#"{
            "not": {
                "and": [
                    {
                        "column": "level",
                        "operator": "=",
                        "value": "error",
                        "ignore_case": false
                    },
                    {
                        "column": "job",
                        "operator": "=",
                        "value": "something",
                        "ignore_case": false
                    }
                ]
            }
        }"#;
        let expected_not_condition_list: ConditionList =
            serde_json::from_str(and_condition_list).unwrap();
        assert_eq!(
            expected_not_condition_list,
            ConditionList::NotNode {
                not: {
                    Box::new(ConditionList::AndNode {
                        and: vec![
                            ConditionList::EndCondition(Condition {
                                column: "level".into(),
                                operator: Operator::EqualTo,
                                value: Value::String("error".into()),
                                ignore_case: false,
                            }),
                            ConditionList::EndCondition(Condition {
                                column: "job".to_string(),
                                operator: Operator::EqualTo,
                                value: Value::String("something".into()),
                                ignore_case: false,
                            }),
                        ],
                    })
                }
            }
        );
    }

    #[test]
    fn test_deserialize_simple_condition_list() {
        let and_condition_list = r#"{
        "and": [
        {
            "column": "level",
            "operator": "=",
            "value": "error",
            "ignore_case": false
        },
        {
            "column": "job",
            "operator": "=",
            "value": "something",
            "ignore_case": false
        }
        ]}"#;
        let expected_and_condition_list: ConditionList =
            serde_json::from_str(and_condition_list).unwrap();
        assert_eq!(
            expected_and_condition_list,
            ConditionList::AndNode {
                and: vec![
                    ConditionList::EndCondition(Condition {
                        column: "level".into(),
                        operator: Operator::EqualTo,
                        value: Value::String("error".into()),
                        ignore_case: false,
                    }),
                    ConditionList::EndCondition(Condition {
                        column: "job".to_string(),
                        operator: Operator::EqualTo,
                        value: Value::String("something".into()),
                        ignore_case: false,
                    })
                ]
            }
        );
    }

    #[test]
    fn test_deserialize_complex_condition_list() {
        let complex_condition_list = r#"{
        "or": [
            {
                "and": [
                    {
                        "column": "column1",
                        "operator": "=",
                        "value": "value1",
                        "ignore_case": true
                    },
                    {
                        "column": "level",
                        "operator": "=",
                        "value": "error",
                        "ignore_case": false
                    }
                ]
            },
            {
                "column": "column3",
                "operator": ">",
                "value": "value3",
                "ignore_case": false
            }
        ]
        }"#;
        let expected_complex_condition_list: ConditionList =
            serde_json::from_str(complex_condition_list).unwrap();
        assert_eq!(
            expected_complex_condition_list,
            ConditionList::OrNode {
                or: vec![
                    ConditionList::AndNode {
                        and: vec![
                            ConditionList::EndCondition(Condition {
                                column: "column1".into(),
                                operator: Operator::EqualTo,
                                value: Value::String("value1".into()),
                                ignore_case: true,
                            }),
                            ConditionList::EndCondition(Condition {
                                column: "level".to_string(),
                                operator: Operator::EqualTo,
                                value: Value::String("error".into()),
                                ignore_case: false,
                            })
                        ]
                    },
                    ConditionList::EndCondition(Condition {
                        column: "column3".to_string(),
                        operator: Operator::GreaterThan,
                        value: Value::String("value3".into()),
                        ignore_case: false,
                    })
                ]
            }
        );
    }

    #[test]
    fn test_serialize_legacy_conditions() {
        // Create a LegacyConditions variant with some test conditions
        let legacy_conditions = ConditionList::LegacyConditions(vec![
            Condition {
                column: "level".into(),
                operator: Operator::EqualTo,
                value: Value::String("error".into()),
                ignore_case: false,
            },
            Condition {
                column: "job".into(),
                operator: Operator::EqualTo,
                value: Value::String("something".into()),
                ignore_case: false,
            },
        ]);

        // Serialize to JSON
        let serialized =
            serde_json::to_string_pretty(&legacy_conditions).expect("Failed to serialize");

        // Expected format is an AndNode structure
        let expected_json = r#"{
  "and": [
    {
      "column": "level",
      "operator": "=",
      "value": "error",
      "ignore_case": false
    },
    {
      "column": "job",
      "operator": "=",
      "value": "something",
      "ignore_case": false
    }
  ]
}"#;

        // Compare the serialized JSON with the expected format
        assert_eq!(serialized, expected_json);

        // Verify empty array case
        let empty_legacy_conditions = ConditionList::LegacyConditions(vec![]);
        let serialized =
            serde_json::to_string_pretty(&empty_legacy_conditions).expect("Failed to serialize");
        let expected_json = r#"{
  "and": []
}"#;
        assert_eq!(serialized, expected_json);
    }

    #[test]
    fn test_get_next_trigger_time_with_dst_winter_and_summer() {
        // Test DST-aware scheduling using specific start_from timestamps
        // This verifies that alerts scheduled during winter vs summer use correct offsets

        use chrono::TimeZone;

        // Winter date: January 15, 2025, 10:00 AM UTC (PST period)
        let winter_date = Utc.with_ymd_and_hms(2025, 1, 15, 10, 0, 0).unwrap();
        let winter_start_from = winter_date.timestamp_micros();

        // Summer date: July 15, 2025, 10:00 AM UTC (PDT period)
        let summer_date = Utc.with_ymd_and_hms(2025, 7, 15, 10, 0, 0).unwrap();
        let summer_start_from = summer_date.timestamp_micros();

        // Create alert scheduled for 9:00 AM Pacific Time every day
        let condition = TriggerCondition {
            frequency: 300,
            frequency_type: FrequencyType::Cron,
            cron: "0 0 9 * * *".to_string(), // Every day at 9:00 AM
            timezone: Some("America/Los_Angeles".to_string()),
            ..Default::default()
        };

        // Test with winter start time (should use PST offset: UTC-8 = -480 minutes)
        let winter_result = condition.get_next_trigger_time_non_aligned(
            true,
            -480, // PST fallback
            false,
            Some(winter_start_from),
        );
        assert!(winter_result.is_ok(), "Winter scheduling should succeed");

        // Test with summer start time (should use PDT offset: UTC-7 = -420 minutes)
        let summer_result = condition.get_next_trigger_time_non_aligned(
            true,
            -480, // Even if fallback is PST, actually PDT should be used
            false,
            Some(summer_start_from),
        );
        assert!(summer_result.is_ok(), "Summer scheduling should succeed");

        // Verify both schedule at 9:00 AM local time
        use chrono_tz::America::Los_Angeles;

        let winter_timestamp = winter_result.unwrap();
        let winter_dt = DateTime::from_timestamp_micros(winter_timestamp).unwrap();
        let winter_la = winter_dt.with_timezone(&Los_Angeles);
        assert_eq!(
            winter_la.hour(),
            9,
            "Winter alert should fire at 9 AM LA time"
        );
        assert_eq!(winter_la.minute(), 0);

        let summer_timestamp = summer_result.unwrap();
        let summer_dt = DateTime::from_timestamp_micros(summer_timestamp).unwrap();
        let summer_la = summer_dt.with_timezone(&Los_Angeles);
        assert_eq!(
            summer_la.hour(),
            9,
            "Summer alert should fire at 9 AM LA time"
        );
        assert_eq!(summer_la.minute(), 0);

        // The UTC times should be different due to DST
        // Winter: 9 AM PST = 5 PM UTC (UTC-8)
        // Summer: 9 AM PDT = 4 PM UTC (UTC-7)
        assert_eq!(winter_dt.hour(), 17, "Winter: 9 AM PST = 5 PM UTC");
        assert_eq!(summer_dt.hour(), 16, "Summer: 9 AM PDT = 4 PM UTC");
    }

    #[test]
    fn test_dst_transition_dates() {
        // Test scheduling around actual DST transition dates
        // In 2025, for America/Los_Angeles:
        // - DST starts: March 9, 2025 at 2:00 AM (becomes 3:00 AM)
        // - DST ends: November 2, 2025 at 2:00 AM (becomes 1:00 AM)

        use chrono::TimeZone;

        let condition = TriggerCondition {
            frequency: 300,
            frequency_type: FrequencyType::Cron,
            cron: "0 0 14 * * *".to_string(), // Every day at 2:00 PM (14:00)
            timezone: Some("America/Los_Angeles".to_string()),
            ..Default::default()
        };

        // Day before DST starts: March 8, 2025, 10:00 AM UTC (still PST)
        let before_spring_dst = Utc.with_ymd_and_hms(2025, 3, 8, 10, 0, 0).unwrap();
        let result_before = condition.get_next_trigger_time_non_aligned(
            true,
            -480,
            false,
            Some(before_spring_dst.timestamp_micros()),
        );
        assert!(
            result_before.is_ok(),
            "Scheduling before DST transition should work"
        );

        // Day after DST starts: March 10, 2025, 10:00 AM UTC (now PDT)
        let after_spring_dst = Utc.with_ymd_and_hms(2025, 3, 10, 10, 0, 0).unwrap();
        let result_after = condition.get_next_trigger_time_non_aligned(
            true,
            -420, // Changed to PDT
            false,
            Some(after_spring_dst.timestamp_micros()),
        );
        assert!(
            result_after.is_ok(),
            "Scheduling after DST transition should work"
        );

        // Both should schedule at 2:00 PM local time
        use chrono_tz::America::Los_Angeles;

        let before_dt = DateTime::from_timestamp_micros(result_before.unwrap())
            .unwrap()
            .with_timezone(&Los_Angeles);
        assert_eq!(before_dt.hour(), 14, "Before DST: should fire at 2 PM");

        let after_dt = DateTime::from_timestamp_micros(result_after.unwrap())
            .unwrap()
            .with_timezone(&Los_Angeles);
        assert_eq!(after_dt.hour(), 14, "After DST: should fire at 2 PM");
    }

    #[test]
    fn test_get_timezone_from_string() {
        // Test valid timezone string
        let result = get_timezone_from_string(Some("America/Los_Angeles"), -480);
        assert!(result.is_ok());

        // Test invalid timezone string (should fallback to FixedOffset)
        let result = get_timezone_from_string(Some("Invalid/Timezone"), -480);
        assert!(result.is_err());

        // Test None timezone (should fallback to FixedOffset)
        let result = get_timezone_from_string(None, -480);
        assert!(result.is_err());

        // Test UTC
        let result = get_timezone_from_string(Some("UTC"), 0);
        assert!(result.is_ok());
    }

    #[test]
    fn test_get_next_trigger_time_with_dst_aware_timezone() {
        // Test our get_next_trigger_time_non_aligned function with DST-aware timezone
        // This tests the complete flow: timezone string parsing -> offset calculation -> cron
        // scheduling

        // Test 1: Alert with valid timezone string (DST-aware)
        let condition_dst_aware = TriggerCondition {
            frequency: 300,
            frequency_type: FrequencyType::Cron,
            cron: "0 0 9 * * *".to_string(), // Every day at 9:00 AM
            timezone: Some("America/Los_Angeles".to_string()),
            ..Default::default()
        };

        // Should successfully calculate next trigger time using DST-aware offset
        let result = condition_dst_aware.get_next_trigger_time_non_aligned(true, -480, false, None);
        assert!(
            result.is_ok(),
            "DST-aware timezone scheduling should succeed"
        );

        let timestamp = result.unwrap();
        let dt = DateTime::from_timestamp_micros(timestamp).unwrap();

        // The alert should be scheduled for 9 AM in Los Angeles time
        use chrono_tz::America::Los_Angeles;
        let dt_la = dt.with_timezone(&Los_Angeles);
        assert_eq!(dt_la.hour(), 9, "Alert should fire at 9 AM LA time");
        assert_eq!(dt_la.minute(), 0);

        // Test 2: Alert with invalid timezone string (falls back to offset)
        let condition_fallback = TriggerCondition {
            frequency: 300,
            frequency_type: FrequencyType::Cron,
            cron: "0 0 9 * * *".to_string(),
            timezone: Some("Invalid/Timezone".to_string()),
            ..Default::default()
        };

        // Should still work by falling back to provided timezone_offset
        let result = condition_fallback.get_next_trigger_time_non_aligned(true, -480, false, None);
        assert!(
            result.is_ok(),
            "Should fallback to timezone_offset when timezone string is invalid"
        );

        // Test 3: Test with different timezones to verify DST-awareness
        let timezones_to_test = vec![
            ("America/New_York", -300), // EST/EDT
            ("America/Chicago", -360),  // CST/CDT
            ("America/Denver", -420),   // MST/MDT
            ("Europe/London", 0),       // GMT/BST
        ];

        for (tz_name, fallback_offset) in timezones_to_test {
            let condition = TriggerCondition {
                frequency: 300,
                frequency_type: FrequencyType::Cron,
                cron: "0 0 9 * * *".to_string(),
                timezone: Some(tz_name.to_string()),
                ..Default::default()
            };

            let result =
                condition.get_next_trigger_time_non_aligned(true, fallback_offset, false, None);
            assert!(
                result.is_ok(),
                "Timezone {} should work with DST-awareness",
                tz_name
            );
        }
    }

    #[test]
    fn test_condition_group_serialization() {
        // Test simple ConditionGroup serialization
        let condition_json = r#"{
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
                {
                    "filterType": "condition",
                    "column": "status",
                    "operator": "=",
                    "value": "error",
                    "logicalOperator": "AND"
                },
                {
                    "filterType": "condition",
                    "column": "level",
                    "operator": "=",
                    "value": "critical",
                    "logicalOperator": "OR"
                }
            ]
        }"#;

        let condition_group: ConditionGroup = serde_json::from_str(condition_json).unwrap();
        assert_eq!(condition_group.filter_type, "group");
        assert_eq!(condition_group.logical_operator, LogicalOperator::And);
        assert_eq!(condition_group.conditions.len(), 2);

        // Test serialization back to JSON
        let serialized = serde_json::to_value(&condition_group).unwrap();
        assert_eq!(serialized["filterType"], "group");
        assert_eq!(serialized["logicalOperator"], "AND");
    }

    #[test]
    fn test_condition_group_with_nested_groups() {
        let condition_json = r#"{
            "filterType": "group",
            "logicalOperator": "AND",
            "conditions": [
                {
                    "filterType": "condition",
                    "column": "status",
                    "operator": "=",
                    "value": "error",
                    "logicalOperator": "AND"
                },
                {
                    "filterType": "group",
                    "logicalOperator": "AND",
                    "conditions": [
                        {
                            "filterType": "condition",
                            "column": "service",
                            "operator": "=",
                            "value": "api",
                            "logicalOperator": "OR"
                        },
                        {
                            "filterType": "condition",
                            "column": "service",
                            "operator": "=",
                            "value": "web",
                            "logicalOperator": "AND"
                        }
                    ]
                }
            ]
        }"#;

        let condition_group: ConditionGroup = serde_json::from_str(condition_json).unwrap();
        assert_eq!(condition_group.conditions.len(), 2);

        // Check nested group
        if let ConditionItem::Group { conditions, .. } = &condition_group.conditions[1] {
            assert_eq!(conditions.len(), 2);
        } else {
            panic!("Expected nested group");
        }
    }

    #[test]
    fn test_condition_item_logical_operator() {
        let condition_item = ConditionItem::Condition {
            column: "status".to_string(),
            operator: Operator::EqualTo,
            value: Value::String("error".to_string()),
            ignore_case: None,
            logical_operator: LogicalOperator::And,
        };

        assert_eq!(*condition_item.logical_operator(), LogicalOperator::And);

        let group_item = ConditionItem::Group {
            logical_operator: LogicalOperator::Or,
            conditions: vec![],
        };

        assert_eq!(*group_item.logical_operator(), LogicalOperator::Or);
    }

    #[test]
    fn test_condition_group_validation() {
        // Valid condition group (needs at least 2 conditions)
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "status".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                },
                ConditionItem::Condition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("critical".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                },
            ],
        };
        assert!(condition_group.validate().is_ok());

        // Invalid filter type
        let invalid_condition_group = ConditionGroup {
            filter_type: "invalid".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "status".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                },
                ConditionItem::Condition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("critical".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                },
            ],
        };
        assert!(invalid_condition_group.validate().is_err());

        // Empty conditions (should fail - needs at least 2)
        let empty_condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![],
        };
        assert!(empty_condition_group.validate().is_err());
    }

    #[test]
    fn test_backward_compatibility_with_fixed_offset() {
        // Test that alerts without timezone string still work with FixedOffset
        // This ensures backward compatibility for existing alerts
        let condition = TriggerCondition {
            frequency: 300,
            frequency_type: FrequencyType::Cron,
            cron: "0 0 9 * * *".to_string(), // Every day at 9:00 AM
            timezone: None,                  // No timezone string
            ..Default::default()
        };

        // This should fallback to FixedOffset and still work
        let result = condition.get_next_trigger_time_non_aligned(true, -480, false, None);
        assert!(
            result.is_ok(),
            "Alerts without timezone string should fallback to FixedOffset"
        );
    }

    #[test]
    fn test_dst_aware_scheduling_with_silence() {
        // Test DST-aware timezone offset calculation with silence period
        // This ensures silence periods are correctly calculated with DST-aware offsets

        let condition = TriggerCondition {
            frequency: 300,
            frequency_type: FrequencyType::Cron,
            cron: "0 0 9 * * *".to_string(), // Every day at 9:00 AM
            timezone: Some("America/New_York".to_string()),
            silence: 30, // 30 minutes silence
            ..Default::default()
        };

        // Test with silence period applied
        let result_with_silence = condition.get_next_trigger_time_non_aligned(
            true, -300, // EST fallback offset
            true, // apply_silence = true
            None,
        );
        assert!(
            result_with_silence.is_ok(),
            "DST-aware timezone with silence should work"
        );

        // Test without silence period
        let result_no_silence = condition.get_next_trigger_time_non_aligned(
            true, -300, false, // apply_silence = false
            None,
        );
        assert!(
            result_no_silence.is_ok(),
            "DST-aware timezone without silence should work"
        );

        // Verify that silence actually affects the next run time
        let timestamp_with_silence = result_with_silence.unwrap();
        let timestamp_no_silence = result_no_silence.unwrap();

        // With silence should be later than without silence
        // (though they might be equal if next cron occurrence is after silence period)
        assert!(
            timestamp_with_silence >= timestamp_no_silence,
            "Silence period should delay or maintain next run time"
        );
    }

    #[test]
    fn test_get_offset_minutes_from_tz() {
        use chrono_tz::{America::New_York, Europe::London, UTC};

        let now = Utc::now();

        // UTC should always have offset 0
        let utc_offset = get_offset_minutes_from_tz(&UTC, now);
        assert_eq!(utc_offset, 0);

        // New York and London will have different offsets based on current time
        let ny_offset = get_offset_minutes_from_tz(&New_York, now);
        let london_offset = get_offset_minutes_from_tz(&London, now);

        // New York is west of UTC (negative offset)
        assert!(ny_offset < 0);
        // London is close to UTC (0 or +60 during BST)
        assert!(london_offset >= 0 && london_offset <= 60);
    }

    #[test]
    fn test_alert_condition_params_v2_deserialization() {
        // Test V2 format deserialization
        let v2_json = r#"{
            "version": 2,
            "conditions": {
                "filterType": "group",
                "logicalOperator": "AND",
                "conditions": [
                    {
                        "filterType": "condition",
                        "column": "level",
                        "operator": "=",
                        "value": "error",
                        "logicalOperator": "AND"
                    },
                    {
                        "filterType": "condition",
                        "column": "service",
                        "operator": "=",
                        "value": "api",
                        "logicalOperator": "OR"
                    }
                ]
            }
        }"#;

        let result: Result<AlertConditionParams, _> = serde_json::from_str(v2_json);
        assert!(
            result.is_ok(),
            "V2 deserialization failed: {:?}",
            result.err()
        );

        let params = result.unwrap();
        match params {
            AlertConditionParams::V2(group) => {
                assert_eq!(group.filter_type, "group");
                assert_eq!(group.logical_operator, LogicalOperator::And);
                assert_eq!(group.conditions.len(), 2);
            }
            _ => panic!("Expected V2 variant"),
        }
    }

    #[test]
    fn test_alert_condition_params_v1_deserialization() {
        // Test V1 format deserialization (without version field)
        let v1_json = r#"{
            "and": [
                {
                    "column": "level",
                    "operator": "=",
                    "value": "error",
                    "ignore_case": false
                },
                {
                    "column": "service",
                    "operator": "=",
                    "value": "api",
                    "ignore_case": false
                }
            ]
        }"#;

        let result: Result<AlertConditionParams, _> = serde_json::from_str(v1_json);
        assert!(
            result.is_ok(),
            "V1 deserialization failed: {:?}",
            result.err()
        );

        let params = result.unwrap();
        match params {
            AlertConditionParams::V1(conditions) => {
                assert!(matches!(conditions, ConditionList::AndNode { .. }));
            }
            _ => panic!("Expected V1 variant"),
        }
    }

    #[test]
    fn test_query_condition_v2_deserialization() {
        // Test full QueryCondition with V2 format
        let query_condition_json = r#"{
            "type": "custom",
            "conditions": {
                "version": 2,
                "conditions": {
                    "filterType": "group",
                    "logicalOperator": "AND",
                    "conditions": [
                        {
                            "filterType": "condition",
                            "column": "level",
                            "operator": "=",
                            "value": "error",
                            "logicalOperator": "AND"
                        },
                        {
                            "filterType": "condition",
                            "column": "service",
                            "operator": "=",
                            "value": "api",
                            "logicalOperator": "OR"
                        }
                    ]
                }
            },
            "sql": null,
            "promql": null,
            "aggregation": null,
            "promql_condition": null,
            "vrl_function": null,
            "multi_time_range": null
        }"#;

        let result: Result<QueryCondition, _> = serde_json::from_str(query_condition_json);
        assert!(
            result.is_ok(),
            "QueryCondition deserialization failed: {:?}",
            result.err()
        );

        let query_cond = result.unwrap();
        assert_eq!(query_cond.query_type, QueryType::Custom);
        assert!(query_cond.conditions.is_some());

        match query_cond.conditions.unwrap() {
            AlertConditionParams::V2(group) => {
                assert_eq!(group.filter_type, "group");
                assert_eq!(group.logical_operator, LogicalOperator::And);
                assert_eq!(group.conditions.len(), 2);
            }
            _ => panic!("Expected V2 variant"),
        }
    }

    #[test]
    fn test_query_condition_v2_with_empty_strings() {
        // Test with empty strings for optional fields (like the user's curl payload)
        let query_condition_json = r#"{
            "type": "custom",
            "conditions": {
                "version": 2,
                "conditions": {
                    "filterType": "group",
                    "logicalOperator": "AND",
                    "conditions": [
                        {
                            "filterType": "condition",
                            "column": "level",
                            "operator": "=",
                            "value": "error",
                            "logicalOperator": "AND"
                        },
                        {
                            "filterType": "condition",
                            "column": "service",
                            "operator": "=",
                            "value": "api",
                            "logicalOperator": "OR"
                        }
                    ]
                }
            },
            "sql": "",
            "promql": "",
            "aggregation": null,
            "promql_condition": null,
            "vrl_function": null,
            "multi_time_range": []
        }"#;

        let result: Result<QueryCondition, _> = serde_json::from_str(query_condition_json);
        assert!(
            result.is_ok(),
            "QueryCondition deserialization with empty strings failed: {:?}",
            result.err()
        );

        let query_cond = result.unwrap();
        assert_eq!(query_cond.query_type, QueryType::Custom);
        assert!(query_cond.conditions.is_some());

        match query_cond.conditions.unwrap() {
            AlertConditionParams::V2(group) => {
                assert_eq!(group.filter_type, "group");
                assert_eq!(group.logical_operator, LogicalOperator::And);
                assert_eq!(group.conditions.len(), 2);
            }
            _ => panic!("Expected V2 variant"),
        }

        // Verify empty strings are treated as Some("") not None
        assert!(query_cond.sql.is_some());
        assert_eq!(query_cond.sql.unwrap(), "");
    }

    #[test]
    fn test_exact_user_payload() {
        // Test the exact structure from the user's curl command
        let user_json = r#"{
  "type": "custom",
  "conditions": {
    "version": 2,
    "conditions": {
      "filterType": "group",
      "logicalOperator": "AND",
      "conditions": [
        {
          "filterType": "condition",
          "column": "level",
          "operator": "=",
          "value": "error",
          "logicalOperator": "AND"
        },
        {
          "filterType": "condition",
          "column": "service",
          "operator": "=",
          "value": "api",
          "logicalOperator": "OR"
        }
      ]
    }
  },
  "sql": null,
  "promql": null,
  "aggregation": null,
  "promql_condition": null,
  "vrl_function": null,
  "search_event_type": null,
  "multi_time_range": null
}"#;

        println!("Testing user JSON...");
        let result: Result<QueryCondition, _> = serde_json::from_str(user_json);

        if let Err(ref e) = result {
            println!("Deserialization error: {}", e);

            // Try parsing just the conditions field
            let value: serde_json::Value = serde_json::from_str(user_json).unwrap();
            if let Some(conditions) = value.get("conditions") {
                println!("Conditions value: {:#?}", conditions);
                let cond_result: Result<AlertConditionParams, _> =
                    serde_json::from_value(conditions.clone());
                println!(
                    "Direct AlertConditionParams parse result: {:?}",
                    cond_result
                );
            }
        }

        assert!(
            result.is_ok(),
            "User payload deserialization failed: {:?}",
            result.err()
        );
    }
}
