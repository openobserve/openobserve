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

// const colorArray = [
//   '#0056b3', '#003e80', '#00294d', '#001326',
//   '#28a745', '#1f8e3e', '#156331', '#0e3f24', '#072717',
//   '#dc3545', '#a52a35', '#751e26', '#4e141a', '#27090d',
//   '#fd7e14', '#d46a11', '#a9560e', '#803f0a', '#551f06',
//   '#ffc107', '#d9a106', '#b28605', '#8b6a04', '#634d03',
//   '#6f42c1', '#57348f', '#412663', '#2a1940', '#160c20',
//   '#e83e8c', '#b82d66', '#8c1f49', '#631433', '#3f0a1d'
// ];

// [
//   "#99cadd",
//   "#a9bdd5",
//   "#d6a9bc",
//   "#c691a4",
//   "#b87c94",
//   "#ffcb20",
//   "#ff3b3b",
//   "#ff8d0c",
//   "#42a6ff",
//   "#ffb3ba",
//   "#ffdfba",
//   "#ffffba",
//   "#baffc9",
//   "#bae1ff",
//   "#a8e6cf",
//   "#dcedc1",
//   "#ffd3b6",
//   "#ffaaa5",
//   "#ff8b94",
//   "#ffbf00",
//   "#ffcf40",
//   "#ffdc73",
//   "#b88c8c",
//   "#ddadad",
//   "#d6c7c7",
//   "#9fb9bf",
//   "#aec8ce",
// ];

// [
//   "#E24D42", // Red
//   "#1F78C1", // Blue
//   "#BA43A9", // Purple
//   "#705DA0", // Violet
//   "#466803", // Green
//   "#508642", // Dark Green
//   "#447EBC", // Dark Blue
//   "#C15C17", // Brown
//   "#890F02", // Dark Red
//   "#757575", // Grey
//   "#70DBED", // Light Blue
//   "#6ED0E0", // Turquoise
//   "#B9D7D9", // Light Grey
//   "#D683CE", // Light Purple
//   "#E5AC0E", // Orange
//   "#AEA2E0", // Lavender
//   "#5195CE", // Bright Blue
//   "#D9BF77", // Beige
//   "#FADE2A", // Yellow
//   "#2F575E", // Dark Turquoise
//   "#99440A", // Dark Brown
//   "#58140C", // Maroon
//   "#052B51", // Navy
//   "#511749", // Dark Violet
//   "#3F2B5B", // Dark Indigo
//   "#E0F9D7", // Light Green
//   "#FCEACA", // Light Yellow
//   "#CFFAFF", // Sky Blue
//   "#F9E2D2", // Light Pink
//   "#FCE2DE", // Pink
//   "#BADFF4", // Light Bright Blue
//   "#F9D9F9", // Light Lavender
//   "#DEDAF7"  // Pale Lavender
// ]

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

export const colorArrayByValue = [
  "#0ac670",
  "#08b968",
  "#08aa60",
  "#079f59",
  "#069a55",
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

// const scaleValue = (value: any, min: any, max: any) => {
//   return ((value - min) * 100) / (max - min);
// };

// const scaleValue = (value: any, min: any, max: any) => {
//   return ((value - min) * 50) / (max - min);
// };

// const scaleValue = (value: any, min: any, max: any) => {
//   return ((value - min) * 20) / (max - min) - 10;
// };

// const shadeColor = (color: any, value: any, min: any, max: any) => {
//   const percent: any = scaleValue(value, min, max);
//   let R: any = parseInt(color.substring(1, 3), 16);
//   let G: any = parseInt(color.substring(3, 5), 16);
//   let B: any = parseInt(color.substring(5, 7), 16);

//   R = parseInt(((R * (100 + percent)) / 255).toString());
//   G = parseInt(((G * (100 + percent)) / 255).toString());
//   B = parseInt(((B * (100 + percent)) / 255).toString());

//   const RR = R.toString(16).length == 1 ? "0" + R.toString(16) : R.toString(16);
//   const GG = G.toString(16).length == 1 ? "0" + G.toString(16) : G.toString(16);
//   const BB = B.toString(16).length == 1 ? "0" + B.toString(16) : B.toString(16);

//   return "#" + RR + GG + BB;
// };

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

const getMinMaxValue = (searchQueryData: any) => {
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
  return {
    min,
    max,
  };
};

const getSeriesValueFromArray = (panelSchema: any, values: any) => {
  // if color is based on value then need to find seriesmin or seriesmax or last value
  let seriesvalue = values[values.length - 1][1];
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

const colorBasedOnValue = (colors: any, min: any, max: any, value: any) => {
  let range = max - min;
  let step = range / colors.length;
  let index = Math.min(Math.floor((value - min) / step), colors.length - 1);
  return colors[index];
};

// function getColorFn(value: any, min: any, max: any, colors: any) {
//   // Ensure the value is between min and max
//   if (value < min) value = min;
//   if (value > max) value = max;

//   // Convert colors from hex to RGB
//   colors = colors.map((color: any) => {
//       let r = parseInt(color.slice(1, 3), 16);
//       let g = parseInt(color.slice(3, 5), 16);
//       let b = parseInt(color.slice(5, 7), 16);
//       return { r, g, b };
//   });

//   // Assign each color a maximum value
//   let step = (max - min) / (colors.length - 1);
//   colors = colors.map((color: any, i: any) => ({ ...color, max: min + step * i }));

//   // Find which colors to interpolate between
//   let color1, color2;
//   for (let i = 0; i < colors.length; i++) {
//       if (value <= colors[i].max) {
//           color1 = colors[i - 1];
//           color2 = colors[i];
//           break;
//       }
//   }

//   // Interpolate between the two colors
//   let ratio = (value - color1.max) / (color2.max - color1.max);
//   let r = Math.round(color1.r + ratio * (color2.r - color1.r));
//   let g = Math.round(color1.g + ratio * (color2.g - color1.g));
//   let b = Math.round(color1.b + ratio * (color2.b - color1.b));

//   // Return the color as a CSS string
//   return `rgb(${r}, ${g}, ${b})`;
// }

// function interpolateColor(color1: any, color2: any, factor: any) {
//   let result = color1.slice();
//   for (let i = 0; i < 3; i++) {
//       result[i] = Math.round(result[i] + factor * (color2[i] - color1[i]));
//   }
//   return result;
// };

function rgbToHsl(r, g, b) {
  r /= 255, g /= 255, b /= 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
      h = s = 0; // achromatic
  } else {
      let diff = max - min;
      s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
      switch (max) {
          case r: h = (g - b) / diff + (g < b ? 6 : 0); break;
          case g: h = (b - r) / diff + 2; break;
          case b: h = (r - g) / diff + 4; break;
      }
      h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
      r = g = b = l; // achromatic
  } else {
      let hue2rgb = function hue2rgb(p, q, t) {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
      };
      let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      let p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function lightenColor(color, percent) {
  // Parse the color string to r, g, b
  let [r, g, b] = color.match(/\d+/g).map(Number);
  // Convert to HSL
  let [h, s, l] = rgbToHsl(r, g, b);
  // Adjust the lightness
  l += ((0.7 - l) - (0.3 * (percent / 100)));
  // Convert back to RGB
  [r, g, b] = hslToRgb(h, s, l);
  // Return the color as a string
  return `rgb(${r}, ${g}, ${b})`;
}

function getColorPalette(colors) {
  return function(value, min, max) {
      const index = Math.floor(((value - min) / (max - min)) * colors.length);
      const baseColor = colors[Math.min(index, colors.length - 1)];
      const lightness = (1 - ((value - min) / (max - min))) * 100;
      return lightenColor(baseColor, lightness);
  };
}
// function getColorForPercentage(value: any, min: any, max: any, colors: any) {
//   let ratio = (colors.length - 1) / 100;
//   // let index = Math.floor(percentage * ratio);
//   let range = max - min;
//   let step = range / colors.length;
//   let index = Math.min(Math.floor((value - min) / step), colors.length - 2);
//   let percentage = ((value - min) * 100) / (max-min);
//   let factor = (percentage * ratio) - index;

  
//   console.log(percentage, index, factor, colors[index], colors[index + 1]);
  
//   let color1 = colors[index];
//   let color2 = colors[index + 1];
  
//   let result = interpolateColor(color1, color2, factor);

//   return "#" + result.map((x: any) => x.toString(16).padStart(2, '0')).join('');
// }

// let colors = [[0, 128, 0], [255, 255, 0], [255, 0, 0]];  // green, yellow, red in RGB
// console.log(getColorForPercentage(colors, 36));  // Output: "#b8ff00"


export const getColor = (
  panelSchema: any,
  searchQueryData: any,
  seriesName: any,
  valuesArr?: any
) => {
  // switch case based on panelSchema.color type
  switch (panelSchema?.config?.color?.mode) {
    case "fixed": {
      return panelSchema?.config?.color?.fixedColor ?? "#5b8ff9";
    }
    case "shades": {
      // getMinMaxValue
      const { min, max } = getMinMaxValue(searchQueryData);
      // based on selected color pass different shades of same color
      return shadeColor(
        panelSchema?.config?.color?.fixedColor ?? "#5b8ff9",
        getSeriesValueFromArray(panelSchema, valuesArr) ?? 50,
        min ?? 0,
        max ?? 100
      );
    }

    case "palette-classic": {
      // return color using colorArrayBySeries
      // NOTE: value will be series name
      return nameToColor(seriesName, colorArrayBySeries);
    }

    case "green-yellow-red": {
      const { min, max } = getMinMaxValue(searchQueryData);

      const value = getSeriesValueFromArray(panelSchema, valuesArr);
      // based on selected color and value pass different shades of same color
      // return shadeColor(
      //   colorBasedOnValue(["#42f566", '#c3cc41', "#f5424b"], min, max, value ?? 50),
      //   value ?? 50,
      //   min ?? 0,
      //   max ?? 100
      // );

      // return  getColorFn(value ?? 50, min ?? 0, max ?? 100, ["#42f566", '#c3cc41', "#f5424b"]);
      // return  getColorForPercentage(value ?? 50, min ?? 0, max ?? 100, [[0, 128, 0], [255, 255, 0], [255, 0, 0]]);
      const colorArrayBySeriesConst = getColorPalette(["rgb(0, 128, 0)", "rgb(255, 255, 0)", "rgb(255, 0, 0)"]);
      return  colorArrayBySeriesConst(value ?? 50, min ?? 0, max ?? 100);
    }

    case "red-yellow-green": {
      const { min, max } = getMinMaxValue(searchQueryData);

      const value = getSeriesValueFromArray(panelSchema, valuesArr);
      // based on selected color and value pass different shades of same color
      // return shadeColor(
      //   colorBasedOnValue(["#42f566", '#c3cc41', "#f5424b"], min, max, value ?? 50),
      //   value ?? 50,
      //   min ?? 0,
      //   max ?? 100
      // );

      // return  getColorFn(value ?? 50, min ?? 0, max ?? 100, ["#42f566", '#c3cc41', "#f5424b"]);
      // return  getColorForPercentage(value ?? 50, min ?? 0, max ?? 100, [[0, 128, 0], [255, 255, 0], [255, 0, 0]]);
      const colorArrayBySeriesConst = getColorPalette(["rgb(255, 0, 0)", "rgb(255, 255, 0)","rgb(0, 128, 0)"]);
      return  colorArrayBySeriesConst(value ?? 50, min ?? 0, max ?? 100);
    }

    // case "scheme":

    // case "opacity":

    default: {
      // return color using colorArrayBySeries
      return nameToColor(seriesName, colorArrayBySeries);
    }
  }
};
