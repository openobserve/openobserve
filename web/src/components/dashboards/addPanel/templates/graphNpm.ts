// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
package as "source",
dependency as "target"
FROM "default"`;

// Chart code template
const chartCode = `
// NPM Dependencies (large

// Example Query:
// SELECT
// package as "source",
// dependency as "target"
// FROM "default"
//
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// NPM Dependencies (large-scale graph)
//

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const sourceAlias = "source";
const targetAlias = "target";
// -----------------------------------------------------------


const processData = (chartData, sourceKey, targetKey) => {
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
        target: row[targetKey]
      });
    }
  });

  const nodes = Array.from(nodeSet).map(name => ({ 
    name, 
    symbolSize: 5,
    value: 1
  }));

  return { nodes, links };
};

const { nodes, links } = processData(data[0], sourceAlias, targetAlias);

option = {
  tooltip: {},
  animationDuration: 1500,
  animationEasingUpdate: 'quinticInOut',
  series: [
    {
      type: 'graph',
      layout: 'force',
      data: nodes,
      links: links,
      roam: true,
      label: {
        show: false
      },
      emphasis: {
        focus: 'adjacency',
        label: {
          show: true,
          position: 'right'
        }
      },
      force: {
        repulsion: 50,
        edgeLength: 20
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
