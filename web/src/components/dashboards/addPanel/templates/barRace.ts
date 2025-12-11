// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

// Chart code template
const chartCode = `
// Bar Race

// Example Query:
// SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

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
  xAxis: {
    max: 'dataMax'
  },
  yAxis: {
    type: 'category',
    data: categories,
    inverse: true,
    animationDuration: 300,
    animationDurationUpdate: 300,
    max: categories.length - 1
  },
  series: [
    {
      realtimeSort: true,
      name: 'Value',
      type: 'bar',
      data: values,
      label: {
        show: true,
        position: 'right',
        valueAnimation: true
      }
    }
  ],
  animationDuration: 0,
  animationDurationUpdate: 3000,
  animationEasing: 'linear',
  animationEasingUpdate: 'linear'
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
