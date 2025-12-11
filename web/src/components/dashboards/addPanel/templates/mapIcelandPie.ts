// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
location_name as "location",
latitude as "lat",
longitude as "lon",
category as "category",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Pie Charts on GEO Map

// Example Query:
// SELECT
// location_name as "location",
// latitude as "lat",
// longitude as "lon",
// category as "category",
// value as "value"
// FROM "default"
//
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Pie Charts on GEO Map - Pie charts positioned on geographic locations
//

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const locationAlias = "location";
const latAlias = "lat";
const lonAlias = "lon";
const categoryAlias = "category";
const valueAlias = "value";
// -----------------------------------------------------------


const processData = (chartData, locKey, latKey, lonKey, catKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { locations: [], seriesData: [] };
  }

  const locationMap = new Map();

  chartData.forEach(row => {
    const loc = row[locKey];
    const lat = row[latKey];
    const lon = row[lonKey];
    const cat = row[catKey];
    const val = row[valueKey] || 0;

    if (!locationMap.has(loc)) {
      locationMap.set(loc, { lat, lon, data: [] });
    }
    locationMap.get(loc).data.push({ name: cat, value: val });
  });

  const locations = Array.from(locationMap.keys());
  const seriesData = locations.map(loc => {
    const locData = locationMap.get(loc);
    return {
      type: 'pie',
      radius: 30,
      center: [locData.lon, locData.lat],
      data: locData.data
    };
  });

  return { locations, seriesData };
};

const { locations, seriesData } = processData(data[0], locationAlias, latAlias, lonAlias, categoryAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'item'
  },
  series: seriesData
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
