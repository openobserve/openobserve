//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { b64EncodeUnicode } from "@/utils/zincutils";
import { cachedSearchMatchesRoute, lastRunSearch, type CachedLogsSearch } from "./logsRouteCache";
import type { ShownEntry } from "./useLogsUrl";

const cached: CachedLogsSearch = {
  streams: ["app"],
  org: "default",
  streamType: "logs",
  query: "select 1",
  sqlMode: true,
  timeType: "relative",
  period: "15m",
  startTime: 100,
  endTime: 200,
  toggle: "logs",
};

const matches = (route: Record<string, unknown>, over: Partial<CachedLogsSearch> = {}) =>
  cachedSearchMatchesRoute(
    { stream: "app", org_identifier: "default", ...route },
    { ...cached, ...over },
  );

describe("cachedSearchMatchesRoute", () => {
  it("keeps the cache for a bare link to the same stream and org", () => {
    expect(matches({})).toBe(true);
  });

  it("keeps the cache when the route repeats what the cache already holds", () => {
    expect(
      matches({
        stream_type: "logs",
        query: b64EncodeUnicode("select 1"),
        sql_mode: "true",
        period: "15m",
        logs_visualize_toggle: "logs",
      }),
    ).toBe(true);
  });

  it("drops the cache when the org differs", () => {
    expect(matches({ org_identifier: "other" })).toBe(false);
  });

  it("drops the cache when the query differs", () => {
    expect(matches({ query: b64EncodeUnicode("select 2") })).toBe(false);
  });

  it("drops the cache when the relative period differs", () => {
    expect(matches({ period: "2h" })).toBe(false);
  });

  it("drops a relative cache for an absolute range, and keeps an equal absolute one", () => {
    expect(matches({ from: "100", to: "200" })).toBe(false);
    expect(matches({ from: "100", to: "200" }, { timeType: "absolute" })).toBe(true);
    expect(matches({ from: "100", to: "300" }, { timeType: "absolute" })).toBe(false);
  });

  it("drops a traces cache for a logs link to the stream of the same name", () => {
    expect(matches({ stream_type: "logs" }, { streamType: "traces" })).toBe(false);
  });

  it("treats a link without stream_type as logs, not as whatever is cached", () => {
    expect(matches({}, { streamType: "traces" })).toBe(false);
    expect(matches({}, { streamType: undefined })).toBe(true);
  });

  it("drops the cache when sql_mode or the visualize toggle differs from the cached one", () => {
    expect(matches({ sql_mode: "false" })).toBe(false);
    expect(matches({ logs_visualize_toggle: "visualize" })).toBe(false);
    expect(matches({ logs_visualize_toggle: "visualize" }, { toggle: "visualize" })).toBe(true);
  });

  it("drops a multi-stream cache for a single-stream link to one of its streams", () => {
    expect(matches({}, { streams: ["app", "web"] })).toBe(false);
  });

  it("treats a different stream order as the same selection", () => {
    expect(matches({ stream: "web,app" }, { streams: ["app", "web"] })).toBe(true);
  });
});

describe("lastRunSearch", () => {
  const shown = (over: Partial<ShownEntry["inputs"]> = {}, period: ShownEntry["period"]) =>
    ({
      generation: 1,
      inputs: { streams: ["app"], streamType: "logs", query: "select 1", sqlMode: true, ...over },
      period,
    }) as unknown as ShownEntry;

  const staged: CachedLogsSearch = { ...cached, query: "select 2 -- typed, not run", period: "1h" };

  it("keeps an unrun edit from dropping the cache when the URL carries the last run", () => {
    const last = lastRunSearch(staged, shown({}, { type: "relative", period: "15m" }));
    const route = {
      stream: "app",
      org_identifier: "default",
      query: b64EncodeUnicode("select 1"),
      period: "15m",
    };
    expect(cachedSearchMatchesRoute(route, staged)).toBe(false);
    expect(cachedSearchMatchesRoute(route, last)).toBe(true);
  });

  it("still drops the cache for a link that differs from the last run", () => {
    const last = lastRunSearch(staged, shown({}, { type: "relative", period: "15m" }));
    expect(
      cachedSearchMatchesRoute(
        { stream: "app", org_identifier: "default", query: b64EncodeUnicode("select 3") },
        last,
      ),
    ).toBe(false);
  });

  it("maps an absolute last run and falls back to the cache when nothing has run", () => {
    const last = lastRunSearch(cached, shown({}, { type: "absolute", startUs: 5, endUs: 9 }));
    expect(last).toMatchObject({ timeType: "absolute", startTime: 5, endTime: 9 });
    expect(lastRunSearch(cached, null)).toBe(cached);
  });
});
