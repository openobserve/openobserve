// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
category as "x_axis_1",
value as "y_axis_1"
FROM "default"`;

// Chart code template
const chartCode = `
// Bar Chart with Axis Breaks (Brush

// Example Query:
// SELECT
// category as "x_axis_1",
// value as "y_axis_1"
// FROM "default"

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const xAlias = "x_axis_1";
const yAlias = "y_axis_1";
// -----------------------------------------------------------


const processData = (chartData, xKey, yKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { xData: [], yData: [] };
  }

  const xData = [];
  const yData = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined) {
      xData.push(row[xKey]);
      yData.push(row[yKey]);
    }
  });

  return { xData, yData };
};

const { xData, yData } = processData(data[0], xAlias, yAlias);

option = {
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    }
  },
  brush: {
    toolbox: ['rect', 'polygon', 'lineX', 'lineY', 'keep', 'clear'],
    xAxisIndex: 0
  },
  toolbox: {
    feature: {
      brush: {
        type: ['rect', 'polygon', 'lineX', 'lineY', 'keep', 'clear']
      }
    }
  },
  xAxis: {
    type: 'category',
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      type: 'bar',
      data: yData
    }
  ]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
