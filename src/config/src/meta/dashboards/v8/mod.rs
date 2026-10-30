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
    tooltip_sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y_axis_scale: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    y_axis_log_base: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y_axis_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    y_axis_hard_min: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    y_axis_hard_max: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stack_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    connect_nulls_threshold: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    bar_radius: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sort_order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mark_area: Option<Vec<MarkArea>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scatter_size_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scatter_color_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    scatter_size_min: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    scatter_size_max: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stat_text_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    value_font_size: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gauge_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    gauge_segments: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gauge_round_cap: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    gauge_neutral: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pie_label_content: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    pie_other_threshold: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    donut_inner_radius: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_footer_calcs: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    table_density: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    heatmap_cell_gap: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    heatmap_hide_below: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state_value_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    map_cluster: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    map_cluster_radius: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bar_gauge_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bar_gauge_orientation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bar_gauge_show_unfilled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    distribution_bucket_count: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    distribution_bucket_size: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    distribution_bucket_offset: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    state_timeline_display: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    treemap_show_breadcrumb: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sunburst_show_labels: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    funnel_sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    funnel_orient: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    funnel_show_percent: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    node_graph_layout: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    node_graph_show_edge_labels: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    alert_list_state: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    alert_list_max: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    alert_list_sort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    alert_list_folder: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    flame_graph_stack_field: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    flame_graph_value_field: Option<String>,
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

/// Shaded band on a cartesian chart; `axis` is "x" or "y", `from`/`to` are axis values as strings.
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct MarkArea {
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    axis: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<String>,
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
    Transform {
        #[serde(skip_serializing_if = "Option::is_none")]
        value: Option<String>,
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

    const HOSTMAP_KEYS: [&str; 7] = [
        "hostmap_entity_label",
        "hostmap_group_by",
        "hostmap_reduction",
        "hostmap_group_sort",
        "hostmap_cell_sort",
        "hostmap_cell_shape",
        "hostmap_cell_label",
    ];

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
    fn test_default_refresh_interval_skipped_when_none() {
        let d = make_dashboard();
        assert!(d.default_refresh_interval.is_none());
        let json = serde_json::to_value(&d).unwrap();
        assert!(
            !json
                .as_object()
                .unwrap()
                .contains_key("defaultRefreshInterval")
        );
    }

    #[test]
    fn test_default_refresh_interval_serde_roundtrip() {
        let input = serde_json::json!({
            "version": 8,
            "title": "T",
            "description": "",
            "defaultDatetimeDuration": { "type": "relative", "relativeTimePeriod": "15m" },
            "defaultRefreshInterval": 60
        });
        let d: Dashboard = serde_json::from_value(input).unwrap();
        assert_eq!(d.default_refresh_interval, Some(60));
        let back = serde_json::to_value(&d).unwrap();
        assert_eq!(back["defaultRefreshInterval"], 60);
        let again: Dashboard = serde_json::from_value(back).unwrap();
        assert_eq!(again, d);
    }

    #[test]
    fn test_default_refresh_interval_changes_hash() {
        let plain: super::super::Dashboard = make_dashboard().into();
        let mut d = make_dashboard();
        d.default_refresh_interval = Some(30);
        let with_refresh: super::super::Dashboard = d.into();
        assert_ne!(plain.hash, with_refresh.hash);
    }

    #[test]
    fn test_annotation_sources_skipped_when_none() {
        let json = serde_json::to_value(make_dashboard()).unwrap();
        assert!(!json.as_object().unwrap().contains_key("annotationSources"));
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

    #[test]
    fn test_annotation_sources_change_the_hash() {
        let plain: super::super::Dashboard = make_dashboard().into();
        let mut with_sources = make_dashboard();
        with_sources.annotation_sources = Some(vec![AnnotationSource::default()]);
        let with_sources: super::super::Dashboard = with_sources.into();
        assert_ne!(plain.hash, with_sources.hash);
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

        let n: AxisArgValueWrapper = serde_json::from_value(serde_json::json!(3.25)).unwrap();
        assert!(matches!(n, AxisArgValueWrapper::Number(_)));

        let o: AxisArgValueWrapper = serde_json::from_value(serde_json::json!({
            "field": "usage_amount",
            "streamAlias": null
        }))
        .unwrap();
        assert!(matches!(o, AxisArgValueWrapper::Object(_)));
    }

    #[test]
    fn test_axis_arg_nested_function_survives_round_trip() {
        // sum(TRY_CAST(usage_amount AS DOUBLE)) as the builder writes it. Saving a
        // panel re-serializes this struct, so anything the model cannot represent
        // is lost: the y column then vanishes from the generated query.
        let original = serde_json::json!({
            "type": "function",
            "value": {
                "functionName": "try_cast",
                "args": [
                    { "type": "field", "value": { "field": "usage_amount", "streamAlias": null } },
                    { "type": "castType", "value": "DOUBLE" }
                ]
            }
        });

        let arg: AxisArg = serde_json::from_value(original.clone()).unwrap();
        assert!(matches!(arg.value, Some(AxisArgValueWrapper::Function(_))));

        let round_tripped = serde_json::to_value(&arg).unwrap();
        assert_eq!(round_tripped, original);
    }

    #[test]
    fn test_axis_arg_nested_function_keeps_an_unset_name() {
        let original = serde_json::json!({
            "type": "function",
            "value": { "functionName": null, "args": [] }
        });
        let arg: AxisArg = serde_json::from_value(original.clone()).unwrap();
        assert_eq!(serde_json::to_value(&arg).unwrap(), original);
    }

    #[test]
    fn test_axis_arg_field_still_wins_over_function() {
        // A plain field reference has no `args`, so it must not be read as a
        // nested expression now that the function variant is matched first.
        let arg: AxisArg = serde_json::from_value(serde_json::json!({
            "type": "field",
            "value": { "field": "usage_amount", "streamAlias": "a" }
        }))
        .unwrap();

        match arg.value {
            Some(AxisArgValueWrapper::Object(v)) => {
                assert_eq!(v.field, Some("usage_amount".to_string()));
                assert_eq!(v.stream_alias, Some("a".to_string()));
            }
            other => panic!("expected an object field reference, got {other:?}"),
        }
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
            query_label: None,
            formula: None,
            query_ref: None,
            hide: None,
            query_type: None,
            promql_legend_fallback: None,
            range_mode: None,
        };
        let json = serde_json::to_string(&qc).unwrap();
        assert!(!json.contains("step_value"));
        assert!(!json.contains("layer_type"));
        assert!(!json.contains("weight_fixed"));
        assert!(!json.contains("\"limit\""));
        assert!(!json.contains("\"min\""));
        assert!(!json.contains("\"max\""));
        assert!(!json.contains("timeShift"));
        assert!(!json.contains("query_label"));
        assert!(!json.contains("range_mode"));
    }

    #[test]
    fn test_query_config_range_mode_round_trip() {
        let qc: QueryConfig = serde_json::from_value(serde_json::json!({
            "promql_legend": "",
            "range_mode": "auto"
        }))
        .unwrap();
        assert_eq!(qc.range_mode.as_deref(), Some("auto"));
        let json = serde_json::to_value(&qc).unwrap();
        assert_eq!(json["range_mode"], serde_json::json!("auto"));
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
            ..Default::default()
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

    #[test]
    fn test_mapping_text_color_roundtrip() {
        // A value mapping may carry a display text plus a text color; background stays `color`.
        let m: Mapping = serde_json::from_value(serde_json::json!({
            "type": "gt",
            "value": "90",
            "text": "High",
            "textColor": "#ffffff",
            "color": "#dc2626"
        }))
        .unwrap();
        assert_eq!(m.text_color, Some("#ffffff".to_string()));
        assert_eq!(m.color, Some("#dc2626".to_string()));

        let back = serde_json::to_value(&m).unwrap();
        assert_eq!(back["textColor"], "#ffffff");
        assert_eq!(back["color"], "#dc2626");
        assert!(back.get("bgColor").is_none());
    }

    #[test]
    fn test_mapping_legacy_without_text_color_roundtrips_unchanged() {
        // A pre-existing mapping (no textColor) must deserialize and re-serialize
        // unchanged — text_color stays None and `textColor` is never emitted.
        let m: Mapping = serde_json::from_value(serde_json::json!({
            "type": "value",
            "value": "1",
            "text": "Up",
            "color": "#16a34a"
        }))
        .unwrap();
        assert_eq!(m.text_color, None);
        assert_eq!(m.color, Some("#16a34a".to_string()));

        let back = serde_json::to_value(&m).unwrap();
        assert!(back.get("textColor").is_none());
        assert_eq!(back["color"], "#16a34a");
        assert_eq!(back["text"], "Up");
    }

    #[test]
    fn test_sparkline_default_and_roundtrip() {
        // Default (disabled) sparkline: enabled=false, all optionals absent.
        let json = serde_json::to_value(Sparkline::default()).unwrap();
        assert_eq!(json["enabled"], false);
        assert!(json.get("type").is_none());
        assert!(json.get("layout").is_none());

        // Populated sparkline round-trips with camelCase keys.
        let s: Sparkline = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "type": "area",
            "layout": "bottom",
            "color": "#3b82f6",
            "fillOpacity": 0.15,
            "lineWidth": 2.0
        }))
        .unwrap();
        assert!(s.enabled);
        assert_eq!(s.typee, Some("area".to_string()));
        assert_eq!(s.layout, Some("bottom".to_string()));
        let back = serde_json::to_value(&s).unwrap();
        assert_eq!(back["type"], "area");
        assert_eq!(back["fillOpacity"], 0.15);
        assert_eq!(back["lineWidth"], 2.0);
    }

    #[test]
    fn test_config_unit_tag_and_value() {
        let cfg: Config = serde_json::from_value(serde_json::json!({
            "type": "unit",
            "value": {"unit": "bytes", "customUnit": "rps"}
        }))
        .unwrap();
        match &cfg {
            Config::Unit { value } => {
                let v = value.as_ref().unwrap();
                assert_eq!(v.unit, Some("bytes".to_string()));
                assert_eq!(v.custom_unit, Some("rps".to_string()));
            }
            _ => panic!("expected Unit variant"),
        }
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["type"], "unit");
    }

    #[test]
    fn test_config_unit_value_none_skipped() {
        let cfg = Config::Unit { value: None };
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["type"], "unit");
        assert!(!json.as_object().unwrap().contains_key("value"));
    }

    #[test]
    fn test_config_unique_value_color_camel_case() {
        let cfg: Config = serde_json::from_value(serde_json::json!({
            "type": "unique_value_color",
            "autoColor": true
        }))
        .unwrap();
        assert!(matches!(cfg, Config::UniqueValueColor { auto_color: true }));
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["type"], "unique_value_color");
        assert_eq!(json["autoColor"], true);
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

    #[test]
    fn test_config_simple_string_value_variants() {
        let cases = [
            ("alignment", "left"),
            ("text_color", "#fff"),
            ("background_color", "#000"),
            ("field_type", "number"),
        ];
        for (typ, val) in cases {
            let cfg: Config = serde_json::from_value(serde_json::json!({
                "type": typ,
                "value": val
            }))
            .unwrap();
            let json = serde_json::to_value(&cfg).unwrap();
            assert_eq!(json["type"], typ);
            assert_eq!(json["value"], val);
            let back: Config = serde_json::from_value(json).unwrap();
            assert_eq!(back, cfg);
        }
    }

    #[test]
    fn test_config_string_value_none_skipped() {
        let cfg = Config::Alignment { value: None };
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["type"], "alignment");
        assert!(!json.as_object().unwrap().contains_key("value"));
    }

    #[test]
    fn test_config_conditional_styles_roundtrip() {
        let cfg: Config = serde_json::from_value(serde_json::json!({
            "type": "conditional_styles",
            "rules": [
                {"operator": ">", "threshold": 10.0, "textColor": "#fff", "bgColor": "#f00"}
            ]
        }))
        .unwrap();
        match &cfg {
            Config::ConditionalStyles { rules } => {
                let rules = rules.as_ref().unwrap();
                assert_eq!(rules.len(), 1);
                assert_eq!(rules[0].operator, ">");
                assert_eq!(rules[0].text_color, Some("#fff".to_string()));
                assert_eq!(rules[0].bg_color, Some("#f00".to_string()));
            }
            _ => panic!("expected ConditionalStyles variant"),
        }
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["type"], "conditional_styles");
        let back: Config = serde_json::from_value(json).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn test_config_conditional_styles_rules_none_skipped() {
        let cfg = Config::ConditionalStyles { rules: None };
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["type"], "conditional_styles");
        assert!(!json.as_object().unwrap().contains_key("rules"));
    }

    #[test]
    fn test_conditional_rule_optional_colors_absent_when_none() {
        let rule = ConditionalRule {
            operator: ">=".to_string(),
            threshold: OrdF64::from(5.0),
            text_color: None,
            bg_color: None,
        };
        let json = serde_json::to_string(&rule).unwrap();
        assert!(!json.contains("textColor"));
        assert!(!json.contains("bgColor"));
        assert!(json.contains("operator"));
        assert!(json.contains("threshold"));
    }

    #[test]
    fn test_conditional_rule_threshold_values() {
        // Thresholds may be negative, positive, zero, decimal, or large.
        let cases = [
            -100.0_f64,
            -3.5,
            -0.001,
            0.0,
            0.25,
            10.0,
            42.42,
            1_000_000.5,
        ];
        for &val in &cases {
            let rule = ConditionalRule {
                operator: ">".to_string(),
                threshold: OrdF64::from(val),
                text_color: None,
                bg_color: None,
            };
            let json = serde_json::to_value(&rule).unwrap();
            assert_eq!(json["threshold"], serde_json::json!(val), "value {val}");

            let back: ConditionalRule = serde_json::from_value(json).unwrap();
            assert_eq!(back.threshold, OrdF64::from(val), "roundtrip {val}");
            assert_eq!(back, rule, "full roundtrip {val}");
        }
    }

    #[test]
    fn test_conditional_rule_negative_threshold_deserialize() {
        let rule: ConditionalRule = serde_json::from_value(serde_json::json!({
            "operator": "<",
            "threshold": -12.75,
            "textColor": "#000"
        }))
        .unwrap();
        assert_eq!(rule.operator, "<");
        assert_eq!(rule.threshold, OrdF64::from(-12.75));
        assert_eq!(rule.text_color, Some("#000".to_string()));
        assert_eq!(rule.bg_color, None);
    }

    #[test]
    fn test_conditional_rule_threshold_default_is_zero() {
        let rule = ConditionalRule::default();
        assert_eq!(rule.threshold, OrdF64::from(0.0));
        let json = serde_json::to_value(&rule).unwrap();
        assert_eq!(json["threshold"], serde_json::json!(0.0));
    }

    #[test]
    fn test_conditional_styles_multiple_rules_threshold_ordering() {
        // A conditional_styles config with mixed-sign decimal thresholds should
        // round-trip preserving each rule's threshold and order.
        let cfg: Config = serde_json::from_value(serde_json::json!({
            "type": "conditional_styles",
            "rules": [
                {"operator": "<", "threshold": -5.5, "bgColor": "#00f"},
                {"operator": "=", "threshold": 0.0, "bgColor": "#0f0"},
                {"operator": ">", "threshold": 99.99, "bgColor": "#f00"}
            ]
        }))
        .unwrap();
        match &cfg {
            Config::ConditionalStyles { rules } => {
                let rules = rules.as_ref().unwrap();
                assert_eq!(rules.len(), 3);
                assert_eq!(rules[0].threshold, OrdF64::from(-5.5));
                assert_eq!(rules[1].threshold, OrdF64::from(0.0));
                assert_eq!(rules[2].threshold, OrdF64::from(99.99));
            }
            _ => panic!("expected ConditionalStyles variant"),
        }
        let back: Config = serde_json::from_value(serde_json::to_value(&cfg).unwrap()).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn test_value_default_all_none_absent() {
        let v = Value::default();
        let json = serde_json::to_string(&v).unwrap();
        assert!(!json.contains("unit"));
        assert!(!json.contains("customUnit"));
    }

    #[test]
    fn test_panel_config_table_pivot_and_pagination_fields() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": true,
            "legends_position": null,
            "base_map": null,
            "map_view": null,
            "table_pagination": true,
            "table_pagination_rows_per_page": 25,
            "table_filtering": false,
            "table_pivot_show_row_totals": true,
            "table_pivot_show_col_totals": false,
            "table_pivot_sticky_row_totals": true,
            "table_pivot_sticky_col_totals": false,
            "panel_time_enabled": true,
            "panel_time_range": {"type": "relative", "relativeTimePeriod": "15m"}
        }))
        .unwrap();
        assert_eq!(cfg.table_pagination, Some(true));
        assert_eq!(cfg.table_pagination_rows_per_page, Some(25));
        assert_eq!(cfg.table_filtering, Some(false));
        assert_eq!(cfg.table_pivot_show_row_totals, Some(true));
        assert_eq!(cfg.table_pivot_show_col_totals, Some(false));
        assert_eq!(cfg.table_pivot_sticky_row_totals, Some(true));
        assert_eq!(cfg.table_pivot_sticky_col_totals, Some(false));
        assert_eq!(cfg.panel_time_enabled, Some(true));
        let pr = cfg.panel_time_range.as_ref().unwrap();
        assert_eq!(pr.typee, "relative");
        assert_eq!(pr.relative_time_period, Some("15m".to_string()));
    }

    #[test]
    fn test_panel_config_table_optional_fields_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        }))
        .unwrap();
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("table_pagination"));
        assert!(!json.contains("table_pagination_rows_per_page"));
        assert!(!json.contains("table_filtering"));
        assert!(!json.contains("table_pivot_show_row_totals"));
        assert!(!json.contains("table_pivot_show_col_totals"));
        assert!(!json.contains("table_pivot_sticky_row_totals"));
        assert!(!json.contains("table_pivot_sticky_col_totals"));
        assert!(!json.contains("panel_time_enabled"));
        assert!(!json.contains("panel_time_range"));
        assert!(!json.contains("show_exemplars"));
        assert!(!json.contains("heatmap_mode"));
        assert!(!json.contains("bucket_unit"));
    }

    #[test]
    fn test_panel_config_show_exemplars_round_trip() {
        for on in [true, false] {
            let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
                "show_legends": true,
                "legends_position": null,
                "base_map": null,
                "map_view": null,
                "show_exemplars": on
            }))
            .unwrap();
            assert_eq!(cfg.show_exemplars, Some(on));
            let json = serde_json::to_value(&cfg).unwrap();
            assert_eq!(json["show_exemplars"], serde_json::json!(on));
            let back: PanelConfig = serde_json::from_value(json).unwrap();
            assert_eq!(back, cfg);
        }
    }

    #[test]
    fn test_panel_config_show_exemplars_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        }))
        .unwrap();
        assert_eq!(cfg.show_exemplars, None);
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("show_exemplars").is_none());
    }

    #[test]
    fn test_panel_config_axis_label_mode_round_trip() {
        for mode in ["auto", "show", "hide"] {
            let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
                "show_legends": true,
                "legends_position": null,
                "base_map": null,
                "map_view": null,
                "axis_label_mode": mode
            }))
            .unwrap();
            assert_eq!(cfg.axis_label_mode.as_deref(), Some(mode));
            let json = serde_json::to_value(&cfg).unwrap();
            assert_eq!(json["axis_label_mode"], serde_json::json!(mode));
            let back: PanelConfig = serde_json::from_value(json).unwrap();
            assert_eq!(back, cfg);
        }
    }

    #[test]
    fn test_panel_config_axis_label_mode_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        }))
        .unwrap();
        assert_eq!(cfg.axis_label_mode, None);
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("axis_label_mode").is_none());
    }

    #[test]
    fn test_panel_config_heatmap_histogram_round_trip() {
        for custom in [None, Some("req")] {
            let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
                "show_legends": true,
                "legends_position": null,
                "base_map": null,
                "map_view": null,
                "heatmap_mode": "prometheus_histogram",
                "bucket_unit": "seconds",
                "bucket_unit_custom": custom
            }))
            .unwrap();
            assert_eq!(cfg.heatmap_mode.as_deref(), Some("prometheus_histogram"));
            assert_eq!(cfg.bucket_unit.as_deref(), Some("seconds"));
            assert_eq!(cfg.bucket_unit_custom.as_deref(), custom);
            let json = serde_json::to_value(&cfg).unwrap();
            assert_eq!(
                json["heatmap_mode"],
                serde_json::json!("prometheus_histogram")
            );
            assert_eq!(json["bucket_unit"], serde_json::json!("seconds"));
            let back: PanelConfig = serde_json::from_value(json).unwrap();
            assert_eq!(back, cfg);
        }
    }

    #[test]
    fn test_panel_config_heatmap_histogram_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        }))
        .unwrap();
        assert_eq!(cfg.heatmap_mode, None);
        assert_eq!(cfg.bucket_unit, None);
        assert_eq!(cfg.bucket_unit_custom, None);
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("heatmap_mode").is_none());
        assert!(json.get("bucket_unit").is_none());
        assert!(json.get("bucket_unit_custom").is_none());
    }

    #[test]
    fn test_panel_config_heatmap_color_range_round_trip() {
        for (min, max) in [
            (Some(-2.5), Some(40.0)),
            (Some(0.0), None),
            (None, Some(1e9)),
        ] {
            let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
                "show_legends": true,
                "legends_position": null,
                "base_map": null,
                "map_view": null,
                "heatmap_color_min": min,
                "heatmap_color_max": max
            }))
            .unwrap();
            assert_eq!(cfg.heatmap_color_min, min.map(OrdF64::from));
            assert_eq!(cfg.heatmap_color_max, max.map(OrdF64::from));
            let json = serde_json::to_value(&cfg).unwrap();
            assert_eq!(json.get("heatmap_color_min").and_then(|v| v.as_f64()), min);
            assert_eq!(json.get("heatmap_color_max").and_then(|v| v.as_f64()), max);
            let back: PanelConfig = serde_json::from_value(json).unwrap();
            assert_eq!(back, cfg);
        }
    }

    #[test]
    fn test_panel_config_heatmap_color_range_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null,
            "heatmap_color_min": null
        }))
        .unwrap();
        assert_eq!(cfg.heatmap_color_min, None);
        assert_eq!(cfg.heatmap_color_max, None);
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("heatmap_color_min").is_none());
        assert!(json.get("heatmap_color_max").is_none());
    }

    #[test]
    fn test_panel_config_heatmap_palette_and_scale_round_trip() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": true,
            "legends_position": null,
            "base_map": null,
            "map_view": null,
            "heatmap_palette": "viridis",
            "heatmap_palette_reverse": true,
            "heatmap_color_scale": "log"
        }))
        .unwrap();
        assert_eq!(cfg.heatmap_palette.as_deref(), Some("viridis"));
        assert_eq!(cfg.heatmap_palette_reverse, Some(true));
        assert_eq!(cfg.heatmap_color_scale.as_deref(), Some("log"));
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["heatmap_palette"], serde_json::json!("viridis"));
        assert_eq!(json["heatmap_palette_reverse"], serde_json::json!(true));
        assert_eq!(json["heatmap_color_scale"], serde_json::json!("log"));
        let back: PanelConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn test_panel_config_heatmap_palette_and_scale_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        }))
        .unwrap();
        assert_eq!(cfg.heatmap_palette, None);
        assert_eq!(cfg.heatmap_palette_reverse, None);
        assert_eq!(cfg.heatmap_color_scale, None);
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("heatmap_palette").is_none());
        assert!(json.get("heatmap_palette_reverse").is_none());
        assert!(json.get("heatmap_color_scale").is_none());
    }

    #[test]
    fn test_panel_config_heatmap_y_axis_round_trip() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": true,
            "legends_position": null,
            "base_map": null,
            "map_view": null,
            "heatmap_y_sort": "desc",
            "heatmap_y_bucket": { "mode": "size", "size": 2.5, "base": 10 },
            "heatmap_y_min": -10.0,
            "heatmap_y_max": 500.0
        }))
        .unwrap();
        assert_eq!(cfg.heatmap_y_sort.as_deref(), Some("desc"));
        let bucket = cfg.heatmap_y_bucket.as_ref().unwrap();
        assert_eq!(bucket.mode.as_deref(), Some("size"));
        assert_eq!(bucket.size, Some(OrdF64::from(2.5)));
        assert_eq!(bucket.base, Some(OrdF64::from(10.0)));
        assert_eq!(cfg.heatmap_y_min, Some(OrdF64::from(-10.0)));
        assert_eq!(cfg.heatmap_y_max, Some(OrdF64::from(500.0)));
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["heatmap_y_sort"], serde_json::json!("desc"));
        assert_eq!(
            json["heatmap_y_bucket"],
            serde_json::json!({ "mode": "size", "size": 2.5, "base": 10.0 })
        );
        assert_eq!(json["heatmap_y_min"], serde_json::json!(-10.0));
        assert_eq!(json["heatmap_y_max"], serde_json::json!(500.0));
        let back: PanelConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn test_panel_config_heatmap_y_axis_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null,
            "heatmap_y_bucket": { "mode": "log" }
        }))
        .unwrap();
        assert_eq!(cfg.heatmap_y_sort, None);
        assert_eq!(cfg.heatmap_y_min, None);
        assert_eq!(cfg.heatmap_y_max, None);
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(
            json["heatmap_y_bucket"],
            serde_json::json!({ "mode": "log" })
        );
        for key in ["heatmap_y_sort", "heatmap_y_min", "heatmap_y_max"] {
            assert!(json.get(key).is_none(), "{key} should be omitted");
        }
    }

    #[test]
    fn test_panel_config_thresholds_round_trip() {
        for base_color in [None, Some("#22C55E")] {
            let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
                "show_legends": true,
                "legends_position": null,
                "base_map": null,
                "map_view": null,
                "thresholds": {
                    "mode": "absolute",
                    "showAs": "color_line",
                    "baseColor": base_color,
                    "steps": [
                        {"value": 500, "color": "#F59E0B"},
                        {"value": 1000, "color": "#EF4444"}
                    ]
                }
            }))
            .unwrap();
            let thresholds = cfg.thresholds.as_ref().unwrap();
            assert_eq!(thresholds.mode.as_deref(), Some("absolute"));
            assert_eq!(thresholds.show_as.as_deref(), Some("color_line"));
            assert_eq!(thresholds.base_color.as_deref(), base_color);
            let steps = thresholds.steps.as_ref().unwrap();
            assert_eq!(steps.len(), 2);
            assert_eq!(steps[0].value, Some(OrdF64::from(500.0)));
            assert_eq!(steps[1].color.as_deref(), Some("#EF4444"));

            // OrdF64 writes an integer step back as a float and a null baseColor is not written.
            let mut expected = serde_json::json!({
                "mode": "absolute",
                "showAs": "color_line",
                "steps": [
                    {"value": 500.0, "color": "#F59E0B"},
                    {"value": 1000.0, "color": "#EF4444"}
                ]
            });
            if let Some(color) = base_color {
                expected["baseColor"] = serde_json::json!(color);
            }
            let json = serde_json::to_value(&cfg).unwrap();
            assert_eq!(json["thresholds"], expected);
            let back: PanelConfig = serde_json::from_value(json).unwrap();
            assert_eq!(back, cfg);
        }
    }

    #[test]
    fn test_panel_config_thresholds_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        }))
        .unwrap();
        assert_eq!(cfg.thresholds, None);
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("thresholds").is_none());
    }

    #[test]
    fn test_panel_config_state_timeline_round_trip() {
        let input = serde_json::json!({
            "show_legends": true,
            "legends_position": null,
            "base_map": null,
            "map_view": null,
            "merge_gaps": 90.0,
            "row_height": 24.0,
            "row_gap": 4.0,
            "show_state_text": false,
            "row_sort": "non_ok_time",
            "tooltip_mode": "all_rows"
        });
        let cfg: PanelConfig = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(cfg.merge_gaps, Some(OrdF64::from(90.0)));
        assert_eq!(cfg.row_height, Some(OrdF64::from(24.0)));
        assert_eq!(cfg.row_gap, Some(OrdF64::from(4.0)));
        assert_eq!(cfg.show_state_text, Some(false));
        assert_eq!(cfg.row_sort.as_deref(), Some("non_ok_time"));
        assert_eq!(cfg.tooltip_mode.as_deref(), Some("all_rows"));

        let json = serde_json::to_value(&cfg).unwrap();
        for key in [
            "merge_gaps",
            "row_height",
            "row_gap",
            "show_state_text",
            "row_sort",
            "tooltip_mode",
        ] {
            assert_eq!(json[key], input[key], "{key}");
        }
        let back: PanelConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn test_panel_config_state_timeline_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        }))
        .unwrap();
        let json = serde_json::to_value(&cfg).unwrap();
        for key in [
            "merge_gaps",
            "row_height",
            "row_gap",
            "show_state_text",
            "row_sort",
            "tooltip_mode",
        ] {
            assert!(json.get(key).is_none(), "{key}");
        }
    }

    #[test]
    fn test_panel_config_hostmap_round_trip() {
        let input = serde_json::json!({
            "show_legends": true,
            "legends_position": null,
            "base_map": null,
            "map_view": null,
            "hostmap_entity_label": "gpu_uuid",
            "hostmap_group_by": ["rack", "host"],
            "hostmap_reduction": "max",
            "hostmap_group_sort": "value",
            "hostmap_cell_sort": "name",
            "hostmap_cell_shape": "hexagon",
            "hostmap_cell_label": "value"
        });
        let cfg: PanelConfig = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(cfg.hostmap_entity_label.as_deref(), Some("gpu_uuid"));
        assert_eq!(
            cfg.hostmap_group_by,
            Some(vec!["rack".to_string(), "host".to_string()])
        );
        assert_eq!(cfg.hostmap_reduction.as_deref(), Some("max"));
        assert_eq!(cfg.hostmap_cell_shape.as_deref(), Some("hexagon"));

        let json = serde_json::to_value(&cfg).unwrap();
        for key in HOSTMAP_KEYS {
            assert_eq!(json[key], input[key], "{key}");
        }
        let back: PanelConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn test_panel_config_hostmap_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        }))
        .unwrap();
        let json = serde_json::to_value(&cfg).unwrap();
        for key in HOSTMAP_KEYS {
            assert!(json.get(key).is_none(), "{key}");
        }
    }

    #[test]
    fn test_override_config_series_entry_round_trip() {
        let entry: OverrideConfig = serde_json::from_value(serde_json::json!({
            "field": {"matchBy": "series_regex", "value": "/^checkout/i"},
            "config": [
                {"type": "unit", "value": {"unit": "milliseconds", "customUnit": ""}},
                {"type": "decimals", "value": 2},
                {"type": "display_name", "value": "Checkout API"},
                {"type": "series_color", "value": "#EF4444"},
                {"type": "thresholds", "value": {
                    "mode": "absolute",
                    "showAs": "color_line",
                    "baseColor": null,
                    "steps": [{"value": 800, "color": "#F59E0B"}]
                }}
            ]
        }))
        .unwrap();
        let config = entry.config.as_ref().unwrap();
        assert_eq!(config.len(), 5);
        assert_eq!(
            config[1],
            Config::Decimals {
                value: Some(OrdF64::from(2.0))
            }
        );
        assert_eq!(
            config[2],
            Config::DisplayName {
                value: Some("Checkout API".to_string())
            }
        );
        assert_eq!(
            config[3],
            Config::SeriesColor {
                value: Some("#EF4444".to_string())
            }
        );
        assert!(
            matches!(&config[4], Config::Thresholds { value: Some(t) } if t.base_color.is_none())
        );

        // OrdF64 writes integers back as floats and a null baseColor is not written.
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "field": {"matchBy": "series_regex", "value": "/^checkout/i"},
                "config": [
                    {"type": "unit", "value": {"unit": "milliseconds", "customUnit": ""}},
                    {"type": "decimals", "value": 2.0},
                    {"type": "display_name", "value": "Checkout API"},
                    {"type": "series_color", "value": "#EF4444"},
                    {"type": "thresholds", "value": {
                        "mode": "absolute",
                        "showAs": "color_line",
                        "steps": [{"value": 800.0, "color": "#F59E0B"}]
                    }}
                ]
            })
        );
        let back: OverrideConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, entry);
    }

    #[test]
    fn test_override_config_new_types_skip_unset_value() {
        let cases = [
            (Config::Decimals { value: None }, "decimals"),
            (Config::DisplayName { value: None }, "display_name"),
            (Config::SeriesColor { value: None }, "series_color"),
            (Config::Thresholds { value: None }, "thresholds"),
            (Config::ValueMappings { value: None }, "value_mappings"),
        ];
        for (cfg, typ) in cases {
            let json = serde_json::to_value(&cfg).unwrap();
            assert_eq!(json, serde_json::json!({"type": typ}));
        }
    }

    #[test]
    fn test_override_config_value_mappings_round_trip() {
        let input = serde_json::json!({
            "field": {"matchBy": "series_regex", "value": "/^gpu/"},
            "config": [
                {"type": "display_name", "value": "GPU"},
                {"type": "value_mappings", "value": [
                    {"type": "value", "value": "thermal", "text": "Hot", "color": "#ff0000"},
                    {"type": "regex", "pattern": "^power", "color": "#ffaa00"}
                ]}
            ]
        });
        let entry: OverrideConfig = serde_json::from_value(input.clone()).unwrap();
        let config = entry.config.as_ref().unwrap();
        assert!(matches!(&config[1], Config::ValueMappings { value: Some(m) } if m.len() == 2));
        assert_eq!(serde_json::to_value(&entry).unwrap(), input);
    }

    #[test]
    fn test_override_config_table_entry_round_trips_unchanged() {
        let input = serde_json::json!({
            "field": {"matchBy": "name", "value": "status"},
            "config": [
                {"type": "unit", "value": {"unit": "bytes", "customUnit": ""}},
                {"type": "unique_value_color", "autoColor": true},
                {"type": "alignment", "value": "right"},
                {"type": "text_color", "value": "#ffffff"},
                {"type": "background_color", "value": "#000000"},
                {"type": "field_type", "value": "number"},
                {"type": "conditional_styles", "rules": [
                    {"operator": ">", "threshold": 10.5, "bgColor": "#f00"}
                ]}
            ]
        });
        let entry: OverrideConfig = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(serde_json::to_value(&entry).unwrap(), input);
    }

    fn parity_panel_config_fields() -> serde_json::Value {
        let mut fields = serde_json::json!({
            "tooltip_sort": "desc",
            "y_axis_scale": "log",
            "y_axis_log_base": 2.0,
            "y_axis_label": "Latency",
            "y_axis_hard_min": 0.0,
            "y_axis_hard_max": 100.0,
            "line_style": "dashed",
            "stack_mode": "percent",
            "connect_nulls_threshold": 300.0,
            "bar_radius": 4.0,
            "sort_order": "asc",
            "mark_area": [
                {"name": "Deploy", "axis": "x", "from": "1700000000000", "to": "1700000600000", "color": "#F59E0B"},
                {"axis": "y", "from": "80", "to": "100"}
            ],
            "scatter_size_field": "count",
            "scatter_color_field": "status",
            "scatter_size_min": 4.0,
            "scatter_size_max": 40.0
        });
        let rest = serde_json::json!({
            "stat_text_mode": "value_and_name",
            "value_font_size": 48.0,
            "gauge_style": "arc",
            "gauge_segments": 10.0,
            "gauge_round_cap": true,
            "gauge_neutral": 0.0,
            "pie_label_content": ["name", "percent"],
            "pie_other_threshold": 2.5,
            "donut_inner_radius": 60.0,
            "table_footer_calcs": ["sum", "mean", "last"],
            "table_density": "compact"
        });
        let rest2 = serde_json::json!({
            "heatmap_cell_gap": 1.0,
            "heatmap_hide_below": 0.5,
            "state_value_align": "center",
            "map_cluster": true,
            "map_cluster_radius": 40.0,
            "bar_gauge_mode": "lcd",
            "bar_gauge_orientation": "vertical",
            "bar_gauge_show_unfilled": false
        });
        let rest3 = serde_json::json!({
            "distribution_bucket_count": 30.0,
            "distribution_bucket_size": 0.25,
            "distribution_bucket_offset": -1.0,
            "state_timeline_display": "cells",
            "treemap_show_breadcrumb": false,
            "sunburst_show_labels": true,
            "funnel_sort": "ascending",
            "funnel_orient": "horizontal",
            "funnel_show_percent": true,
            "node_graph_layout": "circular",
            "node_graph_show_edge_labels": true,
            "alert_list_state": ["firing", "silenced"],
            "alert_list_max": 20.0,
            "alert_list_sort": "state",
            "alert_list_folder": "default"
        });
        let rest4 = serde_json::json!({
            "flame_graph_stack_field": "stack",
            "flame_graph_value_field": "samples"
        });
        for part in [rest, rest2, rest3, rest4] {
            fields
                .as_object_mut()
                .unwrap()
                .extend(part.as_object().unwrap().clone());
        }
        fields
    }

    fn panel_config_with(fields: &serde_json::Value) -> serde_json::Value {
        let mut json = serde_json::json!({
            "show_legends": true,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        });
        json.as_object_mut()
            .unwrap()
            .extend(fields.as_object().unwrap().clone());
        json
    }

    #[test]
    fn test_panel_config_parity_fields_round_trip() {
        let fields = parity_panel_config_fields();
        let cfg: PanelConfig = serde_json::from_value(panel_config_with(&fields)).unwrap();
        assert_eq!(cfg.y_axis_log_base, Some(OrdF64::from(2.0)));
        assert_eq!(cfg.stack_mode.as_deref(), Some("percent"));
        assert_eq!(cfg.gauge_round_cap, Some(true));
        assert_eq!(cfg.bar_gauge_show_unfilled, Some(false));
        assert_eq!(
            cfg.table_footer_calcs,
            Some(vec!["sum".into(), "mean".into(), "last".into()])
        );
        assert_eq!(cfg.mark_area.as_ref().map(Vec::len), Some(2));
        let json = serde_json::to_value(&cfg).unwrap();
        for (key, expected) in fields.as_object().unwrap() {
            assert_eq!(&json[key], expected, "{key} changed on serialise");
        }
        let back: PanelConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn test_panel_config_parity_fields_absent_when_none() {
        let cfg: PanelConfig =
            serde_json::from_value(panel_config_with(&serde_json::json!({}))).unwrap();
        let json = serde_json::to_value(&cfg).unwrap();
        for key in parity_panel_config_fields().as_object().unwrap().keys() {
            assert!(json.get(key).is_none(), "{key} should be omitted");
        }
    }

    #[test]
    fn test_panel_config_parity_fields_accept_explicit_null() {
        let nulls: serde_json::Map<String, serde_json::Value> = parity_panel_config_fields()
            .as_object()
            .unwrap()
            .keys()
            .map(|k| (k.clone(), serde_json::Value::Null))
            .collect();
        let cfg: PanelConfig =
            serde_json::from_value(panel_config_with(&serde_json::Value::Object(nulls))).unwrap();
        assert_eq!(cfg.tooltip_sort, None);
        assert_eq!(cfg.mark_area, None);
        let json = serde_json::to_value(&cfg).unwrap();
        for key in parity_panel_config_fields().as_object().unwrap().keys() {
            assert!(json.get(key).is_none(), "{key} should be omitted");
        }
    }

    #[test]
    fn test_mark_area_partial_entry_round_trip() {
        let area: MarkArea = serde_json::from_value(serde_json::json!({"axis": "y"})).unwrap();
        assert_eq!(area.axis.as_deref(), Some("y"));
        assert_eq!(area.name, None);
        assert_eq!(area.from, None);
        assert_eq!(
            serde_json::to_value(&area).unwrap(),
            serde_json::json!({"axis": "y"})
        );
        assert_eq!(
            serde_json::to_value(MarkArea::default()).unwrap(),
            serde_json::json!({})
        );
    }

    #[test]
    fn test_override_config_parity_types_round_trip() {
        let input = serde_json::json!({
            "field": {"matchBy": "series", "value": "errors"},
            "config": [
                {"type": "y_axis", "value": "hidden"},
                {"type": "transform", "value": "negative_y"},
                {"type": "draw_style", "value": "bars"},
                {"type": "line_style", "value": "dotted"}
            ]
        });
        let entry: OverrideConfig = serde_json::from_value(input.clone()).unwrap();
        let config = entry.config.as_ref().unwrap();
        assert!(matches!(&config[0], Config::YAxis { value: Some(v) } if v == "hidden"));
        assert!(matches!(&config[1], Config::Transform { value: Some(v) } if v == "negative_y"));
        assert!(matches!(&config[2], Config::DrawStyle { value: Some(v) } if v == "bars"));
        assert!(matches!(&config[3], Config::LineStyle { value: Some(v) } if v == "dotted"));
        assert_eq!(serde_json::to_value(&entry).unwrap(), input);
    }

    #[test]
    fn test_override_config_parity_types_skip_unset_value() {
        let cases = [
            (Config::YAxis { value: None }, "y_axis"),
            (Config::Transform { value: None }, "transform"),
            (Config::DrawStyle { value: None }, "draw_style"),
            (Config::LineStyle { value: None }, "line_style"),
        ];
        for (cfg, typ) in cases {
            let json = serde_json::to_value(&cfg).unwrap();
            assert_eq!(json, serde_json::json!({"type": typ}));
            let back: Config = serde_json::from_value(json).unwrap();
            assert_eq!(back, cfg);
        }
    }

    #[test]
    fn test_panel_config_parity_string_values_need_no_new_fields() {
        let fields = serde_json::json!({
            "tooltip_mode": "single",
            "unit": "celsius",
            "color": {"mode": "palette-from-thresholds"},
            "thresholds": {"showAs": "dashed_line"},
            "mappings": [{"type": "special", "match": "null", "text": "N/A"}],
            "override_config": [{
                "field": {"matchBy": "name", "value": "cpu"},
                "config": [{"type": "field_type", "value": "sparkline"}]
            }]
        });
        let cfg: PanelConfig = serde_json::from_value(panel_config_with(&fields)).unwrap();
        let json = serde_json::to_value(&cfg).unwrap();
        for (key, expected) in fields.as_object().unwrap() {
            assert_eq!(&json[key], expected, "{key} changed on serialise");
        }
    }

    #[test]
    fn test_panel_config_chart_style_keys_round_trip() {
        let input = serde_json::json!({
            "show_legends": true,
            "legends_position": null,
            "base_map": null,
            "map_view": null,
            "enable_roam": false,
            "promql_series_limit": 250.0,
            "fill_opacity": 40.0,
            "fill_gradient": false,
            "bar_width": 12.0,
            "show_bar_track": true,
            "symbol_size": 8.0,
            "symbol_opacity": 60.0,
            "legend_values": ["value", "percent"],
            "show_gauge_end_labels": true,
            "table_expandable_rows": true
        });
        let cfg: PanelConfig = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(cfg.enable_roam, Some(false));
        assert_eq!(cfg.promql_series_limit, Some(OrdF64::from(250.0)));
        assert_eq!(
            cfg.legend_values,
            Some(vec!["value".to_string(), "percent".to_string()])
        );
        let json = serde_json::to_value(&cfg).unwrap();
        for key in [
            "enable_roam",
            "promql_series_limit",
            "fill_opacity",
            "fill_gradient",
            "bar_width",
            "show_bar_track",
            "symbol_size",
            "symbol_opacity",
            "legend_values",
            "show_gauge_end_labels",
            "table_expandable_rows",
        ] {
            assert_eq!(json[key], input[key], "{key}");
        }
        let back: PanelConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn test_panel_config_promql_series_limit_accepts_an_integer() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": true,
            "legends_position": null,
            "base_map": null,
            "map_view": null,
            "promql_series_limit": 20
        }))
        .unwrap();
        assert_eq!(cfg.promql_series_limit, Some(OrdF64::from(20.0)));
    }

    #[test]
    fn test_panel_config_chart_style_keys_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": false,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        }))
        .unwrap();
        let json = serde_json::to_value(&cfg).unwrap();
        for key in [
            "enable_roam",
            "promql_series_limit",
            "fill_opacity",
            "fill_gradient",
            "bar_width",
            "show_bar_track",
            "symbol_size",
            "symbol_opacity",
            "legend_values",
            "show_gauge_end_labels",
            "table_expandable_rows",
        ] {
            assert!(json.get(key).is_none(), "{key}");
        }
    }

    #[test]
    fn test_override_config_series_style_entry_round_trip() {
        let input = serde_json::json!({
            "field": {"matchBy": "series_regex", "value": "^spine"},
            "config": [
                {"type": "line_style", "value": "dashed"},
                {"type": "line_width", "value": 3.0},
                {"type": "fill_opacity", "value": 40.0},
                {"type": "show_points", "value": true},
                {"type": "draw_style", "value": "bars"},
                {"type": "stack_group", "value": "fabric"},
                {"type": "y_axis", "value": "right"},
                {"type": "hide_from", "value": {"legend": true, "tooltip": true}}
            ]
        });
        let entry: OverrideConfig = serde_json::from_value(input.clone()).unwrap();
        let config = entry.config.as_ref().unwrap();
        assert_eq!(config.len(), 8);
        assert_eq!(
            config[0],
            Config::LineStyle {
                value: Some("dashed".to_string())
            }
        );
        assert_eq!(
            config[1],
            Config::LineWidth {
                value: Some(OrdF64::from(3.0))
            }
        );
        assert_eq!(
            config[2],
            Config::FillOpacity {
                value: Some(OrdF64::from(40.0))
            }
        );
        assert_eq!(config[3], Config::ShowPoints { value: Some(true) });
        assert_eq!(
            config[4],
            Config::DrawStyle {
                value: Some("bars".to_string())
            }
        );
        assert_eq!(
            config[5],
            Config::StackGroup {
                value: Some("fabric".to_string())
            }
        );
        assert_eq!(
            config[6],
            Config::YAxis {
                value: Some("right".to_string())
            }
        );
        assert!(matches!(
            &config[7],
            Config::HideFrom { value: Some(h) }
                if h.chart.is_none() && h.legend == Some(true) && h.tooltip == Some(true)
        ));
        let json = serde_json::to_value(&entry).unwrap();
        assert_eq!(json, input);
        let back: OverrideConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, entry);
    }

    #[test]
    fn test_override_config_series_style_types_skip_unset_value() {
        let cases = [
            (Config::LineStyle { value: None }, "line_style"),
            (Config::LineWidth { value: None }, "line_width"),
            (Config::FillOpacity { value: None }, "fill_opacity"),
            (Config::ShowPoints { value: None }, "show_points"),
            (Config::DrawStyle { value: None }, "draw_style"),
            (Config::StackGroup { value: None }, "stack_group"),
            (Config::YAxis { value: None }, "y_axis"),
            (Config::HideFrom { value: None }, "hide_from"),
        ];
        for (cfg, typ) in cases {
            let json = serde_json::to_value(&cfg).unwrap();
            assert_eq!(json, serde_json::json!({"type": typ}));
            let back: Config = serde_json::from_value(json).unwrap();
            assert_eq!(back, cfg);
        }
    }

    #[test]
    fn test_override_config_show_points_false_is_kept() {
        let cfg: Config =
            serde_json::from_value(serde_json::json!({"type": "show_points", "value": false}))
                .unwrap();
        assert_eq!(cfg, Config::ShowPoints { value: Some(false) });
        assert_eq!(
            serde_json::to_value(&cfg).unwrap(),
            serde_json::json!({"type": "show_points", "value": false})
        );
    }

    #[test]
    fn test_panel_config_no_data_text_and_min_interval_round_trip() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": true,
            "legends_position": null,
            "base_map": null,
            "map_view": null,
            "no_data_text": "Set $site_meter first",
            "y_axis_min_interval": 1
        }))
        .unwrap();
        assert_eq!(cfg.no_data_text.as_deref(), Some("Set $site_meter first"));
        assert_eq!(cfg.y_axis_min_interval, Some(OrdF64::from(1.0)));
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["no_data_text"], "Set $site_meter first");
        assert_eq!(json["y_axis_min_interval"], 1.0);
        let back: PanelConfig = serde_json::from_value(json).unwrap();
        assert_eq!(back, cfg);
    }

    #[test]
    fn test_panel_config_no_data_text_and_min_interval_absent_when_none() {
        let cfg: PanelConfig = serde_json::from_value(serde_json::json!({
            "show_legends": true,
            "legends_position": null,
            "base_map": null,
            "map_view": null
        }))
        .unwrap();
        let json = serde_json::to_value(&cfg).unwrap();
        assert!(json.get("no_data_text").is_none());
        assert!(json.get("y_axis_min_interval").is_none());
    }
}
