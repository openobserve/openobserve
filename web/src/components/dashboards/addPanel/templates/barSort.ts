export const barSort = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Sorted Bar Chart
//
// Example Query:
// SELECT name as "x_axis_1", value as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY y_axis_1 DESC

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

  // Sort data by value
  const sortedIndices = yData.map((_, i) => i).sort((a, b) => yData[b] - yData[a]);
  const sortedXData = sortedIndices.map(i => xData[i]);
  const sortedYData = sortedIndices.map(i => yData[i]);

  return { xData: sortedXData, yData: sortedYData };
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
    
  }]
};
`;
