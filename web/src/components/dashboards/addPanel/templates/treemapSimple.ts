export const treemapSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Basic Treemap - Hierarchical data visualization
//
// Example Query:
// SELECT category as "name", sum(value) as "value" FROM "default" GROUP BY category

const nameAlias = "name";
const valueAlias = "value";

const processData = (chartData, nameKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) return { data: [] };

  const data = chartData.map(row => ({
    name: row[nameKey],
    value: row[valueKey] || 0
  }));

  return { data };
};

const { data: treeData } = processData(data[0], nameAlias, valueAlias);

option = {
  series: [{
    type: 'treemap',
    data: treeData
  }]
};
`;
