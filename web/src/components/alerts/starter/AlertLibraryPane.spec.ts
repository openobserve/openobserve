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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import { createStore } from "vuex";

import type { AlertLibraryEntry } from "@/types/alertLibrary";

const streams = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: streams.list }),
}));
vi.mock("@/components/create-starter/useStartPreference", () => ({
  useStartPreference: () => ({ recordUse: vi.fn() }),
}));
vi.mock("./StarterScopeSelect.vue", () => ({ default: { template: "<div />" } }));
vi.mock("./libraryPaneData", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./libraryPaneData")>()),
  useStarterScopeOptions: () => ({ optionFor: () => null, groups: ref([]) }),
  useLibraryDryRun: () => ({ verdicts: ref({}), request: vi.fn() }),
}));

import AlertLibraryPane from "./AlertLibraryPane.vue";
import { orderRows, selectAllNext } from "./libraryPaneData";

const entry = (id: string, stream: string, severity = "warning", title = id) =>
  ({
    id,
    title,
    severity,
    stream,
    stream_type: "logs",
    pack: "apm",
    required_streams: [stream],
    content_hash: "h",
    path: `${id}.json`,
  }) as unknown as AlertLibraryEntry;

const manifest = {
  format_version: "1.0",
  alert_count: 3,
  packs: [],
  alerts: [entry("apm/a", "app"), entry("apm/b", "app"), entry("apm/c", "missing")],
};

const render = (cached: object | null) => {
  const store = createStore({
    state: {
      selectedOrganization: { identifier: "org1" },
      zoConfig: {},
      alertLibrary: {
        manifest: cached,
        lastFetched: cached ? Date.now() : null,
        cacheExpiry: 1e9,
        fileCache: {},
      },
    },
    mutations: { setAlertLibraryManifest: () => undefined },
  });
  return mount(AlertLibraryPane, {
    props: { alertType: "scheduled", selected: [] },
    global: { plugins: [store] },
  });
};

describe("AlertLibraryPane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
  });

  it.each([
    { name: "the ready total once readiness is known", cached: manifest, list: ["app"], count: 2 },
    { name: "0 when nothing matches", cached: manifest, list: ["other"], count: 0 },
    { name: "no count when the catalogue is down", cached: null, list: ["app"], count: null },
    { name: "no count while the streams load", cached: manifest, list: null, count: null },
  ])("emits $name", async ({ cached, list, count }) => {
    streams.list.mockReturnValue(
      list
        ? Promise.resolve({ list: list.map((name) => ({ name, stream_type: "logs" })) })
        : new Promise(() => undefined),
    );
    const w = render(cached);
    await flushPromises();
    expect(w.emitted("count")?.at(-1)).toEqual([count]);
  });

  it("puts the alerts the org already runs last, hottest first otherwise", () => {
    const rows = [
      entry("w", "s", "warning", "a"),
      entry("mine", "s", "critical", "b"),
      entry("c", "s", "critical", "c"),
    ];
    expect(orderRows(rows, { mine: [{}] })).toEqual(["c", "w", "mine"]);
  });

  it.each([
    {
      name: "ticks every row in view, keeping a pick from elsewhere",
      from: ["x", "a"],
      to: ["x", "a", "b"],
    },
    { name: "unticks the view once all of it is ticked", from: ["x", "a", "b"], to: ["x"] },
  ])("select all $name", ({ from, to }) => {
    expect(selectAllNext(from, ["a", "b"])).toEqual(to);
  });
});
