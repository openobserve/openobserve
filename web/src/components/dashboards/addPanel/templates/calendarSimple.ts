export const calendarSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Calendar Chart - Time series data displayed as a calendar heatmap
//
// Example Query:
// SELECT
//   date(_timestamp) as "date_field",
//   count(*) as "value_field"
// FROM "default"
// WHERE _timestamp >= '2025-01-01' AND _timestamp < '2026-01-01'
// GROUP BY date_field
// ORDER BY date_field ASC

// 'dateAlias' should match the column name for the date
const dateAlias = "date_field";

// 'valueAlias' should match the column name for the value
const valueAlias = "value_field";

// Arrow function to process date-value pairs
const processData = (chartData, dateKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[dateKey] !== undefined && row[valueKey] !== undefined) {
      // Format date as YYYY-MM-DD if not already
      const dateStr = row[dateKey];
      result.push([dateStr, row[valueKey]]);
    }
  });

  return result;
};

// Execute the function
const calendarData = processData(data[0], dateAlias, valueAlias);

// Get year from first data point or use current year
const getYear = () => {
  if (calendarData.length > 0) {
    const dateStr = calendarData[0][0];
    return new Date(dateStr).getFullYear();
  }
  return new Date().getFullYear();
};

const year = getYear();

option = {
  visualMap: {
    min: 0,
    max: Math.max(...calendarData.map(d => d[1])),
    type: 'piecewise',
    orient: 'horizontal',
    left: 'center',
    top: 10
  },
  calendar: {
    top: 80,
    left: 30,
    right: 30,
    cellSize: ['auto', 13],
    range: year,
    itemStyle: {
      borderWidth: 0.5
    },
    yearLabel: { show: false }
  },
  series: {
    type: 'heatmap',
    coordinateSystem: 'calendar',
    data: calendarData
  }
};
`;
