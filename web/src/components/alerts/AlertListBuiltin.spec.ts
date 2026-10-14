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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

vi.mock("@/aws-exports", () => ({
  default: { isCloud: "false", isEnterprise: "false" },
}));

vi.mock("@/services/alerts", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      listByFolderId: vi.fn(),
      get_by_alert_id: vi.fn(),
      toggle_state_by_alert_id: vi.fn(),
      delete_by_alert_id: vi.fn(),
      getHistory: vi.fn(),
      export_by_id: vi.fn(),
    },
  });
});
vi.mock("@/services/alert_templates", () => ({ default: { list: vi.fn() } }));
vi.mock("@/services/alert_destination", () => ({ default: { list: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: () => () => {} }));

import AlertList from "@/components/alerts/AlertList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import AlertService from "@/services/alerts";
import TemplateService from "@/services/alert_templates";
import DestinationService from "@/services/alert_destination";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const alertsSvc = AlertService as any;

/** A scheduled alert in the shape the list API returns. */
const listAlert = (overrides: Record<string, any> = {}) => ({
  alert_id: "plain-1",
  name: "plain-alert",
  alert_type: "scheduled",
  is_real_time: false,
  enabled: true,
  condition: { type: "sql", sql: "select 1" },
  description: "",
  owner: "o@ex.com",
  trigger_condition: { period: 15, frequency: 300, frequency_type: "minutes", cron: "" },
  last_triggered_at: 0,
  last_satisfied_at: 0,
  folder_id: "default",
  folder_name: "Default",
  ...overrides,
});

const builtinAlert = () =>
  listAlert({
    alert_id: "builtin-1",
    name: "o2_alert_evaluation_failures",
    stream_name: "triggers",
    stream_type: "logs",
    enabled: false,
    folder_id: "system",
    folder_name: "system",
    is_builtin: true,
  });

async function mountList(rows: any[]) {
  alertsSvc.listByFolderId = vi.fn().mockResolvedValue({ data: { list: rows } });
  const wrapper = mount(AlertList, {
    attachTo: node,
    global: {
      plugins: [i18n, store, router],
      stubs: {
        FolderList: { template: '<div data-test="stub-folder-list"></div>' },
        MoveAcrossFolders: true,
        AlertHistoryDrawer: true,
        ImportAlert: true,
        AddAlert: true,
        SelectFolderDropDown: true,
        ConfirmDialog: true,
        // Render the row menu inline, so its real items are what gets asserted.
        ODropdown: {
          name: "ODropdown",
          template: '<div class="o-dropdown-stub"><slot name="trigger" /><slot /></div>',
        },
        ODropdownItem: {
          name: "ODropdownItem",
          props: { disabled: { type: Boolean, default: false } },
          emits: ["select"],
          template:
            '<button class="o-dropdown-item-stub" :disabled="disabled" ' +
            "@click=\"$emit('select')\"><slot /></button>",
        },
        ODropdownSeparator: true,
      },
    },
  });
  (wrapper.vm as any).router.currentRoute.value.name = "alertList";
  (wrapper.vm as any).router.currentRoute.value.query = {} as any;
  await flushPromises();
  // Drive the real fetch and row mapper: the mapper rebuilds each row field by field.
  await (wrapper.vm as any).getAlertsFn(store, "default");
  await flushPromises();
  // OTable holds its skeleton for ~50ms so it does not flash on fast responses.
  await new Promise((r) => setTimeout(r, 75));
  await flushPromises();
  return wrapper;
}

const rowOf = (wrapper: any, alertId: string) =>
  (wrapper.vm.filteredResults as any[]).find((r: any) => r.alert_id === alertId);

const nameCell = (wrapper: any, alertName: string) =>
  wrapper.find(`[data-test="alert-list-${alertName}-name-cell"]`);

const deleteItem = (wrapper: any, alertName: string) =>
  wrapper.find(`[data-test="alert-list-${alertName}-delete-alert"]`);

describe("AlertList — built-in alerts", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (store.state as any).organizationData.foldersByType = {
      alerts: [{ folderId: "default", name: "Default" }],
    };
    (store.state as any).organizationData.allAlertsListByFolderId = {};
    (store.state as any).alertListFilters = {
      searchQuery: "",
      filterQuery: "",
      searchAcrossFolders: false,
    };
    vi.mocked(TemplateService).list.mockResolvedValue({ data: [] } as any);
    vi.mocked(DestinationService).list.mockResolvedValue({ data: [] } as any);
    alertsSvc.get_by_alert_id = vi.fn().mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("badges built-in rows as system, and only them", async () => {
    wrapper = await mountList([listAlert(), builtinAlert()]);
    expect(rowOf(wrapper, "builtin-1").is_builtin).toBe(true);
    expect(rowOf(wrapper, "plain-1").is_builtin).toBe(false);
    const badge = nameCell(wrapper, "o2_alert_evaluation_failures").find(
      '[data-test="alert-list-o2_alert_evaluation_failures-builtin-badge"]',
    );
    expect(badge.exists()).toBe(true);
    // Spelled out: a missing key makes t() echo the key, which a t() comparison would accept.
    expect(badge.text()).toBe("System");
    expect(
      nameCell(wrapper, "plain-alert")
        .find('[data-test="alert-list-plain-alert-builtin-badge"]')
        .exists(),
    ).toBe(false);
  });

  it("disables deleting a built-in and says why, but not deleting other alerts", async () => {
    wrapper = await mountList([listAlert(), builtinAlert()]);
    const builtinDelete = deleteItem(wrapper, "o2_alert_evaluation_failures");
    expect(builtinDelete.attributes("disabled")).toBeDefined();
    expect(builtinDelete.text()).toBe("Built-in alert, cannot be deleted");
    expect(deleteItem(wrapper, "plain-alert").attributes("disabled")).toBeUndefined();
  });

  it("keeps built-ins out of the selection that bulk actions use", async () => {
    wrapper = await mountList([listAlert(), builtinAlert()]);
    expect(wrapper.vm.isAlertRowSelectable(rowOf(wrapper, "builtin-1"))).toBe(false);
    expect(wrapper.vm.isAlertRowSelectable(rowOf(wrapper, "plain-1"))).toBe(true);
    wrapper.vm.selectedAlertIds = ["plain-1", "builtin-1"];
    await flushPromises();
    expect(wrapper.vm.selectedAlerts.map((a: any) => a.alert_id)).toEqual(["plain-1"]);
  });
});
