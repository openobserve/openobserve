// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
date as "date",
open as "open",
close as "close",
low as "low",
high as "high"
FROM "default"`;

// Chart code template
const chartCode = `
// Candlestick Large

// Example Query:
// SELECT
// date as "date",
// open as "open",
// close as "close",
// low as "low",
// high as "high"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

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
  animation: false,
  legend: {
    bottom: 10,
    left: 'center',
    data: ['Candlestick']
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross'
    },
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    textStyle: {
      color: '#000'
    }
  },
  axisPointer: {
    link: [{ xAxisIndex: 'all' }],
    label: {
      backgroundColor: '#777'
    }
  },
  xAxis: {
    type: 'category',
    data: dates,
    boundaryGap: false
  },
  yAxis: {
    scale: true
  },
  dataZoom: [
    {
      type: 'inside',
      xAxisIndex: [0],
      start: 0,
      end: 100
    },
    {
      show: true,
      xAxisIndex: [0],
      type: 'slider',
      bottom: 60,
      start: 0,
      end: 100
    }
  ],
  series: [
    {
      name: 'Candlestick',
      type: 'candlestick',
      data: ohlc,
      itemStyle: {
        color: '#FD1050',
        color0: '#0CF49B',
        borderColor: '#FD1050',
        borderColor0: '#0CF49B'
      }
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
