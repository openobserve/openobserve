export const areaStack = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Stacked Area Chart - Shows multiple series with filled areas stacked
//
// Example Query:
// SELECT
//   histogram(_timestamp) as "x_axis_1",
//   sum(CASE WHEN channel = 'email' THEN traffic ELSE 0 END) as "series_1",
//   sum(CASE WHEN channel = 'social' THEN traffic ELSE 0 END) as "series_2"
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
    areaStyle: {},
    emphasis: {
        focus: 'series'
    },
    data: [] 
  }));

  chartData.forEach(row => {
    if (row[xKey] !== undefined) {
      xData.push(row[xKey]);
      yKeys.forEach((key, index) => {
        if (row[key] !== undefined) {
          seriesData[index].data.push(row[key]);
        } else {
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
    text: 'Stacked Area Chart'
  },
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
  series: seriesData
};
`;
