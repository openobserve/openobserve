// Copyright 2023 Zinc Labs Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

export const colorArrayBySeries = [
  "#5470c6",
  "#91cc75",
  "#fac858",
  "#ee6666",
  "#73c0de",
  "#3ba272",
  "#fc8452",
  "#9a60b4",
  "#dc1e1e",
  "#9086e9",
  "#27e162",
  "#e08de6",
  "#de6086",
  "rgba(161,225,200,0.48)",
  "#ec8ceb",
  "#99e9f1",
  "#eec59c",
];

export const getIndexForName = (name: any, colorArray: any) => {
  let index = 0;
  for (let i = 0; i < 15; i++) {
    const charCode = name.charCodeAt(i) || 0;
    index += charCode * (i + 1);
  }
  return index % colorArray.length;
};

const nameToColor = (name: any, colorArray: any) => {
  const index = getIndexForName(name, colorArray);
  return colorArray[index];
};

function shadeColor(color: any, value: any, min: any, max: any) {
  let percent = (value - min) / (max - min);
  let num = parseInt(color.replace("#", ""), 16),
    amt = Math.round(1.55 * percent * 100),
    R = (num >> 16) + amt,
    B = ((num >> 8) & 0x00ff) + amt,
    G = (num & 0x0000ff) + amt;

  let newColor = (
    0x1000000 +
    (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
    (B < 255 ? (B < 1 ? 0 : B) : 255) * 0x100 +
    (G < 255 ? (G < 1 ? 0 : G) : 255)
  )
    .toString(16)
    .slice(1);
  return "#" + newColor;
}

export const getMetricMinMaxValue = (searchQueryData: any) => {
  // need min and max value for color
  let min = Infinity;
  let max = -Infinity;
  searchQueryData.forEach((metric: any) => {
    if (metric.result && Array.isArray(metric.result)) {
      metric?.result?.forEach((valuesArr: any) => {
        if (valuesArr.values && Array.isArray(valuesArr.values)) {
          valuesArr.values.forEach((val: any) => {
            // val[1] should not NaN
            if (!isNaN(val[1])) {
              min = Math.min(min, val[1]);
              max = Math.max(max, val[1]);
            }
          });
        }
      });
    }
  });
  return [min, max];
};

export const getSQLMinMaxValue = (yaxiskeys: any, searchQueryData: any) => {
  // need min and max value for color
  let min = Infinity;
  let max = -Infinity;
  
  searchQueryData[0]?.forEach((data: any) => {
    yaxiskeys?.forEach((key: any) => {
      if (data[key] !== undefined && !isNaN(data[key]) && data[key] !== null) {
        min = Math.min(min, data[key]);
        max = Math.max(max, data[key]);
      }
    });
  });

  return [min, max];
};

const getSeriesValueFromArray = (panelSchema: any, values: any) => {
  // if color is based on value then need to find seriesmin or seriesmax or last value
  let seriesvalue = values?.length > 0 ? values[values.length - 1][1] : 50;
  if (["shades", "continuous"].includes(panelSchema?.config?.color?.mode)) {
    if (panelSchema?.config?.color?.seriesBy == "min") {
      values.forEach((value: any) => {
        // value[1] should not NaN
        if (!isNaN(value[1])) {
          seriesvalue = Math.min(value[1], seriesvalue);
        }
      });
    } else if (panelSchema?.config?.color?.seriesBy == "max") {
      values.forEach((value: any) => {
        // value[1] should not NaN
        if (!isNaN(value[1])) {
          seriesvalue = Math.max(value[1], seriesvalue);
        }
      });
    }
  }

  return seriesvalue;
};

class Scale {
  colors: any;
  domain: any;

  constructor(colors: any) {
    this.colors = colors;
    this.domain = [0, 1];
  }

  setDomain(domain: any) {
    this.domain = domain;
  }

  getColor(value: any) {
    let t = (value - this.domain[0]) / (this.domain[1] - this.domain[0]);
    let index = Math.floor(t * (this.colors.length - 1));
    let color1 = this.colors[index];
    let color2 = this.colors[index + 1] || color1; // use the same color if color2 is not defined
    let tLocal = color2 === color1 ? 0 : t * (this.colors.length - 1) - index; // calculate local interpolation parameter
    let interpolated = color1.interpolate(color2, tLocal);

    return interpolated;
  }
}

class Color {
  r: any;
  g: any;
  b: any;

  constructor(hex: any) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
      throw new Error(`Invalid color: ${hex}`);
    }
    this.r = parseInt(result[1], 16);
    this.g = parseInt(result[2], 16);
    this.b = parseInt(result[3], 16);
  }

  interpolate(other: any, t: any) {
    let r = this.r + t * (other.r - this.r);
    let g = this.g + t * (other.g - this.g);
    let b = this.b + t * (other.b - this.b);

    return new Color(
      this.rgbToHex(Math.round(r), Math.round(g), Math.round(b))
    );
  }

  rgbToHex(r: any, g: any, b: any) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  toCssString() {
    return `rgb(${Math.round(this.r)}, ${Math.round(this.g)}, ${Math.round(
      this.b
    )})`;
  }
}

export const getColor = (
  panelSchema: any,
  seriesName: any,
  valuesArr?: any,
  chartMin?: any,
  chartMax?: any
) => {
  // switch case based on panelSchema.color type
  switch (panelSchema?.config?.color?.mode) {
    case "fixed": {
      return panelSchema?.config?.color?.fixedColor
        ? panelSchema?.config?.color?.fixedColor[0] ?? "#53ca53"
        : "#53ca53";
    }
    case "shades": {
      console.log(
        "shades",
        valuesArr,
        chartMin,
        chartMax,
        panelSchema?.config?.color
      );

      // based on selected color pass different shades of same color
      return shadeColor(
        panelSchema?.config?.color?.fixedColor
          ? panelSchema?.config?.color?.fixedColor[0] ?? "#53ca53"
          : "#53ca53",
        getSeriesValueFromArray(panelSchema, valuesArr) ?? 50,
        chartMin ?? 0,
        chartMax ?? 100
      );
    }

    case "palette-classic": {
      // return color using colorArrayBySeries
      // NOTE: here value will be series name
      return nameToColor(seriesName, colorArrayBySeries);
    }

    case "green-yellow-red": {
      
      const value = getSeriesValueFromArray(panelSchema, valuesArr);
      console.log("green-yellow-red",valuesArr, value);

      let scale = new Scale(
        panelSchema?.config?.color?.fixedColor?.map(
          (color: any) => new Color(color)
        )
      );

      scale.setDomain([chartMin ?? 0, chartMax ?? 100]);

      return scale.getColor(value).toCssString();
    }

    case "red-yellow-green": {
      const value = getSeriesValueFromArray(panelSchema, valuesArr);

      let scale = new Scale(
        panelSchema?.config?.color?.fixedColor?.map(
          (color: any) => new Color(color)
        )
      );

      scale.setDomain([chartMin ?? 0, chartMax ?? 100]);

      return scale.getColor(value).toCssString();
    }

    // case "scheme":

    // case "opacity":

    default: {
      // return color using colorArrayBySeries
      return nameToColor(seriesName, colorArrayBySeries);
    }
  }
};
