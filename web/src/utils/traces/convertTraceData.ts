import { toZonedTime, format } from "date-fns-tz";
export const convertTraceData = (props: any, timezone: string) => {
  const options: any = {
    backgroundColor: "transparent",
    grid: {
      containLabel: true,
      left: "20",
      right: "20",
      top: "30",
      bottom: "0",
    },
    tooltip: {
      show: true,
      trigger: "axis",
      textStyle: {
        fontSize: 12,
      },
      axisPointer: {
        type: "cross",
        label: {
          show: true,
          fontsize: 12,
          formatter: (name: any) => {
            if (name.axisDimension == "x")
              return `${formatDate(new Date(name.value))}`;
            else return `${name?.value?.toFixed(2)}ms`;
          },
        },
      },
      formatter: function (name: any) {
        if (name.length == 0) return "";
        const date = new Date(name[0].data[0]);

        const options: any = {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          hourCycle: "h23", // Use a 24-hour cycle format without a day period.
          minute: "2-digit",
          second: "2-digit",
        };

        const formatter = new Intl.DateTimeFormat("en-US", options);
        const formattedDate = formatter.format(new Date(date));
        return `(${formattedDate} ${timezone}, <b>${name[0].value[1]}</b>)`;
      },
    },
    xAxis: {
      type: "time",
    },
    yAxis: {
      type: "value",
      axisLine: {
        show: true,
      },
      axisLabel: {
        formatter: function (name: any) {
          return `${name} ms`;
        },
      },
    },
    toolbox: {
      orient: "vertical",
      show: true,
      showTitle: false,
      tooltip: {
        show: false,
      },
      itemSize: 0,
      itemGap: 0,
      // it is used to hide toolbox buttons
      bottom: "100%",
      feature: {
        dataZoom: {
          show: true,
          yAxisIndex: "none",
        },
      },
    },
    series: [
      {
        data: [...(props.data[0]?.x || [])]?.map((it: any, index: any) => [
          timezone != "UTC" ? toZonedTime(it, timezone) : it,
          props.data[0]?.y[index] || 0,
        ]),
        type: "scatter",
        emphasis: { focus: "series" },
        symbolSize: 5,
        itemStyle: {
          color: "#7A80C2",
        },
      },
    ],
  };
  return { options };
};

export const convertTimelineData = (props: any) => {
  const options = {
    dataZoom: [
      {
        type: "slider",
        xAxisIndex: 0,
        filterMode: "none",
        height: 20,
        bottom: 20,
        showDetail: false,
      },
    ],
    grid: {
      containLabel: true,
      left: "20",
      right: "20",
      top: "30",
      bottom: "40",
    },
    yAxis: {
      type: "category",
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
    },
    xAxis: {
      type: "value",
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        formatter: (params: any) => {
          return params + "ms";
        },
      },
    },
    series: [
      {
        type: "bar",
        stack: "Total",
        silent: true,
        itemStyle: {
          borderColor: "transparent",
          color: "transparent",
        },
        emphasis: {
          itemStyle: {
            borderColor: "transparent",
            color: "transparent",
          },
        },
        data: props.value.data.map((it: any) => it.x0),
      },
      {
        type: "bar",
        stack: "Total",
        barWidth: "100%",
        barCategoryGap: "0%",
        data: props.value.data.map((it: any) => ({
          value: it.x1 - it.x0,
          itemStyle: { color: it.fillcolor },
        })),
      },
    ],
  };
  return { options };
};

export const convertTraceServiceMapData = (
  data: any,
  treeDepth: number = 3
) => {
  const options = {
    tooltip: {
      show: false,
    },
    series: [
      {
        type: "tree",
        data: data,
        symbolSize: 20,
        initialTreeDepth: treeDepth,
        label: {
          position: "bottom",
          verticalAlign: "bottom",
          distance: 25,
          fontSize: 12,
        },
      },
    ],
  };
  return { options };
};

const formatDate = (date: any) => {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};
