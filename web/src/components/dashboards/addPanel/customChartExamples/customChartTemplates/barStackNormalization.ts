// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
histogram(_timestamp) as "x_axis_1",
sum(CASE WHEN kubernetes_namespace_name = 'A' THEN code ELSE 0 END) as "series_a",
sum(CASE WHEN kubernetes_namespace_name = 'B' THEN code ELSE 0 END) as "series_b",
sum(CASE WHEN kubernetes_namespace_name = 'C' THEN code ELSE 0 END) as "series_c"
FROM "default"
GROUP BY x_axis_1`;

// Chart code template
const chartCode = `
// Bar Stack Normalization

// Example Query:
// SELECT
// histogram(_timestamp) as "x_axis_1",
// sum(CASE WHEN kubernetes_namespace_name = 'A' THEN code ELSE 0 END) as "series_a",
// sum(CASE WHEN kubernetes_namespace_name = 'B' THEN code ELSE 0 END) as "series_b",
// sum(CASE WHEN kubernetes_namespace_name = 'C' THEN code ELSE 0 END) as "series_c"
// FROM "default"
// GROUP BY x_axis_1

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const xAlias = "x_axis_1";
const yAliases = ["series_a", "series_b", "series_c"];
// -----------------------------------------------------------

const processData = (chartData, xKey, yKeys) => {
  if (!chartData || !Array.isArray(chartData)) return { xData: [], seriesData: [] };

  const xData = [];
  const seriesData = yKeys.map(key => ({ 
    name: key, 
    data: [] 
  }));

  chartData.forEach(row => {
    if (row[xKey] !== undefined) {
      xData.push(row[xKey]);
      yKeys.forEach((key, index) => {
        seriesData[index].data.push(row[key] !== undefined ? row[key] : 0);
      });
    }
  });

  return { xData, seriesData };
};

const { xData, seriesData } = Array.isArray(data) && Array.isArray(data[0])
  ? processData(data[0], xAlias, yAliases)
  : { xData: [], seriesData: [] };

option = {
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    }
  },
  legend: {
    data: yAliases
  },
  xAxis: {
    type: 'category',
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: seriesData.map(s => ({
    name: s.name,
    type: 'bar',
    stack: 'total',
    label: {
      show: true
    },
    emphasis: {
      focus: 'series'
    },
    data: s.data
  }))
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
