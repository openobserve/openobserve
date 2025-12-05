export const barLine = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Bar + Line Chart - Combination of bar and line series
//
// Example Query:
// SELECT
//   category as "x_axis_1",
//   sum(count) as "bar_series",
//   avg(value) as "line_series"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for the X-axis
const xAlias = "x_axis_1";

// 'barAlias' should match the column name for the bar series
const barAlias = "bar_series";

// 'lineAlias' should match the column name for the line series
const lineAlias = "line_series";

// Arrow function to process data
const processData = (chartData, xKey, barKey, lineKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { xData: [], barData: [], lineData: [] };
  }

  const xData = [];
  const barData = [];
  const lineData = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined) {
      xData.push(row[xKey]);
      barData.push(row[barKey] || 0);
      lineData.push(row[lineKey] || 0);
    }
  });

  return { xData, barData, lineData };
};

// Execute the function
const { xData, barData, lineData } = processData(data[0], xAlias, barAlias, lineAlias);

option = {
  xAxis: {
    type: 'category',
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      name: 'Bar',
      data: barData,
      type: 'bar'
    },
    {
      name: 'Line',
      data: lineData,
      type: 'line',
      smooth: true
    }
  ]
};
`;
