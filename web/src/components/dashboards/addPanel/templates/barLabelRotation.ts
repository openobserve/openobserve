export const barLabelRotation = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Bar with Rotated Labels
//
// Example Query:
// SELECT category as "x_axis_1", count(*) as "y_axis_1" FROM "default" GROUP BY x_axis_1

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
    data: xData,
    axisLabel: { interval: 0, rotate: 45 }
  },
  yAxis: { type: 'value' },
  series: [{
    type: 'bar',
    data: yData,
    
  }]
};
`;
