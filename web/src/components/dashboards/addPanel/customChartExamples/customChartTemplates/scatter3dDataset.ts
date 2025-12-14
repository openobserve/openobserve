// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT 
  COUNT(DISTINCT kubernetes_pod_name) as x_value,
  COUNT(DISTINCT kubernetes_container_name) as y_value,
  COUNT(*) as z_value,
  COUNT(*) as value
FROM default
GROUP BY kubernetes_namespace_name
LIMIT 100`;

// Chart code template
const chartCode = `
// Scatter3D Dataset

//example query:
// SELECT 
//   COUNT(DISTINCT kubernetes_pod_name) as x_value,
//   COUNT(DISTINCT kubernetes_container_name) as y_value,
//   COUNT(*) as z_value,
//   COUNT(*) as value
// FROM default
// GROUP BY kubernetes_namespace_name
// LIMIT 100

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const xAlias = 'x_value';
const yAlias = 'y_value';
const zAlias = 'z_value';
const valueAlias = 'value';

const processData = (chartData) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }
  
  return chartData.map(item => ({
    x: parseFloat(item[xAlias]) || 0,
    y: parseFloat(item[yAlias]) || 0,
    z: parseFloat(item[zAlias]) || 0,
    value: parseFloat(item[valueAlias]) || 0
  }));
};

const dataset = processData(data[0]);
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
    viewControl: {
      projection: 'orthographic'
    }
  },
  series: [{
    type: 'scatter3D',
    data: dataset.map(d => [d.x, d.y, d.z, d.value]),
    symbolSize: 10
  }]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
