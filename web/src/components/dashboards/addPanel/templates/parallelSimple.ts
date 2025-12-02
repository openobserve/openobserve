export const parallelSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Parallel Coordinates - Multi-dimensional data visualization
//
// Example Query:
// SELECT metric1 as "m1", metric2 as "m2", metric3 as "m3", metric4 as "m4" FROM "default"

const metricAliases = ["m1","m2","m3","m4"];

const processData = (chartData, metricKeys) => {
  if (!chartData || !Array.isArray(chartData)) return { parallelData: [], dimensions: [] };

  const parallelData = chartData.map(row =>
    metricKeys.map(key => row[key] || 0)
  );

  const dimensions = metricKeys.map(key => ({ name: key, type: 'value' }));

  return { parallelData, dimensions };
};

const { parallelData, dimensions } = processData(data[0], metricAliases);

option = {
  parallelAxis: dimensions,
  series: [{
    type: 'parallel',
    data: parallelData
  }]
};
`;
