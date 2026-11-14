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
import { ref, shallowRef } from "vue";

import i18n from "@/locales";
import { staleSinceText } from "@/composables/starterPacks/usePackHealth";

import StarterPackDetailsDrawer from "./StarterPackDetailsDrawer.vue";
import { fakeFlow } from "./starterPackTestFlow";

const push = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));

const t = i18n.global.t as (...args: unknown[]) => string;
const items = [
  { kind: "folder", itemId: "f", status: "created", id: "folder-1" },
  { kind: "dashboard", itemId: "d1", status: "created" },
  { kind: "alert", itemId: "a1", status: "failed" },
];

const render = (props: Record<string, unknown> = {}) =>
  mount(StarterPackDetailsDrawer, {
    props: {
      open: true,
      org: "org",
      flow: fakeFlow({
        record: shallowRef({ items, installedBy: "a@example.com", version: "1" }),
        items: ref(items.slice(1)),
        made: ref(items.slice(1, 2)),
      }),
      clusters: ["staging-eu-1", "staging-us-2"],
      streams: [
        { name: "k8s_events", type: "logs" },
        { name: "k8s_pod_phase", type: "metrics" },
      ],
      staleSince: null,
      queriesPerDay: 288,
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        ODrawer: { props: ["open"], template: "<div v-if='open'><slot /></div>" },
        StarterPackAdaptedRows: true,
        OIcon: true,
      },
    },
  });
const all = (wrapper: any, id: string) =>
  wrapper.findAll(`[data-test="${id}"]`).map((node: any) => node.text());

describe("StarterPackDetailsDrawer", () => {
  beforeEach(() => push.mockClear());

  it("lists each data source and each stream with its type", () => {
    const wrapper = render();
    expect(all(wrapper, "starter-pack-details-source")).toEqual(["staging-eu-1", "staging-us-2"]);
    expect(all(wrapper, "starter-pack-details-stream")).toEqual([
      `k8s_events${t("starterPacks.packDetails.type.logs")}`,
      `k8s_pod_phase${t("starterPacks.packDetails.type.metrics")}`,
    ]);
  });

  it("shows no type for a stream whose type is unknown", () => {
    const wrapper = render({ streams: [{ name: "k8s_events", type: "" }] });
    expect(all(wrapper, "starter-pack-details-stream")).toEqual(["k8s_events"]);
  });

  it("says when data stopped and links the collector", () => {
    const at = Date.UTC(2026, 10, 12, 9, 40, 55) * 1000;
    const wrapper = render({ staleSince: at });
    const stale = wrapper.get('[data-test="starter-pack-details-stale"]').text();
    expect(stale).toContain(staleSinceText(at));
    expect(stale).not.toContain("2026");
    expect(wrapper.find('[data-test="starter-pack-page-check-collector-link"]').exists()).toBe(
      true,
    );
  });

  it("opens Streams", async () => {
    await render().get('[data-test="starter-pack-details-open-streams-btn"]').trigger("click");
    expect(push).toHaveBeenCalledWith({ name: "logstreams", query: { org_identifier: "org" } });
  });

  it("keeps the former page cards as sections", () => {
    const wrapper = render();
    for (const id of ["views", "adapted", "access", "cost"]) {
      expect(wrapper.find(`[data-test="starter-pack-page-section-${id}"]`).exists()).toBe(true);
    }
    expect(wrapper.get('[data-test="starter-pack-details-installer"]').text()).toContain(
      "a@example.com",
    );
  });

  it("groups items by type and marks the ones that failed", () => {
    const wrapper = render();
    expect(wrapper.find('[data-test="starter-pack-page-group-dashboard"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="starter-pack-page-item-failed"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="starter-pack-page-views-meta"]').text()).toContain("1 of 2");
  });

  it("manages access on the pack folder", async () => {
    await render().get('[data-test="starter-pack-page-access-btn"]').trigger("click");
    expect(push).toHaveBeenCalledWith({
      name: "alertList",
      query: { org_identifier: "org", folder: "folder-1" },
    });
  });
});
