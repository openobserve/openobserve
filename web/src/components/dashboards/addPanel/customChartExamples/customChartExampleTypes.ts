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
          asset:
            "/src/assets/dashboard/CustomChartAssets/intraday-breaks-1.webp",
        },
      ],
    },
    {
      chartLabel: "Bar",
      type: [
        {
          label: "Bar Race",
          value: "bar-race",
          asset: "/src/assets/dashboard/CustomChartAssets/bar-race.webp",
        },
        {
          label: "Stacked Bar Normalization",
          value: "bar-stack-normalization",
          asset:
            "/src/assets/dashboard/CustomChartAssets/bar-stack-normalization.webp",
        },
        {
          label: "Stacked Radial Bar (Polar)",
          value: "bar-polar-stack-radial",
          asset:
            "/src/assets/dashboard/CustomChartAssets/bar-polar-stack-radial.webp",
        },
      ],
    },
    {
      chartLabel: "Pie",
      type: [
        {
          label: "Pie with Border",
          value: "pie-border-radius",
          asset:
            "/src/assets/dashboard/CustomChartAssets/pie-border-radius.webp",
        },
        {
          label: "Partition Data to Pies",
          value: "data-transform-multiple-pie",
          asset:
            "/src/assets/dashboard/CustomChartAssets/data-transform-multiple-pie.webp",
        },
      ],
    },
    {
      chartLabel: "Scatter",
      type: [
        {
          label: "Scatter Matrix",
          value: "scatter-matrix",
          asset: "/src/assets/dashboard/CustomChartAssets/scatter-matrix.webp",
        },
        {
          label: "Scatter Polynomial Regression",
          value: "scatter-polynomial-regression",
          asset:
            "/src/assets/dashboard/CustomChartAssets/scatter-polynomial-regression.webp",
        },
      ],
    },
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
          asset:
            "/src/assets/dashboard/CustomChartAssets/radar-multiple-2.webp",
        },
      ],
    },
    {
      chartLabel: "Boxplot",
      type: [
        {
          label: "Data Transform Simple Aggregate",
          value: "data-transform-aggregate",
          asset:
            "/src/assets/dashboard/CustomChartAssets/data-transform-aggregate.webp",
        },
      ],
    },
    {
      chartLabel: "Graph",
      type: [
        {
          label: "Graph on Cartesian",
          value: "graph-on-cartesian",
          asset:
            "/src/assets/dashboard/CustomChartAssets/graph-on-cartesian.webp",
        },
      ],
    },
    {
      chartLabel: "Treemap",
      type: [
        {
          label: "Treemap chart",
          value: "treemap-chart",
          asset: "/src/assets/dashboard/CustomChartAssets/treemap-chart.webp",
        },
      ],
    },
    {
      chartLabel: "Funnel",
      type: [
        {
          label: "Customized Funnel",
          value: "funnel-customize",
          asset:
            "/src/assets/dashboard/CustomChartAssets/funnel-customize.webp",
        },
      ],
    },
    {
      chartLabel: "Dataset",
      type: [
        {
          label: "Series Layout",
          value: "dataset-series-layout",
          asset:
            "/src/assets/dashboard/CustomChartAssets/dataset-series-layout.webp",
        },
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
          asset: "/src/assets/dashboard/CustomChartAssets/bar3d-punchcard.webp",
        },
        {
          label: "3D Scatter with Scatter Matrix",
          value: "scatter3d-scatter-matrix",
          asset:
            "/src/assets/dashboard/CustomChartAssets/scatter3d-scatter-matrix.webp",
        },
        {
          label: "3D Scatter Dataset",
          value: "scatter3d-dataset",
          asset:
            "/src/assets/dashboard/CustomChartAssets/scatter3d-dataset.webp",
        },
      ],
    },
  ],
};
