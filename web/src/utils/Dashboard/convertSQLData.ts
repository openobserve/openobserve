import { getThemeLayoutOptions } from "@/utils/dashboard/getThemeLayoutOptions";

export const convertSQLData = (
  panelSchema: any,
  searchQueryDataTemp: any,
  store: any
) => {
  // console.log("renderSqlBasedChart", props);
  console.log("searchQueryData", searchQueryDataTemp);
  console.log("panelSchema", panelSchema);
  const props = {
    data: panelSchema.value,
    width: 6,
  };

  const searchQueryData = {
    data: searchQueryDataTemp,
  };

  console.log("data after conversion:", props);
  console.log("data after conversion:", searchQueryData);

  //   const store = useStore();
  // const plotRef: any = ref(null);
  // get the x axis key
  const getXAxisKeys = () => {
    console.log("props.data?.queries[0]?.fields.x", props.data?.queries[0]?.fields?.x);

    return props.data?.queries[0]?.fields?.x?.length
      ? props.data?.queries[0]?.fields?.x.map((it: any) => it.alias)
      : [];
  };

  // get the y axis key
  const getYAxisKeys = () => {
    console.log("props.data?.queries[0]?.fields.y", props.data?.queries[0]?.fields?.y);

    return props.data?.queries[0]?.fields?.y?.length
      ? props.data?.queries[0]?.fields?.y.map((it: any) => it.alias)
      : [];
  };

  // get the z axis key
  const getZAxisKeys = () => {
    console.log(
      "props.data?.queries[0]?.fields.z",
      props.data?.queries[0]?.fields?.z
    );

    return props.data?.queries[0]?.fields?.z?.length
      ? props.data?.queries[0]?.fields?.z.map((it: any) => it.alias)
      : [];
  };

  // get the axis data using key
  const getAxisDataFromKey = (key: string) => {
    console.log("key", key);

    // when the key is not available in the data that is not show the default value
    let result: string[] = searchQueryData?.data?.map((item: any) => item[key]);
    console.log("result", result);

    return result;
  };

  const getPropsByChartTypeForTraces = () => {
    switch (props.data.type) {
      case "bar":
        return {
          type: "bar",
        };
      case "line":
        return {
          type: "line",
          areaStyle:null
        };
      case "scatter":
        return {
          type: "scatter",
          symbolSize:10
        };
      case "pie":
        return {
          type: "pie",
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.5)'
            }
          },
          radius:"50%"
        };
      case "donut":
        return {
          type: "pie",
          radius: ['40%', '70%'],
          avoidLabelOverlap: false,
          label: {
            show: false,
            position: 'center'
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 16,
              fontWeight: 'bold'
            }
          },
          labelLine: {
            show: false
          },
        };
      case "h-bar":
        return {
          type: "bar",
        };
      case "area":
        return {
          type: 'line',
          areaStyle: {}
        };
      case "stacked":
        return {
          type: "bar",
        };
      case "heatmap":
        return {
          type: "heatmap",
        };
      case "area-stacked":
        return {
          mode: "lines",
          // fill: 'none'
        };
      case "metric":
        return {
          type: "indicator",
          mode: "number",
        };
      case "h-stacked":
        return {
          type: "bar",
          orientation: "h",
        };
      default:
        return {
          type: "bar",
        };
    }
  };

  const getTickLength = () => props.width - 2;
  const getTickLimits = (layout: string[]) => {
    // do the splitting
    const n = getTickLength();

    // get the range of difference
    console.log("layout", layout);
    const range = layout.length / n;

    // find the indexes at intervals
    const array = [...Array(n).keys()];
    const resultIndex = [
      ...array.map((it: number, i: number) => it * range),
      layout.length - 1,
    ];

    // get the actual values from the indexes
    const tickVals = resultIndex.map((it: number) => layout[Math.floor(it)]);
    return tickVals;
  };

  const getPropsByChartTypeForLayout = () => {
    const xAxisKey = getXAxisKeys().length ? getXAxisKeys()[0] : "";
    console.log("xAxisKey", xAxisKey);
    const xAxisData = getAxisDataFromKey(xAxisKey);
    console.log("xAxisData", xAxisData);
    const xAxisDataWithTicks = getTickLimits(xAxisData);

    console.log("data with tick", xAxisDataWithTicks);

    switch (props.data.type) {
      case "bar": {
        const xaxis: any = {
          title: props.data?.queries[0]?.fields?.x[0]?.label,
          tickangle:
            props.data?.queries[0]?.fields?.x[0]?.aggregationFunction == "histogram"
              ? 0
              : -20,
          automargin: true,
        };

        const yaxis: any = {
          title:
            props.data?.queries[0]?.fields?.y?.length == 1
              ? props.data?.queries[0]?.fields.y[0]?.label
              : "",
          automargin: true,
          fixedrange: true,
        };

        if (props.data?.queries[0]?.fields?.x.length == 1) {
          (xaxis["tickmode"] = "array"),
            (xaxis["tickvals"] = xAxisDataWithTicks),
            (xaxis["ticktext"] = textformat(xAxisDataWithTicks));
        }

        const trace = {
          barmode: "group",
          xaxis: xaxis,
          yaxis: yaxis,
        };
        return trace;
      }
      case "line": {
        const xaxis: any = {
          title: props.data?.queries[0]?.fields?.x[0]?.label,
          tickangle:
            props.data?.queries[0]?.fields?.x[0]?.aggregationFunction == "histogram"
              ? 0
              : -20,
          automargin: true,
          // rangeslider: { range: xAxisDataWithTicks },
        };

        const yaxis: any = {
          title:
            props.data?.queries[0]?.fields?.y?.length == 1
              ? props.data?.queries[0]?.fields?.y[0]?.label
              : "",
          automargin: true,
          fixedrange: true,
        };

        if (props.data?.queries[0]?.fields?.x.length == 1) {
          (xaxis["tickmode"] = "array"),
            (xaxis["tickvals"] = xAxisDataWithTicks),
            (xaxis["ticktext"] = textformat(xAxisDataWithTicks));
        }

        const trace = {
          xaxis: xaxis,
          yaxis: yaxis,
        };
        return trace;
      }
      case "scatter": {
        const xaxis: any = {
          title: props.data?.queries[0]?.fields?.x[0]?.label,
          tickangle:
            props.data?.queries[0]?.fields?.x[0]?.aggregationFunction == "histogram"
              ? 0
              : -20,
          automargin: true,
        };

        const yaxis: any = {
          title:
            props.data?.queries[0]?.fields?.y?.length == 1
              ? props.data?.queries[0]?.fields?.y[0]?.label
              : "",
          automargin: true,
          fixedrange: true,
        };

        if (props.data?.queries[0]?.fields?.x.length == 1) {
          (xaxis["tickmode"] = "array"),
            (xaxis["tickvals"] = xAxisDataWithTicks),
            (xaxis["ticktext"] = textformat(xAxisDataWithTicks));
        }

        const trace = {
          scattermode: "group",
          xaxis: xaxis,
          yaxis: yaxis,
        };
        return trace;
      }
      case "pie":
        return {
          xaxis: {
            title: props.data?.queries[0]?.fields?.x[0]?.label,
            tickangle: -20,
            automargin: true,
          },
          yaxis: {
            tickmode: "array",
            tickvals: xAxisDataWithTicks,
            ticktext: textformat(xAxisDataWithTicks),
            title:
              props.data?.queries[0]?.fields?.y?.length == 1
                ? props.data?.queries[0]?.fields?.y[0]?.label
                : "",
            automargin: true,
          },
        };
      case "donut":
        return {
          xaxis: {
            title: props.data?.queries[0]?.fields?.x[0]?.label,
            tickangle: -20,
            automargin: true,
          },
          yaxis: {
            tickmode: "array",
            tickvals: xAxisDataWithTicks,
            ticktext: textformat(xAxisDataWithTicks),
            title:
              props.data?.queries[0]?.fields?.y?.length == 1
                ? props.data?.queries[0]?.fields?.y[0]?.label
                : "",
            automargin: true,
          },
        };
      case "h-bar": {
        const xaxis: any = {
          title: props.data?.queries[0]?.fields?.y[0]?.label,
          tickangle: -20,
          automargin: true,
          fixedrange: true,
        };

        const yaxis: any = {
          title:
            props.data?.queries[0]?.fields?.x?.length == 1
              ? props.data?.queries[0]?.fields?.x[0]?.label
              : "",
          automargin: true,
        };

        if (props.data?.queries[0]?.fields?.x.length == 1) {
          (yaxis["tickmode"] = "array"),
            (yaxis["tickvals"] = xAxisDataWithTicks),
            (yaxis["ticktext"] = textformat(xAxisDataWithTicks));
        }

        const trace = {
          barmode: "group",
          xaxis: xaxis,
          yaxis: yaxis,
        };

        return trace;
      }
      case "area": {
        const xaxis: any = {
          title: props.data?.queries[0]?.fields?.x[0]?.label,
          tickangle:
            props.data?.queries[0]?.fields?.x[0]?.aggregationFunction == "histogram"
              ? 0
              : -20,
          automargin: true,
        };

        const yaxis: any = {
          title:
            props.data?.queries[0]?.fields?.y?.length == 1
              ? props.data?.queries[0]?.fields?.y[0]?.label
              : "",
          automargin: true,
          fixedrange: true,
        };

        if (props.data?.queries[0]?.fields?.x.length == 1) {
          (xaxis["tickmode"] = "array"),
            (xaxis["tickvals"] = xAxisDataWithTicks),
            (xaxis["ticktext"] = textformat(xAxisDataWithTicks));
        }

        const trace = {
          xaxis: xaxis,
          yaxis: yaxis,
        };

        return trace;
      }
      case "area-stacked": {
        const xaxis: any = {
          title: props.data?.queries[0]?.fields?.x[0]?.label,
          tickangle:
            props.data?.queries[0]?.fields?.x[0]?.aggregationFunction == "histogram"
              ? 0
              : -20,
          automargin: true,
        };

        const yaxis: any = {
          title:
            props.data?.queries[0]?.fields?.y?.length == 1
              ? props.data?.queries[0]?.fields?.y[0]?.label
              : "",
          automargin: true,
          fixedrange: true,
        };

        //show tickvals and ticktext value when the stacked chart hasn't timestamp
        // if the first field is timestamp we dont want to show the tickvals
        // format value only for without timestamp
        // stacked chart is alwayes stacked with first field value
        if (
          props.data?.queries[0]?.fields?.x.length &&
          props.data?.queries[0]?.fields?.x[0].aggregationFunction != "histogram" &&
          !props.data?.queries[0]?.fields?.x[0].column !=
            store.state.zoConfig.timestamp_column
        ) {
          (xaxis["tickmode"] = "array"),
            (xaxis["tickvals"] = xAxisDataWithTicks),
            (xaxis["ticktext"] = textformat(xAxisDataWithTicks));
        }

        const layout = {
          barmode: "stack",
          xaxis: xaxis,
          yaxis: yaxis,
        };

        return layout;
      }
      case "stacked": {
        const xaxis: any = {
          title: props.data?.queries[0]?.fields?.x[0]?.label,
          tickangle:
            props.data?.queries[0]?.fields?.x[0]?.aggregationFunction == "histogram"
              ? 0
              : -20,
          automargin: true,
        };

        const yaxis: any = {
          title:
            props.data?.queries[0]?.fields?.y?.length == 1
              ? props.data?.queries[0]?.fields?.y[0]?.label
              : "",
          automargin: true,
          fixedrange: true,
        };

        //show tickvals and ticktext value when the stacked chart hasn't timestamp
        // if the first field is timestamp we dont want to show the tickvals
        // format value only for without timestamp
        // stacked chart is alwayes stacked with first field value
        if (
          props.data?.queries[0]?.fields?.x.length &&
          props.data?.queries[0]?.fields?.x[0].aggregationFunction != "histogram" &&
          !props.data?.queries[0]?.fields?.x[0].column !=
            store.state.zoConfig.timestamp_column
        ) {
          (xaxis["tickmode"] = "array"),
            (xaxis["tickvals"] = xAxisDataWithTicks),
            (xaxis["ticktext"] = textformat(xAxisDataWithTicks));
        }

        const layout = {
          barmode: "stack",
          xaxis: xaxis,
          yaxis: yaxis,
        };

        return layout;
      }
      case "heatmap": {
        const xaxis: any = {
          title: props.data.fields?.x[0]?.label,
          tickangle:
            props.data?.fields?.x[0]?.aggregationFunction == "histogram"
              ? 0
              : -20,
          automargin: true,
        };
        const yaxis: any = {
          title:
            props.data.fields?.y?.length == 1
              ? props.data.fields.y[0]?.label
              : "",
          automargin: true,
          fixedrange: true,
          autosize: true,
          width: 700,
          height: 700,
        };
        //show tickvals and ticktext value when the stacked chart hasn't timestamp
        // if the first field is timestamp we dont want to show the tickvals
        // format value only for without timestamp
        // stacked chart is alwayes stacked with first field value
        if (
          props.data.fields?.x.length &&
          props.data.fields?.x[0].aggregationFunction != "histogram" &&
          !props.data.fields?.x[0].column !=
            store.state.zoConfig.timestamp_column
        ) {
          (xaxis["tickmode"] = "array"),
            (xaxis["tickvals"] = xAxisDataWithTicks),
            (xaxis["ticktext"] = textformat(xAxisDataWithTicks));
        }
        const layout = {
          xaxis: xaxis,
          yaxis: yaxis,
        };
        return layout;
      }
      case "h-stacked":
        return {
          barmode: "stack",
          xaxis: {
            title: props.data?.queries[0]?.fields?.y[0]?.label,
            tickangle: -20,
            automargin: true,
          },
          yaxis: {
            title:
              props.data?.queries[0]?.fields?.x?.length == 1
                ? props.data?.queries[0]?.fields?.x[0]?.label
                : "",
            automargin: true,
          },
        };
      case "metric":
        return {
          paper_bgcolor: "white",
          // width: 600,
          // height: 200,
        };
      default:
        return {
          xaxis: {
            tickmode: "array",
            tickvals: xAxisDataWithTicks,
            ticktext: textformat(xAxisDataWithTicks),
            title: props.data?.queries[0]?.fields?.x[0]?.label,
            tickangle:
              props.data?.queries[0]?.fields?.x[0]?.aggregationFunction == "histogram"
                ? 0
                : -20,
            automargin: true,
          },
          yaxis: {
            title:
              props.data?.queries[0]?.fields?.y?.length == 1
                ? props.data?.queries[0]?.fields?.y[0]?.label
                : "",
            automargin: true,
            fixedrange: true,
          },
        };
    }
  };

  //It is used for showing long label truncate with "..."
  const textformat = function (layout: any) {
    let data = layout.map((text: any) => {
      if (text && text.toString().length > 15) {
        return text.toString().substring(0, 15) + "...";
      } else {
        return text;
      }
    });
    return data;
  };

  // wrap the text for long x axis names for pie charts
  const addBreaksAtLength = 12;
  const textwrapper = function (traces: any) {
    traces = traces.map((text: any) => {
      let rxp = new RegExp(".{1," + addBreaksAtLength + "}", "g");
      if (text) {
        return text?.toString()?.match(rxp)?.join("<br>");
      } else {
        return " ";
      }
    });
    return traces;
  };
// const getUnitValue = (value: any) => {
//   switch (props.data.value.config?.unit) {
//     case "bytes": {
//       const units = ["B", "KB", "MB", "GB", "TB"];
//       for (let unit of units) {
//         if (value < 1024) {
//           return {
//             value: `${parseFloat(value).toFixed(2)}`,
//             unit: `${unit}`,
//           };
//         }
//         value /= 1024;
//       }
//       return {
//         value: `${parseFloat(value).toFixed(2)}`,
//         unit: "PB",
//       };
//     }
//     case "custom": {
//       return {
//         value: `${value}`,
//         unit: `${props.data.value.config.unit_custom ?? ""}`,
//       };
//     }
//     case "seconds": {
//       const units = [
//         { unit: "ms", divisor: 0.001 },
//         { unit: "s", divisor: 1 },
//         { unit: "m", divisor: 60 },
//         { unit: "h", divisor: 3600 },
//         { unit: "D", divisor: 86400 },
//         { unit: "M", divisor: 2592000 }, // Assuming 30 days in a month
//         { unit: "Y", divisor: 31536000 }, // Assuming 365 days in a year
//       ];
//       for (const unitInfo of units) {
//         const unitValue = value ? value / unitInfo.divisor : 0;
//         if (unitValue >= 1 && unitValue < 1000) {
//           return {
//             value: unitValue.toFixed(2),
//             unit: unitInfo.unit,
//           };
//         }
//       }

//       // If the value is too large to fit in any unit, return the original seconds
//       return {
//         value: value,
//         unit: "s",
//       };
//     }
//     case "bps": {
//       const units = ["B", "KB", "MB", "GB", "TB"];
//       for (let unit of units) {
//         if (value < 1024) {
//           return {
//             value: `${parseFloat(value).toFixed(2)}`,
//             unit: `${unit}/s`,
//           };
//         }
//         value /= 1024;
//       }
//       return {
//         value: `${parseFloat(value).toFixed(2)}`,
//         unit: "PB/s",
//       };
//     }
//     case "percent-1": {
//       return {
//         value: `${(parseFloat(value) * 100).toFixed(2)}`,
//         unit: "%",
//       };
//       // `${parseFloat(value) * 100}`;
//     }
//     case "percent": {
//       return {
//         value: `${parseFloat(value).toFixed(2)}`,
//         unit: "%",
//       };
//       // ${parseFloat(value)}`;
//     }
//     case "default": {
//       return {
//         value: value,
//         unit: "",
//       };
//     }
//     default: {
//       return {
//         value: value,
//         unit: "",
//       };
//     }
//   }
// };

// const formatUnitValue = (obj: any) => {
//   return `${obj.value}${obj.unit}`;
// };

// const maxValueSize =
//   props.data.value.type == "area-stacked"
//     ? tracess.reduce((sum: any, it: any) => {
//         let max = it.y.reduce((max: any, it: any) => {
//           if (!isNaN(it)) return Math.max(max, it);
//           return max;
//         }, 0);
//         return sum + max;
//       }, 0)
//     : tracess.reduce((max: any, it: any) => {
//         return it.y.reduce((max: any, it: any) => {
//           if (!isNaN(it)) return Math.max(max, it);
//           return max;
//         }, 0);
//       });

// // Calculate the minimum value size from the 'y' values in the 'traces' array
// const minValueSize = tracess.reduce((min: any, it: any) => {
//   return it.y.reduce((min: any, it: any) => {
//     if (!isNaN(it)) return Math.min(min, it);
//     return min;
//   }, maxValueSize);
// });

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



  const getLegendPosition = (type: string) => {
    const legendPosition = props.data.config?.legends_position;

    switch (legendPosition) {
      case "bottom":
        return "h";
      case "right":
        return "v";
      default:
        return type == "promql" ? "h" : "v";
    }
  };

  console.log("Query: rendering chart");
  console.log("Query: chart type", props.data);
  // Step 1: Get the X-Axis key
  const xAxisKeys = getXAxisKeys();

  // Step 2: Get the Y-Axis key
  const yAxisKeys = getYAxisKeys();

  const zAxisKeys = getZAxisKeys();

  let traces: any;

  let option={
    tooltip: {
      trigger: 'axis',
      axisPointer: {}
    },
    xAxis:{
      type: 'category',
      boundaryGap: false,
      data: !xAxisKeys.length
        ? []
        : xAxisKeys.length == 1
        ? getAxisDataFromKey(xAxisKeys[0])
        : xAxisKeys?.map((key: any) => {
            return getAxisDataFromKey(key);
        })
    },
    yAxis: {
      type: 'value'
    },
    series:[]
  };

  switch (props.data.type) {
    case "bar":
    case "line":
    case "area": {

      //generate trace based on the y axis keys
      option.series = yAxisKeys?.map((key: any) => {
        const trace = {
          ...getPropsByChartTypeForTraces(),
          data:getAxisDataFromKey(key)
        };
        return trace;
      });
      break;
    }
    case "scatter":
    {
      let i=0;
      option.series = yAxisKeys?.map((key: any) => {
        const trace = {
          ...getPropsByChartTypeForTraces(),
          data:getAxisDataFromKey(key).map((it,index)=>{return [option.xAxis.data[i++],it]}),
        };
        return trace;
      });
      break;
    }
    case "h-bar": {
      //generate trace based on the y axis keys
      option.series = yAxisKeys?.map((key: any) => {
        const trace = {
          ...getPropsByChartTypeForTraces(),
          data:getAxisDataFromKey(key)
        };
        return trace;
      });
      const temp = option.xAxis;
      option.xAxis = option.yAxis;
      option.yAxis=temp;
      break;
    }
    case "pie": {
      option.tooltip={
        trigger: 'item'
      }

      let i=0;
      //generate trace based on the y axis keys
      option.series = yAxisKeys?.map((key: any) => {
        const trace = {
          // name: props.data?.queries[0]?.fields?.y.find(
          //   (it: any) => it.alias == key
          // )?.label,
          ...getPropsByChartTypeForTraces(),
          // showlegend: props.data.config?.show_legends,
          // marker: {
          //   color:
          //     props.data?.queries[0]?.fields?.y.find(
          //       (it: any) => it.alias == key
          //     )?.color || "#5960b2",
          //   opacity: 0.8,
          // },
          // labels: textwrapper(xData),
          data: getAxisDataFromKey(key).map((it,index)=>{return {value:it,name:option.xAxis.data[i++]}}),
          // hovertemplate: "%{label}: %{value} (%{percent})<extra></extra>",
        };
        return trace;
      });
      console.log("multiple:- traces", traces);
      break;
    }
    case "donut": {

      let i=0;
      //generate trace based on the y axis keys
      option.series = yAxisKeys?.map((key: any) => {
        const trace = {
          // name: props.data?.queries[0]?.fields?.y.find(
          //   (it: any) => it.alias == key
          // )?.label,
          ...getPropsByChartTypeForTraces(),
          // showlegend: props.data.config?.show_legends,
          // marker: {
          //   color:
          //     props.data?.queries[0]?.fields?.y.find(
          //       (it: any) => it.alias == key
          //     )?.color || "#5960b2",
          //   opacity: 0.8,
          // },
          // labels: textwrapper(xData),
          data: getAxisDataFromKey(key).map((it,index)=>{return {value:it,name:option.xAxis.data[i++]}}),
          // hovertemplate: "%{label}: %{value} (%{percent})<extra></extra>",
        };
        return trace;
      });
      console.log("multiple:- traces", traces);
      break;
    }
    case "area-stacked": {
      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      const key1 = xAxisKeys[1];
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue = [
        ...new Set(searchQueryData.data.map((obj: any) => obj[key1])),
      ].filter((it) => it);
      console.log("stacked x axis unique value", stackedXAxisUniqueValue);

      // create a trace based on second xAxis's unique values
      traces = stackedXAxisUniqueValue?.map((key: any) => {
        const trace = {
          name: key,
          ...getPropsByChartTypeForTraces(),
          showlegend: props.data.config?.show_legends,
          x: Array.from(
            new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))
          ),
          y: Array.from(
            new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))
          ).map(
            (it: any) =>
              searchQueryData.data.find(
                (it2: any) => it2[xAxisKeys[0]] == it && it2[key1] == key
              )?.[yAxisKeys[0]] || 0
          ),
          customdata: Array.from(
            new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))
          ), //TODO: need to check for the data value
          hovertemplate:
            "%{fullData.name}: %{y}<br>%{customdata}<extra></extra>", //TODO: need to check for the data value
          stackgroup: "one",
        };
        return trace;
      });
      console.log("multiple:- traces", traces);
      break;
    }
    case "stacked": {
      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      const key1 = xAxisKeys[1];
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue = [
        ...new Set(searchQueryData.data.map((obj: any) => obj[key1])),
      ].filter((it) => it);
      console.log("stacked x axis unique value", stackedXAxisUniqueValue);

      // create a trace based on second xAxis's unique values
      traces = stackedXAxisUniqueValue?.map((key: any) => {
        console.log(
          "--inside trace--",
          props.data?.queries[0]?.fields?.x.find((it: any) => it.alias == key)
        );

        const trace = {
          name: key,
          ...getPropsByChartTypeForTraces(),
          showlegend: props.data.config?.show_legends,
          x: Array.from(
            new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))
          ),
          y: Array.from(
            new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))
          ).map(
            (it: any) =>
              searchQueryData.data.find(
                (it2: any) => it2[xAxisKeys[0]] == it && it2[key1] == key
              )?.[yAxisKeys[0]] || 0
          ),
          customdata: Array.from(
            new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))
          ), //TODO: need to check for the data value
          hovertemplate:
            "%{fullData.name}: %{y}<br>%{customdata}<extra></extra>", //TODO: need to check for the data value
        };
        return trace;
      });
      console.log("multiple:- traces", traces);
      break;
    }
    case "heatmap": {
      // get first x axis key
      const key0 = xAxisKeys[0];
      // get the unique value of the first xAxis's key
      const xAxisZerothPositionUniqueValue = [
        ...new Set(searchQueryData.data.map((obj: any) => obj[key0])),
      ].filter((it) => it);
      console.log(
        "X axis zeroth position unique values",
        xAxisZerothPositionUniqueValue
      );

      // get second x axis key
      const key1 = yAxisKeys[0];
      // get the unique value of the second xAxis's key
      const xAxisFirstPositionUniqueValue = [
        ...new Set(searchQueryData.data.map((obj: any) => obj[key1])),
      ].filter((it) => it);
      console.log(
        "X axis first position unique values",
        xAxisFirstPositionUniqueValue
      );

      const yAxisKey0 = zAxisKeys[0];
      traces = [];
      const Zvalues: any = xAxisFirstPositionUniqueValue.map((first: any) => {
        return xAxisZerothPositionUniqueValue.map((zero: any) => {
          return (
            searchQueryData.data.find(
              (it: any) => it[key0] == zero && it[key1] == first
            )?.[yAxisKey0] || null
          );
          // searchQueryData.data.map((it: any) => {
          //     if(it[key0] == zero && it[key1] == first){
          //         Zvalue.push(it[yAxisKey0])
          //     }
          // })
          // console.log("Zvalue", Zvalue);

          // Zvalues.push(Zvalue)
        });
      });
      console.log("Zvalues=", Zvalues);

      const trace = {
        x: xAxisZerothPositionUniqueValue,
        y: xAxisFirstPositionUniqueValue,
        z: Zvalues,
        ...getPropsByChartTypeForTraces(),
        hoverongaps: false,
      };
      console.log("trace:", trace);

      traces.push(trace);
      console.log("multiple:- traces", traces);
      break;
    }
    case "h-stacked": {
      // stacked with xAxis second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      const key1 = xAxisKeys[1];
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue = [
        ...new Set(searchQueryData.data.map((obj: any) => obj[key1])),
      ].filter((it) => it);
      console.log("stacked x axis unique value", stackedXAxisUniqueValue);

      // create a trace based on second xAxis's unique values
      traces = stackedXAxisUniqueValue?.map((key: any) => {
        console.log(
          "--inside trace--",
          props.data?.queries[0]?.fields?.x.find((it: any) => it.alias == key)
        );

        const trace = {
          name: key,
          ...getPropsByChartTypeForTraces(),
          showlegend: props.data.config?.show_legends,
          x: searchQueryData.data
            .filter((item: any) => item[key1] === key)
            .map((it: any) => it[yAxisKeys[0]]),
          y: searchQueryData.data
            .filter((item: any) => item[key1] === key)
            .map((it: any) => it[xAxisKeys[0]]),
          customdata: getAxisDataFromKey(key), //TODO: need to check for the data value
          hovertemplate:
            "%{fullData.name}: %{y}<br>%{customdata}<extra></extra>", //TODO: need to check for the data value
        };
        return trace;
      });
      console.log("multiple:- traces", traces);
      break;
    }
    case "metric": {
      const key1 = yAxisKeys[0];
      const yAxisValue = getAxisDataFromKey(key1);
      console.log("metric changed");
      traces = [];
      const trace = {
        ...getPropsByChartTypeForTraces(),
        value: yAxisValue.length > 0 ? yAxisValue[0] : 0,
      };
      traces.push(trace);
      break;
    }
    default: {
      break;
    }
  }

  console.log("Query: props by layout: ", getPropsByChartTypeForLayout());

  //generate the layout value of chart
  const layout: any = {
    title: false,
    showlegend: props.data.config?.show_legends,
    autosize: true,
    legend: {
      bgcolor: "#0000000b",
      orientation: getLegendPosition("sql"),
      itemclick: ["pie", "donut"].includes(props.data.type) ? "toggle" : false,
    },
    // ...yAxisTickOptions,
    margin: {
      l: props.data.type == "pie" ? 60 : 32,
      r: props.data.type == "pie" ? 60 : 16,
      t: 38,
      b: 32,
    },
    ...getPropsByChartTypeForLayout(),
    ...getThemeLayoutOptions(store),
  };

  console.log("layout", layout);
  console.log("traces", traces);

  // Plotly.react(plotRef.value, traces, layout, {
  //   responsive: true,
  //   displaylogo: false,
  //   displayModeBar: false,
  // });
  return {
    traces:option,
    layout,
  };
};
