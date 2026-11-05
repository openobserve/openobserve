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
import type { SetupContext } from "vue";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { DialogContent } from "reka-ui";
import enLocale from "@/locales/languages/en-US.json";
import SampleDataWelcome from "./SampleDataWelcome.vue";
import { useSampleDataSession } from "@/composables/sampleData/useSampleDataSession";
import { fetchHasUserStreams } from "@/composables/sampleData/useSampleDataPresence";

// Render the dialog inline instead of portalling it into <body>.
vi.mock("reka-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("reka-ui")>()),
  DialogPortal: {
    setup:
      (_: unknown, { slots }: SetupContext) =>
      () =>
        slots.default?.(),
  },
}));

const mockConfig = vi.hoisted(() => ({ isCloud: "true", isEnterprise: "false" }));
vi.mock("@/aws-exports", () => ({ default: mockConfig }));

const submitNewUserInfo = vi.fn();
vi.mock("@/services/billings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: { submit_new_user_info: (...args: unknown[]) => submitNewUserInfo(...args) },
  });
});

const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

const track = vi.fn();
vi.mock("@/services/product_analytics", () => ({
  default: { track: (...args: unknown[]) => track(...args) },
}));

vi.mock("@/composables/sampleData/useSampleDataPresence", () => ({
  fetchHasUserStreams: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/composables/sampleData/useSampleDataSession", async () => {
  const { ref } = await import("vue");
  const s = {
    status: ref("idle"),
    loadingOrg: ref(""),
    error: ref(null),
    forbidden: ref(false),
    removing: ref(false),
    welcomeOpen: ref(false),
    welcomeDeciding: ref(0),
    tour: ref(null),
    start: vi.fn((org: string) => {
      s.loadingOrg.value = org;
      s.status.value = "loading";
    }),
    startTour: vi.fn(),
    welcomeSeen: vi.fn(() => false),
    markWelcomeSeen: vi.fn(),
    openWelcome: () => (s.welcomeOpen.value = true),
    loadInDialog: (org: string, hours?: number) => {
      s.welcomeOpen.value = true;
      s.start(org, hours);
    },
    closeWelcome: () => (s.welcomeOpen.value = false),
  };
  return { useSampleDataSession: () => s };
});

const ORG = "test-org";
const EMAIL = "test@example.com";
const SLACK_KEY = `slackCommunityInvite:${EMAIL}`;
const FIRST_SOURCE_KEY = `o2.onboarding.firstSource.${ORG}`;
const CHIP_ROUTES: Array<[string, string]> = [
  ["kubernetes", "ingestFromKubernetes"],
  ["linux", "ingestFromLinux"],
  ["windows", "ingestFromWindows"],
  ["webserver", "nginx"],
  ["otel", "otelCollector"],
  ["cloud", "AWSConfig"],
  ["rum", "frontendMonitoring"],
  ["llm", "ai-integrations"],
  ["agent", "recommendedMcp"],
];

const session = useSampleDataSession() as unknown as {
  status: { value: string };
  error: { value: string | null };
  loadingOrg: { value: string };
  welcomeOpen: { value: boolean };
  welcomeDeciding: { value: number };
  tour: { value: { org: string; index: number } | null };
  start: ReturnType<typeof vi.fn>;
  welcomeSeen: ReturnType<typeof vi.fn>;
  openWelcome: () => void;
};

const makeStore = (
  zoConfig: Record<string, unknown> = {
    version: "v0.0.0",
    sample_data_onboarding_enabled: true,
  },
) =>
  createStore({
    state: {
      selectedOrganization: { identifier: ORG, label: "Acme Shop" },
      theme: "light",
      kioskMode: false,
      userInfo: { email: EMAIL },
      zoConfig,
    },
    actions: { setIsDataIngested: () => {} },
  });

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: enLocale } });

const makeRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: { template: "<div />" } },
      { path: "/ingestion", name: "ingestion", component: { template: "<div />" } },
      ...CHIP_ROUTES.map(([, name]) => ({
        path: `/ingestion/${name}`,
        name,
        component: { template: "<div />" },
      })),
    ],
  });

const flush = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
};

describe("SampleDataWelcome finish", () => {
  let wrapper: VueWrapper | undefined;
  let router: Router;

  let store: ReturnType<typeof makeStore>;
  const mountAtHome = async (zoConfig?: Record<string, unknown>) => {
    router = makeRouter();
    await router.push("/");
    await router.isReady();
    store = makeStore(zoConfig);
    wrapper = mount(SampleDataWelcome, {
      global: {
        plugins: [i18n, store, router],
        stubs: { SampleDataProgress: true },
      },
    });
    await flush();
    return wrapper;
  };

  const byTest = (id: string) => wrapper!.find(`[data-test="${id}"]`);
  const click = async (id: string) => {
    await byTest(id).trigger("click");
    await flush();
  };
  const pressEscape = async () => {
    const panel = wrapper!
      .findAllComponents(DialogContent)
      .find((c) => c.attributes("data-o2-dialog") !== undefined)!;
    await panel.vm.$emit("escapeKeyDown", new KeyboardEvent("keydown", { key: "Escape" }));
    await flush();
  };
  const pushSpy = () => vi.spyOn(router, "push");
  const view = () => wrapper!.find("[data-view]").attributes("data-view");
  const deciding = () => session.welcomeDeciding.value > 0;

  beforeEach(() => {
    mockConfig.isCloud = "true";
    mockConfig.isEnterprise = "false";
    submitNewUserInfo.mockReset();
    submitNewUserInfo.mockResolvedValue({ status: 200 });
    toastMock.mockClear();
    track.mockClear();
    session.start.mockClear();
    session.status.value = "idle";
    session.loadingOrg.value = "";
    session.error.value = null;
    session.forbidden.value = false;
    session.welcomeOpen.value = false;
    session.welcomeDeciding.value = 0;
    session.tour.value = null;
    session.welcomeSeen.mockImplementation(() => false);
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("isFirstTimeLogin", "true");
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    document.cookie = "aws_marketplace_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    vi.restoreAllMocks();
  });

  it("opens on cloud and starts the Slack invite day-2 clock", async () => {
    await mountAtHome();
    expect(session.welcomeOpen.value).toBe(true);
    expect(JSON.parse(localStorage.getItem(SLACK_KEY) ?? "{}").status).toBe("pending_day2");
  });

  it("marks the welcome as deciding while it checks the org's streams", async () => {
    let answer!: (hasData: boolean) => void;
    vi.mocked(fetchHasUserStreams).mockReturnValueOnce(new Promise((r) => (answer = r)));
    const mounting = mountAtHome();
    await flushPromises();
    expect(deciding()).toBe(true);
    answer(false);
    await mounting;
    expect(session.welcomeOpen.value).toBe(true);
    expect(deciding()).toBe(false);
  });

  it("stays deciding until the full config arrives, and until it unmounts if it never does", async () => {
    await mountAtHome({});
    expect(deciding()).toBe(true);
    store.state.zoConfig = { version: "v0.0.0", sample_data_onboarding_enabled: false };
    await flush();
    expect(deciding()).toBe(false);
    expect(session.welcomeOpen.value).toBe(false);

    await mountAtHome({});
    expect(deciding()).toBe(true);
    wrapper!.unmount();
    wrapper = undefined;
    await flush();
    expect(deciding()).toBe(false);
  });

  it("stays deciding until the last of two overlapping checks ends", async () => {
    let first!: (hasData: boolean) => void;
    let second!: (hasData: boolean) => void;
    vi.mocked(fetchHasUserStreams)
      .mockReturnValueOnce(new Promise((r) => (first = r)))
      .mockReturnValueOnce(new Promise((r) => (second = r)));
    const mounting = mountAtHome();
    await flushPromises();
    store.state.selectedOrganization = { identifier: "empty-org", label: "Empty" };
    await flush();
    first(true);
    await mounting;
    await flush();
    expect(deciding()).toBe(true);
    second(false);
    await flush();
    expect(deciding()).toBe(false);
    expect(session.welcomeOpen.value).toBe(true);
  });

  it("drops a late answer for an org the user has left", async () => {
    let answer!: (hasData: boolean) => void;
    vi.mocked(fetchHasUserStreams).mockReturnValueOnce(new Promise((r) => (answer = r)));
    const mounting = mountAtHome();
    await flushPromises();
    store.state.selectedOrganization = { identifier: "empty-org", label: "Empty" };
    await flush();
    answer(true);
    await mounting;
    await flush();
    expect(session.welcomeOpen.value).toBe(true);
    expect(localStorage.getItem("isFirstTimeLogin")).not.toBeNull();
  });

  it("stays closed when the flow is switched off during its stream check", async () => {
    let answer!: (hasData: boolean) => void;
    vi.mocked(fetchHasUserStreams).mockReturnValueOnce(new Promise((r) => (answer = r)));
    const mounting = mountAtHome();
    await flushPromises();
    store.state.zoConfig = { version: "v0.0.0", sample_data_onboarding_enabled: false };
    await flush();
    answer(false);
    await mounting;
    await flush();
    expect(session.welcomeOpen.value).toBe(false);
  });

  it("stays closed when the deployment runs another first-run flow", async () => {
    await mountAtHome({});
    expect(session.welcomeOpen.value).toBe(false);
    expect(localStorage.getItem("isFirstTimeLogin")).toBe("true");
  });

  it("opens once the full config turns the sample data flow on", async () => {
    await mountAtHome({});
    store.state.zoConfig = {
      version: "v0.0.0",
      sample_data_onboarding_enabled: true,
    };
    await flush();
    expect(session.welcomeOpen.value).toBe(true);
  });

  it("waits for the full config before it decides", async () => {
    mockConfig.isCloud = "false";
    vi.mocked(fetchHasUserStreams).mockClear();
    await mountAtHome({});
    expect(session.welcomeOpen.value).toBe(false);
    expect(fetchHasUserStreams).not.toHaveBeenCalled();
    store.state.zoConfig = { version: "v0.0.0", sample_data_onboarding_enabled: false };
    await flush();
    expect(session.welcomeOpen.value).toBe(false);
  });

  it("closes an open welcome, without a skip, when the full config turns the flow off", async () => {
    await mountAtHome();
    expect(session.welcomeOpen.value).toBe(true);
    store.state.zoConfig = { version: "v0.0.0", sample_data_onboarding_enabled: false };
    await flush();
    expect(session.welcomeOpen.value).toBe(false);
    expect(submitNewUserInfo).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();
  });

  it("opens in a new org while a tour is left open in another org", async () => {
    session.tour.value = { org: "other-org", index: 2 };
    await mountAtHome();
    expect(session.welcomeOpen.value).toBe(true);
  });

  it("stays closed while this org's tour runs", async () => {
    session.tour.value = { org: ORG, index: 0 };
    await mountAtHome();
    expect(session.welcomeOpen.value).toBe(false);
  });

  it("opens once a load in another org ends", async () => {
    session.status.value = "loading";
    session.loadingOrg.value = "other-org";
    await mountAtHome();
    expect(session.welcomeOpen.value).toBe(false);
    session.status.value = "loaded";
    await flush();
    expect(session.welcomeOpen.value).toBe(true);
  });

  it("names the dialog after its visible title", async () => {
    await mountAtHome();
    const id = wrapper!.findComponent(DialogContent).attributes("aria-labelledby");
    expect(wrapper!.find(`#${id}`).text()).toBe(byTest("sample-welcome-title").text());
    expect(wrapper!.find(`#${id}`).text()).not.toBe("Dialog");
  });

  describe("a source pick", () => {
    it.each(CHIP_ROUTES)("chip %s sends that source and opens %s", async (id, route) => {
      await mountAtHome();
      const push = pushSpy();
      await click(`onboarding-get-started-source-${id}`);
      expect(submitNewUserInfo).toHaveBeenCalledWith(ORG, {
        from: "",
        company: "",
        first_source: id,
        skipped: false,
      });
      expect(push).toHaveBeenCalledWith({ name: route, query: { org_identifier: ORG } });
      expect(localStorage.getItem(FIRST_SOURCE_KEY)).toBe(id);
      expect(localStorage.getItem("isFirstTimeLogin")).toBeNull();
      expect(session.welcomeOpen.value).toBe(false);
    });

    it.each([
      ["a redirectURI", () => sessionStorage.setItem("redirectURI", "/web/dashboards?x=1")],
      ["an Azure Marketplace token", () => sessionStorage.setItem("azure_marketplace_token", "t")],
      ["an AWS Marketplace cookie", () => (document.cookie = "aws_marketplace_token=t")],
    ])("lets %s win over the guide", async (_name, arrange) => {
      arrange();
      await mountAtHome();
      const push = pushSpy();
      await click("onboarding-get-started-source-kubernetes");
      expect(push).not.toHaveBeenCalled();
      expect(localStorage.getItem(FIRST_SOURCE_KEY)).toBe("kubernetes");
      expect(submitNewUserInfo).toHaveBeenCalledTimes(1);
    });

    it("finishes without waiting for the call, and a failed call only logs a warning", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      submitNewUserInfo.mockReturnValue(Promise.reject(new Error("404")));
      await mountAtHome();
      const push = pushSpy();
      await byTest("onboarding-get-started-source-webserver").trigger("click");
      expect(push).toHaveBeenCalledWith({ name: "nginx", query: { org_identifier: ORG } });
      await flush();
      expect(warn).toHaveBeenCalled();
      expect(toastMock).not.toHaveBeenCalled();
      expect(session.welcomeOpen.value).toBe(false);
    });
  });

  it("shows nine source chips, without HTTP Logs", async () => {
    await mountAtHome();
    const chips = wrapper!.findAll('[data-test^="onboarding-get-started-source-"]');
    expect(
      chips.map((c) => c.attributes("data-test")!.replace("onboarding-get-started-source-", "")),
    ).toEqual(CHIP_ROUTES.map(([id]) => id));
    expect(byTest("onboarding-get-started-more-chip").exists()).toBe(false);
  });

  it("locks a chip whose guide the license locks, and a click picks nothing", async () => {
    await mountAtHome({
      version: "v0.0.0",
      sample_data_onboarding_enabled: true,
      features: { rum: "locked" },
    });
    const push = pushSpy();
    expect(byTest("onboarding-get-started-source-rum").attributes("disabled")).toBeDefined();
    expect(byTest("onboarding-get-started-source-otel").attributes("disabled")).toBeUndefined();
    await click("onboarding-get-started-source-rum");
    expect(push).not.toHaveBeenCalled();
    expect(submitNewUserInfo).not.toHaveBeenCalled();
  });

  it("Explore Other Data Sources opens the Data Sources page as a skip", async () => {
    await mountAtHome();
    const push = pushSpy();
    await click("onboarding-get-started-choose-btn");
    expect(push).toHaveBeenCalledWith({ name: "ingestion", query: { org_identifier: ORG } });
    expect(submitNewUserInfo).toHaveBeenCalledWith(ORG, {
      from: "",
      company: "",
      first_source: undefined,
      skipped: true,
    });
    expect(session.welcomeOpen.value).toBe(false);
  });

  describe("sample data", () => {
    it("Explore With Sample Data sends the sample option and starts loading at once", async () => {
      await mountAtHome();
      const push = pushSpy();
      await click("onboarding-get-started-sample-btn");
      expect(submitNewUserInfo).toHaveBeenCalledWith(ORG, {
        from: "",
        company: "",
        first_source: "sample",
        skipped: false,
      });
      expect(session.start).toHaveBeenCalledWith(ORG, undefined);
      expect(view()).toBe("progress");
      expect(push).not.toHaveBeenCalled();
      expect(localStorage.getItem(FIRST_SOURCE_KEY)).toBe("sample");
    });

    it("keeps the finished load on screen and offers the tour", async () => {
      await mountAtHome();
      await click("onboarding-get-started-sample-btn");
      const progress = () => wrapper!.getComponent({ name: "SampleDataProgress" });
      expect(progress().props("done")).toBe(false);
      expect(byTest("sample-welcome-background").text()).toBe("Continue in the Background");
      session.status.value = "loaded";
      await flush();
      expect(view()).toBe("ready");
      expect(progress().props("done")).toBe(true);
      expect(byTest("sample-welcome-background").exists()).toBe(false);
      expect(byTest("sample-welcome-own-way").text()).toBe("Explore on My Own");
      expect(byTest("sample-welcome-start-tour").text()).toBe("Start the Guided Tour");
    });

    it("disables Explore With Sample Data while another org's load runs", async () => {
      await mountAtHome();
      session.status.value = "loading";
      session.loadingOrg.value = "other-org";
      await flush();
      expect(byTest("onboarding-get-started-sample-btn").attributes("disabled")).toBeDefined();
      await click("onboarding-get-started-sample-btn");
      expect(session.start).not.toHaveBeenCalled();
      expect(submitNewUserInfo).not.toHaveBeenCalled();
    });

    it("disables Explore With Sample Data while sample data is being removed", async () => {
      await mountAtHome();
      (session as unknown as { removing: { value: boolean } }).removing.value = true;
      await flush();
      expect(byTest("onboarding-get-started-sample-btn").attributes("disabled")).toBeDefined();
      (session as unknown as { removing: { value: boolean } }).removing.value = false;
    });

    it("toasts an error when a load fails in another org", async () => {
      await mountAtHome();
      session.loadingOrg.value = "other-org";
      session.status.value = "loading";
      await flush();
      session.status.value = "failed";
      await flush();
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: enLocale.sampleData.toast.loadFailed,
        }),
      );
    });

    it("centres an error icon and the message when the load fails", async () => {
      await mountAtHome();
      await click("onboarding-get-started-sample-btn");
      session.error.value = "HTTP 500";
      session.status.value = "failed";
      await flush();
      expect(view()).toBe("error");
      const error = byTest("sample-welcome-error");
      expect(error.attributes("role")).toBe("alert");
      expect(error.classes()).toEqual(
        expect.arrayContaining(["flex-1", "items-center", "justify-center"]),
      );
      expect(error.findComponent({ name: "OIcon" }).props("name")).toBe("error");
      expect(error.text()).toContain(enLocale.sampleData.welcome.errorBody);
      expect(error.text()).toContain("HTTP 500");
      expect(wrapper!.findComponent({ name: "OBanner" }).exists()).toBe(false);
      expect(byTest("sample-welcome-retry").exists()).toBe(true);
    });

    it("says only that the user needs write access when the load is refused", async () => {
      await mountAtHome();
      await click("onboarding-get-started-sample-btn");
      session.error.value = "Unauthorized Access";
      session.forbidden.value = true;
      session.status.value = "failed";
      await flush();
      expect(byTest("sample-welcome-error").text()).toBe(enLocale.sampleData.loadForbidden);
    });

    it("closing the progress view is not a skip", async () => {
      await mountAtHome();
      await click("onboarding-get-started-sample-btn");
      await click("sample-welcome-close");
      expect(submitNewUserInfo).toHaveBeenCalledTimes(1);
      expect(track).not.toHaveBeenCalledWith("onboarding_questions_skipped", expect.anything());
    });
  });

  describe("how did you hear about us", () => {
    const heard = () => byTest("onboarding-hear-about-us");

    it("asks on a cloud first login and sends the answer with the choice", async () => {
      await mountAtHome();
      expect(heard().text()).toContain("How did you hear about us?");
      expect(byTest("onboarding-hear-about-us-thanks").text()).toBe("");
      wrapper!.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", "github");
      await flush();
      expect(byTest("onboarding-hear-about-us-thanks").text()).toBe("Thanks!");
      await click("onboarding-get-started-skip-btn");
      expect(submitNewUserInfo).toHaveBeenCalledWith(ORG, {
        from: "github",
        company: "",
        first_source: undefined,
        skipped: true,
      });
      expect(track).toHaveBeenCalledWith("onboarding_get_started_submitted", {
        first_source: null,
        heard_from: "github",
        skipped: true,
      });
    });

    it("names the answer list for assistive tech", async () => {
      await mountAtHome();
      expect(
        byTest("onboarding-hear-about-us")
          .find('[aria-label="How did you hear about us?"]')
          .exists(),
      ).toBe(true);
    });

    it("offers the onboarding flow's answer list and sends its codes", async () => {
      await mountAtHome();
      const select = wrapper!.findComponent({ name: "OSelect" });
      expect(select.props("options")).toEqual([
        { value: "search_engine", label: "Search engine" },
        { value: "friend_or_colleague", label: "Friend or colleague" },
        { value: "ai_assistant", label: "AI assistant" },
        { value: "github", label: "GitHub" },
        { value: "linkedin", label: "LinkedIn" },
        { value: "reddit", label: "Reddit" },
        { value: "youtube", label: "YouTube" },
        { value: "other", label: "Other" },
      ]);
      select.vm.$emit("update:modelValue", "search_engine");
      await flush();
      await click("onboarding-get-started-skip-btn");
      expect(submitNewUserInfo).toHaveBeenCalledWith(ORG, {
        from: "search_engine",
        company: "",
        first_source: undefined,
        skipped: true,
      });
    });

    it.each([
      ["cloud after the first login", "true", "false", false],
      ["an open-source build", "false", "false", true],
      ["an enterprise build", "false", "true", true],
    ])("stays hidden on %s", async (_name, cloud, enterprise, firstLogin) => {
      mockConfig.isCloud = cloud;
      mockConfig.isEnterprise = enterprise;
      if (!firstLogin) localStorage.removeItem("isFirstTimeLogin");
      await mountAtHome();
      expect(session.welcomeOpen.value).toBe(true);
      expect(heard().exists()).toBe(false);
    });
  });

  describe("skip", () => {
    it("still closes when storage throws", async () => {
      await mountAtHome();
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw new Error("denied");
      });
      await click("onboarding-get-started-skip-btn");
      expect(session.welcomeOpen.value).toBe(false);
    });

    it.each([
      ["Skip for Now", () => click("onboarding-get-started-skip-btn")],
      ["the close button", () => click("sample-welcome-close")],
      ["Escape", () => pressEscape()],
    ])("%s sends skipped: true", async (_name, act) => {
      await mountAtHome();
      const push = pushSpy();
      await act();
      expect(submitNewUserInfo).toHaveBeenCalledTimes(1);
      expect(submitNewUserInfo).toHaveBeenCalledWith(ORG, {
        from: "",
        company: "",
        first_source: undefined,
        skipped: true,
      });
      expect(localStorage.getItem("isFirstTimeLogin")).toBeNull();
      expect(localStorage.getItem(FIRST_SOURCE_KEY)).toBeNull();
      expect(push).not.toHaveBeenCalled();
      expect(session.welcomeOpen.value).toBe(false);
    });
  });

  describe("analytics", () => {
    it("tracks a pick as submitted, not skipped", async () => {
      await mountAtHome();
      await click("onboarding-get-started-source-otel");
      expect(track.mock.calls).toEqual([
        [
          "onboarding_get_started_submitted",
          { first_source: "otel", heard_from: null, skipped: false },
        ],
      ]);
    });

    it("tracks a skip as submitted and skipped", async () => {
      await mountAtHome();
      await click("onboarding-get-started-skip-btn");
      expect(track.mock.calls).toEqual([
        [
          "onboarding_get_started_submitted",
          { first_source: null, heard_from: null, skipped: true },
        ],
        ["onboarding_questions_skipped", { first_source: null }],
      ]);
    });
  });

  describe("outside a cloud first login", () => {
    it("sends nothing on a non-cloud build but still opens the guide", async () => {
      mockConfig.isCloud = "false";
      await mountAtHome();
      const push = pushSpy();
      await click("onboarding-get-started-source-linux");
      expect(submitNewUserInfo).not.toHaveBeenCalled();
      expect(track).not.toHaveBeenCalled();
      expect(localStorage.getItem(SLACK_KEY)).toBeNull();
      expect(push).toHaveBeenCalledWith({
        name: "ingestFromLinux",
        query: { org_identifier: ORG },
      });
      expect(localStorage.getItem(FIRST_SOURCE_KEY)).toBe("linux");
    });

    it("sends nothing on cloud once the first login is over", async () => {
      localStorage.removeItem("isFirstTimeLogin");
      await mountAtHome();
      await click("onboarding-get-started-skip-btn");
      expect(submitNewUserInfo).not.toHaveBeenCalled();
      expect(track).not.toHaveBeenCalled();
    });
  });
});
