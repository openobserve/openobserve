// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
x_value as "x_field",
y_value as "y_field"
FROM "default"`;

// Chart code template
const chartCode = `
// Scatter with Jittering

// Example Query:
// SELECT
// x_value as "x_field",
// y_value as "y_field"
// FROM "default"
//
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Scatter with Jittering - Reduces overlapping points
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
      // Add small random jitter to reduce overlapping
      const jitterX = (Math.random() - 0.5) * 0.1;
      const jitterY = (Math.random() - 0.5) * 0.1;
      result.push([row[xKey] + jitterX, row[yKey] + jitterY]);
    }
  });

  return result;
};

const scatterData = processData(data[0], xAlias, yAlias);

option = {
  tooltip: {
    trigger: 'item'
  },
  xAxis: {
    type: 'value',
    splitLine: {
      lineStyle: {
        type: 'dashed'
      }
    }
  },
  yAxis: {
    type: 'value',
    splitLine: {
      lineStyle: {
        type: 'dashed'
      }
    }
  },
  series: [
    {
      type: 'scatter',
      symbolSize: 8,
      data: scatterData,
      itemStyle: {
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
