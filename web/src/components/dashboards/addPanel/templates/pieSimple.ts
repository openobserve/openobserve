export const pieSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Simple Pie Chart - Shows data distribution across categories
//
// Example Query:
// SELECT
//   browser_name as "name_field",
//   count(*) as "value_field"
// FROM "default"
// GROUP BY name_field
// ORDER BY value_field DESC
// LIMIT 10

// 'nameAlias' should match the column name for category names
const nameAlias = "name_field";

// 'valueAlias' should match the column name for values
const valueAlias = "value_field";

// Arrow function to process data
const processData = (chartData, nameKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { pieData: [] };
  }

  const pieData = [];

  chartData.forEach(row => {
    if (row[nameKey] !== undefined && row[valueKey] !== undefined) {
      pieData.push({
        name: row[nameKey],
        value: row[valueKey]
      });
    }
  });

  return { pieData };
};

// Execute the function
const { pieData } = processData(data[0], nameAlias, valueAlias);

option = {
  title: {
    text: 'Distribution',
    left: 'center'
  },
  tooltip: {
    trigger: 'item',
    formatter: '{a} <br/>{b} : {c} ({d}%)'
  },
  legend: {
    orient: 'vertical',
    left: 'left'
  },
  series: [
    {
      name: 'Data',
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
    }
  ]
};
`;
