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
import SloAlertsPanel from "@/components/slos/SloAlertsPanel.vue";

const listBySloSpy = vi.fn();
const deleteSpy = vi.fn().mockResolvedValue({ data: {} });
const getByIdSpy = vi.fn().mockResolvedValue({ data: {} });

vi.mock("@/services/alerts", () => ({
  default: {
    list_by_slo: (...a: any[]) => listBySloSpy(...a),
    delete_by_alert_id: (...a: any[]) => deleteSpy(...a),
    get_by_alert_id: (...a: any[]) => getByIdSpy(...a),
    create_by_alert_id: vi.fn(),
    update_by_alert_id: vi.fn(),
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn().mockResolvedValue({ data: [] }) },
}));

vi.mock("@/services/slos", () => ({
  default: { list: vi.fn().mockResolvedValue({ data: { list: [] } }) },
}));

const slo = {
  id: "slo-123",
  name: "checkout-availability",
  target: 99.9,
  window_secs: 30 * 86400,
  slice_interval_secs: 300,
  group_by: [],
};

const alertRow = (overrides: Record<string, any> = {}) => ({
  alert_id: "alert-1",
  name: "checkout-burn-14.4x-1h",
  enabled: true,
  condition: {
    type: "slo",
    slo_condition: {
      slo_id: "slo-123",
      kind: "burn_rate",
      critical: 14.4,
      long_window_secs: 3600,
      short_window_secs: 600,
    },
  },
  ...overrides,
});

const mountPanel = async (props: Record<string, any> = {}) => {
  const wrapper = mount(SloAlertsPanel, {
    props: { slo, ...props },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
};

describe("SloAlertsPanel", () => {
  beforeEach(() => {
    listBySloSpy.mockReset().mockResolvedValue({ data: { list: [] } });
    deleteSpy.mockClear();
  });

  it("lists the alerts attached to this SLO", async () => {
    listBySloSpy.mockResolvedValue({
      data: { list: [alertRow(), alertRow({ alert_id: "alert-2", name: "slow-burn" })] },
    });
    const wrapper = await mountPanel();

    expect(listBySloSpy).toHaveBeenCalledWith(expect.anything(), "slo-123");
    expect(wrapper.text()).toContain("checkout-burn-14.4x-1h");
    expect(wrapper.text()).toContain("slow-burn");
  });

  // Burn windows are hours and minutes, not days: the SLO-window formatter
  // renders 3600s as "0d", which tells the user nothing and makes a fast burn
  // indistinguishable from a slow one.
  it("describes burn windows in hours and minutes", async () => {
    listBySloSpy.mockResolvedValue({ data: { list: [alertRow()] } });
    const wrapper = await mountPanel();
    const text = wrapper.text();
    expect(text).toContain("1h");
    expect(text).toContain("10m");
    expect(text).not.toMatch(/\b0d\b/);
  });

  // Disabled alerts must be visible here — this is the only place they can be
  // re-enabled, and disabling is how a burn-window slot is freed.
  it("shows disabled alerts too", async () => {
    listBySloSpy.mockResolvedValue({
      data: { list: [alertRow({ name: "paused-alert", enabled: false })] },
    });
    const wrapper = await mountPanel();
    expect(wrapper.text()).toContain("paused-alert");
  });

  it("offers to add an alert even when some already exist", async () => {
    listBySloSpy.mockResolvedValue({ data: { list: [alertRow()] } });
    const wrapper = await mountPanel();
    expect(wrapper.find('[data-test="slo-alerts-add"]').exists()).toBe(true);
  });

  it("shows an empty state that still offers to add", async () => {
    const wrapper = await mountPanel();
    expect(wrapper.find('[data-test="slo-alerts-empty"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="slo-alerts-add"]').exists()).toBe(true);
  });

  it("opens the form when adding", async () => {
    const wrapper = await mountPanel();
    await wrapper.find('[data-test="slo-alerts-add"]').trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-test="slo-alert-form"]').exists()).toBe(true);
  });

  // The deep link is how the alerts-list edit button hands off. Opening the
  // page without it must NOT open a form.
  it("opens the form for the alert named by editAlertId", async () => {
    listBySloSpy.mockResolvedValue({ data: { list: [alertRow()] } });
    const wrapper = await mountPanel({ editAlertId: "alert-1" });
    expect(wrapper.find('[data-test="slo-alert-form"]').exists()).toBe(true);
  });

  it("does not open a form without a deep link", async () => {
    listBySloSpy.mockResolvedValue({ data: { list: [alertRow()] } });
    const wrapper = await mountPanel();
    expect(wrapper.find('[data-test="slo-alert-form"]').exists()).toBe(false);
  });

  // A stale link must not silently present a CREATE form: saving from it would
  // add a second alert instead of editing the one the user asked for.
  it("reports a stale deep link instead of opening a create form", async () => {
    listBySloSpy.mockResolvedValue({ data: { list: [alertRow()] } });
    const wrapper = await mountPanel({ editAlertId: "does-not-exist" });
    await flushPromises();

    expect(wrapper.find('[data-test="slo-alert-form"]').exists()).toBe(false);
    expect(wrapper.emitted("edit-target-missing")).toBeTruthy();
  });

  // Closing must clear the deep link, and via replace so the back button does
  // not walk straight back into the open dialog.
  it("asks the page to clear the deep link when the form closes", async () => {
    listBySloSpy.mockResolvedValue({ data: { list: [alertRow()] } });
    const wrapper = await mountPanel({ editAlertId: "alert-1" });

    await wrapper.find('[data-test="slo-alert-form-cancel"]').trigger("click");
    await flushPromises();

    expect(wrapper.emitted("close-editor")).toBeTruthy();
    expect(wrapper.find('[data-test="slo-alert-form"]').exists()).toBe(false);
  });

  // The SLO page's header "New alert" button is the primary create
  // affordance. It must open the form ON THIS PAGE — it used to navigate to
  // the alerts list with a `slo_id` param nothing consumes, which now leads
  // nowhere at all since the generic form lost its SLO mode.
  it("exposes startCreate so the page header can open the form", async () => {
    const wrapper = await mountPanel();
    expect(typeof (wrapper.vm as any).startCreate).toBe("function");

    (wrapper.vm as any).startCreate();
    await flushPromises();

    expect(wrapper.find('[data-test="slo-alert-form"]').exists()).toBe(true);
  });

  // While a form is open, "Add alert" could only discard typed work — or,
  // before the :key remount, silently flip an edit's save into a create.
  it("disables Add alert while the form is open", async () => {
    const wrapper = await mountPanel();
    await wrapper.find('[data-test="slo-alerts-add"]').trigger("click");
    await flushPromises();

    const add = wrapper.find('[data-test="slo-alerts-add"]');
    expect(add.attributes("disabled")).toBeDefined();
  });

  // The page header's "New alert" comes in through defineExpose, bypassing the
  // disabled button — the guard has to live in startCreate itself.
  it("ignores startCreate while an edit form is open", async () => {
    listBySloSpy.mockResolvedValue({ data: { list: [alertRow()] } });
    const wrapper = await mountPanel({ editAlertId: "alert-1" });

    (wrapper.vm as any).startCreate();
    await flushPromises();

    // Still the EDIT form for alert-1, not a blank create form.
    const form = wrapper.findComponent({ name: "SloAlertForm" });
    expect(form.props("alertId")).toBe("alert-1");
  });

  // A deep link to a different alert is explicit navigation and DOES win — and
  // the :key remount means the form refetches rather than keeping the old
  // alert's fields with the new id's save branch.
  it("remounts the form when the deep link switches alerts", async () => {
    listBySloSpy.mockResolvedValue({
      data: { list: [alertRow(), alertRow({ alert_id: "alert-2", name: "slo-slow-burn" })] },
    });
    const wrapper = await mountPanel({ editAlertId: "alert-1" });
    getByIdSpy.mockClear();

    await wrapper.setProps({ editAlertId: "alert-2" });
    await flushPromises();

    expect(wrapper.findComponent({ name: "SloAlertForm" }).props("alertId")).toBe("alert-2");
    expect(getByIdSpy).toHaveBeenCalledWith(expect.anything(), "alert-2");
  });

  it("refreshes the list after a save", async () => {
    listBySloSpy.mockResolvedValue({ data: { list: [alertRow()] } });
    const wrapper = await mountPanel();
    listBySloSpy.mockClear();

    await wrapper.find('[data-test="slo-alerts-add"]').trigger("click");
    await flushPromises();
    wrapper.findComponent({ name: "SloAlertForm" }).vm.$emit("saved");
    await flushPromises();

    expect(listBySloSpy).toHaveBeenCalled();
  });
});
