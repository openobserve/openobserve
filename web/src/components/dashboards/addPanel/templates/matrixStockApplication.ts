// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Matrix Stock Application

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
  tooltip: {
    trigger: 'axis'
  },
  grid: [
    { left: '7%', top: '7%', width: '38%', height: '38%' },
    { right: '7%', top: '7%', width: '38%', height: '38%' },
    { left: '7%', bottom: '7%', width: '38%', height: '38%' },
    { right: '7%', bottom: '7%', width: '38%', height: '38%' }
  ],
  xAxis: [
    { type: 'category', data: xAxisData.slice(0, 10), gridIndex: 0 },
    { type: 'category', data: xAxisData.slice(0, 10), gridIndex: 1 },
    { type: 'category', data: xAxisData.slice(0, 10), gridIndex: 2 },
    { type: 'category', data: xAxisData.slice(0, 10), gridIndex: 3 }
  ],
  yAxis: [
    { gridIndex: 0 },
    { gridIndex: 1 },
    { gridIndex: 2 },
    { gridIndex: 3 }
  ],
  series: [
    {
      name: 'Stock 1',
      type: 'line',
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: yAxisData.slice(0, 10)
    },
    {
      name: 'Stock 2',
      type: 'line',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: yAxisData.slice(10, 20)
    },
    {
      name: 'Stock 3',
      type: 'line',
      xAxisIndex: 2,
      yAxisIndex: 2,
      data: yAxisData.slice(20, 30)
    },
    {
      name: 'Stock 4',
      type: 'line',
      xAxisIndex: 3,
      yAxisIndex: 3,
      data: yAxisData.slice(30, 40)
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
