// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
calories as "calories",
protein as "protein",
fat as "fat",
carbs as "carbs",
fiber as "fiber"
FROM "default"`;

// Chart code template
const chartCode = `
// Parallel Nutrients

// Example Query:
// SELECT
// calories as "calories",
// protein as "protein",
// fat as "fat",
// carbs as "carbs",
// fiber as "fiber"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const caloriesAlias = "calories";
const proteinAlias = "protein";
const fatAlias = "fat";
const carbsAlias = "carbs";
const fiberAlias = "fiber";
// -----------------------------------------------------------

const processData = (chartData, caloriesKey, proteinKey, fatKey, carbsKey, fiberKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[caloriesKey] !== undefined) {
      result.push([
        row[caloriesKey] || 0,
        row[proteinKey] || 0,
        row[fatKey] || 0,
        row[carbsKey] || 0,
        row[fiberKey] || 0
      ]);
    }
  });

  return result;
};

const parallelData = processData(data[0], caloriesAlias, proteinAlias, fatAlias, carbsAlias, fiberAlias);

option = {
  tooltip: {},
  parallelAxis: [
    { dim: 0, name: 'Calories' },
    { dim: 1, name: 'Protein' },
    { dim: 2, name: 'Fat' },
    { dim: 3, name: 'Carbs' },
    { dim: 4, name: 'Fiber' }
  ],
  parallel: {
    left: '10%',
    right: '10%',
    bottom: 100,
    parallelAxisDefault: {
      type: 'value',
      nameLocation: 'end',
      nameGap: 20
    }
  },
  series: [
    {
      type: 'parallel',
      lineStyle: {
        width: 2
      },
      data: parallelData
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
