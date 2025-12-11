// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
metric_name as "metric",
value as "value",
max_value as "max"
FROM "default"`;

// Chart code template
const chartCode = `
// Gauge Multi Title

// Example Query:
// SELECT
// metric_name as "metric",
// value as "value",
// max_value as "max"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const metricAlias = "metric";
const valueAlias = "value";
const maxAlias = "max";
// -----------------------------------------------------------

const processData = (chartData, metricKey, valueKey, maxKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[metricKey] !== undefined && row[valueKey] !== undefined) {
      result.push({
        value: row[valueKey],
        name: row[metricKey],
        max: row[maxKey] || 100
      });
    }
  });

  return result;
};

const gaugeData = processData(data[0], metricAlias, valueAlias, maxAlias);

option = {
  series: gaugeData.map((item, idx) => ({
    type: 'gauge',
    center: [\`\${(idx + 1) * (100 / (gaugeData.length + 1))}%\`, '50%'],
    radius: '60%',
    min: 0,
    max: item.max,
    splitNumber: 5,
    axisLine: {
      lineStyle: {
        width: 10
      }
    },
    pointer: {
      itemStyle: {
        color: 'auto'
      }
    },
    axisTick: {
      distance: -10,
      length: 8,
      lineStyle: {
        color: '#fff',
        width: 2
      }
    },
    splitLine: {
      distance: -10,
      length: 15,
      lineStyle: {
        color: '#fff',
        width: 4
      }
    },
    axisLabel: {
      color: 'auto',
      distance: 20,
      fontSize: 12
    },
    detail: {
      valueAnimation: true,
      formatter: '{value}',
      color: 'auto',
      fontSize: 20
    },
    data: [
      {
        value: item.value,
        name: item.name
      }
    ]
  }))
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
