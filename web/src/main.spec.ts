import { beforeAll, describe, it, expect, vi } from "vitest";

const rumInit = vi.hoisted(() => vi.fn());

vi.mock("@/services/config.queries", () => ({ configQuery: () => ({}) }));
vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue")>();
  const app = { use: () => app, mount: vi.fn() };
  return { ...actual, createApp: () => app };
});
vi.mock("@tanstack/vue-query", () => ({ VueQueryPlugin: {} }));
vi.mock("./stores", () => ({
  default: { state: { zoConfig: {}, API_ENDPOINT: "http://localhost:5080" }, dispatch: vi.fn() },
}));
vi.mock("./App.vue", () => ({ default: {} }));
vi.mock("./router", () => ({ default: () => ({ onError: vi.fn() }) }));
vi.mock("./locales", () => ({
  default: { global: { t: (key: string) => key } },
  applyDocumentLocale: vi.fn(),
  getLocale: () => "en-US",
  loadLocaleMessages: () => Promise.resolve(),
}));
vi.mock("./aws-exports", () => ({ default: {} }));
vi.mock("@openobserve/browser-rum", () => ({ openobserveRum: { init: rumInit } }));
vi.mock("@openobserve/browser-logs", () => ({ openobserveLogs: { init: vi.fn() } }));
vi.mock("./services/reodotdev_analytics", () => ({ useReo: () => ({ reoInit: vi.fn() }) }));
vi.mock("./composables/contextProviders", () => ({
  contextRegistry: { register: vi.fn() },
  createDefaultContextProvider: vi.fn(),
}));
vi.mock("./utils/buildVersionChecker", () => ({
  buildVersionChecker: { setInitialVersion: vi.fn() },
}));
vi.mock("./composables/query/queryClient", () => ({
  queryClient: {
    fetchQuery: () =>
      Promise.resolve({
        rum: {
          enabled: true,
          client_token: "t",
          application_id: "a",
          site: "s",
          service: "web",
          env: "test",
          organization_identifier: "o",
        },
      }),
  },
  setMutationNotifier: vi.fn(),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/utils/themeManager", () => ({ bootstrapTheme: vi.fn() }));

const EXT = "chrome-extension://abcdefghijklmnop";
const TAB_ID_KEY = "o2.dashboards.panelDraft.tabId";

// main.ts boots the whole app on import, which can outlast the default hook timeout on a busy runner.
beforeAll(async () => {
  sessionStorage.setItem(TAB_ID_KEY, JSON.stringify({ id: "reloaded-tab", hiddenAt: Date.now() }));
  await import("./main");
  await vi.waitFor(() => expect(rumInit).toHaveBeenCalled(), { timeout: 20000 });
}, 60000);

const rumBeforeSend = (): ((event: Record<string, unknown>) => boolean) =>
  rumInit.mock.calls[0][0].beforeSend;

const errorEvent = (stack: string) => ({
  type: "error",
  view: { url: "https://cloud.openobserve.ai/web/logs", referrer: "" },
  error: { message: "boom", stack },
});

describe("main.ts RUM beforeSend", () => {
  it("drops an error whose every frame is a Chrome extension", async () => {
    const beforeSend = rumBeforeSend();
    const stack = `TypeError: boom\n    at inject (${EXT}/content.js:1:1)\n    at ${EXT}/x.js:2:2`;
    expect(beforeSend(errorEvent(stack))).toBe(false);
  });

  it("sends an error with at least one app frame", async () => {
    const beforeSend = rumBeforeSend();
    const stack = `TypeError: boom\n    at inject (${EXT}/content.js:1:1)\n    at setup (https://cloud.openobserve.ai/web/assets/index.js:3:4)`;
    expect(beforeSend(errorEvent(stack))).toBe(true);
  });

  it("still scrubs sign-in tokens from the view URL of an event it sends", async () => {
    const beforeSend = rumBeforeSend();
    const event = {
      type: "view",
      view: { url: "https://cloud.openobserve.ai/web/cb#id_token=abc", referrer: "" },
    };
    expect(beforeSend(event)).toBe(true);
    expect(event.view.url).toBe("https://cloud.openobserve.ai/web/cb#id_token=redacted");
  });
});

describe("main.ts panel-draft tab id", () => {
  it("claims the reload stash on every page, before a duplicated tab could copy it", async () => {
    expect(sessionStorage.getItem(TAB_ID_KEY)).toBeNull();
    const { getTabId } = await import("@/composables/dashboard/usePanelDraft");
    expect(getTabId()).toBe("reloaded-tab");
  });
});
