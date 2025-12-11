// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT x_value, y_value FROM your_table WHERE timestamp >= now() - interval '1 hour' LIMIT 100000`;

// Chart code template
const chartCode = `
// 10M bulk gps points chart

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------
const xAlias = 'x_value'; // First column: X-axis value
const yAlias = 'y_value'; // Second column: Y-axis value

const processData = (chartData) => {
  return chartData.map(item => [item[xAlias] || Math.random() * 100, item[yAlias] || Math.random() * 100]);
};

// Note: 'data' is a global variable containing the query results.
// We access 'data[0]' because the results are often nested in the first element.
const pointsData = processData(data[0]);
// -----------------------------------------------------------

option = {
  tooltip: {},
  xAxis: {type: 'value'},
  yAxis: {type: 'value'},
  series: [{
    type: 'scatterGL',
    data: pointsData,
    symbolSize: 3,
    itemStyle: {
      opacity: 0.4
    },
    progressive: 1e6,
    progressiveThreshold: 1e6
  }]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
