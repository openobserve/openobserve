export const barMultiple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Multiple Bar Chart - Display multiple bar series side by side
//
// Example Query:
// SELECT
//   category as "x_axis_1",
//   sum(value1) as "series_1",
//   sum(value2) as "series_2",
//   sum(value3) as "series_3"
// FROM "default"
// GROUP BY x_axis_1

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
  type: 'bar',
  data: seriesData[index]
}));

option = {
  legend: {
    data: seriesAliases
  },
  xAxis: {
    type: 'category',
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: series
};
`;
