// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
  histogram(_timestamp) as "date",
  COUNT(DISTINCT kubernetes_pod_name) as "open",
  COUNT(*) as "high",
  COUNT(DISTINCT kubernetes_namespace_name) as "low",
  COUNT(DISTINCT kubernetes_container_name) as "close"
FROM "default"
GROUP BY date
ORDER BY date ASC
LIMIT 100`;

// Chart code template
const chartCode = `
// Candlestick Brush

// Example Query:
// SELECT
//   histogram(_timestamp) as "date",
//   COUNT(DISTINCT kubernetes_pod_name) as "open",
//   COUNT(*) as "high",
//   COUNT(DISTINCT kubernetes_namespace_name) as "low",
//   COUNT(DISTINCT kubernetes_container_name) as "close"
// FROM "default"
// GROUP BY date
// ORDER BY date ASC
// LIMIT 100

// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const dateAlias = "date";
const openAlias = "open";
const closeAlias = "close";
const lowAlias = "low";
const highAlias = "high";
// -----------------------------------------------------------


const processData = (chartData, dateKey, openKey, closeKey, lowKey, highKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { dates: [], ohlc: [] };
  }

  const dates = [];
  const ohlc = [];

  chartData.forEach(row => {
    if (row[dateKey] !== undefined) {
      dates.push(row[dateKey]);
      ohlc.push([
        row[openKey] || 0,
        row[closeKey] || 0,
        row[lowKey] || 0,
        row[highKey] || 0
      ]);
    }
  });

  return { dates, ohlc };
};

const { dates, ohlc } = processData(data[0], dateAlias, openAlias, closeAlias, lowAlias, highAlias);

option = {
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross'
    }
  },
  brush: {
    xAxisIndex: 'all',
    brushLink: 'all',
    outOfBrush: {
      colorAlpha: 0.1
    }
  },
  xAxis: {
    type: 'category',
    data: dates,
    boundaryGap: false
  },
  yAxis: {
    scale: true,
    splitArea: {
      show: true
    }
  },
  series: [
    {
      type: 'candlestick',
      data: ohlc
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
