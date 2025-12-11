// Example Query for this chart:
// This query should be used in the dashboard query editor
const exampleQuery = ``;

// Chart code template
const chartCode = `
// Custom Flame Graph

// Note: This chart uses custom rendering. Modify the processData function below.

const processData = (data) => {
  const treeData = {
    name: 'root',
    value: 100,
    children: data.map((item, i) => ({
      name: item[0] || \`Node \${i}\`,
      value: item[1] || Math.random() * 100
    }))
  };
  
  return treeData;
};

const treeData = processData(queryResult);

option = {
  series: [{
    type: 'custom',
    renderItem: (params, api) => {
      const categoryIndex = api.value(0);
      const start = api.coord([api.value(1), categoryIndex]);
      const end = api.coord([api.value(2), categoryIndex]);
      const height = api.size([0, 1])[1] * 0.6;
      
      return {
        type: 'rect',
        shape: {
          x: start[0],
          y: start[1] - height / 2,
          width: end[0] - start[0],
          height: height
        },
        style: api.style()
      };
    },
    encode: {
      x: [1, 2],
      y: 0
    },
    data: [[0, 0, 100]],
    itemStyle: {
      color: '#ee6666',
      borderColor: '#fff'
    }
  }],
  xAxis: {type: 'value'},
  yAxis: {type: 'category'}
};
`;

// Export with common name for consistency across all templates
export const customChartExample = {
  code: chartCode,
  query: exampleQuery
};
