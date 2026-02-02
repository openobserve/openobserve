// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT histogram(_timestamp) as "category", count(kubernetes_namespace_name) as "value" FROM "default" GROUP BY category ORDER BY category ASC`;

// Chart code template
const chartCode = `
// Bar Polar Stack Radial

// Example Query:
// SELECT histogram(_timestamp) as "category", count(kubernetes_namespace_name) as "value" FROM "default" GROUP BY category ORDER BY category ASC

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
  polar: {
    radius: [30, '80%']
  },
  angleAxis: {
    max: (values.length ? Math.max(...values) * 1.2 : 1),
    startAngle: 90
  },
  radiusAxis: {
    type: 'category',
    data: categories
  },
  tooltip: {},
  series: {
    type: 'bar',
    data: values,
    coordinateSystem: 'polar',
    label: {
      show: true,
      position: 'middle'
    }
  }
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
