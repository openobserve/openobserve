export const funnelAlign = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Funnel Comparison Chart - Compare two funnels side by side
//
// Example Query:
// SELECT stage as "name_field", count(*) as "value_field" FROM "default" GROUP BY name_field

const nameAlias = "name_field";
const valueAlias = "value_field";

const processData = (chartData, nameKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) return { funnelData: [] };

  const funnelData = chartData.map(row => ({
    name: row[nameKey],
    value: row[valueKey] || 0
  }));

  return { funnelData };
};

const { funnelData } = processData(data[0], nameAlias, valueAlias);

option = {
  series: [
    {
      type: 'funnel',
      left: '10%',
      width: '40%',
      data: funnelData
    },
    {
      type: 'funnel',
      left: '55%',
      width: '40%',
      data: funnelData
    }
  ]
};
`;
