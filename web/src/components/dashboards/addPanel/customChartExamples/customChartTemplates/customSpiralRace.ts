// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT kubernetes_container_name as name, COUNT(*) as value
FROM default
GROUP BY kubernetes_container_name
ORDER BY value DESC
LIMIT 15`;

// Chart code template
const chartCode = `
// Custom Spiral Race

// Example Query:
// SELECT kubernetes_container_name as name, COUNT(*) as value
// FROM default
// GROUP BY kubernetes_container_name
// ORDER BY value DESC
// LIMIT 15

// Note: This chart uses custom rendering. Modify the processData function below.

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const nameAlias = 'name';   // First column: item name
const valueAlias = 'value'; // Second column: numeric value
// -----------------------------------------------------------

const processData = (chartData) => {
  const spiralData = chartData.map((item, i) => ({
    name: item[nameAlias] || 'Item ' + i,
    value: item[valueAlias] || i * 10,
    angle: i * 30
  }));
  
  return spiralData;
};

// Note: 'data' is a global variable containing the query results.
// We access 'data[0]' because the results are often nested in the first element.
const spiralData = processData(data[0]);

option = {
  polar: {},
  angleAxis: {
    type: 'value',
    startAngle: 0
  },
  radiusAxis: {},
  series: [{
    type: 'custom',
    coordinateSystem: 'polar',
    renderItem: (params, api) => {
      const valOnAngleAxis = api.value(1);
      const valOnRadiusAxis = api.value(0);
      const coordAngleRad = api.coord([valOnAngleAxis, valOnRadiusAxis]);
      
      return {
        type: 'circle',
        shape: {
          cx: params.coordSys.cx + coordAngleRad[0] * Math.cos(coordAngleRad[1]),
          cy: params.coordSys.cy + coordAngleRad[0] * Math.sin(coordAngleRad[1]),
          r: 5
        },
        style: api.style({fill: '#5470c6'})
      };
    },
    data: spiralData.map((d, i) => [i, d.value])
  }]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
