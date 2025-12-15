// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT 
  kubernetes_namespace_name as x_category,
  kubernetes_container_name as y_category,
  COUNT(*) as value
FROM default
GROUP BY kubernetes_namespace_name, kubernetes_container_name
LIMIT 20`;

// Chart code template
const chartCode = `
// Bar3D Dataset

//example query: 
// SELECT 
//   kubernetes_namespace_name as x_category,
//   kubernetes_container_name as y_category,
//   COUNT(*) as value
// FROM default
// GROUP BY kubernetes_namespace_name, kubernetes_container_name
// LIMIT 20

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const xAlias = 'x_category'; // First column: X-axis category
const yAlias = 'y_category'; // Second column: Y-axis category
const zAlias = 'value';      // Third column: Z-axis value (height)

const processData = (chartData) => {
  const xData = chartData.map(item => item[xAlias]);
// -----------------------------------------------------------

  const yData = chartData.map(item => item[yAlias]);
  const zData = chartData.map(item => item[zAlias] ?? 0);
  
  return { xData, yData, zData };
};

// Note: 'data' is a global variable containing the query results.
// We access 'data[0]' because the results are often nested in the first element.
const { xData, yData, zData } = processData(data[0]);

option = {
  tooltip: {},
  visualMap: {
    max: 100,
    inRange: {
      color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
    }
  },
  xAxis3D: {type: 'category', data: xData},
  yAxis3D: {type: 'category', data: yData},
  zAxis3D: {type: 'value'},
  grid3D: {
    boxWidth: 200,
    boxDepth: 80,
    viewControl: {
      projection: 'orthographic'
    }
  },
  series: [{
    type: 'bar3D',
    data: data[0].map((item) => {
      const uniqueX = [...new Set(xData)];
      const uniqueY = [...new Set(yData)];
      const xIndex = uniqueX.indexOf(item[xAlias]);
      const yIndex = uniqueY.indexOf(item[yAlias]);
      return [xIndex, yIndex, item[zAlias] ?? 0];
    }),
    shading: 'lambert',
    label: {
      formatter: (param) => param.value[2]
    },
    emphasis: {
      label: {
        fontSize: 20,
        color: '#900'
      },
      itemStyle: {
        color: '#900'
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
