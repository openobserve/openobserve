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
#[serde(rename_all = "camelCase")]
pub struct Join {
    pub stream: String,
    pub stream_alias: String,
    pub join_type: String,
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
    pub filter_type: String,
    pub logical_operator: String,
    #[schema(value_type = Vec<Object>)]
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
pub struct StreamFieldObj {
    pub field: Option<String>,
    pub stream_alias: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FilterCondition {
    #[serde(rename = "type")]
    pub typ: String,
    pub values: Vec<String>,
    pub column: Option<StreamFieldObj>,
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
    aggregation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lat_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lon_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    weight_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_aggregations: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    promql_table_mode: Option<String>,
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
    step_value: Option<String>,
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

pub type PanelTimeRange = DateTimeOptions;

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
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
