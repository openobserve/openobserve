// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Custom Wind Barb

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const processData = (data) => {
  const windData = data.map(item => ({
    value: [item[0], item[1]],
    speed: item[2] || 10,
    direction: item[3] || 45
  }));
const windData = processData(queryResult);
// -----------------------------------------------------------

option = {
  xAxis: {type: 'value'},
  yAxis: {type: 'value'},
  series: [{
    type: 'custom',
    renderItem: (params, api) => {
      const point = api.coord([api.value(0), api.value(1)]);
      const speed = api.value(2) || 10;
      const direction = api.value(3) || 45;
      
      return {
        type: 'group',
        children: [{
          type: 'circle',
          shape: {cx: 0, cy: 0, r: 3},
          style: {fill: '#5470c6'},
          x: point[0],
          y: point[1]
        }, {
          type: 'line',
          shape: {
            x1: 0, y1: 0,
            x2: Math.cos(direction * Math.PI / 180) * speed,
            y2: Math.sin(direction * Math.PI / 180) * speed
          },
          style: {stroke: '#5470c6', lineWidth: 2},
          x: point[0],
          y: point[1]
        }]
      };
    },
    data: windData
  }]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
