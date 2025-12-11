// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
seat_row as "row",
seat_col as "col",
status as "status"
FROM "default"`;

// Chart code template
const chartCode = `
// Geo Seatmap Flight

// Example Query:
// SELECT
// seat_row as "row",
// seat_col as "col",
// status as "status"
// FROM "default"
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const rowAlias = "row";
const colAlias = "col";
const statusAlias = "status";
// -----------------------------------------------------------

const processData = (chartData, rowKey, colKey, statusKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[rowKey] !== undefined && row[colKey] !== undefined) {
      result.push([row[colKey], row[rowKey], row[statusKey] || 'available']);
    }
  });

  return result;
};

const seatData = processData(data[0], rowAlias, colAlias, statusAlias);

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
    max: 1,
    calculable: true,
    orient: 'horizontal',
    left: 'center',
    bottom: '15%'
  },
  series: [
    {
      type: 'scatter',
      data: seatData,
      symbolSize: 15,
      label: {
        show: false
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
