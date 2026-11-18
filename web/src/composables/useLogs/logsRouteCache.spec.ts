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
import { cachedSearchMatchesRoute } from "./logsRouteCache";

const cached = {
  streams: ["app"],
  org: "default",
  url: {
    stream_type: "logs",
    query: "c2VsZWN0IDE=",
    sql_mode: true,
    period: "15m",
    logs_visualize_toggle: "logs",
  } as Record<string, unknown>,
};

const route = (query: Record<string, unknown>) => ({
  stream: "app",
  org_identifier: "default",
  ...query,
});

const matches = (query: Record<string, unknown>, c = cached) =>
  cachedSearchMatchesRoute(route(query), c.streams, c.org, c.url);

describe("cachedSearchMatchesRoute", () => {
  it("keeps the cache for a bare link to the same stream and org", () => {
    expect(matches({})).toBe(true);
  });

  it("keeps the cache when the route repeats what the cache already holds", () => {
    expect(
      matches({ stream_type: "logs", query: "c2VsZWN0IDE=", sql_mode: "true", period: "15m" }),
    ).toBe(true);
  });

  it("drops the cache when the org differs", () => {
    expect(matches({ org_identifier: "other" })).toBe(false);
  });

  it("drops the cache when the query differs", () => {
    expect(matches({ query: "c2VsZWN0IDI=" })).toBe(false);
  });

  it("drops the cache when the relative period differs", () => {
    expect(matches({ period: "2h" })).toBe(false);
  });

  it("drops the cache when the link carries an absolute range and the cache a relative one", () => {
    expect(matches({ from: "1", to: "2" })).toBe(false);
  });

  it("drops the cache when the stream type differs", () => {
    expect(matches({ stream_type: "traces" })).toBe(false);
  });

  it("drops a traces cache for a logs link to the stream of the same name", () => {
    const traces = { ...cached, url: { ...cached.url, stream_type: "traces" } };
    expect(matches({ stream_type: "logs" }, traces)).toBe(false);
  });

  it("treats a link without stream_type as logs, not as whatever is cached", () => {
    const traces = { ...cached, url: { ...cached.url, stream_type: "traces" } };
    expect(matches({}, traces)).toBe(false);
    expect(matches({}, { ...cached, url: { ...cached.url, stream_type: undefined } })).toBe(true);
  });

  it("drops the cache when sql_mode or the visualize toggle differs", () => {
    expect(matches({ sql_mode: "false" })).toBe(false);
    expect(matches({ logs_visualize_toggle: "visualize" })).toBe(false);
  });

  it("drops a multi-stream cache for a single-stream link to one of its streams", () => {
    expect(cachedSearchMatchesRoute(route({}), ["app", "web"], "default", cached.url)).toBe(false);
  });

  it("treats a different stream order as the same selection", () => {
    expect(
      cachedSearchMatchesRoute(route({ stream: "web,app" }), ["app", "web"], "default", cached.url),
    ).toBe(true);
  });
});
