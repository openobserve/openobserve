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

use std::{fmt::Display, str::FromStr};

use config::meta::{
    alerts::{
        AggFunction as MetaAggFunction, Aggregation as MetaAggregation,
        CompareHistoricData as MetaCompareHistoricData, Condition as MetaCondition,
        FrequencyType as MetaFrequencyType, Operator as MetaOperator, QueryType as MetaQueryType,
    },
    search::SearchEventType as MetaSearchEventType,
    stream::StreamType as MetaStreamType,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::errors::{FromI16Error, FromStrError};

/// Query historic data comparison. Stored in the DB as a JSON object.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct QueryCompareHistoricData {
    pub offset: String,
}

impl From<MetaCompareHistoricData> for QueryCompareHistoricData {
    fn from(value: MetaCompareHistoricData) -> Self {
        Self {
            offset: value.offset,
        }
    }
}

impl From<QueryCompareHistoricData> for MetaCompareHistoricData {
    fn from(value: QueryCompareHistoricData) -> Self {
        Self {
            offset: value.offset,
        }
    }
}

/// Threshold frequency type. Stored in the DB as a 16-bit integere.
pub enum TriggerFrequencyType {
    Cron,
    Seconds,
}

impl TriggerFrequencyType {
    const CRON: i16 = 0;
    const SECONDS: i16 = 1;
}

impl From<TriggerFrequencyType> for i16 {
    fn from(value: TriggerFrequencyType) -> Self {
        match value {
            TriggerFrequencyType::Cron => TriggerFrequencyType::CRON,
            TriggerFrequencyType::Seconds => TriggerFrequencyType::SECONDS,
        }
    }
}

impl TryFrom<i16> for TriggerFrequencyType {
    type Error = FromI16Error;

    fn try_from(value: i16) -> Result<Self, Self::Error> {
        match value {
            Self::CRON => Ok(TriggerFrequencyType::Cron),
            Self::SECONDS => Ok(TriggerFrequencyType::Seconds),
            _ => Err(FromI16Error {
                value,
                ty: "FrequencyType".to_owned(),
            }),
        }
    }
}

impl From<MetaFrequencyType> for TriggerFrequencyType {
    fn from(value: MetaFrequencyType) -> Self {
        match value {
            MetaFrequencyType::Cron => TriggerFrequencyType::Cron,
            MetaFrequencyType::Minutes => TriggerFrequencyType::Seconds,
        }
    }
}

impl From<TriggerFrequencyType> for MetaFrequencyType {
    fn from(value: TriggerFrequencyType) -> Self {
        match value {
            TriggerFrequencyType::Cron => MetaFrequencyType::Cron,
            TriggerFrequencyType::Seconds => MetaFrequencyType::Minutes,
        }
    }
}

/// Query aggregation. Stored in the DB as a JSON object.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct QueryAggregation {
    pub group_by: Option<Vec<String>>,
    pub function: AggFunction,
    pub having: QueryCondition,
}

impl From<MetaAggregation> for QueryAggregation {
    fn from(value: MetaAggregation) -> Self {
        Self {
            group_by: value.group_by,
            function: value.function.into(),
            having: value.having.into(),
        }
    }
}

impl From<QueryAggregation> for MetaAggregation {
    fn from(value: QueryAggregation) -> Self {
        Self {
            group_by: value.group_by,
            function: value.function.into(),
            having: value.having.into(),
        }
    }
}

/// Query aggregation function. Stored in the DB as a JSON string.
#[derive(Serialize, Deserialize)]
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

impl From<MetaAggFunction> for AggFunction {
    fn from(value: MetaAggFunction) -> Self {
        match value {
            MetaAggFunction::Avg => Self::Avg,
            MetaAggFunction::Min => Self::Min,
            MetaAggFunction::Max => Self::Max,
            MetaAggFunction::Sum => Self::Sum,
            MetaAggFunction::Count => Self::Count,
            MetaAggFunction::Median => Self::Median,
            MetaAggFunction::P50 => Self::P50,
            MetaAggFunction::P75 => Self::P75,
            MetaAggFunction::P90 => Self::P90,
            MetaAggFunction::P95 => Self::P95,
            MetaAggFunction::P99 => Self::P99,
        }
    }
}

impl From<AggFunction> for MetaAggFunction {
    fn from(value: AggFunction) -> Self {
        match value {
            AggFunction::Avg => Self::Avg,
            AggFunction::Min => Self::Min,
            AggFunction::Max => Self::Max,
            AggFunction::Sum => Self::Sum,
            AggFunction::Count => Self::Count,
            AggFunction::Median => Self::Median,
            AggFunction::P50 => Self::P50,
            AggFunction::P75 => Self::P75,
            AggFunction::P90 => Self::P90,
            AggFunction::P95 => Self::P95,
            AggFunction::P99 => Self::P99,
        }
    }
}

/// Query type. Stored in the DB as a 16-bit integer
pub enum QueryType {
    Custom,
    Sql,
    Promql,
}

impl QueryType {
    const CUSTOM: i16 = 0;
    const SQL: i16 = 1;
    const PROMQL: i16 = 2;
}

impl From<QueryType> for i16 {
    fn from(value: QueryType) -> Self {
        match value {
            QueryType::Custom => QueryType::CUSTOM,
            QueryType::Sql => QueryType::SQL,
            QueryType::Promql => QueryType::PROMQL,
        }
    }
}

impl TryFrom<i16> for QueryType {
    type Error = FromI16Error;

    fn try_from(value: i16) -> Result<Self, Self::Error> {
        match value {
            Self::CUSTOM => Ok(QueryType::Custom),
            Self::SQL => Ok(QueryType::Sql),
            Self::PROMQL => Ok(QueryType::Promql),
            _ => Err(FromI16Error {
                value,
                ty: "QueryType".to_string(),
            }),
        }
    }
}

impl From<MetaQueryType> for QueryType {
    fn from(value: MetaQueryType) -> Self {
        match value {
            MetaQueryType::Custom => QueryType::Custom,
            MetaQueryType::SQL => QueryType::Sql,
            MetaQueryType::PromQL => QueryType::Promql,
        }
    }
}

impl From<QueryType> for MetaQueryType {
    fn from(value: QueryType) -> Self {
        match value {
            QueryType::Custom => MetaQueryType::Custom,
            QueryType::Sql => MetaQueryType::SQL,
            QueryType::Promql => MetaQueryType::PromQL,
        }
    }
}

/// Query condition. Stored in the DB as a JSON object.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct QueryCondition {
    pub column: String,
    pub operator: ConditionOperator,
    pub value: JsonValue,
    pub ignore_case: bool,
}

impl From<MetaCondition> for QueryCondition {
    fn from(value: MetaCondition) -> Self {
        Self {
            column: value.column,
            operator: value.operator.into(),
            value: value.value,
            ignore_case: value.ignore_case,
        }
    }
}

impl From<QueryCondition> for MetaCondition {
    fn from(value: QueryCondition) -> Self {
        Self {
            column: value.column,
            operator: value.operator.into(),
            value: value.value,
            ignore_case: value.ignore_case,
        }
    }
}

/// Query condition operator. Includes binary predicates that can be applied to
/// untyped values. Stored in the DB as a JSON string.
#[derive(Serialize, Deserialize)]
pub enum ConditionOperator {
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
    Contains,
    #[serde(rename = "not_contains")]
    NotContains,
}

impl From<MetaOperator> for ConditionOperator {
    fn from(value: MetaOperator) -> Self {
        match value {
            MetaOperator::EqualTo => Self::EqualTo,
            MetaOperator::NotEqualTo => Self::NotEqualTo,
            MetaOperator::GreaterThan => Self::GreaterThan,
            MetaOperator::GreaterThanEquals => Self::GreaterThanEquals,
            MetaOperator::LessThan => Self::LessThan,
            MetaOperator::LessThanEquals => Self::LessThanEquals,
            MetaOperator::Contains => Self::Contains,
            MetaOperator::NotContains => Self::NotContains,
        }
    }
}

impl From<ConditionOperator> for MetaOperator {
    fn from(value: ConditionOperator) -> Self {
        match value {
            ConditionOperator::EqualTo => Self::EqualTo,
            ConditionOperator::NotEqualTo => Self::NotEqualTo,
            ConditionOperator::GreaterThan => Self::GreaterThan,
            ConditionOperator::GreaterThanEquals => Self::GreaterThanEquals,
            ConditionOperator::LessThan => Self::LessThan,
            ConditionOperator::LessThanEquals => Self::LessThanEquals,
            ConditionOperator::Contains => Self::Contains,
            ConditionOperator::NotContains => Self::NotContains,
        }
    }
}

/// Threshold operator. Includes binary predicates for comparison of numeric
/// values. Stored in the DB as a string.
pub enum TriggerThresholdOperator {
    EqualTo,
    NotEqualTo,
    GreaterThan,
    GreaterThanEquals,
    LessThan,
    LessThanEquals,
}

impl TriggerThresholdOperator {
    const EQUAL_TO: &'static str = "=";
    const NOT_EQUAL_TO: &'static str = "!=";
    const GREATER_THAN: &'static str = ">";
    const GREATER_THAN_EQUALS: &'static str = ">=";
    const LESS_THAN: &'static str = "<";
    const LESS_THAN_EQUALS: &'static str = "<=";
}

// Implementation for translating from intermediate representation into DB
// representation.
impl Display for TriggerThresholdOperator {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = match self {
            TriggerThresholdOperator::EqualTo => Self::EQUAL_TO,
            TriggerThresholdOperator::NotEqualTo => Self::NOT_EQUAL_TO,
            TriggerThresholdOperator::GreaterThan => Self::GREATER_THAN,
            TriggerThresholdOperator::GreaterThanEquals => Self::GREATER_THAN_EQUALS,
            TriggerThresholdOperator::LessThan => Self::LESS_THAN,
            TriggerThresholdOperator::LessThanEquals => Self::LESS_THAN_EQUALS,
        };
        write!(f, "{str}")
    }
}

// Implementation for translating from DB representation into intermediate
// representation.
impl FromStr for TriggerThresholdOperator {
    type Err = FromStrError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            Self::EQUAL_TO => Ok(TriggerThresholdOperator::EqualTo),
            Self::NOT_EQUAL_TO => Ok(TriggerThresholdOperator::NotEqualTo),
            Self::GREATER_THAN => Ok(TriggerThresholdOperator::GreaterThan),
            Self::GREATER_THAN_EQUALS => Ok(TriggerThresholdOperator::GreaterThanEquals),
            Self::LESS_THAN => Ok(TriggerThresholdOperator::LessThan),
            Self::LESS_THAN_EQUALS => Ok(TriggerThresholdOperator::LessThanEquals),
            _ => Err(FromStrError {
                value: s.to_owned(),
                ty: "ThresholdOperator".to_owned(),
            }),
        }
    }
}

impl TryFrom<MetaOperator> for TriggerThresholdOperator {
    type Error = ();

    fn try_from(value: MetaOperator) -> Result<Self, Self::Error> {
        match value {
            MetaOperator::EqualTo => Ok(Self::EqualTo),
            MetaOperator::NotEqualTo => Ok(Self::NotEqualTo),
            MetaOperator::GreaterThan => Ok(Self::GreaterThan),
            MetaOperator::GreaterThanEquals => Ok(Self::GreaterThanEquals),
            MetaOperator::LessThan => Ok(Self::LessThan),
            MetaOperator::LessThanEquals => Ok(Self::LessThanEquals),
            _ => Err(()),
        }
    }
}

impl From<TriggerThresholdOperator> for MetaOperator {
    fn from(value: TriggerThresholdOperator) -> Self {
        match value {
            TriggerThresholdOperator::EqualTo => Self::EqualTo,
            TriggerThresholdOperator::NotEqualTo => Self::NotEqualTo,
            TriggerThresholdOperator::GreaterThan => Self::GreaterThan,
            TriggerThresholdOperator::GreaterThanEquals => Self::GreaterThanEquals,
            TriggerThresholdOperator::LessThan => Self::LessThan,
            TriggerThresholdOperator::LessThanEquals => Self::LessThanEquals,
        }
    }
}

/// Search event type. Stored in the DB as a 16-bit integer.
pub enum QuerySearchEventType {
    Ui,
    Dashboards,
    Reports,
    Alerts,
    Values,
    Other,
    Rum,
    DerivedStream,
    SearchJob,
    Download,
    Insights,
}

impl QuerySearchEventType {
    const UI: i16 = 0;
    const DASHBOARDS: i16 = 1;
    const REPORTS: i16 = 2;
    const ALERTS: i16 = 3;
    const VALUES: i16 = 4;
    const OTHER: i16 = 5;
    const RUM: i16 = 6;
    const DERIVED_STREAM: i16 = 7;
    const SEARCH_JOB: i16 = 8;
    const DOWNLOAD: i16 = 9;
    const INSIGHTS: i16 = 10;
}

// Implementation for translating from intermediate representation into DB
// representation.
impl From<QuerySearchEventType> for i16 {
    fn from(value: QuerySearchEventType) -> Self {
        match value {
            QuerySearchEventType::Ui => QuerySearchEventType::UI,
            QuerySearchEventType::Dashboards => QuerySearchEventType::DASHBOARDS,
            QuerySearchEventType::Reports => QuerySearchEventType::REPORTS,
            QuerySearchEventType::Alerts => QuerySearchEventType::ALERTS,
            QuerySearchEventType::Values => QuerySearchEventType::VALUES,
            QuerySearchEventType::Other => QuerySearchEventType::OTHER,
            QuerySearchEventType::Rum => QuerySearchEventType::RUM,
            QuerySearchEventType::DerivedStream => QuerySearchEventType::DERIVED_STREAM,
            QuerySearchEventType::SearchJob => QuerySearchEventType::SEARCH_JOB,
            QuerySearchEventType::Download => QuerySearchEventType::DOWNLOAD,
            QuerySearchEventType::Insights => QuerySearchEventType::INSIGHTS,
        }
    }
}

// Implementation for translating from DB representation into intermediate
// representation.
impl TryFrom<i16> for QuerySearchEventType {
    type Error = FromI16Error;

    fn try_from(value: i16) -> Result<Self, Self::Error> {
        match value {
            Self::UI => Ok(QuerySearchEventType::Ui),
            Self::DASHBOARDS => Ok(QuerySearchEventType::Dashboards),
            Self::REPORTS => Ok(QuerySearchEventType::Reports),
            Self::ALERTS => Ok(QuerySearchEventType::Alerts),
            Self::VALUES => Ok(QuerySearchEventType::Values),
            Self::OTHER => Ok(QuerySearchEventType::Other),
            Self::RUM => Ok(QuerySearchEventType::Rum),
            Self::DERIVED_STREAM => Ok(QuerySearchEventType::DerivedStream),
            Self::SEARCH_JOB => Ok(QuerySearchEventType::SearchJob),
            Self::DOWNLOAD => Ok(QuerySearchEventType::Download),
            Self::INSIGHTS => Ok(QuerySearchEventType::Insights),
            _ => Err(FromI16Error {
                value,
                ty: "SearchEventType".to_owned(),
            }),
        }
    }
}

impl From<MetaSearchEventType> for QuerySearchEventType {
    fn from(value: MetaSearchEventType) -> Self {
        match value {
            MetaSearchEventType::UI => Self::Ui,
            MetaSearchEventType::Dashboards => Self::Dashboards,
            MetaSearchEventType::Reports => Self::Reports,
            MetaSearchEventType::Alerts => Self::Alerts,
            MetaSearchEventType::Values => Self::Values,
            MetaSearchEventType::Other => Self::Other,
            MetaSearchEventType::RUM => Self::Rum,
            MetaSearchEventType::DerivedStream => Self::DerivedStream,
            MetaSearchEventType::SearchJob => Self::SearchJob,
            MetaSearchEventType::Download => Self::Download,
            MetaSearchEventType::Insights => Self::Insights,
        }
    }
}

impl From<QuerySearchEventType> for MetaSearchEventType {
    fn from(value: QuerySearchEventType) -> Self {
        match value {
            QuerySearchEventType::Ui => Self::UI,
            QuerySearchEventType::Dashboards => Self::Dashboards,
            QuerySearchEventType::Reports => Self::Reports,
            QuerySearchEventType::Alerts => Self::Alerts,
            QuerySearchEventType::Values => Self::Values,
            QuerySearchEventType::Other => Self::Other,
            QuerySearchEventType::Rum => Self::RUM,
            QuerySearchEventType::DerivedStream => Self::DerivedStream,
            QuerySearchEventType::SearchJob => Self::SearchJob,
            QuerySearchEventType::Download => Self::Download,
            QuerySearchEventType::Insights => Self::Insights,
        }
    }
}

/// Stream type. Stored in the DB as a string.
pub enum StreamType {
    Logs,
    Metrics,
    Traces,
    EnrichmentTables,
    FileList,
    Metadata,
    Index,
}

impl StreamType {
    const LOGS: &'static str = "logs";
    const METRICS: &'static str = "metrics";
    const TRACES: &'static str = "traces";
    const ENRICHMENT_TABLES: &'static str = "enrichment_tables";
    const FILE_LIST: &'static str = "file_list";
    const METADATA: &'static str = "metadata";
    const INDEX: &'static str = "index";
}

impl Display for StreamType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let str = match self {
            StreamType::Logs => StreamType::LOGS,
            StreamType::Metrics => StreamType::METRICS,
            StreamType::Traces => StreamType::TRACES,
            StreamType::EnrichmentTables => StreamType::ENRICHMENT_TABLES,
            StreamType::FileList => StreamType::FILE_LIST,
            StreamType::Metadata => StreamType::METADATA,
            StreamType::Index => StreamType::INDEX,
        };
        write!(f, "{str}")
    }
}

impl FromStr for StreamType {
    type Err = FromStrError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            Self::LOGS => Ok(StreamType::Logs),
            Self::METRICS => Ok(StreamType::Metrics),
            Self::TRACES => Ok(StreamType::Traces),
            Self::ENRICHMENT_TABLES => Ok(StreamType::EnrichmentTables),
            Self::FILE_LIST => Ok(StreamType::FileList),
            Self::METADATA => Ok(StreamType::Metadata),
            Self::INDEX => Ok(StreamType::Index),
            _ => Err(FromStrError {
                value: s.to_owned(),
                ty: "StreamType".to_owned(),
            }),
        }
    }
}

impl From<MetaStreamType> for StreamType {
    fn from(value: MetaStreamType) -> Self {
        match value {
            MetaStreamType::Logs => Self::Logs,
            MetaStreamType::Metrics => Self::Metrics,
            MetaStreamType::Traces => Self::Traces,
            MetaStreamType::ServiceGraph => Self::Metadata, // Map to Metadata for alerts
            MetaStreamType::EnrichmentTables => Self::EnrichmentTables,
            MetaStreamType::Filelist => Self::FileList,
            MetaStreamType::Metadata => Self::Metadata,
            MetaStreamType::Index => Self::Index,
        }
    }
}

impl From<StreamType> for MetaStreamType {
    fn from(value: StreamType) -> Self {
        match value {
            StreamType::Logs => Self::Logs,
            StreamType::Metrics => Self::Metrics,
            StreamType::Traces => Self::Traces,
            StreamType::EnrichmentTables => Self::EnrichmentTables,
            StreamType::FileList => Self::Filelist,
            StreamType::Metadata => Self::Metadata,
            StreamType::Index => Self::Index,
        }
    }
}

/// Row template type. Stored in the DB as a 16-bit integer.
pub enum RowTemplateTypeDb {
    String,
    Json,
}

impl RowTemplateTypeDb {
    const STRING: i16 = 0;
    const JSON: i16 = 1;
}

impl From<RowTemplateTypeDb> for i16 {
    fn from(value: RowTemplateTypeDb) -> Self {
        match value {
            RowTemplateTypeDb::String => RowTemplateTypeDb::STRING,
            RowTemplateTypeDb::Json => RowTemplateTypeDb::JSON,
        }
    }
}

impl TryFrom<i16> for RowTemplateTypeDb {
    type Error = FromI16Error;

    fn try_from(value: i16) -> Result<Self, Self::Error> {
        match value {
            Self::STRING => Ok(RowTemplateTypeDb::String),
            Self::JSON => Ok(RowTemplateTypeDb::Json),
            _ => Err(FromI16Error {
                value,
                ty: "RowTemplateTypeDb".to_owned(),
            }),
        }
    }
}

impl From<config::meta::alerts::alert::RowTemplateType> for RowTemplateTypeDb {
    fn from(value: config::meta::alerts::alert::RowTemplateType) -> Self {
        match value {
            config::meta::alerts::alert::RowTemplateType::String => RowTemplateTypeDb::String,
            config::meta::alerts::alert::RowTemplateType::Json => RowTemplateTypeDb::Json,
        }
    }
}

impl From<RowTemplateTypeDb> for config::meta::alerts::alert::RowTemplateType {
    fn from(value: RowTemplateTypeDb) -> Self {
        match value {
            RowTemplateTypeDb::String => config::meta::alerts::alert::RowTemplateType::String,
            RowTemplateTypeDb::Json => config::meta::alerts::alert::RowTemplateType::Json,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── TriggerFrequencyType ──────────────────────────────────────────────────

    #[test]
    fn test_trigger_frequency_type_to_i16() {
        assert_eq!(i16::from(TriggerFrequencyType::Cron), 0i16);
        assert_eq!(i16::from(TriggerFrequencyType::Seconds), 1i16);
    }

    #[test]
    fn test_trigger_frequency_type_try_from_i16() {
        assert!(matches!(
            TriggerFrequencyType::try_from(0i16),
            Ok(TriggerFrequencyType::Cron)
        ));
        assert!(matches!(
            TriggerFrequencyType::try_from(1i16),
            Ok(TriggerFrequencyType::Seconds)
        ));
        assert!(TriggerFrequencyType::try_from(99i16).is_err());
    }

    #[test]
    fn test_trigger_frequency_type_from_meta() {
        assert!(matches!(
            TriggerFrequencyType::from(MetaFrequencyType::Cron),
            TriggerFrequencyType::Cron
        ));
        assert!(matches!(
            TriggerFrequencyType::from(MetaFrequencyType::Minutes),
            TriggerFrequencyType::Seconds
        ));
    }

    #[test]
    fn test_trigger_frequency_type_to_meta() {
        assert!(matches!(
            MetaFrequencyType::from(TriggerFrequencyType::Cron),
            MetaFrequencyType::Cron
        ));
        assert!(matches!(
            MetaFrequencyType::from(TriggerFrequencyType::Seconds),
            MetaFrequencyType::Minutes
        ));
    }

    // ── TriggerThresholdOperator ──────────────────────────────────────────────

    #[test]
    fn test_trigger_threshold_operator_display() {
        assert_eq!(TriggerThresholdOperator::EqualTo.to_string(), "=");
        assert_eq!(TriggerThresholdOperator::NotEqualTo.to_string(), "!=");
        assert_eq!(TriggerThresholdOperator::GreaterThan.to_string(), ">");
        assert_eq!(
            TriggerThresholdOperator::GreaterThanEquals.to_string(),
            ">="
        );
        assert_eq!(TriggerThresholdOperator::LessThan.to_string(), "<");
        assert_eq!(TriggerThresholdOperator::LessThanEquals.to_string(), "<=");
    }

    #[test]
    fn test_trigger_threshold_operator_from_str() {
        assert!(matches!(
            TriggerThresholdOperator::from_str("="),
            Ok(TriggerThresholdOperator::EqualTo)
        ));
        assert!(matches!(
            TriggerThresholdOperator::from_str("!="),
            Ok(TriggerThresholdOperator::NotEqualTo)
        ));
        assert!(matches!(
            TriggerThresholdOperator::from_str(">"),
            Ok(TriggerThresholdOperator::GreaterThan)
        ));
        assert!(matches!(
            TriggerThresholdOperator::from_str(">="),
            Ok(TriggerThresholdOperator::GreaterThanEquals)
        ));
        assert!(matches!(
            TriggerThresholdOperator::from_str("<"),
            Ok(TriggerThresholdOperator::LessThan)
        ));
        assert!(matches!(
            TriggerThresholdOperator::from_str("<="),
            Ok(TriggerThresholdOperator::LessThanEquals)
        ));
        assert!(TriggerThresholdOperator::from_str("bad").is_err());
    }

    #[test]
    fn test_trigger_threshold_operator_display_roundtrip() {
        for op in [
            TriggerThresholdOperator::EqualTo,
            TriggerThresholdOperator::NotEqualTo,
            TriggerThresholdOperator::GreaterThan,
            TriggerThresholdOperator::GreaterThanEquals,
            TriggerThresholdOperator::LessThan,
            TriggerThresholdOperator::LessThanEquals,
        ] {
            let s = op.to_string();
            let back = TriggerThresholdOperator::from_str(&s).unwrap();
            assert_eq!(back.to_string(), s);
        }
    }

    #[test]
    fn test_trigger_threshold_operator_try_from_meta_operator() {
        assert!(TriggerThresholdOperator::try_from(MetaOperator::EqualTo).is_ok());
        assert!(TriggerThresholdOperator::try_from(MetaOperator::NotEqualTo).is_ok());
        assert!(TriggerThresholdOperator::try_from(MetaOperator::GreaterThan).is_ok());
        assert!(TriggerThresholdOperator::try_from(MetaOperator::GreaterThanEquals).is_ok());
        assert!(TriggerThresholdOperator::try_from(MetaOperator::LessThan).is_ok());
        assert!(TriggerThresholdOperator::try_from(MetaOperator::LessThanEquals).is_ok());
        // non-threshold operators → Err
        assert!(TriggerThresholdOperator::try_from(MetaOperator::Contains).is_err());
    }

    // ── AggFunction ──────────────────────────────────────────────────────────

    #[test]
    fn test_agg_function_from_meta_all_variants() {
        assert!(matches!(
            AggFunction::from(MetaAggFunction::Avg),
            AggFunction::Avg
        ));
        assert!(matches!(
            AggFunction::from(MetaAggFunction::Min),
            AggFunction::Min
        ));
        assert!(matches!(
            AggFunction::from(MetaAggFunction::Max),
            AggFunction::Max
        ));
        assert!(matches!(
            AggFunction::from(MetaAggFunction::Sum),
            AggFunction::Sum
        ));
        assert!(matches!(
            AggFunction::from(MetaAggFunction::Count),
            AggFunction::Count
        ));
        assert!(matches!(
            AggFunction::from(MetaAggFunction::Median),
            AggFunction::Median
        ));
        assert!(matches!(
            AggFunction::from(MetaAggFunction::P50),
            AggFunction::P50
        ));
        assert!(matches!(
            AggFunction::from(MetaAggFunction::P75),
            AggFunction::P75
        ));
        assert!(matches!(
            AggFunction::from(MetaAggFunction::P90),
            AggFunction::P90
        ));
        assert!(matches!(
            AggFunction::from(MetaAggFunction::P95),
            AggFunction::P95
        ));
        assert!(matches!(
            AggFunction::from(MetaAggFunction::P99),
            AggFunction::P99
        ));
    }

    #[test]
    fn test_agg_function_to_meta_all_variants() {
        assert!(matches!(
            MetaAggFunction::from(AggFunction::Avg),
            MetaAggFunction::Avg
        ));
        assert!(matches!(
            MetaAggFunction::from(AggFunction::Min),
            MetaAggFunction::Min
        ));
        assert!(matches!(
            MetaAggFunction::from(AggFunction::Max),
            MetaAggFunction::Max
        ));
        assert!(matches!(
            MetaAggFunction::from(AggFunction::Sum),
            MetaAggFunction::Sum
        ));
        assert!(matches!(
            MetaAggFunction::from(AggFunction::Count),
            MetaAggFunction::Count
        ));
        assert!(matches!(
            MetaAggFunction::from(AggFunction::Median),
            MetaAggFunction::Median
        ));
        assert!(matches!(
            MetaAggFunction::from(AggFunction::P50),
            MetaAggFunction::P50
        ));
        assert!(matches!(
            MetaAggFunction::from(AggFunction::P75),
            MetaAggFunction::P75
        ));
        assert!(matches!(
            MetaAggFunction::from(AggFunction::P90),
            MetaAggFunction::P90
        ));
        assert!(matches!(
            MetaAggFunction::from(AggFunction::P95),
            MetaAggFunction::P95
        ));
        assert!(matches!(
            MetaAggFunction::from(AggFunction::P99),
            MetaAggFunction::P99
        ));
    }

    // ── QueryType ────────────────────────────────────────────────────────────

    #[test]
    fn test_query_type_to_i16() {
        assert_eq!(i16::from(QueryType::Custom), 0i16);
        assert_eq!(i16::from(QueryType::Sql), 1i16);
        assert_eq!(i16::from(QueryType::Promql), 2i16);
    }

    #[test]
    fn test_query_type_try_from_i16() {
        assert!(matches!(QueryType::try_from(0i16), Ok(QueryType::Custom)));
        assert!(matches!(QueryType::try_from(1i16), Ok(QueryType::Sql)));
        assert!(matches!(QueryType::try_from(2i16), Ok(QueryType::Promql)));
        assert!(QueryType::try_from(99i16).is_err());
    }

    #[test]
    fn test_query_type_from_meta() {
        assert!(matches!(
            QueryType::from(MetaQueryType::Custom),
            QueryType::Custom
        ));
        assert!(matches!(
            QueryType::from(MetaQueryType::SQL),
            QueryType::Sql
        ));
        assert!(matches!(
            QueryType::from(MetaQueryType::PromQL),
            QueryType::Promql
        ));
    }

    #[test]
    fn test_query_type_to_meta() {
        assert!(matches!(
            MetaQueryType::from(QueryType::Custom),
            MetaQueryType::Custom
        ));
        assert!(matches!(
            MetaQueryType::from(QueryType::Sql),
            MetaQueryType::SQL
        ));
        assert!(matches!(
            MetaQueryType::from(QueryType::Promql),
            MetaQueryType::PromQL
        ));
    }

    // ── QueryCompareHistoricData ──────────────────────────────────────────────

    #[test]
    fn test_query_compare_historic_data_from_meta() {
        let meta = MetaCompareHistoricData {
            offset: "1h".to_string(),
        };
        let db = QueryCompareHistoricData::from(meta);
        assert_eq!(db.offset, "1h");
    }

    #[test]
    fn test_query_compare_historic_data_to_meta() {
        let db = QueryCompareHistoricData {
            offset: "30m".to_string(),
        };
        let meta = MetaCompareHistoricData::from(db);
        assert_eq!(meta.offset, "30m");
    }

    // ── ConditionOperator ────────────────────────────────────────────────────

    #[test]
    fn test_condition_operator_from_meta_all_variants() {
        assert!(matches!(
            ConditionOperator::from(MetaOperator::EqualTo),
            ConditionOperator::EqualTo
        ));
        assert!(matches!(
            ConditionOperator::from(MetaOperator::NotEqualTo),
            ConditionOperator::NotEqualTo
        ));
        assert!(matches!(
            ConditionOperator::from(MetaOperator::GreaterThan),
            ConditionOperator::GreaterThan
        ));
        assert!(matches!(
            ConditionOperator::from(MetaOperator::GreaterThanEquals),
            ConditionOperator::GreaterThanEquals
        ));
        assert!(matches!(
            ConditionOperator::from(MetaOperator::LessThan),
            ConditionOperator::LessThan
        ));
        assert!(matches!(
            ConditionOperator::from(MetaOperator::LessThanEquals),
            ConditionOperator::LessThanEquals
        ));
        assert!(matches!(
            ConditionOperator::from(MetaOperator::Contains),
            ConditionOperator::Contains
        ));
        assert!(matches!(
            ConditionOperator::from(MetaOperator::NotContains),
            ConditionOperator::NotContains
        ));
    }

    #[test]
    fn test_condition_operator_to_meta_all_variants() {
        assert!(matches!(
            MetaOperator::from(ConditionOperator::EqualTo),
            MetaOperator::EqualTo
        ));
        assert!(matches!(
            MetaOperator::from(ConditionOperator::NotEqualTo),
            MetaOperator::NotEqualTo
        ));
        assert!(matches!(
            MetaOperator::from(ConditionOperator::GreaterThan),
            MetaOperator::GreaterThan
        ));
        assert!(matches!(
            MetaOperator::from(ConditionOperator::GreaterThanEquals),
            MetaOperator::GreaterThanEquals
        ));
        assert!(matches!(
            MetaOperator::from(ConditionOperator::LessThan),
            MetaOperator::LessThan
        ));
        assert!(matches!(
            MetaOperator::from(ConditionOperator::LessThanEquals),
            MetaOperator::LessThanEquals
        ));
        assert!(matches!(
            MetaOperator::from(ConditionOperator::Contains),
            MetaOperator::Contains
        ));
        assert!(matches!(
            MetaOperator::from(ConditionOperator::NotContains),
            MetaOperator::NotContains
        ));
    }

    // ── QuerySearchEventType ──────────────────────────────────────────────────

    #[test]
    fn test_query_search_event_type_to_i16() {
        assert_eq!(i16::from(QuerySearchEventType::Ui), 0i16);
        assert_eq!(i16::from(QuerySearchEventType::Dashboards), 1i16);
        assert_eq!(i16::from(QuerySearchEventType::Reports), 2i16);
        assert_eq!(i16::from(QuerySearchEventType::Alerts), 3i16);
        assert_eq!(i16::from(QuerySearchEventType::Values), 4i16);
        assert_eq!(i16::from(QuerySearchEventType::Other), 5i16);
        assert_eq!(i16::from(QuerySearchEventType::Rum), 6i16);
        assert_eq!(i16::from(QuerySearchEventType::DerivedStream), 7i16);
        assert_eq!(i16::from(QuerySearchEventType::SearchJob), 8i16);
        assert_eq!(i16::from(QuerySearchEventType::Download), 9i16);
        assert_eq!(i16::from(QuerySearchEventType::Insights), 10i16);
    }

    #[test]
    fn test_query_search_event_type_try_from_i16() {
        assert!(matches!(
            QuerySearchEventType::try_from(0i16),
            Ok(QuerySearchEventType::Ui)
        ));
        assert!(matches!(
            QuerySearchEventType::try_from(1i16),
            Ok(QuerySearchEventType::Dashboards)
        ));
        assert!(matches!(
            QuerySearchEventType::try_from(2i16),
            Ok(QuerySearchEventType::Reports)
        ));
        assert!(matches!(
            QuerySearchEventType::try_from(3i16),
            Ok(QuerySearchEventType::Alerts)
        ));
        assert!(matches!(
            QuerySearchEventType::try_from(4i16),
            Ok(QuerySearchEventType::Values)
        ));
        assert!(matches!(
            QuerySearchEventType::try_from(5i16),
            Ok(QuerySearchEventType::Other)
        ));
        assert!(matches!(
            QuerySearchEventType::try_from(6i16),
            Ok(QuerySearchEventType::Rum)
        ));
        assert!(matches!(
            QuerySearchEventType::try_from(7i16),
            Ok(QuerySearchEventType::DerivedStream)
        ));
        assert!(matches!(
            QuerySearchEventType::try_from(8i16),
            Ok(QuerySearchEventType::SearchJob)
        ));
        assert!(matches!(
            QuerySearchEventType::try_from(9i16),
            Ok(QuerySearchEventType::Download)
        ));
        assert!(matches!(
            QuerySearchEventType::try_from(10i16),
            Ok(QuerySearchEventType::Insights)
        ));
        assert!(QuerySearchEventType::try_from(99i16).is_err());
    }

    #[test]
    fn test_query_search_event_type_from_meta() {
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::UI),
            QuerySearchEventType::Ui
        ));
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::Dashboards),
            QuerySearchEventType::Dashboards
        ));
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::Reports),
            QuerySearchEventType::Reports
        ));
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::Alerts),
            QuerySearchEventType::Alerts
        ));
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::Values),
            QuerySearchEventType::Values
        ));
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::Other),
            QuerySearchEventType::Other
        ));
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::RUM),
            QuerySearchEventType::Rum
        ));
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::DerivedStream),
            QuerySearchEventType::DerivedStream
        ));
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::SearchJob),
            QuerySearchEventType::SearchJob
        ));
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::Download),
            QuerySearchEventType::Download
        ));
        assert!(matches!(
            QuerySearchEventType::from(MetaSearchEventType::Insights),
            QuerySearchEventType::Insights
        ));
    }

    #[test]
    fn test_query_search_event_type_to_meta() {
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::Ui),
            MetaSearchEventType::UI
        ));
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::Dashboards),
            MetaSearchEventType::Dashboards
        ));
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::Reports),
            MetaSearchEventType::Reports
        ));
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::Alerts),
            MetaSearchEventType::Alerts
        ));
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::Values),
            MetaSearchEventType::Values
        ));
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::Other),
            MetaSearchEventType::Other
        ));
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::Rum),
            MetaSearchEventType::RUM
        ));
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::DerivedStream),
            MetaSearchEventType::DerivedStream
        ));
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::SearchJob),
            MetaSearchEventType::SearchJob
        ));
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::Download),
            MetaSearchEventType::Download
        ));
        assert!(matches!(
            MetaSearchEventType::from(QuerySearchEventType::Insights),
            MetaSearchEventType::Insights
        ));
    }

    // ── StreamType ───────────────────────────────────────────────────────────

    #[test]
    fn test_stream_type_display() {
        assert_eq!(StreamType::Logs.to_string(), "logs");
        assert_eq!(StreamType::Metrics.to_string(), "metrics");
        assert_eq!(StreamType::Traces.to_string(), "traces");
        assert_eq!(
            StreamType::EnrichmentTables.to_string(),
            "enrichment_tables"
        );
        assert_eq!(StreamType::FileList.to_string(), "file_list");
        assert_eq!(StreamType::Metadata.to_string(), "metadata");
        assert_eq!(StreamType::Index.to_string(), "index");
    }

    #[test]
    fn test_stream_type_from_str() {
        assert!(matches!(StreamType::from_str("logs"), Ok(StreamType::Logs)));
        assert!(matches!(
            StreamType::from_str("metrics"),
            Ok(StreamType::Metrics)
        ));
        assert!(matches!(
            StreamType::from_str("traces"),
            Ok(StreamType::Traces)
        ));
        assert!(matches!(
            StreamType::from_str("enrichment_tables"),
            Ok(StreamType::EnrichmentTables)
        ));
        assert!(matches!(
            StreamType::from_str("file_list"),
            Ok(StreamType::FileList)
        ));
        assert!(matches!(
            StreamType::from_str("metadata"),
            Ok(StreamType::Metadata)
        ));
        assert!(matches!(
            StreamType::from_str("index"),
            Ok(StreamType::Index)
        ));
        assert!(StreamType::from_str("unknown").is_err());
    }

    #[test]
    fn test_stream_type_from_meta() {
        assert!(matches!(
            StreamType::from(MetaStreamType::Logs),
            StreamType::Logs
        ));
        assert!(matches!(
            StreamType::from(MetaStreamType::Metrics),
            StreamType::Metrics
        ));
        assert!(matches!(
            StreamType::from(MetaStreamType::Traces),
            StreamType::Traces
        ));
        assert!(matches!(
            StreamType::from(MetaStreamType::EnrichmentTables),
            StreamType::EnrichmentTables
        ));
        assert!(matches!(
            StreamType::from(MetaStreamType::Filelist),
            StreamType::FileList
        ));
        assert!(matches!(
            StreamType::from(MetaStreamType::Metadata),
            StreamType::Metadata
        ));
        assert!(matches!(
            StreamType::from(MetaStreamType::Index),
            StreamType::Index
        ));
    }

    #[test]
    fn test_stream_type_to_meta() {
        assert!(matches!(
            MetaStreamType::from(StreamType::Logs),
            MetaStreamType::Logs
        ));
        assert!(matches!(
            MetaStreamType::from(StreamType::Metrics),
            MetaStreamType::Metrics
        ));
        assert!(matches!(
            MetaStreamType::from(StreamType::Traces),
            MetaStreamType::Traces
        ));
        assert!(matches!(
            MetaStreamType::from(StreamType::EnrichmentTables),
            MetaStreamType::EnrichmentTables
        ));
        assert!(matches!(
            MetaStreamType::from(StreamType::FileList),
            MetaStreamType::Filelist
        ));
        assert!(matches!(
            MetaStreamType::from(StreamType::Metadata),
            MetaStreamType::Metadata
        ));
        assert!(matches!(
            MetaStreamType::from(StreamType::Index),
            MetaStreamType::Index
        ));
    }

    // ── RowTemplateTypeDb ────────────────────────────────────────────────────

    #[test]
    fn test_row_template_type_to_i16() {
        assert_eq!(i16::from(RowTemplateTypeDb::String), 0i16);
        assert_eq!(i16::from(RowTemplateTypeDb::Json), 1i16);
    }

    #[test]
    fn test_row_template_type_try_from_i16() {
        assert!(matches!(
            RowTemplateTypeDb::try_from(0i16),
            Ok(RowTemplateTypeDb::String)
        ));
        assert!(matches!(
            RowTemplateTypeDb::try_from(1i16),
            Ok(RowTemplateTypeDb::Json)
        ));
        assert!(RowTemplateTypeDb::try_from(99i16).is_err());
    }

    #[test]
    fn test_row_template_type_from_meta() {
        use config::meta::alerts::alert::RowTemplateType;
        assert!(matches!(
            RowTemplateTypeDb::from(RowTemplateType::String),
            RowTemplateTypeDb::String
        ));
        assert!(matches!(
            RowTemplateTypeDb::from(RowTemplateType::Json),
            RowTemplateTypeDb::Json
        ));
    }

    #[test]
    fn test_meta_from_row_template_type_db() {
        use config::meta::alerts::alert::RowTemplateType;
        assert!(matches!(
            RowTemplateType::from(RowTemplateTypeDb::String),
            RowTemplateType::String
        ));
        assert!(matches!(
            RowTemplateType::from(RowTemplateTypeDb::Json),
            RowTemplateType::Json
        ));
    }

    // ── TriggerThresholdOperator → MetaOperator ──────────────────────────────

    #[test]
    fn test_trigger_threshold_operator_to_meta() {
        assert!(matches!(
            MetaOperator::from(TriggerThresholdOperator::EqualTo),
            MetaOperator::EqualTo
        ));
        assert!(matches!(
            MetaOperator::from(TriggerThresholdOperator::NotEqualTo),
            MetaOperator::NotEqualTo
        ));
        assert!(matches!(
            MetaOperator::from(TriggerThresholdOperator::GreaterThan),
            MetaOperator::GreaterThan
        ));
        assert!(matches!(
            MetaOperator::from(TriggerThresholdOperator::GreaterThanEquals),
            MetaOperator::GreaterThanEquals
        ));
        assert!(matches!(
            MetaOperator::from(TriggerThresholdOperator::LessThan),
            MetaOperator::LessThan
        ));
        assert!(matches!(
            MetaOperator::from(TriggerThresholdOperator::LessThanEquals),
            MetaOperator::LessThanEquals
        ));
    }

    // ── QueryCondition / MetaCondition ───────────────────────────────────────

    #[test]
    fn test_query_condition_from_meta() {
        let meta = MetaCondition {
            column: "level".to_string(),
            operator: MetaOperator::EqualTo,
            value: serde_json::json!("error"),
            ignore_case: false,
        };
        let qc = QueryCondition::from(meta);
        assert_eq!(qc.column, "level");
        assert!(matches!(qc.operator, ConditionOperator::EqualTo));
        assert!(!qc.ignore_case);
    }

    #[test]
    fn test_meta_condition_from_query_condition() {
        let qc = QueryCondition {
            column: "status".to_string(),
            operator: ConditionOperator::GreaterThan,
            value: serde_json::json!(500),
            ignore_case: true,
        };
        let meta = MetaCondition::from(qc);
        assert_eq!(meta.column, "status");
        assert!(matches!(meta.operator, MetaOperator::GreaterThan));
        assert!(meta.ignore_case);
    }

    // ── QueryAggregation / MetaAggregation ───────────────────────────────────

    #[test]
    fn test_query_aggregation_from_meta() {
        let meta = MetaAggregation {
            group_by: Some(vec!["service".to_string()]),
            function: MetaAggFunction::Count,
            having: MetaCondition {
                column: "count".to_string(),
                operator: MetaOperator::GreaterThanEquals,
                value: serde_json::json!(10),
                ignore_case: false,
            },
        };
        let qa = QueryAggregation::from(meta);
        assert_eq!(qa.group_by, Some(vec!["service".to_string()]));
        assert!(matches!(qa.function, AggFunction::Count));
        assert_eq!(qa.having.column, "count");
        assert!(matches!(
            qa.having.operator,
            ConditionOperator::GreaterThanEquals
        ));
    }

    #[test]
    fn test_meta_aggregation_from_query_aggregation() {
        let qa = QueryAggregation {
            group_by: None,
            function: AggFunction::Avg,
            having: QueryCondition {
                column: "value".to_string(),
                operator: ConditionOperator::LessThan,
                value: serde_json::json!(100),
                ignore_case: false,
            },
        };
        let meta = MetaAggregation::from(qa);
        assert!(meta.group_by.is_none());
        assert!(matches!(meta.function, MetaAggFunction::Avg));
        assert_eq!(meta.having.column, "value");
        assert!(matches!(meta.having.operator, MetaOperator::LessThan));
    }
}
