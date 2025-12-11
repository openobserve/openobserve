// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Dataset Object Array

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const processData = (data) => {
  const dataset = data.map(item => ({
    name: item[0],
    value: item[1] || 0,
    category: item[2] || 'A'
  }));
const dataset = processData(queryResult);
// -----------------------------------------------------------

option = {
  legend: {},
  tooltip: {},
  dataset: {
    source: dataset
  },
  xAxis: {type: 'category'},
  yAxis: {},
  series: [{
    type: 'bar',
    encode: {
      x: 'name',
      y: 'value'
    }
  }]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
