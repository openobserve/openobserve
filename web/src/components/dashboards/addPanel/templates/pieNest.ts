export const pieNest = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Nested Pie Chart - Shows hierarchical data in nested rings
//
// Example Query:
// SELECT category as "category", subcategory as "subcategory", count(*) as "value" FROM "default" GROUP BY category, subcategory

const categoryAlias = "category";
const subcategoryAlias = "subcategory";
const valueAlias = "value";

const processData = (chartData, catKey, subKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) return { innerData: [], outerData: [] };

  const categoryMap = new Map();

  chartData.forEach(row => {
    const cat = row[catKey];
    const sub = row[subKey];
    const val = row[valueKey] || 0;

    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, { value: 0, children: [] });
    }
    categoryMap.get(cat).value += val;
    categoryMap.get(cat).children.push({ name: sub, value: val });
  });

  const innerData = [];
  const outerData = [];

  categoryMap.forEach((data, name) => {
    innerData.push({ name, value: data.value });
    outerData.push(...data.children);
  });

  return { innerData, outerData };
};

const { innerData, outerData } = processData(data[0], categoryAlias, subcategoryAlias, valueAlias);

option = {
  series: [
    {
      type: 'pie',
      radius: [0, '30%'],
      label: { position: 'inner', fontSize: 14 },
      data: innerData
    },
    {
      type: 'pie',
      radius: ['45%', '60%'],
      data: outerData
    }
  ]
};
`;
