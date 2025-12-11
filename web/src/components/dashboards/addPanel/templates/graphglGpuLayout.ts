// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// GraphGL GPU Layout

// Note: This chart uses GPU-accelerated graph layout. Modify the processData function below.

const processData = (data) => {
  const nodes = data.map((item, i) => ({
    id: item[0] || \`node\${i}\`,
    name: item[1] || \`Node \${i}\`,
    value: item[2] || Math.random() * 100,
    symbolSize: item[3] || 10
  }));
  
  const links = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    links.push({
      source: nodes[i].id,
      target: nodes[i + 1].id
    });
  }
  
  return { nodes, links };
};

const { nodes, links } = processData(queryResult);

option = {
  series: [{
    type: 'graphGL',
    nodes: nodes,
    edges: links,
    modularity: {
      resolution: 2,
      sort: true
    },
    lineStyle: {
      color: 'rgba(255,255,255,0.2)',
      width: 1
    },
    itemStyle: {
      opacity: 0.8
    },
    forceAtlas2: {
      steps: 5,
      stopThreshold: 20,
      jitterTolerence: 10,
      edgeWeight: [0.2, 1],
      gravity: 5,
      edgeWeightInfluence: 0,
      scalingRatio: 2,
      strongGravityMode: false,
      preventNodeOverlap: false
    }
  }]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
