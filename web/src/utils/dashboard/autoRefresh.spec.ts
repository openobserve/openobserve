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
import {
  AUTO_REFRESH_INTERVALS,
  autoRefreshLabel,
  defaultRefreshOptions,
  effectiveDefaultRefresh,
  minAutoRefreshSeconds,
  resolveOpenRefreshInterval,
} from "@/utils/dashboard/autoRefresh";

const t = i18n.global.t as unknown as TranslateFn;

describe("resolveOpenRefreshInterval", () => {
  const resolve = (urlRefresh: any, savedDefault: unknown, minSeconds = 5) =>
    resolveOpenRefreshInterval({ urlRefresh, savedDefault, minSeconds });

  it("keeps refresh=Off from the URL over a saved default", () => {
    expect(resolve("Off", 60)).toBe(0);
  });

  it("uses a URL value over a saved default", () => {
    expect(resolve("5m", 60)).toBe(300);
    expect(resolve(["30s"], 60)).toBe(30);
  });

  it("turns off a URL value below the minimum", () => {
    expect(resolve("10s", 60, 30)).toBe(0);
  });

  it("treats an empty refresh= as present and Off", () => {
    expect(resolve("", 60)).toBe(0);
    expect(resolve(null, 60)).toBe(0);
  });

  it("falls back to the saved default when the URL has no refresh", () => {
    expect(resolve(undefined, 60)).toBe(60);
  });

  it("is Off when neither the URL nor the dashboard sets one", () => {
    expect(resolve(undefined, undefined)).toBe(0);
    expect(resolve(undefined, 0)).toBe(0);
  });

  it("raises a saved default below the minimum to the minimum", () => {
    expect(resolve(undefined, 10, 30)).toBe(30);
  });
});

describe("effectiveDefaultRefresh", () => {
  it("ignores garbage and negatives", () => {
    expect(effectiveDefaultRefresh("abc", 5)).toBe(0);
    expect(effectiveDefaultRefresh(-10, 5)).toBe(0);
  });
});

describe("minAutoRefreshSeconds", () => {
  it("falls back to 5 seconds when the server publishes nothing", () => {
    expect(minAutoRefreshSeconds(undefined)).toBe(5);
    expect(minAutoRefreshSeconds(0)).toBe(5);
    expect(minAutoRefreshSeconds(30)).toBe(30);
  });
});

describe("autoRefreshLabel", () => {
  it("labels intervals in the largest whole unit", () => {
    expect(autoRefreshLabel(0, t)).toBe("Off");
    expect(autoRefreshLabel(30, t)).toBe("30 sec");
    expect(autoRefreshLabel(300, t)).toBe("5 min");
    expect(autoRefreshLabel(7200, t)).toBe("2 hr");
    expect(autoRefreshLabel(86400, t)).toBe("1 day");
    expect(autoRefreshLabel(45, t)).toBe("45 sec");
  });
});

describe("defaultRefreshOptions", () => {
  it("offers Off plus the toolbar intervals, disabling those below the minimum", () => {
    const options = defaultRefreshOptions(30, t);
    expect(options.map((o) => o.value)).toEqual([0, ...AUTO_REFRESH_INTERVALS]);
    expect(options.filter((o: any) => o.disabled).map((o) => o.value)).toEqual([5, 10, 15]);
  });

  it("adds a saved value the toolbar does not list, in order", () => {
    const values = defaultRefreshOptions(5, t, 45).map((o) => o.value);
    expect(values.indexOf(45)).toBe(values.indexOf(30) + 1);
  });
});
