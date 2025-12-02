export const pieDoughnut = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Doughnut Chart - Shows data distribution with a hollow center
//
// Example Query:
// SELECT
//   device_type as "name_field",
//   count(*) as "value_field"
// FROM "default"
// GROUP BY name_field
// ORDER BY value_field DESC

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
    text: 'Doughnut Chart',
    left: 'center'
  },
  tooltip: {
    trigger: 'item',
    formatter: '{a} <br/>{b}: {c} ({d}%)'
  },
  legend: {
    top: '5%',
    left: 'center'
  },
  series: [
    {
      name: 'Data',
      type: 'pie',
      radius: ['40%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: {
        borderRadius: 10,
        borderColor: '#fff',
        borderWidth: 2
      },
      label: {
        show: false,
        position: 'center'
      },
      emphasis: {
        label: {
          show: true,
          fontSize: 40,
          fontWeight: 'bold'
        }
      },
      labelLine: {
        show: false
      },
      data: pieData
    }
  ]
};
`;
