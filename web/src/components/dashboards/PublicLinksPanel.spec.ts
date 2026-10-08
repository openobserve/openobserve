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
    rebuild: vi.fn(),
    revoke: vi.fn(),
  },
}));
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));
const notify = vi.hoisted(() => ({ error: vi.fn(), positive: vi.fn() }));
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: notify.error,
    showPositiveNotification: notify.positive,
  }),
}));

import admin, { type PublicLink } from "@/services/public_dashboards_admin";
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
    '<div><slot name="toolbar-trailing" /><div v-for="row in data" :key="row.id"><div v-for="col in columns" :key="col.id"><slot :name="\'cell-\' + col.id" :row="row" /></div></div></div>',
};
const DateTimeStub = {
  name: "DateTime",
  props: ["defaultType", "defaultRelativeTime", "defaultAbsoluteTime"],
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
  rebuild_secs: 600,
  last_rebuilt_at: 1,
  rebuild_state: 1,
  expires_at: null,
  published_by: "a@b.c",
  updated_by: null,
  created_at: 1,
  updated_at: 1,
  ...over,
});

const build = (props: Record<string, unknown> = {}) =>
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
      rebuild_secs: 60,
      expires_at: null,
    });
    expect(has(w, "dashboards-public-links-panel-created")).toBe(true);
    expect(
      w.find('[data-test="dashboards-public-links-panel-created-url"] input').element,
    ).toHaveProperty("value", `${window.location.origin}/web/public/dashboards/new-slug`);

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
      expect.objectContaining({ title: 'Revoke and delete "NOC wall"?', destructive: true }),
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
    expect(cfg.rebuild_secs).toBe(600);
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
    expect(has(w, "dashboards-public-links-panel-rebuild-select")).toBe(false);

    await submit(w);
    const absolute = { type: "absolute", start: 1_000_000, end: 86_401_000_000 };
    expect(vi.mocked(admin.update).mock.calls[0][3].time_range).toEqual({
      ranges: [absolute],
      default: absolute,
    });
  });

  it("rebuilds a link with an absolute range from its menu", async () => {
    const absolute = { type: "absolute" as const, start: 1_000_000, end: 86_401_000_000 };
    vi.mocked(admin.list).mockResolvedValue({
      data: { list: [link({ time_range: { ranges: [absolute], default: absolute } })] },
    } as never);
    vi.mocked(admin.rebuild).mockResolvedValue({ data: link() } as never);
    const w = build();
    await flushPromises();
    expect(w.text()).toContain("Once");
    await w.find('[data-test="dashboards-public-links-panel-l1-rebuild-menu"]').trigger("click");
    await flushPromises();
    expect(admin.rebuild).toHaveBeenCalledWith("default", "dash-1", "l1");
    expect(notify.positive).toHaveBeenCalled();
  });

  it("offers no rebuild for a link of only relative ranges", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    const w = build();
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-l1-rebuild-menu")).toBe(false);
  });

  it("offers refresh intervals from 10 seconds and keeps the link's own", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    const w = build({ editLinkId: "l1" });
    await flushPromises();
    const options = (
      w.vm as unknown as {
        refreshOptions: { value: number; label: string }[];
      }
    ).refreshOptions;
    const byValue = (v: number) => options.find((o) => o.value === v);

    expect(options[0].value).toBe(10);
    expect(byValue(600)?.label).toBe("10 minutes");
    expect(byValue(2592000)?.label).toBe("1 month");
    expect(options.map((o) => o.value)).toEqual(
      [...options.map((o) => o.value)].sort((a, b) => a - b),
    );
  });

  it("shows the server's reason when an action is refused", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    vi.mocked(admin.pause).mockRejectedValue({
      response: { status: 403, data: { message: "no edit" } },
    });
    const w = build();
    await flushPromises();
    await w.find('[data-test="dashboards-public-links-panel-l1-pause-menu"]').trigger("click");
    await flushPromises();
    expect(notify.error).toHaveBeenCalledWith("no edit");
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
    expect(has(w, "dashboards-public-links-panel-variables-loading")).toBe(true);
    await submit(w);
    expect(admin.create).not.toHaveBeenCalled();

    Object.assign(vm.formVars.variablesData.global[0], {
      isLoading: false,
      isVariableLoadingPending: false,
      isVariablePartialLoaded: true,
    });
    await flushPromises();
    expect(drawer().props("primaryButtonDisabled")).toBe(false);
    expect(has(w, "dashboards-public-links-panel-variables-loading")).toBe(false);
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

  it("shows the no-permission view on a 403 and no actions", async () => {
    vi.mocked(admin.list).mockRejectedValue({ response: { status: 403 } });
    const w = build();
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-no-permission")).toBe(true);
    expect(w.find(".drawer-primary-label").text()).toBe("");
  });
});
