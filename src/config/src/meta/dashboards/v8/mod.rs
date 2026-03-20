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

use std::hash::{Hash, Hasher};

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::{OrdF64, datetime_now};
use crate::meta::stream::StreamType;

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
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
    #[serde(rename = "html")]
    Html,
    #[serde(rename = "markdown")]
    Markdown,
    #[serde(rename = "custom_chart")]
    CustomChart,
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
    pub layout: Layout,
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
    pub filter: PanelFilter,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub promql_labels: Vec<PromQLLabelFilter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub promql_operations: Vec<PromQLOperation>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AxisType {
    Build,
    Raw,
    Custom,
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum JoinType {
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogicalOperator {
    And,
    Or,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum FilterType {
    Condition,
    Group,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(untagged, rename_all = "camelCase")]
pub enum PanelFilter {
    #[serde(rename = "condition")]
    Condition(FilterCondition),
    #[serde(rename = "group")]
    Group(GroupType),
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GroupType {
    pub filter_type: FilterType,
    pub logical_operator: LogicalOperator,
    #[schema(value_type = Vec<Object>)]
    pub conditions: Vec<PanelFilter>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundType {
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum FilterConditionType {
    List,
    Condition,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    #[serde(rename = "type")]
    pub typ: FilterConditionType,
    pub values: Vec<String>,
    pub column: Option<StreamFieldObj>,
    pub operator: Option<String>,
    pub value: Option<String>,
    pub logical_operator: LogicalOperator,
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub enum Unit {
    #[serde(rename = "numbers")]
    Numbers,
    #[serde(rename = "bytes")]
    Bytes,
    #[serde(rename = "kilobytes")]
    Kilobytes,
    #[serde(rename = "megabytes")]
    Megabytes,
    #[serde(rename = "bps")]
    Bps,
    #[serde(rename = "seconds")]
    Seconds,
    #[serde(rename = "milliseconds")]
    Milliseconds,
    #[serde(rename = "microseconds")]
    Microseconds,
    #[serde(rename = "nanoseconds")]
    Nanoseconds,
    #[serde(rename = "percent-1")]
    PercentNormalized,
    #[serde(rename = "percent")]
    Percent,
    #[serde(rename = "currency-dollar")]
    CurrencyDollar,
    #[serde(rename = "currency-euro")]
    CurrencyEuro,
    #[serde(rename = "currency-pound")]
    CurrencyPound,
    #[serde(rename = "currency-yen")]
    CurrencyYen,
    #[serde(rename = "currency-rupee")]
    CurrencyRupee,
    #[serde(rename = "custom")]
    Custom,
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
    show_legends: bool,
    legends_position: Option<LegendsPosition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legends_type: Option<LegendsType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chart_align: Option<ChartAlign>,
    #[serde(skip_serializing_if = "Option::is_none")]
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub enum ColorMode {
    #[serde(rename = "palette-classic-by-series")]
    PaletteClassicBySeries,
    #[serde(rename = "palette-classic")]
    PaletteClassic,
    #[serde(rename = "fixed")]
    Fixed,
    #[serde(rename = "shades")]
    Shades,
    #[serde(rename = "continuous-green-yellow-red")]
    ContinuousGreenYellowRed,
    #[serde(rename = "continuous-red-yellow-green")]
    ContinuousRedYellowGreen,
    #[serde(rename = "continuous-temperature")]
    ContinuousTemperature,
    #[serde(rename = "continuous-positive")]
    ContinuousPositive,
    #[serde(rename = "continuous-negative")]
    ContinuousNegative,
    #[serde(rename = "continuous-light-to-dark-blue")]
    ContinuousLightToDarkBlue,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ColorCfg {
    #[serde(skip_serializing_if = "Option::is_none")]
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
#[serde(tag = "type", rename_all = "camelCase")]
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Value {
    unit: String,
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum LayerType {
    Scatter,
    Heatmap,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct QueryConfig {
    promql_legend: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    step_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "snake_case")]
pub enum VariableType {
    #[default]
    QueryValues,
    Constant,
    Textbox,
    Custom,
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LineInterpolation {
    #[default]
    Smooth,
    Linear,
    StepStart,
    StepEnd,
    StepMiddle,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
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
