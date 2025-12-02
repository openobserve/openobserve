export const areaPieces = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Area Chart with Pieces - Shows highlighted regions based on data ranges
//
// Example Query:
// SELECT
//   histogram(_timestamp) as "x_axis_1",
//   avg(cpu_usage) as "y_axis_1"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for the X-axis (e.g., time, category)
const xAlias = "x_axis_1";

// 'yAlias' should match the column name for the Y-axis (e.g., count, value)
const yAlias = "y_axis_1";

// Arrow function to process data
const processData = (chartData, xKey, yKey) => {
  // Ensure data exists and is an array
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
    type: 'value',
    boundaryGap: [0, '30%']
  },
  visualMap: {
    type: 'piecewise',
    show: false,
    dimension: 0,
    seriesIndex: 0,
    pieces: [
      {
        gt: 1,
        lt: 3,
        color: 'rgba(0, 0, 180, 0.4)'
      },
      {
        gt: 5,
        lt: 7,
        color: 'rgba(0, 0, 180, 0.4)'
      }
    ]
  },
  series: [
    {
      type: 'line',
      smooth: 0.6,
      symbol: 'none',
      lineStyle: {
        color: '#5470C6',
        width: 5
      },
      markLine: {
        symbol: ['none', 'none'],
        label: { show: false },
        data: [{ xAxis: 1 }, { xAxis: 3 }, { xAxis: 5 }, { xAxis: 7 }]
      },
      areaStyle: {},
      data: yData
    }
  ]
};
`;
