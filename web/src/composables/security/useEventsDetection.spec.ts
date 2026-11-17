// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

vi.mock("@/composables/security/streamActivity", () => ({
  ocsfClassCounts: vi.fn(async () => []),
}));
vi.mock("@/types/i18n", async (orig) => ({
  ...(await orig<typeof import("@/types/i18n")>()),
  useI18nTyped: () => ({ t: (key: string) => key }),
}));

import type { Classification } from "@/services/securitySources";
import { useEventsDetection } from "./useEventsDetection";

const github = {
  source: {
    id: "github_audit",
    label: "GitHub audit",
    vendor: "GitHub",
    sigma: { product: "github", service: "audit" },
    ocsfClass: 6003,
    map: {},
    signals: [],
  },
  confidence: 0.69,
  matchedRequired: ["action", "actor"],
  matchedSignals: [],
  isSecurity: true,
} as unknown as Classification;

function summaryFor(fields: string[], rows: Record<string, unknown>[]) {
  const { detectedSummary } = useEventsDetection({
    orgId: ref("default"),
    detected: ref(github),
    fieldNames: ref(fields),
    events: ref(rows),
    selectedStream: ref("github_audit"),
  });
  return detectedSummary.value!;
}

describe("useEventsDetection class label", () => {
  it("labels a stream the entity pack mapped as Base Event, not the catalog's class", () => {
    const summary = summaryFor(["action", "actor", "class_uid"], [{ class_uid: 0 }]);
    expect(summary.classUid).toBe(0);
    expect(summary.className).toBe("Base Event");
  });

  it("labels a stream the GitHub pack mapped as API Activity", () => {
    const summary = summaryFor(["action", "class_uid"], [{ class_uid: 6003 }, { class_uid: 6003 }]);
    expect(summary.classUid).toBe(6003);
    expect(summary.className).toBe("API Activity");
  });

  it("falls back to the catalog's class for a raw stream with no class_uid", () => {
    const summary = summaryFor(["action", "actor"], [{ action: "git.clone" }]);
    expect(summary.classUid).toBe(6003);
  });
});
