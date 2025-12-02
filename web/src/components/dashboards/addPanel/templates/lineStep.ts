export const lineStep = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Step Line Chart - Shows data with step-like transitions
//
// Example Query:
// SELECT
//   histogram(_timestamp) as "x_axis_1",
//   count(*) as "y_axis_1"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for the X-axis
const xAlias = "x_axis_1";

// 'yAlias' should match the column name for the Y-axis
const yAlias = "y_axis_1";

// Arrow function to process data
const processData = (chartData, xKey, yKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { xData: [], yData: [] };
  }

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

// Execute the function
const { xData, yData } = processData(data[0], xAlias, yAlias);

option = {
  title: {
    text: 'Step Line'
  },
  tooltip: {
    trigger: 'axis'
  },
  xAxis: {
    type: 'category',
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: yData,
      type: 'line',
      step: 'start'
    }
  ]
};
`;
