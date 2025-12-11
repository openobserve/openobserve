// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
kubernetes_namespace_name as "x_axis_1",
_timestamp as "x_axis_2",
kubernetes_pod_name as "y_axis_1"
FROM "default"`;

// Chart code template
const chartCode = `
// Multiple X Axes

// Example Query:
// SELECT
// kubernetes_namespace_name as "x_axis_1",
// _timestamp as "x_axis_2",
// kubernetes_pod_name as "y_axis_1"
// FROM "default"

// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const xAlias1 = "x_axis_1";
const xAlias2 = "x_axis_2";
const yAlias = "y_axis_1";
// -----------------------------------------------------------


const processData = (chartData, xKey1, xKey2, yKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { xData1: [], xData2: [], yData: [] };
  }

  const xData1 = [];
  const xData2 = [];
  const yData = [];

  chartData.forEach(row => {
    if (row[xKey1] !== undefined) {
      xData1.push(row[xKey1]);
      xData2.push(row[xKey2] !== undefined ? row[xKey2] : 0);
      yData.push(row[yKey] !== undefined ? row[yKey] : 0);
    }
  });

  return { xData1, xData2, yData };
};

const { xData1, xData2, yData } = processData(data[0], xAlias1, xAlias2, yAlias);

option = {
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross'
    }
  },
  grid: {
    bottom: 120
  },
  xAxis: [
    {
      type: 'category',
      data: xData1,
      axisPointer: {
        type: 'shadow'
      }
    },
    {
      type: 'category',
      gridIndex: 0,
      data: xData2,
      position: 'bottom',
      offset: 50
    }
  ],
  yAxis: {
    type: 'value',
    name: 'Value'
  },
  series: [
    {
      name: 'Data',
      type: 'line',
      data: yData
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
