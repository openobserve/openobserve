// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
hour as "hour",
day as "day",
commits as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Punch Card of Github

// Example Query:
// SELECT
// hour as "hour",
// day as "day",
// commits as "value"
// FROM "default"
//
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Punch Card of Github - Polar coordinate scatter
//

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const hourAlias = "hour";
const dayAlias = "day";
const valueAlias = "value";
// -----------------------------------------------------------


const processData = (chartData, hourKey, dayKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[hourKey] !== undefined && row[dayKey] !== undefined) {
      result.push([row[hourKey], row[dayKey], row[valueKey] || 0]);
    }
  });

  return result;
};

const punchData = processData(data[0], hourAlias, dayAlias, valueAlias);

const hours = ['12am', '1am', '2am', '3am', '4am', '5am', '6am', '7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm'];
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

option = {
  tooltip: {
    position: 'top'
  },
  polar: {},
  angleAxis: {
    type: 'category',
    data: hours
  },
  radiusAxis: {
    type: 'category',
    data: days
  },
  series: [
    {
      type: 'scatter',
      coordinateSystem: 'polar',
      symbolSize: (val) => val[2] * 2,
      data: punchData,
      animationDelay: (idx) => idx * 5
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
