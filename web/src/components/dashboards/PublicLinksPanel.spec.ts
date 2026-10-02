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
    revoke: vi.fn(),
  },
}));
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
    "secondaryButtonLabel",
    "closeGuard",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template:
    '<div><span class="drawer-primary-label">{{ primaryButtonLabel }}</span><button class="drawer-primary" @click="$emit(\'click:primary\')" /><slot /></div>',
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
const VVSStub = {
  name: "VariablesValueSelector",
  template: "<div />",
  props: ["variablesConfig", "selectedTimeDate", "initialVariableValues", "showDynamicFilters"],
  emits: ["variablesData"],
  mounted() {
    this.$emit("variablesData", { values: [{ name: "env", value: "prod" }] });
  },
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
  time_range: { editable: true, default_range_secs: 3600, allowed_presets_secs: [3600, 86400] },
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
    store.state.zoConfig = { ...store.state.zoConfig, public_dashboard_min_rebuild_secs: 10 };
  });

  it("opens on the create form when the dashboard has no links, and shows the new link", async () => {
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
      time_range: { editable: true, default_range_secs: 3600, allowed_presets_secs: [3600, 86400] },
      frozen_variables: { env: "prod" },
      rebuild_secs: 60,
      expires_at: null,
    });
    expect(has(w, "dashboards-public-links-panel-created")).toBe(true);
    expect(
      w.find('[data-test="dashboards-public-links-panel-created-url"] input').element,
    ).toHaveProperty("value", `${window.location.origin}/web/public/dashboards/new-slug`);
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

  it("revokes only after the inline confirmation", async () => {
    vi.mocked(admin.list).mockResolvedValue({ data: { list: [link()] } } as never);
    vi.mocked(admin.revoke).mockResolvedValue({ data: {} } as never);
    const w = build();
    await flushPromises();
    await w.find('[data-test="dashboards-public-links-panel-l1-revoke-menu"]').trigger("click");
    await flushPromises();
    expect(admin.revoke).not.toHaveBeenCalled();
    expect(has(w, "dashboards-public-links-panel-revoke-confirm")).toBe(true);

    await w.find('[data-test="dashboards-public-links-panel-revoke-confirm-btn"]').trigger("click");
    await flushPromises();
    expect(admin.revoke).toHaveBeenCalledWith("default", "dash-1", "l1");
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

  it("shows the no-permission view on a 403 and no actions", async () => {
    vi.mocked(admin.list).mockRejectedValue({ response: { status: 403 } });
    const w = build();
    await flushPromises();
    expect(has(w, "dashboards-public-links-panel-no-permission")).toBe(true);
    expect(w.find(".drawer-primary-label").text()).toBe("");
  });
});
