// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
vehicle_type as "vehicle",
speed as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Pictorial Bar Vehicle

// Example Query:
// SELECT
// vehicle_type as "vehicle",
// speed as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const vehicleAlias = "vehicle";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, vehicleKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { vehicles: [], values: [] };
  }

  const vehicles = [];
  const values = [];

  chartData.forEach(row => {
    if (row[vehicleKey] !== undefined && row[valueKey] !== undefined) {
      vehicles.push(row[vehicleKey]);
      values.push(row[valueKey]);
    }
  });

  return { vehicles, values };
};

const { vehicles, values } = processData(data[0], vehicleAlias, valueAlias);

option = {
  tooltip: {},
  xAxis: {
    type: 'value',
    max: Math.max(...values) * 1.2
  },
  yAxis: {
    type: 'category',
    data: vehicles
  },
  series: [
    {
      type: 'pictorialBar',
      symbol: 'path://M0,10 L10,10 C5.5,10 5.5,5 5,0 C4.5,5 4.5,10 0,10 z',
      symbolRepeat: 'fixed',
      symbolMargin: '5%',
      symbolClip: true,
      symbolSize: 30,
      symbolBoundingData: Math.max(...values) * 1.2,
      data: values,
      z: 10
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
