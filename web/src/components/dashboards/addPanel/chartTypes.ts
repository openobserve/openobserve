export interface ChartType {
  label: string;
  value: string;
  asset: string;
}

export interface ChartCategory {
  chartLabel: string;
  type: ChartType[];
}

export const chartTypesData: { data: ChartCategory[] } = {
  data: [
    {
      chartLabel: "Line",
      type: [
        {
          label: "Basic Line Chart",
          value: "line-simple",
          asset: "/src/assets/dashboard/CustomChartAssets/line-simple.webp",
        },
        // {
        //   label: "Gradient Stacked Area Chart",
        //   value: "area-stack-gradient",
        //   asset: "https://echarts.apache.org/examples/data/thumb/area-stack-gradient.webp"
        // },
        {
          label: "Confidence Band",
          value: "confidence-band",
          asset: "/src/assets/dashboard/CustomChartAssets/confidence-band.webp",
        },
        {
          label: "Multiple X Axes",
          value: "multiple-x-axis",
          asset: "/src/assets/dashboard/CustomChartAssets/multiple-x-axis.webp",
        },
        {
          label: "Intraday Line Breaks 1",
          value: "intraday-breaks-1",
          asset: "/src/assets/dashboard/CustomChartAssets/intraday-breaks-1.webp",
        },
        // {
        //   label: "Intraday Line Breaks 2",
        //   value: "intraday-breaks-2",
        //   asset: "https://echarts.apache.org/examples/data/thumb/line-sections.webp"
        // },
        // {
        //   label: "Line Chart with Fisheye Lens",
        //   value: "line-fisheye-lens",
        //   asset: "https://echarts.apache.org/examples/data/thumb/line-fisheye-lens.webp"
        // }
      ],
    },
    {
      chartLabel: "Bar",
      type: [
        {
          label: "Bar Race",
          value: "bar-race",
          asset: "/src/assets/dashboard/CustomChartAssets/bar-race.webp"
        },
        // {
        //   label: "Bar Multi Drilldown",
        //   value: "bar-multi-drilldown",
        //   asset: "https://echarts.apache.org/examples/data/thumb/bar-drilldown.webp"
        // },
        // {
        //   label: "Bar with Breaks and Brush",
        //   value: "bar-breaks-brush",
        //   asset: "https://echarts.apache.org/examples/data/thumb/bar-brush.webp",
        // },
        {
          label: "Stacked Bar Normalization",
          value: "bar-stack-normalization",
          asset: "/src/assets/dashboard/CustomChartAssets/bar-stack-normalization.webp",
        },
        {
          label: "Stacked Radial Bar (Polar)",
          value: "bar-polar-stack-radial",
          asset: "/src/assets/dashboard/CustomChartAssets/bar-polar-stack-radial.webp",
        },
      ],
    },
    {
      chartLabel: "Pie",
      type: [
        {
          label: "Pie with Border",
          value: "pie-border-radius",
          asset: "/src/assets/dashboard/CustomChartAssets/pie-border-radius.webp",
        },
        {
          label: "Partition Data to Pies",
          value: "data-transform-multiple-pie",
          asset: "/src/assets/dashboard/CustomChartAssets/data-transform-multiple-pie.webp",
        },
        // {
        //   label: "Pie Charts on GEO Map",
        //   value: "map-iceland-pie",
        //   asset: "https://echarts.apache.org/examples/data/thumb/map-pie.webp"
        // }
      ],
    },
    {
      chartLabel: "Scatter",
      type: [
        {
          label: "Scatter Matrix",
          value: "scatter-matrix",
          asset: "/src/assets/dashboard/CustomChartAssets/scatter-matrix.webp"
        },
        // {
        //   label: "Bubble Gradient",
        //   value: "bubble-gradient",
        //   asset: "https://echarts.apache.org/examples/data/thumb/bubble-gradient.webp",
        // },
        // {
        //   label: "Scatter Polar Punchcard",
        //   value: "scatter-polar-punchcard",
        //   asset: "https://echarts.apache.org/examples/data/thumb/scatter-polar-punchcard.webp"
        // },
        // {
        //   label: "Scatter Nebula",
        //   value: "scatter-nebula",
        //   asset: "https://echarts.apache.org/examples/data/thumb/scatter-nebula.webp"
        // },
        {
          label: "Scatter Polynomial Regression",
          value: "scatter-polynomial-regression",
          asset: "/src/assets/dashboard/CustomChartAssets/scatter-polynomial-regression.webp",
        },
        // {
        //   label: "Scatter Clustering Process",
        //   value: "scatter-clustering-process",
        //   asset: "https://echarts.apache.org/examples/data/thumb/scatter-clustering-process.webp"
        // },
        // {
        //   label: "Scatter Jitter",
        //   value: "scatter-jitter",
        //   asset: "https://echarts.apache.org/examples/data/thumb/scatter-anscombe-quartet.webp"
        // }
      ],
    },
    // {
    //   chartLabel: "GEO/Map",
    //   type: [
    //     // {
    //     //   label: "Morphing between Map and Bar",
    //     //   value: "map-bar-morph",
    //     //   asset: "https://echarts.apache.org/examples/data/thumb/map-bar-morph.webp",
    //     // },
    //     // {
    //     //   label: "Geo Seatmap with Flight",
    //     //   value: "geo-seatmap-flight",
    //     //   asset: "https://echarts.apache.org/examples/data/thumb/geo-seatmap-flight.webp"
    //     // },
    //     // {
    //     //   label: "USA Population Estimates",
    //     //   value: "map-usa",
    //     //   asset: "https://echarts.apache.org/examples/data/thumb/map-usa.webp"
    //     // }
    //   ],
    // },
    // {
    //   chartLabel: "Candlestick",
    //   type: [
    //     {
    //       label: "Candlestick Brush",
    //       value: "candlestick-brush",
    //       asset: "/src/assets/dashboard/CustomChartAssets/candlestick-brush.webp",
    //     },
    //     // {
    //     //   label: "Large Candlestick",
    //     //   value: "candlestick-large",
    //     //   asset: "https://echarts.apache.org/examples/data/thumb/candlestick-large.webp"
    //     // },
    //     {
    //       label: "Axis Pointer Link and Touch",
    //       value: "candlestick-touch",
    //       asset: "/src/assets/dashboard/CustomChartAssets/candlestick-touch.webp",
    //     },
    //   ],
    // },
    {
      chartLabel: "Radar",
      type: [
        {
          label: "Customized Radar Chart",
          value: "radar-custom",
          asset: "/src/assets/dashboard/CustomChartAssets/radar-custom.webp",
        },
        {
          label: "Multiple Radar",
          value: "radar-multiple-2",
          asset: "/src/assets/dashboard/CustomChartAssets/radar-multiple-2.webp",
        },
      ],
    },
    {
      chartLabel: "Boxplot",
      type: [
        // {
        //   label: "Boxplot Multi",
        //   value: "boxplot-multi",
        //   asset: "https://echarts.apache.org/examples/data/thumb/boxplot-multi.webp"
        // },
        {
          label: "Data Transform Simple Aggregate",
          value: "data-transform-aggregate",
          asset: "/src/assets/dashboard/CustomChartAssets/data-transform-aggregate.webp",
        },
      ],
    },
    // {
    //   chartLabel: "Heatmap",
    //   type: [
    //     {
    //       label: "Heatmap Large",
    //       value: "heatmap-large",
    //       asset: "https://echarts.apache.org/examples/data/thumb/heatmap-large.webp"
    //     },
    //     {
    //       label: "Calendar Heatmap",
    //       value: "calendar-heatmap",
    //       asset: "https://echarts.apache.org/examples/data/thumb/calendar-heatmap.webp"
    //     },
    //     {
    //       label: "Heatmap Large Piecewise",
    //       value: "heatmap-large-piecewise",
    //       asset: "https://echarts.apache.org/examples/data/thumb/heatmap-large-piecewise.webp"
    //     }
    //   ]
    // },
    {
      chartLabel: "Graph",
      type: [
        {
          label: "Graph on Cartesian",
          value: "graph-on-cartesian",
          asset: "/src/assets/dashboard/CustomChartAssets/graph-on-cartesian.webp",
        },
        // {
        //   label: "NPM Dependencies Graph",
        //   value: "graph-npm",
        //   asset: "https://echarts.apache.org/examples/data/thumb/graph-npm.webp"
        // },
        // {
        //   label: "Life Expectancy Graph",
        //   value: "graph-life-expectancy",
        //   asset: "https://echarts.apache.org/examples/data/thumb/graph-life-expectancy.webp"
        // },
        // {
        //   label: "Graph on Cartesian",
        //   value: "graph-grid",
        //   asset: "https://echarts.apache.org/examples/data/thumb/graph-grid.webp"
        // },
        // {
        //   label: "Calendar Graph",
        //   value: "calendar-graph",
        //   asset: "https://echarts.apache.org/examples/data/thumb/calendar-graph.webp"
        // }
      ],
    },
    // {
    //   chartLabel: "Tree",
    //   type: [
    //     // {
    //     //   label: "Radial Tree",
    //     //   value: "tree-radial",
    //     //   asset: "https://echarts.apache.org/examples/data/thumb/tree-radial.webp"
    //     // },
    //     // {
    //     //   label: "Multiple Trees",
    //     //   value: "tree-polyline",
    //     //   asset: "https://echarts.apache.org/examples/data/thumb/tree-polyline.webp",
    //     // },
    //     // {
    //     //   label: "Tree Legend",
    //     //   value: "tree-legend",
    //     //   asset: "https://echarts.apache.org/examples/data/thumb/tree-legend.webp"
    //     // }
    //   ],
    // },
    {
      chartLabel: "Treemap",
      type: [
        {
          label: "Treemap chart",
          value: "treemap-chart",
          asset: "/src/assets/dashboard/CustomChartAssets/treemap-chart.webp",
        },
        // {
        //   label: "Disk Usage Treemap",
        //   value: "treemap-disk",
        //   asset: "https://echarts.apache.org/examples/data/thumb/treemap-disk.webp"
        // },
        // {
        //   label: "Treemap Visual",
        //   value: "treemap-visual",
        //   asset: "https://echarts.apache.org/examples/data/thumb/treemap-visual.webp"
        // }
      ],
    },
    // {
    //   chartLabel: "Sunburst",
    //   type: [
    //     // {
    //     //   label: "Sunburst with Rounded Corner",
    //     //   value: "sunburst-border-radius",
    //     //   asset: "https://echarts.apache.org/examples/data/thumb/sunburst-borderRadius.webp"
    //     // },
    //     // {
    //     //   label: "Sunburst Monochrome",
    //     //   value: "sunburst-monochrome",
    //     //   asset: "https://echarts.apache.org/examples/data/thumb/sunburst-monochrome.webp"
    //     // },
    //     // {
    //     //   label: "Sunburst VisualMap",
    //     //   value: "sunburst-visualmap",
    //     //   asset: "https://echarts.apache.org/examples/data/thumb/sunburst-visualMap.webp",
    //     // },
    //   ],
    // },
    // {
    //   chartLabel: "Parallel",
    //   type: [
    //     {
    //       label: "Parallel AQI",
    //       value: "parallel-aqi",
    //       asset: "https://echarts.apache.org/examples/data/thumb/parallel-aqi.webp"
    //     },
    //     {
    //       label: "Parallel Nutrients",
    //       value: "parallel-nutrients",
    //       asset: "https://echarts.apache.org/examples/data/thumb/parallel-nutrients.webp"
    //     }
    //   ]
    // },
    {
      chartLabel: "Funnel",
      type: [
        {
          label: "Customized Funnel",
          value: "funnel-customize",
          asset: "/src/assets/dashboard/CustomChartAssets/funnel-customize.webp",
        },
        // {
        //   label: "Multiple Funnel",
        //   value: "funnel-mutiple",
        //   asset: "https://echarts.apache.org/examples/data/thumb/funnel-mutiple.webp"
        // }
      ],
    },
    // {
    //   chartLabel: "PictorialBar",
    //   type: [
    //     {
    //       label: "Pictorial Bar Transition",
    //       value: "pictorialbar-bar-transition",
    //       asset: "https://echarts.apache.org/examples/data/thumb/pictorialBar-bar-transition.webp"
    //     },
    //     {
    //       label: "Pictorial Bar Vehicle",
    //       value: "pictorialbar-vehicle",
    //       asset: "https://echarts.apache.org/examples/data/thumb/pictorialBar-vehicle.webp"
    //     }
    //   ]
    // },
    // {
    //   chartLabel: "Matrix",
    //   type: [
    //     {
    //       label: "Matrix Stock Application",
    //       value: "matrix-stock-application",
    //       asset: "https://echarts.apache.org/examples/data/thumb/grid-multiple.webp"
    //     },
    //     {
    //       label: "Correlation Matrix",
    //       value: "scatter-correlation-matrix",
    //       asset: "https://echarts.apache.org/examples/data/thumb/scatter-matrix.webp"
    //     },
    //     {
    //       label: "Responsive Grid Layout",
    //       value: "grid-responsive-layout",
    //       asset: "https://echarts.apache.org/examples/data/thumb/grid-multiple.webp"
    //     },
    //     {
    //       label: "Simple Matrix",
    //       value: "matrix-simple",
    //       asset: "https://echarts.apache.org/examples/data/thumb/grid-multiple.webp"
    //     }
    //   ]
    // },
    {
      chartLabel: "Custom",
      type: [
        // {
        //   label: "Wind Barb",
        //   value: "custom-wind-barb",
        //   asset: "https://echarts.apache.org/examples/data/thumb/custom-wind-barb.webp"
        // },
        // {
        //   label: "Flame Graph",
        //   value: "custom-flame-graph",
        //   asset: "https://echarts.apache.org/examples/data/thumb/custom-profile.webp"
        // },
        // {
        //   label: "Circle Packing with d3",
        //   value: "custom-circle-packing",
        //   asset: "https://echarts.apache.org/examples/data/thumb/custom-circle-packing.webp"
        // },
        {
          label: "Custom Spiral Race",
          value: "custom-spiral-race",
          asset: "/src/assets/dashboard/CustomChartAssets/custom-spiral-race.webp",
        },
      ],
    },
    {
      chartLabel: "Dataset",
      type: [
        // {
        //   label: "Partition Data to Pies",
        //   value: "data-transform-multiple-pie",
        //   asset: "https://echarts.apache.org/examples/data/thumb/data-transform-multiple-pie-charts.webp",
        // },
        {
          label: "Series Layout",
          value: "dataset-series-layout",
          asset: "/src/assets/dashboard/CustomChartAssets/dataset-series-layout.webp",
        },
        // {
        //   label: "Dataset in Object Array",
        //   value: "dataset-object-array",
        //   asset: "https://echarts.apache.org/examples/data/thumb/dataset-simple0.webp"
        // },
        // {
        //   label: "Share Dataset",
        //   value: "dataset-share",
        //   asset: "https://echarts.apache.org/examples/data/thumb/dataset-link.webp"
        // }
      ],
    },
    {
      chartLabel: "3D",
      type: [
        {
          label: "3D Bar with Dataset",
          value: "bar3d-dataset",
          asset: "/src/assets/dashboard/CustomChartAssets/bar3d-dataset.webp",
        },
        {
          label: "Bar3D Punch Card",
          value: "bar3d-punchcard",
          asset: "/src/assets/dashboard/CustomChartAssets/bar3d-punchcard.webp"
        },
        // {
        //   label: "Globe with Atmosphere",
        //   value: "globe-atmosphere",
        //   asset: "https://echarts.apache.org/examples/data-gl/thumb/globe-atmosphere.webp"
        // },
        // {
        //   label: "Globe Displacement",
        //   value: "globe-displacement",
        //   asset: "https://echarts.apache.org/examples/data-gl/thumb/globe-displacement.webp"
        // },
        {
          label: "3D Scatter with Scatter Matrix",
          value: "scatter3d-scatter-matrix",
          asset: "/src/assets/dashboard/CustomChartAssets/scatter3d-scatter-matrix.webp",
        },
        {
          label: "3D Scatter Dataset",
          value: "scatter3d-dataset",
          asset: "/src/assets/dashboard/CustomChartAssets/scatter3d-dataset.webp",
        },
        // {
        //   label: "Orthographic Projection",
        //   value: "globe-orthographic",
        //   asset: "https://echarts.apache.org/examples/data-gl/thumb/globe.webp"
        // },
        // {
        //   label: "Flights",
        //   value: "globe-flights",
        //   asset: "https://echarts.apache.org/examples/data-gl/thumb/lines3d-flights.webp"
        // },
        // {
        //   label: "10M Bulk GPS Points",
        //   value: "scattergl-large-points",
        //   asset: "https://echarts.apache.org/examples/data-gl/thumb/scatterGL-gps.webp"
        // }
        // {
        //   label: "GraphGL GPU Layout",
        //   value: "graphgl-gpu-layout",
        //   asset: "https://echarts.apache.org/examples/data-gl/thumb/graphgl-gpu.webp"
        // }
      ]
    }
  ]
};
