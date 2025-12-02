export const candlestickSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Basic Candlestick Chart - Shows OHLC (Open, High, Low, Close) financial data
//
// Example Query:
// SELECT
//   date_field as "date",
//   first(open_price) as "open",
//   max(high_price) as "high",
//   min(low_price) as "low",
//   last(close_price) as "close"
// FROM "default"
// GROUP BY date
// ORDER BY date ASC

// Define column aliases for candlestick data
const dateAlias = "date";
const openAlias = "open";
const highAlias = "high";
const lowAlias = "low";
const closeAlias = "close";

// Arrow function to process candlestick data
const processData = (chartData, dateKey, openKey, highKey, lowKey, closeKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { dates: [], candlestickData: [] };
  }

  const dates = [];
  const candlestickData = [];

  chartData.forEach(row => {
    if (row[dateKey] !== undefined &&
        row[openKey] !== undefined &&
        row[highKey] !== undefined &&
        row[lowKey] !== undefined &&
        row[closeKey] !== undefined) {
      dates.push(row[dateKey]);
      // Candlestick data format: [open, close, low, high]
      candlestickData.push([
        row[openKey],
        row[closeKey],
        row[lowKey],
        row[highKey]
      ]);
    }
  });

  return { dates, candlestickData };
};

// Execute the function
const { dates, candlestickData } = processData(
  data[0],
  dateAlias,
  openAlias,
  highAlias,
  lowAlias,
  closeAlias
);

option = {
  title: {
    text: 'Candlestick Chart'
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross'
    }
  },
  legend: {
    data: ['Price']
  },
  grid: {
    left: '10%',
    right: '10%',
    bottom: '15%'
  },
  xAxis: {
    type: 'category',
    data: dates,
    boundaryGap: false,
    axisLine: { onZero: false },
    splitLine: { show: false },
    min: 'dataMin',
    max: 'dataMax'
  },
  yAxis: {
    scale: true,
    splitArea: {
      show: true
    }
  },
  dataZoom: [
    {
      type: 'inside',
      start: 50,
      end: 100
    },
    {
      show: true,
      type: 'slider',
      top: '90%',
      start: 50,
      end: 100
    }
  ],
  series: [
    {
      name: 'Price',
      type: 'candlestick',
      data: candlestickData,
      itemStyle: {
        color: '#ef232a',
        color0: '#14b143',
        borderColor: '#ef232a',
        borderColor0: '#14b143'
      }
    }
  ]
};
`;
