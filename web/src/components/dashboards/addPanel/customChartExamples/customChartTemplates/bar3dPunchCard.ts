// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = `SELECT 
  date_part('hour', TO_TIMESTAMP_MICROS(_timestamp)) as hour,
  date_part('dow', TO_TIMESTAMP_MICROS(_timestamp)) as day_of_week,
  COUNT(*) as value
FROM default
GROUP BY date_part('hour', TO_TIMESTAMP_MICROS(_timestamp)), date_part('dow', TO_TIMESTAMP_MICROS(_timestamp))
ORDER BY day_of_week, hour`;

// Chart code template
const chartCode = `
// Bar3D Punch Card

// Example Query:
// SELECT 
//   date_part('hour', TO_TIMESTAMP_MICROS(_timestamp)) as hour,
//   date_part('dow', TO_TIMESTAMP_MICROS(_timestamp)) as day_of_week,
//   COUNT(*) as value
// FROM default
// GROUP BY date_part('hour', TO_TIMESTAMP_MICROS(_timestamp)), date_part('dow', TO_TIMESTAMP_MICROS(_timestamp))
// ORDER BY day_of_week, hour

// -----------------------------------------------------------
// IMPORTANT: Update the aliases below to match your query!

const hourAlias = 'hour';
const dayAlias = 'day_of_week';
const valueAlias = 'value';

const processData = (chartData) => {
  if (!chartData || !Array.isArray(chartData)) {
    return { hours: [], days: [], chartData: [] };
  }
  
  const hours = ['12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a', '12p', '1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p', '10p', '11p'];
// -----------------------------------------------------------

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  const data = chartData.map(item => {
    const hour = parseInt(item[hourAlias]) || 0;
    const day = parseInt(item[dayAlias]) || 0;
    const value = parseFloat(item[valueAlias]) || 0;
    return [hour, day, value];
  });
  
  return { hours, days, chartData: data };
};

const { hours, days, chartData } = processData(Array.isArray(data) && data.length > 0 ? data[0] : []);

option = {
  tooltip: {},
  visualMap: {
    max: 20,
    inRange: {
      color: ['#50a3ba', '#eac736', '#d94e5d']
    }
  },
  xAxis3D: {
    type: 'category',
    data: hours
  },
  yAxis3D: {
    type: 'category',
    data: days
  },
  zAxis3D: {
    type: 'value'
  },
  grid3D: {
    boxWidth: 200,
    boxDepth: 80,
    viewControl: {
      projection: 'orthographic'
    },
    light: {
      main: {
        intensity: 1.2,
        shadow: true
      },
      ambient: {
        intensity: 0.3
      }
    }
  },
  series: [{
    type: 'bar3D',
    data: chartData,
    shading: 'lambert',
    label: {
      fontSize: 16,
      borderWidth: 1
    },
    emphasis: {
      label: {
        fontSize: 20,
        color: '#900'
      },
      itemStyle: {
        color: '#900'
      }
    }
  }]
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
