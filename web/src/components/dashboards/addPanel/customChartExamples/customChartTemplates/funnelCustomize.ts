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
  // Find the first value as the base (top of funnel)
  const base = chartData.length > 0 ? Number(chartData[0][valueKey]) : 0;
  if (!base) return [];
  return chartData.map(row => {
    if (row[stageKey] !== undefined && row[valueKey] !== undefined) {
      return {
        name: row[stageKey],
        value: Math.round((Number(row[valueKey]) / base) * 100)
      };
    }
    return null;
  }).filter(Boolean);
};

const funnelData = processData(data[0], stageAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item',
    formatter: '{a} <br/>{b} : {c}'
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
