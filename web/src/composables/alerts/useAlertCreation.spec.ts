import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAlertCreation } from "./useAlertCreation";
import {
  ALERT_PREFILL_KEY,
  readAlertPrefill,
  clearAlertPrefill,
} from "@/utils/alerts/alertPrefillStorage";
import { ALERT_PREFILL_VERSION, type AlertPrefill } from "@/ts/interfaces/alertPrefill";

const mockRouterPush = vi.fn();
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
});
