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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, KeepAlive, type VNode } from "vue";
import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { createStore } from "vuex";
import i18n from "@/locales";

const { confirmMock, toastMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(async (_o: Record<string, unknown>) => true),
  toastMock: vi.fn(),
}));
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});
vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: toastMock,
}));

import searchService from "@/services/search";
import SavedFunnelsPage from "./SavedFunnelsPage.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import ORefreshButton from "@/lib/core/RefreshButton/ORefreshButton.vue";
import usePerformance from "@/composables/rum/usePerformance";
import useProductAnalytics, { resetProductAnalytics } from "@/composables/rum/useProductAnalytics";
import useSavedFunnels, { resetSavedFunnels } from "@/composables/rum/useSavedFunnels";
import { resetNamedEvents } from "@/composables/rum/useNamedEvents";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";

const store = createStore({
  state: {
    selectedOrganization: { identifier: "org1" },
    zoConfig: { sql_base64_enabled: false },
    timezone: "UTC",
    theme: "light",
  },
});
const stubs = {
  ODialog: {
    name: "ODialog",
    props: [
      "open",
      "title",
      "primaryButtonLabel",
      "primaryButtonDisabled",
      "secondaryButtonLabel",
      "formId",
    ],
    emits: ["update:open", "click:primary", "click:secondary"],
    template: `<div v-if="open" class="o-dialog" v-bind="$attrs" :data-title="title">
      <slot />
      <button class="o-dialog-secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
      <button v-if="formId" class="o-dialog-primary" type="submit" :form="formId">{{ primaryButtonLabel }}</button>
      <button v-else class="o-dialog-primary" :disabled="primaryButtonDisabled" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
    </div>`,
  },
  ODropdown: { name: "ODropdown", template: '<div><slot name="trigger" /><slot /></div>' },
  ODropdownItem: {
    name: "ODropdownItem",
    props: ["disabled", "iconLeft", "variant"],
    emits: ["select"],
    inheritAttrs: false,
    template:
      '<button class="o-dropdown-item" :class="$attrs.class" :data-test="$attrs[\'data-test\']" :disabled="disabled" @click.stop="$emit(\'select\')"><slot /></button>',
  },
};

const EV = "LogsPage0000000000000000001";
const GONE = "GoneEvent000000000000000001";
const PARAM = {
  s: [
    ["p", "/a"],
    ["p", "/b"],
  ],
  u: "sessions",
  w: "session",
};
const OTHER = {
  ...PARAM,
  s: [
    ["p", "/o1"],
    ["p", "/o2"],
  ],
};
const def = (...keys: string[]): FunnelDef => ({
  steps: keys.map((key) => ({ kind: "p", key })),
  unit: "sessions",
  window: "session",
  breakdown: null,
});

const searchRoutes: [RegExp, Record<string, unknown>[]][] = [
  [/AS app, COUNT/, [{ app: "web", sessions: 500 }]],
  [
    /va_rows/,
    [{ sessions: 500, prev_sessions: 400, views: 900, va_rows: 1000, data_through_us: 1 }],
  ],
  [
    /entry_sessions/,
    [
      { k: "/web/login", entry_sessions: 90, prev_entry_sessions: 1, exit_sessions: 1 },
      { k: "/web", entry_sessions: 50, prev_entry_sessions: 1, exit_sessions: 1 },
    ],
  ],
];

const Shell = defineComponent({
  render: () => h("div", [h(RouterView)]),
});
const Blank = defineComponent({ render: () => h("div", { "data-test": "blank" }) });
const KeptShell = defineComponent({
  render: () =>
    h("div", [
      h(RouterView, null, {
        default: ({ Component }: { Component: VNode }) => h(KeepAlive, null, [Component]),
      }),
    ]),
});

describe("SavedFunnelsPage (AC-67, AC-68, AC-69)", () => {
  let router: Router;
  let wrapper: VueWrapper | null = null;

  // Covers OTable's 50ms skeleton hold, which otherwise hides rows that already landed.
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await flushPromises();
    }
  };
  const mountPage = async (query: Record<string, string> = {}, keepAlive = false) => {
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/", component: Blank },
        {
          path: "/product-analytics",
          name: PA_ROUTES.shell,
          component: keepAlive ? KeptShell : Shell,
          children: [
            { path: "funnels", name: PA_ROUTES.funnels, component: SavedFunnelsPage },
            { path: "funnels/build", name: PA_ROUTES.funnelBuilder, component: Blank },
            { path: "overview", name: PA_ROUTES.overview, component: Blank },
          ],
        },
      ],
    });
    await router.push({
      path: "/product-analytics/funnels",
      query: { app: "web", period: "7d", ...query },
    });
    useProductAnalytics().initFromRoute(router.currentRoute.value.query);
    wrapper = mount(RouterView, {
      global: { plugins: [router, store, i18n], stubs },
      attachTo: document.body,
    });
    await settle();
  };
  const q = (dt: string) => {
    const el = document.querySelector(`[data-test="${dt}"]`);
    return el ? new DOMWrapper(el) : wrapper!.find(`[data-test="${dt}"]`);
  };
  const row = (i: number) => q(`rum-analytics-saved-funnel-row-${i}`);
  const action = (i: number, name: string) => q(`rum-analytics-saved-funnel-row-${i}-${name}`);
  const nameInput = () =>
    wrapper!.find<HTMLInputElement>('[data-test="rum-analytics-save-funnel-name"] input');
  const fillAndSubmit = async (name?: string) => {
    if (name !== undefined) await nameInput().setValue(name);
    await wrapper!.find("form").trigger("submit");
    await settle();
  };
  const names = () =>
    wrapper!
      .findAll('[data-test^="rum-analytics-saved-funnel-row-"]')
      .filter((el) => /row-\d+$/.test(el.attributes("data-test")!))
      .map((el) => el.text());

  beforeEach(() => {
    api.reset();
    resetSavedFunnels();
    resetNamedEvents();
    resetProductAnalytics();
    confirmMock.mockReset().mockResolvedValue(true);
    toastMock.mockReset();
    window.localStorage.clear();
    usePerformance().performanceState.data.streams._rumdata = {
      name: "_rumdata",
      schema: { usr_email: { name: "usr_email" } },
    };
    vi.mocked(searchService.search).mockReset();
    vi.mocked(searchService.search).mockImplementation((async (args: {
      query: { query: { sql: string } };
    }) => {
      const sql = args.query.query.sql;
      return { data: { hits: searchRoutes.find(([re]) => re.test(sql))?.[1] ?? [] } };
    }) as never);
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("lists each funnel's name, at most 4 steps with a deleted event named so, and who updated it when", async () => {
    api.seedEvent("web", "Logs page", { id: EV });
    api.seedFunnel("web", "Beta", {
      ...PARAM,
      s: [
        ["p", "/a"],
        ["e", GONE],
      ],
    });
    api.seedFunnel("web", "Alpha", {
      ...PARAM,
      s: [
        ["p", "/a"],
        ["c", "b"],
        ["e", EV],
        ["p", "/d"],
        ["p", "/e"],
        ["p", "/f"],
      ],
    });
    await mountPage();
    expect(names()).toEqual(["Alpha", "Beta"]);
    const rows = wrapper!.findAll("tbody tr");
    expect(rows[0].text()).toContain("Logs page");
    expect(rows[0].text()).toContain("+2");
    expect(rows[0].text()).not.toContain("/e");
    expect(rows[0].text()).toContain("seed@x.com");
    expect(rows[1].text()).toContain("Deleted event");
    expect(rows[1].text()).not.toContain(GONE);
    expect(wrapper!.findComponent(OTable).props()).toMatchObject({
      frame: false,
      rowKey: "id",
      selection: "multiple",
      pageSize: 20,
      persistColumns: true,
      tableId: "rum-analytics-saved-funnels",
    });
  });

  it("names each icon-only row action, and keeps its reason reachable while it is disabled", async () => {
    api.seedFunnel("web", "Alpha", PARAM);
    api.failNext("deleteFunnel", 403);
    await mountPage();
    for (const name of ["rename", "duplicate", "delete"]) {
      expect(action(0, name).attributes("aria-label"), name).toBeTruthy();
    }
    await action(0, "delete").trigger("click");
    await settle();
    expect(action(0, "rename").attributes("disabled")).toBeDefined();
    expect(action(0, "rename").attributes("aria-label")).toBe(
      "Your role can open but not change saved funnels (RUM Product Analytics permission)",
    );
  });

  it("filters by name, and a search that matches nothing offers to clear it", async () => {
    api.seedFunnel("web", "Alpha", PARAM);
    api.seedFunnel("web", "Beta", PARAM);
    await mountPage();
    await wrapper!.find('[data-test="rum-analytics-saved-funnels-search"] input').setValue("bet");
    await settle();
    expect(names()).toEqual(["Beta"]);
    await wrapper!.find('[data-test="rum-analytics-saved-funnels-search"] input').setValue("zzz");
    await settle();
    expect(names()).toEqual([]);
    expect(wrapper!.text()).toContain("No saved funnels found");
    expect(q("rum-analytics-funnel-quick-starts").exists()).toBe(false);
  });

  it("opens a row in the builder with its sf and the scope, and marks the open funnel Current", async () => {
    const a = api.seedFunnel("web", "Alpha", PARAM);
    api.seedFunnel("web", "Beta", OTHER);
    await mountPage();
    expect(q("rum-analytics-saved-funnel-row-0-current").exists()).toBe(false);
    await row(0).trigger("click");
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
    expect(router.currentRoute.value.query).toMatchObject({ app: "web", period: "7d", sf: a.id });
    expect(useProductAnalytics().funnel.value).toEqual(def("/a", "/b"));
    await router.push({ name: PA_ROUTES.funnels, query: { app: "web" } });
    await settle();
    expect(q("rum-analytics-saved-funnel-row-0-current").text()).toBe("Current");
    expect(q("rum-analytics-saved-funnel-row-1-current").exists()).toBe(false);
  });

  it("opening another funnel over unsaved edits asks first and stays when declined", async () => {
    api.seedFunnel("web", "Alpha", PARAM);
    api.seedFunnel("web", "Beta", OTHER);
    await mountPage();
    const pa = useProductAnalytics();
    pa.openSavedFunnel(useSavedFunnels().funnels.value[0]);
    pa.funnel.value = def("/a", "/mine");
    confirmMock.mockResolvedValueOnce(false);
    await row(1).trigger("click");
    await settle();
    expect(confirmMock.mock.calls[0][0].title).toBe("Discard unsaved changes?");
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnels);
    expect(pa.funnel.value).toEqual(def("/a", "/mine"));
  });

  it("leaves New funnel to the shell header, so the page draws no second primary action", async () => {
    api.seedFunnel("web", "Alpha", PARAM);
    await mountPage();
    expect(q("rum-analytics-saved-funnels-new-btn").exists()).toBe(false);
    expect(wrapper!.findAll("button").filter((b) => b.text() === "New funnel")).toEqual([]);
  });

  describe("row actions", () => {
    const openAWithEdits = async () => {
      const a = api.seedFunnel("web", "Alpha", PARAM);
      const b = api.seedFunnel("web", "Beta", OTHER);
      await mountPage();
      const pa = useProductAnalytics();
      pa.openSavedFunnel(useSavedFunnels().funnels.value[0]);
      pa.funnel.value = def("/a", "/mine");
      await settle();
      const before = {
        funnel: JSON.parse(JSON.stringify(pa.funnel.value)),
        opened: JSON.parse(JSON.stringify(pa.openedFunnel.value)),
      };
      return { a, b, before };
    };
    const expectOpenUntouched = (before: { funnel: unknown; opened: unknown }) => {
      const pa = useProductAnalytics();
      expect(pa.funnel.value).toEqual(before.funnel);
      expect(pa.openedFunnel.value).toEqual(before.opened);
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnels);
    };

    it("Rename renames only that row; the open funnel and its edits stay (F48)", async () => {
      const { b, before } = await openAWithEdits();
      await action(1, "rename").trigger("click");
      await settle();
      expect(q("rum-analytics-save-funnel-dialog").attributes("data-title")).toBe(
        "Rename saved funnel",
      );
      await fillAndSubmit("Beta 2");
      expect(api.funnels.get(b.id)?.name).toBe("Beta 2");
      expect(api.funnels.get(b.id)?.def).toEqual(OTHER);
      expect(names()).toEqual(["Alpha", "Beta 2"]);
      expectOpenUntouched(before);
    });

    it("renaming the open funnel keeps its unsaved edits on screen", async () => {
      const { a } = await openAWithEdits();
      await action(0, "rename").trigger("click");
      await settle();
      await fillAndSubmit("Alpha 2");
      const pa = useProductAnalytics();
      expect(api.funnels.get(a.id)?.name).toBe("Alpha 2");
      expect(pa.openedFunnel.value?.name).toBe("Alpha 2");
      expect(pa.funnel.value).toEqual(def("/a", "/mine"));
    });

    it("a row deleted elsewhere is reported against that row and the list refreshes (F48)", async () => {
      const { b, before } = await openAWithEdits();
      api.funnels.delete(b.id);
      await action(1, "rename").trigger("click");
      await settle();
      await fillAndSubmit("Beta 2");
      expect(toastMock).toHaveBeenCalledWith({
        variant: "error",
        message: '"Beta" was deleted elsewhere; the list was refreshed',
      });
      expect(confirmMock).not.toHaveBeenCalled();
      expect(names()).toEqual(["Alpha"]);
      expectOpenUntouched(before);
    });

    it("a rename conflict's Reload refreshes the list and Rename anyway renames their version (F48, AC-70)", async () => {
      const { b, before } = await openAWithEdits();
      const theirs = {
        ...OTHER,
        s: [
          ["p", "/o1"],
          ["p", "/theirs"],
        ],
      };
      api.touch("funnels", b.id, { def: theirs });
      await action(1, "rename").trigger("click");
      await settle();
      await fillAndSubmit("Beta 2");
      const dialog = q("rum-analytics-funnel-conflict-dialog");
      expect(dialog.text()).toContain('other@x.com changed "Beta" at');
      await dialog.find(".o-dialog-secondary").trigger("click");
      await settle();
      expect(useSavedFunnels().funnels.value.find((f) => f.id === b.id)?.version).toBe(2);
      expect(api.funnels.get(b.id)?.name).toBe("Beta");

      api.touch("funnels", b.id, { description: "theirs" });
      await action(1, "rename").trigger("click");
      await settle();
      await fillAndSubmit("Beta 3");
      await q("rum-analytics-funnel-conflict-dialog").find(".o-dialog-primary").trigger("click");
      await settle();
      expect(api.bodies("updateFunnel").at(-1)).toMatchObject({
        name: "Beta 3",
        description: "theirs",
        def: theirs,
        version: 3,
      });
      expect(api.service.createFunnel).not.toHaveBeenCalled();
      expectOpenUntouched(before);
    });

    it("Duplicate names the copy Copy of, saves the row as stored and stays on the list", async () => {
      const { before } = await openAWithEdits();
      await action(1, "duplicate").trigger("click");
      await settle();
      expect(q("rum-analytics-save-funnel-dialog").attributes("data-title")).toBe(
        "Duplicate funnel",
      );
      expect(nameInput().element.value).toBe("Copy of Beta");
      await fillAndSubmit();
      expect(api.bodies("createFunnel")).toEqual([
        { name: "Copy of Beta", def: OTHER, sql: 'SELECT 1 FROM "_rumdata"' },
      ]);
      expect(names()).toEqual(["Alpha", "Beta", "Copy of Beta"]);
      expectOpenUntouched(before);
    });

    it("Duplicate is off while a step's event is deleted, saying why (CR-11)", async () => {
      api.seedEvent("web", "Logs page", { id: EV });
      api.seedFunnel("web", "Gone", {
        ...PARAM,
        s: [
          ["p", "/a"],
          ["e", GONE],
        ],
      });
      await mountPage();
      expect(action(0, "duplicate").attributes("disabled")).toBeDefined();
      expect(action(0, "rename").attributes("disabled")).toBeUndefined();
    });

    it("Delete confirms, removes the row and detaches it when it is the open funnel", async () => {
      const { a } = await openAWithEdits();
      await action(0, "delete").trigger("click");
      await settle();
      expect(confirmMock.mock.calls.at(-1)![0].message).toBe(
        'Delete "Alpha" for everyone in this organization? Links to it will fall back to the steps they carried.',
      );
      expect(api.funnels.has(a.id)).toBe(false);
      expect(names()).toEqual(["Beta"]);
      expect(useProductAnalytics().openedFunnel.value).toBeNull();
    });

    it("below md the same actions sit behind one kebab per row, with -menu ids", async () => {
      api.seedFunnel("web", "Alpha", PARAM);
      await mountPage();
      expect(q("rum-analytics-saved-funnel-row-0-menu").classes()).toContain("md:hidden");
      expect([...action(0, "rename").element.parentElement!.classList]).toContain("max-md:hidden");
      await q("rum-analytics-saved-funnel-row-0-rename-menu").trigger("click");
      await settle();
      expect(q("rum-analytics-save-funnel-dialog").attributes("data-title")).toBe(
        "Rename saved funnel",
      );
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnels);
    });
  });

  it("bulk Delete confirms with the count, removes every selected funnel and reloads once", async () => {
    const a = api.seedFunnel("web", "Alpha", PARAM);
    const b = api.seedFunnel("web", "Beta", PARAM);
    api.seedFunnel("web", "Gamma", PARAM);
    await mountPage();
    wrapper!.findComponent(OTable).vm.$emit("update:selectedIds", [a.id, b.id]);
    await settle();
    api.service.listFunnels.mockClear();
    await q("rum-analytics-saved-funnels-bulk-delete-btn").trigger("click");
    await settle();
    expect(confirmMock.mock.calls[0][0].message).toBe(
      "Delete 2 saved funnels for everyone in this organization? Links to them will fall back to the steps they carried.",
    );
    expect(names()).toEqual(["Gamma"]);
    expect(api.service.listFunnels).toHaveBeenCalledTimes(1);
    expect(wrapper!.findComponent(OTable).props("selectedIds")).toEqual([]);
  });

  it("an app with none shows the empty state with Build a funnel and the quick starts (AC-58)", async () => {
    await mountPage();
    expect(wrapper!.text()).toContain("No saved funnels yet");
    expect(q("rum-analytics-funnel-entry-start-0").text()).toContain("/web/login");
    await q("rum-analytics-funnel-entry-start-0").trigger("click");
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
    expect(useProductAnalytics().funnel.value.steps).toEqual([{ kind: "p", key: "/web/login" }]);
  });

  it("the empty state's Build a funnel opens an empty builder", async () => {
    await mountPage();
    const card = wrapper!
      .findAll("button")
      .find((b) => b.text().includes("Build a funnel") && b.text().includes("Pick where"));
    await card!.trigger("click");
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
    expect(useProductAnalytics().funnel.value.steps).toEqual([]);
  });

  it("without read access the table says so, with the reason, and no rows (AC-68)", async () => {
    api.seedFunnel("web", "Alpha", PARAM);
    api.failNext("listFunnels", 403);
    await mountPage();
    expect(wrapper!.findComponent(OTable).props("forbidden")).toBe(true);
    expect(q("rum-analytics-funnel-saved-no-access").text()).toContain(
      "Your role cannot read RUM data (the _rumdata stream)",
    );
    expect(row(0).exists()).toBe(false);
  });

  it("without write the change actions are off with the reason, and selection is off (AC-68)", async () => {
    const a = api.seedFunnel("web", "Alpha", PARAM);
    api.failNext("deleteFunnel", 403);
    await mountPage();
    await action(0, "delete").trigger("click");
    await settle();
    expect(api.funnels.has(a.id)).toBe(true);
    expect(q("rum-analytics-saved-funnels-read-only").text()).toBe(
      "Your role can open but not change saved funnels (RUM Product Analytics permission)",
    );
    for (const name of ["rename", "duplicate", "delete"]) {
      expect(action(0, name).attributes("disabled")).toBeDefined();
    }
    expect(wrapper!.findComponent(OTable).props("selection")).toBe("none");
    await row(0).trigger("click");
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
  });

  it("reports unreadable rows above the table and lists the rest (AC-69)", async () => {
    api.seedFunnel("web", "Alpha", PARAM);
    api.seedFunnel("web", "Broken", { u: "sessions" });
    await mountPage();
    expect(q("rum-analytics-funnel-saved-unreadable").text()).toBe(
      "1 saved funnel could not be read",
    );
    expect(names()).toEqual(["Alpha"]);
  });

  it("shows loading only until the first list lands, so a refresh keeps the rows", async () => {
    api.seedFunnel("web", "Alpha", PARAM);
    const release = api.gate("listFunnels");
    await mountPage();
    expect(wrapper!.findComponent(OTable).props("loading")).toBe(true);
    release();
    await settle();
    expect(wrapper!.findComponent(OTable).props("loading")).toBe(false);
    const again = api.gate("listFunnels");
    await q("rum-analytics-saved-funnels-refresh").trigger("click");
    await flushPromises();
    expect(wrapper!.findComponent(OTable).props("loading")).toBe(false);
    expect(names()).toEqual(["Alpha"]);
    again();
    await settle();
  });

  it("switching between two apps with no funnels shows the second app's entry pages (F5)", async () => {
    searchRoutes.unshift([
      /application_id = 'shop'[\s\S]*entry_sessions|entry_sessions[\s\S]*application_id = 'shop'/,
      [{ k: "/shop/cart", entry_sessions: 40, prev_entry_sessions: 1, exit_sessions: 1 }],
    ]);
    searchRoutes[1] = [
      /AS app, COUNT/,
      [
        { app: "web", sessions: 500 },
        { app: "shop", sessions: 9 },
      ],
    ];
    try {
      await mountPage();
      expect(q("rum-analytics-funnel-entry-start-0").text()).toContain("/web/login");
      useProductAnalytics().setScope({ app: "shop", env: [], version: [] }, true);
      await settle();
      expect(q("rum-analytics-funnel-entry-start-0").text()).toContain("/shop/cart");
      expect(wrapper!.text()).not.toContain("/web/login");
    } finally {
      searchRoutes.shift();
      searchRoutes[0] = [/AS app, COUNT/, [{ app: "web", sessions: 500 }]];
    }
  });

  it("a shell Refresh on an absolute range refetches the entry pages (F10)", async () => {
    const entryRoute = searchRoutes.findIndex(([re]) => re.source === "entry_sessions");
    const original = searchRoutes[entryRoute];
    try {
      await mountPage({
        period: undefined as unknown as string,
        from: "1700000000000000",
        to: "1700086400000000",
      });
      expect(useProductAnalytics().state.datetime.valueType).toBe("absolute");
      expect(q("rum-analytics-funnel-entry-start-0").text()).toContain("/web/login");
      searchRoutes[entryRoute] = [
        /entry_sessions/,
        [{ k: "/web/fresh", entry_sessions: 70, prev_entry_sessions: 1, exit_sessions: 1 }],
      ];
      await useProductAnalytics().refresh();
      await settle();
      expect(q("rum-analytics-funnel-entry-start-0").text()).toContain("/web/fresh");
    } finally {
      searchRoutes[entryRoute] = original;
    }
  });

  it("mounting inside keep-alive loads once, as a plain mount does (F6)", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const recentReads = () =>
      getItem.mock.calls.filter(([k]) => k === "o2.rum.analytics.org1.web.recent").length;
    try {
      await mountPage();
      const plain = recentReads();
      wrapper!.unmount();
      wrapper = null;
      resetProductAnalytics();
      resetSavedFunnels();
      resetNamedEvents();
      getItem.mockClear();
      await mountPage({}, true);
      expect(plain).toBeGreaterThan(0);
      expect(recentReads()).toBe(plain);
    } finally {
      getItem.mockRestore();
    }
  });

  it("coming back to the kept-alive list keeps the time the list was read, not the time of return (F7)", async () => {
    api.seedFunnel("web", "Alpha", PARAM);
    await mountPage({}, true);
    const read = wrapper!.findComponent(ORefreshButton).props("lastRunAt") as number;
    expect(read).toBeGreaterThan(0);
    const later = read + 10 * 60_000;
    const now = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      api.service.listFunnels.mockClear();
      await router.push({ name: PA_ROUTES.overview, query: router.currentRoute.value.query });
      await settle();
      await router.push({ name: PA_ROUTES.funnels, query: router.currentRoute.value.query });
      await settle();
      expect(api.service.listFunnels).not.toHaveBeenCalled();
      expect(wrapper!.findComponent(ORefreshButton).props("lastRunAt")).toBe(read);
      await q("rum-analytics-saved-funnels-refresh").trigger("click");
      await settle();
      expect(api.service.listFunnels).toHaveBeenCalledTimes(1);
      expect(wrapper!.findComponent(ORefreshButton).props("lastRunAt")).toBe(later);
    } finally {
      now.mockRestore();
    }
  });

  it("a failed load says so with Retry, which reads the list again", async () => {
    api.seedFunnel("web", "Alpha", PARAM);
    api.failNext("listFunnels", 503);
    await mountPage();
    expect(q("rum-analytics-saved-funnels-error").text()).toContain(
      "Saved funnels could not be loaded",
    );
    await q("rum-analytics-saved-funnels-retry-btn").trigger("click");
    await settle();
    expect(names()).toEqual(["Alpha"]);
  });
});
