export const sunburstSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Sunburst Chart - Hierarchical data visualization with nested circles
//
// Example Query:
// SELECT
//   category as "category_field",
//   subcategory as "subcategory_field",
//   sum(value) as "value_field"
// FROM "default"
// GROUP BY category_field, subcategory_field

// 'categoryAlias' should match the column name for the main category
const categoryAlias = "category_field";

// 'subcategoryAlias' should match the column name for the subcategory
const subcategoryAlias = "subcategory_field";

// 'valueAlias' should match the column name for the value
const valueAlias = "value_field";

// Arrow function to process hierarchical data
const processData = (chartData, categoryKey, subcategoryKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const categoryMap = new Map();

  chartData.forEach(row => {
    const category = row[categoryKey];
    const subcategory = row[subcategoryKey];
    const value = row[valueKey] || 0;

    if (!categoryMap.has(category)) {
      categoryMap.set(category, {
        name: category,
        children: []
      });
    }

    categoryMap.get(category).children.push({
      name: subcategory,
      value: value
    });
  });

  return Array.from(categoryMap.values());
};

// Execute the function
const hierarchicalData = processData(data[0], categoryAlias, subcategoryAlias, valueAlias);

option = {
  series: {
    type: 'sunburst',
    data: hierarchicalData,
    radius: [0, '90%'],
    label: {
      rotate: 'radial'
    }
  }
};
`;
