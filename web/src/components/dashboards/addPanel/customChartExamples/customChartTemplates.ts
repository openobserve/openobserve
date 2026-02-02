// Interface for custom chart template modules
export interface CustomChartTemplateModule {
  code: string;
  query: string;
}
// Pure Apache ECharts Examples
// Source: https://github.com/apache/echarts-examples
// All code is extracted verbatim from the official repository

// Mapping of chart values to their template file paths for lazy loading
const templateMap: Record<string, () => Promise<any>> = {
  // Basic Line Chart (Reference)
  "line-simple": () => import("./customChartTemplates/lineSimple"),
  
  // Line Charts
  "confidence-band": () => import("./customChartTemplates/confidenceBand"),
  "multiple-x-axis": () => import("./customChartTemplates/multipleXAxis"),
  "intraday-breaks-1": () => import("./customChartTemplates/intradayBreaks1"),
  
  // Bar Charts
  "bar-race": () => import("./customChartTemplates/barRace"),
  "bar-stack-normalization": () => import("./customChartTemplates/barStackNormalization"),
  "bar-polar-stack-radial": () => import("./customChartTemplates/barPolarStackRadial"),
  
  // Pie Charts
  "pie-border-radius": () => import("./customChartTemplates/pieBorderRadius"),
  "data-transform-multiple-pie": () => import("./customChartTemplates/dataTransformMultiplePie"),
  
  // Scatter Charts
  "scatter-matrix": () => import("./customChartTemplates/scatterMatrix"),
  "scatter-polynomial-regression": () => import("./customChartTemplates/scatterPolynomialRegression"),
  
  // Radar Charts
  "radar-custom": () => import("./customChartTemplates/radarCustom"),
  "radar-multiple-2": () => import("./customChartTemplates/radarMultiple2"),
  
  // Boxplot Charts
  "data-transform-aggregate": () => import("./customChartTemplates/dataTransformAggregate"),
  
  // Graph Charts
  "graph-on-cartesian": () => import("./customChartTemplates/graph"),
  
  // Treemap Charts
  "treemap-chart": () => import("./customChartTemplates/treemapChart"),

  // Funnel Charts
  "funnel-customize": () => import("./customChartTemplates/funnelCustomize"),
  
  // Dataset Charts
  "dataset-series-layout": () => import("./customChartTemplates/datasetSeriesLayout"),
  
  // 3D Charts
  "bar3d-dataset": () => import("./customChartTemplates/bar3dDataset"),
  "bar3d-punchcard": () => import("./customChartTemplates/bar3dPunchCard"),
  "scatter3d-scatter-matrix": () => import("./customChartTemplates/scatter3dScatterMatrix"),
  "scatter3d-dataset": () => import("./customChartTemplates/scatter3dDataset"),
};

/**
 * Lazily loads a custom chart template by its value key
 * @param chartValue - The chart value identifier (e.g., 'line-simple', 'confidence-band')
 * @returns Promise resolving to the template object with code and query
 */
export async function loadCustomChartTemplate(chartValue: string): Promise<CustomChartTemplateModule | null> {
  const loader = templateMap[chartValue];
  
  if (!loader) {
    console.warn(`Template not found for chart value: ${chartValue}`);
    return null;
  }
  
  try {
    const module = await loader();
    // The template module exports customChartExample object with code and query
    return module.customChartExample;
  } catch (error) {
    console.error(`Error loading template for ${chartValue}:`, error);
    return null;
  }
}
