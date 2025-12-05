export const heatmapCartesian = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Heatmap Chart - Shows data density in 2D grid
//
// Example Query:
// SELECT
//   hour(_timestamp) as "x_axis_1",
//   day_of_week(_timestamp) as "y_axis_1",
//   count(*) as "value_field"
// FROM "default"
// GROUP BY x_axis_1, y_axis_1
// ORDER BY x_axis_1, y_axis_1

// 'xAlias' should match the column name for X-axis (e.g., hour, category)
const xAlias = "x_axis_1";

// 'yAlias' should match the column name for Y-axis (e.g., day, category)
const yAlias = "y_axis_1";

// 'valueAlias' should match the column name for the heatmap value
const valueAlias = "value_field";

// Arrow function to process data
const processData = (chartData, xKey, yKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { heatmapData: [], xCategories: [], yCategories: [] };
  }

  const xSet = new Set();
  const ySet = new Set();
  const heatmapData = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined && row[valueKey] !== undefined) {
      xSet.add(row[xKey]);
      ySet.add(row[yKey]);
      heatmapData.push([row[xKey], row[yKey], row[valueKey]]);
    }
  });

  const xCategories = Array.from(xSet).sort();
  const yCategories = Array.from(ySet).sort();

  return { heatmapData, xCategories, yCategories };
};

// Execute the function
const { heatmapData, xCategories, yCategories } = processData(data[0], xAlias, yAlias, valueAlias);

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
    data: xCategories,
    splitArea: {
      show: true
    }
  },
  yAxis: {
    type: 'category',
    data: yCategories,
    splitArea: {
      show: true
    }
  },
  visualMap: {
    min: 0,
    max: Math.max(...heatmapData.map(item => item[2])),
    calculable: true,
    orient: 'horizontal',
    left: 'center',
    bottom: '15%'
  },
  series: [
    {
      name: 'Heatmap',
      type: 'heatmap',
      data: heatmapData,
      label: {
        show: true
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
