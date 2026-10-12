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
import { effectScope, nextTick, reactive, ref, type EffectScope } from "vue";
import { flushPromises } from "@vue/test-utils";
import { queryClient } from "@/composables/query/queryClient";
import {
  firstDataStorageKey,
  markDetectionSeen,
  readFirstDataRecord,
  useFirstDataNotice,
  writeFirstDataRecord,
  type ListedStream,
  type OrgStreamList,
} from "./useFirstDataNotice";
import analytics from "@/services/product_analytics";

const rows: Record<string, ListedStream[]> = { logs: [], metrics: [], traces: [] };
const nameList = vi.fn(
  async (_org: string, type: string, _schema: boolean, offset = -1, limit = -1) => {
    const all = rows[type] ?? [];
    const list = offset === -1 ? all : all.slice(offset, offset + limit);
    return { data: { list: list.map((r) => ({ stream_type: type, ...r })), total: all.length } };
  },
);
vi.mock("@/services/stream", () => ({
  default: { nameList: (...a: Parameters<typeof nameList>) => nameList(...a) },
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
const push = vi.fn(() => Promise.resolve());
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
const zoConfig = reactive<Record<string, unknown>>({});
vi.mock("vuex", () => ({ useStore: () => ({ state: { zoConfig } }) }));

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const HOUR_US = 3_600_000_000;
const ORG = "acme";

let scope: EffectScope;
const noticeOf = (layout?: OrgStreamList, org = ref(ORG)) => {
  const layoutStreams = ref<OrgStreamList | undefined>(layout);
  scope = effectScope();
  const notice = scope.run(() => useFirstDataNotice(org, layoutStreams))!;
  return { notice, layoutStreams };
};
const userStream = (name: string, createdAtUs: number, type = "logs"): ListedStream => ({
  name,
  stream_type: type,
  stats: { created_at: createdAtUs, doc_time_min: createdAtUs + 1 },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  rows.logs = [];
  rows.metrics = [];
  rows.traces = [];
  for (const k of Object.keys(zoConfig)) delete zoConfig[k];
  zoConfig.version = "test";
  zoConfig.restricted_routes_on_empty_data = false;
});

afterEach(() => {
  scope?.stop();
  queryClient.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useFirstDataNotice", () => {
  it("records the first visit without a banner", async () => {
    rows.logs = [userStream("default", NOW * 1000 - HOUR_US)];
    const { notice } = noticeOf();
    await flushPromises();
    expect(notice.visible.value).toBe(false);
    expect(readFirstDataRecord(ORG)).toMatchObject({ hadData: true, lastVisit: NOW });
  });

  it("sends no request at all once a visit has seen data", async () => {
    writeFirstDataRecord(ORG, { lastVisit: 1, hadData: true });
    const { notice } = noticeOf();
    await flushPromises();
    expect(nameList).not.toHaveBeenCalled();
    expect(notice.visible.value).toBe(false);
    expect(readFirstDataRecord(ORG)?.lastVisit).toBe(NOW);
  });

  it("shows the banner after a visit with no data, from the oldest user stream, and fires RUM once", async () => {
    writeFirstDataRecord(ORG, { lastVisit: 1, hadData: false });
    rows.logs = [
      userStream("usage", NOW * 1000 - 9 * HOUR_US),
      userStream("later", NOW * 1000 - HOUR_US),
      userStream("first", NOW * 1000 - 2 * HOUR_US),
    ];
    rows.logs[0].stats = { created_at: NOW * 1000 - 9 * HOUR_US };
    const { notice } = noticeOf();
    await flushPromises();
    expect(notice.visible.value).toBe(true);
    expect(notice.stream.value?.name).toBe("first");
    expect(notice.arrivedAt.value).toBe(NOW * 1000 - 2 * HOUR_US);
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith("first_data_notice_shown", {
      stream_type: "logs",
    });
    expect(readFirstDataRecord(ORG)).toMatchObject({ hadData: true, shown: true });
  });

  it("dates a back-dated first batch no earlier than the visit that saw no data", async () => {
    const lastVisit = NOW - 10 * 60_000;
    writeFirstDataRecord(ORG, { lastVisit, hadData: false });
    rows.logs = [
      { name: "app_logs", stats: { created_at: NOW * 1000 - HOUR_US, doc_time_min: 0 } },
    ];
    const { notice } = noticeOf();
    await flushPromises();
    expect(notice.visible.value).toBe(true);
    expect(notice.arrivedAt.value).toBe(lastVisit * 1000);
  });

  it("never dates the arrival after now for a future-dated first batch", async () => {
    writeFirstDataRecord(ORG, { lastVisit: NOW - HOUR_US / 1000, hadData: false });
    rows.logs = [{ name: "app_logs", stats: { created_at: NOW * 1000 + HOUR_US } }];
    const { notice } = noticeOf();
    await flushPromises();
    expect(notice.arrivedAt.value).toBe(NOW * 1000);
  });

  it("opens from the stream's created_at to now while doc_time_min is not flushed yet", async () => {
    writeFirstDataRecord(ORG, { lastVisit: NOW - 10 * 60_000, hadData: false });
    const createdAt = NOW * 1000 - HOUR_US;
    rows.logs = [{ name: "app_logs", stats: { created_at: createdAt, doc_time_min: 0 } }];
    const { notice } = noticeOf();
    await flushPromises();
    notice.open();
    expect(push).toHaveBeenCalledWith({
      name: "logs",
      query: {
        org_identifier: ORG,
        stream: "app_logs",
        stream_type: "logs",
        from: String(createdAt - 900_000_000),
        to: String(NOW * 1000),
      },
    });
  });

  it("bounds the flag-off source to three limit-1 probes and 20-row pages", async () => {
    writeFirstDataRecord(ORG, { lastVisit: 1, hadData: false });
    rows.metrics = [
      ...Array.from({ length: 30 }, (_, i) => ({ name: `_o2_internal_${i}`, stats: {} })),
      userStream("cpu", NOW * 1000 - HOUR_US, "metrics"),
    ];
    noticeOf();
    await flushPromises();
    const calls = nameList.mock.calls;
    expect(calls.filter((c) => c[4] === 1)).toHaveLength(3);
    expect(calls.every((c) => c[4] === 1 || c[4] === 20)).toBe(true);
    expect(calls.filter((c) => c[1] === "metrics" && c[4] === 20).map((c) => c[3])).toEqual([
      0, 20,
    ]);
  });

  it("sends no flag-off probes while only the bootstrap config is in, then follows the flag-on path", async () => {
    delete zoConfig.restricted_routes_on_empty_data;
    writeFirstDataRecord(ORG, { lastVisit: 1, hadData: false });
    rows.logs = [userStream("default", NOW * 1000 - HOUR_US)];
    const { notice, layoutStreams } = noticeOf();
    await flushPromises();
    expect(nameList).not.toHaveBeenCalled();
    expect(notice.visible.value).toBe(false);
    zoConfig.restricted_routes_on_empty_data = true;
    await nextTick();
    await flushPromises();
    expect(nameList).not.toHaveBeenCalled();
    layoutStreams.value = { org: ORG, list: [userStream("default", NOW * 1000 - HOUR_US)] };
    await nextTick();
    await flushPromises();
    expect(notice.visible.value).toBe(true);
    expect(nameList).not.toHaveBeenCalled();
  });

  it("reuses MainLayout's list with the flag on and sends nothing of its own", async () => {
    zoConfig.restricted_routes_on_empty_data = true;
    writeFirstDataRecord(ORG, { lastVisit: 1, hadData: false });
    const { notice, layoutStreams } = noticeOf();
    await flushPromises();
    expect(notice.visible.value).toBe(false);
    layoutStreams.value = { org: ORG, list: [userStream("default", NOW * 1000 - HOUR_US)] };
    await nextTick();
    await flushPromises();
    expect(notice.visible.value).toBe(true);
    expect(nameList).not.toHaveBeenCalled();
  });

  it("never reads the previous org's list after an org switch, and evaluates the new org's own list", async () => {
    zoConfig.restricted_routes_on_empty_data = true;
    const EMPTY = "empty_org";
    writeFirstDataRecord(EMPTY, { lastVisit: 1, hadData: false });
    const org = ref(ORG);
    const { notice, layoutStreams } = noticeOf(
      { org: ORG, list: [userStream("default", NOW * 1000 - HOUR_US)] },
      org,
    );
    await flushPromises();
    org.value = EMPTY;
    await nextTick();
    await flushPromises();
    expect(notice.visible.value).toBe(false);
    expect(readFirstDataRecord(EMPTY)).toEqual({ lastVisit: 1, hadData: false });
    expect(analytics.track).not.toHaveBeenCalled();
    layoutStreams.value = { org: EMPTY, list: [] };
    await nextTick();
    await flushPromises();
    expect(notice.visible.value).toBe(false);
    expect(readFirstDataRecord(EMPTY)).toMatchObject({ hadData: false, lastVisit: NOW });
  });

  it("never shows twice in one browser", async () => {
    writeFirstDataRecord(ORG, { lastVisit: 1, hadData: false, shown: true });
    rows.logs = [userStream("default", NOW * 1000 - HOUR_US)];
    const { notice } = noticeOf();
    await flushPromises();
    expect(notice.visible.value).toBe(false);
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("stays away when the green bar was seen in this browser", async () => {
    writeFirstDataRecord(ORG, { lastVisit: 1, hadData: false });
    markDetectionSeen(ORG);
    rows.logs = [userStream("default", NOW * 1000 - HOUR_US)];
    const { notice } = noticeOf();
    await flushPromises();
    expect(notice.visible.value).toBe(false);
    expect(readFirstDataRecord(ORG)?.hadData).toBe(true);
  });

  it("stores the dismissal and opens Logs around the first record", async () => {
    writeFirstDataRecord(ORG, { lastVisit: 1, hadData: false });
    rows.logs = [userStream("default", NOW * 1000 - HOUR_US)];
    const { notice } = noticeOf();
    await flushPromises();
    notice.open();
    const docMin = NOW * 1000 - HOUR_US + 1;
    expect(push).toHaveBeenCalledWith({
      name: "logs",
      query: {
        org_identifier: ORG,
        stream: "default",
        stream_type: "logs",
        from: String(docMin - 900_000_000),
        to: String(docMin + 900_000_000),
      },
    });
    notice.dismiss();
    expect(JSON.parse(localStorage.getItem(firstDataStorageKey(ORG))!)).toMatchObject({
      dismissed: true,
    });
  });
});
