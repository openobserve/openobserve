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

import { describe, it, expect, vi, afterEach } from "vitest";

// zincutils <-> stores is a circular import: stores/index.ts imports helpers
// from zincutils at module-eval time. In the running app the store module is
// evaluated first, so the cycle resolves; importing zincutils directly in a
// test evaluates it first and the store sees those helpers still in their TDZ.
// The functions under test (timezone math) touch none of this chain, so we cut
// the transitive heavy deps — vi.mock is hoisted above the import below.
vi.mock("../stores", () => ({ default: { state: {} } }));
vi.mock("@/services/users", () => ({ default: {} }));
vi.mock("@/composables/useStreams", () => ({ default: () => ({}) }));

import { convertDateToTimestamp, getTimezoneOffset } from "./zincutils";

// Force what the code sees as the *browser* timezone, without breaking Luxon.
// The functions under test read the browser zone via `Intl.DateTimeFormat()`
// called with NO arguments; Luxon computes zone offsets via
// `new Intl.DateTimeFormat(locale, { timeZone, ... })` (always WITH arguments).
// So we override the resolved timeZone only for the zero-arg "what's my zone"
// query and delegate every argument-carrying call to the real implementation —
// this keeps offset math correct while letting each test pin the browser zone.
const RealDateTimeFormat = Intl.DateTimeFormat;

function mockBrowserTimezone(zone: string) {
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation((...args: any[]) => {
    const instance = new (RealDateTimeFormat as any)(...args);
    if (args.length === 0) {
      const realResolved = instance.resolvedOptions.bind(instance);
      instance.resolvedOptions = () => ({ ...realResolved(), timeZone: zone });
    }
    return instance;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("convertDateToTimestamp", () => {
  // A fixed summer date keeps the expected offsets deterministic (LA is on PDT
  // = UTC-7 = -420 minutes; India is UTC+5:30 = +330 minutes, no DST).
  const DATE = "27-07-2026";
  const TIME = "10:00";

  it("resolves a raw IANA zone regardless of the browser zone", () => {
    mockBrowserTimezone("Asia/Kolkata");
    const { offset } = convertDateToTimestamp(DATE, TIME, "America/Los_Angeles");
    expect(offset).toBe(-420);
  });

  it("unwraps a 'Browser Time (<zone>)' label that matches the current browser", () => {
    mockBrowserTimezone("America/Los_Angeles");
    const { offset } = convertDateToTimestamp(
      DATE,
      TIME,
      "Browser Time (America/Los_Angeles)",
    );
    expect(offset).toBe(-420);
  });

  // This is the regression under fix: a label saved on a machine in one zone,
  // re-opened on a machine in a DIFFERENT zone. Previously the label was passed
  // to Luxon verbatim ("Browser Time (America/Los_Angeles)" is not a valid IANA
  // zone), producing an invalid DateTime whose `.offset` is NaN — which
  // serializes to null in the saved payload (e.g. an alert's tz_offset).
  it("unwraps a 'Browser Time (<zone>)' label from a DIFFERENT browser (regression)", () => {
    mockBrowserTimezone("Asia/Kolkata");
    const { offset } = convertDateToTimestamp(
      DATE,
      TIME,
      "Browser Time (America/Los_Angeles)",
    );
    expect(offset).toBe(-420);
    expect(Number.isNaN(offset)).toBe(false);
  });

  it("never returns NaN for an unresolvable zone (falls back to the browser zone)", () => {
    mockBrowserTimezone("Asia/Kolkata"); // +330
    const { offset } = convertDateToTimestamp(DATE, TIME, "Not/AZone");
    expect(Number.isNaN(offset)).toBe(false);
    expect(offset).toBe(330);
  });

  it("returns a finite microsecond timestamp for a valid zone", () => {
    mockBrowserTimezone("Asia/Kolkata");
    const { timestamp } = convertDateToTimestamp(
      DATE,
      TIME,
      "America/Los_Angeles",
    );
    expect(Number.isFinite(timestamp)).toBe(true);
    // 2026-07-27 10:00 America/Los_Angeles == 2026-07-27T17:00:00Z
    expect(timestamp).toBe(Date.UTC(2026, 6, 27, 17, 0, 0) * 1000);
  });

  it("is case-insensitive for the browser-time label", () => {
    mockBrowserTimezone("America/Los_Angeles");
    const { offset } = convertDateToTimestamp(
      DATE,
      TIME,
      "browser time (America/Los_Angeles)",
    );
    expect(offset).toBe(-420);
  });
});

describe("getTimezoneOffset", () => {
  it("returns a finite offset for a 'Browser Time (<zone>)' label from another browser", () => {
    mockBrowserTimezone("Asia/Kolkata");
    const offset = getTimezoneOffset("Browser Time (America/Los_Angeles)");
    expect(Number.isNaN(offset)).toBe(false);
    // LA is either -420 (PDT) or -480 (PST) depending on today's date.
    expect([-420, -480]).toContain(offset);
  });

  it("returns the browser offset when no timezone is supplied", () => {
    mockBrowserTimezone("Asia/Kolkata"); // +330, no DST
    expect(getTimezoneOffset()).toBe(330);
  });
});
