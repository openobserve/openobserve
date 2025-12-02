export interface ChartType {
  label: string;
  value: string;
  asset: string;
}

export interface ChartCategory {
  chartLabel: string;
  type: ChartType[];
}

export const chartTypesData: { data: ChartCategory[] } = {
  data: [
    {
      chartLabel: "Line",
      type: [
        {
          label: "Basic Line Chart",
          value: "line-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/line-simple.webp"
        },
        {
          label: "Smoothed Line Chart",
          value: "line-smooth",
          asset: "https://echarts.apache.org/examples/data/thumb/line-smooth.webp"
        },
        {
          label: "Stacked Line Chart",
          value: "line-stack",
          asset: "https://echarts.apache.org/examples/data/thumb/line-stack.webp"
        },
        {
          label: "Stacked Area Chart",
          value: "area-stack",
          asset: "https://echarts.apache.org/examples/data/thumb/area-stack.webp"
        },
        {
          label: "Large scale area chart",
          value: "area-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/area-simple.webp"
        },
        {
          label: "Area Pieces",
          value: "area-pieces",
          asset: "https://echarts.apache.org/examples/data/thumb/area-pieces.webp"
        },
        {
          label: "Bump Chart (Ranking)",
          value: "bump-chart",
          asset: "https://echarts.apache.org/examples/data/thumb/bump-chart.webp"
        },
        {
          label: "Data Transform Filter",
          value: "data-transform-filter",
          asset: "https://echarts.apache.org/examples/data/thumb/data-transform-filter.webp"
        },
        {
          label: "Dynamic Data + Time Axis",
          value: "dynamic-data2",
          asset: "https://echarts.apache.org/examples/data/thumb/dynamic-data2.webp"
        },
        {
          label: "Function Plot",
          value: "line-function",
          asset: "https://echarts.apache.org/examples/data/thumb/line-function.webp"
        },
        {
          label: "Line Race",
          value: "line-race",
          asset: "https://echarts.apache.org/examples/data/thumb/line-race.webp"
        },
        {
          label: "Rainfall vs Evaporation",
          value: "grid-multiple",
          asset: "https://echarts.apache.org/examples/data/thumb/grid-multiple.webp"
        },
        {
          label: "Line Chart in Cartesian Coordinate System",
          value: "line-in-cartesian-coordinate-system",
          asset: "https://echarts.apache.org/examples/data/thumb/line-in-cartesian-coordinate-system.webp"
        },
        {
          label: "Log Axis",
          value: "line-log",
          asset: "https://echarts.apache.org/examples/data/thumb/line-log.webp"
        },
        {
          label: "Line Easing Visualizing",
          value: "line-easing",
          asset: "https://echarts.apache.org/examples/data/thumb/line-easing.webp"
        },
        {
          label: "Fisheye Lens on Line Chart",
          value: "line-fisheye-lens",
          asset: "https://echarts.apache.org/examples/data/thumb/line-fisheye-lens.webp"
        },
        {
          label: "Two Value-Axes in Polar",
          value: "line-polar",
          asset: "https://echarts.apache.org/examples/data/thumb/line-polar.webp"
        },
        {
          label: "Two Value-Axes in Polar",
          value: "line-polar2",
          asset: "https://echarts.apache.org/examples/data/thumb/line-polar2.webp"
        },
        {
          label: "Step Line",
          value: "line-step",
          asset: "https://echarts.apache.org/examples/data/thumb/line-step.webp"
        },
        {
          label: "Custom Graphic Component",
          value: "line-graphic",
          asset: "https://echarts.apache.org/examples/data/thumb/line-graphic.webp"
        },
        {
          label: "Click to Add Points",
          value: "line-pen",
          asset: "https://echarts.apache.org/examples/data/thumb/line-pen.webp"
        },
        {
          label: "Mini Line Charts (Sparkline) in Matrix",
          value: "matrix-sparkline",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-sparkline.webp"
        },
        {
          label: "Confidence Band",
          value: "confidence-band",
          asset: "https://echarts.apache.org/examples/data/thumb/confidence-band.webp"
        },
        {
          label: "Basic area chart",
          value: "area-basic",
          asset: "https://echarts.apache.org/examples/data/thumb/area-basic.webp"
        },
        {
          label: "Gradient Stacked Area Chart",
          value: "area-stack-gradient",
          asset: "https://echarts.apache.org/examples/data/thumb/area-stack-gradient.webp"
        },
        {
          label: "Temperature Change in the Coming Week",
          value: "line-marker",
          asset: "https://echarts.apache.org/examples/data/thumb/line-marker.webp"
        },
        {
          label: "Tooltip and DataZoom on Mobile",
          value: "line-tooltip-touch",
          asset: "https://echarts.apache.org/examples/data/thumb/line-tooltip-touch.webp"
        },
        {
          label: "Draggable Points",
          value: "line-draggable",
          asset: "https://echarts.apache.org/examples/data/thumb/line-draggable.webp"
        }
      ]
    },
    {
      chartLabel: "Bar",
      type: [
        {
          label: "Basic Bar",
          value: "bar-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-simple.webp"
        },
        {
          label: "Axis Align with Tick",
          value: "bar-tick-align",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-tick-align.webp"
        },
        {
          label: "Sort Data in Bar Chart",
          value: "bar-sort",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-sort.webp"
        },
        {
          label: "World Population",
          value: "bar-y-category",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-y-category.webp"
        },
        {
          label: "Waterfall Chart",
          value: "bar-waterfall",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-waterfall.webp"
        },
        {
          label: "Waterfall Chart",
          value: "bar-waterfall2",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-waterfall2.webp"
        },
        {
          label: "Tangential Polar Bar Label Position",
          value: "bar-polar-label-tangential",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-polar-label-tangential.webp"
        },
        {
          label: "Radial Polar Bar Label Position",
          value: "bar-polar-label-radial",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-polar-label-radial.webp"
        },
        {
          label: "Clickable Column Chart with Gradient",
          value: "bar-gradient",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-gradient.webp"
        },
        {
          label: "Bar Label Rotation",
          value: "bar-label-rotation",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-label-rotation.webp"
        },
        {
          label: "Stacked Column Chart",
          value: "bar-stack",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-stack.webp"
        },
        {
          label: "Stacked Horizontal Bar",
          value: "bar-y-category-stack",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-y-category-stack.webp"
        },
        {
          label: "Bar Chart with Axis Breaks",
          value: "bar-breaks-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-breaks-simple.webp"
        },
        {
          label: "Brush Select on Column Chart",
          value: "bar-brush",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-brush.webp"
        },
        {
          label: "Bar Chart with Negative Value",
          value: "bar-negative",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-negative.webp"
        },
        {
          label: "Bar Chart with Negative Value",
          value: "bar-negative2",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-negative2.webp"
        },
        {
          label: "Rainfall and Evaporation",
          value: "bar1",
          asset: "https://echarts.apache.org/examples/data/thumb/bar1.webp"
        },
        {
          label: "Animation Delay",
          value: "bar-animation-delay",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-animation-delay.webp"
        },
        {
          label: "Bar Chart Drilldown Animation",
          value: "bar-drilldown",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-drilldown.webp"
        },
        {
          label: "Large Scale Bar Chart",
          value: "bar-large",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-large.webp"
        },
        {
          label: "Bar Race",
          value: "bar-race",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-race.webp"
        },
        {
          label: "Bar Race",
          value: "bar-race-country",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-race-country.webp"
        },
        {
          label: "Weather Statistics",
          value: "bar-rich-text",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-rich-text.webp"
        },
        {
          label: "Dynamic Data",
          value: "dynamic-data",
          asset: "https://echarts.apache.org/examples/data/thumb/dynamic-data.webp"
        },
        {
          label: "Watermark - ECharts Download",
          value: "watermark",
          asset: "https://echarts.apache.org/examples/data/thumb/watermark.webp"
        },
        {
          label: "Bar Chart on Polar",
          value: "bar-polar-real-estate",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-polar-real-estate.webp"
        },
        {
          label: "Stacked Bar Chart on Polar",
          value: "bar-polar-stack",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-polar-stack.webp"
        },
        {
          label: "Stacked Radial Bar",
          value: "bar-polar-stack-radial",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-polar-stack-radial.webp"
        },
        {
          label: "Polar endAngle",
          value: "polar-endAngle",
          asset: "https://echarts.apache.org/examples/data/thumb/polar-endAngle.webp"
        },
        {
          label: "Rounded Bar on Polar",
          value: "polar-roundCap",
          asset: "https://echarts.apache.org/examples/data/thumb/polar-roundCap.webp"
        },
        {
          label: "Bar Chart Multi-level Drilldown Animation",
          value: "bar-multi-drilldown",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-multi-drilldown.webp"
        },
        {
          label: "Bar with Background",
          value: "bar-background",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-background.webp"
        },
        {
          label: "Set Style of Single Bar",
          value: "bar-data-color",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-data-color.webp"
        },
        {
          label: "Histogram with Custom Series",
          value: "bar-histogram",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-histogram.webp"
        }
      ]
    },
    {
      chartLabel: "Pie",
      type: [
        {
          label: "Referer of a Website",
          value: "pie-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-simple.webp"
        },
        {
          label: "Doughnut Chart",
          value: "pie-doughnut",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-doughnut.webp"
        },
        {
          label: "Half Doughnut Chart",
          value: "pie-half-donut",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-half-donut.webp"
        },
        {
          label: "Pie with padAngle",
          value: "pie-padAngle",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-padAngle.webp"
        },
        {
          label: "Doughnut Chart with Rounded Corner",
          value: "pie-borderRadius",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-borderRadius.webp"
        },
        {
          label: "Nightingale Chart",
          value: "pie-roseType",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-roseType.webp"
        },
        {
          label: "Nightingale Chart",
          value: "pie-roseType-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-roseType-simple.webp"
        },
        {
          label: "Texture on Pie Chart",
          value: "pie-pattern",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-pattern.webp"
        },
        {
          label: "Pie Label Align",
          value: "pie-alignTo",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-alignTo.webp"
        },
        {
          label: "Label Line Adjust",
          value: "pie-labelLine-adjust",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-labelLine-adjust.webp"
        },
        {
          label: "Pie with Scrollable Legend",
          value: "pie-legend",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-legend.webp"
        },
        {
          label: "Pie Charts on GEO Map",
          value: "map-iceland-pie",
          asset: "https://echarts.apache.org/examples/data/thumb/map-iceland-pie.webp"
        },
        {
          label: "Nested Pies",
          value: "pie-nest",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-nest.webp"
        },
        {
          label: "Calendar Pie",
          value: "calendar-pie",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-pie.webp"
        },
        {
          label: "Transition of Parliament and Pie Chart",
          value: "pie-parliament-transition",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-parliament-transition.webp"
        },
        {
          label: "Customized Pie",
          value: "pie-custom",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-custom.webp"
        },
        {
          label: "Pie Special Label",
          value: "pie-rich-text",
          asset: "https://echarts.apache.org/examples/data/thumb/pie-rich-text.webp"
        }
      ]
    },
    {
      chartLabel: "Scatter",
      type: [
        {
          label: "Basic Scatter Chart",
          value: "scatter-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-simple.webp"
        },
        {
          label: "Anscomb's quartet",
          value: "scatter-anscombe-quartet",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-anscombe-quartet.webp"
        },
        {
          label: "Clustering Process",
          value: "scatter-clustering",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-clustering.webp"
        },
        {
          label: "Clustering Process",
          value: "scatter-clustering-process",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-clustering-process.webp"
        },
        {
          label: "Exponential Regression",
          value: "scatter-exponential-regression",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-exponential-regression.webp"
        },
        {
          label: "Punch Card of Github",
          value: "scatter-punchCard",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-punchCard.webp"
        },
        {
          label: "Scatter on Single Axis",
          value: "scatter-single-axis",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-single-axis.webp"
        },
        {
          label: "Distribution of Height and Weight",
          value: "scatter-weight",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-weight.webp"
        },
        {
          label: "Scatter Aqi Color",
          value: "scatter-aqi-color",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-aqi-color.webp"
        },
        {
          label: "Scatter Nutrients",
          value: "scatter-nutrients",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-nutrients.webp"
        },
        {
          label: "Bubble Chart",
          value: "bubble-gradient",
          asset: "https://echarts.apache.org/examples/data/thumb/bubble-gradient.webp"
        },
        {
          label: "Scatter Matrix",
          value: "scatter-matrix",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-matrix.webp"
        },
        {
          label: "World Population (2011)",
          value: "scatter-world-population",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-world-population.webp"
        },
        {
          label: "Geo Choropleth and Scatter",
          value: "geo-choropleth-scatter",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-choropleth-scatter.webp"
        },
        {
          label: "Calendar Charts",
          value: "calendar-charts",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-charts.webp"
        },
        {
          label: "Linear Regression",
          value: "scatter-linear-regression",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-linear-regression.webp"
        },
        {
          label: "Polynomial Regression",
          value: "scatter-polynomial-regression",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-polynomial-regression.webp"
        },
        {
          label: "Effect Scatter Chart",
          value: "scatter-effect",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-effect.webp"
        },
        {
          label: "Scatter with Jittering",
          value: "scatter-jitter",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-jitter.webp"
        },
        {
          label: "Aggregate Scatter to Bar",
          value: "scatter-aggregate-bar",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-aggregate-bar.webp"
        },
        {
          label: "Align Label on the Top",
          value: "scatter-label-align-right",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-label-align-right.webp"
        }
      ]
    },
    {
      chartLabel: "Map",
      type: [
        {
          label: "Geo Choropleth and Scatter",
          value: "geo-choropleth-scatter",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-choropleth-scatter.webp"
        },
        {
          label: "Pie Charts on GEO Map",
          value: "map-iceland-pie",
          asset: "https://echarts.apache.org/examples/data/thumb/map-iceland-pie.webp"
        },
        {
          label: "Mini Bars and Geo in Matrix",
          value: "matrix-mini-bar-geo",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-mini-bar-geo.webp"
        },
        {
          label: "USA Choropleth Map with Projection",
          value: "map-usa-projection",
          asset: "https://echarts.apache.org/examples/data/thumb/map-usa-projection.webp"
        },
        {
          label: "GEO SVG Traffic",
          value: "geo-svg-traffic",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-svg-traffic.webp"
        },
        {
          label: "Hexagonal Binning",
          value: "custom-hexbin",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-hexbin.webp"
        },
        {
          label: "Air Quality - Baidu Map",
          value: "effectScatter-bmap",
          asset: "https://echarts.apache.org/examples/data/thumb/effectScatter-bmap.webp"
        },
        {
          label: "A Hiking Trail in Hangzhou - Baidu Map",
          value: "lines-bmap",
          asset: "https://echarts.apache.org/examples/data/thumb/lines-bmap.webp"
        },
        {
          label: "Geo Graph",
          value: "geo-graph",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-graph.webp"
        },
        {
          label: "GEO Beef Cuts",
          value: "geo-beef-cuts",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-beef-cuts.webp"
        },
        {
          label: "Organ Data with SVG",
          value: "geo-organ",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-organ.webp"
        },
        {
          label: "Flight Seatmap with SVG",
          value: "geo-seatmap-flight",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-seatmap-flight.webp"
        },
        {
          label: "GEO SVG Lines",
          value: "geo-svg-lines",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-svg-lines.webp"
        },
        {
          label: "GEO SVG Map",
          value: "geo-svg-map",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-svg-map.webp"
        },
        {
          label: "GEO SVG Scatter",
          value: "geo-svg-scatter-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-svg-scatter-simple.webp"
        },
        {
          label: "GEO SVG with Customized Effect",
          value: "geo-svg-custom-effect",
          asset: "https://echarts.apache.org/examples/data/thumb/geo-svg-custom-effect.webp"
        },
        {
          label: "Morphing between Map and Bar",
          value: "map-bar-morph",
          asset: "https://echarts.apache.org/examples/data/thumb/map-bar-morph.webp"
        },
        {
          label: "Population Density of HongKong (2011)",
          value: "map-HK",
          asset: "https://echarts.apache.org/examples/data/thumb/map-HK.webp"
        },
        {
          label: "USA Population Estimates (2012)",
          value: "map-usa",
          asset: "https://echarts.apache.org/examples/data/thumb/map-usa.webp"
        }
      ]
    },
    {
      chartLabel: "Candlestick",
      type: [
        {
          label: "Basic Candlestick",
          value: "candlestick-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/candlestick-simple.webp"
        },
        {
          label: "OHLC Chart",
          value: "custom-ohlc",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-ohlc.webp"
        },
        {
          label: "Large Scale Candlestick",
          value: "candlestick-large",
          asset: "https://echarts.apache.org/examples/data/thumb/candlestick-large.webp"
        },
        {
          label: "Axis Pointer Link and Touch",
          value: "candlestick-touch",
          asset: "https://echarts.apache.org/examples/data/thumb/candlestick-touch.webp"
        },
        {
          label: "ShangHai Index, 2015",
          value: "candlestick-sh-2015",
          asset: "https://echarts.apache.org/examples/data/thumb/candlestick-sh-2015.webp"
        },
        {
          label: "ShangHai Index",
          value: "candlestick-sh",
          asset: "https://echarts.apache.org/examples/data/thumb/candlestick-sh.webp"
        },
        {
          label: "Intraday Chart with Breaks",
          value: "intraday-breaks-1",
          asset: "https://echarts.apache.org/examples/data/thumb/intraday-breaks-1.webp"
        },
        {
          label: "Intraday Chart with Breaks (II)",
          value: "intraday-breaks-2",
          asset: "https://echarts.apache.org/examples/data/thumb/intraday-breaks-2.webp"
        },
        {
          label: "Candlestick Brush",
          value: "candlestick-brush",
          asset: "https://echarts.apache.org/examples/data/thumb/candlestick-brush.webp"
        }
      ]
    },
    {
      chartLabel: "Radar",
      type: [
        {
          label: "Basic Radar Chart",
          value: "radar",
          asset: "https://echarts.apache.org/examples/data/thumb/radar.webp"
        },
        {
          label: "AQI - Radar Chart",
          value: "radar-aqi",
          asset: "https://echarts.apache.org/examples/data/thumb/radar-aqi.webp"
        },
        {
          label: "Proportion of Browsers",
          value: "radar2",
          asset: "https://echarts.apache.org/examples/data/thumb/radar2.webp"
        },
        {
          label: "Customized Radar Chart",
          value: "radar-custom",
          asset: "https://echarts.apache.org/examples/data/thumb/radar-custom.webp"
        },
        {
          label: "Multiple Radar",
          value: "radar-multiple",
          asset: "https://echarts.apache.org/examples/data/thumb/radar-multiple.webp"
        }
      ]
    },
    {
      chartLabel: "Boxplot",
      type: [
        {
          label: "Data Transform Simple Aggregate",
          value: "data-transform-aggregate",
          asset: "https://echarts.apache.org/examples/data/thumb/data-transform-aggregate.webp"
        },
        {
          label: "Boxplot Light Velocity",
          value: "boxplot-light-velocity",
          asset: "https://echarts.apache.org/examples/data/thumb/boxplot-light-velocity.webp"
        },
        {
          label: "Boxplot Light Velocity2",
          value: "boxplot-light-velocity2",
          asset: "https://echarts.apache.org/examples/data/thumb/boxplot-light-velocity2.webp"
        },
        {
          label: "Multiple Categories",
          value: "boxplot-multi",
          asset: "https://echarts.apache.org/examples/data/thumb/boxplot-multi.webp"
        }
      ]
    },
    {
      chartLabel: "Heatmap",
      type: [
        {
          label: "Heatmap on Cartesian",
          value: "heatmap-cartesian",
          asset: "https://echarts.apache.org/examples/data/thumb/heatmap-cartesian.webp"
        },
        {
          label: "Heatmap - 20K data",
          value: "heatmap-large",
          asset: "https://echarts.apache.org/examples/data/thumb/heatmap-large.webp"
        },
        {
          label: "Heatmap - Discrete Mapping of Color",
          value: "heatmap-large-piecewise",
          asset: "https://echarts.apache.org/examples/data/thumb/heatmap-large-piecewise.webp"
        },
        {
          label: "Calendar Heatmap",
          value: "calendar-heatmap",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-heatmap.webp"
        },
        {
          label: "Calendar Heatmap Vertical",
          value: "calendar-vertical",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-vertical.webp"
        },
        {
          label: "Polar Heatmap",
          value: "custom-polar-heatmap",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-polar-heatmap.webp"
        }
      ]
    },
    {
      chartLabel: "Graph",
      type: [
        {
          label: "Force Layout",
          value: "graph-force2",
          asset: "https://echarts.apache.org/examples/data/thumb/graph-force2.webp"
        },
        {
          label: "Graph on Cartesian",
          value: "graph-grid",
          asset: "https://echarts.apache.org/examples/data/thumb/graph-grid.webp"
        },
        {
          label: "Simple Graph",
          value: "graph-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/graph-simple.webp"
        },
        {
          label: "Les Miserables",
          value: "graph",
          asset: "https://echarts.apache.org/examples/data/thumb/graph.webp"
        },
        {
          label: "Les Miserables",
          value: "graph-circular-layout",
          asset: "https://echarts.apache.org/examples/data/thumb/graph-circular-layout.webp"
        },
        {
          label: "Graph Life Expectancy",
          value: "graph-life-expectancy",
          asset: "https://echarts.apache.org/examples/data/thumb/graph-life-expectancy.webp"
        },
        {
          label: "Graph Webkit Dep",
          value: "graph-webkit-dep",
          asset: "https://echarts.apache.org/examples/data/thumb/graph-webkit-dep.webp"
        },
        {
          label: "NPM Dependencies",
          value: "graph-npm",
          asset: "https://echarts.apache.org/examples/data/thumb/graph-npm.webp"
        },
        {
          label: "Calendar Graph",
          value: "calendar-graph",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-graph.webp"
        },
        {
          label: "Force Layout",
          value: "graph-force",
          asset: "https://echarts.apache.org/examples/data/thumb/graph-force.webp"
        },
        {
          label: "Hide Overlapped Label",
          value: "graph-label-overlap",
          asset: "https://echarts.apache.org/examples/data/thumb/graph-label-overlap.webp"
        },
        {
          label: "Graph Dynamic",
          value: "graph-force-dynamic",
          asset: "https://echarts.apache.org/examples/data/thumb/graph-force-dynamic.webp"
        }
      ]
    },
    {
      chartLabel: "Lines",
      type: [
        {
          label: "A Hiking Trail in Hangzhou - Baidu Map",
          value: "lines-bmap",
          asset: "https://echarts.apache.org/examples/data/thumb/lines-bmap.webp"
        },
        {
          label: "Use lines to draw 1 million ny streets",
          value: "lines-ny",
          asset: "https://echarts.apache.org/examples/data/thumb/lines-ny.webp"
        }
      ]
    },
    {
      chartLabel: "Tree",
      type: [
        {
          label: "From Left to Right Tree",
          value: "tree-basic",
          asset: "https://echarts.apache.org/examples/data/thumb/tree-basic.webp"
        },
        {
          label: "Tree with Legend",
          value: "tree-legend",
          asset: "https://echarts.apache.org/examples/data/thumb/tree-legend.webp"
        },
        {
          label: "Radial Tree",
          value: "tree-radial",
          asset: "https://echarts.apache.org/examples/data/thumb/tree-radial.webp"
        },
        {
          label: "From Top to Bottom Tree",
          value: "tree-vertical",
          asset: "https://echarts.apache.org/examples/data/thumb/tree-vertical.webp"
        },
        {
          label: "From Bottom to Top Tree",
          value: "tree-orient-bottom-top",
          asset: "https://echarts.apache.org/examples/data/thumb/tree-orient-bottom-top.webp"
        },
        {
          label: "From Right to Left Tree",
          value: "tree-orient-right-left",
          asset: "https://echarts.apache.org/examples/data/thumb/tree-orient-right-left.webp"
        },
        {
          label: "Tree with Polyline Edge",
          value: "tree-polyline",
          asset: "https://echarts.apache.org/examples/data/thumb/tree-polyline.webp"
        }
      ]
    },
    {
      chartLabel: "Treemap",
      type: [
        {
          label: "Disk Usage",
          value: "treemap-disk",
          asset: "https://echarts.apache.org/examples/data/thumb/treemap-disk.webp"
        },
        {
          label: "Treemap Drilldown",
          value: "treemap-drill-down",
          asset: "https://echarts.apache.org/examples/data/thumb/treemap-drill-down.webp"
        },
        {
          label: "ECharts Option Query",
          value: "treemap-drill-down",
          asset: "https://echarts.apache.org/examples/data/thumb/treemap-drill-down.webp"
        },
        {
          label: "How $3.7 Trillion is Spent",
          value: "treemap-obama",
          asset: "https://echarts.apache.org/examples/data/thumb/treemap-obama.webp"
        },
        {
          label: "Show Parent Labels",
          value: "treemap-show-parent",
          asset: "https://echarts.apache.org/examples/data/thumb/treemap-show-parent.webp"
        },
        {
          label: "Basic Treemap",
          value: "treemap-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/treemap-simple.webp"
        },
        {
          label: "Gradient Mapping",
          value: "treemap-visual",
          asset: "https://echarts.apache.org/examples/data/thumb/treemap-visual.webp"
        },
        {
          label: "Transition between Treemap and Sunburst",
          value: "treemap-sunburst-transition",
          asset: "https://echarts.apache.org/examples/data/thumb/treemap-sunburst-transition.webp"
        }
      ]
    },
    {
      chartLabel: "Sunburst",
      type: [
        {
          label: "Basic Sunburst",
          value: "sunburst-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/sunburst-simple.webp"
        },
        {
          label: "Monochrome Sunburst",
          value: "sunburst-monochrome",
          asset: "https://echarts.apache.org/examples/data/thumb/sunburst-monochrome.webp"
        },
        {
          label: "Sunburst with Rounded Corner",
          value: "sunburst-borderRadius",
          asset: "https://echarts.apache.org/examples/data/thumb/sunburst-borderRadius.webp"
        },
        {
          label: "Sunburst Label Rotate",
          value: "sunburst-label-rotate",
          asset: "https://echarts.apache.org/examples/data/thumb/sunburst-label-rotate.webp"
        },
        {
          label: "Book Records",
          value: "sunburst-book",
          asset: "https://echarts.apache.org/examples/data/thumb/sunburst-book.webp"
        },
        {
          label: "Drink Flavors",
          value: "sunburst-drink",
          asset: "https://echarts.apache.org/examples/data/thumb/sunburst-drink.webp"
        },
        {
          label: "Sunburst VisualMap",
          value: "sunburst-visualMap",
          asset: "https://echarts.apache.org/examples/data/thumb/sunburst-visualMap.webp"
        }
      ]
    },
    {
      chartLabel: "Parallel",
      type: [
        {
          label: "Basic Parallel",
          value: "parallel-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/parallel-simple.webp"
        },
        {
          label: "Parallel Nutrients",
          value: "parallel-nutrients",
          asset: "https://echarts.apache.org/examples/data/thumb/parallel-nutrients.webp"
        },
        {
          label: "Scatter Matrix",
          value: "scatter-matrix",
          asset: "https://echarts.apache.org/examples/data/thumb/scatter-matrix.webp"
        },
        {
          label: "Parallel Aqi",
          value: "parallel-aqi",
          asset: "https://echarts.apache.org/examples/data/thumb/parallel-aqi.webp"
        }
      ]
    },
    {
      chartLabel: "Sankey",
      type: [
        {
          label: "Basic Sankey",
          value: "sankey-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/sankey-simple.webp"
        },
        {
          label: "Sankey Orient Vertical",
          value: "sankey-vertical",
          asset: "https://echarts.apache.org/examples/data/thumb/sankey-vertical.webp"
        },
        {
          label: "Gradient Edge",
          value: "sankey-energy",
          asset: "https://echarts.apache.org/examples/data/thumb/sankey-energy.webp"
        },
        {
          label: "Specify ItemStyle for Each Node in Sankey",
          value: "sankey-itemstyle",
          asset: "https://echarts.apache.org/examples/data/thumb/sankey-itemstyle.webp"
        },
        {
          label: "Sankey with Levels Setting",
          value: "sankey-levels",
          asset: "https://echarts.apache.org/examples/data/thumb/sankey-levels.webp"
        },
        {
          label: "Node Align Left in Sankey",
          value: "sankey-nodeAlign-left",
          asset: "https://echarts.apache.org/examples/data/thumb/sankey-nodeAlign-left.webp"
        },
        {
          label: "Node Align Right in Sankey",
          value: "sankey-nodeAlign-right",
          asset: "https://echarts.apache.org/examples/data/thumb/sankey-nodeAlign-right.webp"
        }
      ]
    },
    {
      chartLabel: "Funnel",
      type: [
        {
          label: "Funnel Chart",
          value: "funnel",
          asset: "https://echarts.apache.org/examples/data/thumb/funnel.webp"
        },
        {
          label: "Funnel Compare",
          value: "funnel-align",
          asset: "https://echarts.apache.org/examples/data/thumb/funnel-align.webp"
        },
        {
          label: "Customized Funnel",
          value: "funnel-customize",
          asset: "https://echarts.apache.org/examples/data/thumb/funnel-customize.webp"
        },
        {
          label: "Multiple Funnels",
          value: "funnel-mutiple",
          asset: "https://echarts.apache.org/examples/data/thumb/funnel-mutiple.webp"
        }
      ]
    },
    {
      chartLabel: "Gauge",
      type: [
        {
          label: "Gauge Basic chart",
          value: "gauge",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge.webp"
        },
        {
          label: "Simple Gauge",
          value: "gauge-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-simple.webp"
        },
        {
          label: "Progress Gauge",
          value: "gauge-progress",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-progress.webp"
        },
        {
          label: "Grade Gauge",
          value: "gauge-grade",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-grade.webp"
        },
        {
          label: "Multi Title Gauge",
          value: "gauge-multi-title",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-multi-title.webp"
        },
        {
          label: "Temperature Gauge chart",
          value: "gauge-temperature",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-temperature.webp"
        },
        {
          label: "Ring Gauge",
          value: "gauge-ring",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-ring.webp"
        },
        {
          label: "Gauge Barometer chart",
          value: "gauge-barometer",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-barometer.webp"
        },
        {
          label: "Gauge Car",
          value: "gauge-car",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-car.webp"
        },
        {
          label: "Clock",
          value: "gauge-clock",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-clock.webp"
        },
        {
          label: "Speed Gauge",
          value: "gauge-speed",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-speed.webp"
        },
        {
          label: "Stage Speed Gauge",
          value: "gauge-stage",
          asset: "https://echarts.apache.org/examples/data/thumb/gauge-stage.webp"
        }
      ]
    },
    {
      chartLabel: "PictorialBar",
      type: [
        {
          label: "Transition between pictorialBar and bar",
          value: "pictorialBar-bar-transition",
          asset: "https://echarts.apache.org/examples/data/thumb/pictorialBar-bar-transition.webp"
        },
        {
          label: "Water Content",
          value: "pictorialBar-body-fill",
          asset: "https://echarts.apache.org/examples/data/thumb/pictorialBar-body-fill.webp"
        },
        {
          label: "Dotted bar",
          value: "pictorialBar-dotted",
          asset: "https://echarts.apache.org/examples/data/thumb/pictorialBar-dotted.webp"
        },
        {
          label: "Expansion of forest",
          value: "pictorialBar-forest",
          asset: "https://echarts.apache.org/examples/data/thumb/pictorialBar-forest.webp"
        },
        {
          label: "Wish List and Mountain Height",
          value: "pictorialBar-hill",
          asset: "https://echarts.apache.org/examples/data/thumb/pictorialBar-hill.webp"
        },
        {
          label: "Spirits",
          value: "pictorialBar-spirit",
          asset: "https://echarts.apache.org/examples/data/thumb/pictorialBar-spirit.webp"
        },
        {
          label: "Vehicles",
          value: "pictorialBar-vehicle",
          asset: "https://echarts.apache.org/examples/data/thumb/pictorialBar-vehicle.webp"
        },
        {
          label: "Velocity of Christmas Reindeers",
          value: "pictorialBar-velocity",
          asset: "https://echarts.apache.org/examples/data/thumb/pictorialBar-velocity.webp"
        }
      ]
    },
    {
      chartLabel: "ThemeRiver",
      type: [
        {
          label: "ThemeRiver",
          value: "themeRiver-basic",
          asset: "https://echarts.apache.org/examples/data/thumb/themeRiver-basic.webp"
        },
        {
          label: "ThemeRiver Lastfm",
          value: "themeRiver-lastfm",
          asset: "https://echarts.apache.org/examples/data/thumb/themeRiver-lastfm.webp"
        }
      ]
    },
    {
      chartLabel: "Calendar",
      type: [
        {
          label: "Simple Calendar",
          value: "calendar-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-simple.webp"
        },
        {
          label: "Horizontal Calendar",
          value: "calendar-horizontal",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-horizontal.webp"
        },
        {
          label: "Calendar Heatmap",
          value: "calendar-heatmap",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-heatmap.webp"
        },
        {
          label: "Calendar Heatmap Vertical",
          value: "calendar-vertical",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-vertical.webp"
        },
        {
          label: "Calendar Graph",
          value: "calendar-graph",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-graph.webp"
        },
        {
          label: "Calendar Lunar",
          value: "calendar-lunar",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-lunar.webp"
        },
        {
          label: "Calendar Pie",
          value: "calendar-pie",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-pie.webp"
        },
        {
          label: "Calendar Charts",
          value: "calendar-charts",
          asset: "https://echarts.apache.org/examples/data/thumb/calendar-charts.webp"
        }
      ]
    },
    {
      chartLabel: "Matrix",
      type: [
        {
          label: "Simple Matrix",
          value: "matrix-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-simple.webp"
        },
        {
          label: "Mini Line Charts (Sparkline) in Matrix",
          value: "matrix-sparkline",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-sparkline.webp"
        },
        {
          label: "Mini Bars and Geo in Matrix",
          value: "matrix-mini-bar-geo",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-mini-bar-geo.webp"
        },
        {
          label: "Periodic Table",
          value: "matrix-periodic-table",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-periodic-table.webp"
        },
        {
          label: "Correlation Matrix (Heatmap)",
          value: "matrix-correlation-heatmap",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-correlation-heatmap.webp"
        },
        {
          label: "Correlation Matrix (Scatter)",
          value: "matrix-correlation-scatter",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-correlation-scatter.webp"
        },
        {
          label: "Covariance Matrix",
          value: "matrix-covariance",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-covariance.webp"
        },
        {
          label: "Graph Chart in Matrix",
          value: "matrix-graph",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-graph.webp"
        },
        {
          label: "Pie Charts in Matrix",
          value: "matrix-pie",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-pie.webp"
        },
        {
          label: "Confusion Matrix",
          value: "matrix-confusion",
          asset: "https://echarts.apache.org/examples/data/thumb/matrix-confusion.webp"
        }
      ]
    },
    {
      chartLabel: "Chord",
      type: [
        {
          label: "Basic Chord",
          value: "chord-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/chord-simple.webp"
        },
        {
          label: "Chord minAngle",
          value: "chord-minAngle",
          asset: "https://echarts.apache.org/examples/data/thumb/chord-minAngle.webp"
        },
        {
          label: "Chord lineStyle.color",
          value: "chord-lineStyle-color",
          asset: "https://echarts.apache.org/examples/data/thumb/chord-lineStyle-color.webp"
        },
        {
          label: "Chord Style",
          value: "chord-style",
          asset: "https://echarts.apache.org/examples/data/thumb/chord-style.webp"
        }
      ]
    },
    {
      chartLabel: "Custom",
      type: [
        {
          label: "Histogram with Custom Series",
          value: "bar-histogram",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-histogram.webp"
        },
        {
          label: "Profit",
          value: "custom-profit",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-profit.webp"
        },
        {
          label: "Custom Bar Trend",
          value: "custom-bar-trend",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-bar-trend.webp"
        },
        {
          label: "Custom Cartesian Polygon",
          value: "custom-cartesian-polygon",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-cartesian-polygon.webp"
        },
        {
          label: "Error Bar on Catesian",
          value: "custom-error-bar",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-error-bar.webp"
        },
        {
          label: "Profile",
          value: "custom-profile",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-profile.webp"
        },
        {
          label: "Cycle Plot",
          value: "cycle-plot",
          asset: "https://echarts.apache.org/examples/data/thumb/cycle-plot.webp"
        },
        {
          label: "Flame graph",
          value: "flame-graph",
          asset: "https://echarts.apache.org/examples/data/thumb/flame-graph.webp"
        },
        {
          label: "Hexagonal Binning",
          value: "custom-hexbin",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-hexbin.webp"
        },
        {
          label: "Circle Packing with d3",
          value: "circle-packing-with-d3",
          asset: "https://echarts.apache.org/examples/data/thumb/circle-packing-with-d3.webp"
        },
        {
          label: "Custom Spiral Race",
          value: "custom-spiral-race",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-spiral-race.webp"
        },
        {
          label: "Wind Barb",
          value: "wind-barb",
          asset: "https://echarts.apache.org/examples/data/thumb/wind-barb.webp"
        },
        {
          label: "OHLC Chart",
          value: "custom-ohlc",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-ohlc.webp"
        },
        {
          label: "Error Scatter on Catesian",
          value: "custom-error-scatter",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-error-scatter.webp"
        },
        {
          label: "Gantt Chart of Airport Flights",
          value: "custom-gantt-flight",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-gantt-flight.webp"
        },
        {
          label: "Polar Heatmap",
          value: "custom-polar-heatmap",
          asset: "https://echarts.apache.org/examples/data/thumb/custom-polar-heatmap.webp"
        }
      ]
    },
    {
      chartLabel: "Dataset",
      type: [
        {
          label: "Sort Data in Bar Chart",
          value: "data-transform-sort-bar",
          asset: "https://echarts.apache.org/examples/data/thumb/data-transform-sort-bar.webp"
        },
        {
          label: "Simple Encode",
          value: "dataset-encode0",
          asset: "https://echarts.apache.org/examples/data/thumb/dataset-encode0.webp"
        },
        {
          label: "Data Transform Filter",
          value: "data-transform-filter",
          asset: "https://echarts.apache.org/examples/data/thumb/data-transform-filter.webp"
        },
        {
          label: "Partition Data to Pies",
          value: "data-transform-multiple-pie",
          asset: "https://echarts.apache.org/examples/data/thumb/data-transform-multiple-pie.webp"
        },
        {
          label: "Default arrangement",
          value: "dataset-default",
          asset: "https://echarts.apache.org/examples/data/thumb/dataset-default.webp"
        },
        {
          label: "Encode and Matrix",
          value: "dataset-encode1",
          asset: "https://echarts.apache.org/examples/data/thumb/dataset-encode1.webp"
        },
        {
          label: "Dataset in Object Array",
          value: "dataset-object-array",
          asset: "https://echarts.apache.org/examples/data/thumb/dataset-object-array.webp"
        }
      ]
    },
    {
      chartLabel: "DataZoom",
      type: [
        {
          label: "Large scale area chart",
          value: "area-simple",
          asset: "https://echarts.apache.org/examples/data/thumb/area-simple.webp"
        },
        {
          label: "Wind Barb",
          value: "wind-barb",
          asset: "https://echarts.apache.org/examples/data/thumb/wind-barb.webp"
        }
      ]
    },
    {
      chartLabel: "Graphic",
      type: [
        {
          label: "Wave Animation",
          value: "graphic-wave-animation",
          asset: "https://echarts.apache.org/examples/data/thumb/graphic-wave-animation.webp"
        },
        {
          label: "Stroke Animation",
          value: "graphic-stroke-animation",
          asset: "https://echarts.apache.org/examples/data/thumb/graphic-stroke-animation.webp"
        },
        {
          label: "Custom Graphic Component",
          value: "line-graphic",
          asset: "https://echarts.apache.org/examples/data/thumb/line-graphic.webp"
        }
      ]
    },
    {
      chartLabel: "Rich Text",
      type: [
        {
          label: "Weather Statistics",
          value: "bar-rich-text",
          asset: "https://echarts.apache.org/examples/data/thumb/bar-rich-text.webp"
        }
      ]
    },
    {
      chartLabel: "3D Globe",
      type: [
        {
          label: "Animating Contour on Globe",
          value: "animating-contour-on-globe",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/animating-contour-on-globe.webp"
        },
        {
          label: "Globe with Atmosphere",
          value: "globe-atmosphere",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/globe-atmosphere.webp"
        },
        {
          label: "Contour Paint",
          value: "globe-contour-paint",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/globe-contour-paint.webp"
        },
        {
          label: "Country Carousel",
          value: "globe-country-carousel",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/globe-country-carousel.webp"
        },
        {
          label: "Globe Displacement",
          value: "globe-displacement",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/globe-displacement.webp"
        },
        {
          label: "ECharts-GL Hello World",
          value: "globe-echarts-gl-hello-world",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/globe-echarts-gl-hello-world.webp"
        },
        {
          label: "Globe Layers",
          value: "globe-layers",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/globe-layers.webp"
        },
        {
          label: "Moon",
          value: "globe-moon",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/globe-moon.webp"
        },
        {
          label: "Globe with ECharts Surface",
          value: "globe-with-echarts-surface",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/globe-with-echarts-surface.webp"
        },
        {
          label: "Iron globe",
          value: "iron-globe",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/iron-globe.webp"
        }
      ]
    },
    {
      chartLabel: "3D Bar",
      type: [
        {
          label: "3D Bar with Dataset",
          value: "bar3d-dataset",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/bar3d-dataset.webp"
        },
        {
          label: "Bar3D - Global Population",
          value: "bar3d-global-population",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/bar3d-global-population.webp"
        },
        {
          label: "Bar3D - Myth",
          value: "bar3d-myth",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/bar3d-myth.webp"
        },
        {
          label: "Noise modified from marpi's demo",
          value: "bar3d-noise-modified-from-marpi-demo",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/bar3d-noise-modified-from-marpi-demo.webp"
        },
        {
          label: "Bar3D - Punch Card",
          value: "bar3d-punch-card",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/bar3d-punch-card.webp"
        },
        {
          label: "Bar3D - Simplex Noise",
          value: "bar3d-simplex-noise",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/bar3d-simplex-noise.webp"
        },
        {
          label: "Voxelize image",
          value: "bar3d-voxelize-image",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/bar3d-voxelize-image.webp"
        },
        {
          label: "Global Population - Bar3D on Globe",
          value: "global-population-bar3d-on-globe",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/global-population-bar3d-on-globe.webp"
        },
        {
          label: "Image to Bar3D",
          value: "image-to-bar3d",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/image-to-bar3d.webp"
        },
        {
          label: "Metal Bar3D",
          value: "metal-bar3d",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/metal-bar3d.webp"
        },
        {
          label: "Stacked Bar3D",
          value: "stacked-bar3d",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/stacked-bar3d.webp"
        },
        {
          label: "Transparent Bar3D",
          value: "transparent-bar3d",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/transparent-bar3d.webp"
        }
      ]
    },
    {
      chartLabel: "3D Scatter",
      type: [
        {
          label: "Scatter3D",
          value: "scatter3d",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/scatter3d.webp"
        },
        {
          label: "3D Scatter with Dataset",
          value: "scatter3D-dataset",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/scatter3D-dataset.webp"
        },
        {
          label: "Scatter3D - Globe Population",
          value: "scatter3d-globe-population",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/scatter3d-globe-population.webp"
        },
        {
          label: "Scatter3D - Orthographic",
          value: "scatter3d-orthographic",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/scatter3d-orthographic.webp"
        },
        {
          label: "3D Scatter with Scatter Matrix",
          value: "scatter3d-scatter",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/scatter3d-scatter.webp"
        },
        {
          label: "Scatter3D - Simplex Noise",
          value: "scatter3d-simplex-noise",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/scatter3d-simplex-noise.webp"
        }
      ]
    },
    {
      chartLabel: "3D Surface",
      type: [
        {
          label: "Image Surface Sushuang",
          value: "image-surface-sushuang",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/image-surface-sushuang.webp"
        },
        {
          label: "Metal Surface",
          value: "metal-surface",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/metal-surface.webp"
        },
        {
          label: "Parametric Surface Rose",
          value: "parametric-surface-rose",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/parametric-surface-rose.webp"
        },
        {
          label: "Simple Surface",
          value: "simple-surface",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/simple-surface.webp"
        },
        {
          label: "Sphere Parametric Surface",
          value: "sphere-parametric-surface",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/sphere-parametric-surface.webp"
        },
        {
          label: "Breather",
          value: "surface-breather",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/surface-breather.webp"
        },
        {
          label: "Golden Rose",
          value: "surface-golden-rose",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/surface-golden-rose.webp"
        },
        {
          label: "Leather Material",
          value: "surface-leather",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/surface-leather.webp"
        },
        {
          label: "Mollusc Shell",
          value: "surface-mollusc-shell",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/surface-mollusc-shell.webp"
        },
        {
          label: "Theme Roses",
          value: "surface-theme-roses",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/surface-theme-roses.webp"
        },
        {
          label: "Surface Wave",
          value: "surface-wave",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/surface-wave.webp"
        }
      ]
    },
    {
      chartLabel: "3D Map",
      type: [
        {
          label: "Buildings",
          value: "map3d-buildings",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/map3d-buildings.webp"
        },
        {
          label: "Wood City",
          value: "map3d-wood-city",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/map3d-wood-city.webp"
        }
      ]
    },
    {
      chartLabel: "3D Lines",
      type: [
        {
          label: "Airline on Globe",
          value: "lines3d-airline-on-globe",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/lines3d-airline-on-globe.webp"
        },
        {
          label: "Flights",
          value: "lines3d-flights",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/lines3d-flights.webp"
        },
        {
          label: "Flights GL",
          value: "lines3d-flights-gl",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/lines3d-flights-gl.webp"
        },
        {
          label: "Flights on Geo3D",
          value: "lines3d-flights-on-geo3d",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/lines3d-flights-on-geo3d.webp"
        }
      ]
    },
    {
      chartLabel: "3D Line",
      type: [
        {
          label: "Orthographic Projection",
          value: "line3d-orthographic",
          asset: "https://echarts.apache.org/examples/data-gl/thumb/line3d-orthographic.webp"
        }
      ]
    },
    {
      chartLabel: "Scatter GL",
      type: [
        {
          label: "10 million Bulk GPS points",
          value: "scatterGL-gps",
          asset: "https://echarts.apache.org/examples/data/thumb/scatterGL-gps.webp"
        }
      ]
    },
    {
      chartLabel: "Lines GL",
      type: [
        {
          label: "Use linesGL to draw 1 million ny streets",
          value: "linesGL-ny",
          asset: "https://echarts.apache.org/examples/data/thumb/linesGL-ny.webp"
        }
      ]
    },
    {
      chartLabel: "Flow GL",
      type: [
        {
          label: "Flow on the cartesian",
          value: "flowGL-noise",
          asset: "https://echarts.apache.org/examples/data/thumb/flowGL-noise.webp"
        }
      ]
    },
    {
      chartLabel: "Graph GL",
      type: [
        {
          label: "GraphGL GPU Layout",
          value: "graphgl-gpu-layout",
          asset: "https://echarts.apache.org/examples/data/thumb/graphgl-gpu-layout.webp"
        },
        {
          label: "GraphGL - Large Internet",
          value: "graphgl-large-internet",
          asset: "https://echarts.apache.org/examples/data/thumb/graphgl-large-internet.webp"
        },
        {
          label: "NPM Dependencies with graphGL",
          value: "graphgl-npm-dep",
          asset: "https://echarts.apache.org/examples/data/thumb/graphgl-npm-dep.webp"
        }
      ]
    },
    {
      chartLabel: "Geo3D",
      type: [
        {
          label: "Geo3D",
          value: "geo3d",
          asset: "https://echarts.apache.org/examples/data/thumb/geo3d.webp"
        },
        {
          label: "Geo3D with Different Height",
          value: "geo3d-with-different-height",
          asset: "https://echarts.apache.org/examples/data/thumb/geo3d-with-different-height.webp"
        }
      ]
    }
  ]
};
