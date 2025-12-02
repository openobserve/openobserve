export const scatterSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Basic Scatter Chart - Shows data points in 2D space
//
// Example Query:
// SELECT
//   response_time as "x_axis_1",
//   request_size as "y_axis_1"
// FROM "default"
// LIMIT 1000

// 'xAlias' should match the column name for the X-axis
const xAlias = "x_axis_1";

// 'yAlias' should match the column name for the Y-axis
const yAlias = "y_axis_1";

// Arrow function to process data
const processData = (chartData, xKey, yKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { scatterData: [] };
  }

  const scatterData = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined) {
      scatterData.push([row[xKey], row[yKey]]);
    }
  });

  return { scatterData };
};

// Execute the function
const { scatterData } = processData(data[0], xAlias, yAlias);

option = {
  xAxis: {
    type: 'value'
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      symbolSize: 8,
      data: scatterData,
      type: 'scatter'
    }
  ]
};
`;
