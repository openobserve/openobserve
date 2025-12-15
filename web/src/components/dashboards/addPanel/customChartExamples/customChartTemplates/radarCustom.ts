// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT 
  kubernetes_namespace_name as "metric",
  COUNT(*) as "value"
FROM "default"
GROUP BY kubernetes_namespace_name
LIMIT 5`;

// Chart code template
const chartCode = `
// Radar Custom

// Example Query:
// SELECT 
//   kubernetes_namespace_name as "metric",
//   COUNT(*) as "value"
// FROM "default"
// GROUP BY kubernetes_namespace_name
// LIMIT 5

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const metricAlias = "metric";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, metricKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { indicators: [], values: [] };
  }

  const indicators = [];
  const values = [];

  chartData.forEach(row => {
    if (row[metricKey] !== undefined && row[valueKey] !== undefined) {
      indicators.push({ name: row[metricKey], max: row[valueKey] * 1.2 });
      values.push(row[valueKey]);
    }
  });

  return { indicators, values };
};

const { indicators, values } = processData(data?.[0] || [], metricAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item'
  },
  radar: {
    indicator: indicators,
    shape: 'circle',
    splitNumber: 5,
    axisName: {
      color: '#428BD4'
    },
    splitLine: {
      lineStyle: {
        color: ['#ddd', '#eee', '#ddd', '#eee', '#ddd']
      }
    },
    splitArea: {
      show: false
    },
    axisLine: {
      lineStyle: {
        color: '#ddd'
      }
    }
  },
  series: [
    {
      type: 'radar',
      data: [
        {
          value: values,
          name: 'Data'
        }
      ]
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
