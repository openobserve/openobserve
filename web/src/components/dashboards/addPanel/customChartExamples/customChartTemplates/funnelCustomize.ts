// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT 'Namespaces' as stage, COUNT(DISTINCT kubernetes_namespace_name) as value
FROM default
UNION ALL
SELECT 'Pods' as stage, COUNT(DISTINCT kubernetes_pod_name) as value
FROM default
UNION ALL
SELECT 'Containers' as stage, COUNT(DISTINCT kubernetes_container_name) as value
FROM default`;

// Chart code template
const chartCode = `
// Funnel Customize

// Example Query:
// SELECT 'Namespaces' as stage, COUNT(DISTINCT kubernetes_namespace_name) as value
// FROM default
// UNION ALL
// SELECT 'Pods' as stage, COUNT(DISTINCT kubernetes_pod_name) as value
// FROM default
// UNION ALL
// SELECT 'Containers' as stage, COUNT(DISTINCT kubernetes_container_name) as value
// FROM default

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const stageAlias = "stage";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, stageKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[stageKey] !== undefined && row[valueKey] !== undefined) {
      result.push({
        name: row[stageKey],
        value: row[valueKey]
      });
    }
  });

  return result;
};

const funnelData = processData(data[0], stageAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item',
    formatter: '{a} <br/>{b} : {c}%'
  },
  legend: {
    data: funnelData.map(d => d.name)
  },
  series: [
    {
      name: 'Funnel',
      type: 'funnel',
      left: '10%',
      top: 60,
      bottom: 60,
      width: '80%',
      min: 0,
      max: 100,
      minSize: '0%',
      maxSize: '100%',
      sort: 'descending',
      gap: 2,
      label: {
        show: true,
        position: 'inside'
      },
      labelLine: {
        length: 10,
        lineStyle: {
          width: 1,
          type: 'solid'
        }
      },
      itemStyle: {
        borderColor: '#fff',
        borderWidth: 1
      },
      emphasis: {
        label: {
          fontSize: 20
        }
      },
      data: funnelData
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
