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
}

export const nameToColor = (name: any, colorArray: any) => {
  const index = getIndexForName(name, colorArray);
  return colorArray[index];
}

export const getColor = (panelSchema: any) => {
  // switch case based on panelSchema.color type
  switch (panelSchema?.color?.mode) {
    case "fixed":

    case "shades":

    case "palette-classic":

    case "palette-classic-by-name":

    case "continuous-greens":

    case "scheme":

    case "opacity":
        
    default:
      break;
  }
}