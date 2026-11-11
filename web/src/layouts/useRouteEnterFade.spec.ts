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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { defineComponent, effectScope, h, type VNode } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { ENTER_FADE } from "@/lib/styles/motion";
import { useRouteEnterFade } from "./useRouteEnterFade";

const view = (name: string) => defineComponent({ name, render: () => h("div") });
const Kept = view("AppTraces");
const Other = view("TraceDetails");
const Plain = view("Plain");
const Parent = view("Functions");

describe("useRouteEnterFade", () => {
  let router: Router;
  let scope = effectScope();
  let fade: ReturnType<typeof useRouteEnterFade>;
  const classFor = () =>
    fade.enterClass({ type: router.currentRoute.value.matched[0]?.components?.default } as VNode);

  beforeEach(async () => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/kept", component: Kept },
        { path: "/other", component: Other },
        { path: "/plain", component: Plain },
        {
          path: "/parent",
          component: Parent,
          children: [
            { path: "a", component: view("ChildA") },
            { path: "b", component: view("ChildB") },
          ],
        },
      ],
    });
    scope = effectScope();
    fade = scope.run(() => useRouteEnterFade(router, ["AppTraces"]))!;
    await router.push("/plain");
  });

  afterEach(() => scope.stop());

  it("fades a fresh navigation in", async () => {
    expect(classFor()).toBe(ENTER_FADE);
    await router.push("/other");
    expect(classFor()).toBe(ENTER_FADE);
  });

  it("does not fade a page restored by Back or Forward", async () => {
    classFor();
    await router.push("/other");
    classFor();
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/plain");
    expect(classFor()).toBe("");
    router.forward();
    await flushPromises();
    expect(classFor()).toBe("");
  });

  it("does not fade a kept-alive view on its return, but does on its first visit", async () => {
    await router.push("/kept");
    expect(classFor()).toBe(ENTER_FADE);
    await router.push("/other");
    classFor();
    await router.push("/kept");
    expect(classFor()).toBe("");
  });

  it("never re-adds the fade to a view already shown, so a later navigation in it replays nothing", async () => {
    await router.push("/other");
    classFor();
    router.back();
    await flushPromises();
    expect(classFor()).toBe("");
    await router.push("/plain?q=1");
    expect(classFor()).toBe("");
  });

  it("tells the shown page whether it arrived fresh, for its own body entrance", async () => {
    await router.push("/other");
    classFor();
    expect(fade.entering()).toBe(true);
    router.back();
    await flushPromises();
    classFor();
    expect(fade.entering()).toBe(false);
    await router.push("/kept");
    classFor();
    expect(fade.entering()).toBe(true);
    await router.push("/other");
    classFor();
    await router.push("/kept");
    classFor();
    expect(fade.entering()).toBe(false);
  });

  it("reports a Back as a return even when the top-level view did not change", async () => {
    await router.push("/plain?x=1");
    classFor();
    expect(fade.entering()).toBe(true);
    await router.push("/other");
    classFor();
    await router.push("/plain");
    classFor();
    router.back();
    await flushPromises();
    expect(fade.entering()).toBe(false);
  });

  it("keeps a Back's decision through a page's own query-only replace", async () => {
    await router.push("/other");
    router.back();
    await flushPromises();
    await router.replace("/plain?tab=spans");
    expect(fade.entering()).toBe(false);
    await router.push("/other");
    expect(fade.entering()).toBe(true);
  });

  it("fades a nested child in on a fresh switch and not when Back or Forward remounts it", async () => {
    await router.push("/parent/a");
    expect(classFor()).toBe(ENTER_FADE);
    await router.push("/parent/b");
    expect(classFor()).toBe(ENTER_FADE);
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/parent/a");
    expect(classFor()).toBe("");
    router.forward();
    await flushPromises();
    expect(classFor()).toBe("");
    await router.push("/parent/a");
    expect(classFor()).toBe(ENTER_FADE);
  });

  it("keeps a nested child's class through a query-only navigation, so nothing replays", async () => {
    await router.push("/parent/a");
    classFor();
    await router.push("/parent/b");
    classFor();
    router.back();
    await flushPromises();
    expect(classFor()).toBe("");
    await router.replace("/parent/a?tab=x");
    expect(classFor()).toBe("");
  });

  it("fades a kept view in again once its cache is gone", async () => {
    await router.push("/kept");
    classFor();
    await router.push("/other");
    classFor();
    fade.forgetKeptViews();
    await router.push("/kept");
    expect(classFor()).toBe(ENTER_FADE);
  });
});
