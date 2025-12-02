export const sankeySimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Basic Sankey Diagram - Shows flow between nodes
//
// Example Query:
// SELECT source as "source", target as "target", value as "value" FROM "default"

const sourceAlias = "source";
const targetAlias = "target";
const valueAlias = "value";

const processData = (chartData, srcKey, tgtKey, valKey) => {
  if (!chartData || !Array.isArray(chartData)) return { nodes: [], links: [] };

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

  const nodes = Array.from(nodeSet).map(name => ({ name }));

  return { nodes, links };
};

const { nodes, links } = processData(data[0], sourceAlias, targetAlias, valueAlias);

option = {
  series: [{
    type: 'sankey',
    data: nodes,
    links: links,
    emphasis: { focus: 'adjacency' }
  }]
};
`;
