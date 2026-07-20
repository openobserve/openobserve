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

// WorkflowLinkAlertsDialog — "Link Workflow To Alerts". The link is OWNED by the
// ALERT (`alert.workflows: string[]`), so linking = for each selected alert: GET
// it, add this workflow id, PUT it back. The selection ACCUMULATES across
// folders (the alerts dropdown only edits the current folder's slice).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: any[]) => mockToast(...a),
}));

const mockList = vi.fn();
const mockGetAlert = vi.fn();
const mockUpdateAlert = vi.fn();
vi.mock("@/services/alerts", () => ({
  default: {
    listByFolderId: (...a: any[]) => mockList(...a),
    get_by_alert_id: (...a: any[]) => mockGetAlert(...a),
    update_by_alert_id: (...a: any[]) => mockUpdateAlert(...a),
  },
}));

import WorkflowLinkAlertsDialog from "./WorkflowLinkAlertsDialog.vue";

// ── stubs ────────────────────────────────────────────────────────────────────
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "primaryButtonLabel",
    "primaryButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLabel",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div class="o-dialog">
      <button class="dlg-primary" :disabled="primaryButtonDisabled"
        :data-loading="String(!!primaryButtonLoading)"
        @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button class="dlg-secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button class="dlg-dismiss" @click="$emit('update:open', false)">x</button>
      <slot />
    </div>`,
};
const OSelectStub = {
  name: "OSelect",
  props: {
    modelValue: {},
    options: { default: () => [] },
    label: {},
    loading: Boolean,
    multiple: Boolean,
    searchable: Boolean,
    placeholder: {},
  },
  emits: ["update:modelValue"],
  template: `<div class="o-select"><slot name="empty" /></div>`,
};
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled"],
  template: `<button :disabled="disabled"><slot /></button>`,
};
const OIconStub = {
  name: "OIcon",
  props: ["name", "size"],
  template: `<i class="o-icon" :data-icon="name" />`,
};
const OTextStub = {
  name: "OText",
  props: ["variant", "as"],
  template: `<span class="o-text"><slot /></span>`,
};

const globalConfig = {
  plugins: [i18n, store],
  stubs: {
    ODialog: ODialogStub,
    OSelect: OSelectStub,
    OButton: OButtonStub,
    OIcon: OIconStub,
    OText: OTextStub,
  },
};

const ALERTS = [
  { alert_id: "a1", name: "High Errors", folder_id: "f-ops", folder_name: "Ops" },
  { alert_id: "a2", name: "Latency", folder_id: "f-ops", folder_name: "Ops" },
  { alert_id: 3, name: "Disk", folder_id: "default", folder_name: "default" },
  { alert_id: "a4", name: "Billing", folder_id: "f-biz", folder_name: "Biz" },
  {
    alert_id: "a5",
    name: "Anomaly",
    folder_id: "default",
    folder_name: "default",
    alert_type: "anomaly_detection",
  },
];

const mountDialog = async (props: Record<string, any> = {}) => {
  const wrapper = mount(WorkflowLinkAlertsDialog, {
    global: globalConfig,
    props: { workflowId: "wf1", workflowName: "My Workflow", ...props },
  });
  await flushPromises();
  return wrapper;
};

const selects = (w: any) => w.findAllComponents(OSelectStub as any);
const folderSelect = (w: any) => selects(w)[0];
const alertSelect = (w: any) => selects(w)[1];
const primary = (w: any) => w.find(".dlg-primary");

// Pick alerts in the CURRENT folder (the alerts dropdown's slice).
const pick = async (w: any, ids: string[]) => {
  alertSelect(w).vm.$emit("update:modelValue", ids);
  await nextTick();
};
const switchFolder = async (w: any, folderId: string) => {
  folderSelect(w).vm.$emit("update:modelValue", folderId);
  await nextTick();
};

describe("WorkflowLinkAlertsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ data: { list: ALERTS } });
    mockGetAlert.mockImplementation((_org: string, id: string) =>
      Promise.resolve({ data: { id, name: `alert-${id}`, workflows: [] } }),
    );
    mockUpdateAlert.mockResolvedValue({ data: {} });
  });

  describe("loading alerts", () => {
    it("lists every alert across folders in one v2 call", async () => {
      await mountDialog();
      // page_num/page_size are 0 because the v2 helper ignores them (it never
      // puts them in the URL) and the endpoint returns ALL matches when
      // page_size is absent. Pinned so nobody reintroduces a plausible-looking
      // page size here, which would read as a silent truncation of the picker.
      expect(mockList).toHaveBeenCalledWith(
        0,
        0,
        "name",
        false,
        "",
        "default",
        "",
      );
      // The 7th arg is the folder id: empty = every folder, not just "default".
      expect(mockList.mock.calls[0][6]).toBe("");
      expect(mockList).toHaveBeenCalledTimes(1);
    });

    it("drops anomaly-detection alerts (they use a separate update path)", async () => {
      const wrapper = await mountDialog();
      await switchFolder(wrapper, "default");
      const opts = alertSelect(wrapper).props("options") as any[];
      expect(opts.map((o) => o.label)).toEqual(["Disk"]);
    });

    it("derives folders from the alerts, default first then alphabetical", async () => {
      const wrapper = await mountDialog();
      expect(folderSelect(wrapper).props("options")).toEqual([
        { label: "default", value: "default" },
        { label: "Biz", value: "f-biz" },
        { label: "Ops", value: "f-ops" },
      ]);
    });

    it("selects the first folder so the alerts dropdown is populated", async () => {
      const wrapper = await mountDialog();
      expect(folderSelect(wrapper).props("modelValue")).toBe("default");
    });

    it("falls back to the default folder when an alert carries none", async () => {
      mockList.mockResolvedValue({
        data: { list: [{ alert_id: "x", name: "Orphan" }] },
      });
      const wrapper = await mountDialog();
      expect(folderSelect(wrapper).props("options")).toEqual([
        { label: "default", value: "default" },
      ]);
    });

    it("shows the empty state when the org has no alerts", async () => {
      mockList.mockResolvedValue({ data: { list: [] } });
      const wrapper = await mountDialog();
      expect(wrapper.text()).toContain(
        i18n.global.t("workflow.linkAlerts.empty"),
      );
      expect(selects(wrapper)).toHaveLength(0);
    });

    it("tolerates a response with no list field", async () => {
      mockList.mockResolvedValue({ data: {} });
      const wrapper = await mountDialog();
      expect(wrapper.text()).toContain(
        i18n.global.t("workflow.linkAlerts.empty"),
      );
    });

    it("shows the load-error state (and no empty state) when the list call fails", async () => {
      mockList.mockRejectedValue(new Error("boom"));
      const wrapper = await mountDialog();
      expect(wrapper.text()).toContain(
        i18n.global.t("workflow.linkAlerts.loadError"),
      );
      expect(wrapper.text()).not.toContain(
        i18n.global.t("workflow.linkAlerts.empty"),
      );
      expect(selects(wrapper)).toHaveLength(0);
    });

    it("names the workflow in the intro copy", async () => {
      const wrapper = await mountDialog({ workflowName: "Nightly Sync" });
      expect(wrapper.text()).toContain("Nightly Sync");
    });

    it("marks the alerts dropdown as multi-select + searchable", async () => {
      const wrapper = await mountDialog();
      expect(alertSelect(wrapper).props("multiple")).toBe(true);
      expect(alertSelect(wrapper).props("searchable")).toBe(true);
      expect(alertSelect(wrapper).props("placeholder")).toBe(
        i18n.global.t("workflow.linkAlerts.alertsPlaceholder"),
      );
      // per-folder empty slot
      expect(alertSelect(wrapper).text()).toContain(
        i18n.global.t("workflow.linkAlerts.noAlertsInFolder"),
      );
    });
  });

  describe("selection (accumulates across folders)", () => {
    it("only offers the current folder's alerts", async () => {
      const wrapper = await mountDialog();
      await switchFolder(wrapper, "f-ops");
      expect(alertSelect(wrapper).props("options")).toEqual([
        { label: "High Errors", value: "a1" },
        { label: "Latency", value: "a2" },
      ]);
    });

    it("keeps selections made in other folders when the folder changes", async () => {
      const wrapper = await mountDialog();
      await switchFolder(wrapper, "f-ops");
      await pick(wrapper, ["a1"]);
      await switchFolder(wrapper, "f-biz");

      // the dropdown's value is only the CURRENT folder's slice…
      expect(alertSelect(wrapper).props("modelValue")).toEqual([]);
      await pick(wrapper, ["a4"]);
      expect(alertSelect(wrapper).props("modelValue")).toEqual(["a4"]);

      // …but the global selection kept a1 from the other folder
      expect(wrapper.text()).toContain(
        i18n.global.t("workflow.linkAlerts.selectedCount", { count: 2 }),
      );
      expect(
        wrapper.find('[data-test="workflow-link-alerts-chip-a1"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="workflow-link-alerts-chip-a4"]').exists(),
      ).toBe(true);
    });

    it("deselecting in a folder only clears that folder's slice", async () => {
      const wrapper = await mountDialog();
      await switchFolder(wrapper, "f-ops");
      await pick(wrapper, ["a1", "a2"]);
      await switchFolder(wrapper, "f-biz");
      await pick(wrapper, ["a4"]);

      await switchFolder(wrapper, "f-ops");
      await pick(wrapper, ["a2"]); // drop a1
      expect(
        wrapper.find('[data-test="workflow-link-alerts-chip-a1"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="workflow-link-alerts-chip-a4"]').exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain(
        i18n.global.t("workflow.linkAlerts.selectedCount", { count: 2 }),
      );
    });

    it("removes a single alert from its chip", async () => {
      const wrapper = await mountDialog();
      await switchFolder(wrapper, "f-ops");
      await pick(wrapper, ["a1", "a2"]);

      await wrapper
        .find('[data-test="workflow-link-alerts-chip-a1"] .o-icon')
        .trigger("click");
      expect(
        wrapper.find('[data-test="workflow-link-alerts-chip-a1"]').exists(),
      ).toBe(false);
      expect(alertSelect(wrapper).props("modelValue")).toEqual(["a2"]);
    });

    it("clears the whole cross-folder selection", async () => {
      const wrapper = await mountDialog();
      await switchFolder(wrapper, "f-ops");
      await pick(wrapper, ["a1", "a2"]);

      const clear = wrapper.find('[data-test="workflow-link-alerts-clear"]');
      expect(clear.attributes("disabled")).toBeUndefined();
      await clear.trigger("click");

      expect(wrapper.findAll('[data-test^="workflow-link-alerts-chip-"]')).toHaveLength(0);
      expect(wrapper.text()).toContain(
        i18n.global.t("workflow.linkAlerts.noneSelected"),
      );
      expect(clear.attributes("disabled")).toBeDefined();
    });

    it("labels the primary button with the count, and disables it with none selected", async () => {
      const wrapper = await mountDialog();
      expect(primary(wrapper).text()).toBe(
        i18n.global.t("workflow.linkAlerts.link"),
      );
      expect(primary(wrapper).attributes("disabled")).toBeDefined();

      await switchFolder(wrapper, "f-ops");
      await pick(wrapper, ["a1", "a2"]);
      expect(primary(wrapper).text()).toBe(
        i18n.global.t("workflow.linkAlerts.linkN", { count: 2 }),
      );
      expect(primary(wrapper).attributes("disabled")).toBeUndefined();
    });

    it("coerces a numeric alert_id to a string id", async () => {
      const wrapper = await mountDialog();
      await pick(wrapper, ["3"]); // default folder holds the numeric-id alert
      expect(
        wrapper.find('[data-test="workflow-link-alerts-chip-3"]').text(),
      ).toContain("Disk");
    });
  });

  describe("linking (reconciles alert.workflows)", () => {
    const selectOps = async (wrapper: any, ids: string[]) => {
      await switchFolder(wrapper, "f-ops");
      await pick(wrapper, ids);
    };

    it("adds the workflow id to each selected alert and PUTs it back with its folder", async () => {
      const wrapper = await mountDialog();
      await selectOps(wrapper, ["a1", "a2"]);
      await primary(wrapper).trigger("click");
      await flushPromises();

      expect(mockGetAlert).toHaveBeenCalledTimes(2);
      expect(mockGetAlert).toHaveBeenNthCalledWith(1, "default", "a1");
      expect(mockUpdateAlert).toHaveBeenNthCalledWith(
        1,
        "default",
        expect.objectContaining({ id: "a1", workflows: ["wf1"] }),
        "f-ops",
      );
      expect(mockUpdateAlert).toHaveBeenNthCalledWith(
        2,
        "default",
        expect.objectContaining({ id: "a2", workflows: ["wf1"] }),
        "f-ops",
      );
      expect(mockToast).toHaveBeenCalledWith({
        message: i18n.global.t("workflow.linkAlerts.linkSuccess", { count: 2 }),
        variant: "success",
      });
      expect(wrapper.emitted("linked")).toHaveLength(1);
    });

    it("appends to the alert's existing workflows without dropping them", async () => {
      mockGetAlert.mockResolvedValue({
        data: { id: "a1", workflows: ["wf-other"] },
      });
      const wrapper = await mountDialog();
      await selectOps(wrapper, ["a1"]);
      await primary(wrapper).trigger("click");
      await flushPromises();

      expect(mockUpdateAlert.mock.calls[0][1].workflows).toEqual([
        "wf-other",
        "wf1",
      ]);
    });

    it("is idempotent — an already-linked alert is not double-added", async () => {
      mockGetAlert.mockResolvedValue({ data: { id: "a1", workflows: ["wf1"] } });
      const wrapper = await mountDialog();
      await selectOps(wrapper, ["a1"]);
      await primary(wrapper).trigger("click");
      await flushPromises();
      expect(mockUpdateAlert.mock.calls[0][1].workflows).toEqual(["wf1"]);
    });

    it("replaces a missing / non-array workflows field with a fresh list", async () => {
      mockGetAlert.mockResolvedValue({ data: { id: "a1", workflows: null } });
      const wrapper = await mountDialog();
      await selectOps(wrapper, ["a1"]);
      await primary(wrapper).trigger("click");
      await flushPromises();
      expect(mockUpdateAlert.mock.calls[0][1].workflows).toEqual(["wf1"]);
    });

    it("warns with a partial result when some alerts fail", async () => {
      mockUpdateAlert.mockImplementation((_o: string, alert: any) =>
        alert.id === "a2"
          ? Promise.reject(new Error("409"))
          : Promise.resolve({ data: {} }),
      );
      const wrapper = await mountDialog();
      await selectOps(wrapper, ["a1", "a2"]);
      await primary(wrapper).trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: i18n.global.t("workflow.linkAlerts.linkPartial", {
          ok: 1,
          failed: 1,
        }),
        variant: "warning",
      });
      expect(wrapper.emitted("linked")).toHaveLength(1);
    });

    // Nothing linked is NOT a terminal outcome: the parent routes away on `linked`,
    // so emitting it here would drop the user back on the list with an error toast
    // and their selection gone. The dialog must stay open so they can retry.
    it("errors when every alert fails (incl. a failed GET), and does not emit linked", async () => {
      mockGetAlert.mockRejectedValue(new Error("404"));
      const wrapper = await mountDialog();
      await selectOps(wrapper, ["a1"]);
      await primary(wrapper).trigger("click");
      await flushPromises();

      expect(mockUpdateAlert).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith({
        message: i18n.global.t("workflow.linkAlerts.linkError"),
        variant: "error",
      });
      expect(wrapper.emitted("linked")).toBeUndefined();
      expect(wrapper.emitted("close")).toBeUndefined();
    });

    it("keeps the selection intact after a total failure so the user can retry", async () => {
      mockGetAlert.mockRejectedValue(new Error("404"));
      const wrapper = await mountDialog();
      await selectOps(wrapper, ["a1"]);
      await primary(wrapper).trigger("click");
      await flushPromises();

      // still selected, not linking, and the primary button is live again
      expect((wrapper.vm as any).selected).toEqual(["a1"]);
      expect((wrapper.vm as any).linking).toBe(false);

      // retry succeeds -> now it emits
      mockGetAlert.mockResolvedValue({ data: { alert_id: "a1", workflows: [] } });
      mockUpdateAlert.mockResolvedValue({ data: {} });
      await primary(wrapper).trigger("click");
      await flushPromises();

      expect(wrapper.emitted("linked")).toHaveLength(1);
    });

    it("shows the loading state and ignores a second click while linking", async () => {
      let resolve!: (v: any) => void;
      mockUpdateAlert.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      const wrapper = await mountDialog();
      await selectOps(wrapper, ["a1"]);
      await primary(wrapper).trigger("click");
      await flushPromises();

      expect(primary(wrapper).attributes("data-loading")).toBe("true");
      expect(primary(wrapper).attributes("disabled")).toBeDefined();

      await primary(wrapper).trigger("click");
      expect(mockGetAlert).toHaveBeenCalledTimes(1);

      resolve({ data: {} });
      await flushPromises();
      expect(primary(wrapper).attributes("data-loading")).toBe("false");
    });

    it("does nothing when nothing is selected", async () => {
      const wrapper = await mountDialog();
      await primary(wrapper).trigger("click");
      await flushPromises();
      expect(mockGetAlert).not.toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalled();
      expect(wrapper.emitted("linked")).toBeUndefined();
    });
  });

  describe("closing", () => {
    it("emits close from the Skip button", async () => {
      const wrapper = await mountDialog();
      expect(wrapper.find(".dlg-secondary").text()).toBe(
        i18n.global.t("workflow.linkAlerts.skip"),
      );
      await wrapper.find(".dlg-secondary").trigger("click");
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("emits close when the dialog dismisses itself (X / overlay)", async () => {
      const wrapper = await mountDialog();
      await wrapper.find(".dlg-dismiss").trigger("click");
      expect(wrapper.emitted("close")).toHaveLength(1);
    });

    it("stays open (no close emit) when open is set to true", async () => {
      const wrapper = await mountDialog();
      wrapper.findComponent(ODialogStub as any).vm.$emit("update:open", true);
      await nextTick();
      expect(wrapper.emitted("close")).toBeUndefined();
    });
  });
});
