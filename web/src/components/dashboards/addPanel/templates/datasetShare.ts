// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Dataset Share

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const processData = (data) => {
  const source = data.map(item => [item[0], item[1] || 0, item[2] || 0]);
const source = processData(queryResult);
// -----------------------------------------------------------

option = {
  legend: {},
  tooltip: {},
  dataset: {
    source: source
  },
  xAxis: {type: 'category'},
  yAxis: {gridIndex: 0},
  grid: [{bottom: '55%'}, {top: '55%'}],
  series: [
    {type: 'line', seriesLayoutBy: 'row', xAxisIndex: 0, yAxisIndex: 0},
    {type: 'line', seriesLayoutBy: 'row', xAxisIndex: 0, yAxisIndex: 0},
    {type: 'pie', radius: '30%', center: ['50%', '70%']}
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
