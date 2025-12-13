// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
kubernetes_namespace_name as "name",
count(_timestamp) as "value"
FROM "default"
GROUP BY kubernetes_namespace_name`;

// Chart code template
const chartCode = `
// Pie with Border

// Example Query:
// SELECT
// kubernetes_namespace_name as "name",
// count(_timestamp) as "value"
// FROM "default"
// GROUP BY kubernetes_namespace_name

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const nameAlias = "name";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, nameKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[nameKey] !== undefined && row[valueKey] !== undefined) {
      result.push({
        name: row[nameKey],
        value: row[valueKey]
      });
    }
  });

  return result;
};

const pieData = processData(data[0], nameAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item'
  },
  legend: {
    top: '90%',
    left: 'center'
  },
  series: [
    {
      name: 'Data',
      type: 'pie',
      radius: ['40%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 10,
        borderColor: '#fff',
        borderWidth: 2
      },
      label: {
        show: false,
        position: 'center'
      },
      emphasis: {
        label: {
          show: true,
          fontSize: 20,
          fontWeight: 'bold'
        }
      },
      labelLine: {
        show: false
      },
      data: pieData
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
