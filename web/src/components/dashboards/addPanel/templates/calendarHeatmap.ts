// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
date as "date",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Calendar Heatmap

// Example Query:
// SELECT
// date as "date",
// value as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const dateAlias = "date";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, dateKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[dateKey] !== undefined && row[valueKey] !== undefined) {
      result.push([row[dateKey], row[valueKey]]);
    }
  });

  return result;
};

const calendarData = processData(data[0], dateAlias, valueAlias);

const year = new Date().getFullYear();

option = {
  tooltip: {
    position: 'top'
  },
  visualMap: {
    min: 0,
    max: Math.max(...calendarData.map(d => d[1])),
    calculable: true,
    orient: 'horizontal',
    left: 'center',
    top: 'top'
  },
  calendar: {
    top: 120,
    left: 30,
    right: 30,
    cellSize: ['auto', 13],
    range: year,
    itemStyle: {
      borderWidth: 0.5
    },
    yearLabel: { show: false }
  },
  series: [
    {
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: calendarData
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
