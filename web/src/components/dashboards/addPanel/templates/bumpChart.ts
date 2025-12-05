export const bumpChart = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Bump Chart (Ranking) - Shows ranking changes over time
//
// Expected Query Format:
// SELECT
//   time_period as "x_axis_1",     -- e.g., year, month, date
//   category as "category_name",   -- e.g., product name, team name
//   rank_value as "y_axis_1"       -- the ranking value (1, 2, 3, etc.)
// FROM "default"
// GROUP BY x_axis_1, category_name
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for the X-axis (time periods)
const xAlias = "x_axis_1";

// 'categoryAlias' should match the column name for the category/series name
const categoryAlias = "category_name";

// 'yAlias' should match the column name for the rank value
const yAlias = "y_axis_1";

// Arrow function to process data for bump chart
const processData = (chartData, xKey, categoryKey, yKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { xData: [], seriesData: [], categories: [] };
  }

  // Get unique x-axis values (time periods)
  const xDataSet = new Set();
  const categoryMap = new Map();

  // First pass: collect all unique x values and categories
  chartData.forEach(row => {
    if (row[xKey] !== undefined) {
      xDataSet.add(row[xKey]);
    }
    if (row[categoryKey] !== undefined) {
      if (!categoryMap.has(row[categoryKey])) {
        categoryMap.set(row[categoryKey], []);
      }
    }
  });

  const xData = Array.from(xDataSet).sort();
  const categories = Array.from(categoryMap.keys());

  // Second pass: populate data for each category
  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[categoryKey] !== undefined && row[yKey] !== undefined) {
      const category = row[categoryKey];
      const xIndex = xData.indexOf(row[xKey]);

      if (categoryMap.has(category)) {
        const dataArray = categoryMap.get(category);
        // Ensure array has correct length
        while (dataArray.length < xData.length) {
          dataArray.push(null);
        }
        dataArray[xIndex] = row[yKey];
      }
    }
  });

  // Create series data
  const seriesData = [];
  categoryMap.forEach((data, name) => {
    seriesData.push({
      name: name,
      symbolSize: 20,
      type: 'line',
      smooth: true,
      emphasis: {
        focus: 'series'
      },
      endLabel: {
        show: true,
        formatter: '{a}',
        distance: 20
      },
      lineStyle: {
        width: 4
      },
      data: data
    });
  });

  return { xData, seriesData, categories };
};

// Execute the function
const { xData, seriesData, categories } = processData(data[0], xAlias, categoryAlias, yAlias);

option = {
  title: {
    text: 'Bump Chart (Ranking)'
  },
  tooltip: {
    trigger: 'item'
  },
  legend: {
    data: categories
  },
  grid: {
    left: 30,
    right: 110,
    bottom: 30,
    containLabel: true
  },
  toolbox: {
    feature: {
      saveAsImage: {}
    }
  },
  xAxis: {
    type: 'category',
    splitLine: {
      show: true
    },
    axisLabel: {
      margin: 30,
      fontSize: 16
    },
    boundaryGap: false,
    data: xData
  },
  yAxis: {
    type: 'value',
    axisLabel: {
      margin: 30,
      fontSize: 16,
      formatter: '#{value}'
    },
    inverse: true,
    interval: 1,
    min: 1,
    max: categories.length || 10
  },
  series: seriesData
};
`;
