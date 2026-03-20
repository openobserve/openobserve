// Copyright 2023 OpenObserve Inc.
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

import { getDataValue } from "./aliasUtils";

/**
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */

import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";

export const convertSankeyData = (panelSchema: any, searchQueryData: any) => {
  // Validate that at least one query has all required fields
  const hasValidQuery = panelSchema.queries?.some(
    (query: any) =>
      query.fields?.source && query.fields?.target && query.fields?.value,
  );

  if (
    !Array.isArray(searchQueryData) ||
    searchQueryData.length === 0 ||
    !searchQueryData[0] ||
    !hasValidQuery
  ) {
    return { options: null };
  }

  const nodes: Set<string> = new Set();
  const links: any[] = [];

  const filteredData = panelSchema.queries.map((query: any, index: any) => {
    if (!searchQueryData[index] || !query.fields?.source) return [];
    return searchQueryData[index].filter((item: any) => {
      return (
        getDataValue(item, query.fields.source.alias) != null &&
        getDataValue(item, query.fields.target.alias) != null &&
        getDataValue(item, query.fields.value.alias) != null
      );
    });
  });

  filteredData.forEach((queryData: any, queryIndex: number) => {
    const query = panelSchema.queries[queryIndex];
    if (!query?.fields?.source) return;

    queryData.forEach((item: any) => {
      const source = getDataValue(
        item,
        query.fields.source.alias,
      );
      const target = getDataValue(
        item,
        query.fields.target.alias,
      );
      let value = getDataValue(item, query.fields.value.alias);

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
  });

  const options = {
    tooltip: {
      trigger: "item",
      formatter: function (params: any) {
        let value = params.value;

        if (getUnitValue && formatUnitValue) {
          value = formatUnitValue(
            getUnitValue(
              value,
              panelSchema.config?.unit,
              panelSchema.config?.unit_custom,
              panelSchema.config?.decimals
            )
          );
        }

        return `${params.name} : ${value}`;
      },
    },
    backgroundColor: "transparent",
    series: [
      {
        type: "sankey",
        layout: "none",
        data: [...nodes].map((node: string) => ({ name: node })),
        links: links,
        emphasis: {
          focus: "adjacency",
        },
      },
    ],
  };

  return { options };
};
