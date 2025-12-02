export const barYCategory = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Horizontal Bar Chart - Shows bars horizontally (Y-axis as categories)
//
// Example Query:
// SELECT
//   country as "y_axis_1",
//   sum(population) as "x_axis_1"
// FROM "default"
// GROUP BY y_axis_1
// ORDER BY x_axis_1 DESC
// LIMIT 10

// 'yAlias' should match the column name for the Y-axis (categories)
const yAlias = "y_axis_1";

// 'xAlias' should match the column name for the X-axis (values)
const xAlias = "x_axis_1";

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
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    }
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  xAxis: {
    type: 'value',
    boundaryGap: [0, 0.01]
  },
  yAxis: {
    type: 'category',
    data: yData
  },
  series: [
    {
      type: 'bar',
      data: xData
    }
  ]
};
`;
