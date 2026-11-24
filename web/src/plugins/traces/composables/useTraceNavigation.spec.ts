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

import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, ref } from "vue";
import { mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import {
  provideTraceLinksInNewTab,
  traceNavigator,
  useTraceNavigate,
  type TraceNavigate,
} from "./useTraceNavigation";

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/logs", name: "logs", component: { template: "<div />" } },
    ],
  });

describe("traceNavigator", () => {
  afterEach(() => vi.restoreAllMocks());

  it("pushes the route while the host stays out of it", () => {
    const router = makeRouter();
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    traceNavigator(router, () => false)({ name: "logs", query: { a: "1" } });
    expect(push).toHaveBeenCalledWith({ name: "logs", query: { a: "1" } });
    expect(open).not.toHaveBeenCalled();
  });

  it("opens the route in a new tab and leaves the page while the host asks for it", () => {
    const router = makeRouter();
    const push = vi.spyOn(router, "push");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    traceNavigator(router, () => true)({ name: "logs", query: { a: "1" } });
    expect(push).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("/logs?a=1", "_blank", "noopener,noreferrer");
  });
});

describe("useTraceNavigate", () => {
  afterEach(() => vi.restoreAllMocks());

  const navigateBelow = (newTab: boolean | null) => {
    const router = makeRouter();
    let navigate: TraceNavigate = () => undefined;
    const Child = defineComponent({
      setup() {
        navigate = useTraceNavigate();
        return () => h("div");
      },
    });
    const Host = defineComponent({
      setup() {
        if (newTab !== null) provideTraceLinksInNewTab(ref(newTab));
        return () => h(Child);
      },
    });
    mount(Host, { global: { plugins: [router] } });
    return { router, navigate };
  };

  it("a view below a host that wants new tabs opens its links in one", () => {
    const { navigate } = navigateBelow(true);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    navigate({ name: "logs" });
    expect(open).toHaveBeenCalledWith("/logs", "_blank", "noopener,noreferrer");
  });

  it.each([false, null])("with the host flag %s the view navigates in place", (flag) => {
    const { router, navigate } = navigateBelow(flag);
    const push = vi.spyOn(router, "push").mockResolvedValue(undefined);
    navigate({ name: "logs" });
    expect(push).toHaveBeenCalledWith({ name: "logs" });
  });
});
