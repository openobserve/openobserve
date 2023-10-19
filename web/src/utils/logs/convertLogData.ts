export const convertLogData = (
    x: any,
    y: any,
    params: { title: any; unparsed_x_data: any}
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
      right:"20",
      top: "30",
      bottom: "0",
    },
    tooltip: {
      show:true,
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
      formatter: function (name: any) {
        if (name.length == 0) return "";
        const date = new Date(name[0].data[0]);
        return `(${formatDate(date)}, <b>${name[0].value[1]}</b>)`;
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
    },
    toolbox: {
      orient: "vertical",
      show:true,
      feature: {
        dataZoom: {
          show:true,
          yAxisIndex: "none",
        },
      },
    },
    series: [
      {
        data: [...x].map((it: any,index: any) => ([it, y[index]||0])),
        type:"bar",
        emphasis: { focus: "series" }
      }
    ],
   }
    return {options};
}

const formatDate = (date: any) => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear()).slice(2);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}