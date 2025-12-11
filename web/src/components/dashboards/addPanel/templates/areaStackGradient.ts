// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
  histogram(_timestamp) as "x_axis_1",
  sum(CASE WHEN line = '1' THEN value ELSE 0 END) as "line_1",
  sum(CASE WHEN line = '2' THEN value ELSE 0 END) as "line_2",
  sum(CASE WHEN line = '3' THEN value ELSE 0 END) as "line_3",
  sum(CASE WHEN line = '4' THEN value ELSE 0 END) as "line_4",
  sum(CASE WHEN line = '5' THEN value ELSE 0 END) as "line_5"
FROM "default"
GROUP BY x_axis_1
ORDER BY x_axis_1 ASC`;

// Chart code template
const chartCode = `
// Gradient Stacked Area Chart

// Example Query:
// SELECT
//   histogram(_timestamp) as "x_axis_1",
//   sum(CASE WHEN line = '1' THEN value ELSE 0 END) as "line_1",
//   sum(CASE WHEN line = '2' THEN value ELSE 0 END) as "line_2",
//   sum(CASE WHEN line = '3' THEN value ELSE 0 END) as "line_3",
//   sum(CASE WHEN line = '4' THEN value ELSE 0 END) as "line_4",
//   sum(CASE WHEN line = '5' THEN value ELSE 0 END) as "line_5"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const xAlias = "x_axis_1";
const yAliases = ["line_1", "line_2", "line_3", "line_4", "line_5"];
// -----------------------------------------------------------

const processData = (chartData, xKey, yKeys) => {
  if (!chartData || !Array.isArray(chartData)) return { xData: [], seriesData: [] };

  const xData = [];
  const seriesData = yKeys.map(key => ({ 
    name: key, 
    data: [] 
  }));

  chartData.forEach(row => {
    if (row[xKey] !== undefined) {
      xData.push(row[xKey]);
      yKeys.forEach((key, index) => {
        seriesData[index].data.push(row[key] !== undefined ? row[key] : 0);
      });
    }
  });

  return { xData, seriesData };
};

const { xData, seriesData } = processData(data[0], xAlias, yAliases);

option = {
  color: ['#80FFA5', '#00DDFF', '#37A2FF', '#FF0087', '#FFBF00'],
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross',
      label: {
        backgroundColor: '#6a7985'
      }
    }
  },
  legend: {
    data: yAliases
  },
  toolbox: {
    feature: {
      saveAsImage: {}
    }
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  xAxis: [
    {
      type: 'category',
      boundaryGap: false,
      data: xData
    }
  ],
  yAxis: [
    {
      type: 'value'
    }
  ],
  series: seriesData.map((s, i) => ({
    name: s.name,
    type: 'line',
    stack: 'Total',
    smooth: true,
    lineStyle: {
      width: 0
    },
    showSymbol: false,
    areaStyle: {
      opacity: 0.8,
      color: ['#80FFA5', '#00DDFF', '#37A2FF', '#FF0087', '#FFBF00'][i % 5]
    },
    emphasis: {
      focus: 'series'
    },
    data: s.data
  }))
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
