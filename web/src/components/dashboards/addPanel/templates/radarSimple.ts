export const radarSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Basic Radar Chart - Shows multi-dimensional data
//
// Example Query:
// SELECT
//   'Performance' as series_name,
//   avg(CASE WHEN metric = 'CPU' THEN value END) as "metric_1",
//   avg(CASE WHEN metric = 'Memory' THEN value END) as "metric_2",
//   avg(CASE WHEN metric = 'Disk' THEN value END) as "metric_3",
//   avg(CASE WHEN metric = 'Network' THEN value END) as "metric_4"
// FROM "default"
// GROUP BY series_name

// Define the metrics (dimensions) for the radar chart
const metrics = ["metric_1", "metric_2", "metric_3", "metric_4"];

// Define the metric names for display
const metricNames = ["CPU", "Memory", "Disk", "Network"];

// 'seriesNameAlias' should match the column name for series identification
const seriesNameAlias = "series_name";

// Arrow function to process data
const processData = (chartData, seriesKey, metricKeys, metricLabels) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { indicator: [], seriesData: [] };
  }

  // Create indicator (dimensions) for the radar
  const indicator = metricLabels.map(name => ({ name, max: 100 }));

  // Process series data
  const seriesData = chartData.map(row => {
    const values = metricKeys.map(key => row[key] || 0);
    return {
      value: values,
      name: row[seriesKey] || 'Series'
    };
  });

  return { indicator, seriesData };
};

// Execute the function
const { indicator, seriesData } = processData(data[0], seriesNameAlias, metrics, metricNames);

option = {
  title: {
    text: 'Radar Chart'
  },
  legend: {
    data: seriesData.map(s => s.name)
  },
  radar: {
    indicator: indicator
  },
  series: [
    {
      name: 'Metrics',
      type: 'radar',
      data: seriesData
    }
  ]
};
`;
