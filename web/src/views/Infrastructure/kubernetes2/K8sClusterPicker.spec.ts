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
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import K8sClusterPicker, { type PickerCluster } from "./K8sClusterPicker.vue";

// JSDOM has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) =>
      computed(() => {
        const count = unref(options).count;
        return {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index * 28,
              size: 28,
              end: (index + 1) * 28,
              lane: 0,
            })),
          getTotalSize: () => count * 28,
          scrollToIndex: () => {},
          measureElement: () => {},
        };
      }),
  };
});

enableAutoUnmount(afterEach);

const clusters: PickerCluster[] = [
  { name: "prod-east", tone: "success" },
  { name: "stage", tone: "warning" },
  { name: "dev", tone: "error" },
  { name: "quiet", tone: "neutral" },
];

const TRIGGER = '[data-test="k8s2-cluster-picker-trigger"]';

const mountPicker = (active: string | null = "prod-east") =>
  mount(K8sClusterPicker, {
    props: { clusters, active },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });

const openPicker = async (active: string | null = "prod-east") => {
  const wrapper = mountPicker(active);
  await wrapper.find(TRIGGER).trigger("click");
  await flushPromises();
  return wrapper;
};

const body = () => document.body;
const option = (name: string) =>
  body().querySelector<HTMLElement>(`[data-test="k8s2-cluster-option-${name}"]`);
const optionRow = (name: string) =>
  option(name)!.closest<HTMLElement>('[data-test="k8s2-cluster-picker-option"]')!;

describe("K8sClusterPicker", () => {
  it("shows only the active cluster name on the trigger", () => {
    expect(mountPicker("stage").find(TRIGGER).text()).toBe("stage");
  });

  it("names the active cluster for screen readers", () => {
    expect(mountPicker("stage").find(TRIGGER).attributes("aria-label")).toBe("Cluster: stage");
  });

  it("falls back to a label while no cluster is resolved", () => {
    expect(mountPicker(null).find(TRIGGER).text()).toBe("Cluster");
  });

  it("lists every cluster with a health dot once opened", async () => {
    await openPicker();
    for (const c of clusters) expect(option(c.name)).not.toBeNull();
    expect(
      body()
        .querySelector('[data-test="k8s2-cluster-dot-dev"]')
        ?.classList.contains("bg-status-error-text"),
    ).toBe(true);
    expect(option("dev")!.getAttribute("aria-label")).toContain("dev");
  });

  it("filters the list by the search text and shows the empty state", async () => {
    await openPicker();
    const input = body().querySelector<HTMLInputElement>(
      '[data-test="k8s2-cluster-picker-search"]',
    )!;
    input.value = "sta";
    input.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 400));
    await flushPromises();
    expect(option("stage")).not.toBeNull();
    expect(option("dev")).toBeNull();

    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 400));
    await flushPromises();
    expect(body().querySelector('[data-test="k8s2-cluster-picker-empty"]')).not.toBeNull();
  });

  it("emits select with the chosen cluster", async () => {
    const wrapper = await openPicker();
    optionRow("dev").click();
    await flushPromises();
    expect(wrapper.emitted("select")).toEqual([["dev"]]);
  });

  it("does not emit when the active cluster is chosen again", async () => {
    const wrapper = await openPicker("prod-east");
    optionRow("prod-east").click();
    await flushPromises();
    expect(wrapper.emitted("select")).toBeUndefined();
  });

  it("shows loading text and is disabled while the first clusters load", () => {
    const wrapper = mount(K8sClusterPicker, {
      props: { clusters: [], active: null, loading: true },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    expect(wrapper.text()).toContain("Loading clusters");
    expect(wrapper.find(TRIGGER).attributes("disabled")).toBeDefined();
  });

  it("keeps the active cluster name while the page is still loading", () => {
    const wrapper = mount(K8sClusterPicker, {
      props: { clusters, active: "prod-east", loading: true },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    expect(wrapper.text()).toContain("prod-east");
    expect(wrapper.text()).not.toContain("Loading clusters");
  });
});
