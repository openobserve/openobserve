// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
level_1 as "level1",
level_2 as "level2",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Bar Multi Drilldown

// Example Query:
// SELECT
// level_1 as "level1",
// level_2 as "level2",
// value as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const level1Alias = "level1";
const level2Alias = "level2";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, l1Key, l2Key, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { categories: [], values: [] };
  }

  const categoryMap = new Map();

  chartData.forEach(row => {
    const l1 = row[l1Key];
    const l2 = row[l2Key];
    const val = row[valueKey] || 0;

    const key = l2 ? \`\${l1} - \${l2}\` : l1;
    categoryMap.set(key, (categoryMap.get(key) || 0) + val);
  });

  const categories = Array.from(categoryMap.keys());
  const values = Array.from(categoryMap.values());

  return { categories, values };
};

const { categories, values } = processData(data[0], level1Alias, level2Alias, valueAlias);

option = {
  xAxis: {
    type: 'category',
    data: categories
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      type: 'bar',
      data: values,
      label: {
        show: true,
        position: 'top'
      }
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
