export const areaBasic = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Basic Area Chart - Simple area chart with filled region
//
// Example Query:
// SELECT
//   date_field as "x_axis_1",
//   sum(value) as "y_axis_1"
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
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: yData,
      type: 'line',
      areaStyle: {}
    }
  ]
};
`;
