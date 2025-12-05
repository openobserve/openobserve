export const gaugeProgress = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Progress Gauge - Display single percentage value as progress
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
  // Ensure value is in 0-100 range
  return Math.min(100, Math.max(0, value || 0));
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
      max: 100,
      splitNumber: 10,
      progress: {
        show: true,
        width: 18
      },
      pointer: {
        show: false
      },
      axisLine: {
        lineStyle: {
          width: 18
        }
      },
      axisTick: {
        distance: -20,
        splitNumber: 5,
        lineStyle: {
          width: 2,
          color: '#999'
        }
      },
      splitLine: {
        distance: -25,
        length: 14,
        lineStyle: {
          width: 3,
          color: '#999'
        }
      },
      axisLabel: {
        distance: -15,
        color: '#999',
        fontSize: 14
      },
      detail: {
        valueAnimation: true,
        formatter: '{value}%',
        color: 'inherit',
        fontSize: 30,
        offsetCenter: [0, '0%']
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
