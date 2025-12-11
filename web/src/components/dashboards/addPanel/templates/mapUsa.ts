// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
state as "state",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Map Usa

// Example Query:
// SELECT
// state as "state",
// value as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const stateAlias = "state";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, stateKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[stateKey] !== undefined && row[valueKey] !== undefined) {
      result.push({
        name: row[stateKey],
        value: row[valueKey]
      });
    }
  });

  return result;
};

const mapData = processData(data[0], stateAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item',
    showDelay: 0,
    transitionDuration: 0.2
  },
  visualMap: {
    left: 'right',
    min: Math.min(...mapData.map(d => d.value)),
    max: Math.max(...mapData.map(d => d.value)),
    inRange: {
      color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#ffffbf', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026']
    },
    text: ['High', 'Low'],
    calculable: true
  },
  series: [
    {
      name: 'USA',
      type: 'map',
      map: 'USA',
      roam: true,
      itemStyle: {
        areaColor: '#eee',
        borderColor: '#444'
      },
      emphasis: {
        itemStyle: {
          areaColor: '#ffd700'
        },
        label: {
          show: true
        }
      },
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
