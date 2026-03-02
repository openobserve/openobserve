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

/**
 * Converts SQL data into a format suitable for rendering a chart.
 *
 * @param {any} panelSchema - the panel schema object
 * @param {any} searchQueryData - the search query data
 * @param {any} store - the store object
 * @return {Object} - the options object for rendering the chart
 */
import { convertSQLChartData } from "./sql";

export const convertMultiSQLData = async (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
) => {
  if (!Array.isArray(searchQueryData) || searchQueryData.length === 0) {
    // this sets a blank object until it loads
    // because of this, it will go to UI and draw something, even 0 or a blank chart
    // this will give a sence of progress to the user
    searchQueryData = [[]];
  }

  // loop on all search query data
  const options: any = [];
  for (let i = 0; i < searchQueryData.length; i++) {
    options.push(
      await convertSQLData(
        panelSchema,
        [searchQueryData[i]],
        store,
        chartPanelRef,
        hoveredSeriesState,
        [resultMetaData.value?.[i]?.[0]],
        { queries: [metadata.queries[i]] },
        chartPanelStyle,
        annotations,
      ),
    );
  }

  const isAnnotationSeries = (series: any) => {
    // check if series name is available
    // if series name is not available then that is anotation series
    if (!series.name) return true;
  };

  // loop on all options
  if (options && options[0] && options[0].options) {
    for (let i = 1; i < options.length; i++) {
      if (options[i] && options[i].options && options[i].options.series) {
        options[0].options.series = [
          ...options[0].options.series,
          ...options[i].options.series.map((it: any) => {
            if (isAnnotationSeries(it)) return it;
            return {
              ...it,
              name: metadata?.queries[i]?.timeRangeGap.periodAsStr
                ? `${it.name} (${metadata?.queries[i]?.timeRangeGap.periodAsStr})`
                : it.name,
            };
          }),
        ];
      }
    }
  }

  return options[0];
};

export const convertSQLData = async (
  panelSchema: any,
  searchQueryData: any,
  store: any,
  chartPanelRef: any,
  hoveredSeriesState: any,
  resultMetaData: any,
  metadata: any,
  chartPanelStyle: any,
  annotations: any,
) => {
  return convertSQLChartData(
    panelSchema,
    searchQueryData,
    store,
    chartPanelRef,
    hoveredSeriesState,
    resultMetaData,
    metadata,
    chartPanelStyle,
    annotations,
  );

};
