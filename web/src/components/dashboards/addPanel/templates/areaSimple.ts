export const areaSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Large Scale Area Chart - Optimized for displaying large datasets with zoom
//
// Example Query:
// SELECT
//   _timestamp as "x_axis_1",
//   count(*) as "y_axis_1"
// FROM "default"
// WHERE _timestamp >= now() - interval '7 days'
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
  tooltip: {
    trigger: 'axis',
    position: function (pt) {
      return [pt[0], '10%'];
    }
  },
  title: {
    left: 'center',
    text: 'Large Area Chart'
  },
  toolbox: {
    feature: {
      dataZoom: {
        yAxisIndex: 'none'
      },
      restore: {},
      saveAsImage: {}
    }
  },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: xData
  },
  yAxis: {
    type: 'value',
    boundaryGap: [0, '100%']
  },
  dataZoom: [
    {
      type: 'inside',
      start: 0,
      end: 10
    },
    {
      start: 0,
      end: 10
    }
  ],
  series: [
    {
      name: 'Data',
      type: 'line',
      symbol: 'none',
      sampling: 'lttb',
      itemStyle: {
        color: 'rgb(255, 70, 131)'
      },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          {
            offset: 0,
            color: 'rgb(255, 158, 68)'
          },
          {
            offset: 1,
            color: 'rgb(255, 70, 131)'
          }
        ])
      },
      data: yData
    }
  ]
};
`;
