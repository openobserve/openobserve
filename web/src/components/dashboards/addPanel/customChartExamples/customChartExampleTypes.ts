import type { I18nKey } from "@/types/i18n";

import { getImageURL } from "@/utils/zincutils";

export interface ChartType {
  /**
   * i18n KEY for the example's display name, not the English text — this module
   * is a plain, module-scope constant with no `t()` in reach, so resolving here
   * would freeze the copy at whatever locale was active on import. The consumer
   * (CustomChartTypeSelector.vue) calls `t(labelKey)` at render time instead.
   */
  labelKey: I18nKey;
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
          labelKey: "dashboard.customChartTypeSelector.examples.basicLineChart",
          value: "line-simple",
          asset: getImageURL("dashboard/CustomChartAssets/line-simple.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.confidenceBand",
          value: "confidence-band",
          asset: getImageURL("dashboard/CustomChartAssets/confidence-band.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.multipleXAxes",
          value: "multiple-x-axis",
          asset: getImageURL("dashboard/CustomChartAssets/multiple-x-axis.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.intradayLineBreaks1",
          value: "intraday-breaks-1",
          asset: getImageURL("dashboard/CustomChartAssets/intraday-breaks-1.webp"),
        },
      ],
    },
    {
      chartLabel: "Bar",
      type: [
        {
          labelKey: "dashboard.customChartTypeSelector.examples.barRace",
          value: "bar-race",
          asset: getImageURL("dashboard/CustomChartAssets/bar-race.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.stackedBarNormalization",
          value: "bar-stack-normalization",
          asset: getImageURL("dashboard/CustomChartAssets/bar-stack-normalization.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.stackedRadialBarPolar",
          value: "bar-polar-stack-radial",
          asset: getImageURL("dashboard/CustomChartAssets/bar-polar-stack-radial.webp"),
        },
      ],
    },
    {
      chartLabel: "Pie",
      type: [
        {
          labelKey: "dashboard.customChartTypeSelector.examples.pieWithBorder",
          value: "pie-border-radius",
          asset: getImageURL("dashboard/CustomChartAssets/pie-border-radius.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.partitionDataToPies",
          value: "data-transform-multiple-pie",
          asset: getImageURL("dashboard/CustomChartAssets/data-transform-multiple-pie.webp"),
        },
      ],
    },
    {
      chartLabel: "Scatter",
      type: [
        {
          labelKey: "dashboard.customChartTypeSelector.examples.scatterMatrix",
          value: "scatter-matrix",
          asset: getImageURL("dashboard/CustomChartAssets/scatter-matrix.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.scatterPolynomialRegression",
          value: "scatter-polynomial-regression",
          asset: getImageURL("dashboard/CustomChartAssets/scatter-polynomial-regression.webp"),
        },
      ],
    },
    {
      chartLabel: "Radar",
      type: [
        {
          labelKey: "dashboard.customChartTypeSelector.examples.customizedRadarChart",
          value: "radar-custom",
          asset: getImageURL("dashboard/CustomChartAssets/radar-custom.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.multipleRadar",
          value: "radar-multiple-2",
          asset: getImageURL("dashboard/CustomChartAssets/radar-multiple-2.webp"),
        },
      ],
    },
    {
      chartLabel: "Boxplot",
      type: [
        {
          labelKey: "dashboard.customChartTypeSelector.examples.dataTransformSimpleAggregate",
          value: "data-transform-aggregate",
          asset: getImageURL("dashboard/CustomChartAssets/data-transform-aggregate.webp"),
        },
      ],
    },
    {
      chartLabel: "Graph",
      type: [
        {
          labelKey: "dashboard.customChartTypeSelector.examples.graphOnCartesian",
          value: "graph-on-cartesian",
          asset: getImageURL("dashboard/CustomChartAssets/graph-on-cartesian.webp"),
        },
      ],
    },
    {
      chartLabel: "Treemap",
      type: [
        {
          labelKey: "dashboard.customChartTypeSelector.examples.treemapChart",
          value: "treemap-chart",
          asset: getImageURL("dashboard/CustomChartAssets/treemap-chart.webp"),
        },
      ],
    },
    {
      chartLabel: "Funnel",
      type: [
        {
          labelKey: "dashboard.customChartTypeSelector.examples.customizedFunnel",
          value: "funnel-customize",
          asset: getImageURL("dashboard/CustomChartAssets/funnel-customize.webp"),
        },
      ],
    },
    {
      chartLabel: "Dataset",
      type: [
        {
          labelKey: "dashboard.customChartTypeSelector.examples.seriesLayout",
          value: "dataset-series-layout",
          asset: getImageURL("dashboard/CustomChartAssets/dataset-series-layout.webp"),
        },
      ],
    },
    {
      chartLabel: "3D",
      type: [
        {
          labelKey: "dashboard.customChartTypeSelector.examples.threeDBarWithDataset",
          value: "bar3d-dataset",
          asset: getImageURL("dashboard/CustomChartAssets/bar3d-dataset.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.bar3dPunchCard",
          value: "bar3d-punchcard",
          asset: getImageURL("dashboard/CustomChartAssets/bar3d-punchcard.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.threeDScatterWithScatterMatrix",
          value: "scatter3d-scatter-matrix",
          asset: getImageURL("dashboard/CustomChartAssets/scatter3d-scatter-matrix.webp"),
        },
        {
          labelKey: "dashboard.customChartTypeSelector.examples.threeDScatterDataset",
          value: "scatter3d-dataset",
          asset: getImageURL("dashboard/CustomChartAssets/scatter3D-dataset.webp"),
        },
      ],
    },
  ],
};
