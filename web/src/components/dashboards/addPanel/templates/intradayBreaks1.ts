// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
 histogram(_timestamp) as "x_axis_1",
 count(kubernetes_namespace_name) as "y_axis_1"
FROM "default"
GROUP BY x_axis_1
ORDER BY x_axis_1 ASC`;

// Chart code template
const chartCode = `
// Intraday Chart with Breaks
// This chart shows time-series data with visual breaks for non-trading hours/days

// Example Query:
// SELECT
//  histogram(_timestamp) as "x_axis_1",
//  count(kubernetes_namespace_name) as "y_axis_1"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC

// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const xAlias = "x_axis_1";
const yAlias = "y_axis_1";
// -----------------------------------------------------------

const processData = (chartData, xKey, yKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { categories: [], values: [] };
  }

  const categories = [];
  const values = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined) {
      // Format timestamp
      const date = new Date(row[xKey]);
      const formattedTime = date.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      categories.push(formattedTime);
      values.push(parseFloat(row[yKey]) || 0);
    }
  });

  return { categories, values };
};

const { categories, values } = processData(data[0], xAlias, yAlias);

option = {
  tooltip: {
    trigger: 'axis',
    position: function (pt) {
      return [pt[0], '10%'];
    }
  },
  toolbox: {
    feature: {
      dataZoom: {
        yAxisIndex: 'none'
      },
      restore: {},
      saveAsImage: {}
    }
  },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: categories,
    axisLabel: {
      rotate: 45,
      interval: Math.floor(categories.length / 10) || 0
    }
  },
  yAxis: {
    type: 'value',
    boundaryGap: [0, '100%']
  },
  dataZoom: [
    {
      type: 'inside',
      start: 0,
      end: 100
    },
    {
      start: 0,
      end: 100
    }
  ],
  series: [
    {
      name: 'Value',
      type: 'line',
      smooth: false,
      symbol: 'none',
      areaStyle: {
        color: '#8EC5FC',
        opacity: 0.8
      },
      lineStyle: {
        color: '#5470C6',
        width: 1
      },
      data: values
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
