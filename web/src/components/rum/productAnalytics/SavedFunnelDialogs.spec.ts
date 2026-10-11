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

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { defineComponent, h, ref } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { createStore } from "vuex";
import i18n from "@/locales";

vi.mock("@/services/rumProductAnalytics", async () => ({
  default: (await import("@/utils/rum/__fixtures__/namedEventsApiMock")).rumPaApiMock.service,
}));
vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: { search: vi.fn() } });
});
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: vi.fn(async () => true) }),
}));
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: vi.fn(),
}));

import searchService from "@/services/search";
import SavedFunnelDialogs from "./SavedFunnelDialogs.vue";
import usePerformance from "@/composables/rum/usePerformance";
import useProductAnalytics, { resetProductAnalytics } from "@/composables/rum/useProductAnalytics";
import useSavedFunnels, { resetSavedFunnels } from "@/composables/rum/useSavedFunnels";
import { resetNamedEvents } from "@/composables/rum/useNamedEvents";
import { PA_ROUTES } from "@/utils/rum/productAnalyticsRoutes";
import { rumPaApiMock as api } from "@/utils/rum/__fixtures__/namedEventsApiMock";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";
import type { SavedFunnel } from "@/utils/rum/productAnalyticsModel";

const store = createStore({
  state: { selectedOrganization: { identifier: "org1" }, timezone: "UTC", zoConfig: {} },
});
const stubs = {
  ODialog: {
    name: "ODialog",
    props: ["open", "title", "primaryButtonLabel", "secondaryButtonLabel", "formId"],
    emits: ["update:open", "click:primary", "click:secondary"],
    template: `<div v-if="open" v-bind="$attrs"><slot />
      <button v-if="formId" type="submit" :form="formId">{{ primaryButtonLabel }}</button></div>`,
  },
};

const STORED_HASH = "aaaaaaaaaaaaaaaa";
const CURRENT_HASH = "0123456789abcdef";
const PARAM = {
  s: [
    ["p", "/a"],
    ["p", "/b"],
  ],
  u: "sessions",
  w: "session",
};
const compile = (d: FunnelDef) => `SQL ${d.steps.map((s) => s.key).join(",")}`;

type Exposed = {
  rename: (f: SavedFunnel) => void;
  duplicate: (f: SavedFunnel, asStored: boolean) => void;
};

describe("pa gap fixes: SavedFunnelDialogs recompiles on rename and duplicate", () => {
  let wrapper: VueWrapper | null = null;
  const dialogs = ref<Exposed | null>(null);
  const svc = api.service as unknown as Record<string, Mock>;

  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 5));
      await flushPromises();
    }
  };

  const mountDialogs = async () => {
    const Host = defineComponent({
      setup: () => () =>
        h(SavedFunnelDialogs, { ref: dialogs, events: [], eventsReady: true, compileSql: compile }),
    });
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/fb", name: PA_ROUTES.funnelBuilder, component: Host }],
    });
    await router.push({ name: PA_ROUTES.funnelBuilder, query: { app: "web", period: "7d" } });
    const pa = useProductAnalytics();
    pa.initFromRoute(router.currentRoute.value.query);
    wrapper = mount(RouterView, {
      global: { plugins: [router, i18n, store], stubs },
      attachTo: document.body,
    });
    await pa.loadScope();
    await useSavedFunnels().ensure("org1", "web");
    await settle();
  };

  const submit = async (name?: string) => {
    if (name !== undefined)
      await wrapper!.find('[data-test="rum-analytics-save-funnel-name"] input').setValue(name);
    await wrapper!.find("form").trigger("submit");
    await settle();
  };

  beforeEach(() => {
    api.reset();
    resetSavedFunnels();
    resetNamedEvents();
    resetProductAnalytics();
    svc.getAppSettings = vi.fn(async (_org: string, app: string) => ({
      data: {
        id: "settingsid00000000000000001",
        app,
        bots: true,
        builtinBots: {
          version: 1,
          families: ["HeadlessChrome", "PhantomJS", "Spider"],
          devices: ["Spider"],
        },
        sessions: [],
        pages: [],
        version: 1,
        rulesHash: CURRENT_HASH,
        createdBy: "admin@x.com",
        createdAt: 1,
        updatedBy: "admin@x.com",
        updatedAt: 1,
      },
    }));
    usePerformance().performanceState.data.streams._rumdata = { name: "_rumdata", schema: {} };
    vi.mocked(searchService.search)
      .mockReset()
      .mockImplementation((async (args: { query: { query: { sql: string } } }) => {
        const sql = args.query.query.sql;
        if (/AS app, COUNT/.test(sql)) return { data: { hits: [{ app: "web", sessions: 5 }] } };
        if (/va_rows/.test(sql))
          return { data: { hits: [{ sessions: 5, prev_sessions: 5, views: 9, va_rows: 9 }] } };
        return { data: { hits: [] } };
      }) as never);
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    delete svc.getAppSettings;
    document.body.innerHTML = "";
  });

  it("P7-R1: rename recompiles sql from the stored def and sends the current rules_hash", async () => {
    api.seedFunnel("web", "Signup", PARAM, { rulesHash: STORED_HASH });
    await mountDialogs();
    dialogs.value!.rename(useSavedFunnels().funnels.value[0]);
    await settle();
    await submit("Signup 2");
    expect(api.bodies("updateFunnel")).toEqual([
      expect.objectContaining({
        name: "Signup 2",
        def: PARAM,
        sql: "SQL /a,/b",
        rules_hash: CURRENT_HASH,
      }),
    ]);
  });

  it("P7-R1: duplicate as stored recompiles sql from the stored def and sends the current rules_hash", async () => {
    api.seedFunnel("web", "Signup", PARAM, { rulesHash: STORED_HASH });
    await mountDialogs();
    useProductAnalytics().funnel.value = {
      steps: [
        { kind: "p", key: "/x" },
        { kind: "p", key: "/y" },
      ],
      unit: "sessions",
      window: "session",
      breakdown: null,
    };
    dialogs.value!.duplicate(useSavedFunnels().funnels.value[0], true);
    await settle();
    await submit();
    expect(api.bodies("createFunnel")).toEqual([
      expect.objectContaining({
        name: "Copy of Signup",
        def: PARAM,
        sql: "SQL /a,/b",
        rules_hash: CURRENT_HASH,
      }),
    ]);
  });

  it("P7-R1: duplicate of the funnel on screen sends the current rules_hash", async () => {
    api.seedFunnel("web", "Signup", PARAM, { rulesHash: STORED_HASH });
    await mountDialogs();
    useProductAnalytics().funnel.value = {
      steps: [
        { kind: "p", key: "/x" },
        { kind: "p", key: "/y" },
      ],
      unit: "sessions",
      window: "session",
      breakdown: null,
    };
    await settle();
    dialogs.value!.duplicate(useSavedFunnels().funnels.value[0], false);
    await settle();
    await submit();
    expect(api.bodies("createFunnel")).toEqual([
      expect.objectContaining({ sql: "SQL /x,/y", rules_hash: CURRENT_HASH }),
    ]);
  });
});
