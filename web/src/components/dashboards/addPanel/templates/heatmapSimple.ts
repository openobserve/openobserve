export const heatmapSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Heatmap Chart - 2D data visualization with color intensity
//
// Example Query:
// SELECT
//   x_category as "x_field",
//   y_category as "y_field",
//   count(*) as "value_field"
// FROM "default"
// GROUP BY x_field, y_field

// 'xAlias' should match the column name for the X-axis categories
const xAlias = "x_field";

// 'yAlias' should match the column name for the Y-axis categories
const yAlias = "y_field";

// 'valueAlias' should match the column name for the value
const valueAlias = "value_field";

// Arrow function to process heatmap data
const processData = (chartData, xKey, yKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { xCategories: [], yCategories: [], data: [] };
  }

  const xSet = new Set();
  const ySet = new Set();
  const dataMap = new Map();

  chartData.forEach(row => {
    const x = row[xKey];
    const y = row[yKey];
    const value = row[valueKey] || 0;

    xSet.add(x);
    ySet.add(y);
    dataMap.set(\`\${x}-\${y}\`, value);
  });

  const xCategories = Array.from(xSet);
  const yCategories = Array.from(ySet);
  const data = [];

  yCategories.forEach((y, yIndex) => {
    xCategories.forEach((x, xIndex) => {
      const value = dataMap.get(\`\${x}-\${y}\`) || 0;
      data.push([xIndex, yIndex, value]);
    });
  });

  return { xCategories, yCategories, data };
};

// Execute the function
const { xCategories, yCategories, data: heatmapData } = processData(data[0], xAlias, yAlias, valueAlias);

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
