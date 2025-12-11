// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT
value as "value"
FROM "default"
LIMIT 1`;

// Chart code template
const chartCode = `
// Gauge Ring

// Example Query:
// SELECT
// value as "value"
// FROM "default"
// LIMIT 1
//
// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!
// -----------------------------------------------------------

const valueAlias = "value";
// -----------------------------------------------------------

const processData = (chartData, valueKey) => {
  if (!chartData || !Array.isArray(chartData) || chartData.length === 0) {
    return 0;
  }

  return chartData[0][valueKey] || 0;
};

const gaugeValue = processData(data[0], valueAlias);

option = {
  series: [
    {
      type: 'gauge',
      startAngle: 90,
      endAngle: -270,
      pointer: {
        show: false
      },
      progress: {
        show: true,
        overlap: false,
        roundCap: true,
        clip: false,
        itemStyle: {
          borderWidth: 1,
          borderColor: '#464646'
        }
      },
      axisLine: {
        lineStyle: {
          width: 40
        }
      },
      splitLine: {
        show: false
      },
      axisTick: {
        show: false
      },
      axisLabel: {
        show: false
      },
      data: [
        {
          value: gaugeValue,
          name: 'Progress',
          title: {
            offsetCenter: ['0%', '0%']
          },
          detail: {
            offsetCenter: ['0%', '0%']
          }
        }
      ],
      title: {
        fontSize: 14
      },
      detail: {
        width: 50,
        height: 14,
        fontSize: 14,
        color: 'auto',
        borderColor: 'auto',
        borderRadius: 20,
        borderWidth: 1,
        formatter: '{value}%'
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
