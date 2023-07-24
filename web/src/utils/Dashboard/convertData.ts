import { reactive, ref } from "vue";
import { useStore } from "vuex";
import Plotly from "plotly.js";

export const convertData = async (props: any, searchQueryData:any, store: any) => {
    console.log("renderSqlBasedChart", props);
    console.log("searchQueryData", searchQueryData);
    
//   const store = useStore();
  // const plotRef: any = ref(null);
  // get the x axis key
  const getXAxisKeys = () => {
    return props.data.fields?.x?.length
      ? props.data.fields?.x.map((it: any) => it.alias)
      : [];
  };

  // get the y axis key
  const getYAxisKeys = () => {
    return props.data.fields?.y?.length
      ? props.data.fields?.y.map((it: any) => it.alias)
      : [];
  };

  // get the axis data using key
  const getAxisDataFromKey = (key: string) => {
    // when the key is not available in the data that is not show the default value
    let result: string[] = searchQueryData?.data?.map((item: any) => item[key]);
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
          type: "bar",
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

  const getThemeLayoutOptions = () => ({
    paper_bgcolor: store.state.theme === "dark" ? "#181a1b" : "#fff",
    plot_bgcolor: store.state.theme === "dark" ? "#181a1b" : "#fff",
    font: {
      size: 12,
      color: store.state.theme === "dark" ? "#fff" : "#181a1b",
    },
  });

  const getTickLength = () => props.width - 2;
  const getTickLimits = (layout: string[]) => {
    // do the splitting
    const n = getTickLength();

    // get the range of difference
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
    const xAxisData = getAxisDataFromKey(xAxisKey);
    const xAxisDataWithTicks = getTickLimits(xAxisData);

      console.log("data with tick",xAxisDataWithTicks);

    switch (props.data.type) {
      case "bar": {
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
        };

        if (props.data.fields?.x.length == 1) {
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
          title: props.data.fields?.x[0]?.label,
          tickangle:
            props.data?.fields?.x[0]?.aggregationFunction == "histogram"
              ? 0
              : -20,
          automargin: true,
          // rangeslider: { range: xAxisDataWithTicks },
        };

        const yaxis: any = {
          title:
            props.data.fields?.y?.length == 1
              ? props.data.fields.y[0]?.label
              : "",
          automargin: true,
          fixedrange: true,
        };

        if (props.data.fields?.x.length == 1) {
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
        };

        if (props.data.fields?.x.length == 1) {
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
            title: props.data.fields?.x[0]?.label,
            tickangle: -20,
            automargin: true,
          },
          yaxis: {
            tickmode: "array",
            tickvals: xAxisDataWithTicks,
            ticktext: textformat(xAxisDataWithTicks),
            title:
              props.data.fields?.y?.length == 1
                ? props.data.fields.y[0]?.label
                : "",
            automargin: true,
          },
        };
      case "donut":
        return {
          xaxis: {
            title: props.data.fields?.x[0]?.label,
            tickangle: -20,
            automargin: true,
          },
          yaxis: {
            tickmode: "array",
            tickvals: xAxisDataWithTicks,
            ticktext: textformat(xAxisDataWithTicks),
            title:
              props.data.fields?.y?.length == 1
                ? props.data.fields.y[0]?.label
                : "",
            automargin: true,
          },
        };
      case "h-bar": {
        const xaxis: any = {
          title: props.data.fields?.y[0]?.label,
          tickangle: -20,
          automargin: true,
          fixedrange: true,
        };

        const yaxis: any = {
          title:
            props.data.fields?.x?.length == 1
              ? props.data.fields.x[0]?.label
              : "",
          automargin: true,
        };

        if (props.data.fields?.x.length == 1) {
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
        };

        if (props.data.fields?.x.length == 1) {
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
          barmode: "stack",
          xaxis: xaxis,
          yaxis: yaxis,
        };

        return layout;
      }
      case "stacked": {
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
          barmode: "stack",
          xaxis: xaxis,
          yaxis: yaxis,
        };

        return layout;
      }
      case "h-stacked":
        return {
          barmode: "stack",
          xaxis: {
            title: props.data.fields?.y[0]?.label,
            tickangle: -20,
            automargin: true,
          },
          yaxis: {
            title:
              props.data.fields?.x?.length == 1
                ? props.data.fields.x[0]?.label
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
            title: props.data.fields?.x[0]?.label,
            tickangle:
              props.data?.fields?.x[0]?.aggregationFunction == "histogram"
                ? 0
                : -20,
            automargin: true,
          },
          yaxis: {
            title:
              props.data.fields?.y?.length == 1
                ? props.data.fields.y[0]?.label
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

  let traces: any;

  switch (props.data.type) {
    case "bar":
    case "line":
    case "scatter":
    case "area": {
      // x axis values
      // if x axis length is 1, then use the normal labels,
      // more more than one, we need to create array of array for each key
      const xData = !xAxisKeys.length
        ? []
        : xAxisKeys.length == 1
        ? getAxisDataFromKey(xAxisKeys[0])
        : xAxisKeys?.map((key: any) => {
            return getAxisDataFromKey(key);
          });

      //generate trace based on the y axis keys
      traces = yAxisKeys?.map((key: any) => {
        const trace = {
          name: props.data.fields?.y.find((it: any) => it.alias == key)?.label,
          ...getPropsByChartTypeForTraces(),
          showlegend: props.data.config?.show_legends,
          marker: {
            color:
              props.data.fields?.y.find((it: any) => it.alias == key)?.color ||
              "#5960b2",
            opacity: 0.8,
          },
          x: xData,
          y: getAxisDataFromKey(key),
          customdata: getAxisDataFromKey(xAxisKeys[0]), //TODO: need to check for the data value, check for multiple x
          hovertemplate:
            "%{fullData.name}: %{y}<br>%{customdata}<extra></extra>", //TODO: need to check for the data value
        };
        return trace;
      });
      break;
    }
    case "h-bar": {
      // x axis values
      // if x axis length is 1, then use the normal labels,
      // more more than one, we need to create array of array for each key
      const xData = !xAxisKeys.length
        ? []
        : xAxisKeys.length == 1
        ? getAxisDataFromKey(xAxisKeys[0])
        : xAxisKeys?.map((key: any) => {
            return getAxisDataFromKey(key);
          });

      //generate trace based on the y axis keys
      traces = yAxisKeys?.map((key: any) => {
        const trace = {
          name: props.data.fields?.y.find((it: any) => it.alias == key)?.label,
          ...getPropsByChartTypeForTraces(),
          showlegend: props.data.config?.show_legends,
          marker: {
            color:
              props.data.fields?.y.find((it: any) => it.alias == key)?.color ||
              "#5960b2",
            opacity: 0.8,
          },
          x: getAxisDataFromKey(key),
          y: xData,
          customdata: getAxisDataFromKey(xAxisKeys[0]), //TODO: need to check for the data value, check for multiple x
          hovertemplate:
            "%{fullData.name}: %{x}<br>%{customdata}<extra></extra>", //TODO: need to check for the data value
        };
        return trace;
      });
      break;
    }
    case "pie": {
      // x axis values
      // if x axis length is 1, then use the normal labels,
      // more more than one, we need to create array of array for each key
      const xData = !xAxisKeys.length
        ? []
        : xAxisKeys.length == 1
        ? getAxisDataFromKey(xAxisKeys[0])
        : xAxisKeys?.map((key: any) => {
            return getAxisDataFromKey(key);
          });

      //generate trace based on the y axis keys
      traces = yAxisKeys?.map((key: any) => {
        const trace = {
          name: props.data.fields?.y.find((it: any) => it.alias == key)?.label,
          ...getPropsByChartTypeForTraces(),
          showlegend: props.data.config?.show_legends,
          marker: {
            color:
              props.data.fields?.y.find((it: any) => it.alias == key)?.color ||
              "#5960b2",
            opacity: 0.8,
          },
          labels: textwrapper(xData),
          values: getAxisDataFromKey(key),
          hovertemplate: "%{label}: %{value} (%{percent})<extra></extra>",
        };
        return trace;
      });
        console.log("multiple:- traces", traces);
      break;
    }
    case "donut": {
      // x axis values
      // if x axis length is 1, then use the normal labels,
      // more more than one, we need to create array of array for each key
      const xData = !xAxisKeys.length
        ? []
        : xAxisKeys.length == 1
        ? getAxisDataFromKey(xAxisKeys[0])
        : xAxisKeys?.map((key: any) => {
            return getAxisDataFromKey(key);
          });

      //generate trace based on the y axis keys
      traces = yAxisKeys?.map((key: any) => {
        const trace = {
          name: props.data.fields?.y.find((it: any) => it.alias == key)?.label,
          ...getPropsByChartTypeForTraces(),
          showlegend: props.data.config?.show_legends,
          marker: {
            color:
              props.data.fields?.y.find((it: any) => it.alias == key)?.color ||
              "#5960b2",
            opacity: 0.8,
          },
          labels: textwrapper(xData),
          values: getAxisDataFromKey(key),
          domain: { column: 0 },
          hole: 0.4,
          hovertemplate: "%{label}: %{value} (%{percent})<extra></extra>",
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
          console.log("--inside trace--",props.data.fields?.x.find((it: any) => it.alias == key));

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
          console.log("--inside trace--",props.data.fields?.x.find((it: any) => it.alias == key));

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
        console.log('metric changed',);
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
    margin: {
      l: props.data.type == "pie" ? 60 : 32,
      r: props.data.type == "pie" ? 60 : 16,
      t: 38,
      b: 32,
    },
    ...getPropsByChartTypeForLayout(),
    ...getThemeLayoutOptions(),
  };

    console.log('layout', layout);
    console.log('traces', traces);

  // Plotly.react(plotRef.value, traces, layout, {
  //   responsive: true,
  //   displaylogo: false,
  //   displayModeBar: false,
  // });
  return {
    traces,
    layout,
  };
};


