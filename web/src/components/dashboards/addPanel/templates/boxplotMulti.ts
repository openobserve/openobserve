// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
category as "category",
min_value as "min",
q1_value as "q1",
median_value as "median",
q3_value as "q3",
max_value as "max"
FROM "default"`;

// Chart code template
const chartCode = `
// Boxplot Multi

// Example Query:
// SELECT
// category as "category",
// min_value as "min",
// q1_value as "q1",
// median_value as "median",
// q3_value as "q3",
// max_value as "max"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const categoryAlias = "category";
const minAlias = "min";
const q1Alias = "q1";
const medianAlias = "median";
const q3Alias = "q3";
const maxAlias = "max";
// -----------------------------------------------------------

const processData = (chartData, catKey, minKey, q1Key, medianKey, q3Key, maxKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { categories: [], boxData: [] };
  }

  const categories = [];
  const boxData = [];

  chartData.forEach(row => {
    if (row[catKey] !== undefined) {
      categories.push(row[catKey]);
      boxData.push([
        row[minKey] || 0,
        row[q1Key] || 0,
        row[medianKey] || 0,
        row[q3Key] || 0,
        row[maxKey] || 0
      ]);
    }
  });

  return { categories, boxData };
};

const { categories, boxData } = processData(data[0], categoryAlias, minAlias, q1Alias, medianAlias, q3Alias, maxAlias);

option = {
  tooltip: {
    trigger: 'item'
  },
  xAxis: {
    type: 'category',
    data: categories,
    boundaryGap: true,
    splitArea: {
      show: true
    }
  },
  yAxis: {
    type: 'value',
    splitArea: {
      show: true
    }
  },
  series: [
    {
      name: 'boxplot',
      type: 'boxplot',
      data: boxData
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
