// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

import alertsService from "@/services/alerts";
import {
  invalidateSiemDetections,
  useSiemDetections,
} from "@/composables/security/useSiemDetections";

vi.mock("@/services/alerts", () => ({
  default: { listByFolderId: vi.fn(), get_by_alert_id: vi.fn() },
}));
vi.mock("@/types/i18n", () => ({ useI18nTyped: () => ({ t: (key: string) => key }) }));

const svc = alertsService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const listRow = () => ({
  alert_id: "a1",
  name: "rule_one",
  enabled: true,
  context_attributes: { siem_detection: "true" },
});

beforeEach(() => {
  vi.clearAllMocks();
  invalidateSiemDetections();
  svc.listByFolderId.mockResolvedValue({ data: { list: [listRow()] } });
  svc.get_by_alert_id.mockResolvedValue({
    data: {
      ...listRow(),
      query_condition: { sql: "SELECT * FROM t WHERE a = 1" },
      context_attributes: { siem_detection: "true", sigma_yaml: "title: Rule one" },
    },
  });
});

describe("useSiemDetections.load", () => {
  it("keeps the rule SQL and YAML that loadFull fetched across a list reload", async () => {
    const d = useSiemDetections();
    await d.load("org1");
    await d.loadFull("org1", "a1");
    svc.listByFolderId.mockResolvedValue({ data: { list: [{ ...listRow(), enabled: false }] } });

    await d.load("org1");

    const [alert] = d.alerts.value;
    expect(alert.enabled).toBe(false);
    expect(alert.query_condition).toEqual({ sql: "SELECT * FROM t WHERE a = 1" });
    expect(alert.context_attributes).toEqual({
      siem_detection: "true",
      sigma_yaml: "title: Rule one",
    });
  });

  it("prefers what the list now carries over the earlier full fetch", async () => {
    const d = useSiemDetections();
    await d.load("org1");
    await d.loadFull("org1", "a1");
    svc.listByFolderId.mockResolvedValue({
      data: {
        list: [
          {
            ...listRow(),
            query_condition: { sql: "new" },
            context_attributes: { sigma_yaml: "title: New" },
          },
        ],
      },
    });

    await d.load("org1");

    const [alert] = d.alerts.value;
    expect(alert.query_condition).toEqual({ sql: "new" });
    expect(alert.context_attributes.sigma_yaml).toBe("title: New");
  });
});
