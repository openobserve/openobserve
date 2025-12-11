// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
node_name as "node",
x_position as "x",
y_position as "y",
source_node as "source",
target_node as "target"
FROM "default"`;

// Chart code template
const chartCode = `
// Graph on Cartesian

// Example Query:
// SELECT
// node_name as "node",
// x_position as "x",
// y_position as "y",
// source_node as "source",
// target_node as "target"
// FROM "default"
//
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Graph on Cartesian - Graph with Cartesian coordinate system
//

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const nodeAlias = "node";
const xAlias = "x";
const yAlias = "y";
const sourceAlias = "source";
const targetAlias = "target";
// -----------------------------------------------------------


const processData = (chartData, nodeKey, xKey, yKey, sourceKey, targetKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { nodes: [], links: [] };
  }

  const nodeMap = new Map();
  const links = [];

  chartData.forEach(row => {
    if (row[nodeKey] !== undefined) {
      nodeMap.set(row[nodeKey], {
        name: row[nodeKey],
        x: row[xKey] || 0,
        y: row[yKey] || 0
      });
    }
    if (row[sourceKey] !== undefined && row[targetKey] !== undefined) {
      links.push({
        source: row[sourceKey],
        target: row[targetKey]
      });
    }
  });

  const nodes = Array.from(nodeMap.values());

  return { nodes, links };
};

const { nodes, links } = processData(data[0], nodeAlias, xAlias, yAlias, sourceAlias, targetAlias);

option = {
  tooltip: {},
  xAxis: {
    type: 'value'
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      type: 'graph',
      layout: 'none',
      coordinateSystem: 'cartesian2d',
      data: nodes,
      links: links,
      label: {
        show: true,
        position: 'right'
      },
      roam: true
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
