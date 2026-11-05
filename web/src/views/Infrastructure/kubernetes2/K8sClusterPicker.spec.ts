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

import { afterEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import K8sClusterPicker, { type PickerCluster } from "./K8sClusterPicker.vue";

enableAutoUnmount(afterEach);

const clusters: PickerCluster[] = [
  { name: "prod-east", tone: "success" },
  { name: "stage", tone: "warning" },
  { name: "dev", tone: "error" },
  { name: "quiet", tone: "neutral" },
];

const mountPicker = (active: string | null = "prod-east") =>
  mount(K8sClusterPicker, {
    props: { clusters, active },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });

const openPicker = async (active: string | null = "prod-east") => {
  const wrapper = mountPicker(active);
  await wrapper.find('[data-test="k8s2-cluster-picker"]').trigger("click");
  await flushPromises();
  return wrapper;
};

const body = () => document.body;
const option = (name: string) =>
  body().querySelector<HTMLElement>(`[data-test="k8s2-cluster-option-${name}"]`);

describe("K8sClusterPicker", () => {
  it("shows only the active cluster name on the trigger", () => {
    const trigger = mountPicker("stage").find('[data-test="k8s2-cluster-picker"]');
    expect(trigger.text()).toBe("stage");
  });

  it("lists every cluster with a health dot once opened", async () => {
    await openPicker();
    for (const c of clusters) expect(option(c.name)).not.toBeNull();
    expect(
      body()
        .querySelector('[data-test="k8s2-cluster-dot-dev"]')
        ?.classList.contains("bg-status-error-text"),
    ).toBe(true);
  });

  it("filters the list by the search text", async () => {
    await openPicker();
    const input = body().querySelector<HTMLInputElement>(
      '[data-test="k8s2-cluster-picker-search"] input, input[data-test="k8s2-cluster-picker-search"]',
    );
    input!.value = "sta";
    input!.dispatchEvent(new Event("input"));
    await new Promise((r) => setTimeout(r, 400));
    expect(option("stage")).not.toBeNull();
    expect(option("dev")).toBeNull();
  });

  it("emits select with the chosen cluster and closes", async () => {
    const wrapper = await openPicker();
    option("dev")!.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("select")).toEqual([["dev"]]);
    expect(wrapper.find('[data-test="k8s2-cluster-picker"]').attributes("aria-expanded")).toBe(
      "false",
    );
  });

  it("does not emit when the active cluster is chosen again", async () => {
    const wrapper = await openPicker("prod-east");
    option("prod-east")!.click();
    expect(wrapper.emitted("select")).toBeUndefined();
  });
});
