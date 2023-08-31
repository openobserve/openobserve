export const convertSQLData = (
  panelSchema: any,
  searchQueryDataTemp: any,
  store: any
) => {
  const props = {
    data: panelSchema.value,
    width: 6,
  };

  const searchQueryData = {
    data: searchQueryDataTemp,
  };

  // get the x axis key
  const getXAxisKeys = () => {
    return props.data?.queries[0]?.fields?.x?.length
      ? props.data?.queries[0]?.fields?.x.map((it: any) => it.alias)
      : [];
  };

  // get the y axis key
  const getYAxisKeys = () => {
    return props.data?.queries[0]?.fields?.y?.length
      ? props.data?.queries[0]?.fields?.y.map((it: any) => it.alias)
      : [];
  };

  // get the z axis key
  const getZAxisKeys = () => {
    return props.data?.queries[0]?.fields?.z?.length
      ? props.data?.queries[0]?.fields?.z.map((it: any) => it.alias)
      : [];
  };

  // get the axis data using key
  const getAxisDataFromKey = (key: string) => {

    const data = searchQueryData.data.filter((item: any) => {
      return xAxisKeys.every((key: any) => {
        return item[key]!=null;
      }) && yAxisKeys.every((key: any) => {
        return item[key]!=null;
      })
    })
        
    const keys = Object.keys(data[0]); // Assuming there's at least one object
    const keyArrays:any = {};
    
    for (const key of keys) {
      keyArrays[key] = data.map((obj:any) => obj[key]);
    }
    
    let result = keyArrays[key]||[];
    

    // when the key is not available in the data that is not show the default value
    const field = props.data.queries[0].fields?.x.find((it: any) => it.aggregationFunction == 'histogram' && it.column == store.state.zoConfig.timestamp_column)
    if (field && field.alias == key) {
      // now we have the format, convert that format
      result = result.map((it: any) => (new Date(it)-new Date("1970-01-01T00:00:00")));
    }
    return result;
  };

  const getPropsByChartTypeForTraces = () => {
    switch (props.data.type) {
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
          areaStyle: null,
        };
      case "scatter":
        return {
          type: "scatter",
          emphasis: { focus: "series" },
          symbolSize: 10,
        };
      case "pie":
        return {
          type: "pie",
          avoidLabelOverlap: false,
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.5)'
            },
            label:{
              show:true
            }
          },
          label:{
            show:true
          },
          radius:"80%"
        };
      case "donut":
        return {
          type: "pie",
          radius: ['50%', '80%'],
          avoidLabelOverlap: false,
          label: {
            show: true,
            // position: 'center'
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 12,
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
          emphasis: { focus: "series" },
        };
      case "area":
        return {
          type: "line",
          smooth:true,
          emphasis: { focus: "series" },
          areaStyle: {},
        };
      case "stacked":
        return {
          type: 'bar',
          stack: 'total',
          emphasis: {
            focus: 'series'
          },
      };
      case "heatmap":
        return {
          type:"heatmap",
          label:{
            show:true
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 10,
              shadowColor: 'rgba(0, 0, 0, 0.5)'
            }
          },
        };
      case "area-stacked":
        return {
          type: "line",
          smooth:true,
          stack: 'Total',
          areaStyle: {},
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
          type: 'bar',
          stack: 'total',
          emphasis: {
            focus: 'series'
          },
        };
      default:
        return {
          type: "bar",
        };
    }
  };

const getUnitValue = (value: any) => {  
  switch (props.data.config?.unit) {
    case "bytes": {
      const units = ["B", "KB", "MB", "GB", "TB"];
      for (let unit of units) {
        if (value < 1024) {
          return {
            value: `${parseFloat(value).toFixed(2)}`,
            unit: `${unit}`,
          };
        }
        value /= 1024;
      }
      return {
        value: `${parseFloat(value).toFixed(2)}`,
        unit: "PB",
      };
    }
    case "custom": {
      return {
        value: `${value}`,
        unit: `${props.data.config.unit_custom ?? ""}`,
      };
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
        const unitValue = value ? value / unitInfo.divisor : 0;
        if (unitValue >= 1 && unitValue < 1000) {
          return {
            value: unitValue.toFixed(2),
            unit: unitInfo.unit,
          };
        }
      }

      // If the value is too large to fit in any unit, return the original seconds
      return {
        value: value,
        unit: "s",
      };
    }
    case "bps": {
      const units = ["B", "KB", "MB", "GB", "TB"];
      for (let unit of units) {
        if (value < 1024) {
          return {
            value: `${parseFloat(value).toFixed(2)}`,
            unit: `${unit}/s`,
          };
        }
        value /= 1024;
      }
      return {
        value: `${parseFloat(value).toFixed(2)}`,
        unit: "PB/s",
      };
    }
    case "percent-1": {
      return {
        value: `${(parseFloat(value) * 100).toFixed(2)}`,
        unit: "%",
      };
      // `${parseFloat(value) * 100}`;
    }
    case "percent": {
      return {
        value: `${parseFloat(value).toFixed(2)}`,
        unit: "%",
      };
      // ${parseFloat(value)}`;
    }
    case "default": {
      return {
        value: isNaN(value) ? value :Number.isInteger(value) ? value : value.toFixed(2),
        unit: "",
      };
    }
    default: {
      return {
        value: isNaN(value) ? value : Number.isInteger(value) ? value : value.toFixed(2),
        unit: "",
      };
    }
  }
};

const formatUnitValue = (obj: any) => {
  return `${obj.value}${obj.unit}`;
};


const formatDate =(date:any)=>{
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(2);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

  const getLegendPosition = () => {
    const legendPosition = props.data.config?.legends_position;

    switch (legendPosition) {
      case "bottom":
        return "horizontal";
      case "right":
        return "vertical";
      default:
        return "horizontal";
    }
  };

  // Step 1: Get the X-Axis key
  const xAxisKeys = getXAxisKeys();

  // Step 2: Get the Y-Axis key
  const yAxisKeys = getYAxisKeys();

  const zAxisKeys = getZAxisKeys();

  
  const legendPosition = getLegendPosition();

  const legendConfig:any = {
    show: props.data.config?.show_legends,
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
      width: 100,
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
  /**
   * Calculates the width of a given text.
   * Useful to calculate nameGap for the left axis
   *
   * @param {string} text - The text to calculate the width of.
   * @return {number} The width of the text in pixels.
   */
  const calculateWidthText = (text: string): number => {
    if (!text) return 0;

    const span = document.createElement('span');
    document.body.appendChild(span);

    span.style.font = 'sans-serif';
    span.style.fontSize = '12px';
    span.style.height = 'auto';
    span.style.width = 'auto';
    span.style.top = '0px';
    span.style.position = 'absolute';
    span.style.whiteSpace = 'no-wrap';
    span.innerHTML = text;

    const width = Math.ceil(span.clientWidth);
    span.remove();
    return width;
};

  // const data = getAxisDataFromKey(yAxisKeys[0]);      
  // get the largest label from the data from array of string with reduce
  const largestLabel =(data:any)=> data.reduce((largest: any, label: any) => {
    return label?.toString().length > largest?.toString().length ? label : largest;
  }, '');

  // const largestLabel = 
  // const nameGap = calculateWidthText(largestLabel) + 8
  // console.log('namegap data:', data, largestLabel, nameGap);

  let option:any = {
    backgroundColor: "transparent",
    legend: legendConfig,
    grid: {
      containLabel: true,
      left: "30",
      right: legendConfig.orient === "vertical" && props.data.config?.show_legends ? 200 : "20",
      top: "15",
      bottom: "30",
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
        label:{
          show:true,
          formatter: function (params:any) {
            let lineBreaks="";
            if(props.data.type==="h-bar" || props.data.type==="h-stacked"){
              if(params.axisDimension=="x") return formatUnitValue(getUnitValue(params.value));
              
              //we does not required any linebreaks for h-stacked because we only use one x axis
              if(props.data.type==="h-stacked")return params.value.toString();              
              for(let i=0;i<(xAxisKeys.length-params.axisIndex-1);i++){
                lineBreaks+=" \n \n";              
              }
              params.value =params.value.toString();
              return `${lineBreaks}  ${params.value}`;
            }
            if(params.axisDimension=="y") return formatUnitValue(getUnitValue(params.value));
            for(let i=0;i<(xAxisKeys.length-params.axisIndex-1);i++){
              lineBreaks+=" \n \n";              
            }
            params.value = params.value.toString();
            return `${lineBreaks}  ${params.value}`;
        }
        }
      },
      formatter: function (name: any) {
        if (name.length == 0) return "";

        let hoverText = name.map((it:any)=>{
          return `${it.marker} ${it.seriesName} : ${formatUnitValue(getUnitValue(it.value))}`;
        });
        return `${name[0].name} <br/> ${hoverText.join("<br/>")}`;
      },
    },
    xAxis:xAxisKeys?.map((key: any,index:number) => {
      const data = getAxisDataFromKey(key);      

      //unique value index array 
      const arr:any = [];
      for(let i=0;i<data.length;i++){
        if(i==0||data[i]!=data[i-1])arr.push(i)
      }      

        return {
          type: "category",
          position: props.data.type == "h-bar" ? "left" : "bottom",
          name: index==0 ? props.data.queries[0]?.fields?.x[index]?.label : "",
          nameLocation: "middle",
          nameGap: 13 * (xAxisKeys.length - index + 1),
          nameTextStyle: {
            fontWeight: "bold",
            fontSize: 14,
          },
          axisLabel: {
             interval: index == xAxisKeys.length-1  ? "auto" : function(i:any){
              return arr.includes(i);
            },
            overflow: index == xAxisKeys.length-1  ? "none" :"truncate",
            width:100,
            margin: 18 * (xAxisKeys.length - index -1) + 5
          },
          splitLine: {
            show: false,
          },
          axisTick:{
            show: xAxisKeys.length == 1 ? false : true,
            align:"left",
            alignWithLabel: false,
            length: 20 * (xAxisKeys.length - index),
            interval:function(i:any){
              return arr.includes(i);
            }
          },
          data: data,
        };
      }).flat(),
    yAxis: {
      type: "value",
      name:
        props.data.queries[0]?.fields?.y?.length == 1
          ? props.data.queries[0]?.fields?.y[0]?.label
          : "",
      nameLocation: "middle",
      nameGap: calculateWidthText(props.data.type == "h-bar" || props.data.type == "h-stacked" ? largestLabel(getAxisDataFromKey(yAxisKeys[0])): formatUnitValue(getUnitValue(largestLabel(getAxisDataFromKey(yAxisKeys[0])))))+8,
      nameTextStyle: {
        fontWeight: "bold",
        fontSize: 14,
      },
      axisLabel: {
        formatter: function (value: any) {
            return formatUnitValue(getUnitValue(value));
        }
    },
      splitLine: {
        show: false,
      },
      axisLine: {
        show: true,
      }
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
    series: [],
  };

  switch (props.data.type) {
    case "bar":
    case "line":
    case "area": {
      option.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          name: props.data?.queries[0]?.fields?.y.find(
            (it: any) => it.alias == key
          )?.label,
          ...getPropsByChartTypeForTraces(),
          data: getAxisDataFromKey(key),
        };
        return seriesObj;
      });
      break;
    }
    case "scatter":
    {
      option.tooltip.formatter = function (name: any) {
        //reduce to each name
        const hoverText = name.reduce((text:any,it:any)=>{
          return text+=`<br/> ${it.marker} ${it.seriesName} : ${formatUnitValue(getUnitValue(it.value[1]))}`;
        },"");
        //x axis name + hovertext
        return `${name[0].name} ${hoverText}`;
      }
      option.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          name: props.data?.queries[0]?.fields?.y.find(
            (it: any) => it.alias == key
          )?.label,
          ...getPropsByChartTypeForTraces(),
          data:getAxisDataFromKey(key).map((it:any,i:number)=>{return [option.xAxis[0].data[i],it]}),
        };
        return seriesObj;
      });
      break;
    }
    case "h-bar": {
      //generate trace based on the y axis keys
      option.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          name: props.data?.queries[0]?.fields?.y.find(
            (it: any) => it.alias == key
          )?.label,
          ...getPropsByChartTypeForTraces(),
          data:getAxisDataFromKey(key)
        };
        return seriesObj;
      });
      //swap x and y axis
      const temp = option.xAxis;
      option.xAxis = option.yAxis;
      option.yAxis=temp;
      
      option.yAxis.map((it:any)=>{
        it.nameGap = calculateWidthText(largestLabel(it.data))+8;
      })
      option.xAxis.name= props.data.queries[0]?.fields?.y?.length >= 1
        ? props.data.queries[0]?.fields?.y[0]?.label
        : "",
      option.xAxis.nameGap = 20;
      break;
    }
    case "pie": {
      option.tooltip={
        trigger: 'item',
        formatter: function (name: any) {          
          return `${name.marker} ${name.name} : <b>${formatUnitValue(getUnitValue(name.value))}</b>`;
        }
      }
      //generate trace based on the y axis keys
      option.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          ...getPropsByChartTypeForTraces(),
          data: getAxisDataFromKey(key).map((it:any, i:number) => {
            return { value: it, name: option.xAxis[0].data[i] };
          }),
          label: {
            show: true,
            formatter: "{d}%", // {b} represents name, {c} represents value {d} represents percent
            position: "inside", // You can adjust the position of the labels
            fontSize: 10
          },
        };
        return seriesObj;
      });
      option.xAxis=[];
      option.yAxis=[];
      break;
    }
    case "donut": {
    option.tooltip = {
      trigger: "item",
      formatter: function (name: any) {
        return `${name.marker} ${name.name} : <b>${formatUnitValue(getUnitValue(name.value))}<b/>`;
      }
    };
      //generate trace based on the y axis keys
      option.series = yAxisKeys?.map((key: any) => {
        const seriesObj = {
          ...getPropsByChartTypeForTraces(),
          data: getAxisDataFromKey(key).map((it: any, i:number) => {
            return { value: it, name: option.xAxis[0].data[i] };
          }),
          label: {
            show: true,
            formatter: "{d}%", // {b} represents name, {c} represents value {d} represents percent
            position: "inside", // You can adjust the position of the labels
            fontSize: 10,
          },
        };
        return seriesObj;
      });
      option.xAxis=[];
      option.yAxis=[];
      break;
    }
    case "area-stacked": {
      option.xAxis[0].data = Array.from(new Set(getAxisDataFromKey(xAxisKeys[0])));
      option.xAxis = option.xAxis.slice(0,1);
      option.tooltip.axisPointer.label= {
        show:true,
        formatter: function (params:any) {
          if(params.axisDimension=="y") return formatUnitValue(getUnitValue(params.value));
          return params.value.toString();
        }
      };
      option.xAxis[0].axisLabel={};
      option.xAxis[0].axisTick={};
      option.xAxis[0].nameGap=20;
      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      const key1 = xAxisKeys[1]
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue =  [...new Set( searchQueryData.data.map((obj: any) => obj[key1]))].filter((it)=> it);
                  
      // create a trace based on second xAxis's unique values
      option.series = stackedXAxisUniqueValue?.map((key: any) => {
      const seriesObj = {
        name: key,
        ...getPropsByChartTypeForTraces(),
        data: Array.from(new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))).map((it: any) => (searchQueryData.data.find((it2:any)=>it2[xAxisKeys[0]] == it && it2[key1] == key))?.[yAxisKeys[0]] || 0),
      };
      return seriesObj
    })
    break;
    }
    case "stacked": {
      option.xAxis[0].data=Array.from(new Set(getAxisDataFromKey(xAxisKeys[0])));
      option.xAxis = option.xAxis.slice(0,1);
      option.tooltip.axisPointer.label= {
        show:true,
        formatter: function (params:any) {
          if(params.axisDimension=="y") return formatUnitValue(getUnitValue(params.value));
          return params.value.toString();
        }
      };
      option.xAxis[0].axisLabel.margin=5;
      option.xAxis[0].axisLabel={};
      option.xAxis[0].axisTick={};
      option.xAxis[0].nameGap=20;


      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      const key1 = xAxisKeys[1];
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue = [
        ...new Set(searchQueryData.data.map((obj: any) => obj[key1])),
      ].filter((it) => it);

      option.series = stackedXAxisUniqueValue?.map((key: any) => {
        const seriesObj = {
          name: key,
          ...getPropsByChartTypeForTraces(),    
          data:  Array.from(new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))).map((it: any) => (searchQueryData.data.find((it2:any)=>it2[xAxisKeys[0]] == it && it2[key1] == key))?.[yAxisKeys[0]] || 0)
        };
        return seriesObj;
      });
      break;
    }
    case "heatmap": {
      // get first x axis key
      const key0 = xAxisKeys[0];
      // get the unique value of the first xAxis's key
      const xAxisZerothPositionUniqueValue = [
        ...new Set(searchQueryData.data.map((obj: any) => obj[key0])),
      ].filter((it) => it);

      // get second x axis key
      const key1 = yAxisKeys[0];
      // get the unique value of the second xAxis's key
      const xAxisFirstPositionUniqueValue = [
        ...new Set(searchQueryData.data.map((obj: any) => obj[key1])),
      ].filter((it) => it);

      const yAxisKey0 = zAxisKeys[0];
      const Zvalues: any = xAxisFirstPositionUniqueValue.map((first: any) => {
        return xAxisZerothPositionUniqueValue.map((zero: any) => {
          return (
            searchQueryData.data.find(
              (it: any) => it[key0] == zero && it[key1] == first
            )?.[yAxisKey0] || "-"
          );
        });
      });
      console.log("Zvalues=", xAxisZerothPositionUniqueValue,xAxisFirstPositionUniqueValue,Zvalues);
      option.visualMap= {
        min: 0,
        max: Zvalues.reduce((a: any, b: any) => Math.max(a, b.reduce((c: any, d: any) => Math.max(c, +d||0), 0)), 0),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
      },
      option.series= [{
            ...getPropsByChartTypeForTraces(),
            name: props.data?.queries[0]?.fields?.y[0].label,
          data: Zvalues.map((it:any,index:any)=>{
            return xAxisZerothPositionUniqueValue.map((i:any,j:number)=>{
              return [j,index,it[j]]
            })
          }).flat()
        }]
        // option.yAxis.data=xAxisFirstPositionUniqueValue;
        option.tooltip= {
          position: 'top',
        },
        option.tooltip.axisPointer={
          type: 'cross'
        }
        option.xAxis= {
          type: 'category',
          data: xAxisZerothPositionUniqueValue,
          splitArea: {
            show: true
          }
        },
        option.yAxis= {
          type: 'category',
          data: xAxisFirstPositionUniqueValue,
          splitArea: {
            show: true
          }
        }
        option.legend.show=false;
          // option.xAxis=option.xAxis[0];
          // option.yAxis.type="category"
      
      // const trace = {
      //   x: xAxisZerothPositionUniqueValue,
      //   y: xAxisFirstPositionUniqueValue,
      //   z: Zvalues,
      //   ...getPropsByChartTypeForTraces(),
      //   hoverongaps: false,
      // };
      // console.log("trace:", trace);

      // traces.push(trace);
      // console.log("multiple:- traces", traces);
      break;
    }
    case "h-stacked": {
      option.xAxis[0].data=Array.from(new Set(getAxisDataFromKey(xAxisKeys[0])));
      option.xAxis = option.xAxis.slice(0,1);

      // stacked with xAxis's second value
      // allow 2 xAxis and 1 yAxis value for stack chart
      // get second x axis key
      const key1 = xAxisKeys[1];
      // get the unique value of the second xAxis's key
      const stackedXAxisUniqueValue = [
        ...new Set(searchQueryData.data.map((obj: any) => obj[key1])),
      ].filter((it) => it);

      option.series = stackedXAxisUniqueValue?.map((key: any) => {
        const seriesObj = {
          name: key,
          ...getPropsByChartTypeForTraces(),    
          data:  Array.from(new Set(searchQueryData.data.map((it: any) => it[xAxisKeys[0]]))).map((it: any) => (searchQueryData.data.find((it2:any)=>it2[xAxisKeys[0]] == it && it2[key1] == key))?.[yAxisKeys[0]] || 0)
        };
        return seriesObj;
      });

      const temp = option.xAxis;
      option.xAxis = option.yAxis;
      option.yAxis = temp;
      option.yAxis.map((it:any)=>{
        it.nameGap = calculateWidthText(largestLabel(it.data))+8;
      })
      option.xAxis.nameGap = 20;
      break;
    }
    case "metric": {
      const key1 = yAxisKeys[0];
      const yAxisValue = getAxisDataFromKey(key1);      
      const unitValue = getUnitValue(yAxisValue.length > 0 ? yAxisValue[0]:0);
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
        option.series=[{
          ...getPropsByChartTypeForTraces(),
          renderItem: function(params: any) {            
            return {
              type: 'text',
              style: {
                text: parseFloat(unitValue.value).toFixed(2) + unitValue.unit,
                fontSize: Math.min((params.coordSys.cx / 2),90),    //coordSys is relative. so that we can use it to calculate the dynamic size
                fontWeight: 500,
                align: 'center',
                verticalAlign: 'middle',
                x: params.coordSys.cx,
                y: params.coordSys.cy,
                fill:store.state.theme == "dark" ? "#fff" : "#000",
              }
            }
          } 
        }
      ];
      break;
    }
    default: {
      break;
    }
  }


//auto SQL: if x axis has time series
  const field = props.data.queries[0].fields?.x.find((it: any) => it.aggregationFunction == 'histogram' && it.column == store.state.zoConfig.timestamp_column)
    if (field) {
      option.series.map((seriesObj: any) => {
      seriesObj.data=seriesObj.data.map((it: any,index:any) => [option.xAxis[0].data[index],it])
    })
    option.xAxis[0].type="time";
    option.xAxis[0].data=[];
    option.tooltip.formatter=function (name: any) {
      if (name.length == 0) return "";

      const date = new Date(name[0].data[0]);

      let hoverText = name.map((it:any)=>{
        return `${it.marker} ${it.seriesName} : ${formatUnitValue(getUnitValue(it.data[1]))}`;
      });
      return `${formatDate(date)} <br/> ${hoverText.join("<br/>")}`;
    }
    option.tooltip.axisPointer={
      type: 'cross',
      formatter: function (params:any) {
      const date = new Date(params[0].value[0]);
      return formatDate(date).toString();
    }
    }
  }

//custom SQL: check if it is timeseries or not
if((props.data.type != "h-bar") && option.xAxis.length>0 && option.xAxis[0].data.length>0){    
  const sample = option.xAxis[0].data.slice(0, Math.min(20, option.xAxis[0].data.length));
  
    const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
    const isTimeSeries = sample.every((value:any) => {
      return iso8601Pattern.test(value)
    });
    if (isTimeSeries) {
      option.series.map((seriesObj: any) => {
        seriesObj.data=seriesObj.data.map((it: any,index:any) => [(new Date(option.xAxis.data[index])-new Date("1970-01-01T00:00:00")),it])
      });
    option.xAxis[0].type="time";
    option.xAxis[0].data=[];
    option.tooltip.axisPointer={
      type: 'cross',
      formatter: function (params:any) {
        const date = new Date(params[0].value[0]);
        return formatDate(date).toString();
      }
    }
  }
}

console.log("optionss:", option);

  return {
    option,
  };
};
