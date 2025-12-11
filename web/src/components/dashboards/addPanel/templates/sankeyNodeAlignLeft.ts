// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
source_node as "source",
target_node as "target",
flow_value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Sankey Node Align Left

// Example Query:
// SELECT
// source_node as "source",
// target_node as "target",
// flow_value as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const sourceAlias = "source";
const targetAlias = "target";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, sourceKey, targetKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { nodes: [], links: [] };
  }

  const nodeSet = new Set();
  const links = [];

  chartData.forEach(row => {
    if (row[sourceKey] !== undefined && row[targetKey] !== undefined) {
      nodeSet.add(row[sourceKey]);
      nodeSet.add(row[targetKey]);
      links.push({
        source: row[sourceKey],
        target: row[targetKey],
        value: row[valueKey] || 1
      });
    }
  });

  const nodes = Array.from(nodeSet).map(name => ({ name }));

  return { nodes, links };
};

const { nodes, links } = processData(data[0], sourceAlias, targetAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item',
    triggerOn: 'mousemove'
  },
  series: [
    {
      type: 'sankey',
      nodeAlign: 'left',
      emphasis: {
        focus: 'adjacency'
      },
      data: nodes,
      links: links,
      lineStyle: {
        curveness: 0.5
      }
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
