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
import { computed, defineComponent } from "vue";
import { createStore } from "vuex";

import type { AlertLibraryEntry } from "@/types/alertLibrary";

const streams = vi.hoisted(() => ({ list: vi.fn() }));
const evaluate = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useStreams", () => ({
  default: () => ({ getStreams: streams.list }),
}));
vi.mock("@/services/alerts", () => ({ default: { evaluate } }));

import { orderRows, selectAllNext, useLibraryDryRun, useLibraryReadiness } from "./libraryPaneData";

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

const libraryStore = (cached: object | null) =>
  createStore({
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
  ])("counts $name", async ({ cached, list, count }) => {
    streams.list.mockReturnValue(
      list
        ? Promise.resolve({ list: list.map((name) => ({ name, stream_type: "logs" })) })
        : new Promise(() => undefined),
    );
    let readiness!: ReturnType<typeof useLibraryReadiness>;
    mount(
      defineComponent({
        setup: () => {
          readiness = useLibraryReadiness(() => "scheduled");
          readiness.load();
          return () => null;
        },
      }),
      { global: { plugins: [libraryStore(cached)] } },
    );
    await flushPromises();
    expect(readiness.count.value).toBe(count);
  });

  it("gives up on a dry run that never answers, so its row stops loading", async () => {
    vi.useFakeTimers();
    evaluate.mockImplementation(
      (_org, _body, _folder, signal: AbortSignal) =>
        new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("x")))),
    );
    let run!: ReturnType<typeof useLibraryDryRun>;
    const store = createStore({ state: {} });
    mount(
      defineComponent({
        setup: () => {
          run = useLibraryDryRun(computed(() => "org1"));
          return () => null;
        },
      }),
      { global: { plugins: [store] } },
    );
    run.request("k", async () => ({}) as never);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run.verdicts.value.k).toEqual({ state: "failed", reason: null });
    vi.useRealTimers();
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
