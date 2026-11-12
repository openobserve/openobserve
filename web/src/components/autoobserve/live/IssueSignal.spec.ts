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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import { b64DecodeUnicode } from "@/utils/zincutils";
import AoSparkline from "./AoSparkline.vue";
import IssueSignal from "./IssueSignal.vue";
import type { IssueStreamInfo } from "./issueModel";

const api = vi.hoisted(() => ({ fetch: vi.fn(), cancel: vi.fn() }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...args: unknown[]) => api.fetch(...args),
    cancelStreamQueryBasedOnRequestId: (...args: unknown[]) => api.cancel(...args),
  }),
}));

const vol = vi.hoisted(() => ({ streams: vi.fn() }));
vi.mock("@/services/autoobserveVolume", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: { streams: (...args: unknown[]) => vol.streams(...args) },
}));

type Handlers = {
  data: (p: unknown, r: unknown) => void;
  error: (p: unknown, r: unknown) => void;
  complete: (p: unknown, r: unknown) => void;
};
type Call = [
  {
    queryReq: { query: { sql: string; start_time: number; end_time: number } };
    pageType: string;
  },
  Handlers,
];

const NOW = Date.UTC(2026, 10, 10, 18, 0);
const T0 = Date.UTC(2026, 10, 10, 16, 45);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
const calls = () => api.fetch.mock.calls as unknown as Call[];

const lead: IssueStreamInfo = {
  type: "logs",
  name: "pay_api",
  firstSeenUs: T0 * 1000,
  recoveredUs: null,
  lead: true,
};

const originalOrg = store.state.selectedOrganization;
let wrappers: ReturnType<typeof mount>[] = [];

const mountSignal = (props: Record<string, unknown> = {}) => {
  const w = mount(IssueSignal, {
    props: { stream: lead, active: true, ...props },
    global: { plugins: [i18n, store] },
  });
  wrappers.push(w);
  return w;
};

const answer = (call: Call, hits: Record<string, unknown>[]) => {
  call[1].data(null, { type: "search_response_hits", content: { results: { hits } } });
  call[1].complete(null, {});
};

const sel = (name: string) => `[data-test="${name}"]`;

describe("IssueSignal", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    api.fetch.mockReset();
    vol.streams.mockReset();
    vol.streams.mockRejectedValue({ response: { status: 404 } });
    queryClient.clear();
    store.commit("setSelectedOrganization", { ...originalOrg, identifier: "demo-org" });
  });

  afterEach(() => {
    for (const w of wrappers) w.unmount();
    wrappers = [];
    vi.useRealTimers();
    store.commit("setSelectedOrganization", originalOrg);
  });

  it("counts the stream's rows per 15 minutes over the incident window through _search_stream", async () => {
    mountSignal();
    await flushPromises();
    expect(calls()).toHaveLength(1);
    const [req] = calls()[0];
    expect(req.pageType).toBe("logs");
    expect(b64DecodeUnicode(req.queryReq.query.sql)).toBe(
      `SELECT histogram(_timestamp, '15 minute') AS t, count(*) AS n FROM "pay_api" GROUP BY t ORDER BY t`,
    );
    expect(req.queryReq.query.start_time).toBe((T0 - 6 * 3_600_000) * 1000);
    expect(req.queryReq.query.end_time).toBe(NOW * 1000);
    expect(vol.streams).toHaveBeenCalledWith(
      "demo-org",
      ["logs/pay_api"],
      (T0 - 6 * 3_600_000) * 1000,
      NOW * 1000,
    );
  });

  it("loading shows the skeleton and keeps the caption's line", async () => {
    const w = mountSignal();
    await flushPromises();
    expect(w.find(sel("ao-sparkline-loading")).exists()).toBe(true);
    expect(w.find(sel("autoobserve-issue-signal-caption")).exists()).toBe(true);
  });

  it("ready draws the series with the detection and live marks and a caption with units", async () => {
    const w = mountSignal();
    await flushPromises();
    answer(calls()[0], [
      { t: iso(T0 - 3_600_000), n: 1200 },
      { t: iso(T0 - 900_000), n: 800 },
    ]);
    await flushPromises();
    expect(w.find(sel("ao-sparkline-chart")).exists()).toBe(true);
    expect(w.find(sel("ao-sparkline-marker-detected")).exists()).toBe(true);
    expect(w.find(sel("ao-sparkline-marker-live")).exists()).toBe(true);
    expect(w.get(sel("autoobserve-issue-signal-caption")).text()).toBe(
      "Rows per 15 min · peak 1,200",
    );
    expect(w.get(sel("ao-sparkline-chart")).attributes("aria-label")).toContain(
      "Rows per 15 minutes in pay_api",
    );
  });

  it("a stream with no rows in the window draws zero from detection, marked and captioned", async () => {
    const w = mountSignal();
    await flushPromises();
    answer(calls()[0], []);
    await flushPromises();
    expect(w.find(sel("ao-sparkline-empty")).exists()).toBe(false);
    expect(w.find(sel("ao-sparkline-marker-detected")).exists()).toBe(true);
    const drawn = w.findComponent(AoSparkline).props("series") as { t: number; v: number | null }[];
    expect(drawn.filter((p) => p.t < T0).every((p) => p.v === null)).toBe(true);
    expect(drawn.filter((p) => p.t >= T0).every((p) => p.v === 0)).toBe(true);
    expect(w.get(sel("autoobserve-issue-signal-caption")).text()).toBe("No rows in this window");
  });

  it("a 400 is a red failure whose Retry asks again", async () => {
    const w = mountSignal();
    await flushPromises();
    calls()[0][1].error(null, { content: { status: 400 } });
    await flushPromises();
    expect(w.get(sel("ao-sparkline-error")).text()).toContain("Couldn't load the chart");
    await w.get(sel("ao-sparkline-retry")).trigger("click");
    await flushPromises();
    expect(calls()).toHaveLength(2);
  });

  it("a 403 names the missing permission and offers no Retry, which could not help", async () => {
    const w = mountSignal();
    await flushPromises();
    calls()[0][1].error(null, { content: { status: 403 } });
    await flushPromises();
    expect(w.get(sel("ao-sparkline-error")).text()).toContain(
      "You don't have permission to read pay_api",
    );
    expect(w.find(sel("ao-sparkline-retry")).exists()).toBe(false);
  });

  it("the list row, the drawer chart and the Unfold card share one query per stream", async () => {
    mountSignal();
    mountSignal({ size: "card", anchorUs: T0 * 1000 });
    await flushPromises();
    expect(calls()).toHaveLength(1);
    expect(vol.streams).toHaveBeenCalledTimes(1);
  });

  it("the card size titles the chart, labels the peak and both ends of the time axis, and keys its marks", async () => {
    const w = mountSignal({ size: "card", active: false });
    await flushPromises();
    answer(calls()[0], [{ t: iso(T0 - 900_000), n: 800 }]);
    await flushPromises();
    expect(w.get(sel("autoobserve-issue-signal-title")).text()).toContain(
      "Rows per 15 minutes in pay_api",
    );
    expect(w.get(sel("autoobserve-issue-signal-title")).text()).toContain("Peak 800 rows");
    const axis = w.get(sel("autoobserve-issue-signal-xaxis")).findAll("span");
    expect(axis.map((a) => a.text())).toEqual(["10:45 AM", "6:00 PM"]);
    expect(w.get(sel("autoobserve-issue-signal-legend")).text()).toContain("Detected at");
    expect(w.find(sel("ao-sparkline-marker-live")).exists()).toBe(false);
  });

  it.each([
    ["ended earlier that day", { active: false, endUs: (T0 + 900_000) * 1000 }, "6:00 PM"],
    ["still open two days on", { active: true }, "Nov 12, 2026, 6:00 PM"],
  ])(
    "a window seen two days later, %s, dates the start and the end only on a new day",
    async (_, props, end) => {
      vi.setSystemTime(NOW + 2 * 86_400_000);
      const w = mountSignal({ size: "card", ...props });
      await flushPromises();
      answer(calls()[0], [{ t: iso(T0 - 900_000), n: 800 }]);
      await flushPromises();
      const axis = w.get(sel("autoobserve-issue-signal-xaxis")).findAll("span");
      expect(axis.map((a) => a.text())).toEqual(["Nov 10, 2026, 10:45 AM", end]);
    },
  );

  it("says when no row was stored before it started, and draws no line there", async () => {
    vi.setSystemTime(NOW);
    const w = mountSignal({ size: "card" });
    await flushPromises();
    answer(calls()[0], [{ t: iso(T0 + 900_000), n: 50 }]);
    await flushPromises();
    expect(w.get(sel("autoobserve-issue-signal-no-before")).text()).toContain("pay_api");
    const points = w.findComponent({ name: "AoSparkline" }).props("series") as {
      v: number | null;
    }[];
    expect(points[0].v).toBeNull();
    expect(points.filter((p) => p.v === 0).length).toBeGreaterThan(0);
  });

  const volumeOk = (over: Record<string, unknown> = {}) => ({
    data: {
      series: [
        {
          stream_type: "logs",
          stream_name: "pay_api",
          width_secs: 900,
          status: "volume",
          rows_per_day: 1000,
          exact: true,
          days: [],
          buckets: [T0 - 900_000, T0].map((ms) => ({
            t: ms * 1000,
            actual: 800,
            expected: 1000,
            lower: 700,
            upper: 1300,
            expected_present: true,
            class: ms === T0 ? "low" : "normal",
          })),
          forecast: [],
          markers: [],
          ...over,
        },
      ],
      denied: [],
    },
  });

  it.each([
    [
      "no route (404) draws the rows only, with a neutral note, and is asked once per window",
      "404",
      false,
      false,
    ],
    ["a 405 reads the same as no route", "405", false, false],
    [
      "a volume series draws the usual line, its range and the judged buckets, keyed",
      "volume",
      true,
      false,
    ],
    ["a failed read keeps the rows and says so in red, with Retry", "500", false, true],
  ])("%s", async (_name, answerKind, drawn, red) => {
    if (answerKind === "volume") vol.streams.mockResolvedValue(volumeOk());
    else vol.streams.mockRejectedValue({ response: { status: Number(answerKind) } });
    const w = mountSignal({ size: "card" });
    await flushPromises();
    answer(calls()[0], [{ t: iso(T0 - 900_000), n: 800 }]);
    await flushPromises();
    expect(w.find(sel("ao-sparkline-chart")).exists()).toBe(true);
    expect(w.find(sel("ao-sparkline-expected")).exists()).toBe(drawn);
    expect(w.find(sel("ao-sparkline-band")).exists()).toBe(drawn);
    expect(w.find(sel("ao-sparkline-highlight")).exists()).toBe(drawn);
    expect(w.find(sel("autoobserve-issue-signal-key-expected")).exists()).toBe(drawn);
    const note = w.find(sel("autoobserve-issue-signal-usual"));
    expect(note.exists()).toBe(!drawn);
    expect(note.exists() && note.attributes("role") === "alert").toBe(red);
    if (red) {
      await w.get(sel("autoobserve-issue-signal-usual-retry")).trigger("click");
      await flushPromises();
      expect(vol.streams).toHaveBeenCalledTimes(2);
    } else {
      mountSignal({ size: "card" });
      await flushPromises();
      expect(vol.streams).toHaveBeenCalledTimes(1);
    }
  });
});
