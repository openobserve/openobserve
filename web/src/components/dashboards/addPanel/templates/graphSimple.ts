export const graphSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Simple Network Graph - Network/relationship visualization
//
// Example Query:
// SELECT node_id as "id", node_name as "name", category as "category" FROM nodes
// Also need edges: SELECT source_id, target_id FROM edges

const idAlias = "id";
const nameAlias = "name";
const categoryAlias = "category";

const processData = (nodeData, edgeData, idKey, nameKey, catKey) => {
  if (!nodeData || !Array.isArray(nodeData)) return { nodes: [], links: [] };

  const nodes = nodeData.map(row => ({
    id: row[idKey],
    name: row[nameKey],
    category: row[catKey]
  }));

  const links = edgeData ? edgeData.map(row => ({
    source: row.source_id,
    target: row.target_id
  })) : [];

  return { nodes, links };
};

// Note: You may need to provide edge data separately
const { nodes, links } = processData(data[0], [], idAlias, nameAlias, categoryAlias);

option = {
  series: [{
    type: 'graph',
    layout: 'force',
    data: nodes,
    links: links,
    force: { repulsion: 100 }
  }]
};
`;
