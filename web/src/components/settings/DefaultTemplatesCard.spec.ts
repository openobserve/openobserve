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

vi.mock("@/services/settings", () => ({
  default: { getSetting: vi.fn(), setOrgSetting: vi.fn() },
}));
vi.mock("@/services/alert_templates", () => ({
  default: { preview: vi.fn() },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

import DefaultTemplatesCard from "./DefaultTemplatesCard.vue";
import settingsService from "@/services/settings";
import templateService from "@/services/alert_templates";

const pickerStub = {
  name: "TemplateOverridePicker",
  template: "<div />",
  props: ["kind", "modelValue", "serverError", "disabled"],
  emits: ["update:modelValue"],
};

const ORG = store.state.selectedOrganization.identifier;

async function mountCard() {
  const wrapper = mount(DefaultTemplatesCard, {
    global: { plugins: [i18n, store], stubs: { TemplateOverridePicker: pickerStub } },
  });
  await flushPromises();
  return wrapper;
}

const picker = (w: any, kind: string) =>
  w
    .findAllComponents({ name: "TemplateOverridePicker" })
    .find((p: any) => p.props("kind") === kind);

describe("DefaultTemplatesCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(templateService.preview).mockResolvedValue({
      data: {
        variable_groups: [
          { name: "common", variables: [] },
          { name: "alert", variables: [] },
          { name: "incident", variables: [] },
          { name: "anomaly", variables: [] },
        ],
      },
    } as any);
    vi.mocked(settingsService.getSetting).mockResolvedValue({
      data: { setting_value: { incident: "ops-card", anomaly: "anomaly-card" } },
    } as any);
    vi.mocked(settingsService.setOrgSetting).mockResolvedValue({ data: {} } as any);
  });

  it("shows a row only for kinds the server lists, in the card order", async () => {
    const w = await mountCard();
    const kinds = w
      .findAllComponents({ name: "TemplateOverridePicker" })
      .map((p: any) => p.props("kind"));
    expect(kinds).toEqual(["incident", "anomaly", "alert"]);
    expect(picker(w, "incident").props("modelValue")).toBe("ops-card");
  });

  it("saves the whole map and omits a cleared row", async () => {
    const w = await mountCard();
    const save = w.find('[data-test="settings-default-templates-save"]');
    expect(save.attributes("disabled")).toBeDefined();

    await picker(w, "anomaly").vm.$emit("update:modelValue", null);
    await picker(w, "alert").vm.$emit("update:modelValue", "alert-card");
    await save.trigger("click");
    await flushPromises();

    expect(settingsService.setOrgSetting).toHaveBeenCalledWith(
      ORG,
      "default_templates",
      { incident: "ops-card", alert: "alert-card" },
      "alerts",
    );
  });

  it("puts a 400 under the row it names", async () => {
    vi.mocked(settingsService.setOrgSetting).mockRejectedValueOnce({
      response: {
        status: 400,
        data: { message: "default_templates.anomaly: template 'x' is reserved" },
      },
    });
    const w = await mountCard();
    await picker(w, "anomaly").vm.$emit("update:modelValue", "x");
    await w.find('[data-test="settings-default-templates-save"]').trigger("click");
    await flushPromises();
    expect(picker(w, "anomaly").props("serverError")).toContain("is reserved");
  });

  it("treats a missing setting as an empty map", async () => {
    vi.mocked(settingsService.getSetting).mockRejectedValueOnce({ response: { status: 404 } });
    const w = await mountCard();
    expect(picker(w, "incident").props("modelValue")).toBeNull();
  });

  it("hides the card on 403", async () => {
    vi.mocked(settingsService.getSetting).mockRejectedValueOnce({ response: { status: 403 } });
    const w = await mountCard();
    expect(w.find('[data-test="settings-default-templates"]').exists()).toBe(false);
  });

  it("shows every row when the preview cannot be read", async () => {
    vi.mocked(templateService.preview).mockRejectedValueOnce({ response: { status: 403 } });
    const w = await mountCard();
    const kinds = w
      .findAllComponents({ name: "TemplateOverridePicker" })
      .map((p: any) => p.props("kind"));
    expect(kinds).toEqual(["incident", "anomaly", "synthetics", "downtime", "on_call", "alert"]);
  });

  it("turns read only after a write 403", async () => {
    vi.mocked(settingsService.setOrgSetting).mockRejectedValueOnce({
      response: { status: 403, data: { message: "Forbidden" } },
    });
    const w = await mountCard();
    await picker(w, "incident").vm.$emit("update:modelValue", "other-card");
    await (w.vm as any).save();
    await flushPromises();
    expect(w.find('[data-test="settings-default-templates-read-only"]').exists()).toBe(true);
    expect(picker(w, "incident").props("disabled")).toBe(true);
    expect(
      w.find('[data-test="settings-default-templates-save"]').attributes("disabled"),
    ).toBeDefined();
  });
});
