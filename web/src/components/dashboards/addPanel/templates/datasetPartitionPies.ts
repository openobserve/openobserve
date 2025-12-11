// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT category, count(*) as value FROM your_table GROUP BY category ORDER BY value DESC LIMIT 10`;

// Chart code template
const chartCode = `
// Dataset Partition Pies

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------
const categoryAlias = 'category'; // First column: category name
const valueAlias = 'value';       // Second column: numeric value

const processData = (chartData) => {
  const categories = chartData.map(item => item[categoryAlias]);
// -----------------------------------------------------------

  const values = chartData.map(item => item[valueAlias]);
  
  return { categories, values };
};

// Note: 'data' is a global variable containing the query results.
// We access 'data[0]' because the results are often nested in the first element.
const { categories, values } = processData(data[0]);

option = {
  dataset: {
    source: categories.map((cat, i) => ({category: cat, value: values[i]}))
  },
  series: [{
    type: 'pie',
    radius: '50%',
    encode: {
      itemName: 'category',
      value: 'value'
    },
    label: {
      formatter: '{b}: {@value} ({d}%)'
    }
  }]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
