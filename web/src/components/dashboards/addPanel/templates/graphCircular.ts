export const graphCircular = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Circular Graph - Network visualization with circular layout
//
// Example Query:
// SELECT
//   source_node as "source_field",
//   target_node as "target_field"
// FROM "default"
// GROUP BY source_field, target_field

// 'sourceAlias' should match the column name for the source node
const sourceAlias = "source_field";

// 'targetAlias' should match the column name for the target node
const targetAlias = "target_field";

// Arrow function to process graph data
const processData = (chartData, srcKey, tgtKey) => {
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
      target: row[tgtKey]
    });
  });

  const nodes = Array.from(nodeSet).map(name => ({
    name: name,
    symbolSize: 20
  }));

  return { nodes, links };
};

// Execute the function
const { nodes, links } = processData(data[0], sourceAlias, targetAlias);

option = {
  series: [
    {
      type: 'graph',
      layout: 'circular',
      data: nodes,
      links: links,
      roam: true,
      label: {
        show: true,
        position: 'right'
      },
      lineStyle: {
        color: 'source',
        curveness: 0.3
      }
    }
  ]
};
`;
