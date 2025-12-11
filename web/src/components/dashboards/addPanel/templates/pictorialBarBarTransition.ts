// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
category as "category",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Pictorial Bar Bar Transition

// Example Query:
// SELECT
// category as "category",
// value as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const categoryAlias = "category";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, categoryKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { categories: [], values: [] };
  }

  const categories = [];
  const values = [];

  chartData.forEach(row => {
    if (row[categoryKey] !== undefined && row[valueKey] !== undefined) {
      categories.push(row[categoryKey]);
      values.push(row[valueKey]);
    }
  });

  return { categories, values };
};

const { categories, values } = processData(data[0], categoryAlias, valueAlias);

option = {
  tooltip: {},
  legend: {
    data: ['Bar', 'Pictorial']
  },
  xAxis: {
    type: 'category',
    data: categories
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      name: 'Pictorial',
      type: 'pictorialBar',
      symbol: 'rect',
      symbolRepeat: true,
      symbolSize: ['80%', '60%'],
      symbolMargin: '5%',
      data: values
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
