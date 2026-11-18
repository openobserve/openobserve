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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { ref, type Ref } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { installFakeIntersectionObserver } from "@/test/unit/helpers/intersectionObserverFake";
import { b64DecodeUnicode } from "@/utils/zincutils";
import { ALERT_BACKTEST_SIGNAL_KEY } from "@/composables/alerts/useAlertSuggestions";
import type { BacktestSignal } from "./alertSuggestions";
import AlertBacktest from "./AlertBacktest.vue";

interface StreamHandlers {
  data: (payload: unknown, response: unknown) => void;
  error: () => void;
  complete: () => void;
}

interface StreamCall {
  request: {
    traceId: string;
    queryReq: { query: { sql: string; start_time: number; end_time: number; size: number } };
  };
  handlers: StreamHandlers;
}

const calls: StreamCall[] = [];
const cancelMock = vi.fn();

vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (request: StreamCall["request"], handlers: StreamHandlers) =>
      calls.push({ request, handlers }),
    cancelStreamQueryBasedOnRequestId: cancelMock,
  }),
}));

vi.mock("@/stores", () => ({ default: store }));

const SQL = (stream: string) =>
  `SELECT histogram(_timestamp) AS zo_sql_key, COUNT(*) as zo_sql_val FROM "${stream}" GROUP BY zo_sql_key ORDER BY zo_sql_key ASC`;

const NOW = Date.UTC(2026, 10, 5, 12, 0);
const TRIGGER = { frequency: 5, frequency_type: "minutes", silence: 0 };

const mountBacktest = (
  query = SQL("default"),
  signal: Ref<BacktestSignal | null> = ref(null),
): VueWrapper =>
  mount(AlertBacktest, {
    props: {
      query,
      streamType: "logs",
      period: 10,
      operator: ">=",
      threshold: 5,
      triggerCondition: TRIGGER,
    },
    global: { plugins: [i18n], provide: { [ALERT_BACKTEST_SIGNAL_KEY]: signal } },
  });

const respond = (call: StreamCall, hits: Record<string, unknown>[]) => {
  call.handlers.data(null, { type: "search_response_hits", content: { results: { hits } } });
  call.handlers.complete();
};

const status = (wrapper: VueWrapper) =>
  wrapper.find('[data-test="add-alert-backtest-status"]').text();

describe("AlertBacktest", () => {
  let observer: ReturnType<typeof installFakeIntersectionObserver>;

  beforeEach(() => {
    observer = installFakeIntersectionObserver({ autoVisible: true });
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    calls.length = 0;
    cancelMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    observer.restore();
  });

  it("replays every check of the day in one scan and publishes the signal", async () => {
    const signal = ref<BacktestSignal | null>(null);
    const wrapper = mountBacktest(SQL("default"), signal);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toHaveLength(1);
    const { sql, start_time, end_time, size } = calls[0].request.queryReq.query;
    expect(b64DecodeUnicode(sql)).toContain("histogram(_timestamp, '5 minute')");
    expect(end_time - start_time).toBe((24 * 60 + 10) * 60 * 1000 * 1000);
    expect(size).toBeGreaterThanOrEqual((24 * 60 + 10) / 5);

    respond(calls[0], [{ zo_sql_key: (NOW - 7 * 60_000) * 1000, zo_sql_val: 9 }]);
    await flushPromises();
    expect(wrapper.find('[data-test="add-alert-backtest-result"]').text()).toContain("2 of 288");
    expect(signal.value).toEqual({
      checks: 288,
      alerts: 2,
      singleCheckSpikes: 0,
      refires: 0,
      frequencyMinutes: 5,
    });
    wrapper.unmount();
  });

  it("replays nothing against a limit that needs fixing, and publishes null", async () => {
    const signal = ref<BacktestSignal | null>(null);
    const wrapper = mountBacktest(SQL("default"), signal);
    await vi.advanceTimersByTimeAsync(700);
    respond(calls[0], [{ zo_sql_key: (NOW - 7 * 60_000) * 1000, zo_sql_val: 9 }]);
    await wrapper.setProps({ threshold: -5 });
    await flushPromises();
    expect(status(wrapper)).toBe(i18n.global.t("alerts.sections.condition.fixLimit"));
    expect(wrapper.find('[data-test="add-alert-backtest-result"]').exists()).toBe(false);
    expect(signal.value).toBeNull();
    wrapper.unmount();
  });

  it("a failed check publishes null and shows Retry", async () => {
    const signal = ref<BacktestSignal | null>(null);
    const wrapper = mountBacktest(SQL("default"), signal);
    await vi.advanceTimersByTimeAsync(700);
    respond(calls[0], []);
    await flushPromises();
    expect(signal.value).not.toBeNull();

    await wrapper.setProps({ query: SQL("other") });
    await vi.advanceTimersByTimeAsync(700);
    calls[1].handlers.error();
    await flushPromises();
    expect(signal.value).toBeNull();
    expect(wrapper.find('[data-test="add-alert-backtest-retry"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("cancels a superseded scan at once and runs only the latest query", async () => {
    const wrapper = mountBacktest();
    await vi.advanceTimersByTimeAsync(700);
    const first = calls[0].request.traceId;

    await wrapper.setProps({ query: SQL("other") });
    expect(cancelMock).toHaveBeenCalledWith(expect.objectContaining({ trace_id: first }));
    await wrapper.setProps({ query: SQL("third") });
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toHaveLength(2);
    expect(b64DecodeUnicode(calls[1].request.queryReq.query.sql)).toContain('FROM "third"');
    wrapper.unmount();
  });

  it("stops waiting after 30 s, offers a retry, and the retry scans again", async () => {
    const wrapper = mountBacktest();
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(cancelMock).toHaveBeenCalledWith(
      expect.objectContaining({ trace_id: calls[0].request.traceId }),
    );
    expect(status(wrapper)).toContain("Took too long");

    await wrapper.find('[data-test="add-alert-backtest-retry"]').trigger("click");
    expect(calls).toHaveLength(2);
    expect(status(wrapper)).toContain("Checking");
    wrapper.unmount();
  });

  it("waits until the row is on screen before scanning", async () => {
    observer.restore();
    observer = installFakeIntersectionObserver();
    const wrapper = mountBacktest();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(0);
    expect(status(wrapper)).toContain("Checking");

    const row = wrapper.find('[data-test="add-alert-backtest"]').element;
    observer.setVisible(row, true);
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toHaveLength(1);

    observer.setVisible(row, false);
    observer.setVisible(row, true);
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toHaveLength(1);
    wrapper.unmount();
  });
});
