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
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import SloAlertPreview from "@/components/slos/SloAlertPreview.vue";

const alertPreviewSpy = vi.fn();

vi.mock("@/services/slos", () => ({
  default: {
    alertPreview: (...a: unknown[]) => alertPreviewSpy(...a),
  },
}));

const MICROS = 1_000_000;

const preview = (over: Record<string, unknown> = {}) => ({
  alert_id: "alert-1",
  range_start_secs: 0,
  range_end_secs: 3600,
  slice_interval_secs: 300,
  intervals: [{ level: "ok", frequency_secs: 60, from_us: 0, to_us: 3540 * MICROS }],
  sli: 100,
  good_secs: 3600,
  total_secs: 3600,
  observed_slices: 12,
  expected_slices: 12,
  coverage: 1,
  would_freeze: false,
  ...over,
});

const mountPreview = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(SloAlertPreview, {
    props: { alertId: "alert-1", windowSecs: 7 * 86400, sliceIntervalSecs: 300, ...props },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
};

describe("SloAlertPreview", () => {
  beforeEach(() => {
    alertPreviewSpy.mockReset();
    alertPreviewSpy.mockResolvedValue({ data: preview() });
  });

  it("asks the API for this alert over the SLO's window and slice", async () => {
    await mountPreview({ windowSecs: 30 * 86400, sliceIntervalSecs: 60 });
    expect(alertPreviewSpy).toHaveBeenCalledTimes(1);
    const [org, alertId, params] = alertPreviewSpy.mock.calls[0];
    expect(org).toBe(store.state.selectedOrganization.identifier);
    expect(alertId).toBe("alert-1");
    expect(params).toMatchObject({ window_secs: 30 * 86400, slice_interval_secs: 60 });
  });

  it("renders the achieved SLI before anything is saved", async () => {
    alertPreviewSpy.mockResolvedValue({ data: preview({ sli: 99.5 }) });
    const wrapper = await mountPreview();
    const tally = wrapper.find('[data-test="slos-sloalertpreview-tally"]');
    expect(tally.exists()).toBe(true);
    expect(tally.text()).toContain("99.5");
  });

  it("collapses a fully covered range into a single band", async () => {
    const wrapper = await mountPreview();
    expect(wrapper.findAll('[data-test="slos-sloalertpreview-band"]')).toHaveLength(1);
  });

  // Grey is not decoration: unmeasured time is neither good nor bad, and a
  // ribbon that colours it either way is the failure D34 exists to prevent.
  it("draws a grey unmeasured band for a pause", async () => {
    alertPreviewSpy.mockResolvedValue({
      data: preview({
        intervals: [
          { level: "ok", frequency_secs: 60, from_us: 0, to_us: 840 * MICROS },
          { level: "ok", frequency_secs: 60, from_us: 2700 * MICROS, to_us: 3540 * MICROS },
        ],
        sli: 100,
        observed_slices: 6,
        coverage: 0.5,
      }),
    });
    const wrapper = await mountPreview();
    const states = wrapper
      .findAll('[data-test="slos-sloalertpreview-band"]')
      .map((b) => b.attributes("data-state"));
    expect(states).toEqual(["good", "unmeasured", "good"]);
  });

  it("reports coverage alongside the SLI, so the denominator is never hidden", async () => {
    alertPreviewSpy.mockResolvedValue({ data: preview({ coverage: 0.5, sli: 100 }) });
    const wrapper = await mountPreview();
    expect(wrapper.find('[data-test="slos-sloalertpreview-tally"]').text()).toContain("50");
  });

  // The floor is server-side config, so the panel cannot work this out itself
  // — and "100% good" over a third of the window is a reading the saved SLO
  // would refuse to give.
  it("warns when the SLO this describes would be frozen", async () => {
    alertPreviewSpy.mockResolvedValue({
      data: preview({ sli: 100, coverage: 0.33, observed_slices: 4, would_freeze: true }),
    });
    const wrapper = await mountPreview();
    expect(wrapper.find('[data-test="slos-sloalertpreview-would-freeze"]').exists()).toBe(true);
  });

  it("stays quiet when coverage clears the floor", async () => {
    const wrapper = await mountPreview();
    expect(wrapper.find('[data-test="slos-sloalertpreview-would-freeze"]').exists()).toBe(false);
  });

  it("says there is no history yet rather than showing 0%", async () => {
    alertPreviewSpy.mockResolvedValue({
      data: preview({ intervals: [], sli: null, observed_slices: 0, coverage: 0 }),
    });
    const wrapper = await mountPreview();
    expect(wrapper.find('[data-test="slos-sloalertpreview-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slos-sloalertpreview-tally"]').exists()).toBe(false);
  });

  it("surfaces a failed load instead of rendering an empty ribbon", async () => {
    alertPreviewSpy.mockRejectedValue(new Error("boom"));
    const wrapper = await mountPreview();
    expect(wrapper.find('[data-test="slos-sloalertpreview-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slos-sloalertpreview-band"]').exists()).toBe(false);
  });

  it("reloads when the source alert changes", async () => {
    const wrapper = await mountPreview();
    await wrapper.setProps({ alertId: "alert-2" });
    await flushPromises();
    expect(alertPreviewSpy).toHaveBeenCalledTimes(2);
    expect(alertPreviewSpy.mock.calls[1][1]).toBe("alert-2");
  });

  // Picking a source rewrites the slice as a side effect, and the window is
  // user-editable — a preview keyed only on the alert would show an SLI for a
  // configuration other than the one about to be saved.
  it("reloads when the window or the slice changes", async () => {
    const wrapper = await mountPreview();
    await wrapper.setProps({ sliceIntervalSecs: 60 });
    await flushPromises();
    expect(alertPreviewSpy.mock.calls.at(-1)?.[2]).toMatchObject({ slice_interval_secs: 60 });

    await wrapper.setProps({ windowSecs: 90 * 86400 });
    await flushPromises();
    expect(alertPreviewSpy.mock.calls.at(-1)?.[2]).toMatchObject({ window_secs: 90 * 86400 });
  });

  it("does not call the API without a source alert", async () => {
    await mountPreview({ alertId: "" });
    expect(alertPreviewSpy).not.toHaveBeenCalled();
  });

  // Picking a source rewrites the slice, so two requests are routinely in
  // flight. If the slower FIRST one wins, the ribbon describes a window the
  // form is no longer set to and nothing says so.
  it("ignores a superseded response that arrives late", async () => {
    let releaseFirst: (v: unknown) => void = () => {};
    const first = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    alertPreviewSpy.mockReturnValueOnce(first);
    alertPreviewSpy.mockResolvedValueOnce({ data: preview({ sli: 42 }) });

    const wrapper = await mountPreview();
    await wrapper.setProps({ windowSecs: 90 * 86400 });
    await flushPromises();
    expect(wrapper.find('[data-test="slos-sloalertpreview-tally"]').text()).toContain("42");

    releaseFirst({ data: preview({ sli: 7 }) });
    await flushPromises();
    expect(wrapper.find('[data-test="slos-sloalertpreview-tally"]').text()).toContain("42");
  });
});
