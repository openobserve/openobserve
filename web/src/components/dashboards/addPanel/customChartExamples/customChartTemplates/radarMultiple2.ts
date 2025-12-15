// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT 'Metric A' as metric, 'Series 1' as series, 80 as value from default
UNION ALL
SELECT 'Metric B' as metric, 'Series 1' as series, 65 as value from default
UNION ALL
SELECT 'Metric C' as metric, 'Series 1' as series, 90 as value from default
UNION ALL
SELECT 'Metric D' as metric, 'Series 1' as series, 75 as value from default
UNION ALL`;

// Chart code template
const chartCode = `
// Multiple Radar

// Example Query:
// SELECT 'Metric A' as metric, 'Series 1' as series, 80 as value from default
// UNION ALL
// SELECT 'Metric B' as metric, 'Series 1' as series, 65 as value from default
// UNION ALL
// SELECT 'Metric C' as metric, 'Series 1' as series, 90 as value from default
// UNION ALL
// SELECT 'Metric D' as metric, 'Series 1' as series, 75 as value from default
// UNION ALL

// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const metricAlias = "metric";
const seriesAlias = "series";
const valueAlias = "value";
// -----------------------------------------------------------


const processData = (chartData, metricKey, seriesKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { indicators: [], seriesData: [] };
  }

  const metricSet = new Set();
  const seriesMap = new Map();

  chartData.forEach(row => {
    const metric = row[metricKey];
    const series = row[seriesKey];
    const value = row[valueKey] || 0;

    metricSet.add(metric);

    if (!seriesMap.has(series)) {
      seriesMap.set(series, {});
    }
    seriesMap.get(series)[metric] = value;
  });

  const metrics = Array.from(metricSet);
  const indicators = metrics.map(m => ({ name: m, max: 100 }));

  const seriesData = Array.from(seriesMap.entries()).map(([name, values]) => ({
    value: metrics.map(m => values[m] || 0),
    name: name
  }));

  return { indicators, seriesData };
};

const { indicators, seriesData } = processData(data[0], metricAlias, seriesAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item'
  },
  legend: {
    data: seriesData.map(s => s.name)
  },
  radar: {
    indicator: indicators
  },
  series: [
    {
      type: 'radar',
      data: seriesData
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};