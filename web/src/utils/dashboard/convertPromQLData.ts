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

  const getLegendPosition = () => {
    const legendPosition = props.data.value?.config?.legends_position;

    switch (legendPosition) {
      case "bottom":
        return "horizontal";
      case "right":
        return "vertical";
      default:
        return "horizontal";
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
          emphasis: { focus: "series" },
        };
      case "line":
        return {
          type: "line",
          emphasis: { focus: "series" },
          smooth: true,
          showSymbol: false,
        };
      case "scatter":
        return {
          type: "scatter",
          emphasis: { focus: "series" },
          symbolSize: 5,
        };
      case "pie":
        return {
          type: "pie",
          emphasis: { focus: "series" },
        };
      case "donut":
        return {
          type: "pie",
          emphasis: { focus: "series" },
        };
      case "h-bar":
        return {
          type: "bar",
          orientation: "h",
          emphasis: { focus: "series" },
        };
      case "area":
        return {
          type: "line",
          emphasis: { focus: "series" },
          smooth: true,
          areaStyle: {},
          showSymbol: false,
        };
      case "stacked":
        return {
          type: "bar",
          emphasis: { focus: "series" },
        };
      case "area-stacked":
        return {
          type: "line",
          smooth:true,
          stack: 'Total',
          areaStyle: {},
          showSymbol: false,
          emphasis: {
            focus: 'series'
          }, 
        };
      case "metric":
        return {
          type: 'custom',
          coordinateSystem: 'polar',
        };
      case "h-stacked":
        return {
          type: "bar",
          emphasis: { focus: "series" },
          orientation: "h",
        };
      default:
        return {
          type: "bar",
        };
    }
  };

  // console.log("props", props);
  // console.log("convertPromQLData: searchQueryData", searchQueryData);
  // console.log("convertPromQLData: searchQueryData.data", searchQueryData.data);

  const formatDate =(date:any)=>{
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(2);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
  }

  const legendPosition = getLegendPosition();

  const legendConfig = {
    show: props.data.value.config?.show_legends,
    type: "scroll",
    orient: legendPosition,
    padding: [10, 20, 0, 10],
    tooltip: {
      show: true,
      padding: 10,
      textStyle: {
        fontSize: 12,
      },
      backgroundColor: "rgba(255,255,255,0.8)",
    },
    textStyle: {
      width: 150,
      overflow: "truncate",
    },
  };

  // Additional logic to adjust the legend position
  if (legendPosition === "vertical") {
    legendConfig.left = null; // Remove left positioning
    legendConfig.right = 0; // Apply right positioning
    legendConfig.top = "center"; // Apply bottom positioning
  } else {
    legendConfig.left = "0"; // Apply left positioning
    legendConfig.top = "bottom"; // Apply bottom positioning
  }

  let option:any = {
    backgroundColor: "transparent",
    legend: legendConfig,
    grid: {
      containLabel: true,
      left: "30",
      right:
        legendConfig.orient === "vertical" &&
        props.data.value.config?.show_legends
          ? 220
          : "40",
      top: "15",
      bottom: "30",
    },
    tooltip: {
      show: true,
      trigger: "axis",
      textStyle: {
        fontSize: 12,
      },
      formatter: function (name: any) {
        // console.log("name--", name);
        if (name.length == 0) return "";

        const date = new Date(name[0].data[0]);

        let hoverText = name.map((it:any)=>{
          return `${it.marker} ${it.seriesName} : ${formatUnitValue(getUnitValue(it.data[1]))}`;
        });
        return `${formatDate(date)} <br/> ${hoverText.join("<br/>")}`;
      },
      axisPointer: {
        show: true,
        type: "cross",
        label: {
          fontSize: 12,
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
    xAxis: {
      type: "time",
    },
    yAxis: {
      type: "value",
      axisLabel: {
        formatter: function (name: any) {
          return formatUnitValue(getUnitValue(name));
        },
      },
      axisLine: {
        show: true,
      },
    },
    toolbox: {
      orient: "vertical",
      show: true,
      feature: {
        dataZoom: {
          yAxisIndex: "none",
        },
      },
    },
    series:[]
  };

  // console.log("x axis data at promql",option.xAxis);
  

  option.series= searchQueryData.data.map((it: any, index: number) => {
    // console.log("inside convertPromQLData");
    // console.log("convertPromQLData: it", it);

    switch (props.data.value.type) {
      case "bar":
      case "line":
      case "area":
      case "scatter":
      case "area-stacked": {
        // console.log("convertPromQLData: itt", it);
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
                ...getPropsByChartTypeForTraces(),
              };
            });
            // console.log("seriesObj", seriesObj);
            
            return seriesObj;
          }
          case "vector": {
            const traces = it?.result?.map((metric: any) => {
              const values = [metric.value];
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
                show: false,
              };
              option.radiusAxis= {
                show: false
              };
              option.polar= {};
              option.xAxis= [];
              option.yAxis= [];
              return {
                ...getPropsByChartTypeForTraces(),
                renderItem: function(params: any) {                              
                  return {
                    type: 'text',
                    style: {
                      text: parseFloat(unitValue.value).toFixed(2) + unitValue.unit,
                      fontSize: Math.min((params.coordSys.cx / 2),90),      //coordSys is relative. so that we can use it to calculate the dynamic size
                      fontWeight: 500,
                      align: 'center',
                      verticalAlign: 'middle',
                      x: params.coordSys.cx,
                      y: params.coordSys.cy,
                      fill:store.state.theme == "dark" ? "#fff" : "#000",
                    }
                  }
                } 
              };
            });
            return traces;
          }
          case "vector": {
            const traces = it?.result?.map((metric: any) => {
              const values = [metric.value];
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

  // console.log("option:", option);
  option.series= option.series.flat();

  return { option };
};
