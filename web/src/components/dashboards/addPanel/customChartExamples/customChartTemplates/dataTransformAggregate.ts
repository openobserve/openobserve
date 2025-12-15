// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
  kubernetes_namespace_name as "x_axis_1",
  kubernetes_pod_id as "y_axis_1"
FROM "default"`;

// Chart code template
const chartCode = `
// Data Transform Aggregate - Boxplot from aggregated data

// Example Query:
// SELECT
//   kubernetes_namespace_name as "x_axis_1",
//   kubernetes_pod_id as "y_axis_1"
// FROM "default"

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
const xAlias = "x_axis_1";  // Category column
const yAlias = "y_axis_1";  // Value column (will be converted to numeric)
// -----------------------------------------------------------

// Process data and group by category
function splitData(rawData, xKey, yKey) {
  if (!rawData || !Array.isArray(rawData)) {
    return { categoryData: [], values: [] };
  }

  const categoryData = [];
  const values = [];
  
  rawData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined) {
      categoryData.push(row[xKey]);
      // Convert to numeric - use string length as a proxy value if it's a string
      const val = typeof row[yKey] === 'string' ? row[yKey].length : parseFloat(row[yKey]) || 0;
      values.push(val);
    }
  });

  return { categoryData, values };
}

const splitDataResult = splitData(data[0], xAlias, yAlias);

// Group values by category for aggregation
function groupByCategory(categories, values) {
  const grouped = {};
  categories.forEach((cat, idx) => {
    if (!grouped[cat]) {
      grouped[cat] = [];
    }
    grouped[cat].push(values[idx]);
  });
  return grouped;
}

const groupedData = groupByCategory(splitDataResult.categoryData, splitDataResult.values);

// Calculate statistics for each category
const categoryNames = Object.keys(groupedData);
const aggregatedData = categoryNames.map(cat => {
  const vals = groupedData[cat];
  const count = vals.length;
  const sum = vals.reduce((a, b) => a + b, 0);
  const avg = sum / count;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const sorted = vals.slice().sort((a, b) => a - b);
  const median = count % 2 === 0 
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2 
    : sorted[Math.floor(count / 2)];
  
  return {
    category: cat,
    count: count,
    sum: sum.toFixed(2),
    min: min.toFixed(2),
    max: max.toFixed(2),
    avg: avg.toFixed(2),
    median: median.toFixed(2)
  };
});

// Prepare data for boxplot
const boxplotData = categoryNames.map(cat => {
  const vals = groupedData[cat].slice().sort((a, b) => a - b);
  const n = vals.length;
  const min = vals[0];
  const max = vals[n - 1];
  const q1 = vals[Math.floor(n * 0.25)];
  const median = n % 2 === 0 ? (vals[n / 2 - 1] + vals[n / 2]) / 2 : vals[Math.floor(n / 2)];
  const q3 = vals[Math.floor(n * 0.75)];
  
  return [min, q1, median, q3, max];
});

option = {
  title: [
    {
      text: 'Income since 1950',
      left: 'center'
    },
    {
      text: 'Aggregated Statistics',
      top: '55%',
      left: 'center',
      textStyle: {
        fontSize: 14
      }
    }
  ],
  tooltip: {
    trigger: 'item'
  },
  grid: [
    {
      left: '10%',
      right: '10%',
      top: '10%',
      height: '35%'
    },
    {
      left: '10%',
      right: '10%',
      top: '60%',
      height: '30%'
    }
  ],
  xAxis: [
    {
      type: 'category',
      data: categoryNames,
      boundaryGap: true,
      gridIndex: 0,
      axisLabel: {
        rotate: 45,
        interval: 0
      }
    },
    {
      type: 'category',
      data: categoryNames,
      gridIndex: 1,
      axisLabel: {
        rotate: 45,
        interval: 0
      }
    }
  ],
  yAxis: [
    {
      type: 'value',
      name: 'Value',
      splitArea: {
        show: true
      },
      gridIndex: 0
    },
    {
      type: 'value',
      name: 'Statistics',
      gridIndex: 1,
      splitArea: {
        show: true
      }
    }
  ],
  dataZoom: [
    {
      type: 'slider',
      xAxisIndex: [0, 1],
      start: 0,
      end: 100,
      bottom: 5
    }
  ],
  series: [
    {
      name: 'boxplot',
      type: 'boxplot',
      data: boxplotData,
      xAxisIndex: 0,
      yAxisIndex: 0,
      itemStyle: {
        color: '#b8c5f2',
        borderColor: '#5470c6'
      },
      tooltip: {
        formatter: function(param) {
          return [
            'Category: ' + param.name,
            'Upper: ' + param.data[4],
            'Q3: ' + param.data[3],
            'Median: ' + param.data[2],
            'Q1: ' + param.data[1],
            'Lower: ' + param.data[0]
          ].join('<br/>');
        }
      }
    },
    {
      name: 'Min',
      type: 'bar',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: aggregatedData.map(d => parseFloat(d.min)),
      itemStyle: { color: '#5470c6' }
    },
    {
      name: 'Max',
      type: 'bar',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: aggregatedData.map(d => parseFloat(d.max)),
      itemStyle: { color: '#91cc75' }
    },
    {
      name: 'Average',
      type: 'bar',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: aggregatedData.map(d => parseFloat(d.avg)),
      itemStyle: { color: '#fac858' }
    }
  ],
  legend: {
    top: '50%',
    data: ['Min', 'Max', 'Average']
  }
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
