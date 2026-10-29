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

/// Caps total defined `annotationSources` (enabled or not), bounding fan-out if all were enabled.
pub const MAX_ANNOTATION_SOURCES: usize = 10;

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
    /// Auto-refresh interval in seconds applied when the dashboard opens; `0` or absent is Off.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_refresh_interval: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotation_sources: Option<Vec<AnnotationSource>>,
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

/// A dashboard-level query whose rows are drawn as annotation markers on time-series panels.
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationSource {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub enabled: bool,
    pub mode: AnnotationSourceMode,
    pub stream_type: StreamType,
    pub stream: String,
    // Opaque in the doc (like Condition.value): MCP's schema walker rejects any recursive ref.
    #[schema(value_type = Object)]
    pub filters: AnnotationConditionGroup,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_time_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub panels: Option<Vec<String>>,
}

impl Default for AnnotationSource {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            color: None,
            enabled: true,
            mode: AnnotationSourceMode::default(),
            stream_type: StreamType::default(),
            stream: String::new(),
            filters: AnnotationConditionGroup::default(),
            query: None,
            title: String::new(),
            description: None,
            end_time_field: None,
            panels: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationSourceMode {
    #[default]
    Builder,
    Sql,
}

/// Mirrors alerts' `ConditionGroup`; separate since alerts' `Value` can't derive `Hash`.
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationConditionGroup {
    pub filter_type: String, // Always "group"
    pub logical_operator: AnnotationLogicalOperator,
    pub conditions: Vec<AnnotationConditionItem>,
}

impl Default for AnnotationConditionGroup {
    fn default() -> Self {
        Self {
            filter_type: "group".to_string(),
            logical_operator: AnnotationLogicalOperator::And,
            conditions: Vec::new(),
        }
    }
}

/// A leaf condition or a nested group inside an annotation source's filter tree.
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(tag = "filterType", rename_all = "lowercase")]
pub enum AnnotationConditionItem {
    Condition(AnnotationConditionLeaf),
    Group {
        #[serde(rename = "logicalOperator")]
        logical_operator: AnnotationLogicalOperator,
        // Self-referential: without this, utoipa's schema walk recurses forever at startup.
        #[schema(no_recursion)]
        conditions: Vec<AnnotationConditionItem>,
    },
}

/// One leaf condition in an annotation source's filter tree.
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct AnnotationConditionLeaf {
    pub column: String,
    pub operator: String,
    pub value: String,
    #[serde(rename = "logicalOperator")]
    pub logical_operator: AnnotationLogicalOperator,
}

/// AND/OR logical operator joining sibling conditions in an annotation source's filter tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(rename_all = "UPPERCASE")]
pub enum AnnotationLogicalOperator {
    #[default]
    And,
    Or,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tab_name: Option<String>,
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
    /// MUST precede Object, whose fields are all optional and would otherwise swallow this.
    Function(Box<AxisArgFunction>),
    Object(AxisArgValue),
    String(String),
    #[schema(value_type = f64)]
    Number(OrdF64),
}

/// A nested function call; its required `args` distinguishes it during untagged matching.
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AxisArgFunction {
    /// Serialized even when None: dropping the key renders an unset function blank, not "None".
    pub function_name: Option<String>,
    /// Opaque to OpenAPI on purpose: the real recursion overflows the schema generator at startup.
    #[schema(value_type = Vec<Object>)]
    pub args: Vec<AxisArg>,
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

/// Optional trend sparkline drawn inside the metric ("Metric Text") panel — the
/// value + a small line/area/bar chart of the underlying series (KPI stat card).
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Sparkline {
    pub enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none", rename = "type")]
    typee: Option<String>, // "line" | "area" | "bar"
    #[serde(skip_serializing_if = "Option::is_none")]
    layout: Option<String>, // "bottom" | "background"
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    fill_opacity: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    line_width: Option<OrdF64>,
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
    sparkline: Option<Sparkline>,
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
    table_filtering: Option<bool>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    show_exemplars: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    axis_label_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    heatmap_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bucket_unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bucket_unit_custom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    heatmap_color_min: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    heatmap_color_max: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    heatmap_palette: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    heatmap_palette_reverse: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    heatmap_color_scale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    heatmap_y_sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    heatmap_y_bucket: Option<HeatmapYBucket>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    heatmap_y_min: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    heatmap_y_max: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thresholds: Option<Thresholds>,
    #[serde(skip_serializing_if = "Option::is_none")]
    enable_roam: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    promql_series_limit: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    fill_opacity: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    fill_gradient: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    bar_width: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    show_bar_track: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    symbol_size: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    symbol_opacity: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legend_values: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    show_gauge_end_labels: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_expandable_rows: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    merge_gaps: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    row_height: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    row_gap: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    show_state_text: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    row_sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tooltip_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostmap_entity_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostmap_group_by: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostmap_reduction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostmap_group_sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostmap_cell_sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostmap_cell_shape: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    hostmap_cell_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    no_data_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    y_axis_min_interval: Option<OrdF64>,
}

/// Heatmap y buckets: "size" mode is fixed-width, "log" mode one per power of `base` (2 or 10).
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct HeatmapYBucket {
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    size: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    base: Option<OrdF64>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    text_color: Option<String>,
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
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Config {
    Unit {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<Value>,
    },
    #[serde(rename_all = "camelCase")]
    UniqueValueColor {
        #[serde(default)]
        auto_color: bool,
    },
    Alignment {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    TextColor {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    BackgroundColor {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    FieldType {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    ConditionalStyles {
        #[serde(skip_serializing_if = "Option::is_none")]
        rules: Option<Vec<ConditionalRule>>,
    },
    Decimals {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[schema(value_type = Option<f64>)]
        value: Option<OrdF64>,
    },
    DisplayName {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    SeriesColor {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    Thresholds {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<Thresholds>,
    },
    ValueMappings {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<Vec<Mapping>>,
    },
    LineStyle {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    LineWidth {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[schema(value_type = Option<f64>)]
        value: Option<OrdF64>,
    },
    FillOpacity {
        #[serde(skip_serializing_if = "Option::is_none")]
        #[schema(value_type = Option<f64>)]
        value: Option<OrdF64>,
    },
    ShowPoints {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<bool>,
    },
    DrawStyle {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    StackGroup {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    YAxis {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    HideFrom {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<SeriesHideFrom>,
    },
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ConditionalRule {
    pub operator: String,
    #[schema(value_type = f64)]
    pub threshold: OrdF64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bg_color: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct SeriesHideFrom {
    #[serde(skip_serializing_if = "Option::is_none")]
    chart: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legend: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tooltip: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Value {
    #[serde(skip_serializing_if = "Option::is_none")]
    unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    custom_unit: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct Thresholds {
    #[serde(skip_serializing_if = "Option::is_none")]
    mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    show_as: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    steps: Option<Vec<ThresholdStep>>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
#[serde(rename_all = "camelCase")]
pub struct ThresholdStep {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    value: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    query_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    formula: Option<String>,
    #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
    query_ref: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hide: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    query_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    promql_legend_fallback: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    range_mode: Option<String>,
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

    #[test]
    fn test_dashboard_into_meta_sets_version_and_content_hash() {
        let minimal = serde_json::json!({ "version": 8, "title": "T", "description": "" });
        let plain: super::super::Dashboard = serde_json::from_value::<Dashboard>(minimal.clone())
            .unwrap()
            .into();
        assert_eq!(plain.version, 8);
        assert!(plain.v8.is_some());

        let mut changed: Dashboard = serde_json::from_value(minimal).unwrap();
        changed.default_refresh_interval = Some(30);
        changed.annotation_sources = Some(vec![AnnotationSource::default()]);
        let changed: super::super::Dashboard = changed.into();
        assert_ne!(plain.hash, changed.hash);
    }

    #[test]
    fn test_annotation_sources_serde_roundtrip() {
        let input = serde_json::json!({
            "version": 8,
            "title": "T",
            "description": "",
            "annotationSources": [
                {
                    "id": "s1",
                    "name": "Deploys",
                    "color": "#5b8ef0",
                    "enabled": false,
                    "mode": "builder",
                    "streamType": "logs",
                    "stream": "k8s_events",
                    "filters": {
                        "filterType": "group",
                        "logicalOperator": "AND",
                        "conditions": [
                            {
                                "filterType": "condition",
                                "column": "event",
                                "operator": "=",
                                "value": "deploy",
                                "logicalOperator": "AND"
                            }
                        ]
                    },
                    "title": "{service} deployed",
                    "description": "by {author}",
                    "endTimeField": "end_time",
                    "panels": ["p1", "p2"]
                },
                {
                    "id": "s2",
                    "name": "Incidents",
                    "mode": "sql",
                    "streamType": "traces",
                    "stream": "",
                    "query": "SELECT _timestamp FROM \"incidents\"",
                    "title": "{title}"
                }
            ]
        });
        let d: Dashboard = serde_json::from_value(input).unwrap();
        let sources = d.annotation_sources.as_ref().unwrap();
        assert_eq!(sources.len(), 2);
        assert!(!sources[0].enabled);
        assert_eq!(sources[0].mode, AnnotationSourceMode::Builder);
        assert_eq!(sources[0].filters.filter_type, "group");
        assert_eq!(sources[0].filters.conditions.len(), 1);
        match &sources[0].filters.conditions[0] {
            AnnotationConditionItem::Condition(leaf) => assert_eq!(leaf.column, "event"),
            AnnotationConditionItem::Group { .. } => panic!("expected a leaf condition"),
        }
        assert_eq!(
            sources[0].panels.as_deref(),
            Some(&["p1".to_string(), "p2".to_string()][..])
        );
        assert!(sources[1].enabled, "enabled defaults to true when omitted");
        assert_eq!(sources[1].mode, AnnotationSourceMode::Sql);
        assert_eq!(sources[1].stream_type, StreamType::Traces);
        assert!(sources[1].panels.is_none());

        let back = serde_json::to_value(&d).unwrap();
        assert_eq!(back["annotationSources"][0]["endTimeField"], "end_time");
        assert_eq!(back["annotationSources"][1]["mode"], "sql");
        assert!(
            !back["annotationSources"][1]
                .as_object()
                .unwrap()
                .contains_key("panels")
        );
        let again: Dashboard = serde_json::from_value(back).unwrap();
        assert_eq!(again, d);
    }

    // Regression: without `#[schema(no_recursion)]` this walk recurses forever and aborts.
    #[test]
    fn test_annotation_condition_item_schema_walk_terminates() {
        let mut schemas = Vec::new();
        AnnotationConditionGroup::schemas(&mut schemas);
        let names: Vec<&str> = schemas.iter().map(|(name, _)| name.as_str()).collect();
        assert!(names.contains(&"AnnotationConditionItem"));
        assert!(names.contains(&"AnnotationConditionLeaf"));
    }

    // `filters` is opaque in the doc, so MCP's tool-schema walker never reaches the self-reference.
    #[test]
    fn test_annotation_filters_opaque_in_dashboard_schema_walk() {
        let mut schemas = Vec::new();
        Dashboard::schemas(&mut schemas);
        let names: Vec<&str> = schemas.iter().map(|(name, _)| name.as_str()).collect();
        assert!(!names.contains(&"AnnotationConditionGroup"));
        assert!(!names.contains(&"AnnotationConditionItem"));
    }

    #[test]
    fn test_bundled_host_metrics_dashboard_parses_as_v8() {
        // Parse oracle for the bundled asset: one missing serde-required key kills auto-import.
        let json = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../web/src/assets/dashboards/host_metrics.dashboard.json"
        ));
        let dashboard: Dashboard = serde_json::from_str(json).unwrap();
        assert_eq!(dashboard.version, 8);
        assert_eq!(dashboard.title, "Host Metrics");
        assert_eq!(dashboard.tabs.len(), 5);
        assert!(dashboard.variables.is_some());
    }

    #[test]
    fn test_axis_arg_value_wrapper_picks_variant_and_round_trips() {
        // Function is tried before Object: saving a panel must not drop nested args.
        let cases = [
            (serde_json::json!("hello"), "String"),
            (serde_json::json!(3.25), "Number"),
            (
                serde_json::json!({ "field": "usage_amount", "streamAlias": "a" }),
                "Object",
            ),
            (
                serde_json::json!({
                    "functionName": "try_cast",
                    "args": [
                        { "type": "field", "value": { "field": "usage_amount", "streamAlias": null } },
                        { "type": "castType", "value": "DOUBLE" }
                    ]
                }),
                "Function",
            ),
            (
                serde_json::json!({ "functionName": null, "args": [] }),
                "Function",
            ),
        ];
        for (value, expected) in cases {
            let original = serde_json::json!({ "type": "x", "value": value });
            let arg: AxisArg = serde_json::from_value(original.clone()).unwrap();
            let variant = match arg.value {
                Some(AxisArgValueWrapper::Function(_)) => "Function",
                Some(AxisArgValueWrapper::Object(_)) => "Object",
                Some(AxisArgValueWrapper::String(_)) => "String",
                Some(AxisArgValueWrapper::Number(_)) => "Number",
                None => "None",
            };
            assert_eq!(variant, expected, "{original}");
            assert_eq!(serde_json::to_value(&arg).unwrap(), original);
        }
    }

    #[test]
    fn test_config_unique_value_color_auto_color_defaults_false() {
        let cfg: Config = serde_json::from_value(serde_json::json!({
            "type": "unique_value_color"
        }))
        .unwrap();
        assert!(matches!(
            cfg,
            Config::UniqueValueColor { auto_color: false }
        ));
    }
}
