export const convertBillingData = (params:any) => {

  const options: any = {
    backgroundColor: "transparent",
    grid: {
      containLabel: true,
      left: "20",
      right:"200",
      top: "30",
      bottom: "0",
    },
    legend:{
      show: true,
      type: "scroll",
      orient: "vertical",
      left:null,
      right:0,
      bottom:"ceenter",
      padding: [10, 20, 10, 10],
      tooltip: {
        show: true,
        padding: 10,
        textStyle: {
          fontSize: 12,
        },
        backgroundColor: "rgba(255,255,255,0.8)",
      },
      textStyle: {
        width: 100,
        overflow: "truncate",
      },
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
        return `${formatDate(date)} <br/> ${name[0].marker} ${name[0].seriesName} : <b>${name[0].value[1]}${params?.layout?.yaxis?.ticksuffix}</b>`;
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
      axisLabel:{
        formatter: function (value: any) {
          return `${value}${params?.layout?.yaxis?.ticksuffix}`
        }
      }
    },
    series: params?.data?.map((data:any)=>{      
        return {
          name:data.name,
          data: data.x.map((it: any,index: any) => ([it, data.y[index]||0])),
          type:data.type,
          emphasis: { focus: "series" }
        }
      })
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