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
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import AlertCalibrationHeadroomCard from "./AlertCalibrationHeadroomCard.vue";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/services/http", () => ({ default: () => ({ get }) }));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/aws-exports")>();
  return { default: { ...actual.default, isEnterprise: "true" } };
});

const DAY = 86_400_000_000;
const WINDOW = {
  window_start: 1_760_000_000_000_000,
  window_end: 1_760_000_000_000_000 + 30 * DAY,
};
const EMITTED = WINDOW.window_end + 60_000_000;
const HEADROOM = {
  value: 42,
  threshold: 100,
  operator: ">=",
  level: "critical",
  lower_bound: false,
  valued: 720,
};

const run = { ...WINDOW, emitted_at: EMITTED, finding_count: 0, skip_count: 3 };
const skip = (detail: Record<string, unknown> | null, reason = "healthy_silence") => ({
  ...WINDOW,
  _timestamp: EMITTED,
  org: "default",
  config_id: "c1",
  kind: "skip",
  rule_id: "silent",
  alert_id: "q1",
  alert_name: "queue depth",
  skip_reason: reason,
  ...(detail ? { skip_detail: JSON.stringify(detail) } : {}),
});
const httpError = (status: number) =>
  Object.assign(new Error("Request failed"), { response: { status, data: {} } });

/** The runs list answers first, then the run's records, as the query reads them. */
const answer = (runs: unknown, records: unknown) =>
  get.mockImplementation((url: string) => {
    const reply = url.endsWith("/digests") ? runs : records;
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve({ data: reply });
  });

const mountCard = async () => {
  const wrapper = mount(AlertCalibrationHeadroomCard, {
    props: { alertId: "q1" },
    global: { plugins: [store] },
  });
  await flushPromises();
  return wrapper;
};

const card = '[data-test="alert-calibration-headroom-card"]';

describe("AlertCalibrationHeadroomCard", () => {
  beforeEach(() => {
    queryClient.clear();
    get.mockReset();
    store.state.zoConfig = {
      ...store.state.zoConfig,
      version: "v1",
      alert_calibration_enabled: true,
    };
  });

  it("the_headroom_card_shows_once_and_hides_on_any_gap", async () => {
    answer([run], [skip({ headroom: HEADROOM })]);
    const shown = await mountCard();
    expect(shown.findAll(card)).toHaveLength(1);
    expect(shown.find('[data-test="alert-calibration-headroom-sentence"]').text()).toBe(
      "Hasn't fired in the last 30 days. Its highest value was 42, against a threshold of 100.",
    );
    expect(shown.find('[data-test="alert-calibration-headroom-source"]').text()).toMatch(
      /^From the calibration run of .+\. This is information, not a problem\.$/,
    );
    expect(shown.find('[data-test="alert-calibration-headroom-edited"]').exists()).toBe(false);
    expect(shown.html()).not.toMatch(/error|warning/);
    const [runsCall, recordsCall] = get.mock.calls;
    expect(runsCall[1]).toMatchObject({ params: { size: 1 }, silentForbidden: true });
    expect(recordsCall[1]).toMatchObject({
      params: { ...WINDOW, kind: "skip", rule_id: "silent", alert_id: "q1", size: 5 },
      silentForbidden: true,
    });
    shown.unmount();

    const gaps: [string, unknown, unknown][] = [
      ["no run", [], []],
      ["403", httpError(403), []],
      ["404", httpError(404), []],
      ["a record error", [run], httpError(500)],
      ["no record", [run], []],
      ["no headroom", [run], [skip(null)]],
    ];
    for (const [label, runs, records] of gaps) {
      queryClient.clear();
      get.mockReset();
      answer(runs, records);
      const wrapper = await mountCard();
      expect(wrapper.html(), label).toBe("<!--v-if-->");
      for (const [, config] of get.mock.calls) {
        expect(config, label).toMatchObject({ silentForbidden: true });
      }
      wrapper.unmount();
    }

    queryClient.clear();
    get.mockReset();
    store.state.zoConfig = { ...store.state.zoConfig, alert_calibration_enabled: false };
    answer([run], [skip({ headroom: HEADROOM })]);
    const off = await mountCard();
    expect(off.html()).toBe("<!--v-if-->");
    expect(get).not.toHaveBeenCalled();
    off.unmount();
  });

  it("names a sentinel in its own words and an in-window edit on its own line", async () => {
    answer(
      [run],
      [
        skip(
          { headroom: { ...HEADROOM, value: 0, threshold: 1, last_edit_micros: EMITTED - DAY } },
          "sentinel_by_design",
        ),
      ],
    );
    const wrapper = await mountCard();
    expect(wrapper.find('[data-test="alert-calibration-headroom-sentence"]').text()).toBe(
      "Quiet by design: its value stayed at 0, against a threshold of 1.",
    );
    expect(wrapper.find('[data-test="alert-calibration-headroom-edited"]').text()).toBe(
      "It was edited in this period, so earlier values are compared with the current threshold.",
    );
    wrapper.unmount();
  });

  it("reads its headroom from the run's own emission only", async () => {
    const later = EMITTED + 3_600_000_000;
    answer([{ ...run, emitted_at: later }], [skip({ headroom: HEADROOM })]);
    const stale = await mountCard();
    expect(stale.html(), "an older emission's skip").toBe("<!--v-if-->");
    stale.unmount();

    queryClient.clear();
    get.mockReset();
    answer(
      [{ ...run, emitted_at: later }],
      [
        { ...skip({ headroom: { ...HEADROOM, value: 17 } }), _timestamp: later },
        skip({ headroom: HEADROOM }),
      ],
    );
    const current = await mountCard();
    expect(current.find('[data-test="alert-calibration-headroom-sentence"]').text()).toContain(
      "highest value was 17",
    );
    current.unmount();
  });

  it("never shows once calibration is off, whatever the query cache holds", async () => {
    const off = () => {
      store.state.zoConfig = { ...store.state.zoConfig, alert_calibration_enabled: false };
    };
    answer([run], [skip({ headroom: HEADROOM })]);
    const loaded = await mountCard();
    expect(loaded.findAll(card)).toHaveLength(1);
    off();
    await flushPromises();
    expect(loaded.html(), "turned off after a load").toBe("<!--v-if-->");
    loaded.unmount();

    get.mockReset();
    const cached = await mountCard();
    expect(cached.html(), "mounted off with a cached entry").toBe("<!--v-if-->");
    expect(get).not.toHaveBeenCalled();
    cached.unmount();

    queryClient.clear();
    store.state.zoConfig = { ...store.state.zoConfig, alert_calibration_enabled: true };
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    get.mockImplementation(async (url: string) => {
      if (url.endsWith("/digests")) return { data: [run] };
      await held;
      return { data: [skip({ headroom: HEADROOM })] };
    });
    const pending = await mountCard();
    expect(get).toHaveBeenCalledTimes(2);
    off();
    release();
    await flushPromises();
    expect(pending.html(), "turned off while the records read was outstanding").toBe("<!--v-if-->");
    pending.unmount();
  });
});
