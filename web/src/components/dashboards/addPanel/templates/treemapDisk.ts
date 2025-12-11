// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
file_path as "name",
parent_path as "parent",
size as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Treemap Disk

// Example Query:
// SELECT
// file_path as "name",
// parent_path as "parent",
// size as "value"
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
    return { name: 'Disk', children: [] };
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

  return { name: 'Disk', children: rootNodes };
};

const treeData = processData(data[0], nameAlias, parentAlias, valueAlias);

option = {
  tooltip: {
    formatter: (info) => {
      const value = info.value;
      const treePathInfo = info.treePathInfo;
      const treePath = [];
      for (let i = 1; i < treePathInfo.length; i++) {
        treePath.push(treePathInfo[i].name);
      }
      return [
        '<div class="tooltip-title">' + treePath.join('/') + '</div>',
        'Disk Usage: ' + value + ' KB'
      ].join('');
    }
  },
  series: [
    {
      name: 'Disk Usage',
      type: 'treemap',
      data: [treeData],
      visibleMin: 300,
      label: {
        show: true,
        formatter: '{b}'
      },
      itemStyle: {
        borderColor: '#fff'
      },
      levels: [
        {
          itemStyle: {
            borderColor: '#777',
            borderWidth: 0,
            gapWidth: 1
          },
          upperLabel: {
            show: false
          }
        },
        {
          itemStyle: {
            borderColor: '#555',
            borderWidth: 5,
            gapWidth: 1
          },
          emphasis: {
            itemStyle: {
              borderColor: '#ddd'
            }
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
