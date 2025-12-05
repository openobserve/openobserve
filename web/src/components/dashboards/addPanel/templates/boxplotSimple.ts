export const boxplotSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Basic Boxplot - Statistical distribution visualization
//
// Example Query:
// SELECT category as "category", value as "value" FROM "default"

const categoryAlias = "category";
const valueAlias = "value";

const processData = (chartData, catKey, valKey) => {
  if (!chartData || !Array.isArray(chartData)) return { categories: [], boxData: [] };

  const categoryMap = new Map();

  chartData.forEach(row => {
    const cat = row[catKey];
    if (!categoryMap.has(cat)) {
      categoryMap.set(cat, []);
    }
    categoryMap.get(cat).push(row[valKey] || 0);
  });

  const categories = Array.from(categoryMap.keys());
  const boxData = [];

  categoryMap.forEach(values => {
    values.sort((a, b) => a - b);
    const q1 = values[Math.floor(values.length * 0.25)];
    const q2 = values[Math.floor(values.length * 0.5)];
    const q3 = values[Math.floor(values.length * 0.75)];
    const min = values[0];
    const max = values[values.length - 1];
    boxData.push([min, q1, q2, q3, max]);
  });

  return { categories, boxData };
};

const { categories, boxData } = processData(data[0], categoryAlias, valueAlias);

option = {
  xAxis: { type: 'category', data: categories },
  yAxis: { type: 'value' },
  series: [{
    type: 'boxplot',
    data: boxData
  }]
};
`;
