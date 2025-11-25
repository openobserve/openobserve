// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// ECharts Custom Chart Templates
// Based on Apache ECharts examples: https://echarts.apache.org/examples/en/index.html

export const customChartTemplates: Record<string, string> = {
  "line-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=line-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Basic Line Chart'
  },
  tooltip: {
    trigger: 'axis'
  },
  xAxis: {
    type: 'category',
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: [150, 230, 224, 218, 135, 147, 260],
      type: 'line'
    }
  ]
};`,

  "bar-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=bar-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Basic Bar Chart'
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    }
  },
  xAxis: {
    type: 'category',
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      data: [120, 200, 150, 80, 70, 110, 130],
      type: 'bar'
    }
  ]
};`,

  "pie-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=pie-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Referer of a Website',
    left: 'center'
  },
  tooltip: {
    trigger: 'item'
  },
  legend: {
    orient: 'vertical',
    left: 'left'
  },
  series: [
    {
      name: 'Access From',
      type: 'pie',
      radius: '50%',
      data: [
        { value: 1048, name: 'Search Engine' },
        { value: 735, name: 'Direct' },
        { value: 580, name: 'Email' },
        { value: 484, name: 'Union Ads' },
        { value: 300, name: 'Video Ads' }
      ],
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowOffsetX: 0,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }
  ]
};`,

  "scatter-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=scatter-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Basic Scatter Chart'
  },
  tooltip: {
    trigger: 'item'
  },
  xAxis: {
    type: 'value'
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      symbolSize: 20,
      data: [
        [10.0, 8.04],
        [8.07, 6.95],
        [13.0, 7.58],
        [9.05, 8.81],
        [11.0, 8.33],
        [14.0, 7.66],
        [13.4, 6.81],
        [10.0, 6.33],
        [14.0, 8.96],
        [12.5, 6.82],
        [9.15, 7.20],
        [11.5, 7.20],
        [3.03, 4.23],
        [12.2, 7.83],
        [2.02, 4.47],
        [1.05, 3.33],
        [4.05, 4.96],
        [6.03, 7.24],
        [12.0, 6.26],
        [12.0, 8.84],
        [7.08, 5.82],
        [5.02, 5.68]
      ],
      type: 'scatter'
    }
  ]
};`,

  "radar-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=radar

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Basic Radar Chart'
  },
  legend: {
    data: ['Allocated Budget', 'Actual Spending']
  },
  radar: {
    indicator: [
      { name: 'Sales', max: 6500 },
      { name: 'Administration', max: 16000 },
      { name: 'Information Technology', max: 30000 },
      { name: 'Customer Support', max: 38000 },
      { name: 'Development', max: 52000 },
      { name: 'Marketing', max: 25000 }
    ]
  },
  series: [
    {
      name: 'Budget vs spending',
      type: 'radar',
      data: [
        {
          value: [4200, 3000, 20000, 35000, 50000, 18000],
          name: 'Allocated Budget'
        },
        {
          value: [5000, 14000, 28000, 26000, 42000, 21000],
          name: 'Actual Spending'
        }
      ]
    }
  ]
};`,

  "gauge-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=gauge-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Simple Gauge'
  },
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
        fontSize: 20,
        distance: -60,
        formatter: function (value) {
          if (value === 0.875) {
            return 'Excellent';
          } else if (value === 0.625) {
            return 'Good';
          } else if (value === 0.375) {
            return 'Fair';
          } else if (value === 0.125) {
            return 'Poor';
          }
          return '';
        }
      },
      title: {
        offsetCenter: [0, '-20%'],
        fontSize: 30
      },
      detail: {
        fontSize: 50,
        offsetCenter: [0, '0%'],
        valueAnimation: true,
        formatter: function (value) {
          return Math.round(value * 100) + '';
        },
        color: 'auto'
      },
      data: [
        {
          value: 0.7,
          name: 'Grade'
        }
      ]
    }
  ]
};`,

  "funnel-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=funnel

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Funnel Chart'
  },
  tooltip: {
    trigger: 'item',
    formatter: '{a} <br/>{b} : {c}%'
  },
  toolbox: {
    feature: {
      dataView: { readOnly: false },
      restore: {},
      saveAsImage: {}
    }
  },
  legend: {
    data: ['Show', 'Click', 'Visit', 'Inquiry', 'Order']
  },
  series: [
    {
      name: 'Funnel',
      type: 'funnel',
      left: '10%',
      top: 60,
      bottom: 60,
      width: '80%',
      min: 0,
      max: 100,
      minSize: '0%',
      maxSize: '100%',
      sort: 'descending',
      gap: 2,
      label: {
        show: true,
        position: 'inside'
      },
      labelLine: {
        length: 10,
        lineStyle: {
          width: 1,
          type: 'solid'
        }
      },
      itemStyle: {
        borderColor: '#fff',
        borderWidth: 1
      },
      emphasis: {
        label: {
          fontSize: 20
        }
      },
      data: [
        { value: 60, name: 'Visit' },
        { value: 40, name: 'Inquiry' },
        { value: 20, name: 'Order' },
        { value: 80, name: 'Click' },
        { value: 100, name: 'Show' }
      ]
    }
  ]
};`,

  "heatmap-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=heatmap-cartesian

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Heatmap on Cartesian'
  },
  tooltip: {
    position: 'top'
  },
  grid: {
    height: '50%',
    top: '10%'
  },
  xAxis: {
    type: 'category',
    data: ['12a', '1a', '2a', '3a', '4a', '5a', '6a', '7a', '8a', '9a', '10a', '11a']
  },
  yAxis: {
    type: 'category',
    data: ['Saturday', 'Friday', 'Thursday', 'Wednesday', 'Tuesday', 'Monday', 'Sunday']
  },
  visualMap: {
    min: 0,
    max: 10,
    calculable: true,
    orient: 'horizontal',
    left: 'center',
    bottom: '15%'
  },
  series: [
    {
      name: 'Punch Card',
      type: 'heatmap',
      data: [
        [0, 0, 5],
        [0, 1, 1],
        [0, 2, 0],
        [0, 3, 0],
        [0, 4, 0],
        [1, 0, 1],
        [1, 1, 4],
        [1, 2, 7]
      ],
      label: {
        show: true
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 10,
          shadowColor: 'rgba(0, 0, 0, 0.5)'
        }
      }
    }
  ]
};`,

  "candlestick-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=candlestick-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Basic Candlestick'
  },
  xAxis: {
    data: ['2017-10-24', '2017-10-25', '2017-10-26', '2017-10-27']
  },
  yAxis: {},
  series: [
    {
      type: 'candlestick',
      data: [
        [20, 34, 10, 38],
        [40, 35, 30, 50],
        [31, 38, 33, 44],
        [38, 15, 5, 42]
      ]
    }
  ]
};`,

  "graph-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=graph-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Simple Graph'
  },
  tooltip: {},
  animationDurationUpdate: 1500,
  animationEasingUpdate: 'quinticInOut',
  series: [
    {
      type: 'graph',
      layout: 'none',
      symbolSize: 50,
      roam: true,
      label: {
        show: true
      },
      edgeSymbol: ['circle', 'arrow'],
      edgeSymbolSize: [4, 10],
      edgeLabel: {
        fontSize: 20
      },
      data: [
        {
          name: 'Node 1',
          x: 300,
          y: 300
        },
        {
          name: 'Node 2',
          x: 800,
          y: 300
        },
        {
          name: 'Node 3',
          x: 550,
          y: 100
        },
        {
          name: 'Node 4',
          x: 550,
          y: 500
        }
      ],
      links: [
        {
          source: 0,
          target: 1,
          symbolSize: [5, 20],
          label: {
            show: true
          },
          lineStyle: {
            width: 5,
            curveness: 0.2
          }
        },
        {
          source: 'Node 2',
          target: 'Node 1',
          label: {
            show: true
          },
          lineStyle: {
            curveness: 0.2
          }
        },
        {
          source: 'Node 1',
          target: 'Node 3'
        },
        {
          source: 'Node 2',
          target: 'Node 3'
        },
        {
          source: 'Node 2',
          target: 'Node 4'
        },
        {
          source: 'Node 1',
          target: 'Node 4'
        }
      ],
      lineStyle: {
        opacity: 0.9,
        width: 2,
        curveness: 0
      }
    }
  ]
};`,

  "tree-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=tree-basic

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'From Left to Right Tree'
  },
  tooltip: {
    trigger: 'item',
    triggerOn: 'mousemove'
  },
  series: [
    {
      type: 'tree',
      data: [
        {
          name: 'Root',
          children: [
            {
              name: 'Child 1',
              children: [
                { name: 'Grandchild 1' },
                { name: 'Grandchild 2' }
              ]
            },
            {
              name: 'Child 2'
            }
          ]
        }
      ],
      top: '1%',
      left: '7%',
      bottom: '1%',
      right: '20%',
      symbolSize: 7,
      label: {
        position: 'left',
        verticalAlign: 'middle',
        align: 'right',
        fontSize: 9
      },
      leaves: {
        label: {
          position: 'right',
          verticalAlign: 'middle',
          align: 'left'
        }
      },
      emphasis: {
        focus: 'descendant'
      },
      expandAndCollapse: true,
      animationDuration: 550,
      animationDurationUpdate: 750
    }
  ]
};`,

  "treemap-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=treemap-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Basic Treemap'
  },
  series: [
    {
      type: 'treemap',
      data: [
        {
          name: 'nodeA',
          value: 10,
          children: [
            {
              name: 'nodeAa',
              value: 4
            },
            {
              name: 'nodeAb',
              value: 6
            }
          ]
        },
        {
          name: 'nodeB',
          value: 20,
          children: [
            {
              name: 'nodeBa',
              value: 20,
              children: [
                {
                  name: 'nodeBa1',
                  value: 20
                }
              ]
            }
          ]
        }
      ]
    }
  ]
};`,

  "sunburst-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=sunburst-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Basic Sunburst'
  },
  series: {
    type: 'sunburst',
    data: [
      {
        name: 'Grandpa',
        children: [
          {
            name: 'Uncle Leo',
            value: 15,
            children: [
              {
                name: 'Cousin Jack',
                value: 2
              },
              {
                name: 'Cousin Mary',
                value: 5,
                children: [
                  {
                    name: 'Jackson',
                    value: 2
                  }
                ]
              },
              {
                name: 'Cousin Ben',
                value: 4
              }
            ]
          },
          {
            name: 'Father',
            value: 10,
            children: [
              {
                name: 'Me',
                value: 5
              },
              {
                name: 'Brother Peter',
                value: 1
              }
            ]
          }
        ]
      },
      {
        name: 'Nancy',
        children: [
          {
            name: 'Uncle Nike',
            children: [
              {
                name: 'Cousin Betty',
                value: 1
              },
              {
                name: 'Cousin Jenny',
                value: 2
              }
            ]
          }
        ]
      }
    ],
    radius: [0, '90%'],
    label: {
      rotate: 'radial'
    }
  }
};`,

  "sankey-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=sankey-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Basic Sankey'
  },
  series: {
    type: 'sankey',
    layout: 'none',
    emphasis: {
      focus: 'adjacency'
    },
    data: [
      {
        name: 'a'
      },
      {
        name: 'b'
      },
      {
        name: 'a1'
      },
      {
        name: 'a2'
      },
      {
        name: 'b1'
      },
      {
        name: 'c'
      }
    ],
    links: [
      {
        source: 'a',
        target: 'a1',
        value: 5
      },
      {
        source: 'a',
        target: 'a2',
        value: 3
      },
      {
        source: 'b',
        target: 'b1',
        value: 8
      },
      {
        source: 'a',
        target: 'b1',
        value: 3
      },
      {
        source: 'b1',
        target: 'a1',
        value: 1
      },
      {
        source: 'b1',
        target: 'c',
        value: 2
      }
    ]
  }
};`,

  "boxplot-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=boxplot-light-velocity

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: [
    {
      text: 'Boxplot Light Velocity',
      left: 'center'
    }
  ],
  dataset: [
    {
      source: [
        [850, 740, 900, 1070, 930, 850, 950, 980, 980, 880, 1000, 980],
        [960, 940, 960, 940, 880, 800, 850, 880, 900, 840, 830, 790]
      ]
    },
    {
      transform: {
        type: 'boxplot',
        config: { itemNameFormatter: 'expr {value}' }
      }
    },
    {
      fromDatasetIndex: 1,
      fromTransformResult: 1
    }
  ],
  tooltip: {
    trigger: 'item',
    axisPointer: {
      type: 'shadow'
    }
  },
  grid: {
    left: '10%',
    right: '10%',
    bottom: '15%'
  },
  xAxis: {
    type: 'category',
    boundaryGap: true,
    nameGap: 30,
    splitArea: {
      show: false
    },
    splitLine: {
      show: false
    }
  },
  yAxis: {
    type: 'value',
    name: 'km/s minus 299,000',
    splitArea: {
      show: true
    }
  },
  series: [
    {
      name: 'boxplot',
      type: 'boxplot',
      datasetIndex: 1
    },
    {
      name: 'outlier',
      type: 'scatter',
      datasetIndex: 2
    }
  ]
};`,

  "parallel-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=parallel-simple

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Basic Parallel'
  },
  parallelAxis: [
    { dim: 0, name: 'Price' },
    { dim: 1, name: 'Net Weight' },
    { dim: 2, name: 'Amount' },
    {
      dim: 3,
      name: 'Score',
      type: 'category',
      data: ['Excellent', 'Good', 'OK', 'Bad']
    }
  ],
  series: {
    type: 'parallel',
    lineStyle: {
      width: 4
    },
    data: [
      [12.99, 100, 82, 'Good'],
      [9.99, 80, 77, 'OK'],
      [20, 120, 60, 'Excellent']
    ]
  }
};`,

  "calendar-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=calendar-heatmap

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.

function getVirtualData(year) {
  const date = +echarts.time.parse(year + '-01-01');
  const end = +echarts.time.parse(+year + 1 + '-01-01');
  const dayTime = 3600 * 24 * 1000;
  const data = [];
  for (let time = date; time < end; time += dayTime) {
    data.push([
      echarts.time.format(time, '{yyyy}-{MM}-{dd}', false),
      Math.floor(Math.random() * 10000)
    ]);
  }
  return data;
}

option = {
  title: {
    top: 30,
    left: 'center',
    text: 'Calendar Heatmap'
  },
  tooltip: {},
  visualMap: {
    min: 0,
    max: 10000,
    type: 'piecewise',
    orient: 'horizontal',
    left: 'center',
    top: 65
  },
  calendar: {
    top: 120,
    left: 30,
    right: 30,
    cellSize: ['auto', 13],
    range: '2023',
    itemStyle: {
      borderWidth: 0.5
    },
    yearLabel: { show: false }
  },
  series: {
    type: 'heatmap',
    coordinateSystem: 'calendar',
    data: getVirtualData('2023')
  }
};`,

  "pictorialBar-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=pictorialBar-dotted

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Dotted Bar'
  },
  xAxis: {
    type: 'category',
    data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  },
  yAxis: {
    type: 'value'
  },
  series: [
    {
      type: 'pictorialBar',
      symbol: 'circle',
      symbolRepeat: true,
      symbolSize: 10,
      data: [20, 30, 40, 35, 50, 45, 60]
    }
  ]
};`,

  "themeRiver-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=themeRiver-basic

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'ThemeRiver'
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'line',
      lineStyle: {
        color: 'rgba(0,0,0,0.2)',
        width: 1,
        type: 'solid'
      }
    }
  },
  legend: {
    data: ['DQ', 'TY', 'SS', 'QG', 'SY', 'DD']
  },
  singleAxis: {
    top: 50,
    bottom: 50,
    axisTick: {},
    axisLabel: {},
    type: 'time',
    axisPointer: {
      animation: true,
      label: {
        show: true
      }
    },
    splitLine: {
      show: true,
      lineStyle: {
        type: 'dashed',
        opacity: 0.2
      }
    }
  },
  series: [
    {
      type: 'themeRiver',
      emphasis: {
        itemStyle: {
          shadowBlur: 20,
          shadowColor: 'rgba(0, 0, 0, 0.8)'
        }
      },
      data: [
        ['2015/11/08', 10, 'DQ'],
        ['2015/11/09', 15, 'DQ'],
        ['2015/11/10', 35, 'DQ'],
        ['2015/11/08', 35, 'TY'],
        ['2015/11/09', 36, 'TY'],
        ['2015/11/10', 37, 'TY']
      ]
    }
  ]
};`,

  "custom-simple": `// To know more about ECharts,
// visit: https://echarts.apache.org/examples/en/index.html
// Example: https://echarts.apache.org/examples/en/editor.html?c=custom-profit

// Define your ECharts 'option' here.
// 'data' variable is available for use and contains the response data from
// the search result and it is an array.
option = {
  title: {
    text: 'Custom Series - Profit'
  },
  tooltip: {
    trigger: 'axis',
    axisPointer: {
      type: 'shadow'
    }
  },
  legend: {
    data: ['Profit', 'Expenses', 'Income']
  },
  grid: {
    left: '3%',
    right: '4%',
    bottom: '3%',
    containLabel: true
  },
  xAxis: [
    {
      type: 'value'
    }
  ],
  yAxis: [
    {
      type: 'category',
      axisTick: {
        show: false
      },
      data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    }
  ],
  series: [
    {
      name: 'Profit',
      type: 'bar',
      label: {
        show: true,
        position: 'inside'
      },
      emphasis: {
        focus: 'series'
      },
      data: [200, 170, 240, 244, 200, 220, 210]
    },
    {
      name: 'Income',
      type: 'bar',
      stack: 'Total',
      label: {
        show: true
      },
      emphasis: {
        focus: 'series'
      },
      data: [320, 302, 341, 374, 390, 450, 420]
    },
    {
      name: 'Expenses',
      type: 'bar',
      stack: 'Total',
      label: {
        show: true,
        position: 'left'
      },
      emphasis: {
        focus: 'series'
      },
      data: [-120, -132, -101, -134, -190, -230, -210]
    }
  ]
};`,
};
