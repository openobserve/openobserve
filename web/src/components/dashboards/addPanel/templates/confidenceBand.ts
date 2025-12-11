// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
kubernetes_pod_id as "x_axis_1",
_timestamp as "y_value",
kubernetes_namespace_name as "upper",
kubernetes_pod_name as "lower"
FROM "default"`;

// Chart code template
const chartCode = `
// Confidence Band

// Example Query:
// SELECT
// kubernetes_pod_id as "x_axis_1",
// _timestamp as "y_value",
// kubernetes_namespace_name as "upper",
// kubernetes_pod_name as "lower"
// FROM "default"

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const xAlias = "x_axis_1";
const yAlias = "y_value";
const upperAlias = "upper";
const lowerAlias = "lower";
// -----------------------------------------------------------


const processData = (chartData, xKey, yKey, upperKey, lowerKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { xData: [], yData: [], upperData: [], lowerData: [] };
  }

  const xData = [];
  const yData = [];
  const upperData = [];
  const lowerData = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined) {
      xData.push(row[xKey]);
      yData.push(row[yKey] !== undefined ? row[yKey] : 0);
      upperData.push(row[upperKey] !== undefined ? row[upperKey] : 0);
      lowerData.push(row[lowerKey] !== undefined ? row[lowerKey] : 0);
    }
  });

  return { xData, yData, upperData, lowerData };
};

const { xData, yData, upperData, lowerData } = processData(data[0], xAlias, yAlias, upperAlias, lowerAlias);

option = {
  tooltip: {
    trigger: 'axis'
  },
  xAxis: {
    type: 'category',
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      name: 'Lower Bound',
      type: 'line',
      data: lowerData,
      lineStyle: {
        opacity: 0
      },
      stack: 'confidence-band',
      symbol: 'none'
    },
    {
      name: 'Upper Bound',
      type: 'line',
      data: upperData.map((val, idx) => val - lowerData[idx]),
      lineStyle: {
        opacity: 0
      },
      areaStyle: {
        color: '#ccc'
      },
      stack: 'confidence-band',
      symbol: 'none'
    },
    {
      name: 'Mean',
      type: 'line',
      data: yData,
      itemStyle: {
        color: '#333'
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
