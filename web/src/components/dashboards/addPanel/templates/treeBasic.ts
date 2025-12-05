export const treeBasic = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Tree Chart - Hierarchical data visualization with tree structure
//
// Example Query:
// SELECT
//   parent_node as "parent_field",
//   child_node as "child_field",
//   sum(value) as "value_field"
// FROM "default"
// GROUP BY parent_field, child_field

// 'parentAlias' should match the column name for the parent node
const parentAlias = "parent_field";

// 'childAlias' should match the column name for the child node
const childAlias = "child_field";

// 'valueAlias' should match the column name for the value
const valueAlias = "value_field";

// Arrow function to process hierarchical data
const processData = (chartData, parentKey, childKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { name: 'root', children: [] };
  }

  const nodeMap = new Map();
  const rootNodes = [];

  chartData.forEach(row => {
    const parent = row[parentKey];
    const child = row[childKey];
    const value = row[valueKey] || 0;

    if (!nodeMap.has(parent)) {
      nodeMap.set(parent, { name: parent, children: [] });
    }

    if (!nodeMap.has(child)) {
      nodeMap.set(child, { name: child, value: value, children: [] });
    } else {
      nodeMap.get(child).value = value;
    }

    nodeMap.get(parent).children.push(nodeMap.get(child));
  });

  // Find root nodes (nodes that are never children)
  const childSet = new Set(chartData.map(row => row[childKey]));
  chartData.forEach(row => {
    const parent = row[parentKey];
    if (!childSet.has(parent) && !rootNodes.includes(nodeMap.get(parent))) {
      rootNodes.push(nodeMap.get(parent));
    }
  });

  return rootNodes.length === 1 ? rootNodes[0] : { name: 'root', children: rootNodes };
};

// Execute the function
const treeData = processData(data[0], parentAlias, childAlias, valueAlias);

option = {
  series: [
    {
      type: 'tree',
      data: [treeData],
      left: '2%',
      right: '2%',
      top: '8%',
      bottom: '20%',
      symbol: 'emptyCircle',
      orient: 'vertical',
      expandAndCollapse: true,
      label: {
        position: 'top',
        rotate: 0,
        verticalAlign: 'middle',
        align: 'center'
      },
      leaves: {
        label: {
          position: 'bottom',
          rotate: 0,
          verticalAlign: 'middle',
          align: 'center'
        }
      }
    }
  ]
};
`;
