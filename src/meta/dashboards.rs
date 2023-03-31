// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DashboardList {
    pub list: Vec<NamedDashboard>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NamedDashboard {
    // XXX-REVIEW: Do we need this field (and the encompassing struct) at all?
    // AFAICS, name equals `Dashboard::dashboard_id`, so there's a duplication.
    pub name: String,
    pub details: Dashboard,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub title: String,
    pub dashboard_id: String,
    pub description: String,
    pub role: String,
    pub owner: String,
    pub created: DateTime<FixedOffset>,
    pub panels: Vec<Panel>,
}

// XXX-TODO: Move `Panel` and the associate structs into a separate module.
// `meta::dashboard::panel` perhaps?
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Panel {
    pub id: String,
    #[serde(rename = "type")]
    pub typ: String,
    pub fields: PanelFields,
    pub config: PanelConfig,
    pub query: String,
    pub custom_query: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelFields {
    pub stream: String,
    pub stream_type: StreamType,
    pub x: Vec<AxisItem>,
    pub y: Vec<AxisItem>,
    pub filter: Vec<PanelFilter>,
}

// XXX-TODO: REVISEME
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StreamType {
    Logs,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisItem {
    pub label: String,
    pub alias: String,
    pub column: String,
    pub color: Option<String>,
    pub aggregation_function: AggregationFunc,
}

// XXX-TODO: REVISEME
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AggregationFunc {
    Count,
    Histogram,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelFilter {
    #[serde(rename = "type")]
    pub typ: String, // HACK: use enum
    pub values: Vec<()>,       // XXX-FIXME
    pub column: String,        // HACK: use enum
    pub operator: String,      // HACK: use enum
    pub value: Option<String>, // XXX-REVIEW
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PanelConfig {
    title: String,
    description: String,
    show_legends: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::json;
    use expect_test::expect;

    #[test]
    fn test_dashboard_defs() {
        let dashboard: Dashboard = json::from_str(r##"{
            "title": "b2",
            "dashboardId": "1501078512",
            "description": "desc2",
            "role": "",
            "owner": "root@example.com",
            "created": "2023-03-30T07:49:41.744+00:00",
            "panels": [
                {
                "id": "Panel_ID7857010",
                "type": "bar",
                "fields": {
                    "stream": "default",
                    "stream_type": "logs",
                    "x": [
                    {
                        "label": "Timestamp",
                        "alias": "x_axis_1",
                        "column": "_timestamp",
                        "color": null,
                        "aggregationFunction": "histogram"
                    }
                    ],
                    "y": [
                    {
                        "label": "Kubernetes Host",
                        "alias": "y_axis_1",
                        "column": "kubernetes_host",
                        "color": "#5960b2",
                        "aggregationFunction": "count"
                    }
                    ],
                    "filter": [
                    {
                        "type": "condition",
                        "values": [],
                        "column": "method",
                        "operator": "Is Not Null",
                        "value": null
                    }
                    ]
                },
                "config": {
                    "title": "p5",
                    "description": "sample config blah blah blah",
                    "show_legends": true
                },
                "query": "SELECT histogram(_timestamp) as \"x_axis_1\", count(kubernetes_host) as \"y_axis_1\"  FROM \"default\" WHERE method IS NOT NULL GROUP BY \"x_axis_1\" ORDER BY \"x_axis_1\"",
                "customQuery": false
                }
            ],
            "layouts": [
                {
                "x": 0,
                "y": 0,
                "w": 12,
                "h": 13,
                "i": 1,
                "panelId": "Panel_ID7857010",
                "static": false
                }
            ]
        }"##).unwrap();

        expect![[r##"
            Dashboard {
                title: "b2",
                dashboard_id: "1501078512",
                description: "desc2",
                role: "",
                owner: "root@example.com",
                created: 2023-03-30T07:49:41.744+00:00,
                panels: [
                    Panel {
                        id: "Panel_ID7857010",
                        typ: "bar",
                        fields: PanelFields {
                            stream: "default",
                            stream_type: Logs,
                            x: [
                                AxisItem {
                                    label: "Timestamp",
                                    alias: "x_axis_1",
                                    column: "_timestamp",
                                    color: None,
                                    aggregation_function: Histogram,
                                },
                            ],
                            y: [
                                AxisItem {
                                    label: "Kubernetes Host",
                                    alias: "y_axis_1",
                                    column: "kubernetes_host",
                                    color: Some(
                                        "#5960b2",
                                    ),
                                    aggregation_function: Count,
                                },
                            ],
                            filter: [
                                PanelFilter {
                                    typ: "condition",
                                    values: [],
                                    column: "method",
                                    operator: "Is Not Null",
                                    value: None,
                                },
                            ],
                        },
                        config: PanelConfig {
                            title: "p5",
                            description: "sample config blah blah blah",
                            show_legends: true,
                        },
                        query: "SELECT histogram(_timestamp) as \"x_axis_1\", count(kubernetes_host) as \"y_axis_1\"  FROM \"default\" WHERE method IS NOT NULL GROUP BY \"x_axis_1\" ORDER BY \"x_axis_1\"",
                        custom_query: false,
                    },
                ],
            }
        "##]].assert_debug_eq(&dashboard);
    }
}
