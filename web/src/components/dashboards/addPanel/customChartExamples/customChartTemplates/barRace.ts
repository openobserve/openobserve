// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC`;

// Chart code template
const chartCode = `
// Bar Race

// Example Query:
// SELECT histogram(_timestamp) as "x_axis_1", count(kubernetes_namespace_name) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const categoryAlias = "x_axis_1";
const valueAlias = "y_axis_1";
// -----------------------------------------------------------


const processData = (chartData, categoryKey, valueKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { categories: [], values: [] };
  }

  const categories = [];
  const values = [];

  chartData.forEach(row => {
    if (row[categoryKey] !== undefined && row[valueKey] !== undefined) {
      categories.push(row[categoryKey]);
      values.push(row[valueKey]);
    }
  });

  return { categories, values };
};

const { categories, values } = processData(data[0], categoryAlias, valueAlias);

// Generate multiple data snapshots for animation
const generateRacingSnapshots = (baseValues, numSnapshots = 10) => {
  const snapshots = [baseValues];
  let currentValues = [...baseValues];
  
  for (let i = 0; i < numSnapshots; i++) {
    currentValues = currentValues.map(val => val + Math.round(Math.random() * 100));
    snapshots.push([...currentValues]);
  }
  
  return snapshots;
};

const snapshots = generateRacingSnapshots(values);

option = {
  timeline: {
    axisType: 'category',
    autoPlay: true,
    playInterval: 3000,
    loop: true,
    data: snapshots.map((_, idx) => idx.toString()),
    show: false
  },
  baseOption: {
    xAxis: {
      max: 'dataMax'
    },
    yAxis: {
      type: 'category',
      data: categories,
      inverse: true,
      animationDuration: 300,
      animationDurationUpdate: 300,
      max: categories.length - 1
    },
    series: [
      {
        realtimeSort: true,
        name: 'Value',
        type: 'bar',
        label: {
          show: true,
          position: 'right',
          valueAnimation: true
        }
      }
    ],
    animationDuration: 0,
    animationDurationUpdate: 3000,
    animationEasing: 'linear',
    animationEasingUpdate: 'linear'
  },
  options: snapshots.map(snapshot => ({
    series: [{
      data: snapshot
    }]
  }))
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery,
};
