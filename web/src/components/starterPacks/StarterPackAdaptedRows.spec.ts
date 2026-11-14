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
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ref, shallowRef } from "vue";

import i18n from "@/locales";
import StarterPackAdaptedRows from "./StarterPackAdaptedRows.vue";

const flowWith = (preview: Record<string, unknown>) => ({
  pack: {
    aliasTitles: { k8s_cluster: "starterPacks.kubernetes.fieldCluster" },
    flavours: [{ id: "otel", titleKey: "starterPacks.kubernetes.flavourOtel" }],
  },
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
const render = (flow: ReturnType<typeof flowWith>, readonly = false) =>
  mount(StarterPackAdaptedRows, {
    props: { flow: flow as any, readonly },
    global: {
      plugins: [i18n],
      stubs: { OIcon: true },
    },
  });
type Wrapper = ReturnType<typeof render>;
const has = (wrapper: Wrapper, id: string) => wrapper.find(`[data-test="${id}"]`).exists();
const events = "starterPacks.kubernetes.roleEvents";
const answeredWith = (answer: Record<string, unknown>, titleKey?: string) => ({
  want: "kube_pod_info",
  kind: "confirm",
  titleKey,
  candidates: [],
  answer: { from: "kube_pod_info", ...answer },
});
const binding = (from: string, to: string) => ({ stream: "s", from, to, tier: "alias" });

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
    const wrapper = render(flow);
    const stream = wrapper.get('[data-test="starter-pack-adapted-stream"]');
    expect(stream.text()).toContain("Kubernetes events");
    expect(stream.get('[data-test="starter-pack-adapted-stream-chip"]').text()).toBe("edge");
    const field = wrapper.get('[data-test="starter-pack-adapted-field"]');
    expect(field.text()).toContain("Cluster name");
    expect(field.text()).toContain("cluster_name");
    expect(wrapper.text()).toContain("Streams");
    expect(wrapper.text()).toContain("Fields");
    expect(wrapper.text().toLowerCase()).not.toContain("verified");
  });

  it("shows a shared stream's filter as a second chip", () => {
    const flow = flowWith({
      questions: [
        answeredWith(
          { to: "default", filter: { field: "service_name", value: "k8s-events" } },
          events,
        ),
      ],
    });
    const chip = render(flow).get('[data-test="starter-pack-adapted-filter-chip"]');
    expect(chip.text()).toBe("service_name = k8s-events");
    expect(chip.attributes("title")).toBe("service_name = k8s-events");
  });

  it("shows Use all as a stream count that lists every stream on hover", () => {
    const flow = flowWith({
      questions: [answeredWith({ to: "kube_pod_info_prod", also: ["eu", "us"] })],
    });
    const wrapper = render(flow);
    const need = wrapper.get('[data-test="starter-pack-adapted-stream"] span');
    expect(need.text()).toBe("kube_pod_info");
    expect(need.classes()).toContain("font-mono");
    const chip = wrapper.get('[data-test="starter-pack-adapted-all-chip"]');
    expect(chip.text()).toBe("3 streams");
    expect(chip.attributes("title")).toBe("kube_pod_info_prod, eu, us");
  });

  it("lists the open questions first, a missing stream in neutral", () => {
    const flow = flowWith({
      questions: [
        answeredWith({ to: "kube_pod_info" }),
        {
          want: "kube_node_status_allocatable",
          kind: "confirm",
          candidates: [
            { stream: "a", matched: 1, total: 1, samples: [] },
            { stream: "b", matched: 1, total: 1, samples: [] },
          ],
        },
        { want: "k8s_events", kind: "none", titleKey: events, candidates: [] },
      ],
    });
    const asks = render(flow).findAll('[data-test="starter-pack-adapted-question"]');
    expect(asks.map((ask) => ask.text())).toEqual([
      "Which stream is kube_node_status_allocatable?2 look rightChoose",
      "No Kubernetes events foundChoose",
    ]);
    expect(asks[0].classes()).toContain("bg-status-warning-bg");
    expect(asks[1].classes()).not.toContain("bg-status-warning-bg");
  });

  it("shows three fields, then the rest on Show more, and the version last", async () => {
    const flow = flowWith({
      bindings: ["a", "b", "c", "d", "e"].map((name) => binding(name, `${name}_col`)),
      flavours: { kube: "otel" },
    });
    const wrapper = render(flow);
    expect(wrapper.findAll('[data-test="starter-pack-adapted-field"]')).toHaveLength(3);
    const more = wrapper.get('[data-test="starter-pack-adapted-fields-show-btn"]');
    expect(more.text()).toBe("Show 2 more");
    await more.trigger("click");
    expect(wrapper.findAll('[data-test="starter-pack-adapted-field"]')).toHaveLength(5);
    await wrapper.get('[data-test="starter-pack-adapted-fields-hide-btn"]').trigger("click");
    expect(wrapper.findAll('[data-test="starter-pack-adapted-field"]')).toHaveLength(3);
    expect(wrapper.find('[data-test="starter-pack-adapted-fields-show-btn"]').exists()).toBe(true);
    const version = wrapper.get('[data-test="starter-pack-adapted-flavour"]');
    expect(version.text()).toBe("VersionOpenTelemetry");
    expect(version.find("button").exists()).toBe(false);
  });

  it("opens the repair form in place under the row it was changed from", async () => {
    const flow = flowWith({
      questions: [answeredWith({ to: "kube_pod_info" })],
      bindings: [binding("k8s_cluster", "cluster_name")],
    });
    const wrapper = render(flow);
    expect(has(wrapper, "starter-pack-repair-form")).toBe(false);
    await wrapper.get('[data-test="starter-pack-adapted-change-btn"]').trigger("click");
    const stream = wrapper.get('[data-test="starter-pack-adapted-stream"]');
    expect(stream.element.nextElementSibling?.getAttribute("data-test")).toBe(
      "starter-pack-repair-form",
    );
    await wrapper.get('[data-test="starter-pack-adapted-field-change-btn"]').trigger("click");
    expect(wrapper.findAll('[data-test="starter-pack-repair-form"]')).toHaveLength(1);
    const field = wrapper.get('[data-test="starter-pack-adapted-field"]');
    expect(field.element.nextElementSibling?.getAttribute("data-test")).toBe(
      "starter-pack-repair-form",
    );
    expect(has(wrapper, "starter-pack-repair-field-select")).toBe(true);
  });

  it("scrolls the opened form into view so its buttons are reachable", async () => {
    const original = Element.prototype.scrollIntoView;
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = original;
    });
    const wrapper = render(flowWith({ bindings: [binding("k8s_cluster", "cluster_name")] }));
    await wrapper.get('[data-test="starter-pack-adapted-field-change-btn"]').trigger("click");
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(scroll.mock.instances[0]).toBe(
      wrapper.get('[data-test="starter-pack-repair-form"]').element,
    );
  });

  it("closes the form on Cancel and on a second Change", async () => {
    const flow = flowWith({ bindings: [binding("k8s_cluster", "cluster_name")] });
    const wrapper = render(flow);
    const change = wrapper.get('[data-test="starter-pack-adapted-field-change-btn"]');
    await change.trigger("click");
    await wrapper.get('[data-test="starter-pack-repair-cancel-btn"]').trigger("click");
    expect(has(wrapper, "starter-pack-repair-form")).toBe(false);
    await change.trigger("click");
    await change.trigger("click");
    expect(has(wrapper, "starter-pack-repair-form")).toBe(false);
    expect(flow.chooseField).not.toHaveBeenCalled();
  });

  it("titles the repair form with the same words as the row it opens from", async () => {
    const flow = flowWith({
      questions: [
        { want: "kube_node_status_allocatable", kind: "confirm", candidates: [] },
        { want: "k8s_events", kind: "none", titleKey: events, candidates: [] },
      ],
    });
    const titles = [];
    for (const index of [0, 1]) {
      const wrapper = render(flow);
      await wrapper
        .findAll('[data-test="starter-pack-adapted-choose-btn"]')
        [index].trigger("click");
      titles.push(wrapper.get('[data-test="starter-pack-repair-title"]').text());
    }
    expect(titles).toEqual([
      "0 streams look like kube_node_status_allocatable",
      "No Kubernetes events found",
    ]);
  });

  it("hides Choose and Change when read-only", () => {
    const flow = flowWith({
      questions: [
        answeredWith({ to: "kube_pod_info" }),
        { want: "k8s_events", kind: "none", titleKey: events, candidates: [] },
      ],
      bindings: [binding("k8s_cluster", "cluster_name")],
    });
    const wrapper = render(flow, true);
    expect(has(wrapper, "starter-pack-adapted-question")).toBe(true);
    expect(wrapper.find("button").exists()).toBe(false);
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
    expect(wrapper.text()).toContain("Which stream is Kubernetes events?");
    expect(wrapper.text()).toContain("2 look right");
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
