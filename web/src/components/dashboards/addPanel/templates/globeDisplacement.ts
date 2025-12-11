// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Globe Displacement

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const processData = (data) => {
  return data;
const globeData = processData(queryResult);
// -----------------------------------------------------------

option = {
  globe: {
    baseTexture: 'https://echarts.apache.org/examples/data-gl/asset/world.topo.bathy.200401.jpg',
    heightTexture: 'https://echarts.apache.org/examples/data-gl/asset/bathymetry_bw_composite_4k.jpg',
    displacementScale: 0.1,
    shading: 'realistic',
    environment: '#000',
    realisticMaterial: {
      roughness: 0.2,
      metalness: 0
    },
    postEffect: {
      enable: true,
      bloom: {
        enable: false
      }
    },
    light: {
      main: {
        intensity: 4,
        shadow: false
      },
      ambient: {
        intensity: 0
      }
    },
    viewControl: {
      autoRotate: true,
      autoRotateSpeed: 1
    }
  }
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
