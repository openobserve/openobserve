export const liquidFill = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Liquid Fill Gauge - Single value percentage visualization
//
// Example Query:
// SELECT
//   (sum(completed) * 100.0 / sum(total)) as "percentage_value"
// FROM "default"

// 'valueAlias' should match the column name for the percentage value
const valueAlias = "percentage_value";

// Arrow function to process single value
const processData = (chartData, valueKey) => {
  if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
    return 0;
  }

  const value = chartData[0][valueKey];
  // Convert to 0-1 range if the value is in percentage (0-100)
  return value > 1 ? value / 100 : value;
};

// Execute the function
const gaugeValue = processData(data[0], valueAlias);

option = {
  series: [
    {
      type: 'gauge',
      startAngle: 180,
      endAngle: 0,
      min: 0,
      max: 1,
      splitNumber: 8,
      axisLine: {
        lineStyle: {
          width: 6,
          color: [
            [0.25, '#FF6E76'],
            [0.5, '#FDDD60'],
            [0.75, '#58D9F9'],
            [1, '#7CFFB2']
          ]
        }
      },
      pointer: {
        icon: 'path://M12.8,0.7l12,40.1H0.7L12.8,0.7z',
        length: '12%',
        width: 20,
        offsetCenter: [0, '-60%'],
        itemStyle: {
          color: 'auto'
        }
      },
      axisTick: {
        length: 12,
        lineStyle: {
          color: 'auto',
          width: 2
        }
      },
      splitLine: {
        length: 20,
        lineStyle: {
          color: 'auto',
          width: 5
        }
      },
      axisLabel: {
        color: '#464646',
        fontSize: 16,
        distance: -60,
        rotate: 'tangential',
        formatter: (value) => {
          return (value * 100).toFixed(0) + '%';
        }
      },
      detail: {
        fontSize: 30,
        offsetCenter: [0, '-20%'],
        valueAnimation: true,
        formatter: (value) => {
          return (value * 100).toFixed(1) + '%';
        },
        color: 'inherit'
      },
      data: [
        {
          value: gaugeValue
        }
      ]
    }
  ]
};
`;
