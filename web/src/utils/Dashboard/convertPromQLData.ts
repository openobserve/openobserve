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
    console.log("unit value--", props.data.value.config?.unit);
    
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
          mode: "lines",
        };
      case "scatter":
        return {
          mode: "markers",
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
          fill: "tozeroy", //TODO: hoe to change the color of plot chart
          type: "scatter",
        };
      case "stacked":
        return {
          type: 'bar',
        };
      case "area-stacked":
        return {
          mode: 'lines',  
          // fill: 'none'
        };
      case "metric":
        return {
          type: "indicator",
          mode: "number"
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

  const traces = searchQueryData.data.map((it: any, index: number) => {
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
            const traces = it?.result?.map((metric: any) => {
              const values = metric.values.sort(
                (a: any, b: any) => a[0] - b[0]
              );
              // console.log("convertPromQLData: values:", values);
              return {
                name: getPromqlLegendName(
                  metric.metric,
                  props.data.value.queries[index].config.promql_legend
                ),
                x: values.map((value: any) =>
                  moment(value[0] * 1000).toISOString(true)
                ),
                y: values.map((value: any) => value[1]),
                hovertext: values.map((value: any) =>
                  formatUnitValue(getUnitValue(value[1]))
                ),
                hovertemplate:
                  "%{x} <br>%{fullData.name}: %{hovertext}<extra></extra>",
                stackgroup: props.data.value.type == "area-stacked" ? "one" : "",
                ...getPropsByChartTypeForTraces(),
              };
            });
            console.log("promQLLLLL traces", traces);
            
            return traces;
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

              return {
                value: unitValue.value,
                number: { suffix: unitValue.unit, valueformat: ".2f" },
                ...getPropsByChartTypeForTraces(),
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

  let tracess = traces.flat();
  console.log("tracess", tracess);

  // Calculate the maximum value size from the 'y' values in the 'traces' array
  const maxValueSize =
    props.data.value.type == "area-stacked"
      ? tracess.reduce((sum: any, it: any) => {
          let max = it.y.reduce((max: any, it: any) => {
            if (!isNaN(it)) return Math.max(max, it);
            return max;
          }, 0);
          return sum + max;
        }, 0)
      : tracess.reduce(
          (max: any, it: any) =>{
          return it.y.reduce((max: any, it: any) => {
            if (!isNaN(it)) return Math.max(max, it);
            return max;
          },
          0
        );
          })

  // Calculate the minimum value size from the 'y' values in the 'traces' array
  const minValueSize = tracess.reduce(
    (min: any, it: any) => { return it.y.reduce((min:any,it:any)=> { if(!isNaN(it)) return Math.min(min,it);
    return min;
   },
    maxValueSize
  );
    })

  // Initialize empty arrays to hold tick values and tick text
  let yTickVals = [];
  let yTickText = [];

  // Calculate the interval size for 5 equally spaced ticks
  let intervalSize = (maxValueSize - minValueSize) / 4;

  // If the data doesn't vary much, use a percentage of the max value as the interval size
  if (intervalSize === 0) {
    intervalSize = maxValueSize * 0.2;
  }

  // Generate tick values and tick text for the y-axis
  for (let i = 0; i <= 4; i++) {
    let val = minValueSize + intervalSize * i;
    yTickVals.push(minValueSize + intervalSize * i);
    yTickText.push(formatUnitValue(getUnitValue(val)));
  }
  // result = result.map((it: any) => moment(it + "Z").toISOString(true))
  const yAxisTickOptions = !props.data.value.config?.unit
    ? {}
    : { tickvals: yTickVals, ticktext: yTickText };


  console.log("maxValueSize:", maxValueSize);
  console.log("minValueSize:", minValueSize);
  console.log("yTickVals:", yTickVals);
  console.log("yTickText:", yTickText);
  console.log("yAxisTickOptions:", yAxisTickOptions);
  

  let layout: any;
  switch (props.data.value.type) {
    case "metric":
      layout = {
      title: false,
      showlegend: props.data.value.config?.show_legends,
      autosize: true,
      legend: {
        // bgcolor: "#f7f7f7",
        orientation: getLegendPosition("promql"),
        itemclick: false,
      },
      margin: {
        autoexpand: true,
        l: 10,
        r: 10,
        t: 0,
        b: 0,
      },
      ...getPropsByChartTypeForLayoutForPromQL(),
      ...getThemeLayoutOptions(store),
    };
    break;

    default:
      layout = {
      title: false,
      showlegend: props.data.value.config?.show_legends,
      autosize: true,
      legend: {
        // bgcolor: "#f7f7f7",
        orientation: getLegendPosition("promql"),
        itemclick: false,
      },
      margin: {
        autoexpand: true,
        r: 50,
        b: 50,
        t: 30,
      },
      yaxis: {
        automargin: true,
        autorange: true,
        ...yAxisTickOptions,
      },
      ...getPropsByChartTypeForLayoutForPromQL(),
      ...getThemeLayoutOptions(store),
    }
        break;
    }
  console.log("layout:", layout);
  console.log("traces:", traces);

  return { traces: traces.flat(), layout };
};
