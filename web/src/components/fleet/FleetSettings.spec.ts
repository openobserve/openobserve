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

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import { queryClient } from "@/composables/query/queryClient";
import { fleetKeys } from "@/services/fleet.querykeys";
import FleetSettings from "./FleetSettings.vue";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: { listAudit: vi.fn(), getSettings: vi.fn(), updateSettings: vi.fn() },
}));

const event = (over: Record<string, unknown> = {}) => ({
  id: "a1",
  at: Date.now(),
  actor: "ana@acme.io",
  action: "fleet.audit.publishedVersion",
  target: "edge-minimal v1",
  outcome: "success",
  ...over,
});

const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 100));
  await flushPromises();
};

describe("FleetSettings", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { restricted_components: ["debug", "file"], target_version: null },
    } as any);
    vi.mocked(fleet.listAudit).mockResolvedValue({
      data: {
        items: [
          event(),
          event({ id: "a2", action: "fleet.audit.someFutureAction", target: "tok-1" }),
        ],
      },
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  async function mountSettings() {
    wrapper = mount(FleetSettings, { attachTo: document.body, global: { plugins: [i18n, store] } });
    await settle();
    return wrapper;
  }

  const sel = (name: string) => `[data-test="fleet-settings-${name}"]`;
  const targetField = () => wrapper.find(sel("target-version-field"));
  const saveButton = () => wrapper.find(sel("save"));

  const selected = () =>
    wrapper.find(sel("restricted-trigger")).attributes("data-test-selected-value");
  const org = () => store.state.selectedOrganization.identifier;

  async function typeRestricted(name: string) {
    await wrapper.find(sel("restricted-trigger")).trigger("click");
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>(sel("restricted-search"));
    expect(input).not.toBeNull();
    input!.value = name;
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
  }

  async function edit(add: string | null, target: string | null) {
    if (add) await typeRestricted(add);
    if (target !== null) await targetField().setValue(target);
    await flushPromises();
  }

  async function save() {
    await saveButton().trigger("click");
    await settle();
  }

  const auditText = (w: VueWrapper) => w.find('[data-test="fleet-settings-audit-table"]').text();

  it("reads the audit rows from the API", async () => {
    await mountSettings();
    expect(fleet.listAudit).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    expect(auditText(wrapper)).toContain("edge-minimal v1");
    expect(auditText(wrapper)).toContain("ana@acme.io");
  });

  it("says the audit trail needs O2_AUDIT_ENABLED when the server has it off", async () => {
    vi.mocked(fleet.listAudit).mockResolvedValue({
      data: { items: [], audit_disabled: true },
    } as any);
    await mountSettings();
    expect(auditText(wrapper)).toContain("O2_AUDIT_ENABLED");
  });

  it("translates a known action key and shows an unknown one raw", async () => {
    await mountSettings();
    expect(auditText(wrapper)).toContain("Published version");
    expect(auditText(wrapper)).toContain("fleet.audit.someFutureAction");
  });

  it("offers no compliance export, which has no API", async () => {
    await mountSettings();
    expect(wrapper.find('[data-test="fleet-settings-export-audit"]').exists()).toBe(false);
  });

  it("loads the restricted list and the target from the API", async () => {
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { restricted_components: ["debug", "pprof"], target_version: "0.170.0" },
    } as any);
    await mountSettings();
    expect(fleet.getSettings).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    expect(selected()).toBe("debug,pprof");
    expect((targetField().element as HTMLInputElement).value).toBe("0.170.0");
  });

  it("gives both controls a field width that takes the full row below md, and a placeholder", async () => {
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { restricted_components: [], target_version: null },
    } as any);
    await mountSettings();
    const fixed = wrapper.findAll(".w-field-width-md");
    expect(fixed).toHaveLength(2);
    for (const control of fixed) expect(control.classes()).toContain("max-md:w-full");
    expect(wrapper.find(sel("restricted-trigger")).text()).toContain(
      "None, all components are allowed",
    );
    expect(targetField().attributes("placeholder")).toBe("Latest supported (e.g. 0.162.0)");
  });

  it("has no drift or offline rows", async () => {
    await mountSettings();
    for (const gone of ["drift", "show-drift", "alert-drift", "remediate-drift", "offline-after"]) {
      expect(wrapper.find(sel(gone)).exists()).toBe(false);
    }
    expect(wrapper.text()).not.toContain("Show configuration drift");
    expect(wrapper.text()).not.toContain("Offline alert");
  });

  it("offers the controls and Save to everyone, leaving refusal to the server", async () => {
    await mountSettings();
    expect(wrapper.find(sel("restricted-trigger")).attributes("disabled")).toBeUndefined();
    expect(targetField().attributes("disabled")).toBeUndefined();
    expect(saveButton().exists()).toBe(true);
    expect(wrapper.text()).not.toContain("Only organization administrators");
  });

  it("toasts the server's 403 when a save is refused", async () => {
    vi.mocked(fleet.updateSettings).mockRejectedValue({
      response: { status: 403, data: { code: 403, message: "Unauthorized Access" } },
    });
    await mountSettings();
    await edit(null, "0.170.0");
    await save();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "Unauthorized Access" }),
    );
  });

  it("keeps Save disabled until something changes", async () => {
    await mountSettings();
    expect(saveButton().attributes("disabled")).toBeDefined();
    await edit(null, "0.170.0");
    expect(saveButton().attributes("disabled")).toBeUndefined();
    await edit(null, "");
    expect(saveButton().attributes("disabled")).toBeDefined();
  });

  it("saves an added component and a target as one full body", async () => {
    const body = { restricted_components: ["debug", "file", "kafka"], target_version: "0.170.0" };
    vi.mocked(fleet.updateSettings).mockResolvedValue({ data: body } as any);
    await mountSettings();
    await edit("kafka", "0.170.0");
    expect(selected()).toBe("debug,file,kafka");
    await save();
    expect(fleet.updateSettings).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
      body,
    );
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("re-seeds the form from the saved response", async () => {
    vi.mocked(fleet.updateSettings).mockResolvedValue({
      data: { restricted_components: ["debug", "file"], target_version: "0.170.0" },
    } as any);
    await mountSettings();
    vi.mocked(fleet.getSettings).mockReturnValue(new Promise(() => {}));
    await edit(null, "v0.170.0");
    await save();
    expect((targetField().element as HTMLInputElement).value).toBe("0.170.0");
    expect(saveButton().attributes("disabled")).toBeDefined();
  });

  it("sends null when the target is cleared", async () => {
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { restricted_components: [], target_version: "0.170.0" },
    } as any);
    vi.mocked(fleet.updateSettings).mockResolvedValue({
      data: { restricted_components: [], target_version: null },
    } as any);
    await mountSettings();
    await edit(null, "");
    await save();
    expect(fleet.updateSettings).toHaveBeenCalledWith(store.state.selectedOrganization.identifier, {
      restricted_components: [],
      target_version: null,
    });
  });

  it("toasts the server's 400 message and keeps the form", async () => {
    const message = "target_version must be MAJOR.MINOR.PATCH, for example 0.162.0";
    vi.mocked(fleet.updateSettings).mockRejectedValue({
      response: { status: 400, data: { code: 400, message } },
    });
    await mountSettings();
    await edit(null, "0.170");
    await save();
    expect(toastMock).toHaveBeenCalledWith({ variant: "error", message });
    expect((targetField().element as HTMLInputElement).value).toBe("0.170");
    expect(saveButton().attributes("disabled")).toBeUndefined();
  });

  it("toasts the generic failure on a network error", async () => {
    vi.mocked(fleet.updateSettings).mockRejectedValue(new Error("Network Error"));
    await mountSettings();
    await edit(null, "0.170.0");
    await save();
    expect(toastMock).toHaveBeenCalledWith({ variant: "error", message: "The request failed" });
  });

  it("shows the no-access empty state instead of the controls on a 403", async () => {
    vi.mocked(fleet.getSettings).mockRejectedValue({ response: { status: 403 } });
    await mountSettings();
    const denied = wrapper.find(sel("no-access"));
    expect(denied.find('[data-test="o2-empty-state"]').exists()).toBe(true);
    expect(denied.text()).toContain("You do not have access to Fleet Manager settings");
    expect(wrapper.find(sel("restricted-trigger")).exists()).toBe(false);
    expect(targetField().exists()).toBe(false);
    expect(saveButton().exists()).toBe(false);
  });

  it("refetches every fleet read after a successful save", async () => {
    vi.mocked(fleet.updateSettings).mockResolvedValue({
      data: { restricted_components: ["debug", "file"], target_version: "0.170.0" },
    } as any);
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    try {
      await mountSettings();
      await edit(null, "0.170.0");
      await save();
      expect(spy).toHaveBeenCalledWith({
        queryKey: fleetKeys.all(store.state.selectedOrganization.identifier),
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("follows a refetch while untouched and keeps unsaved edits through one", async () => {
    await mountSettings();
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { restricted_components: ["pprof"], target_version: "0.165.0" },
    } as any);
    await queryClient.invalidateQueries({ queryKey: fleetKeys.settings(org()) });
    await settle();
    expect(selected()).toBe("pprof");
    expect((targetField().element as HTMLInputElement).value).toBe("0.165.0");

    await edit("kafka", "0.170.0");
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { restricted_components: ["zpages"], target_version: "0.180.0" },
    } as any);
    await queryClient.invalidateQueries({ queryKey: fleetKeys.settings(org()) });
    await settle();
    expect(fleet.getSettings).toHaveBeenCalledTimes(3);
    expect(selected()).toBe("pprof,kafka");
    expect((targetField().element as HTMLInputElement).value).toBe("0.170.0");
    expect(saveButton().attributes("disabled")).toBeUndefined();
  });

  it("drops unsaved edits when the org changes", async () => {
    const orgA = store.state.selectedOrganization;
    await mountSettings();
    await edit("kafka", "0.170.0");
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { restricted_components: ["pprof"], target_version: null },
    } as any);
    store.commit("setSelectedOrganization", { ...orgA, identifier: "org-b" });
    try {
      await settle();
      expect(fleet.getSettings).toHaveBeenLastCalledWith("org-b");
      expect(selected()).toBe("pprof");
      expect((targetField().element as HTMLInputElement).value).toBe("");
    } finally {
      store.commit("setSelectedOrganization", orgA);
    }
  });

  it("shows a spinner, not an empty form, while the settings load", async () => {
    vi.mocked(fleet.getSettings).mockReturnValue(new Promise(() => {}));
    await mountSettings();
    expect(wrapper.find(sel("loading")).exists()).toBe(true);
    expect(wrapper.find(sel("restricted-trigger")).exists()).toBe(false);
    expect(targetField().exists()).toBe(false);
    expect(saveButton().exists()).toBe(false);
  });

  it("shows a load failure, not an empty form, when the settings cannot be read", async () => {
    vi.mocked(fleet.getSettings).mockRejectedValue({ response: { status: 500 } });
    await mountSettings();
    const failed = wrapper.find(sel("load-failed"));
    expect(failed.find('[data-test="o2-empty-state"]').exists()).toBe(true);
    expect(failed.text()).toContain("Could not load the Fleet Manager settings");
    expect(wrapper.find(sel("restricted-trigger")).exists()).toBe(false);
    expect(targetField().exists()).toBe(false);
    expect(saveButton().exists()).toBe(false);
  });

  it("retries a failed load from the load-failure state", async () => {
    vi.mocked(fleet.getSettings).mockRejectedValueOnce({ response: { status: 500 } });
    await mountSettings();
    await wrapper.find(sel("load-failed")).find("button").trigger("click");
    await settle();
    expect(fleet.getSettings).toHaveBeenCalledTimes(2);
    expect(wrapper.find(sel("load-failed")).exists()).toBe(false);
    expect(selected()).toBe("debug,file");
  });

  function deferredSave() {
    let resolve!: (v: unknown) => void;
    vi.mocked(fleet.updateSettings).mockReturnValue(new Promise((r) => (resolve = r)) as any);
    return (data: unknown) => resolve({ data });
  }

  it("locks both fields while a save is in flight", async () => {
    const finish = deferredSave();
    await mountSettings();
    await edit(null, "0.170.0");
    await saveButton().trigger("click");
    await flushPromises();
    expect(wrapper.find(sel("restricted-trigger")).attributes("disabled")).toBeDefined();
    expect(targetField().attributes("disabled")).toBeDefined();
    finish({ restricted_components: ["debug", "file"], target_version: "0.170.0" });
    await settle();
    expect(wrapper.find(sel("restricted-trigger")).attributes("disabled")).toBeUndefined();
    expect(targetField().attributes("disabled")).toBeUndefined();
  });

  it("does not fill another org's form with a save that finishes after an org switch", async () => {
    const orgA = store.state.selectedOrganization;
    const finish = deferredSave();
    await mountSettings();
    await edit(null, "0.170.0");
    await saveButton().trigger("click");
    await flushPromises();
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { restricted_components: ["pprof"], target_version: null },
    } as any);
    store.commit("setSelectedOrganization", { ...orgA, identifier: "org-b" });
    try {
      await settle();
      finish({ restricted_components: ["debug", "file"], target_version: "0.170.0" });
      await settle();
      expect(fleet.updateSettings).toHaveBeenCalledWith(orgA.identifier, {
        restricted_components: ["debug", "file"],
        target_version: "0.170.0",
      });
      expect(selected()).toBe("pprof");
      expect((targetField().element as HTMLInputElement).value).toBe("");
    } finally {
      store.commit("setSelectedOrganization", orgA);
    }
  });

  it("shows the latest server settings once reverted edits make the form clean", async () => {
    await mountSettings();
    await edit(null, "0.170.0");
    vi.mocked(fleet.getSettings).mockResolvedValue({
      data: { restricted_components: ["pprof"], target_version: "0.165.0" },
    } as any);
    await queryClient.invalidateQueries({ queryKey: fleetKeys.settings(org()) });
    await settle();
    expect((targetField().element as HTMLInputElement).value).toBe("0.170.0");
    await edit(null, "");
    expect(selected()).toBe("pprof");
    expect((targetField().element as HTMLInputElement).value).toBe("0.165.0");
    expect(saveButton().attributes("disabled")).toBeDefined();
  });

  it("shows the audit load error with a retry when it fails", async () => {
    vi.mocked(fleet.listAudit).mockRejectedValue(new Error("boom"));
    await mountSettings();
    expect(wrapper.find('[data-test="fleet-settings-audit-error"]').exists()).toBe(true);
    vi.mocked(fleet.listAudit).mockResolvedValue({ data: { items: [event()] } } as any);
    wrapper
      .find('[data-test="fleet-settings-audit-error"]')
      .findComponent({ name: "OEmptyState" })
      .vm.$emit("action", "retry");
    await settle();
    expect(fleet.listAudit).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-test="fleet-settings-audit-error"]').exists()).toBe(false);
  });
});
