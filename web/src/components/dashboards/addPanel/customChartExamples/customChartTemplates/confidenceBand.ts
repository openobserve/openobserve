// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
_timestamp as "x_axis",
LENGTH(log) as "y_value"
FROM "default"
ORDER BY _timestamp
LIMIT 200`;

// Chart code template
const chartCode = `
// Confidence Band Chart
// This chart displays a mean line with upper and lower confidence bounds

// Example Query:
// SELECT
// _timestamp as "x_axis",
// LENGTH(log) as "y_value"
// FROM "default"
// ORDER BY _timestamp
// LIMIT 200

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const xAlias = "x_axis";
const yAlias = "y_value";
// -----------------------------------------------------------

const xData = [];
const meanData = [];
const lowerData = [];
const upperData = [];

// Process data
if (data && data[0] && Array.isArray(data[0])) {
  // Sort data by x-axis for smoother lines
  const sortedData = data[0].slice().sort((a, b) => {
    const aTime = new Date(a[xAlias]).getTime();
    const bTime = new Date(b[xAlias]).getTime();
    return aTime - bTime;
  });

  sortedData.forEach(row => {
    const x = row[xAlias];
    const y = parseFloat(row[yAlias]);
    
    if (x !== undefined && !isNaN(y)) {
      xData.push(x);
      meanData.push(y);
      
      // Calculate confidence band (±20% for better visibility)
      const confidenceRange = Math.abs(y) * 0.20 + 0.1;
      lowerData.push(y - confidenceRange);
      upperData.push(y + confidenceRange);
    }
  });
}

// Calculate base value for proper stacking
const base = -Math.min(...lowerData);

option = {
  title: {
    text: 'Confidence Band',
    subtext: 'Example in MetricsGraphics.js',
    left: 'center'
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross',
      animation: false,
      label: {
        backgroundColor: '#ccc',
        borderColor: '#aaa',
        borderWidth: 1,
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        color: '#222'
      }
    },
    formatter: function (params) {
      return (
        params[0].axisValueLabel +
        '<br />' +
        params[2].marker +
        params[2].seriesName +
        ' : ' +
        params[2].value
      );
    }
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: xData,
    axisLine: { onZero: false }
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      name: 'L',
      type: 'line',
      data: lowerData.map(val => val + base),
      lineStyle: {
        opacity: 0
      },
      stack: 'confidence-band',
      symbol: 'none',
      smooth: true  // More aggressive smoothing
    },
    {
      name: 'U',
      type: 'line',
      data: upperData.map((val, idx) => val - lowerData[idx]),
      lineStyle: {
        opacity: 0
      },
      areaStyle: {
        color: '#ccc'
      },
      stack: 'confidence-band',
      symbol: 'none',
      smooth: true  // More aggressive smoothing
    },
    {
      name: 'Mean',
      type: 'line',
      data: meanData.map(val => val + base),
      hoverAnimation: false,
      symbolSize: 6,
      itemStyle: {
        color: '#333'
      },
      showSymbol: false,
      smooth: true  // More aggressive smoothing
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
