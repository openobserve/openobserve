export const graphForce = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Force-Directed Graph - Network visualization with force layout
//
// Example Query:
// SELECT
//   source_node as "source_field",
//   target_node as "target_field",
//   edge_value as "value_field"
// FROM "default"
// GROUP BY source_field, target_field, value_field

// 'sourceAlias' should match the column name for the source node
const sourceAlias = "source_field";

// 'targetAlias' should match the column name for the target node
const targetAlias = "target_field";

// 'valueAlias' should match the column name for the edge value
const valueAlias = "value_field";

// Arrow function to process graph data
const processData = (chartData, srcKey, tgtKey, valKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { nodes: [], links: [] };
  }

  const nodeSet = new Set();
  const links = [];

  chartData.forEach(row => {
    nodeSet.add(row[srcKey]);
    nodeSet.add(row[tgtKey]);

    links.push({
      source: row[srcKey],
      target: row[tgtKey],
      value: row[valKey] || 1
    });
  });

  const nodes = Array.from(nodeSet).map(name => ({
    name: name,
    symbolSize: 30
  }));

  return { nodes, links };
};

// Execute the function
const { nodes, links } = processData(data[0], sourceAlias, targetAlias, valueAlias);

option = {
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
        repulsion: 100,
        edgeLength: 100
      }
    }
  ]
};
`;
