export const areaMultiple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Multiple Area Chart - Display multiple area series
//
// Example Query:
// SELECT
//   histogram(_timestamp) as "x_axis_1",
//   avg(metric1) as "series_1",
//   avg(metric2) as "series_2",
//   avg(metric3) as "series_3"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for the X-axis
const xAlias = "x_axis_1";

// 'seriesAliases' should be an array of column names for each series
const seriesAliases = ["series_1", "series_2", "series_3"];

// Arrow function to process multiple series data
const processData = (chartData, xKey, seriesKeys) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { xData: [], seriesData: [] };
  }

  const xData = [];
  const seriesData = seriesKeys.map(() => []);

  chartData.forEach(row => {
    if (row[xKey] !== undefined) {
      xData.push(row[xKey]);

      seriesKeys.forEach((key, index) => {
        seriesData[index].push(row[key] || 0);
      });
    }
  });

  return { xData, seriesData };
};

// Execute the function
const { xData, seriesData } = processData(data[0], xAlias, seriesAliases);

// Generate series configuration
const series = seriesAliases.map((alias, index) => ({
  name: alias,
  type: 'line',
  data: seriesData[index],
  areaStyle: {},
  smooth: true,
  emphasis: {
    focus: 'series'
  }
}));

option = {
  legend: {
    data: seriesAliases
  },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: series
};
`;
