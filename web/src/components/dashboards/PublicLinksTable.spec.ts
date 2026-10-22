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
    takeOver: vi.fn(),
    refresh: vi.fn(),
    status: vi.fn(),
    statusBatch: vi.fn(),
    revoke: vi.fn(),
  },
}));
const folders = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));
vi.mock("@/services/common", async (importOriginal) => {
  const actual = await importOriginal<{ default: Record<string, unknown> }>();
  return {
    ...actual,
    default: {
      ...actual.default,
      list_Folders: vi.fn(() => Promise.resolve({ data: { list: folders.list } })),
    },
  };
});
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
  props: ["data", "columns", "forbidden", "loading", "pageSize"],
  // Like the real table's exposed TanStack instance: the rows of its first page of 20.
  computed: {
    table() {
      const rows = (this as unknown as { data: PublicLink[] }).data.slice(0, 20);
      return { getRowModel: () => ({ rows: rows.map((original) => ({ original })) }) };
    },
  },
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
  time_range: {
    ranges: [
      { type: "relative", secs: 3600 },
      { type: "relative", secs: 86400 },
    ],
    default: { type: "relative", secs: 3600 },
  },
  frozen_variables: {},
  refresh_secs: 600,
  expires_at: null,
  published_by: "a@b.c",
  publisher_left: false,
  updated_by: null,
  created_at: 1,
  updated_at: 1,
  last_accessed_at: 1,
  access_count: 4,
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
    time_range: {
      ranges: [{ type: "relative", secs: 86400 }],
      default: { type: "relative", secs: 86400 },
    },
  }),
];

// The owning querier's batch answer: l5's last build withheld a panel.
const STATUS = [
  {
    link_id: "l5",
    access_count: 4,
    last_accessed_at: 1,
    ranges: [
      {
        key: "r86400",
        state: "needs_attention",
        built_at: 1,
        withheld_panels: [{ panel_id: "p1", reason: "unauthorized" }],
        unavailable_count: 1,
        incomplete_count: 0,
        last_error: null,
      },
    ],
  },
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
    vi.mocked(admin.statusBatch).mockResolvedValue({ data: { list: STATUS } } as never);
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
    expect(w.text()).not.toContain("10 minutes");
    expect(w.text()).toContain("a@b.c");
  });

  it("shows the row's folder icon, and the folder glyph for a folder without one", async () => {
    const cell = (w: ReturnType<typeof build>) => find(w, "dashboards-public-links-l1-dashboard");
    let w = build();
    await flushPromises();
    expect(cell(w).find('[data-test="folder-icon"]').exists()).toBe(true);
    expect(cell(w).find('[data-test="glyph-emoji"]').exists()).toBe(false);
    w.unmount();

    folders.list = [{ folderId: "f1", name: "Ops", icon: "🚀" }];
    queryClient.clear();
    w = build();
    await flushPromises();
    expect(cell(w).find('[data-test="glyph-emoji"]').text()).toBe("🚀");
    folders.list = [];
  });

  it("filters by the summary tiles, with needs attention from one batch status call", async () => {
    const w = build();
    await flushPromises();
    expect(admin.statusBatch).toHaveBeenCalledTimes(1);
    expect(admin.statusBatch).toHaveBeenCalledWith("default", ["l1", "l2", "l3", "l4", "l5"]);
    expect(find(w, "dashboards-public-links-summary-attention").text()).toContain("1");
    expect(find(w, "dashboards-public-links-l3-dashboard").text()).toBe(
      "Dashboard no longer exists",
    );
    expect(find(w, "dashboards-public-links-l3-status").text()).toBe("Dashboard deleted");

    await selectTile(w, "attention");
    expect(rows(w)).toHaveLength(1);
    expect(find(w, "dashboards-public-links-l5-status").text()).toBe("Needs attention");
    expect(find(w, "dashboards-public-links-l5-ranges").text()).toBe("1d");
    expect(find(w, "dashboards-public-links-l5-ranges").find(".font-semibold").text()).toBe("1d");

    await selectTile(w, "paused");
    expect(rows(w)).toHaveLength(1);
    expect(find(w, "dashboards-public-links-l2-name").text()).toContain("Untitled link");

    await selectTile(w, "all");
    expect(rows(w)).toHaveLength(5);
  });

  it("searches by name, dashboard, folder and publisher", async () => {
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

  it("finds a link by its slug or a pasted public URL", async () => {
    vi.mocked(admin.listOrg).mockResolvedValue({
      data: { list: [link({ slug: "Xy7AbC" }), link({ id: "l2", slug: "Qq9zzz" })] },
    } as never);
    const w = build();
    await flushPromises();
    const search = find(w, "dashboards-public-links-search").find("input");
    await search.setValue("https://o2.example.com/web/public/dashboards/Qq9zzz?tab=main");
    await flushPromises();
    expect(rows(w)).toHaveLength(1);
    expect(find(w, "dashboards-public-links-l2-name").exists()).toBe(true);

    await search.setValue("xy7abc");
    await flushPromises();
    expect(rows(w)).toHaveLength(1);
    expect(find(w, "dashboards-public-links-l1-name").exists()).toBe(true);
  });

  it("copies the public URL and opens the public page", async () => {
    window.history.replaceState(null, "", "/web/dashboards");
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

  it("names every icon-only row action for screen readers", async () => {
    const w = build();
    await flushPromises();
    const label = (id: string) =>
      find(w, `dashboards-public-links-l1-${id}-btn`).attributes("aria-label");
    expect(["copy", "open", "edit", "pause", "menu"].map(label)).toEqual([
      i18n.global.t("dashboard.publicDashboard.copyLink"),
      i18n.global.t("dashboard.publicLinks.openPublicPage"),
      i18n.global.t("dashboard.publicLinks.editSettings"),
      i18n.global.t("dashboard.publicLinks.pause"),
      i18n.global.t("dashboard.moreActions"),
    ]);
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

  it("disables edit and pause and hides menu actions for a deleted dashboard but keeps revoke", async () => {
    const w = build();
    await flushPromises();
    for (const id of ["edit-btn", "pause-btn"]) {
      expect(find(w, `dashboards-public-links-l3-${id}`).attributes("disabled")).toBeDefined();
    }
    for (const id of ["dashboard-menu", "edit-menu"]) {
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

  it("locks a row's actions while its request runs, so a double click sends one", async () => {
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(admin.pause).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const w = build();
    await flushPromises();
    const pauseBtn = () => find(w, "dashboards-public-links-l1-pause-btn");

    await pauseBtn().trigger("click");
    await pauseBtn().trigger("click");
    await find(w, "dashboards-public-links-l1-pause-menu").trigger("click");
    expect(admin.pause).toHaveBeenCalledTimes(1);
    expect(pauseBtn().attributes("aria-busy")).toBe("true");
    expect(find(w, "dashboards-public-links-l1-menu-btn").attributes("aria-busy")).toBeUndefined();
    expect(find(w, "dashboards-public-links-l1-revoke-menu").attributes("disabled")).toBeDefined();
    expect(find(w, "dashboards-public-links-l5-pause-btn").attributes("disabled")).toBeUndefined();

    finish({ data: link({ enabled: false }) });
    await flushPromises();
    expect(pauseBtn().attributes("aria-busy")).toBeUndefined();
    expect(
      find(w, "dashboards-public-links-l1-revoke-menu").attributes("disabled"),
    ).toBeUndefined();
  });

  it("spins the menu button for an action run from the menu", async () => {
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(admin.revoke).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    confirm.mockResolvedValueOnce(true);
    const w = build();
    await flushPromises();

    await find(w, "dashboards-public-links-l1-revoke-menu").trigger("click");
    await flushPromises();
    await find(w, "dashboards-public-links-l1-revoke-menu").trigger("click");
    await flushPromises();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(admin.revoke).toHaveBeenCalledTimes(1);
    expect(find(w, "dashboards-public-links-l1-menu-btn").attributes("aria-busy")).toBe("true");
    expect(find(w, "dashboards-public-links-l1-pause-btn").attributes("disabled")).toBeDefined();

    finish({ data: {} });
    await flushPromises();
    expect(find(w, "dashboards-public-links-l1-menu-btn").attributes("aria-busy")).toBeUndefined();
  });

  it("marks an absolute-only link for refresh on next view", async () => {
    const absolute = { type: "absolute" as const, start: 1_000_000, end: 86_401_000_000 };
    vi.mocked(admin.listOrg).mockResolvedValue({
      data: { list: [link({ time_range: { ranges: [absolute], default: absolute } })] },
    } as never);
    vi.mocked(admin.refresh).mockResolvedValue({ data: link() } as never);
    const w = build();
    await flushPromises();
    expect(find(w, "dashboards-public-links-l1-refresh-menu").text()).toBe("Refresh on next view");
    await find(w, "dashboards-public-links-l1-refresh-menu").trigger("click");
    await flushPromises();
    expect(admin.refresh).toHaveBeenCalledWith("default", "dash-1", "l1");
    expect(notify.positive).toHaveBeenCalledWith("The link refreshes on its next view");
  });

  it("offers Refresh on next view on paused links too, and shows the server's reason", async () => {
    vi.mocked(admin.listOrg).mockResolvedValue({
      data: { list: [link({ status: "paused", enabled: false })] },
    } as never);
    vi.mocked(admin.refresh).mockRejectedValue({
      response: { status: 400, data: { message: "resume this link before rebuilding it" } },
    });
    const w = build();
    await flushPromises();
    await find(w, "dashboards-public-links-l1-refresh-menu").trigger("click");
    await flushPromises();
    expect(notify.error).toHaveBeenCalledWith("resume this link before rebuilding it");
  });

  it("revokes only after the confirmation, even for a deleted dashboard", async () => {
    vi.mocked(admin.revoke).mockResolvedValue({ data: {} } as never);
    const w = build();
    await flushPromises();

    confirm.mockResolvedValueOnce(false);
    await find(w, "dashboards-public-links-l3-revoke-menu").trigger("click");
    await flushPromises();
    expect(admin.revoke).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    await find(w, "dashboards-public-links-l3-revoke-menu").trigger("click");
    await flushPromises();
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Revoke and delete "Orphan"?',
        confirmVariant: "destructive",
      }),
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

  it("refetches the list and the batch status from the refresh button", async () => {
    const w = build();
    await flushPromises();
    expect(admin.listOrg).toHaveBeenCalledTimes(1);
    expect(admin.statusBatch).toHaveBeenCalledTimes(1);
    await find(w, "dashboards-public-links-refresh-btn").trigger("click");
    await flushPromises();
    expect(admin.listOrg).toHaveBeenCalledTimes(2);
    expect(admin.statusBatch).toHaveBeenCalledTimes(2);
  });

  it("asks the batch status for every link, in calls of at most 50", async () => {
    const many = Array.from({ length: 60 }, (_, i) => link({ id: `m${i}` }));
    vi.mocked(admin.listOrg).mockResolvedValue({ data: { list: many } } as never);
    build();
    await flushPromises();
    expect(admin.statusBatch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(admin.statusBatch).mock.calls.map((c) => c[1])).toEqual([
      many.slice(0, 50).map((l) => l.id),
      many.slice(50).map((l) => l.id),
    ]);
  });

  it("keeps a needs-attention link out of the Live filter without re-asking its status", async () => {
    const w = build();
    await flushPromises();
    await selectTile(w, "live");
    expect(find(w, "dashboards-public-links-l5-status").exists()).toBe(false);
    expect(find(w, "dashboards-public-links-summary-attention").text()).toContain("1");
    expect(admin.statusBatch).toHaveBeenCalledTimes(1);
  });

  it("omits needs attention and its tile when the batch status call fails", async () => {
    vi.mocked(admin.statusBatch).mockRejectedValue({ response: { status: 400 } });
    const w = build();
    await flushPromises();
    expect(find(w, "dashboards-public-links-summary-attention").exists()).toBe(false);
    expect(find(w, "dashboards-public-links-l5-status").text()).toBe("Live");
    expect(find(w, "dashboards-public-links-summary-live").exists()).toBe(true);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("shows when a link was last viewed with its request count, and a never-viewed link as such", async () => {
    vi.mocked(admin.listOrg).mockResolvedValue({
      data: {
        list: [
          link({ access_count: 9120 }),
          link({ id: "l2", access_count: 0, last_accessed_at: null }),
        ],
      },
    } as never);
    const w = build();
    await flushPromises();
    expect(find(w, "dashboards-public-links-l1-last-viewed").text()).toContain("9,120 requests");
    expect(find(w, "dashboards-public-links-l2-last-viewed").text()).toBe("Never");
    expect(find(w, "dashboards-public-links-l2-status").text()).toBe("Never viewed");
    expect(w.text()).not.toContain("Preparing");
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

  describe("take over", () => {
    // The test store signs in as example@gmail.com; the fixtures publish as a@b.c.
    const ME = "example@gmail.com";
    const TAKEOVER_LINKS = [
      link({ id: "left-paused", status: "paused", enabled: false, publisher_left: true }),
      link({ id: "left-live", publisher_left: true }),
      link({ id: "paused", status: "paused", enabled: false }),
      link({ id: "live" }),
      link({ id: "mine", published_by: ME }),
      link({ id: "left-expired", status: "expired", enabled: false, publisher_left: true }),
      link({
        id: "left-orphan",
        status: "dashboard_deleted",
        dashboard_title: null,
        publisher_left: true,
      }),
    ];
    const has = (w: ReturnType<typeof build>, id: string) => find(w, id).exists();

    beforeEach(() => {
      vi.mocked(admin.listOrg).mockResolvedValue({ data: { list: TAKEOVER_LINKS } } as never);
    });

    it("marks a departed publisher's links and offers Take over in place of Resume", async () => {
      const w = build();
      await flushPromises();
      expect(find(w, "dashboards-public-links-left-paused-publisher-left").text()).toBe(
        "Publisher left the org",
      );
      expect(has(w, "dashboards-public-links-left-live-publisher-left")).toBe(true);
      for (const id of ["paused", "live", "mine"]) {
        expect(has(w, `dashboards-public-links-${id}-publisher-left`)).toBe(false);
      }

      expect(has(w, "dashboards-public-links-left-paused-take-over-btn")).toBe(true);
      expect(has(w, "dashboards-public-links-left-paused-resume-btn")).toBe(false);
      expect(has(w, "dashboards-public-links-left-paused-resume-menu")).toBe(false);
      expect(find(w, "dashboards-public-links-left-paused-take-over-menu").classes()).toContain(
        "md:hidden",
      );

      expect(has(w, "dashboards-public-links-left-live-pause-btn")).toBe(true);
      expect(has(w, "dashboards-public-links-left-live-take-over-btn")).toBe(false);
      expect(find(w, "dashboards-public-links-left-live-take-over-menu").classes()).not.toContain(
        "md:hidden",
      );
    });

    it("offers Take over only in the menu for a live or paused link someone else publishes", async () => {
      const w = build();
      await flushPromises();
      expect(has(w, "dashboards-public-links-paused-resume-btn")).toBe(true);
      expect(has(w, "dashboards-public-links-paused-take-over-btn")).toBe(false);
      expect(find(w, "dashboards-public-links-paused-take-over-menu").text()).toBe("Take over");
      expect(has(w, "dashboards-public-links-live-pause-btn")).toBe(true);
      expect(has(w, "dashboards-public-links-live-take-over-btn")).toBe(false);
      expect(find(w, "dashboards-public-links-live-take-over-menu").classes()).not.toContain(
        "md:hidden",
      );
    });

    it("never offers Take over to the publisher, or on an expired or orphaned link", async () => {
      const w = build();
      await flushPromises();
      expect(has(w, "dashboards-public-links-live-take-over-menu")).toBe(true);
      for (const id of ["mine", "left-expired", "left-orphan"]) {
        expect(has(w, `dashboards-public-links-${id}-take-over-btn`)).toBe(false);
        expect(has(w, `dashboards-public-links-${id}-take-over-menu`)).toBe(false);
      }
      expect(
        find(w, "dashboards-public-links-left-expired-resume-btn").attributes("disabled"),
      ).toBeDefined();
      expect(has(w, "dashboards-public-links-left-orphan-revoke-menu")).toBe(true);
    });

    it("treats a publisher who signed in with different letter case as the publisher", async () => {
      vi.mocked(admin.listOrg).mockResolvedValue({
        data: { list: [link({ id: "mine-cased", published_by: "Example@Gmail.com" })] },
      } as never);
      const w = build();
      await flushPromises();
      expect(has(w, "dashboards-public-links-mine-cased-pause-btn")).toBe(true);
      expect(has(w, "dashboards-public-links-mine-cased-take-over-menu")).toBe(false);
    });

    it("takes over only after the confirmation, naming the publisher the row showed", async () => {
      vi.mocked(admin.takeOver).mockResolvedValue({
        data: link({ id: "left-paused", published_by: ME }),
      } as never);
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const w = build();
      await flushPromises();

      confirm.mockResolvedValueOnce(false);
      await find(w, "dashboards-public-links-left-paused-take-over-btn").trigger("click");
      await flushPromises();
      expect(admin.takeOver).not.toHaveBeenCalled();
      expect(notify.positive).not.toHaveBeenCalled();

      confirm.mockResolvedValueOnce(true);
      await find(w, "dashboards-public-links-left-paused-take-over-btn").trigger("click");
      await flushPromises();
      expect(confirm).toHaveBeenLastCalledWith(
        expect.objectContaining({
          title: "Take over this link?",
          message:
            "You become the publisher. The public page will show what you are allowed to see, which may be more or less than before. Anyone who has the URL keeps access to it, and the link goes live now.",
          confirmLabel: "Take over",
        }),
      );
      expect(admin.takeOver).toHaveBeenCalledWith("default", "dash-1", "left-paused", "a@b.c");
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: publicLinkKeys.all("default") }),
      );
      expect(notify.positive).toHaveBeenCalledWith("You now publish this link");
    });

    it("takes over a live link from the menu", async () => {
      vi.mocked(admin.takeOver).mockResolvedValue({ data: link({ id: "live" }) } as never);
      confirm.mockResolvedValueOnce(true);
      const w = build();
      await flushPromises();
      await find(w, "dashboards-public-links-live-take-over-menu").trigger("click");
      await flushPromises();
      expect(admin.takeOver).toHaveBeenCalledWith("default", "dash-1", "live", "a@b.c");
    });

    it("shows the server's message on a conflict and reloads the list", async () => {
      vi.mocked(admin.takeOver).mockRejectedValue({
        response: { status: 409, data: { message: "this link was taken over by x@y.z; reload" } },
      });
      confirm.mockResolvedValueOnce(true);
      const w = build();
      await flushPromises();
      expect(admin.listOrg).toHaveBeenCalledTimes(1);
      await find(w, "dashboards-public-links-left-paused-take-over-btn").trigger("click");
      await flushPromises();
      expect(notify.error).toHaveBeenCalledWith("this link was taken over by x@y.z; reload");
      expect(admin.listOrg).toHaveBeenCalledTimes(2);
      expect(notify.positive).not.toHaveBeenCalled();
    });

    it("says the caller can't publish when the takeover is forbidden", async () => {
      vi.mocked(admin.takeOver).mockRejectedValue({ response: { status: 403, data: {} } });
      confirm.mockResolvedValueOnce(true);
      const w = build();
      await flushPromises();
      await find(w, "dashboards-public-links-live-take-over-menu").trigger("click");
      await flushPromises();
      expect(notify.error).toHaveBeenCalledWith(
        "You don't have permission to publish public links. Ask an admin.",
      );
    });
  });
});
