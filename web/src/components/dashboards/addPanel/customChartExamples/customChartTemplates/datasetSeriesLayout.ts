// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT 
  kubernetes_namespace_name as product,
  COUNT(DISTINCT kubernetes_pod_name) as value1,
  COUNT(DISTINCT kubernetes_container_name) as value2,
  COUNT(*) as value3
FROM default
GROUP BY kubernetes_namespace_name
LIMIT 10`;

// Chart code template
const chartCode = `
// Dataset Series Layout

//example query:
// SELECT 
//   kubernetes_namespace_name as product,
//   COUNT(DISTINCT kubernetes_pod_name) as value1,
//   COUNT(DISTINCT kubernetes_container_name) as value2,
//   COUNT(*) as value3
// FROM default
// GROUP BY kubernetes_namespace_name
// LIMIT 10

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const productAlias = 'product';
const value1Alias = 'value1';
const value2Alias = 'value2';
const value3Alias = 'value3';
// -----------------------------------------------------------

const processData = (chartData) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { dimensions: ['product', 'value1', 'value2', 'value3'], source: [] };
  }

  const dimensions = ['product', 'value1', 'value2', 'value3'];
  const source = chartData.map(item => ({
    product: item[productAlias] || 'Unknown',
    value1: parseFloat(item[value1Alias]) || 0,
    value2: parseFloat(item[value2Alias]) || 0,
    value3: parseFloat(item[value3Alias]) || 0
  }));
  
  return { dimensions, source };
};

const { dimensions, source } = processData(data && data.length > 0 ? data[0] : null);

option = {
  legend: {},
  tooltip: {},
  dataset: {
    source: source
  },
  xAxis: [
    { type: 'category', gridIndex: 0 },
    { type: 'category', gridIndex: 1 }
  ],
  yAxis: [
    { gridIndex: 0 },
    { gridIndex: 1 }
  ],
  grid: [
    { bottom: '55%' },
    { top: '55%' }
  ],
  series: [
    // These series are in the first grid
    { type: 'bar', seriesLayoutBy: 'row', xAxisIndex: 0, yAxisIndex: 0 },
    { type: 'bar', seriesLayoutBy: 'row', xAxisIndex: 0, yAxisIndex: 0 },
    { type: 'bar', seriesLayoutBy: 'row', xAxisIndex: 0, yAxisIndex: 0 },
    // These series are in the second grid
    { type: 'bar', xAxisIndex: 1, yAxisIndex: 1 },
    { type: 'bar', xAxisIndex: 1, yAxisIndex: 1 },
    { type: 'bar', xAxisIndex: 1, yAxisIndex: 1 }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
