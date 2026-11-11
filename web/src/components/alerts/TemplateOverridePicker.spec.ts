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

import TemplateOverridePicker from "./TemplateOverridePicker.vue";
import templateService from "@/services/alert_templates";
import destinationService from "@/services/alert_destination";
import { queryClient } from "@/composables/query/queryClient";

const list = vi.mocked(templateService.list);
const listDestinations = vi.mocked(destinationService.list);

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
        { name: "card", kind: "content", type: "http", applies_to: [] },
        { name: "prebuilt_email", kind: "custom", type: "email", isPrebuilt: true },
      ],
    } as any);
    listDestinations.mockResolvedValue({
      data: [
        {
          name: "hook",
          type: "http",
          template: "alert_only",
          metadata: { payload_format: "rendered" },
        },
        { name: "mail", type: "email", template: "prebuilt_email" },
      ],
    } as any);
    const w = await mountPicker({ kind: "synthetics", destinations: ["hook", "mail"] });

    expect(w.findAll('[data-test="template-override-will-use-row"]').map((r) => r.text())).toEqual(
      [],
    );
    expect(w.find('[data-test="template-override-will-use"]').text()).toBe(
      "Will use: Built-in Synthetics message (built in)",
    );

    await w.setProps({ modelValue: "alert_only" });
    expect(w.findAll('[data-test="template-override-will-use-row"]').map((r) => r.text())).toEqual([
      "hook: alert_only (this override)",
      "mail: Built-in Synthetics message (built in)",
    ]);
  });

  it("names the legacy JSON payload for a generic webhook with only the built-in message", async () => {
    list.mockResolvedValue({
      data: [{ name: "card", kind: "content", type: "http", applies_to: [] }],
    } as any);
    listDestinations.mockResolvedValue({
      data: [
        { name: "hook", type: "http" },
        { name: "slack", type: "http", destination_type_name: "slack" },
      ],
    } as any);
    const w = await mountPicker({ kind: "anomaly", destinations: ["hook", "slack"] });

    expect(w.findAll('[data-test="template-override-will-use-row"]').map((r) => r.text())).toEqual([
      "hook: the kind's own JSON payload (generic webhook)",
      "slack: Built-in Anomaly message (built in)",
    ]);

    await w.setProps({ modelValue: "card" });
    expect(w.find('[data-test="template-override-will-use"]').text()).toBe(
      "Will use: card (this override)",
    );
  });

  it("keeps the built-in message on a generic webhook set to rendered, and for alerts", async () => {
    list.mockResolvedValue({ data: [{ name: "card", kind: "content", applies_to: [] }] } as any);
    listDestinations.mockResolvedValue({
      data: [{ name: "hook", type: "http", metadata: { payload_format: "rendered" } }],
    } as any);
    const w = await mountPicker({ kind: "downtime", destinations: ["hook"] });
    expect(w.find('[data-test="template-override-will-use"]').text()).toBe(
      "Will use: Built-in Downtime message (built in)",
    );

    listDestinations.mockResolvedValue({ data: [{ name: "hook", type: "http" }] } as any);
    queryClient.clear();
    const alert = await mountPicker({ kind: "alert", destinations: ["hook"] });
    expect(alert.find('[data-test="template-override-will-use"]').text()).toBe(
      "Will use: Built-in Alert message (built in)",
    );
  });

  it("reads no org default setting and never names one in the Will use line", async () => {
    list.mockResolvedValue({
      data: [{ name: "card", kind: "content", type: "http", applies_to: [], isDefault: true }],
    } as any);
    listDestinations.mockResolvedValue({ data: [{ name: "hook", type: "http" }] } as any);
    const w = await mountPicker({ kind: "alert", destinations: ["hook"] });

    expect(w.find('[data-test="template-override-will-use"]').text()).toBe(
      "Will use: Built-in Alert message (built in)",
    );
    expect(w.find('[data-test="template-override-help-btn"]').exists()).toBe(true);
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
    w.unmount();
  });

  it("reloads the templates when the user returns after opening Create template", async () => {
    list.mockResolvedValue({ data: [] } as any);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const w = await mountPicker();
    const callsBefore = list.mock.calls.length;

    window.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(list.mock.calls.length).toBe(callsBefore);

    await w.find('[data-test="template-override-create"]').trigger("click");
    list.mockResolvedValue({ data: [{ name: "fresh", kind: "content", applies_to: [] }] } as any);
    window.dispatchEvent(new Event("focus"));
    await flushPromises();

    const org = store.state.selectedOrganization.identifier;
    expect(list.mock.calls.slice(callsBefore).map(([args]) => args)).toEqual(
      expect.arrayContaining([
        { org_identifier: org, applies_to: "anomaly" },
        { org_identifier: org },
      ]),
    );
    const options = select(w).props("options") as any[];
    expect(options.map((o) => String(o.label))).toEqual(["Content", "fresh"]);

    const callsAfter = list.mock.calls.length;
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(list.mock.calls.length).toBeGreaterThan(callsAfter);

    w.unmount();
    const callsUnmounted = list.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await flushPromises();
    expect(list.mock.calls.length).toBe(callsUnmounted);
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

  it("shows the server 400 under the select and marks the select", async () => {
    list.mockResolvedValue({ data: [{ name: "card", kind: "content" }] } as any);
    const w = await mountPicker({ serverError: "template 'x' does not apply to anomaly" });
    expect(select(w).props("error")).toBe(true);
    expect(w.find('[data-test="template-override-server-error"]').text()).toBe(
      "template 'x' does not apply to anomaly",
    );
  });

  // B1/B28: the empty and error states have no select, so the reason must still show.
  it("shows the server 400 with an empty list and with a failed list read", async () => {
    const message = "template 'x' does not apply to anomaly";
    list.mockResolvedValue({ data: [] } as any);
    const empty = await mountPicker({ modelValue: "x", serverError: message });
    expect(empty.find('[data-test="template-override-empty"]').exists()).toBe(true);
    expect(empty.find('[data-test="template-override-server-error"]').text()).toBe(message);

    list.mockRejectedValue({ response: { status: 500 } });
    const failed = await mountPicker({ modelValue: "x", serverError: message });
    expect(failed.find('[data-test="template-override-error"]').exists()).toBe(true);
    expect(failed.find('[data-test="template-override-server-error"]').text()).toBe(message);
  });

  it("shows the stored name with a clear button in the empty and error states", async () => {
    list.mockResolvedValue({ data: [] } as any);
    const empty = await mountPicker({ modelValue: "card" });
    expect(empty.find('[data-test="template-override-stored"]').text()).toBe("card");
    await empty.find('[data-test="template-override-clear"]').trigger("click");
    expect(empty.emitted("update:modelValue")).toEqual([[null]]);

    list.mockRejectedValue({ response: { status: 500 } });
    const failed = await mountPicker({ modelValue: "card" });
    await failed.find('[data-test="template-override-clear"]').trigger("click");
    expect(failed.emitted("update:modelValue")).toEqual([[null]]);

    const unset = await mountPicker({ modelValue: null });
    expect(unset.find('[data-test="template-override-clear"]').exists()).toBe(false);
  });

  it("shows no select in the empty and error states, with or without a stored value", async () => {
    list.mockResolvedValue({ data: [] } as any);
    const empty = await mountPicker({ modelValue: "card" });
    expect(select(empty).exists()).toBe(false);
    await empty.find('[data-test="template-override-clear"]').trigger("click");
    await empty.setProps({ modelValue: null });
    expect(select(empty).exists()).toBe(false);
    expect(
      (await mountPicker({ modelValue: null })).findComponent({ name: "OSelect" }).exists(),
    ).toBe(false);

    list.mockRejectedValue({ response: { status: 500 } });
    expect(select(await mountPicker({ modelValue: "card" })).exists()).toBe(false);
    expect(select(await mountPicker({ modelValue: null })).exists()).toBe(false);
  });

  it("says a name missing from the kind's list is not available, not deleted", async () => {
    list.mockResolvedValue({ data: [{ name: "card", kind: "content" }] } as any);
    const w = await mountPicker({ modelValue: "other" });
    const text = w.find('[data-test="template-override-stale"]').text();
    expect(text).toContain("not available for this kind");
    expect(text).not.toContain("no longer exists");
  });

  // B32: without the destinations read, the line would guess the type and template.
  it("leaves the Will use line out when the destinations read fails", async () => {
    list.mockResolvedValue({
      data: [{ name: "card", kind: "content", applies_to: [] }],
    } as any);
    listDestinations.mockRejectedValue({ response: { status: 403 } });
    const w = await mountPicker({ modelValue: "card", destinations: ["hook"] });
    expect(w.find('[data-test="template-override-will-use"]').exists()).toBe(false);
  });

  it("wraps long names in the Will use line", async () => {
    const long = "t".repeat(200);
    list.mockResolvedValue({ data: [{ name: long, kind: "content", applies_to: [] }] } as any);
    listDestinations.mockResolvedValue({ data: [{ name: "slack", type: "http" }] } as any);
    const w = await mountPicker({ modelValue: long, destinations: ["slack"] });
    const line = w.find('[data-test="template-override-will-use"]');
    expect(line.text()).toContain(long);
    expect(line.classes()).toContain("wrap-anywhere");
  });
});
