export const pieLegend = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Pie with Scrollable Legend
//
// Example Query:
// SELECT name as "name_field", count(*) as "value_field" FROM "default" GROUP BY name_field

const nameAlias = "name_field";
const valueAlias = "value_field";

const processData = (chartData, nameKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) return { pieData: [] };

  const pieData = chartData.map(row => ({
    name: row[nameKey],
    value: row[valueKey] || 0
  }));

  return { pieData };
};

const { pieData } = processData(data[0], nameAlias, valueAlias);

option = {
  legend: {
    type: 'scroll',
    orient: 'vertical',
    right: 10,
    top: 20,
    bottom: 20
  },
  series: [{
    type: 'pie',
    radius: '50%',
    data: pieData,
    emphasis: {
      itemStyle: {
        shadowBlur: 10,
        shadowOffsetX: 0,
        shadowColor: 'rgba(0, 0, 0, 0.5)'
      }
    }
  }]
};
`;
