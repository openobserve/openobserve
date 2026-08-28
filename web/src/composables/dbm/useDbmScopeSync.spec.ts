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

import { mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KeepAlive, defineComponent, h, nextTick, ref } from "vue";
import type { RouteLocationNormalizedLoaded } from "vue-router";

import { clearDbmAnchors, useDbmScope } from "./useDbmScope";
import { useDbmScopeSyncScope } from "./useDbmScopeSync";

/**
 * A keep-alive harness: the page under test lives inside a `<KeepAlive>`, so
 * toggling it fires `onActivated` exactly the way a DbmShell tab switch does.
 */
const harness = () => {
  const route = { query: { period: "1h" } as Record<string, unknown> };
  const reload = vi.fn();
  let scope!: ReturnType<typeof useDbmScope>;

  const Page = defineComponent({
    name: "Page",
    setup() {
      scope = useDbmScope(route.query);
      useDbmScopeSyncScope({
        route: route as unknown as RouteLocationNormalizedLoaded,
        scope,
        reload,
      });
      return () => h("div");
    },
  });

  const show = ref(true);
  const Host = defineComponent({
    setup: () => () => h(KeepAlive, show.value ? h(Page) : null),
  });

  const wrapper = mount(Host);

  const reactivate = async () => {
    show.value = false;
    await nextTick();
    show.value = true;
    await nextTick();
  };

  return { route, reload, scope: () => scope, wrapper, reactivate };
};

describe("useDbmScopeSyncScope", () => {
  beforeEach(() => {
    clearDbmAnchors();
  });

  /**
   * The point of the sync being conditional: reloading on every activation
   * would refetch on every tab switch — exactly the behaviour keep-alive was
   * added to remove.
   */
  it("does not reload when the URL scope matches the page's", async () => {
    const { reload, reactivate } = harness();
    await reactivate();
    expect(reload).not.toHaveBeenCalled();
  });

  it("adopts a moved relative range and reloads on return", async () => {
    const { route, reload, scope, reactivate } = harness();
    route.query.period = "24h";
    await reactivate();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(scope().range.value).toMatchObject({ type: "relative", relativeTimePeriod: "24h" });
  });

  it("adopts an absolute range from the URL's from/to", async () => {
    const { route, reload, scope, reactivate } = harness();
    route.query = { from: "1000", to: "2000" };
    await reactivate();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(scope().range.value).toMatchObject({
      type: "absolute",
      startTime: 1000,
      endTime: 2000,
    });
  });

  /**
   * Activation is the ONLY trigger. A live watcher on the route would make
   * every inactive kept-alive tab react to one tab's range change and fire
   * background fan-outs nobody asked for.
   */
  it("ignores URL changes while the page stays active", async () => {
    const { route, reload } = harness();
    route.query.period = "24h";
    await nextTick();
    expect(reload).not.toHaveBeenCalled();
  });

  it("settles back to quiet once the page has adopted the URL", async () => {
    const { route, reload, reactivate } = harness();
    route.query.period = "24h";
    await reactivate();
    await reactivate();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
