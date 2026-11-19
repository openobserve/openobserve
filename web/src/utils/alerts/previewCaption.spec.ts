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
import i18n from "@/locales";
import type { TranslateFn } from "@/types/i18n";
import { previewCaption, type PreviewCaptionInput } from "./previewCaption";

const t = i18n.global.t as unknown as TranslateFn;
const avg = { function: "avg", having: { column: "value" } };

describe("previewCaption", () => {
  it.each<[string, PreviewCaptionInput, string | null]>([
    [
      "a metric with no group, as one combined line",
      { tab: "custom", streamType: "metrics", measured: true, aggregation: avg },
      "Plotted: avg of value across every series",
    ],
    [
      "a metric per group",
      {
        tab: "custom",
        streamType: "metrics",
        measured: true,
        aggregation: { ...avg, group_by: ["k8s_pod_name"] },
      },
      "Plotted: avg of value, one line per k8s_pod_name",
    ],
    [
      "a PromQL query, which names its own rate",
      { tab: "promql", query: "rate(x_total[10m])", measured: false },
      "Plotted: rate(x_total[10m])",
    ],
    [
      "a SQL alert per group, by the column it judges",
      { tab: "sql", measured: false, sqlColumn: "p95_ms", aggregation: { group_by: ["svc"] } },
      "Plotted: p95_ms, one line per svc",
    ],
    ["a SQL row count, which plots rows", { tab: "sql", measured: false }, null],
  ])("names %s", (_case, input, expected) => {
    const caption = previewCaption(input, t);
    expect(caption === null ? null : String(caption)).toBe(expected);
  });
});
