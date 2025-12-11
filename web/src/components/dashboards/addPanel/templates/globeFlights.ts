// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Globe Flights

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const processData = (data) => {
  const routes = data.map(item => ({
    fromName: item[0],
    toName: item[1],
    coords: [[item[2] || 0, item[3] || 0], [item[4] || 0, item[5] || 0]]
  }));
const routes = processData(queryResult);
// -----------------------------------------------------------

option = {
  globe: {
    baseTexture: 'https://echarts.apache.org/examples/data-gl/asset/earth.jpg',
    shading: 'realistic',
    environment: 'https://echarts.apache.org/examples/data-gl/asset/starfield.jpg',
    atmosphere: {
      show: true
    },
    viewControl: {
      autoRotate: false
    }
  },
  series: [{
    type: 'lines3D',
    coordinateSystem: 'globe',
    effect: {
      show: true,
      period: 2,
      trailLength: 0.7,
      color: '#ff0',
      symbolSize: 3
    },
    blendMode: 'lighter',
    lineStyle: {
      width: 1,
      color: 'rgb(50, 50, 150)',
      opacity: 0.1
    },
    data: routes
  }]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
