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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi } from "vitest";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";

vi.mock("@/services/public_dashboards_admin", () => ({
  default: {
    list: vi.fn(),
    listOrg: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    refresh: vi.fn(),
    status: vi.fn(),
    statusBatch: vi.fn(),
    revoke: vi.fn(),
  },
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/services/dashboards");
vi.mock("@/utils/commons", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/commons")>()),
  updateDashboard: vi.fn(),
}));
vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));
const notify = vi.hoisted(() => ({ error: vi.fn(), positive: vi.fn() }));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: notify.error,
    showPositiveNotification: notify.positive,
  }),
}));

type StreamHandlers = { data: (payload: unknown, response: unknown) => void };
const stream = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: stream.fetch,
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

import admin, { type PublicLink } from "@/services/public_dashboards_admin";
import dashboardService from "@/services/dashboards";
import { getDashboard, updateDashboard } from "@/utils/commons";
import { convertDashboardSchemaVersion } from "@/utils/dashboard/convertDashboardSchemaVersion";
import PublicLinksPanel from "./PublicLinksPanel.vue";

const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "title",
    "size",
    "formId",
    "primaryButtonLabel",
    "primaryButtonDisabled",
    "secondaryButtonLabel",
    "closeGuard",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template:
    '<div><slot name="header" /><span class="drawer-primary-label">{{ primaryButtonLabel }}</span><button class="drawer-primary" @click="$emit(\'click:primary\')" /><slot /></div>',
};
const ODropdownStub = { name: "ODropdown", template: '<div><slot name="trigger" /><slot /></div>' };
const ODropdownItemStub = {
  name: "ODropdownItem",
  emits: ["select"],
  template: '<button v-bind="$attrs" @click="$emit(\'select\')"><slot /></button>',
};
// Render every cell slot per row, since the real table virtualises rows away in jsdom.
const OTableStub = {
  name: "OTable",
  props: ["data", "columns"],
  template:
    '<div><slot name="toolbar" /><slot name="toolbar-trailing" /><div v-for="row in data" :key="row.id"><div v-for="col in columns" :key="col.id"><slot :name="\'cell-\' + col.id" :row="row" /></div></div></div>',
};
const DateTimeStub = {
  name: "DateTime",
  props: ["defaultType", "defaultRelativeTime", "defaultAbsoluteTime", "defaultOpen"],
  emits: ["on:date-change"],
  template: "<div />",
};
const VVSStub = {
  name: "VariablesValueSelector",
  template: "<div />",
  props: [
    "variablesConfig",
    "variablesManager",
    "scope",
    "tabId",
    "panelId",
    "selectedTimeDate",
    "showDynamicFilters",
  ],
};

const link = (over: Partial<PublicLink> = {}): PublicLink => ({
  id: "l1",
  name: "NOC wall",
  slug: "abc",
  dashboard_id: "dash-1",
  dashboard_title: "Cloud",
  folder_id: "default",
  folder_name: "default",
  status: "live",
  enabled: true,
  time_range: {
    ranges: [
      { type: "relative", secs: 3600 },
      { type: "relative", secs: 86400 },
    ],
    default: { type: "relative", secs: 3600 },
  },
  frozen_variables: { env: "stage" },
  refresh_secs: 600,
  expires_at: null,
  published_by: "a@b.c",
  updated_by: null,
  created_at: 1,
  updated_at: 1,
  last_accessed_at: 1,
  access_count: 4,
  ...over,
});

const build = (props: Record<string, unknown> = {}, stubs: Record<string, unknown> = {}) =>
  mount(PublicLinksPanel, {
    props: {
      modelValue: true,
      dashboardId: "dash-1",
      variablesConfig: { list: [{ name: "env" }] },
      currentValues: { values: [{ name: "env", value: "prod" }] },
      ...props,
    },
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: {
        ODrawer: ODrawerStub,
        ODropdown: ODropdownStub,
        ODropdownItem: ODropdownItemStub,
        OTable: OTableStub,
        VariablesValueSelector: VVSStub,
        DateTime: DateTimeStub,
        ...stubs,
      },
    },
  });

// A DOM submit returns before the awaited onSubmit settles, so drive the form directly.
const submit = async (w: ReturnType<typeof build>) => {
  await (w.vm as unknown as { form: { handleSubmit: () => Promise<void> } }).form.handleSubmit();
  await flushPromises();
};

const has = (w: ReturnType<typeof build>, id: string) => w.find(`[data-test="${id}"]`).exists();

describe("PublicLinksPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it("opens on the create form when the dashboard has no links, and shows the new link", async () => {
    window.history.replaceState(null, "", "/web/dashboards");
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
    vi.mocked(admin.create).mockResolvedValue({ data: link({ slug: "new-slug" }) } as never);
    const w = build();
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-form")).toBe(true);

    await submit(w);
    expect(admin.create).not.toHaveBeenCalled();

    (
      w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
    ).form.setFieldValue("name", "NOC wall");
    await submit(w);

    expect(admin.create).toHaveBeenCalledWith("default", "dash-1", {
      name: "NOC wall",
      visibility: "public",
      time_range: {
        ranges: [
          { type: "relative", secs: 3600 },
          { type: "relative", secs: 86400 },
        ],
        default: { type: "relative", secs: 3600 },
      },
      frozen_variables: { env: "prod" },
      refresh_secs: 300,
      expires_at: null,
    });
    expect(has(w, "dashboards-public-links-panel-created")).toBe(true);
    expect(
      w.find('[data-test="dashboards-public-links-panel-created-url"] input').element,
    ).toHaveProperty("value", `${window.location.origin}/web/public/dashboards/new-slug`);
    expect(w.find('[data-test="dashboards-public-links-panel-created-build-note"]').text()).toBe(
      "Opening the public page builds the first result. Viewers after that share it for 10 minutes.",
    );

    await w.find('[data-test="dashboards-public-links-panel-back-btn"]').trigger("click");
    expect(has(w, "dashboards-public-links-panel-created")).toBe(false);
  });

  it("starts every opening with a clean form, even after a failed attempt", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
    const w = build();
    await flushPromises();
    await submit(w);
    expect(w.text()).toContain("Name is required");

    await w.setProps({ modelValue: false });
    await w.setProps({ modelValue: true });
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-form")).toBe(true);
    expect(w.text()).not.toContain("Name is required");
  });

  it("lists existing links and opens a blank form from the toolbar button", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    const w = build();
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-list")).toBe(true);
    expect(w.text()).toContain("NOC wall");
    expect(w.find(".drawer-primary-label").text()).toBe("");

    await w.find('[data-test="dashboards-public-links-panel-new-btn"]').trigger("click");
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-form")).toBe(true);
  });

  it("returns to the link list when the form is closed, and closes from the list", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    const w = build();
    await flushPromises();
    await w.find('[data-test="dashboards-public-links-panel-new-btn"]').trigger("click");
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-form")).toBe(true);

    const guard = w.findComponent({ name: "ODrawer" }).props("closeGuard") as () => boolean;
    expect(guard()).toBe(false);
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-list")).toBe(true);

    expect(guard()).toBe(true);
  });

  it("shows the globe on the list and a back button on the form that returns to it", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    const w = build();
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-back-btn")).toBe(false);

    await w.find('[data-test="dashboards-public-links-panel-l1-edit-btn"]').trigger("click");
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-form")).toBe(true);
    await w.find('[data-test="dashboards-public-links-panel-back-btn"]').trigger("click");
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-list")).toBe(true);
  });

  it("closes the drawer when the edit was opened from the org-wide list", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    vi.mocked(admin.update).mockResolvedValue({ data: link() } as never);
    const w = build({ editLinkId: "l1", variablesConfig: undefined });
    await flushPromises();
    const guard = w.findComponent({ name: "ODrawer" }).props("closeGuard") as () => boolean;
    expect(guard()).toBe(true);

    await submit(w);
    expect(w.emitted("update:modelValue")?.at(-1)).toEqual([false]);
  });

  it("opens the requested link's form every time, after editing another one", async () => {
    vi.mocked(admin.list).mockResolvedValue({
      data: { list: [link(), link({ id: "l2", name: "Second" })] },
    } as never);
    const w = build({ editLinkId: "l1", variablesConfig: undefined });
    await flushPromises();
    const nameValue = () =>
      (
        w.find('[data-test="dashboards-public-links-panel-name-input"] input')
          .element as HTMLInputElement
      ).value;
    expect(nameValue()).toBe("NOC wall");

    await w.setProps({ modelValue: false });
    await w.setProps({ modelValue: true, editLinkId: "l2" });
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-form")).toBe(true);
    expect(nameValue()).toBe("Second");
  });

  it("pauses a live link straight from its menu", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    vi.mocked(admin.pause).mockResolvedValue({ data: link({ enabled: false }) } as never);
    const w = build();
    await flushPromises();
    await w.find('[data-test="dashboards-public-links-panel-l1-pause-menu"]').trigger("click");
    await flushPromises();
    expect(admin.pause).toHaveBeenCalledWith("default", "dash-1", "l1");
    expect(notify.positive).toHaveBeenCalled();
  });

  it("revokes only after the confirmation dialog", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    vi.mocked(admin.revoke).mockResolvedValue({ data: {} } as never);
    const w = build();
    await flushPromises();
    const revoke = w.find('[data-test="dashboards-public-links-panel-l1-revoke-menu"]');

    confirm.mockResolvedValueOnce(false);
    await revoke.trigger("click");
    await flushPromises();
    expect(admin.revoke).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    await revoke.trigger("click");
    await flushPromises();
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Revoke and delete "NOC wall"?',
        confirmVariant: "destructive",
      }),
    );
    expect(admin.revoke).toHaveBeenCalledWith("default", "dash-1", "l1");
    expect(notify.positive).toHaveBeenCalled();
  });

  it("edits a link in place and keeps its frozen values without the pickers", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    vi.mocked(admin.update).mockResolvedValue({ data: link() } as never);
    const w = build({ editLinkId: "l1", variablesConfig: undefined });
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-form")).toBe(true);

    await submit(w);
    const [, , linkId, cfg] = vi.mocked(admin.update).mock.calls[0];
    expect(linkId).toBe("l1");
    expect(cfg.frozen_variables).toEqual({ env: "stage" });
  });

  it("creates a link at the default 5-minute refresh, with no interval to pick", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
    vi.mocked(admin.create).mockResolvedValue({ data: link() } as never);
    const w = build({ variablesConfig: undefined });
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-refresh-select")).toBe(false);
    (
      w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
    ).form.setFieldValue("name", "NOC wall");
    await submit(w);
    expect(vi.mocked(admin.create).mock.calls[0][2].refresh_secs).toBe(300);
  });

  it("keeps an edited link's own refresh when only its name changes", async () => {
    vi.mocked(admin.list).mockResolvedValue({
      data: { list: [link({ refresh_secs: 600 })] },
    } as never);
    vi.mocked(admin.update).mockResolvedValue({ data: link() } as never);
    const w = build({ editLinkId: "l1", variablesConfig: undefined });
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-refresh-select")).toBe(false);
    (
      w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
    ).form.setFieldValue("name", "Renamed wall");
    await submit(w);
    const cfg = vi.mocked(admin.update).mock.calls[0][3];
    expect(cfg.name).toBe("Renamed wall");
    expect(cfg.refresh_secs).toBe(600);
  });

  it("shows and freezes tab- and panel-scoped variables per scope", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
    vi.mocked(admin.create).mockResolvedValue({ data: link() } as never);
    const w = build({
      variablesConfig: {
        list: [
          { name: "env", type: "constant", value: "" },
          { name: "svc", type: "constant", value: "", scope: "tabs", tabs: ["t1"] },
          { name: "pod", type: "constant", value: "", scope: "panels", panels: ["p1"] },
        ],
      },
      dashboardData: {
        tabs: [{ tabId: "t1", name: "Overview", panels: [{ id: "p1", title: "CPU" }] }],
      },
      dashboardVariables: {
        getUrlParams: () => ({ "var-env": "prod", "var-svc.t.t1": "api", "var-pod.p.p1": "a" }),
      },
    });
    await flushPromises();
    expect(w.find('[data-test="dashboards-public-links-panel-tab-t1-variables"]').text()).toContain(
      "Tab: Overview",
    );
    expect(
      w.find('[data-test="dashboards-public-links-panel-panel-p1-variables"]').text(),
    ).toContain("Panel: CPU");

    (
      w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
    ).form.setFieldValue("name", "Scoped");
    await submit(w);
    expect(vi.mocked(admin.create).mock.calls[0][2].frozen_variables).toEqual({
      env: "prod",
      "svc.t.t1": "api",
      "pod.p.p1": "a",
    });
  });

  it("edits a link's scoped values from what it froze", async () => {
    const scoped = link({ frozen_variables: { env: "stage", "svc.t.t1": "web" } });
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [scoped] } } as never);
    vi.mocked(admin.update).mockResolvedValue({ data: scoped } as never);
    const w = build({
      editLinkId: "l1",
      variablesConfig: {
        list: [
          { name: "env", type: "constant", value: "" },
          { name: "svc", type: "constant", value: "", scope: "tabs", tabs: ["t1"] },
        ],
      },
      dashboardData: { tabs: [{ tabId: "t1", name: "Overview", panels: [] }] },
    });
    await flushPromises();
    await submit(w);
    expect(vi.mocked(admin.update).mock.calls[0][3].frozen_variables).toEqual({
      env: "stage",
      "svc.t.t1": "web",
    });
  });

  it("edits each range in its own picker row, flags bad rows and adds new ones", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    vi.mocked(admin.update).mockResolvedValue({ data: link() } as never);
    const w = build({ editLinkId: "l1" });
    await flushPromises();
    const pickers = () => w.findAllComponents({ name: "DateTime" });
    const pick = async (index: number, value: Record<string, unknown>) => {
      pickers()[index].vm.$emit("on:date-change", { userChangedValue: true, ...value });
      await flushPromises();
    };
    const rowError = (index: number) =>
      w.find(`[data-test="dashboards-public-links-panel-range-${index}-error"]`);
    expect(pickers().map((p) => p.props("defaultRelativeTime"))).toEqual(["1h", "1d"]);

    await w.find('[data-test="dashboards-public-links-panel-add-range-btn"]').trigger("click");
    expect(pickers()).toHaveLength(3);
    expect(pickers()[2].props("defaultRelativeTime")).toBe("1w");
    expect(pickers().map((p) => !!p.props("defaultOpen"))).toEqual([false, false, true]);

    // The picker's own mount emit repeats its value and must not overwrite the row.
    await pick(2, { userChangedValue: false, valueType: "relative", relativeTimePeriod: "1h" });
    expect(rowError(2).exists()).toBe(false);
    await pick(2, { valueType: "relative", relativeTimePeriod: "1h", startTime: 0, endTime: 0 });
    expect(rowError(2).text()).toBe("This time range is already in the list");

    const future = Date.now() * 1000 + 3_600_000_000;
    await pick(2, { valueType: "absolute", startTime: 1_000_000, endTime: future });
    expect(rowError(2).text()).toBe("An absolute time range must end in the past");
    await pick(2, { valueType: "absolute", startTime: 1_000_000, endTime: 86_401_000_000 });
    expect(rowError(2).exists()).toBe(false);

    await w.find('[data-test="dashboards-public-links-panel-range-0-remove-btn"]').trigger("click");
    await w.find('[data-test="dashboards-public-links-panel-range-0-remove-btn"]').trigger("click");
    await flushPromises();
    expect(pickers()).toHaveLength(1);

    await submit(w);
    const absolute = { type: "absolute", start: 1_000_000, end: 86_401_000_000 };
    expect(vi.mocked(admin.update).mock.calls[0][3].time_range).toEqual({
      ranges: [absolute],
      default: absolute,
    });
  });

  it("marks a link with an absolute range for refresh on its next view", async () => {
    const absolute = { type: "absolute" as const, start: 1_000_000, end: 86_401_000_000 };
    vi.mocked(admin.list).mockResolvedValue({
      data: { list: [link({ time_range: { ranges: [absolute], default: absolute } })] },
    } as never);
    vi.mocked(admin.refresh).mockResolvedValue({ data: link() } as never);
    const w = build();
    await flushPromises();
    expect(w.text()).toContain("Once");
    const item = w.find('[data-test="dashboards-public-links-panel-l1-refresh-menu"]');
    expect(item.text()).toBe("Refresh on next view");
    await item.trigger("click");
    await flushPromises();
    expect(admin.refresh).toHaveBeenCalledWith("default", "dash-1", "l1");
    expect(notify.positive).toHaveBeenCalledWith("The link refreshes on its next view");
  });

  it("shows no refresh field; the link keeps its stored interval", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    const w = build({ editLinkId: "l1" });
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-refresh-select")).toBe(false);
  });

  it.each([
    [
      {
        status: 403,
        data: { message: "you need edit access to this dashboard to manage its public links" },
      },
      "You need edit access to this dashboard to manage its public links.",
    ],
    [
      { status: 403, data: "Unauthorized Access" },
      "You don't have permission to change public links. Ask an admin.",
    ],
    [{ status: 500, data: { message: "boom" } }, "boom"],
  ])("explains a refused action in plain words (%o)", async (response, shown) => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    vi.mocked(admin.pause).mockRejectedValue({ response });
    const w = build();
    await flushPromises();
    await w.find('[data-test="dashboards-public-links-panel-l1-pause-menu"]').trigger("click");
    await flushPromises();
    expect(notify.error).toHaveBeenCalledWith(shown);
  });

  it("names the missing dashboard edit access when creating is refused for it", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
    vi.mocked(admin.create).mockRejectedValue({
      response: {
        status: 403,
        data: { message: "you need edit access to this dashboard to manage its public links" },
      },
    });
    const w = build({ variablesConfig: undefined });
    await flushPromises();
    (
      w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
    ).form.setFieldValue("name", "NOC wall");
    await submit(w);
    expect(notify.error).toHaveBeenCalledWith(
      "You need edit access to this dashboard to manage its public links.",
    );
  });

  it("saves an expired link without a new date and sends its expiry back unchanged", async () => {
    const expiresAt = Date.UTC(2020, 0, 1, 12) * 1000;
    const expired = link({ status: "expired", expires_at: expiresAt });
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [expired] } } as never);
    vi.mocked(admin.update).mockResolvedValue({ data: expired } as never);
    const w = build({ editLinkId: "l1", variablesConfig: undefined });
    await flushPromises();
    expect(w.findComponent({ name: "OFormDate" }).props("min")).toBe("2020-01-01");

    await submit(w);
    expect(admin.update).toHaveBeenCalledTimes(1);
    expect(vi.mocked(admin.update).mock.calls[0][3].expires_at).toBe(expiresAt);
  });

  it("still refuses a different past expiry when editing an expired link", async () => {
    const expired = link({ status: "expired", expires_at: Date.UTC(2020, 0, 1, 12) * 1000 });
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [expired] } } as never);
    const w = build({ editLinkId: "l1", variablesConfig: undefined });
    await flushPromises();

    (
      w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
    ).form.setFieldValue("expires", "2020-01-05");
    await submit(w);
    expect(admin.update).not.toHaveBeenCalled();
    expect(w.text()).toContain("Pick today or a later date");
  });

  it("keeps Create disabled until the variable pickers have loaded", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
    vi.mocked(admin.create).mockResolvedValue({ data: link() } as never);
    const w = build({
      variablesConfig: {
        list: [{ name: "env", type: "query_values", query_data: { stream: "s", field: "f" } }],
      },
      currentValues: { values: [] },
    });
    await flushPromises();
    const drawer = () => w.findComponent({ name: "ODrawer" });
    const vm = w.vm as unknown as {
      form: { setFieldValue: (k: string, v: string) => void };
      formVars: {
        variablesData: {
          global: Array<{
            isLoading: boolean;
            isVariableLoadingPending: boolean;
            isVariablePartialLoaded: boolean;
          }>;
        };
      };
    };
    vm.form.setFieldValue("name", "NOC wall");
    expect(drawer().props("primaryButtonDisabled")).toBe(true);
    await submit(w);
    expect(admin.create).not.toHaveBeenCalled();

    Object.assign(vm.formVars.variablesData.global[0], {
      isLoading: false,
      isVariableLoadingPending: false,
      isVariablePartialLoaded: true,
    });
    await flushPromises();
    expect(drawer().props("primaryButtonDisabled")).toBe(false);
    await submit(w);
    expect(admin.create).toHaveBeenCalledTimes(1);
  });

  it("locks a row's actions while its request runs, so a double click sends one", async () => {
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    vi.mocked(admin.pause).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const w = build();
    await flushPromises();
    const pauseBtn = () => w.find('[data-test="dashboards-public-links-panel-l1-pause-btn"]');
    const menuItem = (id: string) =>
      w.find(`[data-test="dashboards-public-links-panel-l1-${id}-menu"]`);

    await pauseBtn().trigger("click");
    await pauseBtn().trigger("click");
    await menuItem("pause").trigger("click");
    expect(admin.pause).toHaveBeenCalledTimes(1);
    expect(pauseBtn().attributes("aria-busy")).toBe("true");
    expect(menuItem("revoke").attributes("disabled")).toBeDefined();

    finish({ data: link({ enabled: false }) });
    await flushPromises();
    expect(pauseBtn().attributes("aria-busy")).toBeUndefined();
    expect(menuItem("revoke").attributes("disabled")).toBeUndefined();
  });

  it("tells an author without permission to ask an admin, not the server's text", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
    vi.mocked(admin.create).mockRejectedValue({
      response: { status: 403, data: { message: "Unauthorized Access" } },
    });
    const w = build({ variablesConfig: undefined });
    await flushPromises();
    (
      w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
    ).form.setFieldValue("name", "NOC wall");
    await submit(w);
    expect(notify.error).toHaveBeenCalledWith(
      "You don't have permission to create public links. Ask an admin.",
    );
  });

  it("tells an author who can't edit links the same way", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    vi.mocked(admin.update).mockRejectedValue({
      response: { status: 403, data: { message: "Unauthorized Access" } },
    });
    const w = build({ editLinkId: "l1", variablesConfig: undefined });
    await flushPromises();
    await submit(w);
    expect(notify.error).toHaveBeenCalledWith(
      "You don't have permission to edit public links. Ask an admin.",
    );
  });

  it("shows the no-permission view on a 403, still offering a new link", async () => {
    vi.mocked(admin.list).mockRejectedValue({ response: { status: 403 } });
    const w = build();
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-no-permission")).toBe(true);
    expect(w.find('[data-test="dashboards-public-links-panel-no-permission"]').text()).toContain(
      "New public link",
    );
    expect(w.find(".drawer-primary-label").text()).toBe("");
  });

  it("lets a user who may create but not list publish a link", async () => {
    vi.mocked(admin.list).mockRejectedValue({ response: { status: 403 } });
    vi.mocked(admin.create).mockResolvedValue({ data: link({ slug: "created-slug" }) } as never);
    const w = build({ variablesConfig: undefined });
    await flushPromises();
    await w
      .findComponent('[data-test="dashboards-public-links-panel-no-permission"]')
      .vm.$emit("action");
    await flushPromises();
    (
      w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
    ).form.setFieldValue("name", "Create only");
    await submit(w);
    expect(admin.create).toHaveBeenCalledTimes(1);
    expect(has(w, "dashboards-public-links-panel-created")).toBe(true);
  });

  describe("a dashboard stored at an older schema", () => {
    const OLDER_FORMAT =
      "This dashboard uses an older format. Open it and save it once, then publish.";
    // No variables block, which the viewer fills in on load, so a naive comparison would see an edit.
    const storedV3 = () => ({
      version: 3,
      title: "Legacy",
      dashboardId: "dash-old",
      tabs: [
        {
          tabId: "default",
          name: "Default",
          panels: [
            {
              type: "bar",
              id: "Panel_ID1",
              title: "Requests",
              layout: { i: 1, x: 0, y: 0, w: 12, h: 4 },
              queries: [{ customQuery: false, query: "", fields: { x: [], y: [], filter: [] } }],
            },
          ],
        },
        { tabId: "t2", name: "Second", panels: [] },
      ],
    });
    // The viewer's own load path; its own id keeps this loaded version away from other specs' dash-1.
    const load = async (version: number) => {
      const doc = version === 8 ? convertDashboardSchemaVersion(storedV3()) : storedV3();
      vi.mocked(dashboardService.get_Dashboard).mockResolvedValue({
        data: { version, [`v${version}`]: doc, hash: 42 },
      } as never);
      store.state.organizationData.allDashboardData = {};
      return getDashboard(store, "dash-old", "f1");
    };
    const publish = async (dashboardData: unknown) => {
      vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
      vi.mocked(admin.create).mockResolvedValue({ data: link() } as never);
      const w = build({
        dashboardId: "dash-old",
        variablesConfig: undefined,
        dashboardData,
        folderId: "f1",
      });
      await flushPromises();
      (
        w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
      ).form.setFieldValue("name", "Wall");
      await submit(w);
      return w;
    };

    it("publishes a current dashboard without saving it", async () => {
      const w = await publish(await load(8));
      expect(updateDashboard).not.toHaveBeenCalled();
      expect(admin.create).toHaveBeenCalledTimes(1);
      expect(has(w, "dashboards-public-links-panel-created")).toBe(true);
      expect(notify.positive).not.toHaveBeenCalled();
    });

    it("saves the upgraded copy once into its folder, then publishes and says so", async () => {
      const dashboard = await load(3);
      const w = await publish(dashboard);
      expect(updateDashboard).toHaveBeenCalledTimes(1);
      expect(updateDashboard).toHaveBeenCalledWith(store, "default", "dash-old", dashboard, "f1");
      expect(vi.mocked(updateDashboard).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(admin.create).mock.invocationCallOrder[0],
      );
      expect(has(w, "dashboards-public-links-panel-created")).toBe(true);
      expect(notify.positive).toHaveBeenCalledTimes(1);
      expect(notify.positive).toHaveBeenCalledWith("Dashboard upgraded to the current format.");
      expect(notify.error).not.toHaveBeenCalled();
    });

    it.each([
      ["a moved panel", (d: any) => (d.tabs[0].panels[0].layout.x = 48)],
      ["reordered tabs", (d: any) => d.tabs.reverse()],
    ])("refuses to save %s the author has not saved", async (_, edit) => {
      const dashboard = await load(3);
      edit(dashboard);
      await publish(dashboard);
      expect(updateDashboard).not.toHaveBeenCalled();
      expect(admin.create).not.toHaveBeenCalled();
      expect(notify.error).toHaveBeenCalledWith("Save your dashboard changes, then publish.");
    });

    it("does not publish when saving the dashboard fails, and shows why", async () => {
      vi.mocked(updateDashboard).mockRejectedValueOnce({
        response: { status: 409, data: { message: "Dashboard was modified by another user" } },
      });
      const w = await publish(await load(3));
      expect(admin.create).not.toHaveBeenCalled();
      expect(notify.error).toHaveBeenCalledWith("Dashboard was modified by another user");
      expect(has(w, "dashboards-public-links-panel-form")).toBe(true);
    });

    it("never saves the dashboard when editing an existing link", async () => {
      const dashboard = await load(3);
      vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
      vi.mocked(admin.update).mockResolvedValue({ data: link() } as never);
      const w = build({
        dashboardId: "dash-old",
        editLinkId: "l1",
        variablesConfig: undefined,
        dashboardData: dashboard,
        folderId: "f1",
      });
      await flushPromises();
      await submit(w);
      expect(admin.update).toHaveBeenCalledTimes(1);
      expect(updateDashboard).not.toHaveBeenCalled();
    });

    it("shows the server's older-format refusal as it is", async () => {
      vi.mocked(admin.create).mockRejectedValue({
        response: { status: 400, data: { message: OLDER_FORMAT } },
      });
      vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
      const w = build({
        dashboardId: "dash-old",
        variablesConfig: undefined,
        dashboardData: await load(8),
      });
      await flushPromises();
      (
        w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
      ).form.setFieldValue("name", "Wall");
      await submit(w);
      expect(notify.error).toHaveBeenCalledWith(OLDER_FORMAT);
    });
  });

  describe("query-based variables", () => {
    const qns = {
      name: "qns",
      type: "query_values",
      value: null,
      options: [],
      multiSelect: false,
      query_data: { stream: "s", field: "f", stream_type: "logs" },
    };
    const realPickers = (props: Record<string, unknown>) =>
      build(
        {
          variablesConfig: { list: [qns] },
          timeObj: { start_time: new Date(1e15), end_time: new Date(1e15 + 1e9) },
          ...props,
        },
        { VariablesValueSelector: false },
      );
    const create = async (w: ReturnType<typeof build>) => {
      (
        w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
      ).form.setFieldValue("name", "NOC wall");
      await submit(w);
      return vi.mocked(admin.create).mock.calls[0]?.[2].frozen_variables;
    };

    beforeEach(() => {
      vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
      vi.mocked(admin.create).mockResolvedValue({ data: link() } as never);
    });

    it("freezes the dashboard's value without its dropdown being opened", async () => {
      const w = realPickers({
        dashboardVariables: { getUrlParams: () => ({ "var-qns": "ingress-nginx" }) },
      });
      await flushPromises();
      expect(w.findComponent({ name: "ODrawer" }).props("primaryButtonDisabled")).toBe(false);
      expect(await create(w)).toEqual({ qns: "ingress-nginx" });
    });

    it("loads a variable the dashboard hadn't loaded yet instead of freezing null", async () => {
      const w = realPickers({ currentValues: { values: [{ name: "qns", value: null }] } });
      await flushPromises();
      expect(stream.fetch).toHaveBeenCalledTimes(1);
      expect(w.findComponent({ name: "ODrawer" }).props("primaryButtonDisabled")).toBe(true);

      const [payload, handlers] = stream.fetch.mock.calls[0] as [unknown, StreamHandlers];
      handlers.data(payload, {
        type: "search_response_hits",
        content: { results: { hits: [{ field: "f", values: [{ zo_sql_key: "ingress-nginx" }] }] } },
      });
      handlers.data(payload, { type: "end" });
      await flushPromises();
      expect(w.findComponent({ name: "ODrawer" }).props("primaryButtonDisabled")).toBe(false);
      expect(await create(w)).toEqual({ qns: "ingress-nginx" });
    });
  });

  it("finds a link by its slug or a pasted public URL", async () => {
    window.history.replaceState(null, "", "/web/dashboards");
    vi.mocked(admin.list).mockResolvedValue({
      data: { list: [link(), link({ id: "l2", name: "Other", slug: "xyz789" })] },
    } as never);
    const w = build();
    await flushPromises();
    const search = w.find('[data-test="dashboards-public-links-panel-search"] input');
    const shown = () =>
      ["l1", "l2"].filter((id) => has(w, `dashboards-public-links-panel-${id}-copy-btn`));

    await search.setValue(`${window.location.origin}/web/public/dashboards/xyz789?tab=main`);
    expect(shown()).toEqual(["l2"]);
    await search.setValue("ABC");
    expect(shown()).toEqual(["l1"]);
  });

  it("names every icon-only row action for screen readers", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    const w = build();
    await flushPromises();
    const label = (id: string) =>
      w.find(`[data-test="dashboards-public-links-panel-l1-${id}-btn"]`).attributes("aria-label");
    expect(["copy", "open", "edit", "pause", "menu"].map(label)).toEqual([
      i18n.global.t("dashboard.publicDashboard.copyLink"),
      i18n.global.t("dashboard.publicLinks.openPublicPage"),
      i18n.global.t("dashboard.publicLinks.editSettings"),
      i18n.global.t("dashboard.publicLinks.pause"),
      i18n.global.t("dashboard.moreActions"),
    ]);
  });

  it("offers a duplicated range once as the default", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
    const w = build();
    await flushPromises();
    (
      w.vm as unknown as { form: { setFieldValue: (k: string, v: unknown) => void } }
    ).form.setFieldValue("ranges", [
      { type: "relative", secs: 3600 },
      { type: "relative", secs: 3600 },
      { type: "relative", secs: 86400 },
    ]);
    await flushPromises();
    const options = (w.vm as unknown as { defaultOptions: { value: string }[] }).defaultOptions;
    expect(options.map((o) => o.value)).toEqual(["r3600", "r86400"]);
  });

  it("gives the Last viewed time a ticking clock", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    const w = build();
    await flushPromises();
    expect(typeof w.findComponent({ name: "OTimeCell" }).props("now")).toBe("number");
  });

  describe("v2 build state", () => {
    const DAY = 86_400;
    const tenPanels = {
      tabs: [
        {
          tabId: "t1",
          name: "Overview",
          panels: [
            ...Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, title: `P${i}` })),
            { id: "md", title: "Notes", type: "markdown" },
          ],
        },
      ],
    };
    const threeRanges = {
      ranges: [
        { type: "relative" as const, secs: 3600 },
        { type: "relative" as const, secs: DAY },
        { type: "relative" as const, secs: 30 * DAY },
      ],
      default: { type: "relative" as const, secs: 3600 },
    };
    const rangeStatus = (key: string, over: Record<string, unknown> = {}) => ({
      key,
      state: "cached",
      built_at: 1_760_000_000_000_000,
      withheld_panels: [],
      unavailable_count: 0,
      incomplete_count: 0,
      last_error: null,
      ...over,
    });
    const createLink = async (status: () => Promise<unknown>, created = link()) => {
      vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
      vi.mocked(admin.create).mockResolvedValue({ data: created } as never);
      vi.mocked(admin.status).mockImplementation(status as never);
      const w = build({ variablesConfig: undefined, dashboardData: tenPanels });
      await flushPromises();
      (
        w.vm as unknown as { form: { setFieldValue: (k: string, v: string) => void } }
      ).form.setFieldValue("name", "Exec view");
      await submit(w);
      return w;
    };
    const stateText = (w: ReturnType<typeof build>, key: string) =>
      w.find(`[data-test="dashboards-public-links-panel-state-${key}"]`).text();

    it("shows each range's state from the status call, telling not cached from never viewed", async () => {
      const w = await createLink(
        async () => ({
          data: {
            link_id: "l1",
            access_count: 2,
            last_accessed_at: 1,
            ranges: [
              rangeStatus("r3600"),
              rangeStatus(`r${30 * DAY}`, {
                state: "needs_attention",
                unavailable_count: 1,
                withheld_panels: [{ panel_id: "p3", reason: "too_large" }],
              }),
            ],
          },
        }),
        link({ time_range: threeRanges, access_count: 0 }),
      );
      expect(admin.status).toHaveBeenCalledWith("default", "dash-1", "l1");
      expect(stateText(w, "r3600")).toBe("Ready");
      expect(stateText(w, `r${DAY}`)).toBe("Not cached, builds on the next view");
      expect(stateText(w, `r${30 * DAY}`)).toBe("Needs attention");
      const states = w.find('[data-test="dashboards-public-links-panel-created-states"]').text();
      expect(states).toContain("10 of 10");
      expect(states).toContain("9 of 10");
    });

    it("says never viewed only for a link with no access history", async () => {
      const w = await createLink(
        async () => ({ data: { link_id: "l1", access_count: 0, ranges: [] } }),
        link({ time_range: threeRanges, access_count: 0 }),
      );
      expect(stateText(w, "r3600")).toBe("Never viewed");
    });

    it("drops the state table quietly when the status call fails", async () => {
      const w = await createLink(() => Promise.reject({ response: { status: 502 } }));
      await flushPromises();
      expect(has(w, "dashboards-public-links-panel-created")).toBe(true);
      expect(has(w, "dashboards-public-links-panel-created-states")).toBe(false);
      expect(notify.error).not.toHaveBeenCalled();
    });

    it("says create runs no query", async () => {
      vi.mocked(admin.list).mockResolvedValue({ data: { list: [] } } as never);
      const w = build({ variablesConfig: undefined });
      await flushPromises();
      expect(w.find('[data-test="dashboards-public-links-panel-save-hint"]').text()).toBe(
        "Returns at once. Nothing is queried until someone opens the link.",
      );
    });

    it("applies the operator minimum the server reports to the promised interval", async () => {
      const zo = store.state.zoConfig;
      store.state.zoConfig = { ...zo, public_dashboard_min_refresh_secs: 600 };
      try {
        const w = await createLink(
          async () => ({ data: { link_id: "l1", access_count: 0, ranges: [] } }),
          link({ refresh_secs: 300 }),
        );
        expect(
          w.find('[data-test="dashboards-public-links-panel-created-build-note"]').text(),
        ).toBe(
          "Opening the public page builds the first result. Viewers after that share it for 10 minutes.",
        );
      } finally {
        store.state.zoConfig = zo;
      }
    });

    it("promises the default range's effective interval in the created view", async () => {
      const monthDefault = {
        ...threeRanges,
        default: { type: "relative" as const, secs: 30 * DAY },
      };
      const w = await createLink(
        async () => ({ data: { link_id: "l1", access_count: 0, ranges: [] } }),
        link({ time_range: monthDefault, refresh_secs: 300 }),
      );
      expect(w.find('[data-test="dashboards-public-links-panel-created-build-note"]').text()).toBe(
        "Opening the public page builds the first result. Viewers after that share it for 150 minutes.",
      );
    });

    it("marks a link needing attention from the batch status, with its reason", async () => {
      vi.mocked(admin.list).mockResolvedValue({
        data: { list: [link(), link({ id: "l2", name: "Quiet", last_accessed_at: null })] },
      } as never);
      vi.mocked(admin.statusBatch).mockResolvedValue({
        data: {
          list: [
            {
              link_id: "l1",
              access_count: 4,
              last_accessed_at: 1,
              ranges: [rangeStatus("r3600", { state: "needs_attention", last_error: "timeout" })],
            },
          ],
        },
      } as never);
      const w = build();
      await flushPromises();
      expect(admin.statusBatch).toHaveBeenCalledWith("default", ["l1", "l2"]);
      expect(w.find('[data-test="dashboards-public-links-panel-l1-status"]').text()).toBe(
        "Needs attention",
      );
      expect(w.find('[data-test="dashboards-public-links-panel-l2-status"]').text()).toBe("Live");
      expect(w.text()).toContain("Never");
    });

    it("tags the drawer title as beta", async () => {
      vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
      const w = build();
      await flushPromises();
      expect(w.find('[data-test="beta-badge"]').text()).toBe("Beta");
    });
  });
});
