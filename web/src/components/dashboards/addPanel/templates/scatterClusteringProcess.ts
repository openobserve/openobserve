// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
x_value as "x_field",
y_value as "y_field",
cluster_id as "cluster"
FROM "default"`;

// Chart code template
const chartCode = `
// Clustering Process

// Example Query:
// SELECT
// x_value as "x_field",
// y_value as "y_field",
// cluster_id as "cluster"
// FROM "default"
//
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Clustering Process - Scatter with cluster visualization
//

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const xAlias = "x_field";
const yAlias = "y_field";
const clusterAlias = "cluster";
// -----------------------------------------------------------


const processData = (chartData, xKey, yKey, clusterKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return {};
  }

  const clusterMap = new Map();

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined) {
      const cluster = row[clusterKey] || 0;
      if (!clusterMap.has(cluster)) {
        clusterMap.set(cluster, []);
      }
      clusterMap.get(cluster).push([row[xKey], row[yKey]]);
    }
  });

  return clusterMap;
};

const clusterMap = processData(data[0], xAlias, yAlias, clusterAlias);

const seriesData = Array.from(clusterMap.entries()).map(([cluster, points]) => ({
  name: \`Cluster \${cluster}\`,
  type: 'scatter',
  data: points
}));

option = {
  tooltip: {
    trigger: 'item'
  },
  legend: {
    data: seriesData.map(s => s.name)
  },
  xAxis: {
    type: 'value',
    splitLine: {
      lineStyle: {
        type: 'dashed'
      }
    }
  },
  yAxis: {
    type: 'value',
    splitLine: {
      lineStyle: {
        type: 'dashed'
      }
    }
  },
  series: seriesData
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
