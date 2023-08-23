import { onMounted, reactive, ref } from "vue";
import { getThemeLayoutOptions } from "@/utils/dashboard/getThemeLayoutOptions";
import moment from "moment";

export const convertPromQLData = (
  panelSchema: any,
  searchQueryDataTemp: any,
  store: any
) => {
  const props = {
    data: panelSchema,
  };

  const searchQueryData = {
    data: searchQueryDataTemp,
  };
  const getPromqlLegendName = (metric: any, label: string) => {
    if (label) {
      let template = label || "";
      const placeholders = template.match(/\{([^}]+)\}/g);

      // Step 2: Iterate through each placeholder
      placeholders?.forEach(function (placeholder: any) {
        // Step 3: Extract the key from the placeholder
        const key = placeholder.replace("{", "").replace("}", "");

        // Step 4: Retrieve the corresponding value from the JSON object
        const value = metric[key];

        // Step 5: Replace the placeholder with the value in the template
        if (value) {
          template = template.replace(placeholder, value);
        }
      });
      return template;
    } else {
      return JSON.stringify(metric);
    }
  };

  const getLegendPosition = (type: string) => {
    const legendPosition = props.data.value?.config?.legends_position;

    switch (legendPosition) {
      case "bottom":
        return "h";
      case "right":
        return "v";
      default:
        return type == "promql" ? "h" : "v";
    }
  };

  const getUnitValue = (value: any) => {
    // console.log("unit value--", props.data.value.config?.unit);
    
    switch (props.data.value.config?.unit) {
      case "bytes": {
        const units = ["B", "KB", "MB", "GB", "TB"];
          for (let unit of units) {
            if (value < 1024) {
                return {
                    value: `${parseFloat(value).toFixed(2)}`,
                    unit: `${unit}`
                }
            }
            value /= 1024;
          }
          return {
            value:`${parseFloat(value).toFixed(2)}`,
            unit: 'PB'
          };
      }
      case "custom": {
          return {
            value: `${value}`,
            unit: `${props.data.value.config.unit_custom ?? ''}`
          }
      }
      case "seconds": {
        const units = [
            { unit: "ms", divisor: 0.001 },
            { unit: "s", divisor: 1 },
            { unit: "m", divisor: 60 },
            { unit: "h", divisor: 3600 },
            { unit: "D", divisor: 86400 },
            { unit: "M", divisor: 2592000 }, // Assuming 30 days in a month
            { unit: "Y", divisor: 31536000 }, // Assuming 365 days in a year
        ];
        for (const unitInfo of units) {
            const unitValue = value ? value / unitInfo.divisor : 0 ;
            if (unitValue >= 1 && unitValue < 1000) {
                return {
                    value: unitValue.toFixed(2),
                    unit: unitInfo.unit
                }
            }
        }

        // If the value is too large to fit in any unit, return the original seconds
        return {
            value: value,
            unit: 's'
        }
      }
      case "bps": {
        const units = ["B", "KB", "MB", "GB", "TB"];
        for (let unit of units) {
          if (value < 1024) {
              return {
                  value: `${parseFloat(value).toFixed(2)}`,
                  unit: `${unit}/s`
              }
          }
          value /= 1024;
        }
        return {
          value:`${parseFloat(value).toFixed(2)}`,
          unit: 'PB/s'
        }
      }
      case "percent-1":{
        return {
          value: `${(parseFloat(value)  * 100).toFixed(2)}`,
          unit: '%'
        }
        // `${parseFloat(value) * 100}`;
      }
      case "percent":{
        return {
          value: `${parseFloat(value).toFixed(2)}`,
          unit: '%'
        }
        // ${parseFloat(value)}`;
      }
      case "default":{
        return {
          value: value,
          unit: ''
        }
      }
      default:{
        return {
          value: value,
          unit: ''
        } 
      }
    }
  }

  const formatUnitValue = (obj:any) => {
    return `${obj.value}${obj.unit}`
  }

  const getPropsByChartTypeForTraces = () => {
    switch (props.data.value.type) {
      case "bar":
        return {
          type: "bar",
        };
      case "line":
        return {
          type: "line",
          smooth:true,
          showSymbol: false,
        };
      case "scatter":
        return {
          type: "scatter",
          symbolSize:5
        };
      case "pie":
        return {
          type: "pie",
        };
      case "donut":
        return {
          type: "pie",
        };
      case "h-bar":
        return {
          type: "bar",
          orientation: "h",
        };
      case "area":
        return {
          type: "line",
          smooth: true,
          areaStyle:{},
          showSymbol: false,
        };
      case "stacked":
        return {
          type: 'bar',
        };
      case "area-stacked":
        return {
          type: "line",
          stack: 'Total',
          areaStyle: {},
          showSymbol: false,
          emphasis: {
            focus: 'series'
          }, 
          // fill: 'none'
        };
      case "metric":
        return {
          type: 'custom',
          coordinateSystem: 'polar',
        };
      case "h-stacked":
        return {
          type: 'bar',
          orientation: "h",
        };
      default:
        return {
          type: "bar",
        };
    }
  };

  const getPropsByChartTypeForLayoutForPromQL = () => {
      //   console.log("data with tick",xAxisDataWithTicks);
    switch (props.data.value.type) {
      case "bar": {
        const trace = {
          barmode: "group",
        }
        return trace
      }

      case "line": {
        return
      }

      case "scatter": {
        const trace = {
          scattermode: "group",
        }
        return trace
      }

      case "pie":{
        return
      }
          
      case "donut":{
        return
      }
          
      case "h-bar": {
        const trace = {
          barmode: "group",
        }
        return trace
      }

      case "area": {
        return
      }
        
      case "area-stacked": {
        const layout = {
          barmode: "stack",
        }
        return layout
      }

      case "stacked": {
        const layout = {
          barmode: "stack",
        }
        return layout
      }

      case "h-stacked":{
        return
      }
          
      case "metric":{
        return
      }
    }
  };
  console.log("props", props);
  console.log("convertPromQLData: searchQueryData", searchQueryData);
  console.log("convertPromQLData: searchQueryData.data", searchQueryData.data);

  const formatDate =(date:any)=>{
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(2);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
  }

  let option = {
    legend: {
      show: true,
      type: "scroll",
      orient: "vertical", // 'horizontal' | 'vertical'
      x: "right", // 'center' | 'left' | {number},
      y: "center", // 'center' | 'bottom' | {number}
    },
    grid : {
      left: '10%',
      right: '10%',
      top: '10%',
      bottom: '10%'
    },
    tooltip: {
      show:true,
      trigger: 'axis',
      textStyle:{
        fontSize:12
      },
      formatter: function (name:any) {
        console.log("name--",name);
        if(name.length==0)
          return "";

        const date = new Date(name[0].data[0]);

        let hoverText = name.map((it:any)=>{
          return `${it.marker} ${it.seriesName} : ${formatUnitValue(getUnitValue(it.data[1]))}`;
        });
        return `${formatDate(date)} <br/> ${hoverText.join("<br/>")}`;
      },
      axisPointer: {
        show:true,
        type:"cross",
        label: {
          textStyle:{
            fontSize:12
          },
          show: true,
          formatter: function (name:any) {
            if(name.axisDimension=="y")
              return formatUnitValue(getUnitValue(name.value));
            const date = new Date(name.value);
            return `${formatDate(date)}`;
          }
        }
      },
    },
    xAxis:{
      type: 'time',
      // data:searchQueryData.data[0].result[0].values.sort((a: any, b: any) => a[0] - b[0]).map((value: any) =>value[0]*1000),
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: function (name:any) {
            return formatUnitValue(getUnitValue(name))
        }
      },
    },
    series:[]
  };

  console.log("x axis data at promql",option.xAxis);
  

  option.series= searchQueryData.data.map((it: any, index: number) => {
    console.log("inside convertPromQLData");
    console.log("convertPromQLData: it", it);

    switch (props.data.value.type) {
      case "bar":
      case "line":
      case "area":
      case "scatter":
      case "area-stacked": {
        console.log("convertPromQLData: itt", it);
        switch (it.resultType) {
          case "matrix": {
            const seriesObj = it?.result?.map((metric: any) => {
              const values = metric.values.sort(
                (a: any, b: any) => a[0] - b[0]
              );
              // console.log("convertPromQLData: values:", values);
              return {
                name: getPromqlLegendName(
                  metric.metric,
                  props.data.value.queries[index].config.promql_legend
                ),
                data: values.map((value: any) => [value[0] * 1000, value[1]]),
                // hovertext: values.map((value: any) =>
                //   formatUnitValue(getUnitValue(value[1]))
                // ),
                // hovertemplate:
                //   "%{x} <br>%{fullData.name}: %{hovertext}<extra></extra>",
                // stackgroup: props.data.value.type == "area-stacked" ? "one" : "",
                ...getPropsByChartTypeForTraces(),
              };
            });
            console.log("seriesObj", seriesObj);
            
            return seriesObj;
          }
          case "vector": {
            const traces = it?.result?.map((metric: any) => {
              const values = [metric.value];
              // console.log('vector',values);

              return {
                name: JSON.stringify(metric.metric),
                x: values.map((value: any) =>
                  moment(value[0] * 1000).toISOString(true)
                ),
                y: values.map((value: any) => value[1]),
              };
            });
            return traces;
          }
        }
      }
      case "metric": {
        switch (it.resultType) {
          case "matrix": {
            const traces = it?.result?.map((metric: any) => {
              const values = metric.values.sort(
                (a: any, b: any) => a[0] - b[0]
              );
              const unitValue = getUnitValue(values[values.length - 1][1]);
              option.dataset = {source:[[]]};
              option.tooltip={
                show:false
              };
              option.angleAxis= {
                type: 'value',
                startAngle: 0,
                show: false,
              };
              option.radiusAxis= {
                type: 'value',
                show: false
              };
              option.polar= {};

              return {
                ...getPropsByChartTypeForTraces(),
                renderItem: ()=>{
                  return {
                    type: 'group',
                    children: [
                      {
                        type: 'text',
                        style: {
                          text: parseFloat(unitValue.value).toFixed(2),
                          fontSize: 80,
                          fontWeight: 500,
                          align: 'center',
                          verticalAlign: 'middle',
                          x: 175,
                          y: 100,
                        }
                      }
                    ]
                  }
                }
              };
            });
            return traces;
          }
          case "vector": {
            const traces = it?.result?.map((metric: any) => {
              const values = [metric.value];

              // console.log('vector',values);

              return {
                name: JSON.stringify(metric.metric),
                value: metric?.value?.length > 1 ? metric.value[1] : "",
                ...getPropsByChartTypeForTraces(),
              };
            });
            return traces;
          }
        }
        break;
      }
      default: {
        return [];
      }
    }
  });

  // let tracess = traces.flat();
  // console.log("tracess", tracess);

  // // Calculate the maximum value size from the 'y' values in the 'traces' array
  // const maxValueSize =
  //   props.data.value.type == "area-stacked"
  //     ? tracess.reduce((sum: any, it: any) => {
  //         let max = it.y.reduce((max: any, i: any) => {
  //           if (!isNaN(i)) return Math.max(max, i);
  //           return max;
  //         }, 0);
  //         return sum + max;
  //       }, 0)
  //     : tracess.reduce(
  //         (max: any, it: any) =>{
  //         return Math.max(max,it.y.reduce((max: any, it: any) => {
  //           if (!isNaN(it)) return Math.max(max, it);
  //           return max;
  //         },
  //         0
  //       ));
  //         },0)

  // // Calculate the minimum value size from the 'y' values in the 'traces' array
  // const minValueSize = tracess.reduce(
  //   (min: any, it: any) => { return Math.min(min,it.y.reduce((min:any,it:any)=> { if(!isNaN(it)) return Math.min(min,it);
  //   return min;
  //  },
  //   maxValueSize
  // ));
  //   },maxValueSize)

  // // Initialize empty arrays to hold tick values and tick text
  // let yTickVals = [];
  // let yTickText = [];

  // // Calculate the interval size for 5 equally spaced ticks
  // let intervalSize = (maxValueSize - minValueSize) / 4;

  // // If the data doesn't vary much, use a percentage of the max value as the interval size
  // if (intervalSize === 0) {
  //   intervalSize = maxValueSize * 0.2;
  // }

  // // Generate tick values and tick text for the y-axis
  // for (let i = 0; i <= 4; i++) {
  //   let val = minValueSize + intervalSize * i;
  //   yTickVals.push(minValueSize + intervalSize * i);
  //   yTickText.push(formatUnitValue(getUnitValue(val)));
  // }
  // // result = result.map((it: any) => moment(it + "Z").toISOString(true))
  // const yAxisTickOptions = !props.data.value.config?.unit
  //   ? {}
  //   : { tickvals: yTickVals, ticktext: yTickText };


  // console.log("maxValueSize:", maxValueSize);
  // console.log("minValueSize:", minValueSize);
  // console.log("yTickVals:", yTickVals);
  // console.log("yTickText:", yTickText);
  // console.log("yAxisTickOptions:", yAxisTickOptions);
  

  // let layout: any;
  // switch (props.data.value.type) {
  //   case "metric":
  //     layout = {
  //     title: false,
  //     showlegend: props.data.value.config?.show_legends,
  //     autosize: true,
  //     legend: {
  //       // bgcolor: "#f7f7f7",
  //       orientation: getLegendPosition("promql"),
  //       itemclick: false,
  //     },
  //     margin: {
  //       autoexpand: true,
  //       l: 10,
  //       r: 10,
  //       t: 0,
  //       b: 0,
  //     },
  //     ...getPropsByChartTypeForLayoutForPromQL(),
  //     ...getThemeLayoutOptions(store),
  //   };
  //   break;

  //   default:
  //     layout = {
  //     title: false,
  //     showlegend: props.data.value.config?.show_legends,
  //     autosize: true,
  //     legend: {
  //       // bgcolor: "#f7f7f7",
  //       orientation: getLegendPosition("promql"),
  //       itemclick: false,
  //     },
  //     margin: {
  //       autoexpand: true,
  //       r: 50,
  //       b: 50,
  //       t: 30,
  //     },
  //     yaxis: {
  //       automargin: true,
  //       autorange: true,
  //       ...yAxisTickOptions,
  //     },
  //     ...getPropsByChartTypeForLayoutForPromQL(),
  //     ...getThemeLayoutOptions(store),
  //   }
  //       break;
  //   }
  // console.log("layout:", layout);
  console.log("option:", option);
  option.series= option.series.flat();

  return { option };
};
