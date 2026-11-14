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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref, shallowRef } from "vue";

import i18n from "@/locales";
import StarterPackAdaptedRows from "./StarterPackAdaptedRows.vue";

const flowWith = (preview: Record<string, unknown>) => ({
  pack: { aliasTitles: { k8s_cluster: "starterPacks.kubernetes.fieldCluster" }, flavours: [] },
  preview: shallowRef({
    bindings: [],
    questions: [],
    columns: {},
    groupTitles: {},
    flavours: {},
    ...preview,
  }),
  alertCount: ref(4),
  chooseStream: vi.fn(async () => {}),
  chooseField: vi.fn(async () => {}),
});
const render = (flow: ReturnType<typeof flowWith>) =>
  mount(StarterPackAdaptedRows, {
    props: { flow: flow as any },
    global: {
      plugins: [i18n],
      stubs: { ODialog: { template: "<div><slot /></div>" }, OIcon: true },
    },
  });
const events = "starterPacks.kubernetes.roleEvents";

describe("StarterPackAdaptedRows", () => {
  it("lists a fix with Change and never says verified", () => {
    const flow = flowWith({
      questions: [
        {
          want: "k8s_events",
          kind: "confirm",
          titleKey: events,
          candidates: [],
          answer: { from: "k8s_events", to: "edge" },
        },
      ],
      bindings: [
        {
          stream: "s",
          from: "k8s_cluster",
          to: "cluster_name",
          tier: "alias",
          group: "k8s_cluster",
        },
      ],
    });
    const text = render(flow).text();
    expect(text).toContain("Reads Kubernetes events from edge");
    expect(text).toContain("Cluster name read from cluster_name");
    expect(text).toContain("Change");
    expect(text.toLowerCase()).not.toContain("verified");
  });

  it("asks once and Use all sends every stream", async () => {
    const candidates = [
      { stream: "edge-eu", matched: 3, total: 3, samples: [] },
      { stream: "edge-us", matched: 3, total: 3, samples: [] },
    ];
    const flow = flowWith({
      questions: [{ want: "k8s_events", kind: "confirm", titleKey: events, candidates }],
    });
    const wrapper = render(flow);
    expect(wrapper.text()).toContain("2 streams look like Kubernetes events");
    await wrapper.get('[data-test="starter-pack-adapted-choose-btn"]').trigger("click");
    await flushPromises();
    await wrapper.get('[data-test="starter-pack-repair-use-all-btn"]').trigger("click");
    expect(flow.chooseStream).toHaveBeenCalledWith("k8s_events", {
      to: "edge-eu",
      also: ["edge-us"],
    });
  });

  it("shows the collector snippet when nothing matches", async () => {
    const flow = flowWith({
      questions: [{ want: "k8s_events", kind: "none", titleKey: events, candidates: [] }],
    });
    const wrapper = render(flow);
    await wrapper.get('[data-test="starter-pack-adapted-choose-btn"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("stream-name");
    expect(wrapper.text()).toContain("k8s_events");
  });
});
