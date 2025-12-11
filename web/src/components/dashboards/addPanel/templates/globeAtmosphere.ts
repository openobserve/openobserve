// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Globe Atmosphere

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const processData = (data) => {
  const globeData = data.map(item => ({
    name: item[0],
    value: [item[1] || 0, item[2] || 0, item[3] || 100]
  }));
const globeData = processData(queryResult);
// -----------------------------------------------------------

option = {
  globe: {
    baseTexture: 'https://echarts.apache.org/examples/data-gl/asset/earth.jpg',
    heightTexture: 'https://echarts.apache.org/examples/data-gl/asset/bathymetry_bw_composite_4k.jpg',
    displacementScale: 0.04,
    shading: 'realistic',
    environment: 'https://echarts.apache.org/examples/data-gl/asset/starfield.jpg',
    realisticMaterial: {
      roughness: 0.9
    },
    postEffect: {
      enable: true
    },
    light: {
      main: {
        intensity: 5,
        shadow: true
      },
      ambientCubemap: {
        texture: 'https://echarts.apache.org/examples/data-gl/asset/pisa.hdr',
        diffuseIntensity: 0.2
      }
    },
    atmosphere: {
      show: true
    },
    viewControl: {
      autoRotate: false
    }
  },
  series: []
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
