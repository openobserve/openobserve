import { toZonedTime, format } from "date-fns-tz";
export const convertLogData = (
  x: any,
  y: any,
  params: { title: any; unparsed_x_data: any; timezone: string }
) => {
  const options: any = {
    title: {
      left: "center",
      textStyle: {
        fontSize: 12,
        fontWeight: "normal",
      },
    },
    backgroundColor: "transparent",
    grid: {
      containLabel: true,
      left: "20",
      right: "20",
      top: "5",
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
        },
      },
      formatter_test: function (name: any) {
        if (name.length == 0) return "";
        const date = new Date(name[0].data[0]);

        const DateFormatOptions: any = {
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          hourCycle: "h23", // Use a 24-hour cycle format without a day period.
          minute: "2-digit",
          second: "2-digit",
        };

        const formatter = new Intl.DateTimeFormat("en-US", DateFormatOptions);
        const formattedDate = formatter.format(new Date(date));
        return `(${formattedDate} ${params.timezone}, <b>${name[0].value[1]}</b>)`;
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
      axisPointer: {
        label: {
          precision: 0,
        },
      },
      // yaxis interval(it will show three values: 0, mid, max value)
      interval: Math.max(...y) / 2,
      axisLabel: {
        formatter: function (value: any) {
          // Format the Y-axis label to show values without decimal points
          return Math.round(value);
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
        data: [...x].map((it: any, index: any) => [
          params.timezone != "UTC" ? toZonedTime(it, params.timezone) : it,
          y[index] || 0,
        ]),
        type: "bar",
        emphasis: { focus: "series" },
        itemStyle: {
          color: "#7A80C2",
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
