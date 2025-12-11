// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT 
  _timestamp as "date",
  count as "open",
  code as "close",
  id as "low",
  count as "high",
  count as "volume"
FROM "default"`;

// Chart code template
const chartCode = `
// Axis Pointer Link and Touch

// Example Query:
// SELECT 
//   _timestamp as "date",
//   count as "open",
//   code as "close",
//   id as "low",
//   count as "high",
//   count as "volume"
// FROM "default"

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const dateAlias = "date";
const openAlias = "open";
const closeAlias = "close";
const lowAlias = "low";
const highAlias = "high";
const volumeAlias = "volume";
// -----------------------------------------------------------

const processData = (chartData, dateKey, openKey, closeKey, lowKey, highKey, volumeKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { dates: [], ohlc: [], volumes: [] };
  }

  const dates = [];
  const ohlc = [];
  const volumes = [];

  chartData.forEach(row => {
    if (row[dateKey] !== undefined) {
      dates.push(row[dateKey]);
      ohlc.push([
        row[openKey] || 0,
        row[closeKey] || 0,
        row[lowKey] || 0,
        row[highKey] || 0
      ]);
      volumes.push(row[volumeKey] || 0);
    }
  });

  return { dates, ohlc, volumes };
};

const { dates, ohlc, volumes } = processData(data[0], dateAlias, openAlias, closeAlias, lowAlias, highAlias, volumeAlias);

option = {
  animation: false,
  axisPointer: {
    link: [{ xAxisIndex: 'all' }]
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross'
    }
  },
  grid: [
    {
      left: '10%',
      right: '10%',
      height: '50%'
    },
    {
      left: '10%',
      right: '10%',
      top: '70%',
      height: '16%'
    }
  ],
  xAxis: [
    {
      type: 'category',
      data: dates,
      boundaryGap: false,
      gridIndex: 0
    },
    {
      type: 'category',
      data: dates,
      gridIndex: 1
    }
  ],
  yAxis: [
    {
      scale: true,
      gridIndex: 0
    },
    {
      scale: true,
      gridIndex: 1
    }
  ],
  series: [
    {
      type: 'candlestick',
      data: ohlc,
      xAxisIndex: 0,
      yAxisIndex: 0
    },
    {
      type: 'bar',
      data: volumes,
      xAxisIndex: 1,
      yAxisIndex: 1
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
