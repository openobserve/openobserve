import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRouter, createMemoryHistory } from "vue-router";
import { useAlertCreation } from "./useAlertCreation";
import {
  ALERT_PREFILL_KEY,
  readAlertPrefill,
  clearAlertPrefill,
} from "@/utils/alerts/alertPrefillStorage";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";

// Resolves like the real push: it reports a NavigationFailure rather than
// throwing, and openAlertCreation inspects that result.
const mockRouterPush = vi.fn().mockResolvedValue(undefined);
vi.mock("vue-router", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, useRouter: () => ({ push: mockRouterPush }) };
});

const mockStore = { state: { selectedOrganization: { identifier: "acme" } } };
vi.mock("vuex", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, useStore: () => mockStore };
});

const prefill = (overrides: Partial<AlertPrefill> = {}): AlertPrefill => ({
  version: ALERT_PREFILL_VERSION,
  source: "logs",
  sourceLabel: "k8s_logs",
  streamType: "logs",
  streamName: "k8s_logs",
  queryType: "sql",
  sql: 'SELECT * FROM "k8s_logs"',
  warnings: [],
  ...overrides,
});

describe("useAlertCreation", () => {
  beforeEach(() => {
    mockRouterPush.mockClear();
    clearAlertPrefill();
  });

  it("stores the prefill and routes to the alert form", () => {
    const { openAlertCreation } = useAlertCreation();
    expect(openAlertCreation(prefill())).toBe(true);

    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "addAlert",
      query: { org_identifier: "acme", folder: "default", prefill: "logs" },
    });
    expect(readAlertPrefill()?.streamName).toBe("k8s_logs");
  });

  it("keeps the payload out of the URL", () => {
    const { openAlertCreation } = useAlertCreation();
    openAlertCreation(prefill({ sql: "SELECT * FROM huge".repeat(500) }));

    const query = mockRouterPush.mock.calls[0][0].query;
    expect(JSON.stringify(query).length).toBeLessThan(200);
    expect(query.panelData).toBeUndefined();
  });

  it("honours an explicit folder", () => {
    const { openAlertCreation } = useAlertCreation();
    openAlertCreation(prefill(), { folder: "team-a" });
    expect(mockRouterPush.mock.calls[0][0].query.folder).toBe("team-a");
  });

  it("normalizes before storing", () => {
    const { openAlertCreation } = useAlertCreation();
    openAlertCreation(prefill({ periodMinutes: 99_999 }));
    expect(readAlertPrefill()?.periodMinutes).toBe(1440);
  });

  it("refuses to navigate when the prefill is blocked, and stores nothing", () => {
    const { openAlertCreation } = useAlertCreation();
    expect(openAlertCreation(prefill({ streamName: "" }))).toBe(false);
    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(ALERT_PREFILL_KEY)).toBeNull();
  });

  // A real router, not the mock: the behaviour under test is vue-router's own
  // cancellation, which a stubbed push cannot express.
  describe("when the launching page navigates at the same time", () => {
    const Stub = { template: "<div />" };

    // The alert form is `() => import(...)`, so the push stays in flight while
    // the chunk loads. That window is what the competing navigation lands in.
    const lazyStub = () =>
      new Promise((resolve) => {
        let ticks = 0;
        const tick = () => (ticks++ < 3 ? Promise.resolve().then(tick) : resolve(Stub));
        tick();
      });

    const makeRouter = () =>
      createRouter({
        history: createMemoryHistory(),
        routes: [
          { path: "/dashboards/view", name: "viewDashboard", component: Stub },
          { path: "/alerts/add", name: "addAlert", component: lazyStub as any },
        ],
      });

    it("still reaches the alert form when a query sync supersedes the push", async () => {
      const router = makeRouter();
      await router.push({ name: "viewDashboard", query: { dashboard: "d1" } });

      const { openAlertCreation } = useAlertCreation({ router, store: mockStore });
      openAlertCreation(prefill());

      // The dashboard writing its own query params, mid-flight. Without the
      // re-issue this wins outright and the user never leaves the dashboard.
      await router.replace({ query: { dashboard: "d1", refresh: "0" } });

      await vi.waitFor(() => expect(router.currentRoute.value.name).toBe("addAlert"));
      expect(router.currentRoute.value.query.prefill).toBe("logs");
    });
  });
});
