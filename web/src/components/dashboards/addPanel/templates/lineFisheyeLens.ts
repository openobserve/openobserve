// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
histogram(_timestamp) as "x_axis_1",
count(*) as "y_axis_1"
FROM "default"
GROUP BY x_axis_1
ORDER BY x_axis_1 ASC`;

// Chart code template
const chartCode = `
// Fisheye Lens on Line Chart

// Example Query:
// SELECT
// histogram(_timestamp) as "x_axis_1",
// count(*) as "y_axis_1"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC
//
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Fisheye Lens on Line Chart - Line chart with fisheye zoom effect
//

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const xAlias = "x_axis_1";
const yAlias = "y_axis_1";
// -----------------------------------------------------------


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

const { xData, yData } = processData(data[0], xAlias, yAlias);

option = {
  tooltip: {
    trigger: 'axis'
  },
  xAxis: {
    type: 'category',
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: yData,
      type: 'line',
      smooth: true
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
