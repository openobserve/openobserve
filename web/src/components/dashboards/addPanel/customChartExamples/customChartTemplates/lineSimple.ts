// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
  histogram(_timestamp) as "x_axis_1",
  count(kubernetes_namespace_name) as "y_axis_1"
FROM "default"
GROUP BY x_axis_1
ORDER BY x_axis_1 ASC`;

// Chart code template
const chartCode = `
// Basic Line Chart

// Example Query:
// SELECT
//   histogram(_timestamp) as "x_axis_1",
//   count(kubernetes_namespace_name) as "y_axis_1"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const xAlias = "x_axis_1";
const yAlias = "y_axis_1";
// -----------------------------------------------------------


// Arrow function to process data
const processData = (chartData, xKey, yKey) => {
  // Ensure data exists and is an array
  if (!chartData || !Array.isArray(chartData)) {
     return { xData: [], yData: [] };
  }
  
  const xData = [];
  const yData = [];
  
  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined) {
      xData.push(row[xKey]);
      yData.push(row[yKey]);
    }
  });
  
  return { xData, yData };
};


// Execute the function with null/empty check for data[0]
// Note: 'data' is a global variable containing the query results.
// We access 'data[0]' because the results are often nested in the first element.
const { xData, yData } = Array.isArray(data) && Array.isArray(data[0])
  ? processData(data[0], xAlias, yAlias)
  : { xData: [], yData: [] };

option = {
  xAxis: {
    type: 'category',
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: yData,
      type: 'line'
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
