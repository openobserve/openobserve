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

use chrono::{DateTime, FixedOffset, Utc};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::OrdF64;
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
    pub panels: Vec<Panel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variables: Option<Variables>,
    #[serde(default, skip_serializing)]
    pub updated_at: i64,
}

impl From<Dashboard> for super::Dashboard {
    fn from(value: Dashboard) -> Self {
        let version: i32 = 2;

        let mut hasher = std::hash::DefaultHasher::new();
        hasher.write_i32(version);
        value.hash(&mut hasher);
        let hash = hasher.finish().to_string();
        let updated_at = value.updated_at;

        Self {
            v1: None,
            v2: Some(value),
            v3: None,
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

fn datetime_now() -> DateTime<FixedOffset> {
    Utc::now().with_timezone(&FixedOffset::east_opt(0).expect(
        "BUG", // This can't possibly fail. Can it?
    ))
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
}
#[derive(Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    pub query: String,
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
pub struct VariableList {
    #[serde(rename = "type")]
    pub type_field: String,
    pub name: String,
    pub label: String,
    #[serde(rename = "query_data")]
    pub query_data: Option<QueryData>,
    pub value: Option<String>,
    pub options: Option<Vec<CustomFieldsOption>>,
}

#[derive(Default, Debug, Clone, PartialEq, Hash, Serialize, Deserialize, ToSchema)]
pub struct QueryData {
    pub stream_type: StreamType,
    pub stream: String,
    pub field: String,
    pub max_record_size: Option<i64>,
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
            "version": 2,
            "title": "My Dashboard",
            "description": "A test dashboard"
        }))
        .unwrap()
    }

    #[test]
    fn test_dashboard_title_and_description() {
        let d = make_dashboard();
        assert_eq!(d.title, "My Dashboard");
        assert_eq!(d.description, "A test dashboard");
    }

    #[test]
    fn test_dashboard_default_fields_empty() {
        let d = make_dashboard();
        assert!(d.dashboard_id.is_empty());
        assert!(d.panels.is_empty());
        assert!(d.variables.is_none());
    }

    #[test]
    fn test_dashboard_into_meta_version_is_2() {
        let d = make_dashboard();
        let meta: super::super::Dashboard = d.into();
        assert_eq!(meta.version, 2);
        assert!(meta.v2.is_some());
        assert!(meta.v1.is_none());
        assert!(meta.v3.is_none());
    }

    #[test]
    fn test_aggregation_func_serde_roundtrip() {
        for func in [
            AggregationFunc::Count,
            AggregationFunc::Sum,
            AggregationFunc::Min,
            AggregationFunc::Max,
            AggregationFunc::Avg,
        ] {
            let json = serde_json::to_string(&func).unwrap();
            let back: AggregationFunc = serde_json::from_str(&json).unwrap();
            assert_eq!(func, back);
        }
    }

    #[test]
    fn test_dashboard_hash_is_not_empty() {
        let d = make_dashboard();
        let meta: super::super::Dashboard = d.into();
        assert!(!meta.hash.is_empty());
    }

    #[test]
    fn test_aggregation_func_count_distinct_serde() {
        let s = serde_json::to_string(&AggregationFunc::CountDistinct).unwrap();
        assert_eq!(s, "\"count-distinct\"");
        let back: AggregationFunc = serde_json::from_str(&s).unwrap();
        assert_eq!(back, AggregationFunc::CountDistinct);
        let hist = serde_json::to_string(&AggregationFunc::Histogram).unwrap();
        assert_eq!(hist, "\"histogram\"");
        let med = serde_json::to_string(&AggregationFunc::Median).unwrap();
        assert_eq!(med, "\"median\"");
    }

    #[test]
    fn test_variables_default_has_none_show_dynamic_filters() {
        let vars = Variables::default();
        assert!(vars.show_dynamic_filters.is_none());
        let json = serde_json::to_string(&vars).unwrap();
        assert!(!json.contains("showDynamicFilters"));
    }

    #[test]
    fn test_variables_with_show_dynamic_filters_some() {
        let vars = Variables {
            list: vec![],
            show_dynamic_filters: Some(true),
        };
        let json = serde_json::to_string(&vars).unwrap();
        assert!(json.contains("showDynamicFilters"));
    }

    #[test]
    fn test_legend_width_skip_none_fields() {
        let lw = LegendWidth {
            value: None,
            unit: None,
        };
        let json = serde_json::to_string(&lw).unwrap();
        assert!(!json.contains("value"));
        assert!(!json.contains("unit"));
    }

    #[test]
    fn test_aggregation_func_all_variants_roundtrip() {
        let all = [
            AggregationFunc::Count,
            AggregationFunc::CountDistinct,
            AggregationFunc::Histogram,
            AggregationFunc::Sum,
            AggregationFunc::Min,
            AggregationFunc::Max,
            AggregationFunc::Avg,
            AggregationFunc::Median,
        ];
        for variant in all {
            let s = serde_json::to_string(&variant).unwrap();
            let back: AggregationFunc = serde_json::from_str(&s).unwrap();
            assert_eq!(back, variant);
        }
    }

    #[test]
    fn test_panel_config_optional_none_fields_absent() {
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
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(!json.contains("\"unit\""));
        assert!(!json.contains("decimals"));
        assert!(!json.contains("axis_width"));
        assert!(!json.contains("axis_border_show"));
        assert!(!json.contains("legend_width"));
    }

    #[test]
    fn test_panel_config_optional_some_fields_present() {
        let cfg = PanelConfig {
            show_legends: true,
            legends_position: Some("bottom".to_string()),
            unit: Some("bytes".to_string()),
            unit_custom: Some("B".to_string()),
            decimals: Some(OrdF64::from(2.0)),
            axis_width: Some(OrdF64::from(50.0)),
            axis_border_show: Some(true),
            legend_width: Some(LegendWidth {
                value: Some(OrdF64::from(100.0)),
                unit: Some("px".to_string()),
            }),
            base_map: None,
            map_view: None,
        };
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"unit\""));
        assert!(json.contains("unit_custom"));
        assert!(json.contains("decimals"));
        assert!(json.contains("axis_width"));
        assert!(json.contains("axis_border_show"));
        assert!(json.contains("legend_width"));
    }

    #[test]
    fn test_axis_item_optional_fields_absent_when_none() {
        let item = AxisItem {
            label: "l".to_string(),
            alias: "a".to_string(),
            column: "c".to_string(),
            color: None,
            aggregation_function: None,
            sort_by: None,
            args: None,
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(!json.contains("aggregationFunction"));
        assert!(!json.contains("sortBy"));
        assert!(!json.contains("\"args\""));
    }

    #[test]
    fn test_axis_item_optional_fields_present_when_some() {
        let item = AxisItem {
            label: "l".to_string(),
            alias: "a".to_string(),
            column: "c".to_string(),
            color: None,
            aggregation_function: Some(AggregationFunc::Sum),
            sort_by: Some("asc".to_string()),
            args: Some(vec![]),
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("aggregationFunction"));
        assert!(json.contains("sortBy"));
        assert!(json.contains("\"args\""));
    }

    #[test]
    fn test_query_config_optional_fields_absent_when_none() {
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
    fn test_query_config_optional_fields_present_when_some() {
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
    fn test_panel_fields_optional_absent_when_none() {
        let pf = PanelFields {
            stream: "s".to_string(),
            stream_type: StreamType::Logs,
            x: vec![],
            y: vec![],
            z: None,
            latitude: None,
            longitude: None,
            weight: None,
            filter: vec![],
        };
        let json = serde_json::to_string(&pf).unwrap();
        assert!(!json.contains("\"z\""));
        assert!(!json.contains("latitude"));
        assert!(!json.contains("longitude"));
        assert!(!json.contains("weight"));
    }

    #[test]
    fn test_panel_fields_optional_present_when_some() {
        let axis = AxisItem {
            label: "l".to_string(),
            alias: "a".to_string(),
            column: "c".to_string(),
            color: None,
            aggregation_function: None,
            sort_by: None,
            args: None,
        };
        let pf = PanelFields {
            stream: "s".to_string(),
            stream_type: StreamType::Logs,
            x: vec![],
            y: vec![],
            z: Some(vec![axis.clone()]),
            latitude: Some(axis.clone()),
            longitude: Some(axis.clone()),
            weight: Some(axis),
            filter: vec![],
        };
        let json = serde_json::to_string(&pf).unwrap();
        assert!(json.contains("\"z\""));
        assert!(json.contains("latitude"));
        assert!(json.contains("longitude"));
        assert!(json.contains("weight"));
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
    fn test_datetime_now_has_zero_offset() {
        let dt = datetime_now();
        assert_eq!(dt.offset().local_minus_utc(), 0);
    }
}
