// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Grid Responsive Layout

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const processData = (data) => {
  const categories = data.map(item => item[0]);
// -----------------------------------------------------------

  const values = data.map(item => item[1]);
  
  return { categories, values };
};

const { categories, values } = processData(queryResult);

option = {
  tooltip: {
    trigger: 'axis'
  },
  grid: [
    {left: '3%', right: '50%', top: '3%', bottom: '50%'},
    {left: '53%', right: '0%', top: '3%', bottom: '50%'},
    {left: '3%', right: '50%', top: '53%', bottom: '0%'},
    {left: '53%', right: '0%', top: '53%', bottom: '0%'}
  ],
  xAxis: [
    {type: 'category', data: categories, gridIndex: 0},
    {type: 'category', data: categories, gridIndex: 1},
    {type: 'category', data: categories, gridIndex: 2},
    {type: 'category', data: categories, gridIndex: 3}
  ],
  yAxis: [
    {gridIndex: 0},
    {gridIndex: 1},
    {gridIndex: 2},
    {gridIndex: 3}
  ],
  series: [
    {
      type: 'line',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: values,
      smooth: true
    },
    {
      type: 'bar',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: values
    },
    {
      type: 'scatter',
      xAxisIndex: 2,
      yAxisIndex: 2,
      data: values,
      symbolSize: 8
    },
    {
      type: 'line',
      xAxisIndex: 3,
      yAxisIndex: 3,
      data: values,
      areaStyle: {}
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
