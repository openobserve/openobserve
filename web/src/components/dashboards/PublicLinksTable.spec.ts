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
import { publicLinkKeys } from "@/services/public_dashboards.querykeys";

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
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/composables/useConfirmDialog", () => ({ useConfirmDialog: () => ({ confirm }) }));
const copy = vi.hoisted(() => vi.fn());
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copy }));
const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("vue-router")>()),
  useRouter: () => ({ push }),
}));

import admin, { type PublicLink } from "@/services/public_dashboards_admin";
import PublicLinksTable from "./PublicLinksTable.vue";

// Render every slot the view uses, since the real table virtualises rows away in jsdom.
const OTableStub = {
  name: "OTable",
  props: ["data", "columns", "forbidden", "loading"],
  template: `<div>
    <slot name="subheader" /><slot name="toolbar" /><slot name="toolbar-trailing" />
    <div v-if="forbidden" data-test="table-forbidden" />
    <template v-else-if="!loading && !data.length"><slot name="empty" /></template>
    <div v-for="row in data" :key="row.id" data-test="table-row">
      <div v-for="col in columns" :key="col.id"><slot :name="'cell-' + col.id" :row="row" /></div>
    </div>
  </div>`,
};
const ODropdownStub = { name: "ODropdown", template: '<div><slot name="trigger" /><slot /></div>' };
const ODropdownItemStub = {
  name: "ODropdownItem",
  emits: ["select"],
  template: '<button v-bind="$attrs" @click="$emit(\'select\')"><slot /></button>',
};
const PanelStub = {
  name: "PublicLinksPanel",
  props: ["modelValue", "dashboardId", "dashboardTitle", "editLinkId"],
  template: "<div data-test='panel-stub' />",
};

const link = (over: Partial<PublicLink> = {}): PublicLink => ({
  id: "l1",
  name: "NOC wall",
  slug: "abc",
  dashboard_id: "dash-1",
  dashboard_title: "Cloud",
  folder_id: "f1",
  folder_name: "Ops",
  status: "live",
  enabled: true,
  time_range: { editable: true, default_range_secs: 3600, allowed_presets_secs: [3600, 86400] },
  frozen_variables: {},
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

const LINKS = [
  link(),
  link({ id: "l2", name: "", status: "paused", enabled: false }),
  link({
    id: "l3",
    name: "Orphan",
    status: "dashboard_deleted",
    dashboard_title: null,
    folder_name: null,
  }),
  link({ id: "l4", name: "Old", status: "expired", expires_at: 1 }),
  link({
    id: "l5",
    name: "Wall",
    status: "needs_attention",
    time_range: { editable: false, default_range_secs: 86400, allowed_presets_secs: [86400] },
  }),
];

const build = () =>
  mount(PublicLinksTable, {
    global: {
      plugins: [i18n],
      provide: { store },
      stubs: {
        OTable: OTableStub,
        ODropdown: ODropdownStub,
        ODropdownItem: ODropdownItemStub,
        PublicLinksPanel: PanelStub,
        OTooltip: true,
        ORefreshButton: {
          emits: ["click"],
          template: "<button @click=\"$emit('click')\" />",
        },
      },
    },
  });

const find = (w: ReturnType<typeof build>, id: string) => w.find(`[data-test="${id}"]`);
const rows = (w: ReturnType<typeof build>) => w.findAll('[data-test="table-row"]');
const selectTile = async (w: ReturnType<typeof build>, key: string) => {
  await find(w, `dashboards-public-links-summary-${key}`).trigger("click");
  await flushPromises();
};

describe("PublicLinksTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    vi.mocked(admin.listOrg).mockResolvedValue({ data: { list: LINKS } } as never);
  });

  it("opens on all links with their name, dashboard, folder and status", async () => {
    const w = build();
    await flushPromises();
    expect(rows(w)).toHaveLength(5);
    expect(find(w, "dashboards-public-links-l1-name").text()).toContain("NOC wall");
    expect(find(w, "dashboards-public-links-l1-dashboard").text()).toBe("Ops / Cloud");
    expect(find(w, "dashboards-public-links-l1-status").text()).toBe("Live");
    expect(find(w, "dashboards-public-links-l1-ranges").text()).toBe("1h · 1d");
    expect(find(w, "dashboards-public-links-l1-expires").text()).toBe("Never");
    expect(w.text()).toContain("10 minutes");
    expect(w.text()).toContain("a@b.c");
  });

  it("filters by the summary tiles and counts deleted dashboards as needing attention", async () => {
    const w = build();
    await flushPromises();
    expect(find(w, "dashboards-public-links-summary-attention").text()).toContain("2");

    await selectTile(w, "attention");
    expect(rows(w)).toHaveLength(2);
    expect(find(w, "dashboards-public-links-l3-dashboard").text()).toBe(
      "Dashboard no longer exists",
    );
    expect(find(w, "dashboards-public-links-l3-status").text()).toBe("Dashboard deleted");
    expect(find(w, "dashboards-public-links-l5-ranges").text()).toBe("1d");
    expect(find(w, "dashboards-public-links-l5-ranges").find(".font-semibold").text()).toBe("1d");

    await selectTile(w, "paused");
    expect(rows(w)).toHaveLength(1);
    expect(find(w, "dashboards-public-links-l2-name").text()).toContain("Untitled link");

    await selectTile(w, "all");
    expect(rows(w)).toHaveLength(5);
  });

  it("searches by dashboard, folder and publisher", async () => {
    const w = build();
    await flushPromises();
    await selectTile(w, "all");
    const search = find(w, "dashboards-public-links-search").find("input");
    await search.setValue("cloud");
    await flushPromises();
    expect(rows(w)).toHaveLength(4);
    expect(find(w, "dashboards-public-links-l3-name").exists()).toBe(false);

    await search.setValue("OPS");
    await flushPromises();
    expect(rows(w)).toHaveLength(4);

    await search.setValue("a@b");
    await flushPromises();
    expect(rows(w)).toHaveLength(5);
  });

  it("copies the public URL and opens the public page", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const w = build();
    await flushPromises();
    const url = `${window.location.origin}/web/public/dashboards/abc`;

    await find(w, "dashboards-public-links-l1-copy-btn").trigger("click");
    expect(copy).toHaveBeenCalledWith(url, expect.any(Function), {
      successMessage: "Link copied",
    });

    await find(w, "dashboards-public-links-l1-open-menu").trigger("click");
    expect(open).toHaveBeenCalledWith(url, "_blank", "noopener");
    open.mockRestore();
  });

  it("opens the dashboard and its edit panel from the row", async () => {
    const w = build();
    await flushPromises();
    await find(w, "dashboards-public-links-l1-dashboard-menu").trigger("click");
    expect(push).toHaveBeenCalledWith({
      path: "/dashboards/view",
      query: { org_identifier: "default", dashboard: "dash-1", folder: "f1" },
    });

    await find(w, "dashboards-public-links-l1-edit-btn").trigger("click");
    await flushPromises();
    const panel = w.findComponent(PanelStub);
    expect(panel.props()).toMatchObject({
      modelValue: true,
      dashboardId: "dash-1",
      dashboardTitle: "Cloud",
      editLinkId: "l1",
    });
  });

  it("hides dashboard, edit and pause actions for a deleted dashboard but keeps revoke", async () => {
    const w = build();
    await flushPromises();
    await selectTile(w, "attention");
    for (const id of ["edit-btn", "pause-btn", "dashboard-menu", "edit-menu"]) {
      expect(find(w, `dashboards-public-links-l3-${id}`).exists()).toBe(false);
    }
    expect(find(w, "dashboards-public-links-l3-revoke-menu").exists()).toBe(true);
    expect(find(w, "dashboards-public-links-l5-pause-btn").exists()).toBe(true);
  });

  it("pauses a live link and resumes a paused one", async () => {
    vi.mocked(admin.pause).mockResolvedValue({ data: link({ enabled: false }) } as never);
    vi.mocked(admin.resume).mockResolvedValue({ data: link() } as never);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const w = build();
    await flushPromises();

    await find(w, "dashboards-public-links-l1-pause-btn").trigger("click");
    await flushPromises();
    expect(admin.pause).toHaveBeenCalledWith("default", "dash-1", "l1");
    expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: publicLinkKeys.all("default") }),
    );

    await selectTile(w, "paused");
    await find(w, "dashboards-public-links-l2-resume-menu").trigger("click");
    await flushPromises();
    expect(admin.resume).toHaveBeenCalledWith("default", "dash-1", "l2");
  });

  it("revokes only after the confirmation, even for a deleted dashboard", async () => {
    vi.mocked(admin.revoke).mockResolvedValue({ data: {} } as never);
    const w = build();
    await flushPromises();
    await selectTile(w, "attention");

    confirm.mockResolvedValueOnce(false);
    await find(w, "dashboards-public-links-l3-revoke-menu").trigger("click");
    await flushPromises();
    expect(admin.revoke).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    await find(w, "dashboards-public-links-l3-revoke-menu").trigger("click");
    await flushPromises();
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Revoke and delete "Orphan"?' }),
    );
    expect(admin.revoke).toHaveBeenCalledWith("default", "dash-1", "l3");
    expect(notify.positive).toHaveBeenCalledWith("Public link revoked and deleted");
  });

  it("shows the server's reason when an action is refused", async () => {
    vi.mocked(admin.pause).mockRejectedValue({ response: { data: { message: "no edit" } } });
    const w = build();
    await flushPromises();
    await find(w, "dashboards-public-links-l1-pause-btn").trigger("click");
    await flushPromises();
    expect(notify.error).toHaveBeenCalledWith("no edit");
  });

  it("refetches the list from the refresh button", async () => {
    const w = build();
    await flushPromises();
    expect(admin.listOrg).toHaveBeenCalledTimes(1);
    await find(w, "dashboards-public-links-refresh-btn").trigger("click");
    await flushPromises();
    expect(admin.listOrg).toHaveBeenCalledTimes(2);
  });

  it("shows the forbidden state on a 403", async () => {
    vi.mocked(admin.listOrg).mockRejectedValue({ response: { status: 403 } });
    const w = build();
    await flushPromises();
    expect(find(w, "table-forbidden").exists()).toBe(true);
    expect(find(w, "dashboards-public-links-error").exists()).toBe(false);
  });

  it("shows the first-run empty state when the org has no links", async () => {
    vi.mocked(admin.listOrg).mockResolvedValue({ data: { list: [] } } as never);
    const w = build();
    await flushPromises();
    expect(find(w, "dashboards-public-links-empty").text()).toContain("No public links yet");
  });

  it("shows a filtered empty state that clears back to every link", async () => {
    vi.mocked(admin.listOrg).mockResolvedValue({
      data: { list: [link({ status: "paused", enabled: false })] },
    } as never);
    const w = build();
    await flushPromises();
    await selectTile(w, "live");
    const empty = find(w, "dashboards-public-links-empty");
    expect(empty.text()).toContain("No public links found");

    await w.findAllComponents({ name: "OEmptyState" })[0].vm.$emit("action", "clear-filters");
    await flushPromises();
    expect(rows(w)).toHaveLength(1);
  });
});
