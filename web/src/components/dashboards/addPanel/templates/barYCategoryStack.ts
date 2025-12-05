export const barYCategoryStack = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Stacked Horizontal Bar Chart
//
// Example Query:
// SELECT category as "y_axis_1", sum(CASE WHEN type = 'A' THEN value END) as "series_1", sum(CASE WHEN type = 'B' THEN value END) as "series_2" FROM "default" GROUP BY y_axis_1

const yAlias = "y_axis_1";
const seriesAliases = ["series_1","series_2"];

const processData = (chartData, yKey, seriesKeys) => {
  if (!chartData || !Array.isArray(chartData)) return { yData: [], seriesData: [] };

  const yData = [];
  const seriesData = seriesKeys.map(key => ({ name: key, type: 'bar', stack: 'total', data: [] }));

  chartData.forEach(row => {
    if (row[yKey] !== undefined) {
      yData.push(row[yKey]);
      seriesKeys.forEach((key, index) => {
        seriesData[index].data.push(row[key] || 0);
      });
    }
  });

  return { yData, seriesData };
};

const { yData, seriesData } = processData(data[0], yAlias, seriesAliases);

option = {
  yAxis: { type: 'category', data: yData },
  xAxis: { type: 'value' },
  series: seriesData
};
`;
