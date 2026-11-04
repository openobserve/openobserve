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

import { describe, expect, it } from "vitest";
import {
  normalizeSeriesStyle,
  parseSeriesOverrideEntry,
  resolveSeriesOverride,
  seriesStyleConfigItems,
  toSeriesOverrideEntry,
} from "./seriesOverrides";
import {
  isEmptyAnnotationHolder,
  serializeSeriesOverride,
  toSeriesOverrideDraft,
} from "@/composables/dashboard/useSeriesFormatting";

const STORED = {
  field: { matchBy: "series_regex", value: "^spine" },
  config: [
    { type: "series_color", value: "#ff0000" },
    { type: "line_style", value: "dashed" },
    { type: "line_width", value: 3 },
    { type: "fill_opacity", value: 40 },
    { type: "show_points", value: false },
    { type: "draw_style", value: "bars" },
    { type: "stack_group", value: "fabric" },
    { type: "y_axis", value: "right" },
    { type: "hide_from", value: { legend: true, tooltip: true } },
  ],
};

describe("series style in override_config", () => {
  it("parses every style item and writes it back unchanged", () => {
    const parsed = parseSeriesOverrideEntry(STORED)!;
    expect(parsed.style).toEqual({
      lineStyle: "dashed",
      lineWidth: 3,
      fillOpacity: 40,
      showPoints: false,
      drawStyle: "bars",
      stackGroup: "fabric",
      yAxis: "right",
      hideFrom: { legend: true, tooltip: true },
    });
    expect(toSeriesOverrideEntry(parsed)).toEqual(STORED);
  });

  it("the dialog draft round-trips the stored entry", () => {
    const draft = toSeriesOverrideDraft(STORED);
    expect(draft.style).toMatchObject({
      lineStyle: "dashed",
      lineWidth: "3",
      fillOpacity: "40",
      showPoints: false,
      yAxis: "right",
      hideFrom: { chart: false, legend: true, tooltip: true },
    });
    expect(serializeSeriesOverride(draft)).toEqual(STORED);
  });

  it("an empty draft style writes nothing", () => {
    const draft = toSeriesOverrideDraft({ field: { matchBy: "series", value: "api" }, config: [] });
    expect(serializeSeriesOverride(draft)).toBeNull();
  });

  it("drops malformed and unset values and clamps fill opacity", () => {
    expect(
      normalizeSeriesStyle({
        lineStyle: "wavy",
        lineWidth: -1,
        fillOpacity: 250,
        showPoints: "yes",
        drawStyle: "area",
        stackGroup: "  ",
        yAxis: "top",
        hideFrom: { chart: false, legend: "true" },
      }),
    ).toEqual({ fillOpacity: 100 });
    expect(seriesStyleConfigItems(undefined)).toEqual([]);
  });

  it("merges matching overrides per setting, later winning, and hide flags per target", () => {
    const config = {
      override_config: [
        toSeriesOverrideEntry({
          matchBy: "regex",
          value: "^a",
          style: { lineStyle: "dotted", lineWidth: 2, hideFrom: { legend: true } },
        }),
        toSeriesOverrideEntry({
          matchBy: "name",
          value: "api",
          style: { lineStyle: "dashed", hideFrom: { tooltip: true } },
        }),
      ],
    };
    expect(resolveSeriesOverride(config, "api")?.style).toEqual({
      lineStyle: "dashed",
      lineWidth: 2,
      hideFrom: { legend: true, tooltip: true },
    });
    expect(resolveSeriesOverride(config, "web")).toBeNull();
  });

  it("a name rule beats a regex rule wherever it sits in the list", () => {
    const exact = toSeriesOverrideEntry({
      matchBy: "name",
      value: "api",
      displayName: "API",
      style: { lineStyle: "dashed" },
    });
    const regex = toSeriesOverrideEntry({
      matchBy: "regex",
      value: "^a",
      displayName: "Pattern",
      style: { lineStyle: "dotted", lineWidth: 4 },
    });
    for (const list of [
      [exact, regex],
      [regex, exact],
    ]) {
      const resolved = resolveSeriesOverride({ override_config: list }, "api");
      expect(resolved?.displayName).toBe("API");
      expect(resolved?.style).toEqual({ lineStyle: "dashed", lineWidth: 4 });
    }
  });
});

describe("isEmptyAnnotationHolder", () => {
  it("is true only for the unnamed all-null series that holds no marks", () => {
    const holder = {
      type: "line",
      data: [[1, null]],
      markLine: { data: [] },
      markArea: { data: [] },
    };
    expect(isEmptyAnnotationHolder(holder)).toBe(true);
    expect(isEmptyAnnotationHolder({ ...holder, markLine: { data: [{ xAxis: 1 }] } })).toBe(false);
    expect(isEmptyAnnotationHolder({ ...holder, name: "api" })).toBe(false);
    expect(isEmptyAnnotationHolder({ type: "line", data: [[1, 2]], markLine: { data: [] } })).toBe(
      false,
    );
    expect(isEmptyAnnotationHolder({ type: "line", data: [] })).toBe(false);
  });
});
