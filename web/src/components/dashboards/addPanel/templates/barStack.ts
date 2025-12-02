export const barStack = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Stacked Bar Chart - Shows multiple series stacked vertically
//
// Example Query:
// SELECT
//   histogram(_timestamp) as "x_axis_1",
//   sum(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as "series_1",
//   sum(CASE WHEN status = 'warning' THEN 1 ELSE 0 END) as "series_2",
//   sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as "series_3"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for the X-axis
const xAlias = "x_axis_1";

// 'yAliases' should be an array of column names for the Y-axis series
const yAliases = ["series_1", "series_2", "series_3"];

// Arrow function to process data
const processData = (chartData, xKey, yKeys) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { xData: [], seriesData: [] };
  }

  const xData = [];
  const seriesData = yKeys.map(key => ({
    name: key,
    type: 'bar',
    stack: 'total',
    emphasis: {
      focus: 'series'
    },
    data: []
  }));

  chartData.forEach(row => {
    if (row[xKey] !== undefined) {
      xData.push(row[xKey]);
      yKeys.forEach((key, index) => {
        if (row[key] !== undefined) {
          seriesData[index].data.push(row[key]);
        } else {
          seriesData[index].data.push(0);
        }
      });
    }
  });

  return { xData, seriesData };
};

// Execute the function
const { xData, seriesData } = processData(data[0], xAlias, yAliases);

option = {
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    }
  },
  legend: {
    data: yAliases
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  xAxis: {
    type: 'category',
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: seriesData
};
`;
