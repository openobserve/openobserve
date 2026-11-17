// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import { withQueryClient } from "@/test/unit/helpers/queryClient";
import securitySigma from "@/services/securitySigma";
import stream from "@/services/stream";
import { okResponse } from "@/views/Security/__fixtures__/securityFixtures";
import { securityTime } from "@/utils/security/time";

vi.mock("@/services/securitySigma", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/securitySigma")>());
});
vi.mock("@/services/stream", async (importOriginal) => {
  const { automockService } = await import("@/test/unit/helpers/mockService");
  return automockService(await importOriginal<typeof import("@/services/stream")>());
});

import SecurityDetectionExceptions from "./SecurityDetectionExceptions.vue";

let wrapper: VueWrapper | null = null;

const LISTS = [
  {
    id: "scanners",
    name: "Vuln scanners",
    purpose: "scanner",
    values: ["10.0.0.0/8"],
    description: "",
    updated_by: "a@b.c",
    updated_at: 1,
  },
  {
    id: "svc",
    name: "Service accounts",
    purpose: "service_account",
    values: ["svc-backup"],
    description: "",
    updated_by: "a@b.c",
    updated_at: 1,
  },
];

const mountExceptions = async () => {
  wrapper = mount(SecurityDetectionExceptions, {
    props: { orgId: "acme", alertId: "a1", stream: "", canAuthor: true, canAdmin: true },
    global: { provide: { store }, plugins: [store, withQueryClient()] },
  });
  await flushPromises();
  return wrapper;
};

const select = (w: VueWrapper, test: string) => w.findComponent(`[data-test="${test}"]`);

beforeEach(() => {
  vi.mocked(securitySigma.listExceptions).mockResolvedValue(
    okResponse({
      exceptions: [
        {
          id: "e1",
          alert_id: "a1",
          field: "srcaddr",
          operator: "in_list",
          values: ["scanners"],
          comment: "sanctioned scanners",
          created_by: "a@b.c",
          created_at: 1,
          expired: false,
        },
      ],
    }) as never,
  );
  vi.mocked(securitySigma.listAllowlists).mockResolvedValue(okResponse({ lists: LISTS }) as never);
  vi.mocked(securitySigma.addException).mockResolvedValue(okResponse({}) as never);
  vi.mocked(stream.schema).mockResolvedValue(okResponse({ schema: [] }) as never);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.clearAllMocks();
});

describe("SecurityDetectionExceptions", () => {
  it("prints the expiry in the one Security date shape", async () => {
    const until = Date.UTC(2026, 11, 10, 13, 43, 20);
    vi.mocked(securitySigma.listExceptions).mockResolvedValue(
      okResponse({
        exceptions: [
          {
            id: "e2",
            alert_id: "a1",
            field: "srcaddr",
            operator: "equals",
            values: ["10.0.0.1"],
            comment: "scanner",
            created_by: "a@b.c",
            created_at: 1,
            expires_at: until * 1000,
            expired: false,
          },
        ],
      }) as never,
    );
    const w = await mountExceptions();
    const text = w.find('[data-test="security-detection-exceptions-until"]').text();
    expect(text).toBe(securityTime(until));
    expect(text).not.toContain("2026-12-10");
  });

  it("shows an allowlist exception by the list's name", async () => {
    const w = await mountExceptions();
    expect(w.find('[data-test="security-detection-exception-e1"]').text()).toContain(
      "Vuln scanners",
    );
  });

  it("swaps the values box for an allowlist picker and submits the picked list ids", async () => {
    const w = await mountExceptions();
    await w.find('[data-test="security-detection-exceptions-add"]').trigger("click");
    expect(w.find('[data-test="security-detection-exceptions-lists"]').exists()).toBe(false);

    select(w, "security-detection-exceptions-operator").vm.$emit("update:modelValue", "in_list");
    await flushPromises();
    expect(w.find('[data-test="security-detection-exceptions-values"]').exists()).toBe(false);
    const picker = select(w, "security-detection-exceptions-lists");
    expect(picker.props("options")).toEqual([
      expect.objectContaining({ value: "scanners", label: "Vuln scanners" }),
      expect.objectContaining({ value: "svc", label: "Service accounts" }),
    ]);

    await w.find('[data-test="security-detection-exceptions-field"] input').setValue("srcaddr");
    picker.vm.$emit("update:modelValue", ["scanners", "svc"]);
    await w
      .find('[data-test="security-detection-exceptions-comment"] input')
      .setValue("sanctioned");
    await w.find("form").trigger("submit");
    await vi.waitFor(() => expect(securitySigma.addException).toHaveBeenCalled());
    expect(vi.mocked(securitySigma.addException).mock.calls[0][2]).toMatchObject({
      field: "srcaddr",
      operator: "in_list",
      values: ["scanners", "svc"],
      comment: "sanctioned",
    });
  });

  it("says how many detections an exception is not enforced on", async () => {
    vi.mocked(securitySigma.listExceptions).mockResolvedValue(
      okResponse({
        exceptions: [
          {
            id: "e2",
            alert_id: "_all",
            field: "user",
            operator: "equals",
            values: ["svc-scan"],
            comment: "scanner",
            created_by: "a@b.c",
            created_at: 1,
            expired: false,
            not_enforced: [
              { alert_id: "d1", name: "Joined rule", reason: "No SELECT reads the stream" },
              { alert_id: "d2", name: "Other rule", reason: "No SELECT reads the stream" },
            ],
          },
        ],
      }) as never,
    );
    const w = await mountExceptions();
    const tag = w.find('[data-test="security-detection-exception-not-enforced-e2"]');
    expect(tag.text()).toContain("Not enforced on 2 detections");
    expect(w.find('[data-test="security-detection-exception-not-enforced-e1"]').exists()).toBe(
      false,
    );
  });

  it("refuses an allowlist exception with no list picked", async () => {
    const w = await mountExceptions();
    await w.find('[data-test="security-detection-exceptions-add"]').trigger("click");
    select(w, "security-detection-exceptions-operator").vm.$emit("update:modelValue", "in_list");
    await flushPromises();
    await w.find('[data-test="security-detection-exceptions-field"] input').setValue("srcaddr");
    await w
      .find('[data-test="security-detection-exceptions-comment"] input')
      .setValue("sanctioned");
    await w.find("form").trigger("submit");
    await vi.waitFor(() => expect(w.text()).toContain("Pick between 1 and 50 allowlists"));
    expect(securitySigma.addException).not.toHaveBeenCalled();
  });
});
