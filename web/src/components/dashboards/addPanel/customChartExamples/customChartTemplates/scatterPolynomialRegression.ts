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

const scatterData = processData(data?.[0] || [], xAlias, yAlias);

// Polynomial regression (degree 2)
function polyfit(x, y) {
  const n = x.length;
  let sumX = 0, sumX2 = 0, sumX3 = 0, sumX4 = 0;
  let sumY = 0, sumXY = 0, sumX2Y = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumX2 += x[i] * x[i];
    sumX3 += x[i] * x[i] * x[i];
    sumX4 += x[i] * x[i] * x[i] * x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2Y += x[i] * x[i] * y[i];
  }
  const X = [
    [n, sumX, sumX2],
    [sumX, sumX2, sumX3],
    [sumX2, sumX3, sumX4]
  ];
  const Y = [sumY, sumXY, sumX2Y];

  // Solve X * coeffs = Y
  function solve(A, b) {
    // Cramer's rule for 3x3
    function det(m) {
      return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
           - m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
           + m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
    }
    const D = det(A);
    if (D === 0) return [0,0,0];
    const A0 = [[b[0],A[0][1],A[0][2]],[b[1],A[1][1],A[1][2]],[b[2],A[2][1],A[2][2]]];
    const A1 = [[A[0][0],b[0],A[0][2]],[A[1][0],b[1],A[1][2]],[A[2][0],b[2],A[2][2]]];
    const A2 = [[A[0][0],A[0][1],b[0]],[A[1][0],A[1][1],b[1]],[A[2][0],A[2][1],b[2]]];
    return [det(A0)/D, det(A1)/D, det(A2)/D];
  }
  return solve(X, Y);
}

const xVals = scatterData.map(d => d[0]);
const yVals = scatterData.map(d => d[1]);
const [a, b, c] = polyfit(xVals, yVals);

// Generate regression line data
const minX = Math.min(...xVals);
const maxX = Math.max(...xVals);
const regressionLine = [];
const steps = 50;
for (let i = 0; i <= steps; i++) {
  const x = minX + (maxX - minX) * i / steps;
  const y = a + b * x + c * x * x;
  regressionLine.push([x, y]);
}

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
      data: regressionLine,
      smooth: false,
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
