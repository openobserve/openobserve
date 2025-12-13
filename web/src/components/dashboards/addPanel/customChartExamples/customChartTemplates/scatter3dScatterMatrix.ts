// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT 
  COUNT(DISTINCT kubernetes_pod_name) as x_value,
  COUNT(DISTINCT kubernetes_container_name) as y_value,
  COUNT(*) as z_value
FROM default
GROUP BY kubernetes_namespace_name
LIMIT 100`;

// Chart code template
const chartCode = `
// Scatter3D Scatter Matrix

// Example Query:
// SELECT 
//   COUNT(DISTINCT kubernetes_pod_name) as x_value,
//   COUNT(DISTINCT kubernetes_container_name) as y_value,
//   COUNT(*) as z_value
// FROM default
// GROUP BY kubernetes_namespace_name
// LIMIT 100

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const xAlias = 'x_value'; // First column: X-axis value
const yAlias = 'y_value'; // Second column: Y-axis value
const zAlias = 'z_value'; // Third column: Z-axis value

const processData = (chartData) => {
  return chartData.map(item => [item[xAlias] || 0, item[yAlias] || 0, item[zAlias] || 0]);
};

// Note: 'data' is a global variable containing the query results.
// We access 'data[0]' because the results are often nested in the first element.
const scatterData = processData(data[0]);
// -----------------------------------------------------------

option = {
  tooltip: {},
  visualMap: {
    max: 100,
    inRange: {
      color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
    }
  },
  xAxis3D: {type: 'value'},
  yAxis3D: {type: 'value'},
  zAxis3D: {type: 'value'},
  grid3D: {
    boxWidth: 100,
    boxDepth: 100,
    boxHeight: 100,
    viewControl: {
      projection: 'orthographic'
    }
  },
  series: [{
    type: 'scatter3D',
    data: scatterData,
    symbolSize: 12,
    itemStyle: {
      borderWidth: 0.5,
      borderColor: 'rgba(255,255,255,0.8)'
    },
    emphasis: {
      itemStyle: {
        color: '#fff'
      }
    }
  }]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
