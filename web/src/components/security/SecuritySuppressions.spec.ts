// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import securityCases from "@/services/securityCases";
import { securityTime } from "@/utils/security/time";
import { okResponse } from "@/views/Security/__fixtures__/securityFixtures";

const toastMock = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/securityCases", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securityCases")>());
});
vi.mock("@/lib/feedback/Toast/useToast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feedback/Toast/useToast")>()),
  toast: (...args: unknown[]) => toastMock(...args),
}));
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

import SecuritySuppressions from "./SecuritySuppressions.vue";

let wrapper: VueWrapper | null = null;
const HOUR_US = 3_600_000_000;
const nowUs = () => Date.now() * 1000;

const mountList = async (canAdmin = true) => {
  wrapper = mount(SecuritySuppressions, {
    props: { orgId: "acme", canAdmin, detectionNames: { a1: "AWS root login" } },
    global: { provide: { store }, plugins: [store, withQueryClient()] },
  });
  await flushPromises();
  return wrapper;
};

const byTest = (w: VueWrapper, test: string) => w.find(`[data-test="${test}"]`);

beforeEach(() => {
  vi.mocked(securityCases.listSuppressions).mockResolvedValue(
    okResponse({
      suppressions: [
        {
          id: "s2",
          alert_id: null,
          entity_kind: "ip",
          entity_value: "10.0.0.5",
          until: nowUs() + 48 * HOUR_US,
          reason: "Sanctioned scanner",
          created_by: "lead@acme.io",
          created_at: nowUs() - HOUR_US,
        },
        {
          id: "s1",
          alert_id: "a1",
          entity_kind: "user",
          entity_value: "svc-backup",
          until: nowUs() + 2 * HOUR_US,
          reason: "Backup window",
          created_by: "analyst@acme.io",
          created_at: nowUs() - HOUR_US,
          case_id: "c1",
        },
      ],
    }) as never,
  );
  vi.mocked(securityCases.deleteSuppression).mockResolvedValue(okResponse({}) as never);
  confirmMock.mockResolvedValue(true);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecuritySuppressions", () => {
  it("shows each suppression's scope, entity, reason and creator, soonest to end first", async () => {
    const w = await mountList();
    const rows = w.findAll("[data-test='security-suppressions-list'] > li");
    expect(rows.map((r) => r.attributes("data-test"))).toEqual([
      "security-suppression-s1",
      "security-suppression-s2",
    ]);
    expect(byTest(w, "security-suppression-scope-s1").text()).toBe("AWS root login");
    expect(byTest(w, "security-suppression-scope-s2").text()).toBe("All detections");
    const row = byTest(w, "security-suppression-s1").text();
    expect(row).toContain("svc-backup");
    expect(row).toContain("Backup window");
    expect(row).toContain("analyst@acme.io");
  });

  it("shows when each suppression ends, relative and absolute", async () => {
    const w = await mountList();
    const expiry = byTest(w, "security-suppression-expiry-s1").text();
    expect(expiry).toMatch(/in 2 hours/);
    expect(expiry).toContain(securityTime((nowUs() + 2 * HOUR_US) / 1000).slice(0, 5));
  });

  it("ends a suppression by id after confirming", async () => {
    const w = await mountList();
    await byTest(w, "security-suppression-end-s1").trigger("click");
    await vi.waitFor(() =>
      expect(securityCases.deleteSuppression).toHaveBeenCalledWith("acme", "s1"),
    );
    await vi.waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" })),
    );
  });

  it("offers End only to an admin", async () => {
    const w = await mountList(false);
    expect(byTest(w, "security-suppression-end-s1").exists()).toBe(false);
  });

  it("says so when nothing is suppressed", async () => {
    vi.mocked(securityCases.listSuppressions).mockResolvedValue(
      okResponse({ suppressions: [] }) as never,
    );
    const w = await mountList();
    expect(byTest(w, "security-suppressions-empty").exists()).toBe(true);
  });
});
