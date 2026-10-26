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
import K8sRowMenu from "./K8sRowMenu.vue";
import { readActionsFor, writeActionsFor } from "./k8sActions";
import type { DetailsRef } from "./kubernetesUrlState";

enableAutoUnmount(afterEach);

const pod: DetailsRef = { kind: "pod", cluster: "prod", namespace: "shop", name: "web-1" };

const open = async (target: DetailsRef) => {
  const wrapper = mount(K8sRowMenu, {
    props: { target },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await wrapper.find('[data-test="k8s2-row-menu-trigger"]').trigger("click");
  await flushPromises();
  return wrapper;
};

const item = (type: string) => document.body.querySelector(`[data-test="k8s2-row-menu-${type}"]`);

describe("action sets", () => {
  it("offers logs and traces only for pods", () => {
    expect(readActionsFor("pod")).toEqual(["details", "yaml", "logs", "traces", "metrics"]);
    expect(readActionsFor("deployment")).toEqual(["details", "yaml", "metrics"]);
  });

  it("lists the write actions that apply to each kind", () => {
    expect(writeActionsFor("deployment")).toEqual(["scale", "restart", "delete"]);
    expect(writeActionsFor("node")).toEqual([]);
  });
});

describe("K8sRowMenu", () => {
  it("emits the read action with the row ref", async () => {
    const wrapper = await open(pod);
    (item("yaml") as HTMLElement).click();
    await flushPromises();
    expect(wrapper.emitted("action")).toEqual([["yaml", pod]]);
  });

  it("shows write actions disabled with a lock and emits nothing", async () => {
    const wrapper = await open({ ...pod, kind: "deployment", name: "web" });
    for (const type of ["scale", "restart", "delete"]) {
      expect(item(type)?.getAttribute("aria-disabled")).toBe("true");
    }
    for (const type of ["details", "yaml", "metrics"]) {
      expect(item(type)?.hasAttribute("aria-disabled")).toBe(false);
    }
    expect(document.body.querySelectorAll('[data-test="k8s2-row-menu-lock"]')).toHaveLength(3);
    (item("delete") as HTMLElement).click();
    await flushPromises();
    expect(wrapper.emitted("action")).toBeUndefined();
  });
});
