export const pictorialBarSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Pictorial Bar Chart - Bar chart with custom symbols
//
// Example Query:
// SELECT
//   category as "x_axis_1",
//   sum(value) as "y_axis_1"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY y_axis_1 DESC

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
    data: xData,
    axisLine: { show: false },
    axisTick: { show: false }
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: false }
  },
  series: [
    {
      name: 'Value',
      type: 'pictorialBar',
      symbol: 'rect',
      barCategoryGap: '-30%',
      data: yData,
      itemStyle: {
        opacity: 0.8
      },
      emphasis: {
        itemStyle: {
          opacity: 1
        }
      }
    }
  ]
};
`;
