// Pure Apache ECharts Examples
// Source: https://github.com/apache/echarts-examples
// All code is extracted verbatim from the official repository

// Mapping of chart values to their template file paths for lazy loading
const templateMap: Record<string, () => Promise<any>> = {
  // Basic Line Chart (Reference)
  "line-simple": () => import("./templates/lineSimple"),
  
  // Line Charts
  "area-stack-gradient": () => import("./templates/areaStackGradient"),
  "confidence-band": () => import("./templates/confidenceBand"),
  "multiple-x-axis": () => import("./templates/multipleXAxis"),
  "intraday-breaks-1": () => import("./templates/intradayBreaks1"),
  "intraday-breaks-2": () => import("./templates/intradayBreaks2"),
  "line-fisheye-lens": () => import("./templates/lineFisheyeLens"),
  
  // Bar Charts
  "bar-race": () => import("./templates/barRace"),
  "bar-multi-drilldown": () => import("./templates/barMultiDrilldown"),
  "bar-breaks-brush": () => import("./templates/barBreaksBrush"),
  "bar-stack-normalization": () => import("./templates/barStackNormalization"),
  "bar-polar-stack-radial": () => import("./templates/barPolarStackRadial"),
  
  // Pie Charts
  "pie-border-radius": () => import("./templates/pieBorderRadius"),
  "data-transform-multiple-pie": () => import("./templates/dataTransformMultiplePie"),
  "map-iceland-pie": () => import("./templates/mapIcelandPie"),
  
  // Scatter Charts
  "scatter-matrix": () => import("./templates/scatterMatrix"),
  "bubble-gradient": () => import("./templates/bubbleGradient"),
  "scatter-polar-punchcard": () => import("./templates/scatterPolarPunchCard"),
  "scatter-nebula": () => import("./templates/scatterNebula"),
  "scatter-polynomial-regression": () => import("./templates/scatterPolynomialRegression"),
  "scatter-clustering-process": () => import("./templates/scatterClusteringProcess"),
  "scatter-jitter": () => import("./templates/scatterJitter"),
  
  // GEO/Map Charts
  "map-bar-morph": () => import("./templates/mapBarMorph"),
  "geo-seatmap-flight": () => import("./templates/geoSeatmapFlight"),
  "map-usa": () => import("./templates/mapUsa"),
  
  // Candlestick Charts
  "candlestick-brush": () => import("./templates/candlestickBrush"),
  "candlestick-large": () => import("./templates/candlestickLarge"),
  "candlestick-touch": () => import("./templates/candlestickTouch"),
  
  // Radar Charts
  "radar-custom": () => import("./templates/radarCustom"),
  "radar-multiple-2": () => import("./templates/radarMultiple2"),
  
  // Boxplot Charts
  "boxplot-multi": () => import("./templates/boxplotMulti"),
  "data-transform-aggregate": () => import("./templates/dataTransformAggregate"),
  
  // Heatmap Charts
  "heatmap-large": () => import("./templates/heatmapLarge"),
  "calendar-heatmap": () => import("./templates/calendarHeatmap"),
  "heatmap-large-piecewise": () => import("./templates/heatmapLargePiecewise"),
  
  // Graph Charts
  "graph-on-cartesian": () => import("./templates/graph"),
  "graph-npm": () => import("./templates/graphNpm"),
  "graph-life-expectancy": () => import("./templates/graphLifeExpectancy"),
  "graph-grid": () => import("./templates/graphGrid"),
  "calendar-graph": () => import("./templates/calendarGraph"),
  
  // Tree Charts
  "tree-radial": () => import("./templates/treeRadial"),
  "tree-polyline": () => import("./templates/treePolyline"),
  "tree-legend": () => import("./templates/treeLegend"),
  
  // Treemap Charts
  "treemap-chart": () => import("./templates/treemapChart"),
  "treemap-disk": () => import("./templates/treemapDisk"),
  "treemap-visual": () => import("./templates/treemapVisual"),
  
  // Sunburst Charts
  "sunburst-border-radius": () => import("./templates/sunburstBorderRadius"),
  "sunburst-monochrome": () => import("./templates/sunburstMonochrome"),
  "sunburst-visualmap": () => import("./templates/sunburstVisualMap"),
  
  // Sankey Charts
  "sankey-levels": () => import("./templates/sankeyLevels"),
  "sankey-energy": () => import("./templates/sankeyEnergy"),
  "sankey-node-align-left": () => import("./templates/sankeyNodeAlignLeft"),
  "sankey-itemstyle": () => import("./templates/sankeyItemstyle"),
  
  // Parallel Charts
  "parallel-aqi": () => import("./templates/parallelAqi"),
  "parallel-nutrients": () => import("./templates/parallelNutrients"),
  
  // Funnel Charts
  "funnel-customize": () => import("./templates/funnelCustomize"),
  "funnel-mutiple": () => import("./templates/funnelMutiple"),
  
  // Gauge Charts
  "gauge-multi-title": () => import("./templates/gaugeMultiTitle"),
  "gauge-car": () => import("./templates/gaugeCar"),
  "gauge-ring": () => import("./templates/gaugeRing"),
  
  // PictorialBar Charts
  "pictorialbar-bar-transition": () => import("./templates/pictorialBarBarTransition"),
  "pictorialbar-vehicle": () => import("./templates/pictorialBarVehicle"),
  
  // Matrix Charts
  "matrix-stock-application": () => import("./templates/matrixStockApplication"),
  "scatter-correlation-matrix": () => import("./templates/scatterCorrelationMatrix"),
  "grid-responsive-layout": () => import("./templates/gridResponsiveLayout"),
  "matrix-simple": () => import("./templates/matrixSimple"),
  
  // Custom Charts
  "custom-wind-barb": () => import("./templates/customWindBarb"),
  "custom-flame-graph": () => import("./templates/customFlameGraph"),
  "custom-circle-packing": () => import("./templates/customCirclePacking"),
  "custom-spiral-race": () => import("./templates/customSpiralRace"),
  
  // Dataset Charts
  "dataset-partition-pies": () => import("./templates/datasetPartitionPies"),
  "dataset-series-layout": () => import("./templates/datasetSeriesLayout"),
  "dataset-object-array": () => import("./templates/datasetObjectArray"),
  "dataset-share": () => import("./templates/datasetShare"),
  
  // 3D Charts
  "bar3d-dataset": () => import("./templates/bar3dDataset"),
  "bar3d-punchcard": () => import("./templates/bar3dPunchCard"),
  "globe-atmosphere": () => import("./templates/globeAtmosphere"),
  "globe-displacement": () => import("./templates/globeDisplacement"),
  "scatter3d-scatter-matrix": () => import("./templates/scatter3dScatterMatrix"),
  "scatter3d-dataset": () => import("./templates/scatter3dDataset"),
  "globe-orthographic": () => import("./templates/globeOrthographic"),
  "globe-flights": () => import("./templates/globeFlights"),
  "scattergl-large-points": () => import("./templates/scatterglLargePoints"),
  "graphgl-gpu-layout": () => import("./templates/graphglGpuLayout"),
};

/**
 * Lazily loads a custom chart template by its value key
 * @param chartValue - The chart value identifier (e.g., 'line-simple', 'area-stack-gradient')
 * @returns Promise resolving to the template object with code and query
 */
export async function loadCustomChartTemplate(chartValue: string): Promise<{
  code: string;
  query: string;
} | null> {
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
