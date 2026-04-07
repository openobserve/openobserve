// Copyright 2026 OpenObserve Inc.
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

import { formatUnitValue, getUnitValue } from "../../convertDataIntoUnitValue";
import { type SQLContext } from "../shared/types";

/**
 * Applies chart-specific options for:
 *  - line, area, area-stacked, scatter, bar
 *
 * Mutates `ctx.options` in place, exactly as the original switch cases did.
 */
export function applyLineAreaScatterBarChart(ctx: SQLContext): void {
  const {
    options,
    panelSchema,
    store,
    xAxisKeys,
    breakDownKeys,
    dynamicXAxisNameGap,
    hasTimestampField,
    getSeries,
    getAxisDataFromKey,
    updateTrellisConfig,
  } = ctx;

  //if area stacked then continue
  //or if area or line or scatter, then check x axis length
  if (
    panelSchema.type == "area-stacked" ||
    ((panelSchema.type == "line" ||
      panelSchema.type == "area" ||
      panelSchema.type == "scatter" ||
      panelSchema.type == "bar") &&
      panelSchema.queries[0].fields.breakdown?.length)
  ) {
    options.xAxis = options.xAxis.slice(0, 1);
    options.tooltip.axisPointer.label = {
      show: true,
      backgroundColor: store.state.theme === "dark" ? "#333" : "",
      label: {
        fontsize: 12,
        precision: panelSchema.config?.decimals,
      },
      formatter: function (params: any) {
        try {
          if (params?.axisDimension == "y")
            return formatUnitValue(
              getUnitValue(
                params?.value,
                panelSchema.config?.unit,
                panelSchema.config?.unit_custom,
                panelSchema.config?.decimals,
              ),
            );
          return params?.value?.toString();
        } catch (error) {
          return params?.value?.toString() ?? "";
        }
      },
    };
    const xAxisLabelRotation = hasTimestampField
      ? 0
      : panelSchema.config?.axis_label_rotate || 0;
    options.xAxis[0].axisLabel = {
      rotate: xAxisLabelRotation,
    };
    options.xAxis[0].axisTick = {};
    options.xAxis[0].nameGap = dynamicXAxisNameGap;

    // get the unique value of the first xAxis's key
    options.xAxis[0].data = Array.from(
      new Set(getAxisDataFromKey(xAxisKeys[0])),
    );
  } else if (
    panelSchema.type !== "line" &&
    panelSchema.type !== "area" &&
    panelSchema.type !== "bar"
  ) {
    options.tooltip.formatter = function (name: any) {
      try {
        // show tooltip for hovered panel only for other we only need axis so just return empty string
        if (
          ctx.hoveredSeriesState?.value &&
          panelSchema.id &&
          ctx.hoveredSeriesState?.value?.panelId != panelSchema.id
        )
          return "";
        if (name?.length == 0) return "";

        // sort tooltip array based on value
        name?.sort((a: any, b: any) => {
          return (b.value ?? 0) - (a.value ?? 0);
        });

        // if hovered series name is not null then move it to first position
        if (ctx.hoveredSeriesState?.value?.hoveredSeriesName) {
          // get the current series index from name
          const currentSeriesIndex = name?.findIndex(
            (it: any) =>
              it.seriesName == ctx.hoveredSeriesState?.value?.hoveredSeriesName,
          );

          // if hovered series index is not -1 then take it to very first position
          if (currentSeriesIndex != -1) {
            // shift all series to next position and place current series at first position
            const temp = name?.[currentSeriesIndex];
            for (let i = currentSeriesIndex; i > 0; i--) {
              name[i] = name?.[i - 1];
            }
            name[0] = temp;
          }
        }

        const hoverText: string[] = [];
        name?.forEach((it: any) => {
          if (it.data != null) {
            // check if the series is the current series being hovered
            // if have than bold it
            if (
              it?.seriesName == ctx.hoveredSeriesState?.value?.hoveredSeriesName
            )
              hoverText.push(
                `<strong>${it.marker} ${it.seriesName} : ${formatUnitValue(
                  getUnitValue(
                    it.data,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                )} </strong>`,
              );
            // else normal text
            else
              hoverText.push(
                `${it.marker} ${it.seriesName} : ${formatUnitValue(
                  getUnitValue(
                    it.data,
                    panelSchema.config?.unit,
                    panelSchema.config?.unit_custom,
                    panelSchema.config?.decimals,
                  ),
                )}`,
              );
          }
        });
        return `${name?.[0]?.name} <br/> ${hoverText.join("<br/>")}`;
      } catch (error) {
        return "";
      }
    };
  }

  options.series = getSeries(
    panelSchema.type == "line" || panelSchema.type == "area"
      ? { opacity: 0.8 }
      : panelSchema.type == "bar"
        ? { barMinHeight: 1 }
        : {},
  );

  if (
    (panelSchema.type === "line" ||
      panelSchema.type == "area" ||
      panelSchema.type == "scatter" ||
      panelSchema.type == "bar") &&
    panelSchema.config.trellis?.layout &&
    breakDownKeys.length
  )
    updateTrellisConfig();
}
