export const dataTransformFilter = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Data Transform Filter - Demonstrates filtering and transforming data
//
// Expected Query Format:
// SELECT
//   year as "x_axis_1",
//   category as "category_name",
//   value as "y_axis_1"
// FROM "default"
// GROUP BY x_axis_1, category_name
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for the X-axis
const xAlias = "x_axis_1";

// 'categoryAlias' should match the column name for the category
const categoryAlias = "category_name";

// 'yAlias' should match the column name for the Y-axis value
const yAlias = "y_axis_1";

// Categories to filter (modify these to match your data)
const filterCategories = ["Category1", "Category2"];

// Arrow function to process and filter data
const processData = (chartData, xKey, categoryKey, yKey, categories) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { dataset: [], series: [] };
  }

  // Filter data by categories
  const filteredData = chartData.filter(row =>
    categories.includes(row[categoryKey])
  );

  // Group data by category
  const categoryMap = new Map();
  categories.forEach(cat => categoryMap.set(cat, []));

  filteredData.forEach(row => {
    const category = row[categoryKey];
    if (categoryMap.has(category)) {
      categoryMap.get(category).push({
        x: row[xKey],
        y: row[yKey]
      });
    }
  });

  // Create series
  const series = [];
  categoryMap.forEach((dataPoints, category) => {
    series.push({
      type: 'line',
      name: category,
      showSymbol: false,
      data: dataPoints.map(p => [p.x, p.y]),
      encode: {
        x: 0,
        y: 1
      }
    });
  });

  return { series };
};

// Execute the function
const { series } = processData(data[0], xAlias, categoryAlias, yAlias, filterCategories);

option = {
  title: {
    text: 'Filtered Data Comparison'
  },
  tooltip: {
    trigger: 'axis'
  },
  legend: {
    data: filterCategories
  },
  xAxis: {
    type: 'category',
    nameLocation: 'middle'
  },
  yAxis: {
    name: 'Value'
  },
  series: series
};
`;
