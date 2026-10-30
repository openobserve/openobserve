import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";

const rumInit = vi.hoisted(() => vi.fn());
const routerOnError = vi.hoisted(() => vi.fn());
const isStaleChunkError = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const logsInit = vi.hoisted(() => vi.fn());
const setInitialVersion = vi.hoisted(() => vi.fn());

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
vi.mock("./router", () => ({ default: () => ({ onError: routerOnError }) }));
vi.mock("./locales", () => ({
  default: { global: { t: (key: string) => key } },
  applyDocumentLocale: vi.fn(),
  getLocale: () => "en-US",
  loadLocaleMessages: () => Promise.resolve(),
}));
vi.mock("./aws-exports", () => ({ default: {} }));
vi.mock("@openobserve/browser-rum", () => ({ openobserveRum: { init: rumInit } }));
vi.mock("@openobserve/browser-logs", () => ({ openobserveLogs: { init: logsInit } }));
vi.mock("./services/reodotdev_analytics", () => ({ useReo: () => ({ reoInit: vi.fn() }) }));
vi.mock("./composables/contextProviders", () => ({
  contextRegistry: { register: vi.fn() },
  createDefaultContextProvider: vi.fn(),
}));
vi.mock("./utils/buildVersionChecker", () => ({
  buildVersionChecker: { setInitialVersion, isStaleChunkError },
  isChunkLoadError: (e: { message?: string } | undefined) =>
    /dynamically imported module|Unable to preload CSS/.test(e?.message ?? ""),
}));
vi.mock("./composables/query/queryClient", () => ({
  queryClient: {
    fetchQuery: () =>
      Promise.resolve({
        commit_hash: "abc123",
        // A stale server may still send rum in the bootstrap; the SDK must wait for login anyway.
        rum: {
          enabled: true,
          client_token: "t",
          application_id: "a",
          site: "s",
          service: "web",
          env: "test",
          version: "v0.70.0",
          organization_identifier: "o",
        },
      }),
  },
  setMutationNotifier: vi.fn(),
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast }));
vi.mock("@/utils/themeManager", () => ({ bootstrapTheme: vi.fn() }));

// main.ts boots the whole app on import, which can outlast the default hook timeout on a busy runner.
beforeAll(async () => {
  await import("./main");
  await vi.waitFor(() => expect(setInitialVersion).toHaveBeenCalledWith("abc123"), {
    timeout: 20000,
  });
}, 60000);

describe("main.ts RUM", () => {
  it("does not start the RUM or logs SDK from the unauthenticated bootstrap config", () => {
    expect(rumInit).not.toHaveBeenCalled();
    expect(logsInit).not.toHaveBeenCalled();
  });
});

describe("main.ts chunk load errors", () => {
  const originalLocation = window.location;
  const reload = vi.fn();
  const assign = vi.fn();
  const replace = vi.fn();
  const setHref = vi.fn();

  const preloadError = (message: string) => {
    const event = new Event("vite:preloadError", { cancelable: true }) as Event & {
      payload: Error;
    };
    event.payload = new Error(message);
    window.dispatchEvent(event);
    return event;
  };

  const stubLocation = () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        get href() {
          return originalLocation.href;
        },
        set href(value: string) {
          setHref(value);
        },
        origin: originalLocation.origin,
        reload,
        assign,
        replace,
      },
    });
  };

  beforeEach(() => {
    isStaleChunkError.mockReset().mockResolvedValue(true);
    toast.mockClear();
    reload.mockReset();
    assign.mockReset();
    replace.mockReset();
    setHref.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it("skips the stale check for a router error that is not a chunk failure", async () => {
    isStaleChunkError.mockResolvedValue(false);
    await routerOnError.mock.calls[0][0](new Error("navigation guard threw"));
    expect(isStaleChunkError).not.toHaveBeenCalled();
  });

  it("skips the stale check for a preload error that is not a chunk failure", async () => {
    isStaleChunkError.mockResolvedValue(false);
    const event = preloadError("something else");
    await Promise.resolve();
    expect(isStaleChunkError).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("offers the refresh toast for a stale route chunk without reloading", async () => {
    stubLocation();
    const error = new Error("Failed to fetch dynamically imported module: x.js");
    await routerOnError.mock.calls[0][0](error);
    expect(isStaleChunkError).toHaveBeenCalledWith(error);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(setHref).not.toHaveBeenCalled();
  });

  // The toast shows once per page, so each case needs a freshly booted main.ts.
  it.each([
    "Failed to fetch dynamically imported module: Alert.js",
    "Unable to preload CSS for /web/assets/a.css",
  ])(
    "offers the refresh toast for a stale preload of %s and lets the error propagate",
    async (message) => {
      vi.resetModules();
      await import("./main");
      stubLocation();
      const event = preloadError(message);
      await vi.waitFor(() => expect(toast).toHaveBeenCalled());
      expect(isStaleChunkError).toHaveBeenCalledWith(event.payload);
      expect(event.defaultPrevented).toBe(false);
      expect(reload).not.toHaveBeenCalled();
      expect(assign).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();
      expect(setHref).not.toHaveBeenCalled();
    },
    60000,
  );
});
