// Copyright 2026 OpenObserve Inc.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import type { PaidOverageStatus } from "@/services/paidOverage";

const service = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/services/paidOverage", () => ({
  default: service,
}));

import { usePaidOverageConsent } from "./usePaidOverageConsent";

function status(overrides: Partial<PaidOverageStatus> = {}): PaidOverageStatus {
  return {
    feature: "ai_credits",
    organization: { org_id: "member", enabled: false, can_manage: true },
    payer: null,
    effective: false,
    billing_status: "eligible",
    ...overrides,
  };
}

describe("usePaidOverageConsent", () => {
  const consent = usePaidOverageConsent();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    consent.decline();
    await flushPromises();
  });

  it("declines without writing consent", async () => {
    const result = consent.promptForConsent("member", "ai_credits", status());

    consent.decline();

    await expect(result).resolves.toBe(false);
    expect(service.update).not.toHaveBeenCalled();
  });

  it("enables cumulative consent and confirms effective state", async () => {
    service.update.mockResolvedValue({ data: status() });
    service.get.mockResolvedValue({
      data: status({
        organization: { org_id: "member", enabled: true, can_manage: true },
        effective: true,
      }),
    });
    const result = consent.promptForConsent("member", "ai_credits", status());
    consent.acknowledgementChecked.value = true;

    await consent.accept();

    await expect(result).resolves.toBe(true);
    expect(service.update).toHaveBeenCalledTimes(1);
    expect(service.update).toHaveBeenCalledWith("member", "ai_credits", true);
    expect(service.get).toHaveBeenCalledWith("member", "ai_credits");
  });

  it("enables both member and payer before resolving", async () => {
    const initial = status({
      payer: { org_id: "payer", enabled: false, can_manage: true },
    });
    service.update.mockResolvedValue({ data: initial });
    service.get.mockResolvedValue({
      data: status({
        organization: { org_id: "member", enabled: true, can_manage: true },
        payer: { org_id: "payer", enabled: true, can_manage: true },
        effective: true,
      }),
    });
    const result = consent.promptForConsent("member", "ai_credits", initial);
    consent.acknowledgementChecked.value = true;

    await consent.accept();

    await expect(result).resolves.toBe(true);
    expect(service.update.mock.calls).toEqual([
      ["member", "ai_credits", true],
      ["payer", "ai_credits", true],
    ]);
  });

  it("does not offer enable when a required payer is unmanageable", async () => {
    const result = consent.promptForConsent(
      "member",
      "ai_credits",
      status({ payer: { org_id: "payer", enabled: false, can_manage: false } }),
    );

    expect(consent.canEnable.value).toBe(false);
    consent.acknowledgementChecked.value = true;
    await consent.accept();
    expect(service.update).not.toHaveBeenCalled();

    consent.decline();
    await expect(result).resolves.toBe(false);
  });

  it("coalesces concurrent prompts for the same organization and feature", async () => {
    const first = consent.promptForConsent("member", "ai_credits", status());
    const second = consent.promptForConsent("member", "ai_credits", status());

    expect(second).toBe(first);
    consent.decline();
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
  });

  it("cancels the dialog when its last active caller aborts", async () => {
    const controller = new AbortController();
    const result = consent.promptForConsent("member", "ai_credits", status(), controller.signal);

    controller.abort();

    await expect(result).resolves.toBe(false);
    await flushPromises();
    expect(consent.activeRequest.value).toBeNull();
    expect(service.update).not.toHaveBeenCalled();
  });
});
