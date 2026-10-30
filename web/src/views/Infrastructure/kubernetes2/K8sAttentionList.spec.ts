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
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import K8sAttentionList from "./K8sAttentionList.vue";
import type { AttentionItem } from "./overviewModel";

let wrapper: VueWrapper<any>;

const item = (name: string): AttentionItem => ({
  key: name,
  ref: { kind: "pod", cluster: "prod", namespace: "shop", name },
  kind: "pod",
  name,
  namespace: "shop",
  severity: "error",
  score: 10,
  reasons: ["CrashLoopBackOff"],
  notReady: true,
  restarts: null,
  createdAt: null,
  sinceUs: null,
  canLogs: true,
});

const mountList = (total: number) => {
  wrapper = mount(K8sAttentionList, {
    props: { items: [item("a"), item("b")], total, loading: false, endUs: 1_000_000 },
    global: { plugins: [i18n] },
  });
  return wrapper;
};

afterEach(() => wrapper?.unmount());

describe("K8sAttentionList", () => {
  it("links the total to the failing pods list when more items exist than shown", async () => {
    mountList(23);
    const showing = wrapper.find('[data-test="k8s2-overview-attention-showing"]');
    expect(showing.text()).toContain("Showing 2 of");
    expect(wrapper.find('[data-test="k8s2-overview-attention-all"]').text()).toBe("23");
    await wrapper.find('[data-test="k8s2-overview-attention-all"]').trigger("click");
    expect(wrapper.emitted("navigate")).toEqual([[{ view: "pods", status: "failing" }]]);
  });

  it("shows no count link when everything fits", () => {
    mountList(2);
    expect(wrapper.find('[data-test="k8s2-overview-attention-all"]').exists()).toBe(false);
  });
});
