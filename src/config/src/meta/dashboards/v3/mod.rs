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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
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
        let version: i32 = 3;

        let mut hasher = std::hash::DefaultHasher::new();
        hasher.write_i32(version);
        value.hash(&mut hasher);
        let hash = hasher.finish().to_string();
        let updated_at = value.updated_at;

        Self {
            v1: None,
            v2: None,
            v3: Some(value),
            v4: None,
            v5: None,
            v6: None,
            v7: None,
            v8: None,
            version,
            hash,
            updated_at,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
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
}
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub query: Option<String>,
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
    pub latitude: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub longitude: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weight: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<AxisItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<AxisItem>,
    pub filter: Vec<PanelFilter>,
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
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct AxisArg {
    value: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AggregationFunc {
    Count,
    #[serde(rename = "count-distinct")]
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PanelFilter {
    #[serde(rename = "type")]
    pub typ: String,
    pub values: Vec<String>,
    pub column: String,
    pub operator: Option<String>,
    pub value: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct PanelConfig {
    show_legends: bool,
    legends_position: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    unit_custom: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    decimals: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    axis_width: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    axis_border_show: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    legend_width: Option<LegendWidth>,
    base_map: Option<BaseMap>,
    map_view: Option<MapView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    map_symbol_style: Option<MapSymbolStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    drilldown: Option<Vec<DrillDown>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    connect_nulls: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    no_value_replacement: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    wrap_table_cells: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
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

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
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
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
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
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Variables {
    pub list: Vec<VariableList>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show_dynamic_filters: Option<bool>,
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
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
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct QueryData {
    pub stream_type: StreamType,
    pub stream: String,
    pub field: String,
    pub max_record_size: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<Vec<Filters>>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Filters {
    pub name: Option<String>,
    pub operator: Option<String>,
    pub value: String,
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomFieldsOption {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct BaseMap {
    #[serde(rename = "type")]
    pub type_field: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct MapView {
    #[schema(value_type = f64)]
    pub zoom: OrdF64,
    #[schema(value_type = f64)]
    pub lat: OrdF64,
    #[schema(value_type = f64)]
    pub lng: OrdF64,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct MapSymbolStyle {
    pub size: String,
    pub size_by_value: Option<SizeByValue>,
    #[schema(value_type = f64)]
    pub size_fixed: OrdF64,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct SizeByValue {
    #[schema(value_type = f64)]
    pub min: OrdF64,
    #[schema(value_type = f64)]
    pub max: OrdF64,
}

#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct LegendWidth {
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<f64>)]
    pub value: Option<OrdF64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_dashboard() -> Dashboard {
        serde_json::from_value(serde_json::json!({
            "version": 3,
            "title": "V3 Dashboard",
            "description": "A v3 test dashboard"
        }))
        .unwrap()
    }

    #[test]
    fn test_dashboard_fields() {
        let d = make_dashboard();
        assert_eq!(d.title, "V3 Dashboard");
        assert_eq!(d.description, "A v3 test dashboard");
        assert!(d.tabs.is_empty());
    }

    #[test]
    fn test_dashboard_into_meta_version_is_3() {
        let d = make_dashboard();
        let meta: super::super::Dashboard = d.into();
        assert_eq!(meta.version, 3);
        assert!(meta.v3.is_some());
        assert!(meta.v2.is_none());
        assert!(!meta.hash.is_empty());
    }

    #[test]
    fn test_aggregation_func_serde() {
        let s = serde_json::to_string(&AggregationFunc::Count).unwrap();
        assert_eq!(s, "\"count\"");
        let s2 = serde_json::to_string(&AggregationFunc::CountDistinct).unwrap();
        assert_eq!(s2, "\"count-distinct\"");
        let back: AggregationFunc = serde_json::from_str(&s2).unwrap();
        assert_eq!(back, AggregationFunc::CountDistinct);
        let p99 = serde_json::to_string(&AggregationFunc::P99).unwrap();
        assert_eq!(p99, "\"p99\"");
    }

    #[test]
    fn test_legend_width_optional_fields_absent_when_none() {
        let lw = LegendWidth {
            value: None,
            unit: None,
        };
        let json = serde_json::to_string(&lw).unwrap();
        assert!(!json.contains("\"value\""));
        assert!(!json.contains("\"unit\""));
    }

    #[test]
    fn test_aggregation_func_all_variants() {
        let cases = [
            (AggregationFunc::Histogram, "\"histogram\""),
            (AggregationFunc::Sum, "\"sum\""),
            (AggregationFunc::Min, "\"min\""),
            (AggregationFunc::Max, "\"max\""),
            (AggregationFunc::Avg, "\"avg\""),
            (AggregationFunc::Median, "\"median\""),
            (AggregationFunc::P50, "\"p50\""),
            (AggregationFunc::P90, "\"p90\""),
            (AggregationFunc::P95, "\"p95\""),
        ];
        for (variant, expected) in cases {
            let s = serde_json::to_string(&variant).unwrap();
            assert_eq!(s, expected);
            let back: AggregationFunc = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_axis_item_optional_fields_absent_when_none() {
        let item = AxisItem {
            label: "x".to_string(),
            alias: "a".to_string(),
            column: "col".to_string(),
            color: None,
            aggregation_function: None,
            sort_by: None,
            args: None,
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(!json.contains("aggregation_function"));
        assert!(!json.contains("sort_by"));
        assert!(!json.contains("args"));
    }

    #[test]
    fn test_axis_item_with_optional_fields_present() {
        let item: AxisItem = serde_json::from_value(serde_json::json!({
            "label": "lbl",
            "alias": "a",
            "column": "col",
            "color": "#aabbcc",
            "aggregationFunction": "p50",
            "sortBy": "asc",
            "args": [{"value": "v1"}]
        }))
        .unwrap();
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("\"p50\""));
        assert!(json.contains("asc"));
        assert_eq!(item.aggregation_function, Some(AggregationFunc::P50));
        assert_eq!(item.sort_by, Some("asc".to_string()));
    }

    #[test]
    fn test_panel_filter_serde_with_optional_none() {
        let filter = PanelFilter {
            typ: "condition".to_string(),
            values: vec![],
            column: "level".to_string(),
            operator: None,
            value: None,
        };
        let json = serde_json::to_string(&filter).unwrap();
        let back: PanelFilter = serde_json::from_str(&json).unwrap();
        assert_eq!(back.typ, "condition");
        assert!(back.operator.is_none());
        assert!(back.value.is_none());
    }

    #[test]
    fn test_variables_show_dynamic_filters_none_absent() {
        let vars = Variables::default();
        assert!(vars.show_dynamic_filters.is_none());
        let json = serde_json::to_string(&vars).unwrap();
        assert!(!json.contains("showDynamicFilters"));
    }

    #[test]
    fn test_variables_show_dynamic_filters_some_present() {
        let vars = Variables {
            list: vec![],
            show_dynamic_filters: Some(false),
        };
        let json = serde_json::to_string(&vars).unwrap();
        assert!(json.contains("showDynamicFilters"));
        assert!(json.contains("false"));
    }

    #[test]
    fn test_datetime_options_relative_time_period_none_absent() {
        let opts = DateTimeOptions {
            typee: "relative".to_string(),
            relative_time_period: None,
            start_time: None,
            end_time: None,
        };
        let json = serde_json::to_string(&opts).unwrap();
        assert!(!json.contains("relative_time_period"));
        assert!(!json.contains("start_time"));
        assert!(!json.contains("end_time"));
    }

    #[test]
    fn test_datetime_options_absolute_times_serialized() {
        let opts = DateTimeOptions {
            typee: "absolute".to_string(),
            relative_time_period: None,
            start_time: Some(1_000_000),
            end_time: Some(2_000_000),
        };
        let val = serde_json::to_value(&opts).unwrap();
        assert_eq!(val["type"], "absolute");
        assert_eq!(val["startTime"], 1_000_000_i64);
        assert_eq!(val["endTime"], 2_000_000_i64);
        assert!(val.get("relative_time_period").is_none());
    }

    #[test]
    fn test_variable_list_multi_select_none_absent() {
        let vl = VariableList {
            type_field: "query".to_string(),
            name: "v".to_string(),
            label: "V".to_string(),
            query_data: None,
            value: None,
            options: None,
            multi_select: None,
        };
        let json = serde_json::to_string(&vl).unwrap();
        assert!(!json.contains("multiSelect"));
    }

    #[test]
    fn test_variable_list_multi_select_some_present() {
        let vl = VariableList {
            type_field: "custom".to_string(),
            name: "env".to_string(),
            label: "Env".to_string(),
            query_data: None,
            value: None,
            options: None,
            multi_select: Some(true),
        };
        let json = serde_json::to_string(&vl).unwrap();
        assert!(json.contains("multiSelect"));
    }

    #[test]
    fn test_drill_down_all_none_absent() {
        let dd = DrillDown {
            name: None,
            type_field: None,
            target_blank: None,
            find_by: None,
            data: None,
        };
        let json = serde_json::to_string(&dd).unwrap();
        assert!(!json.contains("name"));
        assert!(!json.contains("type"));
        assert!(!json.contains("targetBlank"));
        assert!(!json.contains("findBy"));
        assert!(!json.contains("data"));
    }

    #[test]
    fn test_drill_down_data_all_none_absent() {
        let dd = DrillDownData {
            url: None,
            folder: None,
            dashboard: None,
            tab: None,
            pass_all_variables: None,
            variables: None,
        };
        let json = serde_json::to_string(&dd).unwrap();
        assert!(!json.contains("url"));
        assert!(!json.contains("folder"));
        assert!(!json.contains("dashboard"));
        assert!(!json.contains("tab"));
        assert!(!json.contains("passAllVariables"));
        assert!(!json.contains("variables"));
    }

    #[test]
    fn test_drill_down_all_some_present() {
        let dd = DrillDown {
            name: Some("go_to".to_string()),
            type_field: Some("link".to_string()),
            target_blank: Some(true),
            find_by: Some("field".to_string()),
            data: Some(DrillDownData {
                url: None,
                folder: None,
                dashboard: None,
                tab: None,
                pass_all_variables: None,
                variables: None,
            }),
        };
        let json = serde_json::to_string(&dd).unwrap();
        assert!(json.contains("name"));
        assert!(json.contains("type"));
        assert!(json.contains("targetBlank"));
        assert!(json.contains("findBy"));
        assert!(json.contains("data"));
    }

    #[test]
    fn test_drill_down_data_all_some_present() {
        let dd = DrillDownData {
            url: Some("https://example.com".to_string()),
            folder: Some("f".to_string()),
            dashboard: Some("d".to_string()),
            tab: Some("t".to_string()),
            pass_all_variables: Some(true),
            variables: Some(vec![]),
        };
        let json = serde_json::to_string(&dd).unwrap();
        assert!(json.contains("url"));
        assert!(json.contains("folder"));
        assert!(json.contains("dashboard"));
        assert!(json.contains("tab"));
        assert!(json.contains("passAllVariables"));
        assert!(json.contains("variables"));
    }

    #[test]
    fn test_panel_config_all_none_absent() {
        let cfg = PanelConfig {
            show_legends: false,
            legends_position: None,
            unit: None,
            unit_custom: None,
            decimals: None,
            axis_width: None,
            axis_border_show: None,
            legend_width: None,
            base_map: None,
            map_view: None,
            map_symbol_style: None,
            drilldown: None,
            connect_nulls: None,
            no_value_replacement: None,
            wrap_table_cells: None,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("unit"));
        assert!(!json.contains("decimals"));
        assert!(!json.contains("axisWidth"));
        assert!(!json.contains("axisBorderShow"));
        assert!(!json.contains("legendWidth"));
        assert!(!json.contains("mapSymbolStyle"));
        assert!(!json.contains("drilldown"));
        assert!(!json.contains("connectNulls"));
        assert!(!json.contains("noValueReplacement"));
        assert!(!json.contains("wrapTableCells"));
    }

    #[test]
    fn test_query_config_all_none_absent() {
        let qc = QueryConfig {
            promql_legend: "l".to_string(),
            layer_type: None,
            weight_fixed: None,
            limit: None,
            min: None,
            max: None,
        };
        let json = serde_json::to_string(&qc).unwrap();
        assert!(!json.contains("layer_type"));
        assert!(!json.contains("weight_fixed"));
        assert!(!json.contains("\"limit\""));
        assert!(!json.contains("\"min\""));
        assert!(!json.contains("\"max\""));
    }

    #[test]
    fn test_query_config_all_some_present() {
        let qc = QueryConfig {
            promql_legend: "l".to_string(),
            layer_type: Some("scatter".to_string()),
            weight_fixed: Some(OrdF64::from(1.0)),
            limit: Some(OrdF64::from(10.0)),
            min: Some(OrdF64::from(0.0)),
            max: Some(OrdF64::from(100.0)),
        };
        let json = serde_json::to_string(&qc).unwrap();
        assert!(json.contains("layer_type"));
        assert!(json.contains("weight_fixed"));
        assert!(json.contains("\"limit\""));
        assert!(json.contains("\"min\""));
        assert!(json.contains("\"max\""));
    }

    #[test]
    fn test_panel_fields_all_none_absent() {
        let pf = PanelFields {
            stream: "s".to_string(),
            stream_type: StreamType::Logs,
            x: vec![],
            y: vec![],
            z: None,
            latitude: None,
            longitude: None,
            weight: None,
            source: None,
            target: None,
            value: None,
            filter: vec![],
        };
        let json = serde_json::to_string(&pf).unwrap();
        assert!(!json.contains("\"z\""));
        assert!(!json.contains("latitude"));
        assert!(!json.contains("longitude"));
        assert!(!json.contains("weight"));
        assert!(!json.contains("source"));
        assert!(!json.contains("target"));
        assert!(!json.contains("\"value\""));
    }

    #[test]
    fn test_legend_width_present_when_some() {
        let lw = LegendWidth {
            value: Some(OrdF64::from(80.0)),
            unit: Some("px".to_string()),
        };
        let json = serde_json::to_string(&lw).unwrap();
        assert!(json.contains("value"));
        assert!(json.contains("unit"));
    }

    #[test]
    fn test_dashboard_optional_fields_absent_when_none() {
        let d = make_dashboard();
        let json = serde_json::to_string(&d).unwrap();
        assert!(!json.contains("variables"));
        assert!(!json.contains("defaultDatetimeDuration"));
    }

    #[test]
    fn test_query_data_filter_absent_when_none() {
        let qd = QueryData {
            stream_type: StreamType::Logs,
            stream: "s".to_string(),
            field: "f".to_string(),
            max_record_size: None,
            filter: None,
        };
        let json = serde_json::to_string(&qd).unwrap();
        assert!(!json.contains("filter"));
    }
}
