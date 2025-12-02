export const pieRoseType = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Nightingale (Rose) Chart
//
// Example Query:
// SELECT category as "name_field", count(*) as "value_field" FROM "default" GROUP BY name_field

const nameAlias = "name_field";
const valueAlias = "value_field";

const processData = (chartData, nameKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) return { pieData: [] };

  const pieData = [];
  chartData.forEach(row => {
    if (row[nameKey] !== undefined && row[valueKey] !== undefined) {
      pieData.push({ name: row[nameKey], value: row[valueKey] });
    }
  });
  return { pieData };
};

const { pieData } = processData(data[0], nameAlias, valueAlias);

option = {
  series: [{
    type: 'pie',
    roseType: 'area',
    data: pieData
  }]
};
`;
