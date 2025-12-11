// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
node_name as "name",
parent_name as "parent",
tree_type as "type",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Tree Legend

// Example Query:
// SELECT
// node_name as "name",
// parent_name as "parent",
// tree_type as "type",
// value as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const nameAlias = "name";
const parentAlias = "parent";
const typeAlias = "type";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, nameKey, parentKey, typeKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const treeMap = new Map();

  chartData.forEach(row => {
    const name = row[nameKey];
    const parent = row[parentKey];
    const type = row[typeKey] || 'default';
    const value = row[valueKey] || 0;

    if (!treeMap.has(type)) {
      treeMap.set(type, { name: type, children: [] });
    }

    const tree = treeMap.get(type);
    const node = { name, value };

    if (!parent || parent === name) {
      tree.children.push(node);
    }
  });

  return Array.from(treeMap.values());
};

const trees = processData(data[0], nameAlias, parentAlias, typeAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item',
    triggerOn: 'mousemove'
  },
  legend: {
    top: '2%',
    left: '3%',
    orient: 'vertical',
    data: trees.map(t => t.name),
    borderColor: '#c23531'
  },
  series: trees.map((tree, idx) => ({
    type: 'tree',
    name: tree.name,
    data: [tree],
    top: \`\${idx * 30 + 20}%\`,
    left: '20%',
    bottom: '1%',
    right: '20%',
    symbolSize: 7,
    label: {
      position: 'left',
      verticalAlign: 'middle',
      align: 'right',
      fontSize: 9
    },
    leaves: {
      label: {
        position: 'right',
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
  }))
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
