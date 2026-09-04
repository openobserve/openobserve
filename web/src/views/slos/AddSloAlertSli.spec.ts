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

//! The alert-SLI branch of the SLO form (PR 3).
//!
//! The picker exists so the form never offers a source the server will refuse,
//! and so the cadence rules are answered before save rather than by a 400.

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Component } from "vue";

vi.mock("@/services/slos", () => ({
  default: {
    get: vi.fn(),
    create: vi.fn().mockResolvedValue({ data: {} }),
    update: vi.fn().mockResolvedValue({ data: {} }),
    eligibleAlerts: vi.fn(),
    alertPreview: vi.fn().mockResolvedValue({ data: null }),
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({ list: [] }),
    getStream: vi.fn().mockResolvedValue({ schema: [] }),
  }),
}));

import AddSlo from "@/views/slos/AddSlo.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import sloService from "@/services/slos";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

interface EligibleRow {
  alert_id: string;
  name: string;
  frequency_secs: number;
  eligible: boolean;
  reason: string | null;
}

const row = (over: Partial<EligibleRow> = {}): EligibleRow => ({
  alert_id: "alert-fast",
  name: "checkout latency",
  frequency_secs: 60,
  eligible: true,
  reason: null,
  ...over,
});

const ELIGIBLE = [
  row(),
  row({ alert_id: "alert-2m", name: "queue depth", frequency_secs: 120 }),
  row({
    alert_id: "alert-cron",
    name: "weekly report",
    frequency_secs: 604800,
    eligible: false,
    reason: "a cron-scheduled alert cannot be an SLI source",
  }),
  row({
    alert_id: "alert-silenced",
    name: "disk full",
    frequency_secs: 60,
    eligible: false,
    reason: "set the source's silence to 0 or give it a warning threshold",
  }),
  // Scheduled, ungrouped and not cron — refused purely on cadence, because
  // 300 is the coarsest supported slice.
  row({
    alert_id: "alert-slow",
    name: "nightly reconciliation",
    frequency_secs: 600,
    eligible: false,
    reason: "an alert-based SLI needs a source that evaluates at least once per slice",
  }),
];

const SloAlertPreviewStub = {
  name: "SloAlertPreview",
  props: {
    alertId: { type: String, default: "" },
    windowSecs: { type: Number, default: 0 },
    sliceIntervalSecs: { type: Number, default: 0 },
  },
  template: '<div data-test="slos-addslo-alert-preview-section" />',
};

const SelectFolderDropDownStub = { name: "SelectFolderDropDown", template: "<div />" };

/** OSelect sets `inheritAttrs: false`, so its `data-test` never reaches a DOM
 *  root a CSS selector could match — `$attrs` is where it stays. */
function byTest(wrapper: VueWrapper, component: Component, test: string) {
  const hit = wrapper
    .findAllComponents(component)
    .find((c) => String(c.vm.$attrs["data-test"]) === test);
  if (!hit) throw new Error(`no component tagged ${test}`);
  return hit;
}

async function mountForm() {
  vi.mocked(sloService.eligibleAlerts).mockResolvedValue({
    data: { list: ELIGIBLE },
  } as never);

  const wrapper = mount(AddSlo, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        SloAlertPreview: SloAlertPreviewStub,
        SelectFolderDropDown: SelectFolderDropDownStub,
        SloExpressionField: true,
        SloPreviewChart: true,
        SloTimeSlicePreview: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

type Form = Awaited<ReturnType<typeof mountForm>>;

const selectAlertType = async (wrapper: Form) => {
  await wrapper.find('[data-test="slos-addslo-sli-type-alert"]').trigger("click");
  await flushPromises();
};

const pickSource = async (wrapper: Form, alertId: string) => {
  byTest(wrapper, OSelect, "slos-addslo-alert-source").vm.$emit("update:modelValue", alertId);
  await flushPromises();
};

/** Which slice the toggle actually shows as chosen. */
const chosenSlice = (wrapper: Form) =>
  wrapper
    .findAll('[data-test^="slos-addslo-slice-"]')
    .find((el) => el.attributes("data-state") === "on")
    ?.attributes("data-test");

describe("AddSlo — alert SLI", () => {
  beforeEach(() => {
    vi.mocked(sloService.create).mockClear();
    vi.mocked(sloService.eligibleAlerts).mockClear();
  });

  // The gate at :507. With it in place the type cannot be chosen at all, and
  // reka renders the button `disabled`.
  it("offers the alert SLI type as selectable", async () => {
    const wrapper = await mountForm();
    const item = wrapper.find('[data-test="slos-addslo-sli-type-alert"]');
    expect(item.exists()).toBe(true);
    expect(item.attributes("disabled")).toBeUndefined();
    expect(item.attributes("data-disabled")).toBeUndefined();
  });

  it("replaces the unavailable notice with a source picker", async () => {
    const wrapper = await mountForm();
    await selectAlertType(wrapper);
    expect(byTest(wrapper, OSelect, "slos-addslo-alert-source").exists()).toBe(true);
    expect(wrapper.text()).not.toContain("not available yet");
    // The replacement copy: what alert uptime actually measures, in place of
    // the notice that it cannot be measured at all.
    const hint = wrapper.find('[data-test="slos-addslo-alert-source-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text().length).toBeGreaterThan(0);
  });

  it("loads the eligible alerts for the org", async () => {
    const wrapper = await mountForm();
    await selectAlertType(wrapper);
    expect(sloService.eligibleAlerts).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
    );
  });

  // Without this the picker offers alerts the server will reject, and the user
  // learns why only on save.
  it("disables the ineligible alerts and shows why", async () => {
    const wrapper = await mountForm();
    await selectAlertType(wrapper);
    const options = byTest(wrapper, OSelect, "slos-addslo-alert-source").props("options") as {
      value: string;
      label: string;
      disabled?: boolean;
    }[];

    expect(options.find((o) => o.value === "alert-fast")?.disabled).toBeFalsy();

    const cron = options.find((o) => o.value === "alert-cron");
    expect(cron?.disabled).toBe(true);
    expect(cron?.label).toContain("cron");

    const silenced = options.find((o) => o.value === "alert-silenced");
    expect(silenced?.disabled).toBe(true);
    expect(silenced?.label).toContain("silence to 0");
  });

  // A source evaluating slower than 300s cannot be used at all — 300 is the
  // coarsest supported slice, so there is no grid it could ever fill.
  it("disables a source slower than the coarsest slice", async () => {
    const wrapper = await mountForm();
    await selectAlertType(wrapper);
    const options = byTest(wrapper, OSelect, "slos-addslo-alert-source").props("options") as {
      value: string;
      label: string;
      disabled?: boolean;
    }[];
    const slow = options.find((o) => o.value === "alert-slow");
    expect(slow?.disabled).toBe(true);
    expect(slow?.label).toContain("once per slice");
  });

  it("defaults the slice to 60 for a one-minute source", async () => {
    const wrapper = await mountForm();
    await selectAlertType(wrapper);
    await pickSource(wrapper, "alert-fast");
    expect(chosenSlice(wrapper)).toBe("slos-addslo-slice-60");
  });

  // §5.1.3: the smallest LEGAL slice, not the raw cadence — slices are pinned
  // to 60/300, so a 120s cadence has no matching slice. Picked AFTER a 60s
  // source, or the form's own 300 default would answer for the picker.
  it("defaults the slice to 300 for a two-minute source", async () => {
    const wrapper = await mountForm();
    await selectAlertType(wrapper);
    await pickSource(wrapper, "alert-fast");
    expect(chosenSlice(wrapper)).toBe("slos-addslo-slice-60");
    await pickSource(wrapper, "alert-2m");
    expect(chosenSlice(wrapper)).toBe("slos-addslo-slice-300");
  });

  it("shows the preview for the chosen source", async () => {
    const wrapper = await mountForm();
    await selectAlertType(wrapper);
    await pickSource(wrapper, "alert-fast");
    const preview = wrapper.findComponent(SloAlertPreviewStub);
    expect(preview.exists()).toBe(true);
    expect(preview.props("alertId")).toBe("alert-fast");
    expect(preview.props("sliceIntervalSecs")).toBe(60);
  });

  it("shows no preview until a source is chosen", async () => {
    const wrapper = await mountForm();
    await selectAlertType(wrapper);
    expect(wrapper.findComponent(SloAlertPreviewStub).exists()).toBe(false);
  });

  // The ledger records one run per alert, not per group, so there is no
  // per-group coverage to stand on. Forced off AND disabled, not just refused.
  it("forces grouping off and locks the control", async () => {
    const wrapper = await mountForm();
    byTest(wrapper, OSelect, "slos-addslo-group-by").vm.$emit("update:modelValue", ["region"]);
    await flushPromises();

    await selectAlertType(wrapper);
    const locked = byTest(wrapper, OSelect, "slos-addslo-group-by");
    expect(locked.props("disabled")).toBe(true);
    expect(locked.props("modelValue")).toEqual([]);
  });

  it("leaves grouping usable for the other SLI types", async () => {
    const wrapper = await mountForm();
    expect(byTest(wrapper, OSelect, "slos-addslo-group-by").props("disabled")).toBeFalsy();
  });

  it("sends the source alert id as the SLI config", async () => {
    const wrapper = await mountForm();
    await selectAlertType(wrapper);
    await pickSource(wrapper, "alert-fast");
    await wrapper.find('[data-test="slos-addslo-save"]').trigger("click");
    await flushPromises();

    expect(sloService.create).toHaveBeenCalledTimes(1);
    const body = vi.mocked(sloService.create).mock.calls[0][1] as {
      sli_type: string;
      config: Record<string, unknown>;
      group_by: unknown;
      slice_interval_secs: number;
    };
    expect(body.sli_type).toBe("alert");
    expect(body.config).toEqual({ alert_id: "alert-fast" });
    expect(body.group_by).toBeNull();
    expect(body.slice_interval_secs).toBe(60);
  });
});

describe("AddSlo — time-slice SLI", () => {
  beforeEach(() => {
    vi.mocked(sloService.create).mockClear();
  });

  it("sends the query language required by the API", async () => {
    const wrapper = await mountForm();
    await wrapper.find('[data-test="slos-addslo-sli-type-time_slice"]').trigger("click");
    await wrapper.find('[data-test="slos-addslo-save"]').trigger("click");
    await flushPromises();

    const body = vi.mocked(sloService.create).mock.calls[0][1] as {
      sli_type: string;
      config: Record<string, unknown>;
    };
    expect(body.sli_type).toBe("time_slice");
    expect(body.config.query_language).toBe("sql");
  });
});
