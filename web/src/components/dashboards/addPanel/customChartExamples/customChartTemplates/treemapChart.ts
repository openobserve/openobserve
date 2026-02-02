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
    } else {
      // If node already exists, update its value (for parent aggregation)
      nodeMap.get(name).value = value;
    }

    if (!parent || parent === name) {
      rootNodes.push(nodeMap.get(name));
    } else {
      if (!nodeMap.has(parent)) {
        nodeMap.set(parent, { name: parent, value: 0, children: [] });
      }
      nodeMap.get(parent).children.push(nodeMap.get(name));
    }
  });

  // Aggregate parent values as the sum of their children's values
  function aggregateValues(node) {
    if (!node.children || node.children.length === 0) {
      return node.value || 0;
    }
    node.value = node.children.reduce((sum, child) => sum + aggregateValues(child), 0);
    return node.value;
  }
  rootNodes.forEach(aggregateValues);

  return { name: 'root', children: rootNodes };
};

const treeData = Array.isArray(data) && data.length > 0
  ? processData(data[0], nameAlias, parentAlias, valueAlias)
  : { name: 'root', children: [] };

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
  query: exampleQuery,
};
