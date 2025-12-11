// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Scatter Correlation Matrix

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const processData = (data) => {
  const dimensions = ['dim1', 'dim2', 'dim3', 'dim4'];
// -----------------------------------------------------------

  const values = data.map(item => [item[0], item[1], item[2], item[3]]);
  
  return { dimensions, values };
};

const { dimensions, values } = processData(queryResult);

option = {
  tooltip: {
    position: 'top'
  },
  grid: [
    {left: '10%', top: '10%', width: '20%', height: '20%'},
    {right: '10%', top: '10%', width: '20%', height: '20%'},
    {left: '10%', bottom: '10%', width: '20%', height: '20%'},
    {right: '10%', bottom: '10%', width: '20%', height: '20%'}
  ],
  xAxis: [
    {gridIndex: 0, type: 'value'},
    {gridIndex: 1, type: 'value'},
    {gridIndex: 2, type: 'value'},
    {gridIndex: 3, type: 'value'}
  ],
  yAxis: [
    {gridIndex: 0, type: 'value'},
    {gridIndex: 1, type: 'value'},
    {gridIndex: 2, type: 'value'},
    {gridIndex: 3, type: 'value'}
  ],
  series: [
    {
      type: 'scatter',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: values.map(v => [v[0], v[1]]),
      symbolSize: 5
    },
    {
      type: 'scatter',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: values.map(v => [v[1], v[2]]),
      symbolSize: 5
    },
    {
      type: 'scatter',
      xAxisIndex: 2,
      yAxisIndex: 2,
      data: values.map(v => [v[2], v[3]]),
      symbolSize: 5
    },
    {
      type: 'scatter',
      xAxisIndex: 3,
      yAxisIndex: 3,
      data: values.map(v => [v[0], v[3]]),
      symbolSize: 5
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
