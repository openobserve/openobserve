export const dynamicData2 = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Time Series Chart - Displays data over time
//
// Expected Query Format:
// SELECT
//   timestamp_field as "x_axis_1",  -- timestamp or date field
//   value_field as "y_axis_1"       -- numeric value
// FROM "default"
// ORDER BY x_axis_1 ASC

// 'xAlias' should match the column name for timestamps/dates
const xAlias = "x_axis_1";

// 'yAlias' should match the column name for values
const yAlias = "y_axis_1";

// Arrow function to process time series data
const processData = (chartData, xKey, yKey) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { data: [] };
  }

  const processedData = [];

  chartData.forEach(row => {
    if (row[xKey] !== undefined && row[yKey] !== undefined) {
      // Create data point with name and value
      // The name is used for tooltip formatting
      processedData.push({
        name: row[xKey],
        value: [row[xKey], row[yKey]]
      });
    }
  });

  return { data: processedData };
};

// Execute the function
const { data: timeSeriesData } = processData(data[0], xAlias, yAlias);

option = {
  title: {
    text: 'Time Series Data'
  },
  tooltip: {
    trigger: 'axis',
    formatter: (params) => {
      if (!params || params.length === 0) return '';
      const param = params[0];
      const date = new Date(param.name);
      return date.toLocaleDateString() + ' : ' + param.value[1];
    },
    axisPointer: {
      animation: false
    }
  },
  xAxis: {
    type: 'time',
    splitLine: {
      show: false
    }
  },
  yAxis: {
    type: 'value',
    boundaryGap: [0, '100%'],
    splitLine: {
      show: false
    }
  },
  series: [
    {
      name: 'Data',
      type: 'line',
      showSymbol: false,
      data: timeSeriesData
    }
  ]
};
`;
