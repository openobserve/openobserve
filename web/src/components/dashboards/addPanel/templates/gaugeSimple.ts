export const gaugeSimple = `
// ---------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// ---------------------------------------------------------
// Simple Gauge Chart - Shows a single metric value
//
// Example Query:
// SELECT
//   avg(cpu_usage) as "value_field"
// FROM "default"
// WHERE _timestamp >= now() - interval '5 minutes'

// 'valueAlias' should match the column name for the gauge value (0-100)
const valueAlias = "value_field";

// Arrow function to process data
const processData = (chartData, valueKey) => {
  if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
    return { value: 0 };
  }

  // Get the first value from the result
  const value = chartData[0][valueKey] || 0;

  return { value };
};

// Execute the function
const { value } = processData(data[0], valueAlias);

option = {
  series: [
    {
      type: 'gauge',
      startAngle: 180,
      endAngle: 0,
      center: ['50%', '75%'],
      radius: '90%',
      min: 0,
      max: 100,
      splitNumber: 8,
      axisLine: {
        lineStyle: {
          width: 6,
          color: [
            [0.25, '#7CFFB2'],
            [0.5, '#58D9F9'],
            [0.75, '#FDDD60'],
            [1, '#FF6E76']
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
        fontSize: 20,
        distance: -60,
        rotate: 'tangential',
        formatter: (value) => {
          if (value === 0.875) {
            return 'A';
          } else if (value === 0.625) {
            return 'B';
          } else if (value === 0.375) {
            return 'C';
          } else if (value === 0.125) {
            return 'D';
          }
          return '';
        }
      },
      title: {
        offsetCenter: [0, '-10%'],
        fontSize: 20
      },
      detail: {
        fontSize: 30,
        offsetCenter: [0, '-35%'],
        valueAnimation: true,
        formatter: (value) => {
          return Math.round(value) + '%';
        },
        color: 'inherit'
      },
      data: [
        {
          value: value,
          name: 'Metric'
        }
      ]
    }
  ]
};
`;
