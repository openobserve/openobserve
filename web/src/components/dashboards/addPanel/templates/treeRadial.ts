// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
node_name as "name",
parent_name as "parent",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Tree Radial

// Example Query:
// SELECT
// node_name as "name",
// parent_name as "parent",
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

  return rootNodes.length > 0 ? rootNodes[0] : { name: 'root', children: [] };
};

const treeData = processData(data[0], nameAlias, parentAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item',
    triggerOn: 'mousemove'
  },
  series: [
    {
      type: 'tree',
      data: [treeData],
      top: '10%',
      left: '10%',
      bottom: '10%',
      right: '40%',
      symbolSize: 7,
      layout: 'radial',
      label: {
        position: 'radial',
        rotate: 'radial',
        verticalAlign: 'middle',
        align: 'right'
      },
      leaves: {
        label: {
          position: 'radial',
          rotate: 'radial',
          verticalAlign: 'middle',
          align: 'left'
        }
      },
      emphasis: {
        focus: 'descendant'
      },
      expandAndCollapse: true,
      animationDuration: 550,
      animationDurationUpdate: 750
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
