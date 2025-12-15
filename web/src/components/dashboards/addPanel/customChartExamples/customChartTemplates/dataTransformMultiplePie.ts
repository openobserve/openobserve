// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
kubernetes_namespace_name as "x_axis",
kubernetes_container_name as "y_axis",
code as "z_axis"
FROM "default"`;

// Chart code template
const chartCode = `
// Partition Data to Pies

// Example Query:
// SELECT
// kubernetes_namespace_name as "x_axis",
// kubernetes_container_name as "y_axis",
// code as "z_axis"
// FROM "default"

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const categoryAlias = "x_axis";
const subcategoryAlias = "y_axis";
const valueAlias = "z_axis";
// -----------------------------------------------------------


const processData = (chartData, catKey, subKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { categories: [], seriesData: [] };
  }

  const categoryMap = new Map();

  chartData.forEach(row => {
    const cat = row[catKey];
    const sub = row[subKey];
    const val = row[valueKey] || 0;

    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
    }
    categoryMap.get(cat).push({ name: sub, value: val });
  });

  const categories = Array.from(categoryMap.keys());
  const seriesData = categories.map((cat, idx) => ({
    name: cat,
    type: 'pie',
    radius: '25%',
    center: [\`\${25 + (idx % 3) * 33}%\`, \`\${25 + Math.floor(idx / 3) * 50}%\`],
    data: categoryMap.get(cat)
  }));

  return { categories, seriesData };
};

const { categories, seriesData } = processData(data[0], categoryAlias, subcategoryAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item'
  },
  legend: {
    top: 'bottom'
  },
  series: seriesData
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
