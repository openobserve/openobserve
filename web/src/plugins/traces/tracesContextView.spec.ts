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
import type { TranslateFn } from "@/types/i18n";
import {
  contextViewOn,
  contextViewStripText,
  rowAnchorUs,
  type TracesContextView,
} from "./tracesContextView";

// The strip key lands in en-US.json with the picker's i18n merge, so the copy is checked by key here.
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key) as unknown as TranslateFn;
const ANCHOR_US = Date.UTC(2026, 10, 12, 15, 43, 49, 948) * 1000;
const VIEW: TracesContextView = {
  typedQuery: "service_name = 'api'",
  anchorUs: ANCHOR_US,
  seconds: 300,
  previous: { type: "relative", startTime: 1, endTime: 2, relativeTimePeriod: "15m" },
};

describe("tracesContextView", () => {
  it("is on while the typed query is the one the view was opened with", () => {
    expect(contextViewOn(VIEW, "service_name = 'api'")).toBe(true);
    expect(contextViewOn(VIEW, "  service_name = 'api' ")).toBe(true);
    expect(contextViewOn(VIEW, "service_name = 'web'")).toBe(false);
    expect(contextViewOn(null, "service_name = 'api'")).toBe(false);
  });

  it("anchors a trace row on its start and a span row on its nanosecond start", () => {
    expect(rowAnchorUs({ trace_start_time: ANCHOR_US }, "traces")).toBe(ANCHOR_US);
    const spanAnchor = rowAnchorUs({ start_time: ANCHOR_US * 1000 + 500 }, "spans")!;
    expect(Math.abs(spanAnchor - ANCHOR_US)).toBeLessThanOrEqual(1);
    expect(rowAnchorUs({}, "traces")).toBeNull();
  });

  it("names the window and the row's instant in the display zone", () => {
    expect(contextViewStripText(VIEW, "UTC", t)).toBe(
      'timeRangeHost.contextStripTraces:{"window":"dateTime.aroundMinutes:{\\"n\\":5}","instant":"15:43:49.948"}',
    );
  });
});
