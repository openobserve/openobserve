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
import { flushPromises, mount } from "@vue/test-utils";
import type * as ConsentModule from "@/composables/usePaidOverageConsent";

const { toastMock, awsConfig, promptForConsent } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  awsConfig: { isCloud: "false", isEnterprise: "true" },
  promptForConsent: vi.fn(),
}));

vi.mock("@/aws-exports", () => ({ default: awsConfig }));
vi.mock("@/composables/usePaidOverageConsent", async (importOriginal) => ({
  ...(await importOriginal<typeof ConsentModule>()),
  usePaidOverageConsent: () => ({ promptForConsent }),
}));
vi.mock("@/services/incidents", () => ({ default: { triggerRca: vi.fn() } }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

import incidentsService, { type Incident } from "@/services/incidents";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { aiCreditsNotice } from "@/utils/aiCredits";
import type { TranslateFn } from "@/types/i18n";
import IncidentAiAnalysisCell from "./IncidentAiAnalysisCell.vue";

const triggerRca = vi.mocked(incidentsService.triggerRca);

const incident = {
  id: "inc-1",
  severity: "P2",
  rca: null,
  rca_off_reason: null,
} as unknown as Incident; // only the fields the cell reads

function mountCell() {
  return mount(IncidentAiAnalysisCell, {
    props: { incident, rcaEnabled: true, now: Date.now() },
    global: { plugins: [store] },
  });
}

describe("IncidentAiAnalysisCell (RR-33)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    awsConfig.isCloud = "false";
    store.state.selectedOrganization = {
      ...store.state.selectedOrganization,
      identifier: "default",
    };
  });

  it("Analyze sends one POST with reanalysis=true and emits started, not open", async () => {
    triggerRca.mockResolvedValue({ data: { message: "started", run_id: "run-1" } } as never);
    const wrapper = mountCell();

    await wrapper.get('[data-test="incident-ai-analysis-analyze-btn"]').trigger("click");
    await flushPromises();

    expect(triggerRca).toHaveBeenCalledTimes(1);
    expect(triggerRca).toHaveBeenCalledWith("default", "inc-1", {}, { signal: undefined });
    expect(wrapper.emitted("started")).toEqual([["run-1"]]);
    expect(wrapper.emitted("open")).toBeUndefined();
  });

  it("non-Cloud 412 shows the server message and leaves the button usable", async () => {
    triggerRca.mockRejectedValue({
      isAxiosError: true,
      response: { status: 412, data: { message: "AI SRE is not configured for this org" } },
    });
    const wrapper = mountCell();
    const button = () => wrapper.get('[data-test="incident-ai-analysis-analyze-btn"]');

    await button().trigger("click");
    await flushPromises();

    expect(toastMock).toHaveBeenCalledWith({
      variant: "error",
      message: "AI SRE is not configured for this org",
    });
    expect(wrapper.emitted("started")).toBeUndefined();
    expect(button().attributes("disabled")).toBeUndefined();

    await button().trigger("click");
    await flushPromises();
    expect(triggerRca).toHaveBeenCalledTimes(2);
  });

  it("a server error asks the list to refetch, since the run may exist; a network error does not", async () => {
    triggerRca.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 503, data: { message: "Agent unavailable" } },
    });
    const wrapper = mountCell();
    const button = () => wrapper.get('[data-test="incident-ai-analysis-analyze-btn"]');

    await button().trigger("click");
    await flushPromises();
    expect(toastMock).toHaveBeenCalledWith({ variant: "error", message: "Agent unavailable" });
    expect(wrapper.emitted("failed")).toHaveLength(1);

    triggerRca.mockRejectedValueOnce({ isAxiosError: true, message: "Network Error" });
    await button().trigger("click");
    await flushPromises();
    expect(wrapper.emitted("failed")).toHaveLength(1);
  });

  it("a 402 toasts the AI-credits notice instead of the raw server message", async () => {
    const body = { error_type: "ai_credits_exhausted", remedy: "subscribe", message: "raw" };
    triggerRca.mockRejectedValue({ isAxiosError: true, response: { status: 402, data: body } });
    const wrapper = mountCell();

    await wrapper.get('[data-test="incident-ai-analysis-analyze-btn"]').trigger("click");
    await flushPromises();

    expect(toastMock).toHaveBeenCalledWith({
      variant: "error",
      message: aiCreditsNotice(body, i18n.global.t as TranslateFn),
    });
    expect(wrapper.emitted("started")).toBeUndefined();
  });

  it("Cloud: declining paid usage tells the user and sends nothing more", async () => {
    awsConfig.isCloud = "true";
    triggerRca.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 412,
        data: { error_type: "paid_overage_consent_required", consent: { feature: "ai_credits" } },
      },
    });
    promptForConsent.mockResolvedValue(false);
    const wrapper = mountCell();

    await wrapper.get('[data-test="incident-ai-analysis-analyze-btn"]').trigger("click");
    await flushPromises();

    expect(triggerRca).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({
      variant: "info",
      message: i18n.global.t("paidUsage.declinedNotice"),
    });
  });

  it("a click on the cell opens the incident", async () => {
    const wrapper = mount(IncidentAiAnalysisCell, {
      props: {
        incident: { ...incident, rca_off_reason: "l0_off" } as Incident,
        rcaEnabled: false,
        now: Date.now(),
      },
      global: { plugins: [store] },
    });

    await wrapper.get('[data-test="incident-ai-analysis-cell"]').trigger("click");

    expect(wrapper.emitted("open")).toHaveLength(1);
    expect(wrapper.find('[data-test="incident-ai-analysis-hover-analyze-btn"]').exists()).toBe(
      false,
    );
  });

  it("the state badge is named by its visible label and described by the detail", () => {
    const now = Date.now();
    const failedRerun = {
      ...incident,
      rca: {
        run_id: "run-2",
        state: "failed",
        stale: false,
        started_at: (now - 120_000) * 1000,
        updated_at: (now - 60_000) * 1000,
        outcome: null,
        confidence: null,
        summary: {
          detail: "Agent unavailable",
          previous: { run_id: "run-1", outcome: null, confidence: null, ended_at: 0 },
        },
      },
    } as unknown as Incident; // only the summary fields the cell reads
    const wrapper = mount(IncidentAiAnalysisCell, {
      props: { incident: failedRerun, rcaEnabled: true, now },
      global: { plugins: [store] },
    });

    const badge = wrapper.get('[data-test="incident-ai-analysis-label"]');
    // No fixed aria-label: the accessible name is the visible state label.
    expect(badge.attributes("aria-label")).toBeUndefined();
    expect(badge.text()).toContain("Analyzed");
    const detail = wrapper.get('[data-test="incident-ai-analysis-detail"]');
    expect(badge.attributes("aria-describedby")).toBe(detail.attributes("id"));
    expect(detail.text()).toContain("re-run failed");
  });
});
