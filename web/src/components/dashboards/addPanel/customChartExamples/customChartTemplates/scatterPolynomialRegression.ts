// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
  ROW_NUMBER() OVER (ORDER BY kubernetes_namespace_name) as "x_field",
  COUNT(DISTINCT kubernetes_container_name) as "y_field"
FROM "default"
GROUP BY kubernetes_namespace_name
ORDER BY y_field DESC`;

// Chart code template
const chartCode = `
// Scatter Polynomial Regression

// Example Query:
// SELECT
//   ROW_NUMBER() OVER (ORDER BY kubernetes_namespace_name) as "x_field",
//   COUNT(DISTINCT kubernetes_container_name) as "y_field"
// FROM "default"
// GROUP BY kubernetes_namespace_name
// ORDER BY y_field DESC

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const xAlias = "x_field";
const yAlias = "y_field";
// -----------------------------------------------------------

const processData = (chartData, xKey, yKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return [];
  }

  const result = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined) {
      result.push([row[xKey], row[yKey]]);
    }
  });

  return result;
};

const scatterData = processData(data[0], xAlias, yAlias);

option = {
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'cross'
    }
  },
  xAxis: {
    type: 'value',
    splitLine: {
      lineStyle: {
        type: 'dashed'
      }
    }
  },
  yAxis: {
    type: 'value',
    splitLine: {
      lineStyle: {
        type: 'dashed'
      }
    }
  },
  series: [
    {
      type: 'scatter',
      data: scatterData
    },
    {
      type: 'line',
      data: scatterData.map(d => d),
      smooth: true,
      showSymbol: false,
      lineStyle: {
        color: '#5470C6'
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
