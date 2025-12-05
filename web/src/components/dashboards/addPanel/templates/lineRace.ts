export const lineRace = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Line Race Chart - Shows multiple series racing over time
//
// Expected Query Format:
// SELECT
//   time_period as "x_axis_1",     -- e.g., year, month
//   category as "category_name",   -- e.g., country, product
//   value as "y_axis_1"            -- numeric value
// FROM "default"
// GROUP BY x_axis_1, category_name
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for the X-axis (time periods)
const xAlias = "x_axis_1";

// 'categoryAlias' should match the column name for the category/series name
const categoryAlias = "category_name";

// 'yAlias' should match the column name for the Y-axis value
const yAlias = "y_axis_1";

// Arrow function to process data for line race
const processData = (chartData, xKey, categoryKey, yKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { series: [], categories: [] };
  }

  const categoryMap = new Map();

  // Collect data for each category
  chartData.forEach(row => {
    if (row[categoryKey] !== undefined) {
      if (!categoryMap.has(row[categoryKey])) {
        categoryMap.set(row[categoryKey], []);
      }
      if (row[xKey] !== undefined && row[yKey] !== undefined) {
        categoryMap.get(row[categoryKey]).push({
          x: row[xKey],
          y: row[yKey]
        });
      }
    }
  });

  const categories = Array.from(categoryMap.keys());
  const series = [];

  // Create series for each category
  categoryMap.forEach((dataPoints, category) => {
    // Sort by x value
    dataPoints.sort((a, b) => {
      if (a.x < b.x) return -1;
      if (a.x > b.x) return 1;
      return 0;
    });

    series.push({
      type: 'line',
      name: category,
      showSymbol: false,
      data: dataPoints.map(p => [p.x, p.y]),
      endLabel: {
        show: true,
        formatter: (params) => {
          return params.seriesName + ': ' + params.value[1];
        }
      },
      labelLayout: {
        moveOverlap: 'shiftY'
      },
      emphasis: {
        focus: 'series'
      }
    });
  });

  return { series, categories };
};

// Execute the function
const { series, categories } = processData(data[0], xAlias, categoryAlias, yAlias);

option = {
  animationDuration: 10000,
  title: {
    text: 'Line Race'
  },
  tooltip: {
    order: 'valueDesc',
    trigger: 'axis'
  },
  legend: {
    data: categories
  },
  xAxis: {
    type: 'category',
    nameLocation: 'middle'
  },
  yAxis: {
    name: 'Value'
  },
  grid: {
    right: 140
  },
  series: series
};
`;
