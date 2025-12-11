// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
aqi as "aqi",
pm25 as "pm25",
pm10 as "pm10",
co as "co",
no2 as "no2",
so2 as "so2"
FROM "default"`;

// Chart code template
const chartCode = `
// Parallel Aqi

// Example Query:
// SELECT
// aqi as "aqi",
// pm25 as "pm25",
// pm10 as "pm10",
// co as "co",
// no2 as "no2",
// so2 as "so2"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const aqiAlias = "aqi";
const pm25Alias = "pm25";
const pm10Alias = "pm10";
const coAlias = "co";
const no2Alias = "no2";
const so2Alias = "so2";
// -----------------------------------------------------------

const processData = (chartData, aqiKey, pm25Key, pm10Key, coKey, no2Key, so2Key) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[aqiKey] !== undefined) {
      result.push([
        row[aqiKey] || 0,
        row[pm25Key] || 0,
        row[pm10Key] || 0,
        row[coKey] || 0,
        row[no2Key] || 0,
        row[so2Key] || 0
      ]);
    }
  });

  return result;
};

const parallelData = processData(data[0], aqiAlias, pm25Alias, pm10Alias, coAlias, no2Alias, so2Alias);

option = {
  tooltip: {},
  parallelAxis: [
    { dim: 0, name: 'AQI' },
    { dim: 1, name: 'PM2.5' },
    { dim: 2, name: 'PM10' },
    { dim: 3, name: 'CO' },
    { dim: 4, name: 'NO2' },
    { dim: 5, name: 'SO2' }
  ],
  parallel: {
    left: '5%',
    right: '18%',
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
