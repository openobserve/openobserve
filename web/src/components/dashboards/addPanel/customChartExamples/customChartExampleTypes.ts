import { getImageURL } from "@/utils/zincutils";

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
          asset: getImageURL("dashboard/CustomChartAssets/line-simple.webp"),
        },
        {
          label: "Confidence Band",
          value: "confidence-band",
          asset: getImageURL("dashboard/CustomChartAssets/confidence-band.webp"),
        },
        {
          label: "Multiple X Axes",
          value: "multiple-x-axis",
          asset: getImageURL("dashboard/CustomChartAssets/multiple-x-axis.webp"),
        },
        {
          label: "Intraday Line Breaks 1",
          value: "intraday-breaks-1",
          asset: getImageURL("dashboard/CustomChartAssets/intraday-breaks-1.webp"),
        },
      ],
    },
    {
      chartLabel: "Bar",
      type: [
        {
          label: "Bar Race",
          value: "bar-race",
          asset: getImageURL("dashboard/CustomChartAssets/bar-race.webp"),
        },
        {
          label: "Stacked Bar Normalization",
          value: "bar-stack-normalization",
          asset: getImageURL("dashboard/CustomChartAssets/bar-stack-normalization.webp"),
        },
        {
          label: "Stacked Radial Bar (Polar)",
          value: "bar-polar-stack-radial",
          asset: getImageURL("dashboard/CustomChartAssets/bar-polar-stack-radial.webp"),
        },
      ],
    },
    {
      chartLabel: "Pie",
      type: [
        {
          label: "Pie with Border",
          value: "pie-border-radius",
          asset: getImageURL("dashboard/CustomChartAssets/pie-border-radius.webp"),
        },
        {
          label: "Partition Data to Pies",
          value: "data-transform-multiple-pie",
          asset: getImageURL("dashboard/CustomChartAssets/data-transform-multiple-pie.webp"),
        },
      ],
    },
    {
      chartLabel: "Scatter",
      type: [
        {
          label: "Scatter Matrix",
          value: "scatter-matrix",
          asset: getImageURL("dashboard/CustomChartAssets/scatter-matrix.webp"),
        },
        {
          label: "Scatter Polynomial Regression",
          value: "scatter-polynomial-regression",
          asset: getImageURL("dashboard/CustomChartAssets/scatter-polynomial-regression.webp"),
        },
      ],
    },
    {
      chartLabel: "Radar",
      type: [
        {
          label: "Customized Radar Chart",
          value: "radar-custom",
          asset: getImageURL("dashboard/CustomChartAssets/radar-custom.webp"),
        },
        {
          label: "Multiple Radar",
          value: "radar-multiple-2",
          asset: getImageURL("dashboard/CustomChartAssets/radar-multiple-2.webp"),
        },
      ],
    },
    {
      chartLabel: "Boxplot",
      type: [
        {
          label: "Data Transform Simple Aggregate",
          value: "data-transform-aggregate",
          asset: getImageURL("dashboard/CustomChartAssets/data-transform-aggregate.webp"),
        },
      ],
    },
    {
      chartLabel: "Graph",
      type: [
        {
          label: "Graph on Cartesian",
          value: "graph-on-cartesian",
          asset: getImageURL("dashboard/CustomChartAssets/graph-on-cartesian.webp"),
        },
      ],
    },
    {
      chartLabel: "Treemap",
      type: [
        {
          label: "Treemap chart",
          value: "treemap-chart",
          asset: getImageURL("dashboard/CustomChartAssets/treemap-chart.webp"),
        },
      ],
    },
    {
      chartLabel: "Funnel",
      type: [
        {
          label: "Customized Funnel",
          value: "funnel-customize",
          asset: getImageURL("dashboard/CustomChartAssets/funnel-customize.webp"),
        },
      ],
    },
    {
      chartLabel: "Dataset",
      type: [
        {
          label: "Series Layout",
          value: "dataset-series-layout",
          asset: getImageURL("dashboard/CustomChartAssets/dataset-series-layout.webp"),
        },
      ],
    },
    {
      chartLabel: "3D",
      type: [
        {
          label: "3D Bar with Dataset",
          value: "bar3d-dataset",
          asset: getImageURL("dashboard/CustomChartAssets/bar3d-dataset.webp"),
        },
        {
          label: "Bar3D Punch Card",
          value: "bar3d-punchcard",
          asset: getImageURL("dashboard/CustomChartAssets/bar3d-punchcard.webp"),
        },
        {
          label: "3D Scatter with Scatter Matrix",
          value: "scatter3d-scatter-matrix",
          asset: getImageURL("dashboard/CustomChartAssets/scatter3d-scatter-matrix.webp"),
        },
        {
          label: "3D Scatter Dataset",
          value: "scatter3d-dataset",
          asset: getImageURL("dashboard/CustomChartAssets/scatter3D-dataset.webp"),
        },
      ],
    },
  ],
};
