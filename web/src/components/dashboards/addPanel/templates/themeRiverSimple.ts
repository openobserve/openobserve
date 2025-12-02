export const themeRiverSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// ThemeRiver Chart - Stacked area chart showing changes over time
//
// Example Query:
// SELECT
//   date(_timestamp) as "time_field",
//   category as "category_field",
//   count(*) as "value_field"
// FROM "default"
// GROUP BY time_field, category_field
// ORDER BY time_field ASC

// 'timeAlias' should match the column name for the time axis
const timeAlias = "time_field";

// 'categoryAlias' should match the column name for the category
const categoryAlias = "category_field";

// 'valueAlias' should match the column name for the value
const valueAlias = "value_field";

// Arrow function to process theme river data
const processData = (chartData, timeKey, categoryKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { categories: [], data: [] };
  }

  const categorySet = new Set();
  const dataMap = new Map();

  chartData.forEach(row => {
    const time = row[timeKey];
    const category = row[categoryKey];
    const value = row[valueKey] || 0;

    categorySet.add(category);

    if (!dataMap.has(time)) {
      dataMap.set(time, {});
    }

    dataMap.get(time)[category] = value;
  });

  const categories = Array.from(categorySet);
  const times = Array.from(dataMap.keys()).sort();
  const result = [];

  times.forEach(time => {
    const timeData = dataMap.get(time);
    categories.forEach(category => {
      result.push([time, timeData[category] || 0, category]);
    });
  });

  return { categories, data: result };
};

// Execute the function
const { categories, data: themeRiverData } = processData(data[0], timeAlias, categoryAlias, valueAlias);

option = {
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'line',
      lineStyle: {
        color: 'rgba(0,0,0,0.2)',
        width: 1,
        type: 'solid'
      }
    }
  },
  legend: {
    data: categories
  },
  singleAxis: {
    top: 50,
    bottom: 50,
    axisTick: {},
    axisLabel: {},
    type: 'time',
    axisPointer: {
      animation: true,
      label: {
        show: true
      }
    },
    splitLine: {
      show: true,
      lineStyle: {
        type: 'dashed',
        opacity: 0.2
      }
    }
  },
  series: [
    {
      type: 'themeRiver',
      data: themeRiverData
    }
  ]
};
`;
