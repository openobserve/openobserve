// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Matrix Simple

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const processData = (data) => {
  const xAxisData = data.map(item => item[0]);
// -----------------------------------------------------------

  const yAxisData = data.map(item => item[1]);
  
  return { xAxisData, yAxisData };
};

const { xAxisData, yAxisData } = processData(queryResult);

option = {
  grid: [
    {left: '5%', right: '50%', top: '5%', bottom: '50%'},
    {left: '55%', right: '0%', top: '5%', bottom: '50%'},
    {left: '5%', right: '50%', top: '55%', bottom: '0%'},
    {left: '55%', right: '0%', top: '55%', bottom: '0%'}
  ],
  xAxis: [
    {type: 'category', data: xAxisData, gridIndex: 0},
    {type: 'category', data: xAxisData, gridIndex: 1},
    {type: 'category', data: xAxisData, gridIndex: 2},
    {type: 'category', data: xAxisData, gridIndex: 3}
  ],
  yAxis: [
    {gridIndex: 0},
    {gridIndex: 1},
    {gridIndex: 2},
    {gridIndex: 3}
  ],
  series: [
    {type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: yAxisData},
    {type: 'bar', xAxisIndex: 1, yAxisIndex: 1, data: yAxisData},
    {type: 'line', xAxisIndex: 2, yAxisIndex: 2, data: yAxisData, areaStyle: {}},
    {type: 'scatter', xAxisIndex: 3, yAxisIndex: 3, data: yAxisData}
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
