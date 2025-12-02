export const funnelSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Basic Funnel Chart
//
// Example Query:
// SELECT stage as "name_field", count(*) as "value_field" FROM "default" GROUP BY name_field ORDER BY value_field DESC

const nameAlias = "name_field";
const valueAlias = "value_field";

const processData = (chartData, nameKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) return { funnelData: [] };

  const funnelData = [];
  chartData.forEach(row => {
    if (row[nameKey] !== undefined && row[valueKey] !== undefined) {
      funnelData.push({ name: row[nameKey], value: row[valueKey] });
    }
  });
  return { funnelData };
};

const { funnelData } = processData(data[0], nameAlias, valueAlias);

option = {
  series: [{
    type: 'funnel',
    data: funnelData
  }]
};
`;
