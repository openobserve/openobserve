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

use std::hash::{Hash, Hasher};

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{OrdF64, datetime_now};
use crate::meta::stream::StreamType;

fn default_version() -> i32 {
    8
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    #[serde(default = "default_version")]
    version: i32,
    #[serde(default)]
    pub dashboard_id: String,
    #[schema(required)]
    pub title: String,
    #[schema(required)]
    pub description: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub owner: String,
    #[serde(default = "datetime_now")]
    #[schema(value_type = String, format = DateTime)]
    pub created: DateTime<FixedOffset>,
    #[serde(default)]
    pub tabs: Vec<Tab>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variables: Option<Variables>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_datetime_duration: Option<DateTimeOptions>,
    #[serde(default, skip_serializing)]
    pub updated_at: i64,
}

impl From<Dashboard> for super::Dashboard {
    fn from(value: Dashboard) -> Self {
        let version: i32 = 8;

        let mut hasher = std::hash::DefaultHasher::new();
        hasher.write_i32(version);
        value.hash(&mut hasher);
        let hash = hasher.finish().to_string();
        let updated_at = value.updated_at;

        Self {
            v1: None,
            v2: None,
            v3: None,
            v4: None,
            v5: None,
            v6: None,
            v7: None,
            v8: Some(value),
            version,
            hash,
            updated_at,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
    pub i: i64,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub tab_id: String,
    pub name: String,
    #[serde(default)]
    pub panels: Vec<Panel>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum QueryType {
    #[default]
    #[serde(alias = "")]
    Sql,
    Promql,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub enum PanelType {
    #[serde(rename = "area")]
    Area,
    #[serde(rename = "area-stacked")]
    AreaStacked,
    #[serde(rename = "bar")]
    Bar,
    #[serde(rename = "h-bar")]
    HBar,
    #[serde(rename = "stacked")]
    Stacked,
    #[serde(rename = "h-stacked")]
    HStacked,
    #[serde(rename = "line")]
    Line,
    #[serde(rename = "scatter")]
    Scatter,
    #[serde(rename = "pie")]
    Pie,
    #[serde(rename = "donut")]
    Donut,
    #[serde(rename = "metric")]
    Metric,
    #[serde(rename = "gauge")]
    Gauge,
    #[serde(rename = "table")]
    Table,
    #[serde(rename = "heatmap")]
    Heatmap,
    #[serde(rename = "geomap")]
    Geomap,
    #[serde(rename = "sankey")]
    Sankey,
    #[serde(rename = "maps")]
    Maps,
    #[serde(rename = "html")]
    Html,
    #[serde(rename = "markdown")]
    Markdown,
    #[serde(rename = "custom_chart")]
    CustomChart,
    /// Catch-all for unknown/future panel types — prevents deserialization failure on upgrade
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    pub id: String,
    #[serde(rename = "type")]
    pub typ: PanelType,
    pub title: String,
    pub description: String,
    pub config: PanelConfig,
    #[serde(default)]
    pub query_type: QueryType,
    pub queries: Vec<Query>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<Layout>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub markdown_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_chart_content: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub query: Option<String>,
    pub vrl_function_query: Option<String>,
    pub custom_query: bool,
    pub fields: PanelFields,
    pub config: QueryConfig,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub joins: Option<Vec<Join>>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct PromQLLabelFilter {
    pub label: String,
    pub op: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct PromQLOperation {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Vec<PromQLOperationParam>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, Hash)]
#[serde(untagged)]
pub enum PromQLOperationParam {
    Array(Vec<String>),
    String(String),
    #[schema(value_type = f64)]
    Number(OrdF64),
    Bool(bool),
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct PanelFields {
    pub stream: String,
    pub stream_type: StreamType,
    pub x: Vec<AxisItem>,
    pub y: Vec<AxisItem>,
    #[serde(default)]
    pub z: Vec<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub breakdown: Option<Vec<AxisItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latitude: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub longitude: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_for_maps: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<AxisItem>,
    #[schema(value_type = Object)]
    pub filter: PanelFilter,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub promql_labels: Vec<PromQLLabelFilter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub promql_operations: Vec<PromQLOperation>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AxisType {
    Build,
    Raw,
    Custom,
}

impl<'de> Deserialize<'de> for AxisType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(match s.as_str() {
            "build" => Self::Build,
            "raw" => Self::Raw,
            _ => Self::Custom,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxisItem {
    pub label: String,
    pub alias: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "type")]
    pub typ: Option<AxisType>,
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub function_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args: Option<Vec<AxisArg>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_derived: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub having_conditions: Option<Vec<HavingConditions>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub treat_as_non_timestamp: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_field_as_json: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_query: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct HavingConditions {
    #[schema(value_type = Option<f64>)]
    value: Option<OrdF64>,
    operator: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct AxisArg {
    #[serde(rename = "type")]
    pub typ: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<AxisArgValueWrapper>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ToSchema, Hash)]
#[serde(untagged)]
pub enum AxisArgValueWrapper {
    Object(AxisArgValue),
    String(String),
    #[schema(value_type = f64)]
    Number(OrdF64),
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxisArgValue {
    pub field: Option<String>,
    pub stream_alias: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum JoinType {
    #[default]
    Inner,
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Join {
    pub stream: String,
    pub stream_alias: String,
    pub join_type: JoinType,
    pub conditions: Vec<JoinCondition>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct JoinCondition {
    pub left_field: SelectedField,
    pub right_field: SelectedField,
    pub operation: String,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SelectedField {
    pub stream_alias: Option<String>,
    pub field: String,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogicalOperator {
    #[default]
    And,
    Or,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, ToSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum FilterType {
    #[default]
    Condition,
    Group,
}

impl<'de> Deserialize<'de> for FilterType {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(match s.as_str() {
            "condition" => Self::Condition,
            "group" => Self::Group,
            _ => Self::default(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(untagged, rename_all = "camelCase")]
pub enum PanelFilter {
    #[serde(rename = "condition")]
    Condition(FilterCondition),
    #[serde(rename = "group")]
    Group(GroupType),
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct GroupType {
    pub filter_type: FilterType,
    pub logical_operator: LogicalOperator,
    #[schema(value_type = Vec<Object>)]
    pub conditions: Vec<PanelFilter>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundType {
    /// Empty string — stored dashboards may have `""` as a legacy value
    #[default]
    #[serde(rename = "")]
    Empty,
    Single,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Background {
    #[serde(rename = "type")]
    pub typ: Option<BackgroundType>,
    pub value: Option<BackgroundValue>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct BackgroundValue {
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StreamFieldObj {
    pub field: Option<String>,
    pub stream_alias: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum FilterConditionType {
    #[default]
    List,
    Condition,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    /// Required — group filters never carry `"type"`, so leaving this without
    /// `#[serde(default)]` lets the `#[serde(untagged)]` `PanelFilter` enum
    /// correctly skip the `Condition` variant and fall through to `Group`.
    #[serde(rename = "type")]
    pub typ: FilterConditionType,
    #[serde(default)]
    pub values: Vec<String>,
    #[serde(default)]
    pub column: Option<StreamFieldObj>,
    #[serde(default)]
    pub operator: Option<String>,
    #[serde(default)]
    pub value: Option<String>,
    #[serde(default)]
    pub logical_operator: LogicalOperator,
    #[serde(default)]
    pub filter_type: FilterType,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ChartAlign {
    Left,
    Center,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AggregationType {
    Last,
    Min,
    Max,
    Avg,
    Sum,
    Count,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PromqlTableMode {
    Single,
    ExpandedTimeseries,
    All,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize)]
#[serde(from = "String", into = "String")]
pub enum Unit {
    Numbers,
    Bytes,
    Kilobytes,
    Megabytes,
    Bps,
    Seconds,
    Milliseconds,
    Microseconds,
    Nanoseconds,
    PercentNormalized,
    Percent,
    CurrencyDollar,
    CurrencyEuro,
    CurrencyPound,
    CurrencyYen,
    CurrencyRupee,
    Custom(String),
}

impl Default for Unit {
    fn default() -> Self {
        Self::Custom(String::new())
    }
}

impl From<String> for Unit {
    fn from(s: String) -> Self {
        match s.as_str() {
            "numbers" => Self::Numbers,
            "bytes" => Self::Bytes,
            "kilobytes" => Self::Kilobytes,
            "megabytes" => Self::Megabytes,
            "bps" => Self::Bps,
            "seconds" => Self::Seconds,
            "milliseconds" => Self::Milliseconds,
            "microseconds" => Self::Microseconds,
            "nanoseconds" => Self::Nanoseconds,
            "percent-1" => Self::PercentNormalized,
            "percent" => Self::Percent,
            "currency-dollar" => Self::CurrencyDollar,
            "currency-euro" => Self::CurrencyEuro,
            "currency-pound" => Self::CurrencyPound,
            "currency-yen" => Self::CurrencyYen,
            "currency-rupee" => Self::CurrencyRupee,
            _ => Self::Custom(s),
        }
    }
}

impl From<Unit> for String {
    fn from(value: Unit) -> Self {
        match value {
            Unit::Numbers => "numbers".to_string(),
            Unit::Bytes => "bytes".to_string(),
            Unit::Kilobytes => "kilobytes".to_string(),
            Unit::Megabytes => "megabytes".to_string(),
            Unit::Bps => "bps".to_string(),
            Unit::Seconds => "seconds".to_string(),
            Unit::Milliseconds => "milliseconds".to_string(),
            Unit::Microseconds => "microseconds".to_string(),
            Unit::Nanoseconds => "nanoseconds".to_string(),
            Unit::PercentNormalized => "percent-1".to_string(),
            Unit::Percent => "percent".to_string(),
            Unit::CurrencyDollar => "currency-dollar".to_string(),
            Unit::CurrencyEuro => "currency-euro".to_string(),
            Unit::CurrencyPound => "currency-pound".to_string(),
            Unit::CurrencyYen => "currency-yen".to_string(),
            Unit::CurrencyRupee => "currency-rupee".to_string(),
            Unit::Custom(s) => s,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum LegendsPosition {
    Bottom,
    Right,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum LegendsType {
    Plain,
    Scroll,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct PanelConfig {
    #[serde(default = "default_show_legends")]
    show_legends: bool,
    legends_position: Option<LegendsPosition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legends_type: Option<LegendsType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chart_align: Option<ChartAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    unit: Option<Unit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unit_custom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    decimals: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    line_thickness: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    step_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    top_results: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    y_axis_min: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    y_axis_max: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    top_results_others: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    axis_width: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    axis_border_show: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    label_option: Option<LabelOption>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    axis_label_rotate: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    axis_label_truncate_width: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    show_symbol: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line_interpolation: Option<LineInterpolation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legend_width: Option<LegendWidth>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legend_height: Option<LegendHeight>,
    base_map: Option<BaseMap>,
    #[serde(skip_serializing_if = "Option::is_none")]
    map_type: Option<MapType>,
    map_view: Option<MapView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    map_symbol_style: Option<MapSymbolStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    drilldown: Option<Vec<DrillDown>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mark_line: Option<Vec<MarkLine>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    override_config: Option<Vec<OverrideConfig>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    connect_nulls: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    no_value_replacement: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    wrap_table_cells: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_transpose: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_dynamic_columns: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mappings: Option<Vec<Mapping>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<ColorCfg>,
    #[serde(skip_serializing_if = "Option::is_none")]
    background: Option<Background>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trellis: Option<Trellis>,
    #[serde(skip_serializing_if = "Option::is_none")]
    show_gridlines: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    aggregation: Option<AggregationType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lat_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lon_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    weight_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_aggregations: Option<Vec<AggregationType>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    promql_table_mode: Option<PromqlTableMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    visible_columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hidden_columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sticky_columns: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sticky_first_column: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    column_order: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_pagination: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_pagination_rows_per_page: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_pivot_show_row_totals: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_pivot_show_col_totals: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_pivot_sticky_row_totals: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_pivot_sticky_col_totals: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    panel_time_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    panel_time_range: Option<PanelTimeRange>,
}

fn default_show_legends() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize)]
#[serde(from = "String", into = "String")]
pub enum ColorMode {
    PaletteClassicBySeries,
    PaletteClassic,
    Fixed,
    Shades,
    ContinuousGreenYellowRed,
    ContinuousRedYellowGreen,
    ContinuousTemperature,
    ContinuousPositive,
    ContinuousNegative,
    ContinuousLightToDarkBlue,
    Custom(String),
}

impl From<String> for ColorMode {
    fn from(s: String) -> Self {
        match s.as_str() {
            "palette-classic-by-series" => Self::PaletteClassicBySeries,
            "palette-classic" => Self::PaletteClassic,
            "fixed" => Self::Fixed,
            "shades" => Self::Shades,
            "continuous-green-yellow-red" => Self::ContinuousGreenYellowRed,
            "continuous-red-yellow-green" => Self::ContinuousRedYellowGreen,
            "continuous-temperature" => Self::ContinuousTemperature,
            "continuous-positive" => Self::ContinuousPositive,
            "continuous-negative" => Self::ContinuousNegative,
            "continuous-light-to-dark-blue" => Self::ContinuousLightToDarkBlue,
            _ => Self::Custom(s),
        }
    }
}

impl From<ColorMode> for String {
    fn from(value: ColorMode) -> Self {
        match value {
            ColorMode::PaletteClassicBySeries => "palette-classic-by-series".to_string(),
            ColorMode::PaletteClassic => "palette-classic".to_string(),
            ColorMode::Fixed => "fixed".to_string(),
            ColorMode::Shades => "shades".to_string(),
            ColorMode::ContinuousGreenYellowRed => "continuous-green-yellow-red".to_string(),
            ColorMode::ContinuousRedYellowGreen => "continuous-red-yellow-green".to_string(),
            ColorMode::ContinuousTemperature => "continuous-temperature".to_string(),
            ColorMode::ContinuousPositive => "continuous-positive".to_string(),
            ColorMode::ContinuousNegative => "continuous-negative".to_string(),
            ColorMode::ContinuousLightToDarkBlue => "continuous-light-to-dark-blue".to_string(),
            ColorMode::Custom(s) => s,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ColorCfg {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    mode: Option<ColorMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fixed_color: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    series_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color_by_series: Option<Vec<ColorBySeries>>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ColorBySeries {
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    typee: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum MappingType {
    Value,
    Range,
    Regex,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Mapping {
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    typee: Option<MappingType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pattern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "match")]
    matchh: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub enum DrilldownType {
    #[serde(rename = "byUrl")]
    ByUrl,
    #[serde(rename = "logs")]
    Logs,
    #[serde(rename = "byDashboard")]
    ByDashboard,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct DrillDown {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    type_field: Option<DrilldownType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_blank: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    find_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<DrillDownData>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub enum MarkLineType {
    #[serde(rename = "average")]
    Average,
    #[serde(rename = "median")]
    Median,
    #[serde(rename = "min")]
    Min,
    #[serde(rename = "max")]
    Max,
    #[serde(rename = "xAxis")]
    XAxis,
    #[serde(rename = "yAxis")]
    YAxis,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct MarkLine {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    typee: Option<MarkLineType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct OverrideConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    field: Option<Field>,
    #[serde(skip_serializing_if = "Option::is_none")]
    config: Option<Vec<Config>>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Field {
    match_by: String,
    value: String,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "camelCase", from = "ConfigRaw")]
pub enum Config {
    #[serde(rename = "unit")]
    Unit {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<Value>,
    },
    #[serde(rename = "unique_value_color")]
    #[serde(rename_all = "camelCase")]
    UniqueValueColor {
        #[serde(default)]
        auto_color: bool,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ConfigRaw {
    #[serde(rename = "unit")]
    Unit {
        #[serde(default)]
        value: Option<Value>,
    },
    #[serde(rename = "unique_value_color")]
    #[serde(rename_all = "camelCase")]
    UniqueValueColor {
        #[serde(default)]
        auto_color: bool,
    },
    #[serde(other)]
    Unknown,
}

impl From<ConfigRaw> for Config {
    fn from(raw: ConfigRaw) -> Self {
        match raw {
            ConfigRaw::Unit { value } => Self::Unit { value },
            ConfigRaw::UniqueValueColor { auto_color } => Self::UniqueValueColor { auto_color },
            ConfigRaw::Unknown => Self::UniqueValueColor { auto_color: false },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Value {
    #[schema(value_type = String)]
    unit: Unit,
    custom_unit: String,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum LogsMode {
    Auto,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct DrillDownData {
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dashboard: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tab: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pass_all_variables: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    variables: Option<Vec<DrillDownVariables>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    logs_mode: Option<LogsMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    logs_query: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct DrillDownVariables {
    name: Option<String>,
    value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize)]
#[serde(from = "String", into = "String")]
pub enum LayerType {
    Scatter,
    Heatmap,
    Custom(String),
}

impl From<String> for LayerType {
    fn from(s: String) -> Self {
        match s.as_str() {
            "scatter" => Self::Scatter,
            "heatmap" => Self::Heatmap,
            _ => Self::Custom(s),
        }
    }
}

impl From<LayerType> for String {
    fn from(value: LayerType) -> Self {
        match value {
            LayerType::Scatter => "scatter".to_string(),
            LayerType::Heatmap => "heatmap".to_string(),
            LayerType::Custom(s) => s,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct QueryConfig {
    promql_legend: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    step_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<String>)]
    layer_type: Option<LayerType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    weight_fixed: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    limit: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    min: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    max: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    time_shift: Option<Vec<TimeShift>>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct TimeShift {
    #[serde(skip_serializing_if = "Option::is_none")]
    off_set: Option<String>,
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Variables {
    pub list: Vec<VariableList>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_dynamic_filters: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum DateTimeType {
    #[default]
    Relative,
    Absolute,
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct DateTimeOptions {
    #[serde(rename = "type")]
    pub typee: DateTimeType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_time_period: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<i64>,
}

pub type PanelTimeRange = DateTimeOptions;

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum VariableScope {
    Global,
    Tabs,
    Panels,
}

/// Wire format uses snake_case: "query_values", "constant", "textbox", "custom", "dynamic_filters"
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
pub enum VariableType {
    #[default]
    #[serde(rename = "query_values")]
    QueryValues,
    #[serde(rename = "constant")]
    Constant,
    #[serde(rename = "textbox")]
    Textbox,
    #[serde(rename = "custom")]
    Custom,
    #[serde(rename = "dynamic_filters")]
    DynamicFilters,
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct VariableList {
    #[serde(rename = "type")]
    pub type_field: VariableType,
    pub name: String,
    pub label: String,
    #[serde(rename = "query_data")]
    pub query_data: Option<QueryData>,
    pub value: Option<String>,
    pub options: Option<Vec<CustomFieldsOption>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub multi_select: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hide_on_dashboard: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub select_all_value_for_multi_select: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_multi_select_value: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub escape_single_quotes: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<VariableScope>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tabs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panels: Option<Vec<String>>,
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(default)]
pub struct QueryData {
    pub stream_type: StreamType,
    pub stream: String,
    pub field: String,
    pub max_record_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<Vec<Filters>>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Filters {
    pub name: Option<String>,
    pub operator: Option<String>,
    pub value: String,
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct CustomFieldsOption {
    pub label: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selected: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum BaseMapType {
    Osm,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct BaseMap {
    #[serde(rename = "type")]
    pub type_field: Option<BaseMapType>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum MapTypeValue {
    World,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct MapType {
    #[serde(rename = "type")]
    pub type_field: Option<MapTypeValue>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct MapView {
    #[schema(value_type = f64)]
    pub zoom: OrdF64,
    #[schema(value_type = f64)]
    pub lat: OrdF64,
    #[schema(value_type = f64)]
    pub lng: OrdF64,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum TrellisLayout {
    Auto,
    Vertical,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct Trellis {
    pub layout: Option<TrellisLayout>,
    pub num_of_columns: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_by_y_axis: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
pub enum MapSymbolSize {
    #[default]
    /// Intentional space in wire format — matches frontend literal `"by Value"` (see
    /// convertGeoMapData.ts)
    #[serde(rename = "by Value")]
    ByValue,
    #[serde(rename = "fixed")]
    Fixed,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct MapSymbolStyle {
    pub size: MapSymbolSize,
    pub size_by_value: Option<SizeByValue>,
    #[schema(value_type = f64)]
    pub size_fixed: OrdF64,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct SizeByValue {
    #[schema(value_type = f64)]
    pub min: OrdF64,
    #[schema(value_type = f64)]
    pub max: OrdF64,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub enum LegendSizeUnit {
    #[serde(rename = "px")]
    Px,
    #[serde(rename = "%")]
    Percent,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct LegendWidth {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    pub value: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<LegendSizeUnit>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct LegendHeight {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    pub value: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<LegendSizeUnit>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct LabelOption {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<LabelPosition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    pub rotate: Option<OrdF64>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, ToSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LineInterpolation {
    #[default]
    Smooth,
    Linear,
    StepStart,
    StepEnd,
    StepMiddle,
}

impl<'de> Deserialize<'de> for LineInterpolation {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(match s.as_str() {
            "smooth" => Self::Smooth,
            "linear" => Self::Linear,
            "step-start" => Self::StepStart,
            "step-end" => Self::StepEnd,
            "step-middle" => Self::StepMiddle,
            _ => Self::default(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub enum LabelPosition {
    #[default]
    Top,
    Left,
    Right,
    Bottom,
    Inside,
    InsideLeft,
    InsideRight,
    InsideTop,
    InsideBottom,
    InsideTopLeft,
    InsideBottomLeft,
    InsideTopRight,
    InsideBottomRight,
    Outside,
}

impl<'de> Deserialize<'de> for LabelPosition {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(match s.as_str() {
            "top" => Self::Top,
            "left" => Self::Left,
            "right" => Self::Right,
            "bottom" => Self::Bottom,
            "inside" => Self::Inside,
            "insideLeft" => Self::InsideLeft,
            "insideRight" => Self::InsideRight,
            "insideTop" => Self::InsideTop,
            "insideBottom" => Self::InsideBottom,
            "insideTopLeft" => Self::InsideTopLeft,
            "insideBottomLeft" => Self::InsideBottomLeft,
            "insideTopRight" => Self::InsideTopRight,
            "insideBottomRight" => Self::InsideBottomRight,
            "outside" => Self::Outside,
            _ => Self::default(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_dashboard() -> Dashboard {
        serde_json::from_value(serde_json::json!({
            "version": 8,
            "title": "V8 Dashboard",
            "description": "A v8 test dashboard"
        }))
        .unwrap()
    }

    #[test]
    fn test_dashboard_fields() {
        let d = make_dashboard();
        assert_eq!(d.title, "V8 Dashboard");
        assert!(d.tabs.is_empty());
    }

    #[test]
    fn test_dashboard_into_meta_version_is_8() {
        let d = make_dashboard();
        let meta: super::super::Dashboard = d.into();
        assert_eq!(meta.version, 8);
        assert!(meta.v8.is_some());
        assert!(!meta.hash.is_empty());
    }

    #[test]
    fn test_dashboard_variables_skip_serializing_if_none() {
        let d = make_dashboard();
        assert!(d.variables.is_none());
        assert!(d.default_datetime_duration.is_none());
        let json = serde_json::to_value(&d).unwrap();
        assert!(!json.as_object().unwrap().contains_key("variables"));
        assert!(
            !json
                .as_object()
                .unwrap()
                .contains_key("defaultDatetimeDuration")
        );
    }

    #[test]
    fn test_layout_default_all_zeros() {
        let layout = Layout::default();
        assert_eq!(layout.x, 0);
        assert_eq!(layout.y, 0);
        assert_eq!(layout.w, 0);
        assert_eq!(layout.h, 0);
        assert_eq!(layout.i, 0);
    }

    #[test]
    fn test_layout_serde_roundtrip() {
        let json = serde_json::json!({"x": 1, "y": 2, "w": 10, "h": 5, "i": 3});
        let layout: Layout = serde_json::from_value(json).unwrap();
        assert_eq!(layout.x, 1);
        assert_eq!(layout.h, 5);
        let back = serde_json::to_value(&layout).unwrap();
        assert_eq!(back["w"], 10);
    }

    #[test]
    fn test_line_interpolation_default_is_smooth() {
        let v: LineInterpolation = Default::default();
        assert_eq!(v, LineInterpolation::Smooth);
        let s = serde_json::to_string(&v).unwrap();
        assert_eq!(s, "\"smooth\"");
    }

    #[test]
    fn test_line_interpolation_step_variants_serialize() {
        let s = serde_json::to_string(&LineInterpolation::StepStart).unwrap();
        assert_eq!(s, "\"step-start\"");
        let e = serde_json::to_string(&LineInterpolation::StepEnd).unwrap();
        assert_eq!(e, "\"step-end\"");
        let m = serde_json::to_string(&LineInterpolation::StepMiddle).unwrap();
        assert_eq!(m, "\"step-middle\"");
    }

    #[test]
    fn test_label_position_default_is_top() {
        let v: LabelPosition = Default::default();
        assert_eq!(v, LabelPosition::Top);
    }

    #[test]
    fn test_promql_operation_param_variants() {
        let arr: PromQLOperationParam =
            serde_json::from_value(serde_json::json!(["a", "b"])).unwrap();
        assert!(matches!(arr, PromQLOperationParam::Array(_)));

        let b: PromQLOperationParam = serde_json::from_value(serde_json::json!(true)).unwrap();
        assert!(matches!(b, PromQLOperationParam::Bool(true)));

        let s: PromQLOperationParam = serde_json::from_value(serde_json::json!("hello")).unwrap();
        assert!(matches!(s, PromQLOperationParam::String(_)));
    }

    #[test]
    fn test_promql_operation_no_params_skip_serializing() {
        let op = PromQLOperation {
            id: "op1".to_string(),
            params: None,
        };
        let json = serde_json::to_value(&op).unwrap();
        assert!(!json.as_object().unwrap().contains_key("params"));
    }

    #[test]
    fn test_axis_type_all_variants_serde() {
        let cases = [
            (AxisType::Build, "\"build\""),
            (AxisType::Raw, "\"raw\""),
            (AxisType::Custom, "\"custom\""),
        ];
        for (variant, expected) in cases {
            let s = serde_json::to_string(&variant).unwrap();
            assert_eq!(s, expected);
            let back: AxisType = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_axis_item_optional_fields_absent_when_none() {
        let item: AxisItem = serde_json::from_value(serde_json::json!({
            "label": "lbl",
            "alias": "a",
            "color": null
        }))
        .unwrap();
        let json = serde_json::to_string(&item).unwrap();
        assert!(!json.contains("column"));
        assert!(!json.contains("type"));
        assert!(!json.contains("functionName"));
        assert!(!json.contains("sortBy"));
        assert!(!json.contains("isDerived"));
        assert!(!json.contains("rawQuery"));
    }

    #[test]
    fn test_axis_item_with_type_and_function() {
        let item: AxisItem = serde_json::from_value(serde_json::json!({
            "label": "lbl",
            "alias": "a",
            "color": "#ff0",
            "type": "build",
            "functionName": "count",
            "isDerived": false
        }))
        .unwrap();
        assert_eq!(item.typ, Some(AxisType::Build));
        assert_eq!(item.function_name, Some("count".to_string()));
        assert_eq!(item.is_derived, Some(false));
    }

    #[test]
    fn test_axis_arg_value_wrapper_variants() {
        let s: AxisArgValueWrapper = serde_json::from_value(serde_json::json!("hello")).unwrap();
        assert!(matches!(s, AxisArgValueWrapper::String(_)));

        let n: AxisArgValueWrapper = serde_json::from_value(serde_json::json!(3.14)).unwrap();
        assert!(matches!(n, AxisArgValueWrapper::Number(_)));
    }

    #[test]
    fn test_label_position_all_variants_serde() {
        let cases = [
            LabelPosition::Top,
            LabelPosition::Bottom,
            LabelPosition::Left,
            LabelPosition::Right,
            LabelPosition::Inside,
            LabelPosition::Outside,
            LabelPosition::InsideLeft,
            LabelPosition::InsideRight,
            LabelPosition::InsideTop,
            LabelPosition::InsideBottom,
            LabelPosition::InsideTopLeft,
            LabelPosition::InsideBottomLeft,
            LabelPosition::InsideTopRight,
            LabelPosition::InsideBottomRight,
        ];
        for variant in cases {
            let s = serde_json::to_string(&variant).unwrap();
            let back: LabelPosition = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_variable_list_all_optional_fields_absent_when_none() {
        let vl = VariableList::default();
        let json = serde_json::to_string(&vl).unwrap();
        assert!(!json.contains("multiSelect"));
        assert!(!json.contains("hideOnDashboard"));
        assert!(!json.contains("selectAllValueForMultiSelect"));
        assert!(!json.contains("customMultiSelectValue"));
    }

    #[test]
    fn test_variable_list_optional_fields_present_when_some() {
        let vl = VariableList {
            multi_select: Some(true),
            hide_on_dashboard: Some(true),
            select_all_value_for_multi_select: Some("all".to_string()),
            custom_multi_select_value: Some(vec!["a".to_string()]),
            ..Default::default()
        };
        let json = serde_json::to_string(&vl).unwrap();
        assert!(json.contains("multiSelect"));
        assert!(json.contains("hideOnDashboard"));
        assert!(json.contains("selectAllValueForMultiSelect"));
        assert!(json.contains("customMultiSelectValue"));
    }

    #[test]
    fn test_datetime_options_none_fields_absent() {
        let opts = DateTimeOptions {
            typee: "relative".to_string(),
            ..Default::default()
        };
        let json = serde_json::to_string(&opts).unwrap();
        assert!(!json.contains("startTime"));
        assert!(!json.contains("endTime"));
    }

    #[test]
    fn test_color_cfg_default_all_none_absent() {
        let cfg = ColorCfg::default();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("mode"));
        assert!(!json.contains("fixedColor"));
        assert!(!json.contains("seriesBy"));
        assert!(!json.contains("colorBySeries"));
    }

    #[test]
    fn test_color_by_series_default_all_none_absent() {
        let cbs = ColorBySeries::default();
        let json = serde_json::to_string(&cbs).unwrap();
        assert!(!json.contains("type"));
        assert!(!json.contains("value"));
        assert!(!json.contains("color"));
    }

    #[test]
    fn test_mapping_default_all_none_absent() {
        let m = Mapping::default();
        let json = serde_json::to_string(&m).unwrap();
        assert!(!json.contains("type"));
        assert!(!json.contains("value"));
        assert!(!json.contains("from"));
        assert!(!json.contains("to"));
        assert!(!json.contains("pattern"));
        assert!(!json.contains("match"));
        assert!(!json.contains("color"));
        assert!(!json.contains("text"));
    }

    #[test]
    fn test_drill_down_default_all_none_absent() {
        let dd = DrillDown::default();
        let json = serde_json::to_string(&dd).unwrap();
        assert!(!json.contains("name"));
        assert!(!json.contains("type"));
        assert!(!json.contains("targetBlank"));
        assert!(!json.contains("findBy"));
        assert!(!json.contains("data"));
    }

    #[test]
    fn test_mark_line_default_all_none_absent() {
        let ml = MarkLine::default();
        let json = serde_json::to_string(&ml).unwrap();
        assert!(!json.contains("name"));
        assert!(!json.contains("type"));
        assert!(!json.contains("value"));
    }

    #[test]
    fn test_override_config_default_all_none_absent() {
        let oc = OverrideConfig::default();
        let json = serde_json::to_string(&oc).unwrap();
        assert!(!json.contains("field"));
        assert!(!json.contains("config"));
    }

    #[test]
    fn test_drill_down_data_default_all_none_absent() {
        let dd = DrillDownData::default();
        let json = serde_json::to_string(&dd).unwrap();
        assert!(!json.contains("url"));
        assert!(!json.contains("folder"));
        assert!(!json.contains("dashboard"));
        assert!(!json.contains("tab"));
        assert!(!json.contains("passAllVariables"));
        assert!(!json.contains("variables"));
        assert!(!json.contains("logsMode"));
        assert!(!json.contains("logsQuery"));
    }

    #[test]
    fn test_time_shift_default_offset_absent() {
        let ts = TimeShift::default();
        let json = serde_json::to_string(&ts).unwrap();
        assert!(!json.contains("offSet"));
    }

    #[test]
    fn test_variables_default_show_dynamic_filters_absent() {
        let v = Variables::default();
        let json = serde_json::to_string(&v).unwrap();
        assert!(!json.contains("showDynamicFilters"));
    }

    #[test]
    fn test_query_data_default_filter_absent() {
        let qd = QueryData::default();
        let json = serde_json::to_string(&qd).unwrap();
        assert!(!json.contains("filter"));
    }

    #[test]
    fn test_drill_down_all_some_present() {
        let dd = DrillDown {
            name: Some("nav".to_string()),
            type_field: Some("link".to_string()),
            target_blank: Some(true),
            find_by: Some("field".to_string()),
            data: Some(DrillDownData::default()),
        };
        let json = serde_json::to_string(&dd).unwrap();
        assert!(json.contains("name"));
        assert!(json.contains("type"));
        assert!(json.contains("targetBlank"));
        assert!(json.contains("findBy"));
        assert!(json.contains("data"));
    }

    #[test]
    fn test_mark_line_all_some_present() {
        let ml = MarkLine {
            name: Some("avg".to_string()),
            typee: Some("average".to_string()),
            value: Some("50".to_string()),
        };
        let json = serde_json::to_string(&ml).unwrap();
        assert!(json.contains("name"));
        assert!(json.contains("type"));
        assert!(json.contains("\"value\""));
    }

    #[test]
    fn test_drill_down_data_all_some_present() {
        let dd = DrillDownData {
            url: Some("https://x.com".to_string()),
            folder: Some("f".to_string()),
            dashboard: Some("d".to_string()),
            tab: Some("t".to_string()),
            pass_all_variables: Some(false),
            variables: Some(vec![]),
            logs_mode: Some("mode".to_string()),
            logs_query: Some("query".to_string()),
        };
        let json = serde_json::to_string(&dd).unwrap();
        assert!(json.contains("url"));
        assert!(json.contains("folder"));
        assert!(json.contains("dashboard"));
        assert!(json.contains("tab"));
        assert!(json.contains("passAllVariables"));
        assert!(json.contains("variables"));
        assert!(json.contains("logsMode"));
        assert!(json.contains("logsQuery"));
    }

    #[test]
    fn test_query_data_filter_some_present() {
        let qd = QueryData {
            filter: Some(vec![]),
            ..Default::default()
        };
        let json = serde_json::to_string(&qd).unwrap();
        assert!(json.contains("filter"));
    }

    #[test]
    fn test_query_config_all_none_absent() {
        let qc = QueryConfig {
            promql_legend: String::new(),
            step_value: None,
            layer_type: None,
            weight_fixed: None,
            limit: None,
            min: None,
            max: None,
            time_shift: None,
        };
        let json = serde_json::to_string(&qc).unwrap();
        assert!(!json.contains("step_value"));
        assert!(!json.contains("layer_type"));
        assert!(!json.contains("weight_fixed"));
        assert!(!json.contains("\"limit\""));
        assert!(!json.contains("\"min\""));
        assert!(!json.contains("\"max\""));
        assert!(!json.contains("timeShift"));
    }

    #[test]
    fn test_color_cfg_all_some_present() {
        let cfg = ColorCfg {
            mode: Some("fixed".to_string()),
            fixed_color: Some(vec!["red".to_string()]),
            series_by: Some("last".to_string()),
            color_by_series: Some(vec![]),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("mode"));
        assert!(json.contains("fixedColor"));
        assert!(json.contains("seriesBy"));
        assert!(json.contains("colorBySeries"));
    }

    #[test]
    fn test_mapping_all_some_present() {
        let m = Mapping {
            typee: Some("value".to_string()),
            value: Some("0".to_string()),
            from: Some("0".to_string()),
            to: Some("1".to_string()),
            pattern: Some(".*".to_string()),
            matchh: Some("exact".to_string()),
            color: Some("red".to_string()),
            text: Some("zero".to_string()),
        };
        let json = serde_json::to_string(&m).unwrap();
        assert!(json.contains("type"));
        assert!(json.contains("\"value\""));
        assert!(json.contains("from"));
        assert!(json.contains("to"));
        assert!(json.contains("pattern"));
        assert!(json.contains("match"));
        assert!(json.contains("color"));
        assert!(json.contains("text"));
    }
}
