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
import { defineComponent, h, ref } from "vue";
import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { createStore } from "vuex";
import i18n from "@/locales";

const { confirmMock, toastMock, copyMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(async (_o: Record<string, unknown>) => true),
  toastMock: vi.fn(),
  copyMock: vi.fn(async (_text: string, _t: unknown, _o?: unknown) => true),
}));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copyMock }));
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

import SavedFunnelBar from "./SavedFunnelBar.vue";
import useProductAnalytics, { resetProductAnalytics } from "@/composables/rum/useProductAnalytics";
import useSavedFunnels, { resetSavedFunnels } from "@/composables/rum/useSavedFunnels";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";
import type { NamedEvent } from "@/utils/rum/productAnalyticsModel";

const store = createStore({
  state: { selectedOrganization: { identifier: "org1" }, timezone: "UTC", zoConfig: {} },
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
      '<button class="o-dropdown-item" :data-test="$attrs[\'data-test\']" :disabled="disabled" @click.stop="$emit(\'select\')"><slot /></button>',
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
const def = (...steps: [string, string][]): FunnelDef => ({
  steps: steps.map(([kind, key]) => ({ kind: kind as "p" | "e", key })),
  unit: "sessions",
  window: "session",
  breakdown: null,
});
const events: NamedEvent[] = [
  {
    id: EV,
    app: "web",
    name: "Logs page",
    rules: [{ t: "view", op: "eq", value: "/web/logs" }],
    version: 1,
    createdBy: "",
    createdAt: 0,
    updatedBy: "",
    updatedAt: 0,
  },
];

const Blank = defineComponent({ render: () => h("div", { "data-test": "blank" }) });

describe("SavedFunnelBar, the builder header (AC-67, AC-68, AC-70)", () => {
  let wrapper: VueWrapper | null = null;
  let router: Router;

  beforeEach(() => {
    api.reset();
    resetSavedFunnels();
    resetProductAnalytics();
    confirmMock.mockReset().mockResolvedValue(true);
    toastMock.mockReset();
    copyMock.mockClear();
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await flushPromises();
    }
  };
  const mountBar = async (
    d: FunnelDef = def(["p", "/a"], ["p", "/b"]),
    compileSql: (d: FunnelDef) => string | null = () => 'SELECT 1 FROM "_rumdata"',
  ) => {
    const Builder = defineComponent({
      setup: () => () => h(SavedFunnelBar, { events, eventsReady: true, compileSql }),
    });
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: "/logs", name: "logs", component: Blank },
        {
          path: "/product-analytics",
          name: PA_ROUTES.shell,
          component: RouterView,
          children: [
            { path: "funnels", name: PA_ROUTES.funnels, component: Blank },
            { path: "funnels/build", name: PA_ROUTES.funnelBuilder, component: Builder },
            { path: "paths", name: PA_ROUTES.paths, component: Blank },
          ],
        },
      ],
    });
    await router.push({ name: PA_ROUTES.funnelBuilder, query: { app: "web", period: "7d" } });
    useProductAnalytics().initFromRoute(router.currentRoute.value.query);
    useProductAnalytics().funnel.value = d;
    wrapper = mount(RouterView, {
      global: { plugins: [router, i18n, store], stubs },
      attachTo: document.body,
    });
    await settle();
  };
  // Dialogs portal to body, so lookups go through the document.
  const q = (dt: string) => {
    const el = document.querySelector(`[data-test="${dt}"]`);
    return el ? new DOMWrapper(el) : wrapper!.find(`[data-test="${dt}"]`);
  };
  // The list page opens a funnel by handing it to the builder; the header then shows it.
  const openRow = async (i: number) => {
    await useSavedFunnels().ensure("org1", "web");
    useProductAnalytics().openSavedFunnel(useSavedFunnels().funnels.value[i]);
    await settle();
  };
  const menu = (action: string) => q(`rum-analytics-funnel-saved-menu-${action}`);
  const fillAndSubmit = async (name?: string) => {
    if (name !== undefined) {
      await wrapper!.find('[data-test="rum-analytics-save-funnel-name"] input').setValue(name);
    }
    await wrapper!.find("form").trigger("submit");
    await settle();
  };

  it("saves an unsaved funnel under a name with its def and compiled sql, then shows that name (AC-67)", async () => {
    await mountBar();
    expect(q("rum-analytics-funnel-saved-name").text()).toBe("Unsaved funnel");
    await q("rum-analytics-funnel-save-btn").trigger("click");
    await fillAndSubmit("Signup");
    expect(api.bodies("createFunnel")).toEqual([
      { name: "Signup", def: PARAM, sql: 'SELECT 1 FROM "_rumdata"' },
    ]);
    expect(q("rum-analytics-funnel-saved-name").text()).toBe("Signup");
    expect(q("rum-analytics-funnel-dirty-tag").exists()).toBe(false);
    expect(useProductAnalytics().toQuery().sf).toBe(useProductAnalytics().openedFunnel.value?.id);
  });

  it("opening one restores its definition; a change marks it Edited and Save overwrites with the opened version (AC-67, AC-70)", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    await mountBar(def(["p", "/x"], ["p", "/y"]));
    await openRow(0);
    const pa = useProductAnalytics();
    expect(pa.funnel.value).toEqual(def(["p", "/a"], ["p", "/b"]));
    expect(q("rum-analytics-funnel-dirty-tag").exists()).toBe(false);
    pa.funnel.value = { ...pa.funnel.value, unit: "users", window: "1d" };
    await settle();
    expect(q("rum-analytics-funnel-dirty-tag").text()).toBe("Edited");
    await q("rum-analytics-funnel-save-btn").trigger("click");
    await settle();
    expect(api.service.updateFunnel.mock.calls[0].slice(0, 3)).toEqual(["org1", "web", row.id]);
    expect(api.bodies("updateFunnel")[0]).toMatchObject({ name: "Signup", version: 1 });
    expect(q("rum-analytics-funnel-dirty-tag").exists()).toBe(false);
    expect(pa.openedFunnel.value?.version).toBe(2);
  });

  it("a funnel changed by someone else since it was opened opens Reload or Overwrite naming who (AC-70)", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    await mountBar();
    await openRow(0);
    api.touch("funnels", row.id, {
      def: {
        ...PARAM,
        s: [
          ["p", "/a"],
          ["p", "/theirs"],
        ],
      },
    });
    const pa = useProductAnalytics();
    pa.funnel.value = def(["p", "/a"], ["p", "/mine"]);
    await settle();
    await q("rum-analytics-funnel-save-btn").trigger("click");
    await settle();
    const dialog = q("rum-analytics-funnel-conflict-dialog");
    expect(dialog.text()).toContain('other@x.com changed "Signup" at');
    const when = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(api.funnels.get(row.id)!.updatedAt as number));
    expect(dialog.text()).toContain(when);
    await dialog.find(".o-dialog-primary").trigger("click");
    await settle();
    expect(api.bodies("updateFunnel").map((b) => b.version)).toEqual([1, 2]);
    expect(api.funnels.get(row.id)?.def).toEqual({
      ...PARAM,
      s: [
        ["p", "/a"],
        ["p", "/mine"],
      ],
    });

    api.touch("funnels", row.id, {
      def: {
        ...PARAM,
        s: [
          ["p", "/a"],
          ["p", "/again"],
        ],
      },
    });
    pa.funnel.value = def(["p", "/a"], ["p", "/mine2"]);
    await settle();
    await q("rum-analytics-funnel-save-btn").trigger("click");
    await settle();
    await q("rum-analytics-funnel-conflict-dialog").find(".o-dialog-secondary").trigger("click");
    await settle();
    expect(pa.funnel.value).toEqual(def(["p", "/a"], ["p", "/again"]));
    expect(pa.openedFunnel.value?.version).toBe(4);
    expect(q("rum-analytics-funnel-dirty-tag").exists()).toBe(false);
  });

  it("Save on a funnel someone deleted offers Save as a new one (CR-11)", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    await mountBar();
    await openRow(0);
    api.funnels.delete(row.id);
    useProductAnalytics().funnel.value = def(["p", "/a"], ["p", "/c"]);
    await settle();
    await q("rum-analytics-funnel-save-btn").trigger("click");
    await settle();
    expect(confirmMock.mock.calls[0][0].message).toBe(
      "This saved funnel was deleted. Save as a new one?",
    );
    expect(q("rum-analytics-save-funnel-dialog").attributes("data-title")).toBe("Save funnel as");
    await fillAndSubmit();
    expect(api.bodies("createFunnel")).toEqual([
      {
        name: "Signup",
        def: {
          ...PARAM,
          s: [
            ["p", "/a"],
            ["p", "/c"],
          ],
        },
        sql: expect.any(String),
      },
    ]);
  });

  it("Save as new, Rename and Duplicate each open the name dialog; Duplicate pre-fills Copy of and opens the copy (AC-67)", async () => {
    api.seedFunnel("web", "Signup", PARAM);
    await mountBar();
    await openRow(0);
    const pa = useProductAnalytics();
    pa.funnel.value = def(["p", "/a"], ["p", "/edited"]);
    await settle();
    await menu("duplicate").trigger("click");
    await settle();
    expect(q("rum-analytics-save-funnel-dialog").attributes("data-title")).toBe("Duplicate funnel");
    expect(
      (
        wrapper!.find('[data-test="rum-analytics-save-funnel-name"] input')
          .element as HTMLInputElement
      ).value,
    ).toBe("Copy of Signup");
    await fillAndSubmit();
    expect(api.bodies("createFunnel").at(-1)).toMatchObject({
      name: "Copy of Signup",
      def: {
        ...PARAM,
        s: [
          ["p", "/a"],
          ["p", "/edited"],
        ],
      },
    });
    expect(pa.openedFunnel.value?.name).toBe("Copy of Signup");
    expect(q("rum-analytics-funnel-saved-name").text()).toBe("Copy of Signup");
    await menu("rename").trigger("click");
    await settle();
    expect(q("rum-analytics-save-funnel-dialog").attributes("data-title")).toBe(
      "Rename saved funnel",
    );
    await fillAndSubmit("Signup v2");
    expect(api.bodies("updateFunnel").at(-1)).toMatchObject({ name: "Signup v2", version: 1 });
    expect(q("rum-analytics-funnel-saved-name").text()).toBe("Signup v2");
    expect(menu("save-as").text()).toBe("Save as new");
    await menu("save-as").trigger("click");
    await settle();
    expect(q("rum-analytics-save-funnel-dialog").attributes("data-title")).toBe("Save funnel as");
    await fillAndSubmit("Signup v3");
    expect(api.bodies("createFunnel").at(-1)).toMatchObject({ name: "Signup v3" });
    expect(pa.openedFunnel.value?.name).toBe("Signup v3");
    expect([...api.funnels.values()].map((f) => f.name).sort()).toEqual([
      "Signup",
      "Signup v2",
      "Signup v3",
    ]);
  });

  it("Save is disabled below 2 steps; Save as and Duplicate are disabled with a Deleted event step (CR-11)", async () => {
    await mountBar(def(["p", "/a"]));
    expect(q("rum-analytics-funnel-save-btn").attributes("disabled")).toBeDefined();
    useProductAnalytics().funnel.value = def(["p", "/a"], ["e", GONE]);
    await settle();
    expect(menu("save-as").attributes("disabled")).toBeDefined();
    useProductAnalytics().funnel.value = def(["p", "/a"], ["e", EV]);
    await settle();
    expect(menu("save-as").attributes("disabled")).toBeUndefined();
  });

  it("compiles the stored sql from the stored def, and offers no save when that def cannot be compiled (F49)", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    const compiled: FunnelDef[] = [];
    const compile = (d: FunnelDef) => {
      compiled.push(d);
      return d.unit === "users" ? null : `SQL ${d.steps.map((s) => s.key).join(",")}`;
    };
    await mountBar(def(["p", "/a"], ["p", "/b"]), compile);
    const pa = useProductAnalytics();
    pa.funnel.value = { ...pa.funnel.value, unit: "users", window: "7d" };
    await settle();
    expect(q("rum-analytics-funnel-save-btn").attributes("disabled")).toBeDefined();
    expect(menu("save-as").attributes("disabled")).toBeDefined();
    await openRow(0);
    pa.funnel.value = { ...pa.funnel.value, unit: "users", window: "7d" };
    await settle();
    expect(q("rum-analytics-funnel-save-btn").attributes("disabled")).toBeDefined();
    expect(menu("duplicate").attributes("disabled")).toBeDefined();
    pa.funnel.value = def(["p", "/a"], ["p", "/c"]);
    await settle();
    await q("rum-analytics-funnel-save-btn").trigger("click");
    await settle();
    expect(api.bodies("updateFunnel")).toEqual([
      expect.objectContaining({
        def: {
          ...PARAM,
          s: [
            ["p", "/a"],
            ["p", "/c"],
          ],
        },
        sql: "SQL /a,/c",
      }),
    ]);
    expect(compiled.at(-1)).toEqual(def(["p", "/a"], ["p", "/c"]));
    expect(api.service.updateFunnel.mock.calls[0][2]).toBe(row.id);
  });

  it("Overwrite never closes with nothing saved: a draft that no longer compiles keeps the dialog open with Save's reason (F60)", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    const compilable = ref(true);
    await mountBar(def(["p", "/a"], ["p", "/b"]), () =>
      compilable.value ? 'SELECT 1 FROM "_rumdata"' : null,
    );
    await openRow(0);
    api.touch("funnels", row.id, { name: "Signup" });
    const pa = useProductAnalytics();
    pa.funnel.value = def(["p", "/a"], ["p", "/mine"]);
    await settle();
    await q("rum-analytics-funnel-save-btn").trigger("click");
    await settle();
    expect(api.service.updateFunnel).toHaveBeenCalledTimes(1);
    compilable.value = false;
    await settle();
    wrapper!.findComponent({ name: "ODialog" }).vm.$emit("click:primary");
    await settle();
    expect(q("rum-analytics-funnel-conflict-dialog").exists()).toBe(true);
    expect(api.service.updateFunnel).toHaveBeenCalledTimes(1);
    expect(pa.openedFunnel.value?.version).toBe(1);
    expect(q("rum-analytics-funnel-conflict-blocked").text()).toBe(
      "Users cannot be counted in this range, so this funnel cannot be saved with them; switch to Sessions to save it",
    );
    expect(
      q("rum-analytics-funnel-conflict-dialog").find(".o-dialog-primary").attributes("disabled"),
    ).toBeDefined();

    compilable.value = true;
    await settle();
    expect(q("rum-analytics-funnel-conflict-blocked").exists()).toBe(false);
    await q("rum-analytics-funnel-conflict-dialog").find(".o-dialog-primary").trigger("click");
    await settle();
    expect(q("rum-analytics-funnel-conflict-dialog").exists()).toBe(false);
    expect(api.bodies("updateFunnel").map((b) => b.version)).toEqual([1, 2]);
    expect(pa.openedFunnel.value?.version).toBe(3);
  });

  it("Rename of a funnel deleted elsewhere, then Save as new, leaves the Save as dialog open", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    await mountBar();
    await openRow(0);
    api.funnels.delete(row.id);
    await menu("rename").trigger("click");
    await settle();
    await fillAndSubmit("Signup 2");
    expect(confirmMock.mock.calls.at(-1)![0].message).toBe(
      "This saved funnel was deleted. Save as a new one?",
    );
    expect(q("rum-analytics-save-funnel-dialog").attributes("data-title")).toBe("Save funnel as");
  });

  it("Reload in a rename conflict asks before it drops unsaved step edits", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    await mountBar();
    await openRow(0);
    const pa = useProductAnalytics();
    pa.funnel.value = def(["p", "/a"], ["p", "/mine"]);
    await settle();
    api.touch("funnels", row.id, { name: "Theirs" });
    await menu("rename").trigger("click");
    await settle();
    await fillAndSubmit("Renamed");
    confirmMock.mockResolvedValueOnce(false);
    await q("rum-analytics-funnel-conflict-dialog").find(".o-dialog-secondary").trigger("click");
    await settle();
    expect(confirmMock.mock.calls.at(-1)![0]).toMatchObject({ title: "Discard unsaved changes?" });
    expect(pa.funnel.value).toEqual(def(["p", "/a"], ["p", "/mine"]));
  });

  it("a 403 on Save says the role cannot change saved funnels and keeps the funnel on screen", async () => {
    api.failNext("createFunnel", 403);
    await mountBar();
    await q("rum-analytics-funnel-save-btn").trigger("click");
    await fillAndSubmit("Signup");
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "Your role can open but not change saved funnels (RUM Product Analytics permission)",
      }),
    );
    expect(q("rum-analytics-save-funnel-dialog").exists()).toBe(false);
    expect(useProductAnalytics().funnel.value).toEqual(def(["p", "/a"], ["p", "/b"]));
  });

  it("Save is off on an opened funnel with no changes, so it never sends a change-free update", async () => {
    api.seedFunnel("web", "Signup", PARAM);
    await mountBar();
    await openRow(0);
    expect(q("rum-analytics-funnel-save-btn").attributes("disabled")).toBeDefined();
    useProductAnalytics().funnel.value = def(["p", "/a"], ["p", "/c"]);
    await settle();
    expect(q("rum-analytics-funnel-save-btn").attributes("disabled")).toBeUndefined();
  });

  it("Back returns to the list with the scope, keeping unsaved edits without asking", async () => {
    api.seedFunnel("web", "Signup", PARAM);
    await mountBar();
    await openRow(0);
    const pa = useProductAnalytics();
    pa.funnel.value = def(["p", "/a"], ["p", "/mine"]);
    await settle();
    expect(q("rum-analytics-funnel-back-btn").attributes("aria-label")).toBe(
      "Back to saved funnels",
    );
    await q("rum-analytics-funnel-back-btn").trigger("click");
    await settle();
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnels);
    expect(router.currentRoute.value.query).toMatchObject({ app: "web", period: "7d" });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(pa.funnel.value).toEqual(def(["p", "/a"], ["p", "/mine"]));
  });

  it("Copy link copies the builder's link with the funnel's sf, never the list's", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    await mountBar();
    expect(menu("copy-link").exists()).toBe(false);
    await openRow(0);
    await menu("copy-link").trigger("click");
    await settle();
    const link = new URL(copyMock.mock.calls[0][0]);
    expect(link.pathname).toBe("/product-analytics/funnels/build");
    expect(link.searchParams.get("sf")).toBe(row.id);
    expect(link.searchParams.get("app")).toBe("web");
    expect(copyMock.mock.calls[0][2]).toEqual({ successMessage: "Link copied" });
  });

  it("Delete confirms, then returns to the list with the funnel gone and nothing left on screen", async () => {
    const row = api.seedFunnel("web", "Signup", PARAM);
    await mountBar();
    await openRow(0);
    confirmMock.mockResolvedValueOnce(false);
    await menu("delete").trigger("click");
    await settle();
    expect(api.funnels.has(row.id)).toBe(true);
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
    await menu("delete").trigger("click");
    await settle();
    expect(confirmMock.mock.calls.at(-1)![0].message).toBe(
      'Delete "Signup" for everyone in this organization? Links to it will fall back to the steps they carried.',
    );
    expect(api.funnels.has(row.id)).toBe(false);
    const pa = useProductAnalytics();
    expect(pa.openedFunnel.value).toBeNull();
    expect(pa.funnel.value.steps).toEqual([]);
    expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnels);
    expect(router.currentRoute.value.query.sf).toBeUndefined();
  });

  describe("the unsaved-changes guard", () => {
    const editOpened = async () => {
      api.seedFunnel("web", "Signup", PARAM);
      await mountBar();
      await openRow(0);
      useProductAnalytics().funnel.value = def(["p", "/a"], ["p", "/mine"]);
      await settle();
    };

    it("asks before leaving Product Analytics with edits, and stays when declined", async () => {
      await editOpened();
      confirmMock.mockResolvedValueOnce(false);
      await router.push("/logs");
      expect(confirmMock.mock.calls[0][0]).toMatchObject({
        title: "Discard unsaved changes?",
        message: 'Your changes to "Signup" are not saved. Discard them?',
      });
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.funnelBuilder);
      await router.push("/logs");
      expect(router.currentRoute.value.name).toBe("logs");
    });

    it("never asks for a move to another analysis tab, where the draft survives", async () => {
      await editOpened();
      await router.push({ name: PA_ROUTES.paths, query: { app: "web" } });
      expect(confirmMock).not.toHaveBeenCalled();
      expect(router.currentRoute.value.name).toBe(PA_ROUTES.paths);
    });

    it("never asks once the edits are saved", async () => {
      await editOpened();
      await q("rum-analytics-funnel-save-btn").trigger("click");
      await settle();
      await router.push("/logs");
      expect(confirmMock).not.toHaveBeenCalled();
    });
  });

  it("without write the change actions are hidden with a note, and an open funnel keeps Copy link (AC-68)", async () => {
    api.seedFunnel("web", "Signup", PARAM);
    api.failNext("createFunnel", 403);
    await mountBar();
    await q("rum-analytics-funnel-save-btn").trigger("click");
    await fillAndSubmit("New");
    expect(q("rum-analytics-funnel-saved-read-only").text()).toBe(
      "Your role can open but not change saved funnels (RUM Product Analytics permission)",
    );
    expect(q("rum-analytics-funnel-save-btn").exists()).toBe(false);
    expect(q("rum-analytics-funnel-saved-menu-btn").exists()).toBe(false);
    await openRow(0);
    expect(q("rum-analytics-funnel-saved-name").text()).toBe("Signup");
    expect(menu("copy-link").exists()).toBe(true);
    for (const action of ["save-as", "rename", "duplicate", "delete"]) {
      expect(menu(action).exists()).toBe(false);
    }
  });
});
