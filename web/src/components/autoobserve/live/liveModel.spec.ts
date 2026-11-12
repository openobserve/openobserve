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
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import autoobserve, {
  type AutoObserveCoverage,
  type AutoObserveIncidentItem,
  type AutoObserveIncidentList,
} from "@/services/autoobserve";
import fixture from "./__fixtures__/autoobserveIncidents.json";
import { fixtureAllowed, keepLatched, useLiveAutoObserve, useLiveMode } from "./liveModel";
import { queryClient } from "@/composables/query/queryClient";
import {
  serviceKeyOf,
  useRecentlyCreated,
} from "@/components/autoobserve/insight/bulk/useRecentlyCreated";

const routeQuery: Record<string, string> = { live: "1" };

vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRoute: () => ({ query: routeQuery }),
}));

vi.mock("@/services/autoobserve", () => ({
  default: { coverage: vi.fn(), suggestions: vi.fn() },
}));

const START = Date.UTC(2026, 10, 2, 10, 0);

const cell = (state: string) => ({ state, evidence: [], counts: {} });

const coverage = (): AutoObserveCoverage =>
  ({
    view: "strict",
    pass_at: START * 1000,
    refreshed_at: null,
    quality: null,
    classes: [],
    rows: [
      {
        service_id: "api",
        service_name: "api",
        cluster: "prod",
        namespace: "shop",
        streams: [],
        cells: { errors: cell("covered"), latency: cell("none"), absence: cell("none") },
      },
    ],
  }) as unknown as AutoObserveCoverage;

const Harness = defineComponent({
  setup() {
    const { source } = useLiveAutoObserve();
    return () => h("span", { "data-test": "age" }, String(source.value.rows[0]?.lastScanned ?? ""));
  },
});

describe("useLiveAutoObserve", () => {
  afterEach(() => vi.useRealTimers());

  it("ages Last checked while the page stays open on the same data", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(START);
    vi.mocked(autoobserve.coverage).mockResolvedValue({ data: coverage() } as never);
    vi.mocked(autoobserve.suggestions).mockResolvedValue({
      data: { suggestions: [], total: 0, limit: 5, offset: 0 },
    } as never);
    const wrapper = mount(Harness, { global: { plugins: [i18n, store] } });
    await flushPromises();
    expect(wrapper.text()).toBe("just now");
    vi.advanceTimersByTime(2 * 60 * 60_000);
    await nextTick();
    expect(wrapper.text()).toBe("2 hours ago");
  });
});

describe("useLiveAutoObserve on a page that shows none of it (T3-N7)", () => {
  it("reads no coverage or suggestions while the page is inactive", async () => {
    queryClient.clear();
    vi.mocked(autoobserve.coverage).mockClear();
    vi.mocked(autoobserve.suggestions).mockClear();
    const Inactive = defineComponent({
      setup() {
        useLiveAutoObserve({ active: () => false });
        return () => h("span");
      },
    });
    const wrapper = mount(Inactive, { global: { plugins: [i18n, store] } });
    await flushPromises();
    expect(autoobserve.coverage).not.toHaveBeenCalled();
    expect(autoobserve.suggestions).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});

describe("useLiveAutoObserve follows each pass (T2-4, COVERAGE-AFTER-ADD)", () => {
  const recently = useRecentlyCreated();
  afterEach(() => {
    vi.useRealTimers();
    recently.clearOnPass("default", Number.MAX_SAFE_INTEGER);
    queryClient.clear();
  });
  const start = () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval", "setTimeout"] });
    vi.setSystemTime(START);
    queryClient.clear();
    vi.mocked(autoobserve.coverage)
      .mockReset()
      .mockResolvedValue({ data: coverage() } as never);
    vi.mocked(autoobserve.suggestions).mockResolvedValue({
      data: { suggestions: [], total: 0, limit: 5, offset: 0 },
    } as never);
    return mount(Harness, { global: { plugins: [i18n, store] } });
  };

  it("refetches coverage on the pass cadence, so an open page never shows an old pass", async () => {
    start();
    await flushPromises();
    expect(autoobserve.coverage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(autoobserve.coverage).toHaveBeenCalledTimes(2);
  });

  it("does not poll every minute for an alert added in another org (F4)", async () => {
    recently.add(serviceKeyOf("other-org", "api", "prod", "shop"), "errors", START + 1_000);
    start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(autoobserve.coverage).toHaveBeenCalledTimes(1);
    recently.clearOnPass("other-org", Number.MAX_SAFE_INTEGER);
  });

  it("polls every minute while an alert added here waits, and stops once a newer pass counts it", async () => {
    recently.add(serviceKeyOf("default", "api", "prod", "shop"), "errors", START + 1_000);
    start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(autoobserve.coverage).toHaveBeenCalledTimes(2);
    vi.mocked(autoobserve.coverage).mockResolvedValue({
      data: { ...coverage(), pass_at: (START + 90_000) * 1000 },
    } as never);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(autoobserve.coverage).toHaveBeenCalledTimes(3);
    expect(recently.has(serviceKeyOf("default", "api", "prod", "shop"), "errors")).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(autoobserve.coverage).toHaveBeenCalledTimes(3);
  });
});

describe("useLiveAutoObserve groups the rail from every gap (F8)", () => {
  const gap = (i: number) => ({
    id: `gap-${i}`,
    org: "default",
    kind: "coverage_gap",
    status: "proposed",
    entity_type: "service",
    subject: { kind: "service", key_dims: { service_name: `svc-${i}` } },
    evidence: { service_name: `svc-${i}`, cells: {} },
    score: 1,
    created_at: START * 1000,
  });
  const RailHarness = defineComponent({
    setup() {
      const { rail } = useLiveAutoObserve();
      return () =>
        h(
          "span",
          { "data-test": "rail" },
          rail.value.requests.map((r) => `${r.id}:${r.covers ?? 1}`).join(","),
        );
    },
  });

  it("asks for every proposed gap and folds them into one card the rail counts in full", async () => {
    vi.mocked(autoobserve.coverage).mockResolvedValue({ data: coverage() } as never);
    vi.mocked(autoobserve.suggestions).mockImplementation(async (_org, params) =>
      params.kind === "coverage_gap"
        ? ({
            data: { suggestions: [0, 1, 2, 3, 4, 5, 6].map(gap), total: 7, limit: 7, offset: 0 },
          } as never)
        : ({ data: { suggestions: [gap(0)], total: 12, limit: 5, offset: 0 } } as never),
    );
    const wrapper = mount(RailHarness, { global: { plugins: [i18n, store] } });
    await flushPromises();
    expect(autoobserve.suggestions).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ kind: "coverage_gap", status: "proposed" }),
    );
    expect(wrapper.find('[data-test="rail"]').text()).toBe("coverage_gap-group:7");
  });

  it("reads past the gaps, so a page of gaps can't hide the rail's other cards (W2)", async () => {
    vi.mocked(autoobserve.coverage).mockResolvedValue({ data: coverage() } as never);
    vi.mocked(autoobserve.suggestions).mockResolvedValue({
      data: { suggestions: [gap(0)], total: 1, limit: 5, offset: 0 },
    } as never);
    mount(RailHarness, { global: { plugins: [i18n, store] } });
    await flushPromises();
    const railCall = vi
      .mocked(autoobserve.suggestions)
      .mock.calls.find(([, params]) => params.kind === undefined);
    expect(railCall?.[1].limit).toBeGreaterThanOrEqual(50);
  });

  it("holds the rail as loading until the gaps and coverage it builds the group card from arrive (T5-N6)", async () => {
    let releaseGaps: () => void = () => undefined;
    vi.mocked(autoobserve.coverage).mockResolvedValue({ data: coverage() } as never);
    vi.mocked(autoobserve.suggestions).mockImplementation((_org, params) =>
      params.kind === "coverage_gap"
        ? (new Promise((resolve) => {
            releaseGaps = () =>
              resolve({
                data: { suggestions: [0, 1, 2].map(gap), total: 3, limit: 3, offset: 0 },
              } as never);
          }) as never)
        : (Promise.resolve({
            data: { suggestions: [gap(0)], total: 1, limit: 5, offset: 0 },
          }) as never),
    );
    const StatusHarness = defineComponent({
      setup() {
        const { rail } = useLiveAutoObserve();
        return () => h("span", { "data-test": "status" }, rail.value.status);
      },
    });
    const wrapper = mount(StatusHarness, { global: { plugins: [i18n, store] } });
    await flushPromises();
    expect(wrapper.find('[data-test="status"]').text()).toBe("loading");
    releaseGaps();
    await flushPromises();
    expect(wrapper.find('[data-test="status"]').text()).toBe("ready");
  });

  it("pages past the server's largest page, so a group of 501 gaps reads all 501 (F8)", async () => {
    vi.mocked(autoobserve.coverage).mockResolvedValue({ data: coverage() } as never);
    vi.mocked(autoobserve.suggestions).mockClear();
    vi.mocked(autoobserve.suggestions).mockImplementation(async (_org, params) => {
      if (params.kind !== "coverage_gap")
        return { data: { suggestions: [gap(0)], total: 501, limit: 5, offset: 0 } } as never;
      const from = params.offset ?? 0;
      const ids = Array.from({ length: Math.min(500, 501 - from) }, (_, k) => from + k);
      return { data: { suggestions: ids.map(gap), total: 501, limit: 500, offset: from } } as never;
    });
    const wrapper = mount(RailHarness, { global: { plugins: [i18n, store] } });
    await flushPromises();
    const offsets = vi
      .mocked(autoobserve.suggestions)
      .mock.calls.filter(([, p]) => p.kind === "coverage_gap")
      .map(([, p]) => p.offset);
    expect(offsets).toEqual([0, 500]);
    expect(wrapper.find('[data-test="rail"]').text()).toBe("coverage_gap-group:501");
  });
});

describe("keepLatched", () => {
  const FIXTURE = fixture as unknown as AutoObserveIncidentList;
  const withId = (id: string, title = id): AutoObserveIncidentItem => ({
    ...FIXTURE.items[0],
    finding: { ...FIXTURE.items[0].finding, id },
    incident: { ...FIXTURE.items[0].incident, title },
  });

  it("retains only the latched rows across disjoint refreshes without Show", () => {
    const ids = ["a", "b"];
    let kept = keepLatched(ids, [withId("a"), withId("b")], []);
    for (let n = 0; n < 50; n++)
      kept = keepLatched(
        ids,
        [withId(`new-${n}`), withId(`newer-${n}`), withId(`newest-${n}`)],
        kept,
      );
    expect(kept.map((i) => i.finding.id)).toEqual(["a", "b"]);
    kept = keepLatched(ids, [withId("b", "b again"), withId("c")], kept);
    expect(kept.map((i) => i.incident.title)).toEqual(["a", "b again"]);
    expect(keepLatched([], [withId("a")], kept)).toEqual([]);
  });
});

describe("useLiveMode (LIVE-Q1)", () => {
  const liveWith = (query: Record<string, string>) => {
    for (const key of Object.keys(routeQuery)) delete routeQuery[key];
    Object.assign(routeQuery, query);
    return useLiveMode().value;
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    liveWith({ live: "1" });
  });

  it("is live with no query and with live=1, and off only with fixture=1 in a test build", () => {
    expect(fixtureAllowed()).toBe(true);
    expect(liveWith({})).toBe(true);
    expect(liveWith({ live: "1" })).toBe(true);
    expect(liveWith({ fixture: "0" })).toBe(true);
    expect(liveWith({ fixture: "1" })).toBe(false);
  });

  it("a production bundle never shows fixtures, whatever the URL says", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("MODE", "production");
    expect(fixtureAllowed()).toBe(false);
    expect(liveWith({ fixture: "1" })).toBe(true);
    expect(liveWith({ fixture: "1", live: "0" })).toBe(true);
  });
});
