export const lineArea = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Line + Area Chart - Combination of line and area series
//
// Example Query:
// SELECT
//   histogram(_timestamp) as "x_axis_1",
//   count(*) as "line_series",
//   avg(value) as "area_series"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for the X-axis
const xAlias = "x_axis_1";

// 'lineAlias' should match the column name for the line series
const lineAlias = "line_series";

// 'areaAlias' should match the column name for the area series
const areaAlias = "area_series";

// Arrow function to process data
const processData = (chartData, xKey, lineKey, areaKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { xData: [], lineData: [], areaData: [] };
  }

  const xData = [];
  const lineData = [];
  const areaData = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined) {
      xData.push(row[xKey]);
      lineData.push(row[lineKey] || 0);
      areaData.push(row[areaKey] || 0);
    }
  });

  return { xData, lineData, areaData };
};

// Execute the function
const { xData, lineData, areaData } = processData(data[0], xAlias, lineAlias, areaAlias);

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
      name: 'Line',
      data: lineData,
      type: 'line',
      smooth: true
    },
    {
      name: 'Area',
      data: areaData,
      type: 'line',
      areaStyle: {},
      smooth: true
    }
  ]
};
`;
