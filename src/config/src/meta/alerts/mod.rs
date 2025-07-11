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

use chrono::{Duration, FixedOffset, Timelike, Utc};
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
        let timezone_offset = FixedOffset::east_opt(timezone_offset * 60).unwrap();
        if self.frequency_type == FrequencyType::Cron {
            let schedule = Schedule::from_str(&self.cron)?;
            if apply_silence {
                let silence = start_utc + Duration::try_minutes(self.silence).unwrap();
                let silence = silence.with_timezone(&timezone_offset);
                // Check for the cron timestamp after the silence period
                Ok(schedule.after(&silence).next().unwrap().timestamp_micros() + tolerance)
            } else {
                // This is important, if provided start_utc was `Some`, it should use the next run
                // after the start_utc. If it was `None`, it should use the next run after the
                // current time.
                let start_utc = start_utc.with_timezone(&timezone_offset);
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
    pub fn align_time(next_run_at: i64, timezone_offset: i32, frequency: Option<i64>) -> i64 {
        // Convert the timestamp to a DateTime with the specified timezone offset
        let timezone = FixedOffset::east_opt(timezone_offset * 60).unwrap();
        let dt = chrono::DateTime::from_timestamp_micros(next_run_at)
            .unwrap_or_default()
            .with_timezone(&timezone);

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
    pub conditions: Option<ConditionList>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub enum Operator {
    #[serde(rename = "=")]
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

impl Default for Operator {
    fn default() -> Self {
        Self::EqualTo
    }
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
        let aligned_time = TriggerCondition::align_time(next_run_at, 0, Some(300)); // 5 minutes in seconds
        let aligned_dt = DateTime::from_timestamp_micros(aligned_time).unwrap();
        assert_eq!(aligned_dt.hour(), 11);
        assert_eq!(aligned_dt.minute(), 0);
        assert_eq!(aligned_dt.second(), 0);

        // Test case 2: Align to 1-hour intervals
        let dt = timezone.with_ymd_and_hms(2025, 1, 1, 17, 19, 30).unwrap();
        let next_run_at = dt.timestamp_micros();
        let aligned_time = TriggerCondition::align_time(next_run_at, 0, Some(3600)); // 1 hour in seconds
        let aligned_dt = DateTime::from_timestamp_micros(aligned_time).unwrap();
        assert_eq!(aligned_dt.hour(), 17);
        assert_eq!(aligned_dt.minute(), 0);
        assert_eq!(aligned_dt.second(), 0);

        // Test case 3: Align to 1-minute intervals
        let dt = timezone.with_ymd_and_hms(2025, 1, 1, 17, 19, 11).unwrap();
        let next_run_at = dt.timestamp_micros();
        let aligned_time = TriggerCondition::align_time(next_run_at, 0, Some(60)); // 1 minute in seconds
        let aligned_dt = DateTime::from_timestamp_micros(aligned_time).unwrap();
        assert_eq!(aligned_dt.hour(), 17);
        assert_eq!(aligned_dt.minute(), 19);
        assert_eq!(aligned_dt.second(), 0);

        // Test case 4: Already at interval boundary
        let dt = timezone.with_ymd_and_hms(2025, 1, 1, 17, 0, 0).unwrap();
        let next_run_at = dt.timestamp_micros();
        let aligned_time = TriggerCondition::align_time(next_run_at, 0, Some(3600)); // 1 hour in seconds
        let aligned_dt = DateTime::from_timestamp_micros(aligned_time).unwrap();
        assert_eq!(aligned_dt.hour(), 17);
        assert_eq!(aligned_dt.minute(), 0);
        assert_eq!(aligned_dt.second(), 0);

        // Test case 5: Different timezone (UTC+8)
        let timezone = FixedOffset::east_opt(8 * 60 * 60).unwrap(); // UTC+8
        let dt = timezone.with_ymd_and_hms(2025, 1, 1, 17, 19, 30).unwrap();
        let next_run_at = dt.timestamp_micros();
        // `align_time` expects frequency in minutes, so convert 8 hours to minutes
        let aligned_time = TriggerCondition::align_time(next_run_at, 8 * 60, Some(3600)); // 1 hour in seconds
        let aligned_dt = DateTime::from_timestamp_micros(aligned_time)
            .unwrap()
            .with_timezone(&timezone);
        assert_eq!(aligned_dt.hour(), 17);
        assert_eq!(aligned_dt.minute(), 0);
        assert_eq!(aligned_dt.second(), 0);
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
            println!("Testing: {}", json);
            let deserialized: ConditionList = serde_json::from_str(json).unwrap_or_else(|e| {
                panic!("Failed to deserialize '{}': {}", json, e);
            });

            // Use pattern matching to verify enum variant
            assert!(
                matches!(deserialized, ConditionList::LegacyConditions(_)),
                "Expected LegacyConditions variant for '{}'",
                json
            );

            // Then verify equality with the expected value
            assert_eq!(deserialized, expected, "Value mismatch for '{}'", json);
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
}
