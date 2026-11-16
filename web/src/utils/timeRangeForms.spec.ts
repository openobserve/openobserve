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
import { rollingShortName, triggerLabelForms } from "./timeRangeForms";
import { formatRangeDates } from "./timeRangeLabel";

describe("triggerLabelForms (ui-spec §6, r2)", () => {
  it("steps a live dashboard range from name to short name to dates, never dropping the dates", () => {
    expect(
      triggerLabelForms({
        kind: "live",
        dashboard: true,
        name: "Last 90 days",
        shortName: "90d",
        dates: "Aug 14 – Nov 12, 2026",
      }),
    ).toEqual([
      { name: "Last 90 days", dates: "Aug 14 – Nov 12, 2026" },
      { name: "90d", dates: "Aug 14 – Nov 12, 2026" },
      { name: "", dates: "Aug 14 – Nov 12, 2026" },
    ]);
  });

  it("skips the short name a calendar period does not have", () => {
    expect(
      triggerLabelForms({
        kind: "calendar",
        dashboard: true,
        name: "Previous quarter",
        dates: "Jul 1 – Sep 30, 2026",
      }),
    ).toEqual([
      { name: "Previous quarter", dates: "Jul 1 – Sep 30, 2026" },
      { name: "", dates: "Jul 1 – Sep 30, 2026" },
    ]);
  });

  it("keeps a named fixed period's name, which carries its year, as the last dashboard form", () => {
    expect(
      triggerLabelForms({
        kind: "named",
        dashboard: true,
        name: "Q3 2026",
        dates: "Jul 1 – Sep 30",
      }),
    ).toEqual([
      { name: "Q3 2026", dates: "Jul 1 – Sep 30" },
      { name: "Q3 2026", dates: "" },
    ]);
  });

  it("keeps an explorer's named period with its dates while they fit", () => {
    expect(
      triggerLabelForms({
        kind: "named",
        dashboard: false,
        name: "Q4 2026",
        dates: "Oct 1 – Nov 14",
      }),
    ).toEqual([
      { name: "Q4 2026", dates: "Oct 1 – Nov 14" },
      { name: "Q4 2026", dates: "" },
    ]);
  });

  it("never drops the name of a live explorer range, only shortens it", () => {
    expect(
      triggerLabelForms({
        kind: "live",
        dashboard: false,
        name: "Last 15 minutes",
        shortName: "15m",
      }),
    ).toEqual([
      { name: "Last 15 minutes", dates: "" },
      { name: "15m", dates: "" },
    ]);
  });

  it("steps a fixed explorer range to a zone dot, then to its start and duration", () => {
    expect(
      triggerLabelForms({
        kind: "fixed",
        dashboard: false,
        name: "",
        dates: "Nov 12, 21:08:49 – Nov 13, 02:18:49",
        duration: "5h 10m",
      }),
    ).toEqual([
      { name: "", dates: "Nov 12, 21:08:49 – Nov 13, 02:18:49" },
      { name: "", dates: "Nov 12, 21:08:49 – Nov 13, 02:18:49", zoneDot: true },
      { name: "", dates: "Nov 12, 21:08:49 · 5h 10m", zoneDot: true },
    ]);
  });

  it("keeps a fixed dashboard range's whole dates", () => {
    expect(
      triggerLabelForms({ kind: "fixed", dashboard: true, name: "", dates: "Nov 4 – 6, 2026" }),
    ).toEqual([{ name: "", dates: "Nov 4 – 6, 2026" }]);
  });
});

describe("triggerLabelForms on dashboards [V1]", () => {
  const live = {
    kind: "live" as const,
    dashboard: true,
    name: "Last 6 hours",
    shortName: rollingShortName("6h"),
    dates: formatRangeDates(
      {
        startUs: Date.parse("2026-11-15T15:30:00Z") * 1000,
        endUs: Date.parse("2026-11-15T21:30:00Z") * 1000,
        live: true,
      },
      { timezone: "Asia/Kolkata", surface: "dashboard", nowMs: Date.parse("2026-11-16T00:00:00Z") },
    ),
  };

  it("walks Last 6 hours · … → 6h · … → dates, never dropping the dates", () => {
    expect(triggerLabelForms(live)).toEqual([
      { name: "Last 6 hours", dates: live.dates },
      { name: "6h", dates: live.dates },
      { name: "", dates: live.dates },
    ]);
  });

  it.each(["live", "calendar", "named", "fixed"] as const)(
    "never swaps the %s dashboard zone label for a dot",
    (kind) => {
      const forms = triggerLabelForms({ ...live, kind });
      expect(forms.some((form) => form.zoneDot)).toBe(false);
      if (kind !== "named") expect(forms.every((form) => form.dates === live.dates)).toBe(true);
    },
  );

  it("still gives an explorer fixed range the dot and start · duration forms", () => {
    const forms = triggerLabelForms({
      kind: "fixed",
      dashboard: false,
      name: "",
      dates: "Nov 16, 00:03:59 – 00:54:43",
      duration: "50m 44s",
    });
    expect(forms.at(-1)).toEqual({
      name: "",
      dates: "Nov 16, 00:03:59 · 50m 44s",
      zoneDot: true,
    });
    expect(forms.some((form) => form.zoneDot)).toBe(true);
  });
});

describe("rollingShortName", () => {
  it.each([
    ["15m", "15m"],
    ["90d", "90d"],
    ["12M", "12mo"],
    ["2w", "2w"],
    ["calendar:quarter:-1", null],
  ])("%s → %s", (span, short) => {
    expect(rollingShortName(span)).toBe(short);
  });
});
