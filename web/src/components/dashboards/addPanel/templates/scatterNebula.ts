// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
x_value as "x_field",
y_value as "y_field"
FROM "default"`;

// Chart code template
const chartCode = `
// Scatter Nebula

// Example Query:
// SELECT
// x_value as "x_field",
// y_value as "y_field"
// FROM "default"
//
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Scatter Nebula - Large scale scatter with visual effects
//

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const xAlias = "x_field";
const yAlias = "y_field";
// -----------------------------------------------------------


const processData = (chartData, xKey, yKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined) {
      result.push([row[xKey], row[yKey]]);
    }
  });

  return result;
};

const scatterData = processData(data[0], xAlias, yAlias);

option = {
  backgroundColor: '#000',
  xAxis: {
    type: 'value',
    splitLine: {
      show: false
    }
  },
  yAxis: {
    type: 'value',
    splitLine: {
      show: false
    }
  },
  series: [
    {
      type: 'scatter',
      symbolSize: 3,
      data: scatterData,
      itemStyle: {
        color: '#fff',
        opacity: 0.6
      }
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
