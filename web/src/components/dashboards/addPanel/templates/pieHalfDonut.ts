export const pieHalfDonut = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Half Doughnut Chart
//
// Example Query:
// SELECT name as "name_field", count(*) as "value_field" FROM "default" GROUP BY name_field

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
    radius: ["20%","70%"],
    startAngle: 180,
    endAngle: 360,
    
    data: pieData
  }]
};
`;
