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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  isLeavingRoute,
  resetPendingNavigationForTests,
  trackPendingNavigation,
} from "@/utils/pendingNavigation";

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/traces", name: "traces", component: { template: "<div />" } },
      { path: "/logs", name: "logs", component: { template: "<div />" } },
      { path: "/home", name: "home", component: { template: "<div />" } },
    ],
  });

const held = async () => {
  const router = makeRouter();
  await router.push("/traces");
  trackPendingNavigation(router);
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  router.beforeEach(() => gate);
  return { router, release };
};

describe("pendingNavigation", () => {
  beforeEach(() => resetPendingNavigationForTests());

  it("reports a navigation to another route until it lands", async () => {
    const { router, release } = await held();
    const landed = router.push("/logs");
    await flushPromises();
    expect(isLeavingRoute("traces")).toBe(true);
    release();
    await landed;
    expect(isLeavingRoute("traces")).toBe(false);
  });

  it("does not count a same-route query change as leaving", async () => {
    const { router, release } = await held();
    const landed = router.push({ path: "/traces", query: { tab: "spans" } });
    await flushPromises();
    expect(isLeavingRoute("traces")).toBe(false);
    release();
    await landed;
  });

  it("clears after a guard rejects the navigation", async () => {
    const router = makeRouter();
    await router.push("/traces");
    trackPendingNavigation(router);
    router.beforeEach(() => false);
    await router.push("/logs");
    expect(isLeavingRoute("traces")).toBe(false);
  });

  it("clears after a guard throws, which skips afterEach", async () => {
    const router = makeRouter();
    await router.push("/traces");
    trackPendingNavigation(router);
    router.beforeEach(() => {
      throw new Error("guard failed");
    });
    await expect(router.push("/logs")).rejects.toThrow("guard failed");
    expect(isLeavingRoute("traces")).toBe(false);
  });

  it("clears after a guard redirects to the current location", async () => {
    const router = makeRouter();
    await router.push("/traces");
    trackPendingNavigation(router);
    router.beforeEach((to) => (to.name === "logs" ? "/traces" : true));
    await router.push("/logs");
    expect(isLeavingRoute("traces")).toBe(false);
  });

  it("keeps a newer held navigation when the older one is cancelled", async () => {
    const router = makeRouter();
    await router.push("/traces");
    trackPendingNavigation(router);
    let releaseOlder = () => {};
    const olderGate = new Promise<void>((resolve) => (releaseOlder = resolve));
    let releaseNewer = () => {};
    const newerGate = new Promise<void>((resolve) => (releaseNewer = resolve));
    router.beforeEach((to) => (to.name === "logs" ? olderGate : newerGate));
    const older = router.push("/logs");
    await flushPromises();
    const newer = router.push("/home");
    await flushPromises();
    releaseOlder();
    await older;
    await flushPromises();
    expect(isLeavingRoute("traces")).toBe(true);
    releaseNewer();
    await newer;
  });

  it("keeps a held navigation when a duplicate write to the current location fails", async () => {
    const { router, release } = await held();
    const leaving = router.push("/logs");
    await flushPromises();
    await router.replace("/traces");
    expect(isLeavingRoute("traces")).toBe(true);
    release();
    await leaving;
  });

  it("keeps a newer held navigation when an older one throws", async () => {
    const router = makeRouter();
    await router.push("/traces");
    trackPendingNavigation(router);
    let failOlder = (_error: Error) => {};
    const olderGate = new Promise<void>((_resolve, reject) => (failOlder = reject));
    let releaseNewer = () => {};
    const newerGate = new Promise<void>((resolve) => (releaseNewer = resolve));
    router.beforeEach((to) => (to.name === "logs" ? olderGate : newerGate));
    const older = router.push("/logs").catch(() => undefined);
    await flushPromises();
    const newer = router.push("/home");
    await flushPromises();
    failOlder(new Error("guard failed"));
    await older;
    await flushPromises();
    expect(isLeavingRoute("traces")).toBe(true);
    releaseNewer();
    await newer;
  });

  it("installs its hooks once per router", () => {
    const router = makeRouter();
    const before = vi.spyOn(router, "beforeEach");
    const after = vi.spyOn(router, "afterEach");
    const error = vi.spyOn(router, "onError");
    trackPendingNavigation(router);
    trackPendingNavigation(router);
    expect(before).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
