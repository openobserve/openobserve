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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import type * as ConsentModule from "@/composables/usePaidOverageConsent";

const { awsConfig, promptForConsent, toastMock } = vi.hoisted(() => ({
  awsConfig: { isCloud: "false" },
  promptForConsent: vi.fn(),
  toastMock: vi.fn(),
}));

vi.mock("@/aws-exports", () => ({ default: awsConfig }));
vi.mock("@/services/incidents", () => ({ default: { triggerRca: vi.fn(), resumeRca: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));
vi.mock("@/composables/usePaidOverageConsent", async (importOriginal) => ({
  ...(await importOriginal<typeof ConsentModule>()),
  usePaidOverageConsent: () => ({ promptForConsent }),
}));

import incidentsService from "@/services/incidents";
import {
  useRcaTrigger as useRcaTriggerComposable,
  type RcaTriggerOptions,
  type RcaTriggerParams,
  type RcaTriggerResult,
  type RcaResumeResult,
} from "./useRcaTrigger";

interface RcaTriggerApi {
  requestRca: (
    org: string,
    incidentId: string,
    params: RcaTriggerParams,
    opts?: RcaTriggerOptions,
  ) => Promise<RcaTriggerResult>;
  requestResume: (
    org: string,
    incidentId: string,
    runId: string,
    opts?: RcaTriggerOptions,
  ) => Promise<RcaResumeResult>;
}

// The composable calls useI18n and onScopeDispose, so it runs inside a mounted host.
function useRcaTrigger(): RcaTriggerApi {
  let api!: RcaTriggerApi;
  mount(
    defineComponent({
      setup() {
        api = useRcaTriggerComposable();
        return () => null;
      },
    }),
  );
  return api;
}

const triggerRca = vi.mocked(incidentsService.triggerRca);
const resumeRca = vi.mocked(incidentsService.resumeRca);

const httpError = (status: number, data: unknown) => ({
  isAxiosError: true,
  response: { status, data },
});

const CONSENT_BODY = {
  error_type: "paid_overage_consent_required",
  message: "Consent required",
  consent: { feature: "ai_credits" },
};

describe("useRcaTrigger (RR-33)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    awsConfig.isCloud = "false";
  });

  it("sends one POST with the given params and returns the run id", async () => {
    triggerRca.mockResolvedValue({ data: { message: "started", run_id: "run-1" } } as never);

    const result = await useRcaTrigger().requestRca("org", "inc-1", { reanalysis: true });

    expect(triggerRca).toHaveBeenCalledTimes(1);
    expect(triggerRca).toHaveBeenCalledWith(
      "org",
      "inc-1",
      { reanalysis: true },
      { signal: undefined },
    );
    expect(result).toMatchObject({ status: "started", runId: "run-1" });
  });

  it("non-Cloud 412 returns the server message and never prompts", async () => {
    triggerRca.mockRejectedValue(httpError(412, { message: "AI SRE is not configured" }));

    const result = await useRcaTrigger().requestRca("org", "inc-1", { reanalysis: true });

    expect(result).toEqual({ status: "unavailable", message: "AI SRE is not configured" });
    expect(promptForConsent).not.toHaveBeenCalled();
    expect(triggerRca).toHaveBeenCalledTimes(1);
  });

  it("non-Cloud 412 without a message falls back to the generic text", async () => {
    triggerRca.mockRejectedValue(httpError(412, {}));

    const result = await useRcaTrigger().requestRca("org", "inc-1", {});

    expect(result).toEqual({
      status: "unavailable",
      message: "AI analysis is not available for this organization.",
    });
  });

  it("non-Cloud other errors are rethrown", async () => {
    const error = httpError(500, { message: "boom" });
    triggerRca.mockRejectedValue(error);

    await expect(useRcaTrigger().requestRca("org", "inc-1", {})).rejects.toBe(error);
  });

  it("Cloud 412 prompts for consent and retries once on accept", async () => {
    awsConfig.isCloud = "true";
    triggerRca
      .mockRejectedValueOnce(httpError(412, CONSENT_BODY))
      .mockResolvedValueOnce({ data: { run_id: "run-2" } } as never);
    promptForConsent.mockResolvedValue(true);
    const onConsentRequired = vi.fn();

    const result = await useRcaTrigger().requestRca(
      "org",
      "inc-1",
      { reanalysis: true },
      { onConsentRequired },
    );

    expect(onConsentRequired).toHaveBeenCalledTimes(1);
    expect(promptForConsent).toHaveBeenCalledTimes(1);
    expect(promptForConsent.mock.calls[0].slice(0, 3)).toEqual([
      "org",
      "ai_credits",
      CONSENT_BODY.consent,
    ]);
    expect(triggerRca).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: "started", runId: "run-2" });
  });

  it("SG33: the consent retry sends the same guidance", async () => {
    awsConfig.isCloud = "true";
    triggerRca
      .mockRejectedValueOnce(httpError(412, CONSENT_BODY))
      .mockResolvedValueOnce({ data: { run_id: "run-2" } } as never);
    promptForConsent.mockResolvedValue(true);
    const params = { reanalysis: true, build_on_previous: false, guidance: "Check the pool" };

    await useRcaTrigger().requestRca("org", "inc-1", params);

    expect(triggerRca.mock.calls.map((call) => call[2])).toEqual([params, params]);
  });

  it("Cloud: a second consent denial after accept propagates (no loop)", async () => {
    awsConfig.isCloud = "true";
    const second = httpError(412, CONSENT_BODY);
    triggerRca.mockRejectedValueOnce(httpError(412, CONSENT_BODY)).mockRejectedValueOnce(second);
    promptForConsent.mockResolvedValue(true);

    await expect(useRcaTrigger().requestRca("org", "inc-1", {})).rejects.toBe(second);
    expect(promptForConsent).toHaveBeenCalledTimes(1);
    expect(triggerRca).toHaveBeenCalledTimes(2);
  });

  it("Cloud decline shows the declined notice and does not retry", async () => {
    awsConfig.isCloud = "true";
    triggerRca.mockRejectedValue(httpError(412, CONSENT_BODY));
    promptForConsent.mockResolvedValue(false);

    const result = await useRcaTrigger().requestRca("org", "inc-1", {});

    expect(result).toEqual({ status: "declined" });
    expect(triggerRca).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }));
  });

  it("Cloud decline after the caller moved on drops the toast", async () => {
    awsConfig.isCloud = "true";
    triggerRca.mockRejectedValue(httpError(412, CONSENT_BODY));
    promptForConsent.mockResolvedValue(false);

    const result = await useRcaTrigger().requestRca(
      "org",
      "inc-1",
      {},
      { isStillActive: () => false },
    );

    expect(result).toEqual({ status: "declined" });
    expect(toastMock).not.toHaveBeenCalled();
  });

  describe("requestResume (J9)", () => {
    const RESUMED = {
      message: "resumed",
      run_id: "run-3",
      resumed_from: "run-2",
      reused_steps: 3,
      from_step: { index: 4, stage: "metrics", title: "Check the pool" },
    };

    it("POSTs the resume for the run and returns the new run with the 202 body", async () => {
      resumeRca.mockResolvedValue({ data: RESUMED } as never);

      const result = await useRcaTrigger().requestResume("org", "inc-1", "run-2");

      expect(resumeRca).toHaveBeenCalledWith("org", "inc-1", "run-2", { signal: undefined });
      expect(triggerRca).not.toHaveBeenCalled();
      expect(result).toEqual({ status: "started", runId: "run-3", data: RESUMED });
    });

    it("non-Cloud 412 returns the server message, like a trigger", async () => {
      resumeRca.mockRejectedValue(httpError(412, { message: "AI SRE is not configured" }));

      const result = await useRcaTrigger().requestResume("org", "inc-1", "run-2");

      expect(result).toEqual({ status: "unavailable", message: "AI SRE is not configured" });
      expect(promptForConsent).not.toHaveBeenCalled();
    });

    it.each(["false", "true"])(
      "402 and 409/410 refusals are rethrown (isCloud=%s)",
      async (cloud) => {
        awsConfig.isCloud = cloud;
        for (const error of [
          httpError(402, { message: "No credits" }),
          httpError(409, { code: "not_resumable", message: "Not resumable" }),
          httpError(410, { code: "transcript_expired", message: "Gone" }),
        ]) {
          resumeRca.mockRejectedValueOnce(error);
          await expect(useRcaTrigger().requestResume("org", "inc-1", "run-2")).rejects.toBe(error);
        }
        expect(promptForConsent).not.toHaveBeenCalled();
      },
    );

    it("Cloud 412 consent: prompts, then resends the same resume once", async () => {
      awsConfig.isCloud = "true";
      resumeRca
        .mockRejectedValueOnce(httpError(412, CONSENT_BODY))
        .mockResolvedValueOnce({ data: RESUMED } as never);
      promptForConsent.mockResolvedValue(true);

      const result = await useRcaTrigger().requestResume("org", "inc-1", "run-2");

      expect(promptForConsent).toHaveBeenCalledTimes(1);
      expect(resumeRca.mock.calls.map((call) => call.slice(0, 3))).toEqual([
        ["org", "inc-1", "run-2"],
        ["org", "inc-1", "run-2"],
      ]);
      expect(triggerRca).not.toHaveBeenCalled();
      expect(result).toMatchObject({ status: "started", runId: "run-3" });
    });

    it("Cloud decline does not resend and shows the declined notice", async () => {
      awsConfig.isCloud = "true";
      resumeRca.mockRejectedValue(httpError(412, CONSENT_BODY));
      promptForConsent.mockResolvedValue(false);

      const result = await useRcaTrigger().requestResume("org", "inc-1", "run-2");

      expect(result).toEqual({ status: "declined" });
      expect(resumeRca).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "info" }));
    });

    it("Cloud: a second denial after accept propagates", async () => {
      awsConfig.isCloud = "true";
      const second = httpError(412, CONSENT_BODY);
      resumeRca.mockRejectedValueOnce(httpError(412, CONSENT_BODY)).mockRejectedValueOnce(second);
      promptForConsent.mockResolvedValue(true);

      await expect(useRcaTrigger().requestResume("org", "inc-1", "run-2")).rejects.toBe(second);
      expect(resumeRca).toHaveBeenCalledTimes(2);
    });
  });
});
