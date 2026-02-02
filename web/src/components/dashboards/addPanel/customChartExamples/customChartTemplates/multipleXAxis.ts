// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
_timestamp as "date",
LENGTH(log) as "value1",
LENGTH(code) as "value2"
FROM "default"
ORDER BY _timestamp
LIMIT 200`;

// Chart code template
const chartCode = `
// Multiple X Axes Chart
// This chart demonstrates how to use two X axes with different scales

// Example Query:
// SELECT
// _timestamp as "date",
// LENGTH(log) as "value1",
// LENGTH(code) as "value2"
// FROM "default"
// ORDER BY _timestamp
// LIMIT 200

// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const dateAlias = "date";
const value1Alias = "value1";
const value2Alias = "value2";
// -----------------------------------------------------------

const dates = [];
const data1 = [];
const data2 = [];

// Process data
if (data && data[0] && Array.isArray(data[0])) {
  // Sort by date
  const sortedData = data[0].slice().sort((a, b) => {
    const aTime = new Date(a[dateAlias]).getTime();
    const bTime = new Date(b[dateAlias]).getTime();
    return aTime - bTime;
  });

  sortedData.forEach(row => {
    if (row[dateAlias] !== undefined) {
      const val1 = parseFloat(row[value1Alias]);
      const val2 = parseFloat(row[value2Alias]);
      
      // Only add if both values are valid numbers
      if (!isNaN(val1) && !isNaN(val2)) {
        dates.push(row[dateAlias]);
        data1.push(val1);
        data2.push(val2);
      }
    }
  });
}

const colors = ['#5470C6', '#EE6666'];

option = {
  color: colors,
  title: {
    text: 'Multiple X Axes',
    left: 'center'
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross'
    }
  },
  legend: {
    data: ['Series 1', 'Series 2'],
    bottom: 10
  },
  grid: {
    top: 80,
    bottom: 80,
    left: '10%',
    right: '10%'
  },
  xAxis: [
    {
      type: 'category',
      boundaryGap: false,
      position: 'bottom',
      axisTick: {
        alignWithLabel: true
      },
      axisLine: {
        onZero: false,
        lineStyle: {
          color: colors[0]
        }
      },
      axisPointer: {
        label: {
          formatter: function (params) {
            return 'Series 1  ' + params.value + (params.seriesData.length ? '：' + params.seriesData[0].data : '');
          }
        }
      },
      data: dates
    },
    {
      type: 'category',
      boundaryGap: false,
      position: 'top',
      axisTick: {
        alignWithLabel: true
      },
      axisLine: {
        onZero: false,
        lineStyle: {
          color: colors[1]
        }
      },
      axisPointer: {
        label: {
          formatter: function (params) {
            return 'Series 2  ' + params.value + (params.seriesData.length ? '：' + params.seriesData[0].data : '');
          }
        }
      },
      data: dates
    }
  ],
  yAxis: {
    type: 'value'
  },
  series: [
    {
      name: 'Series 1',
      type: 'line',
      xAxisIndex: 0,
      smooth: true,
      showSymbol: false,
      emphasis: {
        focus: 'series'
      },
      data: data1
    },
    {
      name: 'Series 2',
      type: 'line',
      xAxisIndex: 1,
      smooth: true,
      showSymbol: false,
      emphasis: {
        focus: 'series'
      },
      data: data2
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery,
};
