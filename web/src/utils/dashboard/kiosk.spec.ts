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
  buildKioskQuery,
  computeFitCellHeight,
  formatAge,
  formatClockTime,
  formatRefreshLabel,
  formatRelativePeriod,
  hungAfterMs,
  isFitEnabled,
  isKioskEnabled,
  parseKioskTheme,
  pickKioskParams,
  resolveKioskRefresh,
  retryDelayMs,
  staleAfterMs,
  stripKioskParams,
  summarizePanelError,
} from "./kiosk";
import type { TranslateFn } from "@/types/i18n";

const t = ((key: string, named?: Record<string, unknown>) =>
  named ? `${key}:${JSON.stringify(named)}` : key) as unknown as TranslateFn;

describe("kiosk URL contract", () => {
  it("accepts ?kiosk, ?kiosk=true and ?kiosk=1 and ignores anything else", () => {
    expect(isKioskEnabled(null)).toBe(true);
    expect(isKioskEnabled("")).toBe(true);
    expect(isKioskEnabled("true")).toBe(true);
    expect(isKioskEnabled("1")).toBe(true);
    expect(isKioskEnabled(["true"])).toBe(true);
    expect(isKioskEnabled(undefined)).toBe(false);
    expect(isKioskEnabled("false")).toBe(false);
    expect(isKioskEnabled("yes")).toBe(false);
  });

  it("only forces a known theme", () => {
    expect(parseKioskTheme("dark")).toBe("dark");
    expect(parseKioskTheme("light")).toBe("light");
    expect(parseKioskTheme("blue")).toBeNull();
    expect(parseKioskTheme(undefined)).toBeNull();
  });

  it("reads fit=true and fit=1 only", () => {
    expect(isFitEnabled("true")).toBe(true);
    expect(isFitEnabled("1")).toBe(true);
    expect(isFitEnabled(null)).toBe(false);
    expect(isFitEnabled("no")).toBe(false);
  });

  it("raises a too-low refresh to the server minimum instead of turning it off", () => {
    expect(resolveKioskRefresh("1s", 10)).toBe(10);
    expect(resolveKioskRefresh("1m", 10)).toBe(60);
    expect(resolveKioskRefresh("2s", null)).toBe(5);
    expect(resolveKioskRefresh("2s", 0)).toBe(5);
  });

  it("treats a missing, zero or garbage refresh as off", () => {
    expect(resolveKioskRefresh(undefined, 5)).toBe(0);
    expect(resolveKioskRefresh("0s", 5)).toBe(0);
    expect(resolveKioskRefresh("Off", 5)).toBe(0);
    expect(resolveKioskRefresh("soon", 5)).toBe(0);
  });

  it("carries the kiosk params over a URL rewrite, and nothing when kiosk is off", () => {
    expect(
      pickKioskParams({ kiosk: null, theme: "dark", fit: "1", timezone: "Asia/Kolkata" }),
    ).toEqual({ kiosk: "true", theme: "dark", fit: "true", timezone: "Asia/Kolkata" });
    expect(pickKioskParams({ kiosk: "true", theme: "purple" })).toEqual({ kiosk: "true" });
    expect(pickKioskParams({ theme: "dark", timezone: "UTC" })).toEqual({});
  });

  it("strips every kiosk-only param on exit and keeps the rest", () => {
    expect(
      stripKioskParams({
        dashboard: "d1",
        kiosk: "true",
        theme: "dark",
        fit: "true",
        timezone: "UTC",
        period: "15m",
      }),
    ).toEqual({ dashboard: "d1", period: "15m" });
  });
});

describe("buildKioskQuery", () => {
  const base = {
    org_identifier: "default",
    dashboard: "d1",
    folder: "default",
    tab: "t2",
    period: "1h",
    refresh: "Off",
    print: "false",
    "var-region": "eu",
  };

  it("keeps the relative period, tab and variables, never converting to from/to", () => {
    const q = buildKioskQuery(base, { refreshSeconds: 300, theme: "current", fit: false });
    expect(q.period).toBe("1h");
    expect(q.from).toBeUndefined();
    expect(q.to).toBeUndefined();
    expect(q.tab).toBe("t2");
    expect(q["var-region"]).toBe("eu");
    expect(q.kiosk).toBe("true");
    expect(q.refresh).toBe("5m");
  });

  it("drops print and adds a theme only when one is forced", () => {
    const current = buildKioskQuery(base, { refreshSeconds: 60, theme: "current", fit: false });
    expect(current.print).toBeUndefined();
    expect(current.theme).toBeUndefined();
    expect(current.fit).toBeUndefined();

    const dark = buildKioskQuery(base, { refreshSeconds: 60, theme: "dark", fit: true });
    expect(dark.theme).toBe("dark");
    expect(dark.fit).toBe("true");
  });

  it("keeps an absolute range and omits refresh when it is off", () => {
    const q = buildKioskQuery(
      { dashboard: "d1", from: "100", to: "200", refresh: "1m", timezone: "UTC" },
      { refreshSeconds: 0, theme: "light", fit: false },
    );
    expect(q.from).toBe("100");
    expect(q.to).toBe("200");
    expect(q.refresh).toBeUndefined();
    expect(q.timezone).toBe("UTC");
  });
});

describe("kiosk helpers", () => {
  it("formats a 24-hour clock time in the given timezone, with or without seconds", () => {
    const at = Date.UTC(2026, 9, 14, 23, 16, 30);
    expect(formatClockTime(at, "UTC")).toBe("23:16:30");
    expect(formatClockTime(at, "Asia/Kolkata")).toBe("04:46:30");
    expect(formatClockTime(at, "UTC", false)).toBe("23:16");
    expect(formatClockTime(at, "Not/AZone")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("words the age of the last update like the app's other refresh indicators", () => {
    expect(formatAge(2000, t)).toBe("refreshButton.justNow");
    expect(formatAge(42_000, t)).toBe('refreshButton.secondsAgo:{"sec":42}');
    expect(formatAge(5 * 60_000 + 10_000, t)).toBe('refreshButton.minutesAgo:{"min":5}');
    expect(formatAge(3 * 3_600_000, t)).toBe('refreshButton.hoursAgo:{"h":3}');
    expect(formatAge(-500, t)).toBe("refreshButton.justNow");
  });

  it("backs off from 5s and never waits longer than the refresh interval", () => {
    expect(retryDelayMs(1, 60)).toBe(5000);
    expect(retryDelayMs(2, 60)).toBe(10000);
    expect(retryDelayMs(3, 60)).toBe(20000);
    expect(retryDelayMs(6, 60)).toBe(60000);
    expect(retryDelayMs(10, 0)).toBe(60000);
    // A slow refresh must not leave the screen stale for minutes after the backend is back.
    expect(retryDelayMs(10, 300)).toBe(60000);
  });

  it("only calls a cycle hung after twice the interval, and never under 30s", () => {
    expect(hungAfterMs(5)).toBe(30000);
    expect(hungAfterMs(60)).toBe(120000);
    expect(staleAfterMs(60)).toBe(120000);
  });

  it("sizes cells so every row fits", () => {
    expect(computeFitCellHeight(900, 60)).toBe(15);
    expect(computeFitCellHeight(100, 60)).toBe(4);
    expect(computeFitCellHeight(900, 0)).toBeNull();
    expect(computeFitCellHeight(0, 10)).toBeNull();
  });

  it("labels refresh intervals like the toolbar picker", () => {
    expect(formatRefreshLabel(0, t)).toBe("common.off");
    expect(formatRefreshLabel(30, t)).toBe('common.secShort:{"count":30}');
    expect(formatRefreshLabel(300, t)).toBe('common.minShort:{"count":5}');
    expect(formatRefreshLabel(3600, t)).toBe('common.hrShort:{"count":1}');
  });

  it("labels relative periods and rejects anything else", () => {
    expect(formatRelativePeriod("15m", t)).toBe('common.pastMinute:{"count":15}');
    expect(formatRelativePeriod("2d", t)).toBe('common.pastDay:{"count":2}');
    expect(formatRelativePeriod("now-1h", t)).toBeNull();
    expect(formatRelativePeriod(undefined, t)).toBeNull();
  });

  it("summarizes a panel error to its first meaningful line", () => {
    expect(
      summarizePanelError('Error# SQL error: ParserError("Expected: X at Line: 1")\nmore'),
    ).toBe("Expected: X at Line: 1");
    expect(summarizePanelError("\n  stream k8s_events not found\n")).toBe(
      "stream k8s_events not found",
    );
    expect(summarizePanelError("")).toBe("");
  });
});
