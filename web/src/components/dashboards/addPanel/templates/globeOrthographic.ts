// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT latitude, longitude, value FROM your_table WHERE timestamp >= now() - interval '1 hour'`;

// Chart code template
const chartCode = `
// Globe Orthographic

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------
const latAlias = 'latitude';   // First column: latitude coordinate
const lonAlias = 'longitude';  // Second column: longitude coordinate
const valueAlias = 'value';    // Third column: data value (optional)

const processData = (data) => {
  // Transform data to globe-compatible format: [lon, lat, value]
  return data.map(item => [item[lonAlias], item[latAlias], item[valueAlias] || 1]);
};

const globeData = processData(queryResult);
// -----------------------------------------------------------

option = {
  globe: {
    baseTexture: 'https://echarts.apache.org/examples/data-gl/asset/world.topo.bathy.200401.jpg',
    shading: 'lambert',
    light: {
      ambient: {
        intensity: 0.4
      },
      main: {
        intensity: 0.4
      }
    },
    viewControl: {
      projection: 'orthographic',
      autoRotate: true,
      autoRotateAfterStill: 3
    }
  }
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
