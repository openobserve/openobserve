// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT kubernetes_namespace_name as name, '' as parent, COUNT(DISTINCT kubernetes_pod_name) as value
FROM default
GROUP BY kubernetes_namespace_name
UNION ALL
SELECT kubernetes_pod_name as name, kubernetes_namespace_name as parent, COUNT(*) as value
FROM default
GROUP BY kubernetes_pod_name, kubernetes_namespace_name
LIMIT 50`;

// Chart code template
const chartCode = `
// Treemap chart

// Example Query:
// SELECT kubernetes_namespace_name as name, '' as parent, COUNT(DISTINCT kubernetes_pod_name) as value
// FROM default
// GROUP BY kubernetes_namespace_name
// UNION ALL
// SELECT kubernetes_pod_name as name, kubernetes_namespace_name as parent, COUNT(*) as value
// FROM default
// GROUP BY kubernetes_pod_name, kubernetes_namespace_name
// LIMIT 50

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const nameAlias = "name";
const parentAlias = "parent";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, nameKey, parentKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { name: 'root', children: [] };
  }

  const nodeMap = new Map();
  const rootNodes = [];

  chartData.forEach(row => {
    const name = row[nameKey];
    const parent = row[parentKey];
    const value = row[valueKey] || 0;

    if (!nodeMap.has(name)) {
      nodeMap.set(name, { name, value, children: [] });
    }

    if (!parent || parent === name) {
      rootNodes.push(nodeMap.get(name));
    } else {
      if (!nodeMap.has(parent)) {
        nodeMap.set(parent, { name: parent, children: [] });
      }
      nodeMap.get(parent).children.push(nodeMap.get(name));
    }
  });

  return { name: 'root', children: rootNodes };
};

const treeData = processData(data[0], nameAlias, parentAlias, valueAlias);

option = {
  tooltip: {},
  series: [
    {
      type: 'treemap',
      data: [treeData],
      universalTransition: {
        enabled: true
      },
      label: {
        show: true
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
