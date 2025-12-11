// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
x_value as "x_field",
y_value as "y_field",
size_value as "size_field",
category as "category"
FROM "default"`;

// Chart code template
const chartCode = `
// Bubble Gradient

// Example Query:
// SELECT
// x_value as "x_field",
// y_value as "y_field",
// size_value as "size_field",
// category as "category"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const xAlias = "x_field";
const yAlias = "y_field";
const sizeAlias = "size_field";
const categoryAlias = "category";
// -----------------------------------------------------------

const processData = (chartData, xKey, yKey, sizeKey, catKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined) {
      result.push([
        row[xKey],
        row[yKey],
        row[sizeKey] || 10,
        row[catKey] || ''
      ]);
    }
  });

  return result;
};

const bubbleData = processData(data[0], xAlias, yAlias, sizeAlias, categoryAlias);

option = {
  backgroundColor: '#404a59',
  color: ['#dd4444', '#fec42c', '#80F1BE'],
  tooltip: {
    trigger: 'item'
  },
  xAxis: {
    splitLine: {
      lineStyle: {
        type: 'dashed'
      }
    }
  },
  yAxis: {
    splitLine: {
      lineStyle: {
        type: 'dashed'
      }
    },
    scale: true
  },
  series: [
    {
      type: 'scatter',
      symbolSize: (data) => Math.sqrt(data[2]) * 5,
      data: bubbleData,
      itemStyle: {
        shadowBlur: 10,
        shadowColor: 'rgba(120, 36, 50, 0.5)',
        shadowOffsetY: 5,
        color: {
          type: 'radial',
          x: 0.5,
          y: 0.5,
          r: 0.5,
          colorStops: [
            { offset: 0, color: 'rgba(255, 178, 72, 1)' },
            { offset: 1, color: 'rgba(255, 178, 72, 0.2)' }
          ]
        }
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
