export const chordSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Chord Diagram - Shows relationships between entities
//
// Example Query:
// SELECT
//   source as "source_field",
//   target as "target_field",
//   count(*) as "value_field"
// FROM "default"
// GROUP BY source_field, target_field

// 'sourceAlias' should match the column name for the source
const sourceAlias = "source_field";

// 'targetAlias' should match the column name for the target
const targetAlias = "target_field";

// 'valueAlias' should match the column name for the value
const valueAlias = "value_field";

// Arrow function to process chord data
const processData = (chartData, srcKey, tgtKey, valKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { nodes: [], matrix: [] };
  }

  const nodeSet = new Set();
  const edgeMap = new Map();

  chartData.forEach(row => {
    const src = row[srcKey];
    const tgt = row[tgtKey];
    const val = row[valKey] || 0;

    nodeSet.add(src);
    nodeSet.add(tgt);

    const key = \`\${src}-\${tgt}\`;
    edgeMap.set(key, val);
  });

  const nodes = Array.from(nodeSet);
  const matrix = [];

  nodes.forEach(src => {
    const row = [];
    nodes.forEach(tgt => {
      const key = \`\${src}-\${tgt}\`;
      row.push(edgeMap.get(key) || 0);
    });
    matrix.push(row);
  });

  return {
    nodes: nodes.map(name => ({ name })),
    matrix
  };
};

// Execute the function
const { nodes, matrix } = processData(data[0], sourceAlias, targetAlias, valueAlias);

option = {
  series: [
    {
      type: 'chord',
      data: nodes,
      matrix: matrix,
      radius: ['65%', '75%'],
      itemStyle: {
        borderWidth: 0.5,
        borderColor: '#333'
      },
      label: {
        show: true
      }
    }
  ]
};
`;
