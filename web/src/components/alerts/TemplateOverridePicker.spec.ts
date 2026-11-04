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

const resolve = vi.fn((_: any) => ({ href: "/templates?action=add" }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ resolve }),
}));

vi.mock("@/services/alert_templates", () => ({
  default: { list: vi.fn() },
}));
vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn() },
}));
vi.mock("@/services/settings", () => ({
  default: { getSetting: vi.fn() },
}));

import TemplateOverridePicker from "./TemplateOverridePicker.vue";
import templateService from "@/services/alert_templates";
import destinationService from "@/services/alert_destination";
import settingsService from "@/services/settings";
import { queryClient } from "@/composables/query/queryClient";

const list = vi.mocked(templateService.list);
const listDestinations = vi.mocked(destinationService.list);
const getSetting = vi.mocked(settingsService.getSetting);

async function mountPicker(props: Record<string, any> = {}) {
  const wrapper = mount(TemplateOverridePicker, {
    props: { kind: "anomaly", modelValue: null, ...props },
    global: { plugins: [i18n, store] },
  });
  await flushPromises();
  return wrapper;
}

const select = (w: any) => w.findComponent({ name: "OSelect" });

describe("TemplateOverridePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    listDestinations.mockResolvedValue({ data: [] } as any);
    getSetting.mockRejectedValue({ response: { status: 404 } });
  });

  it("as an org default row, names the built-in message and drops the override help", async () => {
    list.mockResolvedValue({ data: [{ name: "card", kind: "content" }] } as any);
    const w = await mountPicker({ context: "orgDefault", kind: "synthetics" });

    expect(String(select(w).props("placeholder"))).toBe("Built-in Synthetics message");
    expect(String(select(w).props("helpText"))).toBe(
      "Sent for Synthetics messages when the destination has no template that applies.",
    );
    expect(w.find('[data-test="template-override-help-btn"]').exists()).toBe(false);
    expect(w.find('[data-test="template-override-will-use"]').exists()).toBe(false);
  });

  it("as the incident org default row, says it overrides the alert's and the destination's template", async () => {
    list.mockResolvedValue({ data: [{ name: "card", kind: "content" }] } as any);
    const w = await mountPicker({ context: "orgDefault", kind: "incident" });

    expect(String(select(w).props("placeholder"))).toBe(
      "Use the alert's or the destination's template",
    );
    expect(String(select(w).props("helpText"))).toBe(
      "Overrides the alert's and the destination's template for incident messages.",
    );
  });

  it("names the destination template that an empty override leaves in place", async () => {
    list.mockResolvedValue({
      data: [{ name: "slack_tpl", kind: "custom", type: "http", applies_to: [] }],
    } as any);
    listDestinations.mockResolvedValue({
      data: [{ name: "slack", type: "http", template: "slack_tpl" }],
    } as any);
    const w = await mountPicker({ destinations: ["slack"] });

    expect(w.find('[data-test="template-override-will-use"]').text()).toBe(
      "Will use: slack_tpl (destination template)",
    );
  });

  it("lists one row per destination when they resolve to different templates", async () => {
    list.mockResolvedValue({
      data: [
        { name: "alert_only", kind: "custom", type: "http", applies_to: ["alert"] },
        { name: "org_card", kind: "content", type: "http", applies_to: [] },
        { name: "o2_default_email", kind: "custom", type: "email", isPrebuilt: true },
      ],
    } as any);
    listDestinations.mockResolvedValue({
      data: [
        { name: "hook", type: "http", template: "alert_only" },
        { name: "mail", type: "email", template: "o2_default_email" },
      ],
    } as any);
    getSetting.mockResolvedValue({ data: { setting_value: { synthetics: "org_card" } } } as any);
    const w = await mountPicker({ kind: "synthetics", destinations: ["hook", "mail"] });

    expect(w.findAll('[data-test="template-override-will-use-row"]').map((r) => r.text())).toEqual(
      [],
    );
    expect(w.find('[data-test="template-override-will-use"]').text()).toBe(
      "Will use: org_card (org default)",
    );

    await w.setProps({ modelValue: "alert_only" });
    expect(w.findAll('[data-test="template-override-will-use-row"]').map((r) => r.text())).toEqual([
      "hook: alert_only (this override)",
      "mail: org_card (org default)",
    ]);
  });

  it("asks for the kind's templates and lists Content then Custom without prebuilt rows", async () => {
    list.mockResolvedValue({
      data: [
        { name: "hook", kind: "custom", type: "http" },
        { name: "card", kind: "content", type: "http" },
        { name: "mail", kind: "custom", type: "email" },
        { name: "prebuilt_slack", kind: "content", type: "http", isPrebuilt: true },
      ],
    } as any);
    const w = await mountPicker();

    expect(list).toHaveBeenCalledWith({
      org_identifier: store.state.selectedOrganization.identifier,
      applies_to: "anomaly",
    });
    const options = select(w).props("options") as any[];
    expect(options.map((o) => [String(o.label), !!o.header])).toEqual([
      ["Content", true],
      ["card", false],
      ["Custom", true],
      ["hook (webhook only)", false],
      ["mail (email only)", false],
    ]);
  });

  it("emits null when cleared and the name when picked", async () => {
    list.mockResolvedValue({ data: [{ name: "card", kind: "content" }] } as any);
    const w = await mountPicker({ modelValue: "card" });
    await select(w).vm.$emit("update:modelValue", null);
    await select(w).vm.$emit("update:modelValue", "card");
    expect(w.emitted("update:modelValue")).toEqual([[null], ["card"]]);
  });

  it("shows the empty text with a create link that presets the kind", async () => {
    list.mockResolvedValue({ data: [] } as any);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const w = await mountPicker();

    expect(w.find('[data-test="template-override-empty"]').text()).toContain(
      "No templates apply to Anomaly yet.",
    );
    await w.find('[data-test="template-override-create"]').trigger("click");
    expect(resolve.mock.calls[0][0].query).toMatchObject({ action: "add", applies_to: "anomaly" });
    expect(open).toHaveBeenCalled();
    open.mockRestore();
  });

  it("disables the select on 403 and keeps the stored value", async () => {
    list.mockRejectedValue({ response: { status: 403 } });
    const w = await mountPicker({ modelValue: "card" });
    expect(select(w).props("disabled")).toBe(true);
    expect(select(w).props("modelValue")).toBe("card");
    expect(String(select(w).props("helpText"))).toContain("templates read permission");
  });

  it("shows a retry on a load error and the stored value as text", async () => {
    list.mockRejectedValueOnce({ response: { status: 500 } });
    const w = await mountPicker({ modelValue: "card" });
    expect(w.find('[data-test="template-override-stored"]').text()).toBe("card");

    list.mockResolvedValueOnce({ data: [{ name: "card", kind: "content" }] } as any);
    await w.find('[data-test="template-override-retry"]').trigger("click");
    await flushPromises();
    expect(select(w).exists()).toBe(true);
  });

  it("warns when the stored template no longer exists", async () => {
    list.mockResolvedValue({ data: [{ name: "card", kind: "content" }] } as any);
    const w = await mountPicker({ modelValue: "deleted-card" });
    expect(w.find('[data-test="template-override-stale"]').text()).toContain("deleted-card");
    await w.setProps({ modelValue: "card" });
    expect(w.find('[data-test="template-override-stale"]').exists()).toBe(false);
  });

  it("warns when a Custom pick does not fit some destinations", async () => {
    list.mockResolvedValue({ data: [{ name: "hook", kind: "custom", type: "http" }] } as any);
    const w = await mountPicker({
      modelValue: "hook",
      destinations: [
        { name: "slack-ops", type: "http" },
        { name: "mail-ops", type: "email" },
      ],
    });
    expect(w.find('[data-test="template-override-mismatch"]').text()).toContain("mail-ops");
  });

  it("shows the server 400 under the select", async () => {
    list.mockResolvedValue({ data: [{ name: "card", kind: "content" }] } as any);
    const w = await mountPicker({ serverError: "template 'x' does not apply to anomaly" });
    expect(String(select(w).props("errorMessage"))).toBe("template 'x' does not apply to anomaly");
  });
});
