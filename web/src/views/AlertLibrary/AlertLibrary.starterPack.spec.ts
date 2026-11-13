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
import { createRouter, createWebHistory } from "vue-router";
import { ref } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const entry = (id: string) => ({
  id,
  name: id,
  pack: "k8s",
  category: "cluster",
  title: id,
  severity: "warning",
  description: "",
  stream: "kube_pod",
  stream_type: "metrics",
  query_type: "promql",
  required_streams: ["kube_pod"],
  path: id,
  content_hash: id,
});

const fake = vi.hoisted(() => ({
  fail: false,
  verdicts: new Map<string, boolean>(),
  held: [] as Array<(value: Map<string, boolean>) => void>,
  hold: false,
}));

vi.mock("@/constants/starterPacks", () => ({ STARTER_PACKS_ENABLED: true }));
vi.mock("@/composables/starterPacks/packMatchData", () => ({
  ingestTimes: () => ({}),
  matchAlerts: async () => {
    if (fake.fail) throw new Error("down");
    if (fake.hold) return new Promise((resolve) => fake.held.push(resolve));
    return fake.verdicts;
  },
}));
vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: async () => ({ list: [{ name: "kube_pod", stream_type: "metrics" }] }),
  }),
}));
vi.mock("@/composables/alerts/useAlertLibrary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/alerts/useAlertLibrary")>()),
  useAlertLibrary: () => ({
    manifest: ref({ alerts: [entry("k8s/a"), entry("k8s/b")] }),
    isLoading: ref(false),
    error: ref(null),
    loadManifest: async () => {},
    loadAlertFile: async () => ({}),
    isReady: () => true,
  }),
}));

import AlertLibrary from "./AlertLibrary.vue";

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/:path(.*)*", component: { template: "<div />" } }],
});

const render = async () => {
  const wrapper = mount(AlertLibrary, {
    global: {
      provide: { store },
      plugins: [i18n, router],
    },
  });
  await flushPromises();
  return wrapper;
};
const ready = (wrapper: Awaited<ReturnType<typeof render>>) =>
  wrapper.get('[data-test="alert-library-stat-ready"]').text();

describe("AlertLibrary with Starter Packs on", () => {
  it("counts Ready to use from the shared matcher", async () => {
    fake.fail = false;
    fake.verdicts = new Map([
      ["k8s/a", true],
      ["k8s/b", false],
    ]);
    expect(ready(await render())).toContain("1");
  });

  it("falls back to the stream check when the matcher fails", async () => {
    fake.fail = true;
    expect(ready(await render())).toContain("2");
  });

  it("shows the stream verdict while matching, and an older run cannot win", async () => {
    fake.fail = false;
    fake.hold = true;
    fake.held = [];
    const wrapper = await render();
    expect(ready(wrapper)).toContain("2");
    await wrapper.get('[data-test="alert-library-refresh"]').trigger("click");
    await flushPromises();
    const [older, newer] = fake.held;
    newer(
      new Map([
        ["k8s/a", false],
        ["k8s/b", false],
      ]),
    );
    await flushPromises();
    older(
      new Map([
        ["k8s/a", true],
        ["k8s/b", true],
      ]),
    );
    await flushPromises();
    fake.hold = false;
    expect(ready(wrapper)).toContain("0");
  });

  it("keeps alerts only: no Packs or Dashboards tabs and no Find more", async () => {
    const wrapper = await render();
    expect(wrapper.find('[data-test="alert-section-tabs"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="alert-library-tabs"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="alert-library-toolbar"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="starter-pack-find-more-btn"]').exists()).toBe(false);
  });
});
