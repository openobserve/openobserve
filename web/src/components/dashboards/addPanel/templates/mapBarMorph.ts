// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
region as "region",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Map Bar Morph

// Example Query:
// SELECT
// region as "region",
// value as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const regionAlias = "region";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, regionKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[regionKey] !== undefined && row[valueKey] !== undefined) {
      result.push({
        name: row[regionKey],
        value: row[valueKey]
      });
    }
  });

  return result;
};

const mapData = processData(data[0], regionAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item'
  },
  visualMap: {
    left: 'right',
    min: Math.min(...mapData.map(d => d.value)),
    max: Math.max(...mapData.map(d => d.value)),
    inRange: {
      color: ['#e0ffff', '#006edd']
    },
    text: ['High', 'Low'],
    calculable: true
  },
  series: [
    {
      name: 'Data',
      type: 'map',
      map: 'world',
      roam: true,
      data: mapData
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
