// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
x_value as "x_axis",
y_value as "y_axis",
value as "value"
FROM "default"`;

// Chart code template
const chartCode = `
// Heatmap Large

// Example Query:
// SELECT
// x_value as "x_axis",
// y_value as "y_axis",
// value as "value"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const xAlias = "x_axis";
const yAlias = "y_axis";
const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, xKey, yKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined && row[valueKey] !== undefined) {
      result.push([row[xKey], row[yKey], row[valueKey]]);
    }
  });

  return result;
};

const heatmapData = processData(data[0], xAlias, yAlias, valueAlias);

option = {
  tooltip: {
    position: 'top'
  },
  grid: {
    height: '50%',
    top: '10%'
  },
  xAxis: {
    type: 'category',
    splitArea: {
      show: true
    }
  },
  yAxis: {
    type: 'category',
    splitArea: {
      show: true
    }
  },
  visualMap: {
    min: 0,
    max: Math.max(...heatmapData.map(d => d[2])),
    calculable: true,
    orient: 'horizontal',
    left: 'center',
    bottom: '15%'
  },
  series: [
    {
      type: 'heatmap',
      data: heatmapData,
      label: {
        show: false
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
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
