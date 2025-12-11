// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
timestamp as "time",
open_price as "open",
close_price as "close",
low_price as "low",
high_price as "high",
volume as "volume"
FROM "default"`;

// Chart code template
const chartCode = `
// Intraday Chart with Breaks (II)

// Example Query:
// SELECT
// timestamp as "time",
// open_price as "open",
// close_price as "close",
// low_price as "low",
// high_price as "high",
// volume as "volume"
// FROM "default"
//
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Intraday Chart with Breaks (II) - Advanced candlestick with volume
//

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const timeAlias = "time";
const openAlias = "open";
const closeAlias = "close";
const lowAlias = "low";
const highAlias = "high";
const volumeAlias = "volume";
// -----------------------------------------------------------


const processData = (chartData, timeKey, openKey, closeKey, lowKey, highKey, volumeKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { timeData: [], ohlcData: [], volumeData: [] };
  }

  const timeData = [];
  const ohlcData = [];
  const volumeData = [];

  chartData.forEach(row => {
    if (row[timeKey] !== undefined) {
      timeData.push(row[timeKey]);
      ohlcData.push([
        row[openKey] || 0,
        row[closeKey] || 0,
        row[lowKey] || 0,
        row[highKey] || 0
      ]);
      volumeData.push(row[volumeKey] || 0);
    }
  });

  return { timeData, ohlcData, volumeData };
};

const { timeData, ohlcData, volumeData } = processData(data[0], timeAlias, openAlias, closeAlias, lowAlias, highAlias, volumeAlias);

option = {
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
      data: timeData,
      gridIndex: 0
    },
    {
      type: 'category',
      data: timeData,
      gridIndex: 1
    }
  ],
  yAxis: [
    {
      gridIndex: 0
    },
    {
      gridIndex: 1
    }
  ],
  series: [
    {
      type: 'candlestick',
      data: ohlcData,
      xAxisIndex: 0,
      yAxisIndex: 0
    },
    {
      type: 'bar',
      data: volumeData,
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
