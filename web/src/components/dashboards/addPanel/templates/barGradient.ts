export const barGradient = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Bar Chart with Gradient
//
// Example Query:
// SELECT category as "x_axis_1", count(*) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY y_axis_1 DESC LIMIT 10

const xAlias = "x_axis_1";
const yAlias = "y_axis_1";

const processData = (chartData, xKey, yKey) => {
  if (!chartData || !Array.isArray(chartData)) return { xData: [], yData: [] };

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

const { xData, yData } = processData(data[0], xAlias, yAlias);

option = {
  xAxis: {
    type: 'category',
    data: xData
  },
  yAxis: { type: 'value' },
  series: [{
    type: 'bar',
    data: yData,
    
    itemStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#83bff6' },
          { offset: 0.5, color: '#188df0' },
          { offset: 1, color: '#188df0' }
        ])
      }
  }]
};
`;
