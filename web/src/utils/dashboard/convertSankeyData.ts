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

/**
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */

export const convertSankeyData = (panelSchema: any, searchQueryData: any) => {
  if (
    !Array.isArray(searchQueryData) ||
    searchQueryData.length === 0 ||
    !searchQueryData[0] ||
    !panelSchema.queries[0].fields.source ||
    !panelSchema.queries[0].fields.target ||
    !panelSchema.queries[0].fields.value
  ) {
    return { options: null };
  }

  const nodes: Set<string> = new Set();
  const links: any[] = [];

  searchQueryData[0].forEach((item: any) => {
    const source = item[panelSchema.queries[0].fields.source.alias];
    const target = item[panelSchema.queries[0].fields.target.alias];
    const value = item[panelSchema.queries[0].fields.value.alias];

    console.log("Item:", item);
    console.log("Source:", source);
    console.log("Target:", target);
    console.log("Value:", value);

    if (source && target && value) {
      nodes.add(source);
      nodes.add(target);

      links.push({
        source: source,
        target: target,
        value: value,
        lineStyle: {
          curveness: 0.5,
        },
      });
    }
  });

  const options = {
    tooltip: {},
    series: {
      type: "sankey",
      layout: "none",
      data: [...nodes].map((node: string) => ({ name: node })),
      links: links,
      emphasis: {
        focus: "adjacency",
      },
    },
  };
  console.log("Options:", options);

  return { options };
};
