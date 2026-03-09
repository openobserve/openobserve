import random
from requests.auth import HTTPBasicAuth
class DashboardPage:
    # Make Unique_value_destination a class variable
    Unique_value_dashboard = f"d3m21_{random.randint(100000, 999999)}"
    

    def __init__(self, session, base_url, org_id):
        self.session = session
        self.base_url = base_url
        self.org_id = org_id

    

    def create_dashboard(self, session, base_url, user_email, user_password, org_id, stream_name, folder_id, dashboard_name):
        """Create a dashboard."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        headers = {
            "Content-Type": "application/json", 
            "Custom-Header": "value"
        }

        payload = {
            "version": 5,
            "title": dashboard_name,
            "description": "",
            "role": "",
            "owner": user_email,  # Set to the user's email
            "tabs": [
                {
                    "tabId": "default",
                    "name": "Default",
                    "panels": [
                        {
                            "id": "Panel_ID9034710",
                            "type": "bar",
                            "title": "P1",
                            "description": "",
                            "config": {
                                "show_legends": True,
                                "legends_position": None,
                                "decimals": 2,
                                "line_thickness": 1.5,
                                "step_value": "0",
                                "top_results_others": False,
                                "axis_border_show": False,
                                "label_option": {
                                    "rotate": 0
                                },
                                "show_symbol": True,
                                "line_interpolation": "smooth",
                                "legend_width": {
                                    "unit": "px"
                                },
                                "base_map": {
                                    "type": "osm"
                                },
                                "map_type": {
                                    "type": "world"
                                },
                                "map_view": {
                                    "zoom": 1,
                                    "lat": 0,
                                    "lng": 0
                                },
                                "map_symbol_style": {
                                    "size": "by Value",
                                    "size_by_value": {
                                        "min": 1,
                                        "max": 100
                                    },
                                    "size_fixed": 2
                                },
                                "drilldown": [],
                                "mark_line": [],
                                "override_config": [],
                                "connect_nulls": False,
                                "no_value_replacement": "",
                                "wrap_table_cells": False,
                                "table_transpose": False,
                                "table_dynamic_columns": False,
                                "color": {
                                    "mode": "palette-classic-by-series",
                                    "fixedColor": [
                                        "#53ca53"
                                    ],
                                    "seriesBy": "last"
                                },
                                "trellis": {
                                    "layout": None,
                                    "num_of_columns": 1
                                }
                            },
                            "queryType": "sql",
                            "queries": [
                                {
                                    "query": f"SELECT histogram(_timestamp) as \"x_axis_1\", count(kubernetes_namespace_name) as \"y_axis_1\", kubernetes_labels_name as \"breakdown_1\"  FROM \"{stream_name}\"  GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC",
                                    "vrlFunctionQuery": "",
                                    "customQuery": False,
                                    "fields": {
                                        "stream": stream_name,
                                        "stream_type": "logs",
                                        "x": [
                                            {
                                                "label": "Timestamp",
                                                "alias": "x_axis_1",
                                                "column": "_timestamp",
                                                "color": None,
                                                "aggregationFunction": "histogram",
                                                "sortBy": "ASC",
                                                "isDerived": False
                                            }
                                        ],
                                        "y": [
                                            {
                                                "label": "Kubernetes Namespace Name",
                                                "alias": "y_axis_1",
                                                "column": "kubernetes_namespace_name",
                                                "color": "#5960b2",
                                                "aggregationFunction": "count",
                                                "isDerived": False
                                            }
                                        ],
                                        "z": [],
                                        "breakdown": [
                                            {
                                                "label": "Kubernetes Labels Name",
                                                "alias": "breakdown_1",
                                                "column": "kubernetes_labels_name",
                                                "color": None,
                                                "isDerived": False
                                            }
                                        ],
                                        "filter": {
                                            "filterType": "group",
                                            "logicalOperator": "AND",
                                            "conditions": []
                                        }
                                    },
                                    "config": {
                                        "promql_legend": "",
                                        "layer_type": "scatter",
                                        "weight_fixed": 1,
                                        "limit": 0,
                                        "min": 0,
                                        "max": 100,
                                        "time_shift": []
                                    }
                                }
                            ],
                            "layout": {
                                "x": 0,
                                "y": 0,
                                "w": 24,
                                "h": 9,
                                "i": 1,
                                "moved": False
                            },
                            "htmlContent": "",
                            "markdownContent": "",
                            "customChartContent": " // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};\n  "
                        },
                        {
                            "id": "Panel_ID8353510",
                            "type": "h-bar",
                            "title": "P4",
                            "description": "",
                            "config": {
                                "show_legends": True,
                                "legends_position": None,
                                "decimals": 2,
                                "line_thickness": 1.5,
                                "step_value": "0",
                                "top_results_others": False,
                                "axis_border_show": False,
                                "label_option": {
                                    "rotate": 0
                                },
                                "show_symbol": True,
                                "line_interpolation": "smooth",
                                "legend_width": {
                                    "unit": "px"
                                },
                                "base_map": {
                                    "type": "osm"
                                },
                                "map_type": {
                                    "type": "world"
                                },
                                "map_view": {
                                    "zoom": 1,
                                    "lat": 0,
                                    "lng": 0
                                },
                                "map_symbol_style": {
                                    "size": "by Value",
                                    "size_by_value": {
                                        "min": 1,
                                        "max": 100
                                    },
                                    "size_fixed": 2
                                },
                                "drilldown": [],
                                "mark_line": [],
                                "override_config": [],
                                "connect_nulls": False,
                                "no_value_replacement": "",
                                "wrap_table_cells": False,
                                "table_transpose": False,
                                "table_dynamic_columns": False,
                                "color": {
                                    "mode": "palette-classic-by-series",
                                    "fixedColor": [
                                        "#53ca53"
                                    ],
                                    "seriesBy": "last"
                                },
                                "trellis": {
                                    "layout": None,
                                    "num_of_columns": 1
                                }
                            },
                            "queryType": "sql",
                            "queries": [
                                {
                                    "query": f"SELECT histogram(_timestamp) as \"x_axis_1\", count(kubernetes_namespace_name) as \"y_axis_1\", kubernetes_labels_name as \"breakdown_1\"  FROM \"{stream_name}\"  GROUP BY x_axis_1, breakdown_1 ORDER BY x_axis_1 ASC",
                                    "vrlFunctionQuery": "",
                                    "customQuery": False,
                                    "fields": {
                                        "stream": stream_name,
                                        "stream_type": "logs",
                                        "x": [
                                            {
                                                "label": "Timestamp",
                                                "alias": "x_axis_1",
                                                "column": "_timestamp",
                                                "color": None,
                                                "aggregationFunction": "histogram",
                                                "sortBy": "ASC",
                                                "isDerived": False
                                            }
                                        ],
                                        "y": [
                                            {
                                                "label": "Kubernetes Namespace Name",
                                                "alias": "y_axis_1",
                                                "column": "kubernetes_namespace_name",
                                                "color": "#5960b2",
                                                "aggregationFunction": "count",
                                                "isDerived": False
                                            }
                                        ],
                                        "z": [],
                                        "breakdown": [
                                            {
                                                "label": "Kubernetes Labels Name",
                                                "alias": "breakdown_1",
                                                "column": "kubernetes_labels_name",
                                                "color": None,
                                                "isDerived": False
                                            }
                                        ],
                                        "filter": {
                                            "filterType": "group",
                                            "logicalOperator": "AND",
                                            "conditions": []
                                        }
                                    },
                                    "config": {
                                        "promql_legend": "",
                                        "layer_type": "scatter",
                                        "weight_fixed": 1,
                                        "limit": 0,
                                        "min": 0,
                                        "max": 100,
                                        "time_shift": []
                                    }
                                }
                            ],
                            "layout": {
                                "x": 24,
                                "y": 0,
                                "w": 24,
                                "h": 9,
                                "i": 2,
                                "moved": False
                            },
                            "htmlContent": "",
                            "markdownContent": "",
                            "customChartContent": " // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};\n  "
                        }
                    ]
                },
                {
                    "tabId": "39193",
                    "name": "count",
                    "panels": [
                        {
                            "id": "Panel_ID1546910",
                            "type": "bar",
                            "title": "count",
                            "description": "",
                            "config": {
                                "show_legends": True,
                                "legends_position": None,
                                "decimals": 2,
                                "line_thickness": 1.5,
                                "step_value": "0",
                                "top_results_others": False,
                                "axis_border_show": False,
                                "label_option": {
                                    "rotate": 0
                                },
                                "show_symbol": True,
                                "line_interpolation": "smooth",
                                "legend_width": {
                                    "unit": "px"
                                },
                                "base_map": {
                                    "type": "osm"
                                },
                                "map_type": {
                                    "type": "world"
                                },
                                "map_view": {
                                    "zoom": 1,
                                    "lat": 0,
                                    "lng": 0
                                },
                                "map_symbol_style": {
                                    "size": "by Value",
                                    "size_by_value": {
                                        "min": 1,
                                        "max": 100
                                    },
                                    "size_fixed": 2
                                },
                                "drilldown": [],
                                "mark_line": [],
                                "override_config": [],
                                "connect_nulls": False,
                                "no_value_replacement": "",
                                "wrap_table_cells": False,
                                "table_transpose": False,
                                "table_dynamic_columns": False,
                                "color": {
                                    "mode": "palette-classic-by-series",
                                    "fixedColor": [
                                        "#53ca53"
                                    ],
                                    "seriesBy": "last"
                                },
                                "trellis": {
                                    "layout": None,
                                    "num_of_columns": 1
                                }
                            },
                            "queryType": "sql",
                            "queries": [
                                {
                                    "query": f"SELECT histogram(_timestamp) as \"x_axis_1\", count(_timestamp) as \"y_axis_1\"  FROM \"{stream_name}\"  GROUP BY x_axis_1 ORDER BY x_axis_1 ASC",
                                    "vrlFunctionQuery": "",
                                    "customQuery": False,
                                    "fields": {
                                        "stream": stream_name,
                                        "stream_type": "logs",
                                        "x": [
                                            {
                                                "label": "Timestamp",
                                                "alias": "x_axis_1",
                                                "column": "_timestamp",
                                                "color": None,
                                                "aggregationFunction": "histogram",
                                                "sortBy": "ASC",
                                                "isDerived": False
                                            }
                                        ],
                                        "y": [
                                            {
                                                "label": "Timestamp",
                                                "alias": "y_axis_1",
                                                "column": "_timestamp",
                                                "color": "#5960b2",
                                                "aggregationFunction": "count",
                                                "isDerived": False
                                            }
                                        ],
                                        "z": [],
                                        "breakdown": [],
                                        "filter": {
                                            "filterType": "group",
                                            "logicalOperator": "AND",
                                            "conditions": []
                                        }
                                    },
                                    "config": {
                                        "promql_legend": "",
                                        "layer_type": "scatter",
                                        "weight_fixed": 1,
                                        "limit": 0,
                                        "min": 0,
                                        "max": 100,
                                        "time_shift": []
                                    }
                                }
                            ],
                            "layout": {
                                "x": 0,
                                "y": 0,
                                "w": 24,
                                "h": 9,
                                "i": 1,
                                "moved": False
                            },
                            "htmlContent": "",
                            "markdownContent": "",
                            "customChartContent": " // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};\n  "
                        },
                        {
                            "id": "Panel_ID1055010",
                            "type": "h-bar",
                            "title": "C1",
                            "description": "",
                            "config": {
                                "show_legends": True,
                                "legends_position": None,
                                "decimals": 2,
                                "line_thickness": 1.5,
                                "step_value": "0",
                                "top_results_others": False,
                                "axis_border_show": False,
                                "label_option": {
                                    "rotate": 0
                                },
                                "show_symbol": True,
                                "line_interpolation": "smooth",
                                "legend_width": {
                                    "unit": "px"
                                },
                                "base_map": {
                                    "type": "osm"
                                },
                                "map_type": {
                                    "type": "world"
                                },
                                "map_view": {
                                    "zoom": 1,
                                    "lat": 0,
                                    "lng": 0
                                },
                                "map_symbol_style": {
                                    "size": "by Value",
                                    "size_by_value": {
                                        "min": 1,
                                        "max": 100
                                    },
                                    "size_fixed": 2
                                },
                                "drilldown": [],
                                "mark_line": [],
                                "override_config": [],
                                "connect_nulls": False,
                                "no_value_replacement": "",
                                "wrap_table_cells": False,
                                "table_transpose": False,
                                "table_dynamic_columns": False,
                                "color": {
                                    "mode": "palette-classic-by-series",
                                    "fixedColor": [
                                        "#53ca53"
                                    ],
                                    "seriesBy": "last"
                                },
                                "trellis": {
                                    "layout": None,
                                    "num_of_columns": 1
                                }
                            },
                            "queryType": "sql",
                            "queries": [
                                {
                                    "query": f"SELECT histogram(_timestamp) as \"x_axis_1\", count(_timestamp) as \"y_axis_1\"  FROM \"{stream_name}\"  GROUP BY x_axis_1 ORDER BY x_axis_1 ASC",
                                    "vrlFunctionQuery": "",
                                    "customQuery": False,
                                    "fields": {
                                        "stream": stream_name,
                                        "stream_type": "logs",
                                        "x": [
                                            {
                                                "label": "Timestamp",
                                                "alias": "x_axis_1",
                                                "column": "_timestamp",
                                                "color": None,
                                                "aggregationFunction": "histogram",
                                                "sortBy": "ASC",
                                                "isDerived": False
                                            }
                                        ],
                                        "y": [
                                            {
                                                "label": "Timestamp",
                                                "alias": "y_axis_1",
                                                "column": "_timestamp",
                                                "color": "#5960b2",
                                                "aggregationFunction": "count",
                                                "isDerived": False
                                            }
                                        ],
                                        "z": [],
                                        "breakdown": [],
                                        "filter": {
                                            "filterType": "group",
                                            "logicalOperator": "AND",
                                            "conditions": []
                                        }
                                    },
                                    "config": {
                                        "promql_legend": "",
                                        "layer_type": "scatter",
                                        "weight_fixed": 1,
                                        "limit": 0,
                                        "min": 0,
                                        "max": 100,
                                        "time_shift": []
                                    }
                                }
                            ],
                            "layout": {
                                "x": 24,
                                "y": 0,
                                "w": 24,
                                "h": 9,
                                "i": 2,
                                "moved": False
                            },
                            "htmlContent": "",
                            "markdownContent": "",
                            "customChartContent": " // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};\n  "
                        }
                    ]
                },
                {
                    "tabId": "34948",
                    "name": "Tes",
                    "panels": [
                        {
                            "id": "Panel_ID5902410",
                            "type": "bar",
                            "title": "Test2",
                            "description": "",
                            "config": {
                                "show_legends": True,
                                "legends_position": None,
                                "decimals": 2,
                                "line_thickness": 1.5,
                                "step_value": "0",
                                "top_results_others": False,
                                "axis_border_show": False,
                                "label_option": {
                                    "rotate": 0
                                },
                                "show_symbol": True,
                                "line_interpolation": "smooth",
                                "legend_width": {
                                    "unit": "px"
                                },
                                "base_map": {
                                    "type": "osm"
                                },
                                "map_type": {
                                    "type": "world"
                                },
                                "map_view": {
                                    "zoom": 1,
                                    "lat": 0,
                                    "lng": 0
                                },
                                "map_symbol_style": {
                                    "size": "by Value",
                                    "size_by_value": {
                                        "min": 1,
                                        "max": 100
                                    },
                                    "size_fixed": 2
                                },
                                "drilldown": [],
                                "mark_line": [],
                                "override_config": [],
                                "connect_nulls": False,
                                "no_value_replacement": "",
                                "wrap_table_cells": False,
                                "table_transpose": False,
                                "table_dynamic_columns": False,
                                "color": {
                                    "mode": "palette-classic-by-series",
                                    "fixedColor": [
                                        "#53ca53"
                                    ],
                                    "seriesBy": "last"
                                },
                                "trellis": {
                                    "layout": None,
                                    "num_of_columns": 1
                                }
                            },
                            "queryType": "sql",
                            "queries": [
                                {
                                    "query": f"SELECT histogram(_timestamp) as \"x_axis_1\", count(distinct(_timestamp)) as \"y_axis_1\"  FROM \"{stream_name}\"  GROUP BY x_axis_1 ORDER BY x_axis_1 ASC",
                                    "vrlFunctionQuery": "",
                                    "customQuery": False,
                                    "fields": {
                                        "stream": stream_name,
                                        "stream_type": "logs",
                                        "x": [
                                            {
                                                "label": "Timestamp",
                                                "alias": "x_axis_1",
                                                "column": "_timestamp",
                                                "color": None,
                                                "aggregationFunction": "histogram",
                                                "sortBy": "ASC",
                                                "isDerived": False
                                            }
                                        ],
                                        "y": [
                                            {
                                                "label": "Timestamp",
                                                "alias": "y_axis_1",
                                                "column": "_timestamp",
                                                "color": "#5960b2",
                                                "aggregationFunction": "count-distinct",
                                                "isDerived": False
                                            }
                                        ],
                                        "z": [],
                                        "breakdown": [],
                                        "filter": {
                                            "filterType": "group",
                                            "logicalOperator": "AND",
                                            "conditions": []
                                        }
                                    },
                                    "config": {
                                        "promql_legend": "",
                                        "layer_type": "scatter",
                                        "weight_fixed": 1,
                                        "limit": 0,
                                        "min": 0,
                                        "max": 100,
                                        "time_shift": []
                                    }
                                }
                            ],
                            "layout": {
                                "x": 0,
                                "y": 0,
                                "w": 24,
                                "h": 9,
                                "i": 1,
                                "moved": False
                            },
                            "htmlContent": "",
                            "markdownContent": "",
                            "customChartContent": " // To know more about ECharts , \n// visit: https://echarts.apache.org/examples/en/index.html \n// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple \n// Define your ECharts 'option' here. \n// 'data' variable is available for use and contains the response data from the search result and it is an array.\noption = {  \n \n};\n  "
                        }
                    ]
                }
            ],
            "variables": {
                "list": [],
                "showDynamicFilters": True
            },
            "defaultDatetimeDuration": {
                "type": "relative",
                "relativeTimePeriod": "45m"
            }
        }

        response = session.post(f"{base_url}api/{org_id}/dashboards?folder={folder_id}", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create panel: {response.content.decode()}"
        dashboard_id = response.json()["v5"]["dashboardId"]
        return dashboard_id

    def create_dashboard_with_time_shift(self, session, base_url, user_email, user_password, org_id, stream_name, folder_id, dashboard_name):
        """Create a dashboard with time_shift (comparison against past data)."""
        session.auth = HTTPBasicAuth(user_email, user_password)
        headers = {
            "Content-Type": "application/json",
            "Custom-Header": "value"
        }

        payload = {
            "version": 5,
            "title": dashboard_name,
            "description": "Dashboard with time shift comparison",
            "role": "",
            "owner": user_email,
            "tabs": [
                {
                    "tabId": "default",
                    "name": "Time Comparison",
                    "panels": [
                        {
                            "id": "Panel_TimeShift_1",
                            "type": "line",
                            "title": "Count with Time Shift Comparison",
                            "description": "Comparing current data vs 1h ago, 1d ago, 1w ago",
                            "config": {
                                "show_legends": True,
                                "legends_position": "bottom",
                                "decimals": 2,
                                "line_thickness": 2,
                                "show_symbol": True,
                                "line_interpolation": "smooth",
                                "connect_nulls": False
                            },
                            "queryType": "sql",
                            "queries": [
                                {
                                    "query": f"SELECT histogram(_timestamp) as \"x_axis_1\", count(*) as \"y_axis_1\" FROM \"{stream_name}\" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC",
                                    "vrlFunctionQuery": "",
                                    "customQuery": False,
                                    "fields": {
                                        "stream": stream_name,
                                        "stream_type": "logs",
                                        "x": [
                                            {
                                                "label": "Timestamp",
                                                "alias": "x_axis_1",
                                                "column": "_timestamp",
                                                "aggregationFunction": "histogram",
                                                "sortBy": "ASC"
                                            }
                                        ],
                                        "y": [
                                            {
                                                "label": "Count",
                                                "alias": "y_axis_1",
                                                "column": "*",
                                                "aggregationFunction": "count"
                                            }
                                        ],
                                        "z": [],
                                        "breakdown": [],
                                        "filter": {
                                            "filterType": "group",
                                            "logicalOperator": "AND",
                                            "conditions": []
                                        }
                                    },
                                    "config": {
                                        "promql_legend": "",
                                        "layer_type": "line",
                                        "time_shift": [
                                            {"offSet": "1h"},
                                            {"offSet": "1d"},
                                            {"offSet": "1w"}
                                        ]
                                    }
                                }
                            ],
                            "layout": {
                                "x": 0,
                                "y": 0,
                                "w": 48,
                                "h": 12,
                                "i": 1
                            }
                        },
                        {
                            "id": "Panel_TimeShift_2",
                            "type": "area",
                            "title": "Error Rate Comparison",
                            "description": "Error rate vs previous periods",
                            "config": {
                                "show_legends": True,
                                "legends_position": "right",
                                "decimals": 2,
                                "line_thickness": 1.5,
                                "show_symbol": False,
                                "line_interpolation": "smooth"
                            },
                            "queryType": "sql",
                            "queries": [
                                {
                                    "query": f"SELECT histogram(_timestamp) as \"x_axis_1\", count(*) as \"y_axis_1\" FROM \"{stream_name}\" WHERE code >= 400 GROUP BY x_axis_1 ORDER BY x_axis_1 ASC",
                                    "vrlFunctionQuery": "",
                                    "customQuery": False,
                                    "fields": {
                                        "stream": stream_name,
                                        "stream_type": "logs",
                                        "x": [
                                            {
                                                "label": "Timestamp",
                                                "alias": "x_axis_1",
                                                "column": "_timestamp",
                                                "aggregationFunction": "histogram",
                                                "sortBy": "ASC"
                                            }
                                        ],
                                        "y": [
                                            {
                                                "label": "Error Count",
                                                "alias": "y_axis_1",
                                                "column": "*",
                                                "aggregationFunction": "count"
                                            }
                                        ],
                                        "z": [],
                                        "breakdown": [],
                                        "filter": {
                                            "filterType": "group",
                                            "logicalOperator": "AND",
                                            "conditions": []
                                        }
                                    },
                                    "config": {
                                        "promql_legend": "",
                                        "layer_type": "area",
                                        "time_shift": [
                                            {"offSet": "24h"}
                                        ]
                                    }
                                }
                            ],
                            "layout": {
                                "x": 0,
                                "y": 12,
                                "w": 24,
                                "h": 10,
                                "i": 2
                            }
                        },
                        {
                            "id": "Panel_TimeShift_3",
                            "type": "bar",
                            "title": "Namespace Activity Comparison",
                            "description": "Activity by namespace vs yesterday",
                            "config": {
                                "show_legends": True,
                                "legends_position": "bottom",
                                "decimals": 0
                            },
                            "queryType": "sql",
                            "queries": [
                                {
                                    "query": f"SELECT kubernetes_namespace_name as \"x_axis_1\", count(*) as \"y_axis_1\" FROM \"{stream_name}\" GROUP BY x_axis_1 ORDER BY y_axis_1 DESC LIMIT 10",
                                    "vrlFunctionQuery": "",
                                    "customQuery": False,
                                    "fields": {
                                        "stream": stream_name,
                                        "stream_type": "logs",
                                        "x": [
                                            {
                                                "label": "Namespace",
                                                "alias": "x_axis_1",
                                                "column": "kubernetes_namespace_name"
                                            }
                                        ],
                                        "y": [
                                            {
                                                "label": "Count",
                                                "alias": "y_axis_1",
                                                "column": "*",
                                                "aggregationFunction": "count"
                                            }
                                        ],
                                        "z": [],
                                        "breakdown": [],
                                        "filter": {
                                            "filterType": "group",
                                            "logicalOperator": "AND",
                                            "conditions": []
                                        }
                                    },
                                    "config": {
                                        "promql_legend": "",
                                        "layer_type": "bar",
                                        "time_shift": [
                                            {"offSet": "1d"}
                                        ]
                                    }
                                }
                            ],
                            "layout": {
                                "x": 24,
                                "y": 12,
                                "w": 24,
                                "h": 10,
                                "i": 3
                            }
                        }
                    ]
                }
            ],
            "variables": {
                "list": [],
                "showDynamicFilters": True
            },
            "defaultDatetimeDuration": {
                "type": "relative",
                "relativeTimePeriod": "6h"
            }
        }

        response = session.post(f"{base_url}api/{org_id}/dashboards?folder={folder_id}", json=payload, headers=headers)
        assert response.status_code == 200, f"Failed to create dashboard with time_shift: {response.content.decode()}"
        dashboard_id = response.json()["v5"]["dashboardId"]
        return dashboard_id