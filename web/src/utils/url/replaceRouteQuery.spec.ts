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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMemoryHistory, createRouter, type Router } from "vue-router";

import { replaceRouteQuery } from "./replaceRouteQuery";

let router: Router;

beforeEach(async () => {
  const page = { template: "<div />" };
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/insights", component: page },
      { path: "/sessions", component: page },
    ],
  });
  await router.push("/insights?org=default&period=6h&stream=old");
});

const route = () => router.currentRoute.value;

// One page, two writers: the date controller (period) and the list (stream).
const writePeriod = (period: string) =>
  replaceRouteQuery(router, route(), (q) => ({ ...q, period }));
const writeStream = (stream: string) =>
  replaceRouteQuery(router, route(), (q) => ({ ...q, stream }));

describe("replaceRouteQuery", () => {
  it("replaces the query, keeping params the update leaves alone", async () => {
    await writePeriod("3d");
    expect(route().query).toEqual({ org: "default", period: "3d", stream: "old" });
  });

  it.each([
    ["date first", () => [writePeriod("3d"), writeStream("new")]],
    ["list first", () => [writeStream("new"), writePeriod("3d")]],
  ])("keeps both writers' params when they overlap (%s)", async (_, run) => {
    await Promise.all(run());
    expect(route().query).toEqual({ org: "default", period: "3d", stream: "new" });
  });

  it("builds on the route again once the in-flight replace settled", async () => {
    await writePeriod("3d");
    await router.replace({ query: { org: "default" } });
    await writeStream("new");
    expect(route().query).toEqual({ org: "default", stream: "new" });
  });

  it("does not carry an in-flight query onto another page", async () => {
    const inFlight = writePeriod("3d");
    await router.push("/sessions?org=team1");
    await replaceRouteQuery(router, route(), (q) => ({ ...q, keyword: "refund" }));
    await inFlight;
    expect(route().path).toBe("/sessions");
    expect(route().query).toEqual({ org: "team1", keyword: "refund" });
  });

  it("issues no replace when the update changes nothing, so a push in flight lands", async () => {
    const replace = vi.spyOn(router, "replace");
    const push = router.push("/insights?org=team1");
    await replaceRouteQuery(router, route(), (q) => ({ stream: "old", ...q, period: "6h" }));
    await push;
    expect(replace).not.toHaveBeenCalled();
    expect(route().query).toEqual({ org: "team1" });
  });

  it("still replaces when the update changes a param", async () => {
    const replace = vi.spyOn(router, "replace");
    await writePeriod("3d");
    expect(replace).toHaveBeenCalledTimes(1);
  });
});
