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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import enUS from "@/locales/languages/en-US.json";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import workflows, { dryRunHook } from "@/services/workflows";
import { copyToClipboard } from "@/utils/clipboard";
import {
  HOUR_US,
  HTTP_SECRET,
  HTTP_TOKEN,
  OPopoverStub,
  OSwitchStub,
  OTooltipStub,
  RouterLinkStub,
  fullPermissions,
  httpAbsent,
  httpConfig,
  httpCredential,
} from "@/test/unit/helpers/workflowHttp";
import WorkflowHttpEndpointSection from "./WorkflowHttpEndpointSection.vue";

vi.mock("@/services/workflows", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getHttpTrigger: vi.fn(),
      putHttpTrigger: vi.fn(),
      deleteHttpTrigger: vi.fn(),
      rotateHttpCredential: vi.fn(),
      revokeHttpCredential: vi.fn(),
      revealHttpCredentialSecret: vi.fn(),
    },
    dryRunHook: vi.fn(),
  });
});
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn() }));
const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...a: unknown[]) => mockToast(...a),
}));

const api = vi.mocked(workflows);
const t = (k: string, v?: Record<string, unknown>) => i18n.global.t(k, v ?? {});
const mounted: VueWrapper[] = [];

const mountSection = async (props: Record<string, unknown> = {}) => {
  const wrapper = mount(WorkflowHttpEndpointSection, {
    props: {
      workflowId: "wf1",
      workflowName: "Restart failed deploy",
      isDraftOnly: false,
      workflowEnabled: true,
      context: "editor",
      ...props,
    },
    global: {
      plugins: [i18n, store],
      stubs: {
        OPopover: OPopoverStub,
        OSwitch: OSwitchStub,
        OTooltip: OTooltipStub,
        RouterLink: RouterLinkStub,
      },
    },
  });
  mounted.push(wrapper);
  await flushPromises();
  return wrapper;
};

const byTest = (w: VueWrapper, id: string) => w.find(`[data-test="${id}"]`);
// Awaits the form's own submit chain (as OForm.spec does); the Save button is its submit button.
const submitLimits = async (w: VueWrapper) => {
  expect(byTest(w, "workflow-http-limits-save").attributes("type")).toBe("submit");
  const form = byTest(w, "workflow-http-advanced").findComponent({ name: "OForm" });
  await (
    form.vm as unknown as { form: { handleSubmit: () => Promise<unknown> } }
  ).form.handleSubmit();
  await flushPromises();
};

describe("WorkflowHttpEndpointSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
    store.state.selectedOrganization = { ...store.state.selectedOrganization, identifier: "acme" };
    store.state.zoConfig = { ...store.state.zoConfig, rbac_enabled: false };
    store.state.currentuser = { role: "admin" };
    api.getHttpTrigger.mockResolvedValue(httpConfig());
    vi.mocked(copyToClipboard).mockResolvedValue(true);
  });
  afterEach(() => {
    for (const w of mounted.splice(0)) w.unmount();
  });

  describe("off and loading states", () => {
    it("renders the off state", async () => {
      api.getHttpTrigger.mockResolvedValue(httpAbsent());
      const w = await mountSection();
      expect(byTest(w, "workflow-http-section").text()).toContain(
        t("workflow.http.acceptRequests"),
      );
      expect(byTest(w, "workflow-http-meta").text()).toBe(t("workflow.http.offBody"));
      expect(byTest(w, "workflow-http-toggle").attributes("data-value")).toBe("false");
      expect(byTest(w, "workflow-http-toggle").attributes("disabled")).toBeUndefined();
    });

    it("shows the load error with Retry and hides the switch", async () => {
      api.getHttpTrigger.mockRejectedValue({ response: { status: 500, data: { message: "x" } } });
      const w = await mountSection();
      expect(byTest(w, "workflow-http-meta").text()).toBe(t("workflow.http.loadError"));
      expect(byTest(w, "workflow-http-toggle").exists()).toBe(false);
      api.getHttpTrigger.mockResolvedValue(httpAbsent());
      const calls = api.getHttpTrigger.mock.calls.length;
      await byTest(w, "workflow-http-retry").trigger("click");
      await flushPromises();
      expect(api.getHttpTrigger.mock.calls.length).toBeGreaterThan(calls);
      expect(byTest(w, "workflow-http-toggle").exists()).toBe(true);
    });

    it("disables the switch without edit permission", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpAbsent({ permissions: { edit: false, test: false, reveal: false } }),
      );
      const w = await mountSection();
      expect(byTest(w, "workflow-http-toggle").attributes("disabled")).toBeDefined();
      expect(byTest(w, "workflow-http-meta").text()).toBe(t("workflow.http.needsEdit"));
    });

    it("edit without reveal keeps the switch off and names the admin", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpAbsent({ permissions: { edit: true, test: true, reveal: false } }),
      );
      const w = await mountSection();
      expect(byTest(w, "workflow-http-toggle").attributes("disabled")).toBeDefined();
      expect(byTest(w, "workflow-http-meta").text()).toBe(t("workflow.http.needsAdmin"));
    });
  });

  describe("turning on (1.3)", () => {
    beforeEach(() => {
      api.getHttpTrigger.mockResolvedValue(httpAbsent());
      api.putHttpTrigger.mockImplementation(async () => {
        api.getHttpTrigger.mockResolvedValue(httpConfig());
        return { ...httpConfig(), secret: HTTP_TOKEN };
      });
    });

    it("turning on shows the masked reveal with data-o2-privacy=mask", async () => {
      const w = await mountSection();
      await byTest(w, "workflow-http-toggle").trigger("click");
      await flushPromises();
      expect(api.putHttpTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { enabled: true, auth_mode: "token" } }),
      );
      const reveal = byTest(w, "workflow-http-reveal");
      expect(reveal.attributes("data-o2-privacy")).toBe("mask");
      expect(byTest(w, "workflow-http-token").attributes("data-o2-privacy")).toBe("mask");
      expect(byTest(w, "workflow-http-snippet").attributes("data-o2-privacy")).toBe("mask");
      expect(byTest(w, "workflow-http-reveal-banner").text()).toContain(
        t("workflow.http.revealBannerTitle"),
      );
      expect(byTest(w, "workflow-http-meta").text()).toBe(t("workflow.http.onMeta"));
      expect(reveal.text()).not.toContain(HTTP_TOKEN);
    });

    it("the eye shows the token and copy copies the real token", async () => {
      const w = await mountSection();
      await byTest(w, "workflow-http-toggle").trigger("click");
      await flushPromises();
      await byTest(w, "workflow-http-token-copy-btn").trigger("click");
      expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toBe(HTTP_TOKEN);
      await byTest(w, "workflow-http-token-reveal-btn").trigger("click");
      expect(byTest(w, "workflow-http-token").text()).toContain(HTTP_TOKEN);
    });

    it("every snippet tab is masked and carries the URL", async () => {
      const w = await mountSection();
      await byTest(w, "workflow-http-toggle").trigger("click");
      await flushPromises();
      for (const lang of ["curl", "js", "python"]) {
        await byTest(w, `workflow-http-snippet-tab-${lang}`).trigger("click");
        const snippet = byTest(w, "workflow-http-snippet");
        expect(snippet.text()).toContain(httpConfig().url);
        expect(snippet.text()).not.toContain(HTTP_TOKEN);
      }
    });

    it("Done ends the reveal and drops the value", async () => {
      const w = await mountSection();
      await byTest(w, "workflow-http-toggle").trigger("click");
      await flushPromises();
      await byTest(w, "workflow-http-reveal-done").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-reveal").exists()).toBe(false);
      expect(w.html()).not.toContain(HTTP_TOKEN);
      expect(byTest(w, "workflow-http-credentials").exists()).toBe(true);
    });

    it("a failed PUT shows the error banner and reverts the switch", async () => {
      api.putHttpTrigger.mockRejectedValue({
        response: { status: 500, data: { message: "boom" } },
      });
      const w = await mountSection();
      await byTest(w, "workflow-http-toggle").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-error").text()).toBe(
        t("workflow.http.turnOnFailed", { reason: "boom" }),
      );
      expect(byTest(w, "workflow-http-toggle").attributes("data-value")).toBe("false");
    });

    it("a 200 PUT shows the endpoint-exists hint and no reveal", async () => {
      api.putHttpTrigger.mockImplementation(async () => {
        api.getHttpTrigger.mockResolvedValue(httpConfig());
        return { ...httpConfig(), secret: null };
      });
      const w = await mountSection();
      await byTest(w, "workflow-http-toggle").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-reveal").exists()).toBe(false);
      expect(byTest(w, "workflow-http-exists-hint").text()).toBe(
        t("workflow.http.endpointExistsHint"),
      );
    });

    it("the signed-mode hint names the Signing secrets table", async () => {
      api.putHttpTrigger.mockImplementation(async () => {
        api.getHttpTrigger.mockResolvedValue(httpConfig({ auth_mode: "signature" }));
        return { ...httpConfig({ auth_mode: "signature" }), secret: null };
      });
      const w = await mountSection();
      await byTest(w, "workflow-http-toggle").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-exists-hint").text()).toBe(
        t("workflow.http.endpointExistsHintSigned"),
      );
    });

    it("shows the region host in super-cluster mode", async () => {
      api.putHttpTrigger.mockImplementation(async () => {
        api.getHttpTrigger.mockResolvedValue(httpConfig({ region_host: "eu1.o2.example.com" }));
        return { ...httpConfig({ region_host: "eu1.o2.example.com" }), secret: HTTP_TOKEN };
      });
      const w = await mountSection();
      await byTest(w, "workflow-http-toggle").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-region").text()).toContain("eu1.o2.example.com");
      expect(byTest(w, "workflow-http-region-banner").exists()).toBe(true);
    });

    it("single cluster shows no region tag or banner", async () => {
      const w = await mountSection();
      await byTest(w, "workflow-http-toggle").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-region").exists()).toBe(false);
      expect(byTest(w, "workflow-http-region-banner").exists()).toBe(false);
    });
  });

  describe("send test request (dry run)", () => {
    const reveal = async (props: Record<string, unknown> = {}) => {
      // Each mount in one test must start from no endpoint, not the previous mount's cached one.
      queryClient.clear();
      api.getHttpTrigger.mockResolvedValue(httpAbsent());
      api.putHttpTrigger.mockImplementation(async () => {
        api.getHttpTrigger.mockResolvedValue(httpConfig());
        return { ...httpConfig(), secret: HTTP_TOKEN };
      });
      const w = await mountSection(props);
      await byTest(w, "workflow-http-toggle").trigger("click");
      await flushPromises();
      return w;
    };

    it("send test request shows Dry run accepted and the input", async () => {
      vi.mocked(dryRunHook).mockResolvedValue({
        status: 200,
        reason: null,
        input: { meta: { event_type: "webhook", trigger_source: "http" }, data: [{ a: 1 }] },
        bodyBytes: 68,
      });
      const w = await reveal();
      await byTest(w, "workflow-http-send-test").trigger("click");
      await flushPromises();
      const result = byTest(w, "workflow-http-test-result");
      expect(result.text()).toContain("200");
      expect(result.text()).toContain(t("workflow.http.dryRunAccepted"));
      expect(result.text()).toContain(t("workflow.http.dryRunMeta", { size: "68 B" }));
      expect(byTest(w, "workflow-http-test-input").text()).toContain("trigger_source");
      expect(vi.mocked(dryRunHook).mock.calls[0][0]).toMatchObject({
        url: httpConfig().url,
        auth: { mode: "token", token: HTTP_TOKEN },
      });
    });

    it("maps 403 to Credentials valid in both auth modes and 429 to its copy", async () => {
      vi.mocked(dryRunHook).mockResolvedValue({
        status: 403,
        reason: "workflow_not_published",
        input: null,
        bodyBytes: 68,
      });
      const w = await reveal({ isDraftOnly: true });
      await byTest(w, "workflow-http-send-test").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-test-result").text()).toContain(
        t("workflow.http.dryRunRefused"),
      );
      expect(byTest(w, "workflow-http-run-test-instead").exists()).toBe(true);
      await byTest(w, "workflow-http-run-test-instead").trigger("click");
      expect(w.emitted("run-test")?.[0][0]).toEqual([
        expect.objectContaining({ meta: expect.objectContaining({ trigger_source: "http" }) }),
      ]);

      vi.mocked(dryRunHook).mockResolvedValue({
        status: 429,
        reason: "rate_limited",
        input: null,
        bodyBytes: 68,
      });
      await byTest(w, "workflow-http-send-test").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-test-result").text()).toContain(
        t("workflow.http.dryRunRateLimited"),
      );
    });

    it("signed mode maps 403 to the same mode-neutral copy", async () => {
      api.putHttpTrigger.mockImplementation(async () => {
        api.getHttpTrigger.mockResolvedValue(httpConfig({ auth_mode: "signature" }));
        return { ...httpConfig({ auth_mode: "signature" }), secret: HTTP_SECRET };
      });
      vi.mocked(dryRunHook).mockResolvedValue({
        status: 403,
        reason: "workflow_disabled",
        input: null,
        bodyBytes: 2,
      });
      const w = await mountSection({ workflowEnabled: false });
      await w.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "signature");
      await byTest(w, "workflow-http-auth-switch-confirm").trigger("click");
      await flushPromises();
      await byTest(w, "workflow-http-send-test").trigger("click");
      await flushPromises();
      expect(vi.mocked(dryRunHook).mock.calls[0][0].auth).toEqual({
        mode: "signature",
        secret: HTTP_SECRET,
      });
      expect(byTest(w, "workflow-http-test-result").text()).toContain(
        t("workflow.http.dryRunRefused"),
      );
    });

    it("the hint depends on the workflow state", async () => {
      const live = await reveal();
      expect(byTest(live, "workflow-http-send-test-hint").text()).toBe(
        t("workflow.http.sendTestHint"),
      );
      const draft = await reveal({ isDraftOnly: true });
      expect(byTest(draft, "workflow-http-send-test-hint").text()).toBe(
        t("workflow.http.sendTestHintDraft"),
      );
      const paused = await reveal({ workflowEnabled: false });
      expect(byTest(paused, "workflow-http-send-test-hint").text()).toBe(
        t("workflow.http.sendTestHintDraft"),
      );
    });
  });

  describe("steady state (1.4)", () => {
    it("switch off confirms in workflow-http-disable-popover with the 403 copy and PUTs enabled:false", async () => {
      api.putHttpTrigger.mockResolvedValue({ ...httpConfig({ enabled: false }), secret: null });
      const w = await mountSection();
      expect(byTest(w, "workflow-http-toggle").attributes("data-value")).toBe("true");
      await byTest(w, "workflow-http-toggle").trigger("click");
      const popover = byTest(w, "workflow-http-disable-popover");
      expect(popover.text()).toContain(t("workflow.http.disableTitle"));
      expect(popover.text()).toContain(t("workflow.http.disableBody"));
      expect(api.putHttpTrigger).not.toHaveBeenCalled();
      await byTest(w, "workflow-http-disable-confirm").trigger("click");
      await flushPromises();
      expect(api.putHttpTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { enabled: false, auth_mode: "token" } }),
      );
    });

    it("mode switch confirms in a popover and reveals the new secret", async () => {
      api.putHttpTrigger.mockImplementation(async () => {
        api.getHttpTrigger.mockResolvedValue(httpConfig({ auth_mode: "signature" }));
        return { ...httpConfig({ auth_mode: "signature" }), secret: HTTP_SECRET };
      });
      const w = await mountSection();
      await w.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "signature");
      const popover = byTest(w, "workflow-http-auth-switch-popover");
      expect(popover.text()).toContain(t("workflow.http.switchToSignedTitle"));
      expect(popover.text()).toContain(t("workflow.http.switchToSignedBody"));
      expect(api.putHttpTrigger).not.toHaveBeenCalled();
      await byTest(w, "workflow-http-auth-switch-confirm").trigger("click");
      await flushPromises();
      expect(api.putHttpTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ payload: { enabled: true, auth_mode: "signature" } }),
      );
      expect(byTest(w, "workflow-http-reveal-banner").text()).toContain(
        t("workflow.http.switchedBannerTitleSigned"),
      );
    });

    it("workflow-http-last-call shows a failed status in the negative colour", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({ last_call: { run_id: "r-9", status: "failed", received_at: 1 } }),
      );
      const w = await mountSection();
      const status = byTest(w, "workflow-http-last-call-status");
      expect(status.text()).toBe(t("workflow.http.lastCallStatus.failed"));
      expect(status.classes()).toContain("text-status-negative");
    });

    it("a succeeded last call reads positive", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({ last_call: { run_id: "r-9", status: "succeeded", received_at: 1 } }),
      );
      const w = await mountSection();
      expect(byTest(w, "workflow-http-last-call-status").classes()).toContain(
        "text-status-positive",
      );
    });

    it("workflow-http-last-call-link routes to the runs view with run_id", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({ last_call: { run_id: "r-9", status: "failed", received_at: 1 } }),
      );
      const w = await mountSection();
      const to = JSON.parse(byTest(w, "workflow-http-last-call-link").attributes("data-to")!);
      expect(to).toMatchObject({ name: "workflowRuns", query: { id: "wf1", run_id: "r-9" } });
    });

    it("no calls shows No calls yet — send a test request", async () => {
      const w = await mountSection();
      expect(byTest(w, "workflow-http-last-call").text()).toBe(t("workflow.http.lastCallNone"));
    });

    it("both modes show workflow-http-secret-storage-warning when secrets_encrypted_at_rest is false", async () => {
      api.getHttpTrigger.mockResolvedValue(httpConfig({ secrets_encrypted_at_rest: false }));
      const token = await mountSection();
      expect(byTest(token, "workflow-http-secret-storage-warning").text()).toBe(
        t("workflow.http.secretStorageWarning"),
      );
      queryClient.clear();
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({ secrets_encrypted_at_rest: false, auth_mode: "signature" }),
      );
      const signed = await mountSection({ workflowId: "wf2" });
      expect(byTest(signed, "workflow-http-secret-storage-warning").exists()).toBe(true);
    });

    it("no warning when encrypted", async () => {
      const w = await mountSection();
      expect(byTest(w, "workflow-http-secret-storage-warning").exists()).toBe(false);
    });

    it("draft shows the 403 banner and a paused workflow the disabled banner", async () => {
      const draft = await mountSection({ isDraftOnly: true });
      expect(byTest(draft, "workflow-http-draft-banner").text()).toBe(
        t("workflow.http.draftBanner"),
      );
      const paused = await mountSection({ workflowEnabled: false });
      expect(byTest(paused, "workflow-http-disabled-banner").text()).toBe(
        t("workflow.http.disabledBanner"),
      );
    });

    it("no edit permission: values readable, Rotate/Revoke/Run test/Advanced hidden", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({ permissions: { edit: false, test: false, reveal: false } }),
      );
      const w = await mountSection();
      expect(byTest(w, "workflow-http-url").text()).toContain(httpConfig().url);
      expect(byTest(w, "workflow-http-meta").text()).toBe(t("workflow.http.readOnlyOnMeta"));
      for (const id of [
        "workflow-http-rotate",
        "workflow-http-credential-c1-revoke",
        "workflow-http-run-test",
        "workflow-http-advanced",
        "workflow-http-credential-c1-show",
      ]) {
        expect(byTest(w, id).exists(), id).toBe(false);
      }
      expect(byTest(w, "workflow-http-toggle").attributes("disabled")).toBeDefined();
    });

    it("without reveal the auth toggle is disabled and Rotate hidden", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({ permissions: { edit: true, test: true, reveal: false } }),
      );
      const w = await mountSection();
      expect(w.findComponent({ name: "OToggleGroup" }).props("disabled")).toBe(true);
      expect(byTest(w, "workflow-http-rotate").exists()).toBe(false);
      expect(byTest(w, "workflow-http-credential-reveal-denied").exists()).toBe(true);
    });

    it("Run test closes over the seed and has the editor tooltip", async () => {
      const w = await mountSection();
      expect(byTest(w, "workflow-http-run-test-tooltip").attributes("data-content")).toBe(
        t("workflow.http.runTestHint"),
      );
      await byTest(w, "workflow-http-run-test").trigger("click");
      const seed = w.emitted("run-test")?.[0][0] as { meta: { trigger_id: string } }[];
      expect(seed[0].meta.trigger_id).toBe("test");
    });

    it("list context replaces Run test with Open the workflow", async () => {
      const w = await mountSection({ context: "list" });
      expect(byTest(w, "workflow-http-run-test").exists()).toBe(false);
      expect(byTest(w, "workflow-http-run-test-list-hint").text()).toBe(
        t("workflow.http.runTestHintList"),
      );
    });

    it("row Copy copies the live value and toasts", async () => {
      api.revealHttpCredentialSecret.mockResolvedValue({ ...httpCredential(), secret: HTTP_TOKEN });
      const w = await mountSection();
      await byTest(w, "workflow-http-credential-c1-copy").trigger("click");
      await flushPromises();
      expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toBe(HTTP_TOKEN);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ message: t("workflow.http.tokenCopied") }),
      );
    });

    it("rotate is disabled with the tooltip while a credential is retiring", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({
          credentials: [
            httpCredential({ id: "c2" }),
            httpCredential({
              id: "c1",
              state: "retiring",
              expires_at: Date.now() * 1000 + 24 * HOUR_US,
            }),
          ],
        }),
      );
      const w = await mountSection();
      expect(byTest(w, "workflow-http-rotate").attributes("aria-disabled")).toBe("true");
      expect(byTest(w, "workflow-http-rotate-blocked-tooltip").attributes("data-content")).toBe(
        t("workflow.http.rotateBlocked"),
      );
    });
  });

  describe("advanced and delete", () => {
    // OFormInput drops native min/max on purpose (OFormInput.spec), so the schema owns both caps.
    it("rate field max is the org budget", async () => {
      api.getHttpTrigger.mockResolvedValue(httpConfig({ org_rate_limit_per_minute: 600 }));
      const w = await mountSection();
      expect(byTest(w, "workflow-http-advanced").text()).toContain(
        t("workflow.http.advancedSummary", { size: "1 MiB", count: 60 }, 60),
      );
      await byTest(w, "workflow-http-advanced").find("button").trigger("click");
      await flushPromises();
      expect(w.text()).toContain(t("workflow.http.rateLimitHint", { org: 600 }));
      await byTest(w, "workflow-http-rate-limit-field").setValue("601");
      await byTest(w, "workflow-http-max-body-field").setValue("1025");
      await submitLimits(w);
      expect(api.putHttpTrigger).not.toHaveBeenCalled();
      expect(w.text()).toContain(t("workflow.http.rateLimitRange", { org: 600 }));
      expect(w.text()).toContain(t("workflow.http.maxBodyRange"));
      await byTest(w, "workflow-http-rate-limit-field").setValue("600");
      await byTest(w, "workflow-http-max-body-field").setValue("1024");
      api.putHttpTrigger.mockResolvedValue({ ...httpConfig(), secret: null });
      await submitLimits(w);
      expect(api.putHttpTrigger).toHaveBeenCalledTimes(1);
    });

    it("Delete endpoint confirms in workflow-http-delete-popover and workflow-http-delete-confirm calls DELETE", async () => {
      api.deleteHttpTrigger.mockImplementation(async () => {
        api.getHttpTrigger.mockResolvedValue(httpAbsent());
      });
      const w = await mountSection();
      await byTest(w, "workflow-http-advanced").find("button").trigger("click");
      await flushPromises();
      await byTest(w, "workflow-http-delete").trigger("click");
      const popover = byTest(w, "workflow-http-delete-popover");
      expect(popover.text()).toContain(t("workflow.http.deleteTitle"));
      expect(popover.text()).toContain(t("workflow.http.deleteBody"));
      await byTest(w, "workflow-http-delete-confirm").trigger("click");
      await flushPromises();
      expect(api.deleteHttpTrigger).toHaveBeenCalled();
      expect(byTest(w, "workflow-http-meta").text()).toBe(t("workflow.http.offBody"));
      expect(byTest(w, "workflow-http-toggle").attributes("data-value")).toBe("false");
    });

    it("Delete endpoint is hidden without edit permission", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({ permissions: { ...fullPermissions(), edit: false } }),
      );
      const w = await mountSection();
      expect(byTest(w, "workflow-http-delete").exists()).toBe(false);
    });
  });

  describe("rejections line", () => {
    it("is hidden at zero and opens the list on Show", async () => {
      const quiet = await mountSection();
      expect(byTest(quiet, "workflow-http-rejections-line").exists()).toBe(false);
      queryClient.clear();
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({
          rejections: {
            rate_limited: { count_24h: 2, last_at: 1, last_ip: "1.2.3.4", window_start: 1 },
          },
        }),
      );
      const w = await mountSection({ workflowId: "wf3" });
      expect(byTest(w, "workflow-http-rejections-line").text()).toContain("2");
      await byTest(w, "workflow-http-rejections-show").trigger("click");
      expect(byTest(w, "workflow-http-rejection-rate_limited").exists()).toBe(true);
    });
  });

  describe("rotate, revoke and limits", () => {
    const NEW_TOKEN = "o2wh_NEWROTATEDTOKENVALUE000000002";

    it("rotating reveals the new token above the tokens table with the retiring row (3.2)", async () => {
      api.rotateHttpCredential.mockImplementation(async () => {
        api.getHttpTrigger.mockResolvedValue(
          httpConfig({
            credentials: [
              httpCredential({ id: "c2", display_prefix: "o2wh_NEWR…0002" }),
              httpCredential({
                id: "c1",
                state: "retiring",
                expires_at: Date.now() * 1000 + 24 * HOUR_US,
              }),
            ],
          }),
        );
        return { ...httpCredential({ id: "c2" }), secret: NEW_TOKEN };
      });
      const w = await mountSection();
      await byTest(w, "workflow-http-rotate").trigger("click");
      await byTest(w, "workflow-http-rotate-confirm").trigger("click");
      await flushPromises();
      expect(api.rotateHttpCredential).toHaveBeenCalledWith(
        expect.objectContaining({ overlap_seconds: 86400 }),
      );
      expect(byTest(w, "workflow-http-reveal-banner").text()).toContain(
        t("workflow.http.rotateBannerTitle"),
      );
      expect(byTest(w, "workflow-http-reveal").text()).toContain(t("workflow.http.newTokenLabel"));
      expect(byTest(w, "workflow-http-reveal").text()).not.toContain(NEW_TOKEN);
      expect(byTest(w, "workflow-http-url").exists()).toBe(false);
      expect(byTest(w, "workflow-http-send-test").exists()).toBe(false);
      expect(byTest(w, "workflow-http-credential-retiring").exists()).toBe(true);
      expect(byTest(w, "workflow-http-credential-c1-show").exists()).toBe(true);
      expect(byTest(w, "workflow-http-rotate").attributes("aria-disabled")).toBe("true");
      await byTest(w, "workflow-http-reveal-done").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-reveal").exists()).toBe(false);
      expect(byTest(w, "workflow-http-url").exists()).toBe(true);
    });

    it("a failed rotate keeps the popover open with the reason", async () => {
      api.rotateHttpCredential.mockRejectedValue({ response: { data: { message: "busy" } } });
      const w = await mountSection();
      await byTest(w, "workflow-http-rotate").trigger("click");
      await byTest(w, "workflow-http-rotate-confirm").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-rotate-error").text()).toBe(
        t("workflow.http.rotateFailed", { reason: "busy" }),
      );
    });

    it("row Revoke confirms, then revokes that credential", async () => {
      api.revokeHttpCredential.mockResolvedValue(undefined);
      const w = await mountSection();
      await byTest(w, "workflow-http-credential-c1-revoke").trigger("click");
      expect(api.revokeHttpCredential).not.toHaveBeenCalled();
      await byTest(w, "workflow-http-credential-c1-revoke-confirm").trigger("click");
      await flushPromises();
      expect(api.revokeHttpCredential).toHaveBeenCalledWith(
        expect.objectContaining({ credential_id: "c1" }),
      );
    });

    it("cancelling the mode switch keeps the mode and sends nothing", async () => {
      const w = await mountSection();
      await w.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", "signature");
      await byTest(w, "workflow-http-auth-switch-cancel").trigger("click");
      expect(byTest(w, "workflow-http-auth-switch-popover").exists()).toBe(false);
      expect(api.putHttpTrigger).not.toHaveBeenCalled();
      expect(w.findComponent({ name: "OToggleGroup" }).props("modelValue")).toBe("token");
    });

    it("Save sends the limits in bytes and per minute", async () => {
      api.putHttpTrigger.mockResolvedValue({ ...httpConfig(), secret: null });
      const w = await mountSection();
      await byTest(w, "workflow-http-advanced").find("button").trigger("click");
      await flushPromises();
      await byTest(w, "workflow-http-max-body-field").setValue("512");
      await byTest(w, "workflow-http-rate-limit-field").setValue("120");
      await submitLimits(w);
      expect(api.putHttpTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: {
            enabled: true,
            auth_mode: "token",
            max_body_bytes: 512 * 1024,
            rate_limit_per_minute: 120,
          },
        }),
      );
    });

    it("a rate above the org budget is refused before any PUT", async () => {
      const w = await mountSection();
      await byTest(w, "workflow-http-advanced").find("button").trigger("click");
      await flushPromises();
      await byTest(w, "workflow-http-rate-limit-field").setValue("5000");
      await submitLimits(w);
      expect(api.putHttpTrigger).not.toHaveBeenCalled();
      expect(w.text()).toContain(t("workflow.http.rateLimitRange", { org: 1200 }));
    });

    it("Raise limit opens Advanced at the rate field", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({
          rejections: {
            rate_limited: { count_24h: 4, last_at: 1, last_ip: "1.2.3.4", window_start: 1 },
          },
        }),
      );
      const w = await mountSection();
      expect(byTest(w, "workflow-http-rate-limit-field").exists()).toBe(false);
      await byTest(w, "workflow-http-rejections-show").trigger("click");
      await byTest(w, "workflow-http-rejection-raise-limit").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-rate-limit-field").exists()).toBe(true);
    });

    it("a failed rejections refresh shows the load error with Retry", async () => {
      api.getHttpTrigger.mockResolvedValue(
        httpConfig({
          rejections: {
            invalid_token: { count_24h: 1, last_at: 1, last_ip: "1.2.3.4", window_start: 1 },
          },
        }),
      );
      const w = await mountSection();
      await byTest(w, "workflow-http-rejections-show").trigger("click");
      api.getHttpTrigger.mockRejectedValue({ response: { status: 500 } });
      await byTest(w, "workflow-http-rejections-refresh").trigger("click");
      await flushPromises();
      expect(byTest(w, "workflow-http-rejections").text()).toContain(
        t("workflow.http.rejectionsLoadError"),
      );
      expect(byTest(w, "workflow-http-rejections-retry").exists()).toBe(true);
    });
  });

  it("no workflow.http string says shown once", () => {
    const banned = ["shown once", "only once", "can't be shown again", "copy it now"];
    const values = JSON.stringify(enUS.workflow.http).toLowerCase();
    for (const phrase of banned) expect(values).not.toContain(phrase);
  });
});
