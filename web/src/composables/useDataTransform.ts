import { onMounted, reactive, ref } from 'vue';
import Plotly from "plotly.js"
import { useStore } from "vuex";

const renderPromQlBasedChart = (props: any) => {
  const searchQueryData = reactive({
    data: [] as any | Array<any>,
    loading: false,
  });
  const plotRef: any = ref(null);
  const store = useStore();

  // console.log("props", props);
  const renderPromQlBasedChart = () => {
    console.log("propssssssssss");

    switch (searchQueryData.data.resultType) {
      case "matrix": {
        const traces = searchQueryData.data?.result?.map((metric: any) => {
          const values = metric.values.sort((a: any, b: any) => a[0] - b[0]);
          console.log("metric", props.data.config.promql_legend);

          return {
            name: getPromqlLegendName(
              metric.metric,
              props.data.config.promql_legend
            ),
            x: values.map((value: any) =>
              new Date(value[0] * 1000).toISOString()
            ),
            y: values.map((value: any) => value[1]),
            hovertemplate: "%{x}: %{y:.2f}<br>%{fullData.name}<extra></extra>",
          };
        });

        const layout: any = {
          title: false,
          showlegend: props.data.config?.show_legends,
          autosize: true,
          legend: {
            orientation: getLegendPosition("promql"),
            itemclick: false,
          },
          margin: {
            autoexpand: true,
            l: 50,
            r: 50,
            t: 50,
            b: 50,
          },
          ...getThemeLayoutOptions(),
        };

        Plotly.react(plotRef.value, traces, layout, {
          responsive: true,
          displaylogo: false,
          displayModeBar: false,
        });

        break;
      }
      case "vector": {
        const traces = searchQueryData.data?.result?.map((metric: any) => {
          const values = [metric.value];
          console.log("vector", values);

          return {
            name: JSON.stringify(metric.metric),
            x: values.map((value: any) =>
              new Date(value[0] * 1000).toISOString()
            ),
            y: values.map((value: any) => value[1]),
          };
        });

        const layout: any = {
          title: false,
          showlegend: props.data.config?.show_legends,
          autosize: true,
          legend: {
            orientation: getLegendPosition("promql"),
            itemclick: false,
          },
          margin: {
            l: props.data.type == "pie" ? 60 : 32,
            r: props.data.type == "pie" ? 60 : 16,
            t: 38,
            b: 32,
          },
          ...getThemeLayoutOptions(),
        };

        Plotly.react(plotRef.value, traces, layout, {
          responsive: true,
          displaylogo: false,
          displayModeBar: false,
        });

        break;
      }
    }
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

  const getThemeLayoutOptions = () => ({
    paper_bgcolor: store.state.theme === "dark" ? "#181a1b" : "#fff",
    plot_bgcolor: store.state.theme === "dark" ? "#181a1b" : "#fff",
    font: {
      size: 12,
      color: store.state.theme === "dark" ? "#fff" : "#181a1b",
    },
  });
  return {
    searchQueryData,
    plotRef,
  };
};
export default renderPromQlBasedChart ;