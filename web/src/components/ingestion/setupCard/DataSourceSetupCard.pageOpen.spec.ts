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

// The page-open path end to end: real renderer, status bar, install and memory; only the poll, code blocks and transports are faked.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computed, ref } from "vue";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createMemoryHistory } from "vue-router";
import i18n from "@/locales";
import type {
  FirstEventDiagnosis,
  FirstEventResult,
  FirstEventState,
} from "@/composables/firstEvent/useFirstEventWatch";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));

const poll = {
  state: ref<FirstEventState>("waiting"),
  result: ref<FirstEventResult>(),
  diagnosis: ref<FirstEventDiagnosis>(),
  startedAtMs: ref<number>(),
  troubleshooting: ref(false),
  start: vi.fn(),
  stop: vi.fn(),
  probeNow: vi.fn(),
  troubleshoot: vi.fn(),
};
vi.mock("@/composables/firstEvent/useFirstEventWatch", () => ({
  useFirstEventWatch: () => ({
    ...poll,
    scope: computed(() => "new-data"),
    sinceUs: computed(() => undefined),
  }),
}));
vi.mock("@/services/dashboards", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/services/settings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: {} });
});
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: toastMock,
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/composables/useIngestion", () => ({
  default: () => ({ endpoint: ref({ url: "https://test.openobserve.ai" }) }),
}));

import dashboards from "@/services/dashboards";
import settings from "@/services/settings";
import { queryClient } from "@/composables/query/queryClient";
import { resetReadyMadeSessionMemory } from "@/composables/readyMade/readyMadeSettings";
import DataSourceSetupCard from "./DataSourceSetupCard.vue";
import SetupCardRenderer from "./SetupCardRenderer.vue";
import FirstEventStatus from "../FirstEventStatus.vue";

const ORG = "test-org";
const USER = "t@e.com";
const OPEN_BUTTON = '[data-test="ai-step-action-open-ready-made-dashboard"]';
const NOTICE = '[data-test="data-source-setup-card-ready-made-added"]';
const svc = dashboards as unknown as Record<string, ReturnType<typeof vi.fn>>;
const settingsSvc = settings as unknown as Record<string, ReturnType<typeof vi.fn>>;

interface Row {
  dashboard_id: string;
  folder_id: string;
  folder_name: string;
  title: string;
  role: string;
  created: string;
}

/** A tiny in-memory backend: dashboards with a title search, folders by name, one user's memory. */
let rows: Row[];
let folders: Map<string, { folderId: string; name: string }>;
let memory: { version: 1; sources: Record<string, { state: string; at: string }> } | undefined;
let memoryReadFails: boolean;

const httpError = (status: number) =>
  Object.assign(new Error(String(status)), { response: { status } });

const installBackend = () => {
  rows = [];
  folders = new Map();
  memory = undefined;
  memoryReadFails = false;
  svc.list.mockImplementation(async (...args: any[]) => {
    const title = String(args[7] ?? "").toLowerCase();
    return { data: { dashboards: rows.filter((row) => row.title.toLowerCase().includes(title)) } };
  });
  svc.get_Folder_By_Name.mockImplementation(async (_org: string, name: string) => {
    const folder = folders.get(name);
    if (!folder) throw httpError(404);
    return { data: folder };
  });
  svc.new_Folder.mockImplementation(async (_org: string, data: any) => {
    const folder = { folderId: `f-${data.name}`, name: data.name };
    folders.set(data.name, folder);
    return { data: folder };
  });
  svc.create.mockImplementation(async (_org: string, doc: any, folderId: string) => {
    const id = `d${rows.length + 1}`;
    rows.push({
      dashboard_id: id,
      folder_id: folderId,
      folder_name: [...folders.values()].find((f) => f.folderId === folderId)?.name ?? folderId,
      title: doc.title,
      role: doc.role,
      created: "2026-10-13T10:00:00Z",
    });
    return { data: { version: 8, v8: { dashboardId: id } } };
  });
  settingsSvc.getSetting.mockImplementation(async () => {
    if (memoryReadFails) throw httpError(500);
    if (!memory) throw httpError(404);
    return { data: { setting_value: structuredClone(memory) } };
  });
  settingsSvc.setUserSetting.mockImplementation(
    async (_org: string, _user: string, _key: string, value: any) => {
      memory = structuredClone(value);
      return {};
    },
  );
};

const answered = (sourceId: string, state: "added" | "dismissed") => {
  memory = { version: 1, sources: { [sourceId]: { state, at: "2026-10-01T00:00:00Z" } } };
};

const teammateCopy = () =>
  rows.push({
    dashboard_id: "teammate",
    folder_id: "team",
    folder_name: "DB team",
    title: "PostgreSQL / Overview",
    role: "ready-made:postgresql/overview:1",
    created: "2026-09-01T00:00:00Z",
  });

const dashboardWrites = () => [
  ...svc.new_Folder.mock.calls,
  ...svc.create.mock.calls,
  ...svc.delete.mock.calls,
];
const dashboardCalls = () => [
  ...svc.list.mock.calls,
  ...svc.get_Folder_By_Name.mock.calls,
  ...dashboardWrites(),
];

const tp = (key: string, named: Record<string, unknown>, count: number) =>
  (i18n.global as any).t(key, named, count);
const ADDED = tp(
  "dashboard.readyMade.addedOne",
  { name: "PostgreSQL", folder: "PostgreSQL", count: 1 },
  1,
);

// A generous budget: the card is mounted for real, which is slow when the full suite runs in parallel.
const eventually = (assertion: () => void) => vi.waitFor(assertion, { timeout: 10_000 });

describe(
  "DataSourceSetupCard — opening a setup page that already has data",
  { timeout: 20_000 },
  () => {
    let wrapper: VueWrapper<any>;
    let router: any;

    /** Opens the page; the status bar starts its own poll, as it does in the app. */
    const openPage = (slug = "postgres") => {
      poll.state.value = "waiting";
      poll.result.value = undefined;
      const store = createStore({
        state: {
          API_ENDPOINT: "https://api.openobserve.ai",
          zoConfig: { cluster_name: "US1" },
          selectedOrganization: { identifier: ORG },
          organizations: [],
          userInfo: { email: USER },
          organizationData: { organizationPasscode: "pc", orgTokens: [] },
          theme: "light",
        },
      });
      router = createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/", component: { template: "<div />" } },
          { path: "/dashboards/view", name: "viewDashboard", component: { template: "<div />" } },
          { path: "/recommended", name: "recommended", component: { template: "<div />" } },
        ],
      });
      vi.spyOn(router, "push");
      wrapper = mount(DataSourceSetupCard, {
        props: { slug },
        // The code blocks are the slow part of the card and take no part in detection.
        global: { plugins: [store, router], stubs: { OCodeBlock: true } },
      });
    };

    /** The poll finds the source's data; nothing on the page is clicked. */
    const dataArrives = async () => {
      poll.result.value = {
        streamName: "postgresql_backends",
        streamType: "metrics",
        count: 2,
        rangeStart: 1,
        rangeEnd: 2,
      };
      poll.state.value = "received";
      await flushPromises();
    };

    const settle = async () => {
      for (let i = 0; i < 5; i++) await flushPromises();
    };

    /** A later visit: the card remounts, its bar finds the data again, and the memory is read afresh. */
    const openAgain = async () => {
      const reads = settingsSvc.getSetting.mock.calls.length;
      wrapper.unmount();
      openPage();
      await dataArrives();
      await eventually(() => expect(settingsSvc.getSetting.mock.calls.length).toBe(reads + 1));
      await settle();
    };

    beforeEach(() => {
      vi.clearAllMocks();
      queryClient.clear();
      resetReadyMadeSessionMemory();
      installBackend();
      // Reduced motion: the connect confetti would otherwise animate a mocked canvas past the end of each test.
      vi.mocked(window.matchMedia).mockImplementation(
        (query: string) =>
          ({
            matches: /min-width|prefers-reduced-motion/.test(query),
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
          }) as unknown as MediaQueryList,
      );
    });

    afterEach(() => {
      wrapper?.unmount();
    });

    it("mounts the real card and status bar, which starts polling on open with no click", () => {
      openPage();
      expect(wrapper.findComponent(SetupCardRenderer).exists()).toBe(true);
      expect(wrapper.findComponent(FirstEventStatus).exists()).toBe(true);
      expect(poll.start).toHaveBeenCalledWith("open");
      expect(wrapper.find(OPEN_BUTTON).exists()).toBe(false);
    });

    it("with no earlier answer, installs once and remembers 'added'", async () => {
      openPage();
      await dataArrives();
      await eventually(() => expect(toastMock).toHaveBeenCalledTimes(1));

      expect(wrapper.emitted("detected")).toEqual([[2]]);
      expect(svc.new_Folder).toHaveBeenCalledTimes(1);
      expect(svc.create).toHaveBeenCalledTimes(1);
      expect(rows.map((row) => row.role)).toEqual(["ready-made:postgresql/overview:1"]);
      expect(toastMock.mock.calls[0][0]).toMatchObject({ variant: "success", message: ADDED });
      expect(memory?.sources.postgresql.state).toBe("added");
    });

    it("the MongoDB page adds the MongoDB dashboard to a MongoDB folder", async () => {
      openPage("mongoDB");
      await dataArrives();
      await eventually(() => expect(toastMock).toHaveBeenCalledTimes(1));

      expect(svc.new_Folder.mock.calls[0]).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "MongoDB" })]),
      );
      expect(rows.map((row) => row.role)).toEqual(["ready-made:mongodb/overview:1"]);
      expect(toastMock.mock.calls[0][0].message).toBe(
        tp("dashboard.readyMade.addedOne", { name: "MongoDB", folder: "MongoDB", count: 1 }, 1),
      );
      expect(memory?.sources.mongodb.state).toBe("added");
    });

    it("keeps a notice above the card after the automatic add, for a user who missed the toast", async () => {
      openPage();
      await dataArrives();
      await eventually(() => expect(wrapper.find(NOTICE).exists()).toBe(true));

      const notice = wrapper.find(NOTICE);
      expect(notice.text()).toContain(
        (i18n.global as any).t("ingestion.setupCard.readyMadeAutoAdded", {
          name: "PostgreSQL",
          list: "PostgreSQL / Overview",
          folder: "PostgreSQL",
        }),
      );
      // Above the card, not inside main's renderer.
      expect(
        notice.element.compareDocumentPosition(wrapper.findComponent(SetupCardRenderer).element),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      await notice
        .find('[data-test="data-source-setup-card-ready-made-added-open"]')
        .trigger("click");
      expect(router.push).toHaveBeenCalledWith({
        path: "/dashboards/view",
        query: { org_identifier: ORG, dashboard: "d1", folder: "f-PostgreSQL" },
      });
    });

    it.each(["dismissed", "added"] as const)(
      "with a %s answer, makes no dashboard or folder call and shows no toast",
      async (state) => {
        answered("postgresql", state);
        openPage();
        await dataArrives();
        await eventually(() => expect(settingsSvc.getSetting).toHaveBeenCalledTimes(1));
        await settle();

        expect(wrapper.emitted("detected")).toEqual([[2]]);
        expect(dashboardCalls()).toEqual([]);
        expect(settingsSvc.setUserSetting).not.toHaveBeenCalled();
        expect(toastMock).not.toHaveBeenCalled();
        expect(wrapper.find(NOTICE).exists()).toBe(false);
        expect(memory?.sources.postgresql.state).toBe(state);
        // The deliberate way in stays on the page.
        expect(wrapper.find(OPEN_BUTTON).exists()).toBe(true);
      },
    );

    it("when the memory cannot be read, makes no dashboard or folder call and shows no toast", async () => {
      memoryReadFails = true;
      openPage();
      await dataArrives();
      await eventually(() => expect(settingsSvc.getSetting).toHaveBeenCalledTimes(1));
      await settle();

      expect(dashboardCalls()).toEqual([]);
      expect(settingsSvc.setUserSetting).not.toHaveBeenCalled();
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("the MariaDB page honours a mysql 'No thanks'", async () => {
      answered("mysql", "dismissed");
      openPage("mariaDB");
      await dataArrives();
      await eventually(() => expect(settingsSvc.getSetting).toHaveBeenCalledTimes(1));
      await settle();

      expect(dashboardCalls()).toEqual([]);
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("toasts at most once: a second page open after the automatic install does nothing", async () => {
      openPage();
      await dataArrives();
      await eventually(() => expect(toastMock).toHaveBeenCalledTimes(1));
      const callsAfterFirstOpen = dashboardCalls().length;

      await openAgain();

      expect(wrapper.emitted("detected")).toEqual([[2]]);
      expect(toastMock).toHaveBeenCalledTimes(1);
      expect(svc.create).toHaveBeenCalledTimes(1);
      expect(dashboardCalls().length).toBe(callsAfterFirstOpen);
      expect(settingsSvc.setUserSetting).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      // A later visit created nothing, so it carries no notice.
      expect(wrapper.find(NOTICE).exists()).toBe(false);
    });

    it("stays silent on a later open even after the user deleted the dashboard it added", async () => {
      openPage();
      await dataArrives();
      await eventually(() => expect(toastMock).toHaveBeenCalledTimes(1));
      rows = [];

      await openAgain();

      expect(rows).toEqual([]);
      expect(svc.create).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledTimes(1);
    });

    it("stays silent for the rest of the session when saving 'added' failed", async () => {
      settingsSvc.setUserSetting.mockRejectedValue(new Error("down"));
      openPage();
      await dataArrives();
      await eventually(() => expect(toastMock).toHaveBeenCalledTimes(1));
      expect(memory).toBeUndefined();

      await openAgain();

      expect(toastMock).toHaveBeenCalledTimes(1);
      expect(svc.create).toHaveBeenCalledTimes(1);
    });

    it("a teammate's marked copy is announced once, creates nothing, and is remembered as 'added'", async () => {
      teammateCopy();
      openPage();
      await dataArrives();
      await eventually(() => expect(toastMock).toHaveBeenCalledTimes(1));

      expect(dashboardWrites()).toEqual([]);
      expect(toastMock.mock.calls[0][0].message).toBe(
        tp("dashboard.readyMade.existsOne", { name: "PostgreSQL", folder: "DB team", count: 1 }, 1),
      );
      expect(memory?.sources.postgresql.state).toBe("added");
      // Nothing was created by this visit, so nothing stays on the page.
      expect(wrapper.find(NOTICE).exists()).toBe(false);
      const callsAfterFirstOpen = dashboardCalls().length;

      await openAgain();

      expect(toastMock).toHaveBeenCalledTimes(1);
      expect(dashboardCalls().length).toBe(callsAfterFirstOpen);
    });

    it("the step button still installs, opens and records 'added' after a 'No thanks'", async () => {
      answered("postgresql", "dismissed");
      openPage();
      await dataArrives();
      await eventually(() => expect(wrapper.find(OPEN_BUTTON).exists()).toBe(true));
      await settle();
      expect(dashboardCalls()).toEqual([]);

      await wrapper.find(OPEN_BUTTON).trigger("click");
      await eventually(() => expect(router.push).toHaveBeenCalledTimes(1));

      expect(svc.create).toHaveBeenCalledTimes(1);
      expect(router.push).toHaveBeenCalledWith({
        path: "/dashboards/view",
        query: { org_identifier: ORG, dashboard: "d1", folder: "f-PostgreSQL" },
      });
      expect(memory?.sources.postgresql.state).toBe("added");
      expect(toastMock).not.toHaveBeenCalled();
    });
  },
);
