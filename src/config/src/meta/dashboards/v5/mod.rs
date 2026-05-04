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
        let version: i32 = 5;

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
            v5: Some(value),
            v6: None,
            v7: None,
            v8: None,
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    pub id: String,
    #[serde(rename = "type")]
    pub typ: String,
    pub title: String,
    pub description: String,
    pub config: PanelConfig,
    #[serde(default)]
    pub query_type: String,
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
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct PanelFields {
    pub stream: String,
    pub stream_type: StreamType,
    pub x: Vec<AxisItem>,
    pub y: Vec<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub z: Option<Vec<AxisItem>>,
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
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxisItem {
    pub label: String,
    pub alias: String,
    pub column: String,
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregation_function: Option<AggregationFunc>,
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
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct HavingConditions {
    #[schema(value_type = Option<f64>)]
    value: Option<OrdF64>,
    operator: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct AxisArg {
    value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "kebab-case")]
pub enum AggregationFunc {
    #[default]
    Count,
    CountDistinct,
    Histogram,
    Sum,
    Min,
    Max,
    Avg,
    Median,
    P50,
    P90,
    P95,
    P99,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize)]
#[serde(untagged, rename_all = "camelCase")]
pub enum PanelFilter {
    #[serde(rename = "condition")]
    Condition(FilterCondition),
    #[serde(rename = "group")]
    Group(GroupType),
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupType {
    pub filter_type: String,
    pub logical_operator: String,
    pub conditions: Vec<PanelFilter>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Background {
    #[serde(rename = "type")]
    pub typ: String,
    pub value: Option<BackgroundValue>, // "", single
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct BackgroundValue {
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    #[serde(rename = "type")]
    pub typ: String,
    pub values: Vec<String>,
    pub column: String,
    pub operator: Option<String>,
    pub value: Option<String>,
    pub logical_operator: String,
    pub filter_type: String,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct PanelConfig {
    show_legends: bool,
    legends_position: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legends_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chart_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unit: Option<String>,
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
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ColorCfg {
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Mapping {
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    typee: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct DrillDown {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    type_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_blank: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    find_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<DrillDownData>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct MarkLine {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    typee: Option<String>,
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
    logs_mode: Option<String>,
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
pub struct QueryConfig {
    promql_legend: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    layer_type: Option<String>,
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

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct DateTimeOptions {
    #[serde(rename = "type")]
    pub typee: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relative_time_period: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time: Option<i64>,
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct VariableList {
    #[serde(rename = "type")]
    pub type_field: String,
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct BaseMap {
    #[serde(rename = "type")]
    pub type_field: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct MapType {
    #[serde(rename = "type")]
    pub type_field: Option<String>,
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct Trellis {
    pub layout: Option<String>,
    pub num_of_columns: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_by_y_axis: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct MapSymbolStyle {
    pub size: String,
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct LegendWidth {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    pub value: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct LegendHeight {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    pub value: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn make_dashboard() -> Dashboard {
        serde_json::from_value(serde_json::json!({
            "version": 5,
            "title": "V5 Dashboard",
            "description": "A v5 test dashboard"
        }))
        .unwrap()
    }

    #[test]
    fn test_dashboard_fields() {
        let d = make_dashboard();
        assert_eq!(d.title, "V5 Dashboard");
        assert!(d.tabs.is_empty());
    }

    #[test]
    fn test_dashboard_into_meta_version_is_5() {
        let d = make_dashboard();
        let meta: super::super::Dashboard = d.into();
        assert_eq!(meta.version, 5);
        assert!(meta.v5.is_some());
        assert!(!meta.hash.is_empty());
    }

    #[test]
    fn test_line_interpolation_default_is_smooth() {
        let li: LineInterpolation = Default::default();
        assert_eq!(li, LineInterpolation::Smooth);
    }

    #[test]
    fn test_line_interpolation_kebab_case_serde() {
        let cases = [
            (LineInterpolation::Smooth, "\"smooth\""),
            (LineInterpolation::Linear, "\"linear\""),
            (LineInterpolation::StepStart, "\"step-start\""),
            (LineInterpolation::StepEnd, "\"step-end\""),
            (LineInterpolation::StepMiddle, "\"step-middle\""),
        ];
        for (variant, expected) in cases {
            let s = serde_json::to_string(&variant).unwrap();
            assert_eq!(s, expected);
            let back: LineInterpolation = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_label_position_default_is_top() {
        let lp: LabelPosition = Default::default();
        assert_eq!(lp, LabelPosition::Top);
    }

    #[test]
    fn test_label_position_camel_case_serde() {
        let cases = [
            (LabelPosition::Top, "\"top\""),
            (LabelPosition::InsideLeft, "\"insideLeft\""),
            (LabelPosition::InsideTopRight, "\"insideTopRight\""),
            (LabelPosition::Outside, "\"outside\""),
        ];
        for (variant, expected) in cases {
            let s = serde_json::to_string(&variant).unwrap();
            assert_eq!(s, expected);
            let back: LabelPosition = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_aggregation_func_default_is_count() {
        let af: AggregationFunc = Default::default();
        assert_eq!(af, AggregationFunc::Count);
    }

    #[test]
    fn test_aggregation_func_kebab_case_serde() {
        let cases = [
            (AggregationFunc::Count, "\"count\""),
            (AggregationFunc::CountDistinct, "\"count-distinct\""),
            (AggregationFunc::P99, "\"p99\""),
        ];
        for (variant, expected) in cases {
            let s = serde_json::to_string(&variant).unwrap();
            assert_eq!(s, expected);
            let back: AggregationFunc = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_aggregation_func_all_variants_roundtrip() {
        let variants = [
            AggregationFunc::Histogram,
            AggregationFunc::Sum,
            AggregationFunc::Min,
            AggregationFunc::Max,
            AggregationFunc::Avg,
            AggregationFunc::Median,
            AggregationFunc::P50,
            AggregationFunc::P90,
            AggregationFunc::P95,
        ];
        for variant in variants {
            let s = serde_json::to_string(&variant).unwrap();
            let back: AggregationFunc = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_axis_item_optional_fields_absent_when_none() {
        let item: AxisItem = serde_json::from_value(serde_json::json!({
            "label": "lbl",
            "alias": "a",
            "column": "col"
        }))
        .unwrap();
        let json = serde_json::to_string(&item).unwrap();
        assert!(!json.contains("aggregationFunction"));
        assert!(!json.contains("sortBy"));
        assert!(!json.contains("isDerived"));
    }

    #[test]
    fn test_axis_item_with_aggregation_function() {
        let item: AxisItem = serde_json::from_value(serde_json::json!({
            "label": "lbl",
            "alias": "a",
            "column": "col",
            "aggregationFunction": "avg",
            "isDerived": true
        }))
        .unwrap();
        assert_eq!(item.aggregation_function, Some(AggregationFunc::Avg));
        assert_eq!(item.is_derived, Some(true));
    }

    #[test]
    fn test_variables_show_dynamic_filters_none_absent() {
        let vars = Variables::default();
        let json = serde_json::to_string(&vars).unwrap();
        assert!(!json.contains("showDynamicFilters"));
    }

    #[test]
    fn test_variables_show_dynamic_filters_some_present() {
        let vars = Variables {
            list: vec![],
            show_dynamic_filters: Some(true),
        };
        let json = serde_json::to_string(&vars).unwrap();
        assert!(json.contains("showDynamicFilters"));
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
    fn test_variable_list_all_optional_fields_absent_when_none() {
        let vl = VariableList::default();
        let json = serde_json::to_string(&vl).unwrap();
        assert!(!json.contains("multiSelect"));
        assert!(!json.contains("hideOnDashboard"));
        assert!(!json.contains("selectAllValueForMultiSelect"));
        assert!(!json.contains("customMultiSelectValue"));
        assert!(!json.contains("escapeSingleQuotes"));
    }

    #[test]
    fn test_variable_list_optional_fields_present_when_some() {
        let vl = VariableList {
            multi_select: Some(true),
            hide_on_dashboard: Some(false),
            select_all_value_for_multi_select: Some("*".to_string()),
            custom_multi_select_value: Some(vec!["x".to_string()]),
            escape_single_quotes: Some(true),
            ..Default::default()
        };
        let json = serde_json::to_string(&vl).unwrap();
        assert!(json.contains("multiSelect"));
        assert!(json.contains("hideOnDashboard"));
        assert!(json.contains("selectAllValueForMultiSelect"));
        assert!(json.contains("customMultiSelectValue"));
        assert!(json.contains("escapeSingleQuotes"));
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
            layer_type: None,
            weight_fixed: None,
            limit: None,
            min: None,
            max: None,
            time_shift: None,
        };
        let json = serde_json::to_string(&qc).unwrap();
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
