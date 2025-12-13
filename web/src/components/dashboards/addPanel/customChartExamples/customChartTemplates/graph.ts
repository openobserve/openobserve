// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT 
  kubernetes_namespace_name as source,
  kubernetes_pod_name as target,
  COUNT(*) as value
FROM default
GROUP BY kubernetes_namespace_name, kubernetes_pod_name
LIMIT 50`;

// Chart code template
const chartCode = `
// Graph on Cartesian

// Example Query:
// SELECT 
//   kubernetes_namespace_name as source,
//   kubernetes_pod_name as target,
//   COUNT(*) as value
// FROM default
// GROUP BY kubernetes_namespace_name, kubernetes_pod_name
// LIMIT 50

// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const sourceAlias = "source";
const targetAlias = "target";
const valueAlias = "value";
// -----------------------------------------------------------


const processData = (chartData, sourceKey, targetKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { nodes: [], links: [] };
  }

  const nodeSet = new Set();
  const links = [];

  chartData.forEach(row => {
    if (row[sourceKey] !== undefined && row[targetKey] !== undefined) {
      nodeSet.add(row[sourceKey]);
      nodeSet.add(row[targetKey]);
      links.push({
        source: row[sourceKey],
        target: row[targetKey],
        value: row[valueKey] || 1
      });
    }
  });

  const nodes = Array.from(nodeSet).map(name => ({ name, symbolSize: 10 }));

  return { nodes, links };
};

const { nodes, links } = processData(data[0], sourceAlias, targetAlias, valueAlias);

option = {
  tooltip: {},
  legend: {
    data: []
  },
  series: [
    {
      type: 'graph',
      layout: 'force',
      data: nodes,
      links: links,
      roam: true,
      label: {
        show: true,
        position: 'right'
      },
      force: {
        repulsion: 100
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
