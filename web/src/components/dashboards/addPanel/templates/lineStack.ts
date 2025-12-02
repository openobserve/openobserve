export const lineStack = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Stacked Line Chart - Shows multiple series stacked on top of each other
//
// Example Query:
// SELECT
//   histogram(_timestamp) as "x_axis_1",
//   sum(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as "series_1",
//   sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as "series_2"
// FROM "default"
// GROUP BY x_axis_1
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for the X-axis
const xAlias = "x_axis_1";

// 'yAliases' should be an array of column names for the Y-axis series
// Example: ["email", "union_ads", "video_ads"] or ["series_1", "series_2"]
const yAliases = ["series_1", "series_2"];

// Arrow function to process data
const processData = (chartData, xKey, yKeys) => {
  if (!chartData || !Array.isArray(chartData)) return { xData: [], seriesData: [] };

  const xData = [];
  // Initialize series data structure
  const seriesData = yKeys.map(key => ({ 
    name: key, 
    type: 'line', 
    stack: 'Total', 
    data: [] 
  }));

  chartData.forEach(row => {
    if (row[xKey] !== undefined) {
      xData.push(row[xKey]);
      yKeys.forEach((key, index) => {
        if (row[key] !== undefined) {
          seriesData[index].data.push(row[key]);
        } else {
           // Push null or 0 if data is missing for this series at this point
           seriesData[index].data.push(0); 
        }
      });
    }
  });

  return { xData, seriesData };
};

// Execute the function
const { xData, seriesData } = processData(data[0], xAlias, yAliases);

option = {
  title: {
    text: 'Stacked Line'
  },
  tooltip: {
    trigger: 'axis'
  },
  legend: {
    data: yAliases
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  toolbox: {
    feature: {
      saveAsImage: {}
    }
  },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: xData
  },
  yAxis: {
    type: 'value'
  },
  series: seriesData
};
`;
