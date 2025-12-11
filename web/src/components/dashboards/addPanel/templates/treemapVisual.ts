// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
category as "name",
parent_category as "parent",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Treemap Visual

// Example Query:
// SELECT
// category as "name",
// parent_category as "parent",
// value as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

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
  visualMap: {
    min: 0,
    max: 100,
    calculable: true,
    inRange: {
      color: ['#2E7D32', '#66BB6A', '#FFEB3B', '#FFA726', '#EF5350']
    }
  },
  series: [
    {
      name: 'Treemap',
      type: 'treemap',
      data: [treeData],
      visibleMin: 300,
      label: {
        show: true,
        formatter: '{b}'
      },
      itemStyle: {
        borderColor: 'black'
      },
      levels: [
        {
          itemStyle: {
            borderColor: '#555',
            borderWidth: 4,
            gapWidth: 4
          }
        }
      ]
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
