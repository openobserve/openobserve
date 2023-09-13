export const convertTraceData = (
    props:any,
  ) => {
  const options: any = {
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
        data: [...props.data[0]?.x].map((it: any,index: any) => ([it, props.data[0]?.y[index]||0])),
        type: "scatter",
        emphasis: { focus: "series" },
        symbolSize: 5
      }
    ],
   }
    return {options};
}

export const convertTimelineData = (props:any)=>{  
  const options =  {
    title: {
      text: 'Trace Timeline',
      textStyle: {
        fontSize: 13,
        fontWeight: "600",
      },
    },
    dataZoom: [
      {
        type: 'slider',
        xAxisIndex: 0,
        filterMode: 'weakFilter',
        height: 20,
        bottom: 0,
        start: 0,
        end:  props.layout.shapes.reduce((it:any,max:any)=>Math.max(it.x0||0,max),0),
        showDetail: false
      }
    ],
    grid: {
      containLabel: true,
      left: "20",
      right:"20",
      top: "30",
      bottom: "40",
    },
    yAxis: {
      type: 'category',
       axisTick: { show: false },
        splitLine: { show: false },
        axisLine: { show: false },
        axisLabel: { show: false }
    },
    xAxis: {
      type: 'value'
    },
    series: [
      {
        type: 'bar',
        stack: 'Total',
        silent: true,
        itemStyle: {
          borderColor: 'transparent',
          color: 'transparent'
        },
        emphasis: {
          itemStyle: {
            borderColor: 'transparent',
            color: 'transparent'
          }
        },
        data: props.layout.shapes.map((it:any)=>(it.x0))
      },
      {
        type: 'bar',
        stack: 'Total',
        barWidth:"100%",
        barCategoryGap:"0%",
        data: props.layout.shapes.map((it:any)=>({value:it.x1,itemStyle:{color:it.fillcolor}}))
      }
    ]
  };
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