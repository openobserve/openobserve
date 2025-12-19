// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT histogram(_timestamp) as "x_axis_1", kubernetes_namespace_name as "y_axis_1", count(kubernetes_container_name) as "z_axis_1" FROM "default" GROUP BY x_axis_1,y_axis_1 ORDER BY x_axis_1 ASC`;

// Chart code template
const chartCode = `
// Scatter Matrix

// Example Query:
// SELECT histogram(_timestamp) as "x_axis_1", kubernetes_namespace_name as "y_axis_1", count(kubernetes_container_name) as "z_axis_1" FROM "default" GROUP BY x_axis_1,y_axis_1 ORDER BY x_axis_1 ASC

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const dim1Alias = "dim1";
const dim2Alias = "dim2";
const dim3Alias = "dim3";
// -----------------------------------------------------------


const processData = (chartData, dim1Key, dim2Key, dim3Key) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { dim1: [], dim2: [], dim3: [] };
  }

  const dim1 = [];
  const dim2 = [];
  const dim3 = [];

  chartData.forEach(row => {
    if (
      row[dim1Key] !== undefined &&
      row[dim2Key] !== undefined &&
      row[dim3Key] !== undefined
    ) {
      dim1.push(row[dim1Key]);
      dim2.push(row[dim2Key]);
      dim3.push(row[dim3Key]);
    }
  });

  return { dim1, dim2, dim3 };
};

const { dim1, dim2, dim3 } = processData(data[0], dim1Alias, dim2Alias, dim3Alias);

const dimensions = [dim1, dim2, dim3];
const dimNames = [dim1Alias, dim2Alias, dim3Alias];

option = {
  grid: [
    { left: '7%', top: '7%', width: '38%', height: '38%' },
    { right: '7%', top: '7%', width: '38%', height: '38%' },
    { left: '7%', bottom: '7%', width: '38%', height: '38%' },
    { right: '7%', bottom: '7%', width: '38%', height: '38%' }
  ],
  tooltip: {
    trigger: 'item'
  },
  xAxis: [
    { gridIndex: 0, name: dimNames[0] },
    { gridIndex: 1, name: dimNames[1] },
    { gridIndex: 2, name: dimNames[0] },
    { gridIndex: 3, name: dimNames[1] }
  ],
  yAxis: [
    { gridIndex: 0, name: dimNames[1] },
    { gridIndex: 1, name: dimNames[2] },
    { gridIndex: 2, name: dimNames[2] },
    { gridIndex: 3, name: dimNames[2] }
  ],
  series: [
    {
      type: 'scatter',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: dimensions[0].map((v, i) => [v, dimensions[1][i]])
    },
    {
      type: 'scatter',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: dimensions[1].map((v, i) => [v, dimensions[2][i]])
    },
    {
      type: 'scatter',
      xAxisIndex: 2,
      yAxisIndex: 2,
      data: dimensions[0].map((v, i) => [v, dimensions[2][i]])
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
