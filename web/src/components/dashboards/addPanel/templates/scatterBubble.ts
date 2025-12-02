export const scatterBubble = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Bubble Chart - Scatter plot with size dimension
//
// Example Query:
// SELECT
//   x_value as "x_field",
//   y_value as "y_field",
//   size_value as "size_field"
// FROM "default"

// 'xAlias' should match the column name for the X-axis
const xAlias = "x_field";

// 'yAlias' should match the column name for the Y-axis
const yAlias = "y_field";

// 'sizeAlias' should match the column name for the bubble size
const sizeAlias = "size_field";

// Arrow function to process bubble data
const processData = (chartData, xKey, yKey, sizeKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined && row[sizeKey] !== undefined) {
      result.push([row[xKey], row[yKey], row[sizeKey]]);
    }
  });

  return result;
};

// Execute the function
const bubbleData = processData(data[0], xAlias, yAlias, sizeAlias);

option = {
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
      symbolSize: (data) => {
        return Math.sqrt(data[2]) * 5;
      },
      data: bubbleData,
      emphasis: {
        focus: 'series',
        label: {
          show: true,
          formatter: (param) => {
            return param.data[2];
          },
          position: 'top'
        }
      }
    }
  ]
};
`;
