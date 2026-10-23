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
import { defineComponent, nextTick, ref, type Ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import workflows, {
  dryRunHook,
  type HttpCredential,
  type HttpTriggerAbsent,
  type HttpTriggerConfig,
} from "@/services/workflows";
import { copyToClipboard } from "@/utils/clipboard";
import { buildHttpRequestSample } from "./httpRequestSample";
import { useWorkflowHttpEndpoint } from "./useWorkflowHttpEndpoint";

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

const api = vi.mocked(workflows);
const TOKEN = "o2wh_FRESHLYMINTEDTOKENVALUE0000001";
const ROW_VALUE = "o2wh_ROWVALUEREVEALEDFROMTHETABLE01";
const permissions = { edit: true, test: true, reveal: true };
const HOUR_US = 3_600_000_000;

const credential = (over: Partial<HttpCredential> = {}): HttpCredential => ({
  id: "c1",
  kind: "token",
  display_prefix: "o2wh_4fK9…oI4k",
  state: "active",
  expires_at: null,
  created_by: "a@example.com",
  creator_in_org: true,
  created_at: 1,
  last_used_at: null,
  ...over,
});

const config = (over: Partial<HttpTriggerConfig> = {}): HttpTriggerConfig => ({
  configured: true,
  id: "t1",
  url: "https://o2.example.com/api/v2/default/workflows/hooks/t1",
  region_host: null,
  enabled: true,
  auth_mode: "token",
  max_body_bytes: 1_048_576,
  rate_limit_per_minute: 1200,
  org_rate_limit_per_minute: 1200,
  created_by: "a@example.com",
  created_at: 1,
  updated_at: 1,
  last_invoked_at: null,
  last_call: null,
  secrets_encrypted_at_rest: true,
  rejections: {},
  credentials: [credential()],
  permissions,
  ...over,
});

const absent = (over: Partial<HttpTriggerAbsent> = {}): HttpTriggerAbsent => ({
  configured: false,
  org_rate_limit_per_minute: 1200,
  secrets_encrypted_at_rest: true,
  permissions,
  ...over,
});

const cachesHold = (value: string) =>
  JSON.stringify(
    queryClient
      .getMutationCache()
      .getAll()
      .map((m) => m.state),
  ).includes(value) ||
  JSON.stringify(
    queryClient
      .getQueryCache()
      .getAll()
      .map((q) => q.state.data),
  ).includes(value);

// Unmounted after each test, or a live harness from one test refetches into the next test's cache.
const mounted: { unmount: () => void }[] = [];

const mountEndpoint = async (
  opts: {
    id?: string | null;
    draft?: boolean;
    enabled?: boolean;
    context?: "editor" | "list";
    beforeCreate?: (id: Ref<string | null>) => Promise<boolean>;
  } = {},
) => {
  const workflowId = ref<string | null>(opts.id === undefined ? "wf1" : opts.id);
  const isDraftOnly = ref(opts.draft ?? false);
  const workflowEnabled = ref(opts.enabled ?? true);
  let endpoint!: ReturnType<typeof useWorkflowHttpEndpoint>;
  const Harness = defineComponent({
    setup() {
      endpoint = useWorkflowHttpEndpoint({
        workflowId,
        isDraftOnly,
        workflowEnabled,
        context: opts.context,
        beforeCreate: opts.beforeCreate ? () => opts.beforeCreate!(workflowId) : undefined,
      });
      return () => null;
    },
  });
  const wrapper = mount(Harness, { global: { plugins: [store] } });
  mounted.push(wrapper);
  await flushPromises();
  return { endpoint, wrapper, workflowId, isDraftOnly, workflowEnabled };
};

describe("useWorkflowHttpEndpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.selectedOrganization = { ...store.state.selectedOrganization, identifier: "acme" };
    store.state.zoConfig = { ...store.state.zoConfig, rbac_enabled: false };
    store.state.currentuser = { role: "admin" };
    api.getHttpTrigger.mockResolvedValue(config());
    vi.mocked(copyToClipboard).mockResolvedValue(true);
  });

  afterEach(() => {
    for (const wrapper of mounted.splice(0)) {
      try {
        wrapper.unmount();
      } catch {
        // Already unmounted by the test itself.
      }
    }
    queryClient.clear();
  });

  describe("state machine", () => {
    it("an unsaved workflow is unsaved and reads nothing", async () => {
      const { endpoint } = await mountEndpoint({ id: null });

      expect(endpoint.status.value).toBe("unsaved");
      expect(endpoint.phase.value).toBe("unsaved");
      expect(api.getHttpTrigger).not.toHaveBeenCalled();
    });

    it("a workflow without an endpoint is not configured and off", async () => {
      api.getHttpTrigger.mockResolvedValue(absent());
      const { endpoint } = await mountEndpoint();

      expect(api.getHttpTrigger).toHaveBeenCalledWith({ org_identifier: "acme", id: "wf1" });
      expect(endpoint.status.value).toBe("not_configured");
      expect(endpoint.phase.value).toBe("off");
      expect(endpoint.chip.value).toBeNull();
    });

    it("a configured endpoint that is switched off is off", async () => {
      api.getHttpTrigger.mockResolvedValue(config({ enabled: false }));
      const { endpoint } = await mountEndpoint();

      expect(endpoint.status.value).toBe("off");
      expect(endpoint.phase.value).toBe("off");
    });

    it("an enabled endpoint on a published, enabled workflow is on with a success chip", async () => {
      const { endpoint } = await mountEndpoint();

      expect(endpoint.status.value).toBe("on");
      expect(endpoint.phase.value).toBe("steady");
      expect(endpoint.chip.value).toBe("success");
    });

    it("a draft or a paused workflow refuses calls, so its chip warns", async () => {
      const draft = await mountEndpoint({ draft: true });
      expect(draft.endpoint.status.value).toBe("draft");
      expect(draft.endpoint.chip.value).toBe("warning");

      const paused = await mountEndpoint({ enabled: false });
      expect(paused.endpoint.status.value).toBe("paused");
      expect(paused.endpoint.chip.value).toBe("warning");
    });

    it("a failed read with nothing cached is the error phase", async () => {
      api.getHttpTrigger.mockRejectedValue({ response: { status: 500 } });
      const { endpoint } = await mountEndpoint();

      expect(endpoint.phase.value).toBe("error");
    });

    it("reports the storage warning only when the server says secrets are not encrypted", async () => {
      api.getHttpTrigger.mockResolvedValue(config({ secrets_encrypted_at_rest: false }));
      const { endpoint } = await mountEndpoint();

      expect(endpoint.storageWarning.value).toBe(true);
    });
  });

  describe("creating and the unsaved path", () => {
    it("the secret is not in the mutation cache after reveal", async () => {
      api.getHttpTrigger.mockResolvedValue(absent());
      api.putHttpTrigger.mockResolvedValue({ ...config(), secret: TOKEN });
      const { endpoint } = await mountEndpoint();

      await endpoint.turnOn();

      expect(api.putHttpTrigger).toHaveBeenCalledWith({
        org_identifier: "acme",
        id: "wf1",
        payload: { enabled: true, auth_mode: "token" },
      });
      expect(endpoint.revealedSecret.value).toBe(TOKEN);
      expect(endpoint.revealKind.value).toBe("created");
      expect(endpoint.phase.value).toBe("revealing");
      expect(endpoint.revealActive.value).toBe(true);
      expect(cachesHold(TOKEN)).toBe(false);
    });

    it("Done clears the secret", async () => {
      api.getHttpTrigger.mockResolvedValueOnce(absent());
      api.putHttpTrigger.mockResolvedValue({ ...config(), secret: TOKEN });
      const { endpoint } = await mountEndpoint();
      await endpoint.turnOn();

      endpoint.endReveal();
      await flushPromises();

      expect(endpoint.revealedSecret.value).toBeNull();
      expect(endpoint.phase.value).toBe("steady");
    });

    it("unmount clears the secret", async () => {
      api.getHttpTrigger.mockResolvedValue(absent());
      api.putHttpTrigger.mockResolvedValue({ ...config(), secret: TOKEN });
      const { endpoint, wrapper } = await mountEndpoint();
      await endpoint.turnOn();

      wrapper.unmount();

      expect(endpoint.revealedSecret.value).toBeNull();
    });

    it("an org switch clears the secret", async () => {
      api.getHttpTrigger.mockResolvedValue(absent());
      api.putHttpTrigger.mockResolvedValue({ ...config(), secret: TOKEN });
      const { endpoint } = await mountEndpoint();
      await endpoint.turnOn();

      store.state.selectedOrganization = { ...store.state.selectedOrganization, identifier: "b" };
      await nextTick();

      expect(endpoint.revealedSecret.value).toBeNull();
    });

    it("an endpoint that already existed returns no secret and shows the exists hint", async () => {
      api.getHttpTrigger.mockResolvedValue(absent());
      api.putHttpTrigger.mockResolvedValue({ ...config(), secret: null });
      const { endpoint } = await mountEndpoint();

      await endpoint.turnOn();

      expect(endpoint.revealedSecret.value).toBeNull();
      expect(endpoint.endpointExists.value).toBe(true);
    });

    it("an unsaved workflow saves a draft first, then creates its endpoint", async () => {
      api.putHttpTrigger.mockResolvedValue({ ...config(), secret: TOKEN });
      const beforeCreate = vi.fn(async (id: Ref<string | null>) => {
        id.value = "wf9";
        return true;
      });
      const { endpoint } = await mountEndpoint({ id: null, beforeCreate });

      await endpoint.turnOn();

      expect(beforeCreate).toHaveBeenCalledTimes(1);
      expect(api.putHttpTrigger).toHaveBeenCalledWith({
        org_identifier: "acme",
        id: "wf9",
        payload: { enabled: true, auth_mode: "token" },
      });
      expect(endpoint.revealedSecret.value).toBe(TOKEN);
    });

    it("a false beforeCreate creates nothing", async () => {
      const { endpoint } = await mountEndpoint({ id: null, beforeCreate: async () => false });

      await endpoint.turnOn();

      expect(api.putHttpTrigger).not.toHaveBeenCalled();
      expect(endpoint.phase.value).toBe("unsaved");
    });

    it("an unsaved workflow may create only with credential access", async () => {
      const { endpoint } = await mountEndpoint({ id: null });
      expect(endpoint.canTurnOn.value).toBe(true);

      store.state.currentuser = { role: "editor" };
      await nextTick();
      expect(endpoint.canTurnOn.value).toBe(false);

      store.state.zoConfig = { ...store.state.zoConfig, rbac_enabled: true };
      await nextTick();
      expect(endpoint.canTurnOn.value).toBe(true);
    });

    it("creating needs reveal permission; switching back on needs only edit", async () => {
      api.getHttpTrigger.mockResolvedValue(
        absent({ permissions: { edit: true, test: true, reveal: false } }),
      );
      const create = await mountEndpoint();
      expect(create.endpoint.canTurnOn.value).toBe(false);

      queryClient.clear();
      api.getHttpTrigger.mockResolvedValue(
        config({ enabled: false, permissions: { edit: true, test: true, reveal: false } }),
      );
      const reopen = await mountEndpoint();
      expect(reopen.endpoint.canTurnOn.value).toBe(true);
    });
  });

  describe("mode, limits, off and delete", () => {
    it("turning off keeps the mode and sends enabled false", async () => {
      api.putHttpTrigger.mockResolvedValue({ ...config({ enabled: false }), secret: null });
      const { endpoint } = await mountEndpoint();

      await endpoint.turnOff();

      expect(api.putHttpTrigger).toHaveBeenCalledWith({
        org_identifier: "acme",
        id: "wf1",
        payload: { enabled: false, auth_mode: "token" },
      });
    });

    it("turning a configured endpoint back on keeps its mode and reveals nothing", async () => {
      api.getHttpTrigger.mockResolvedValue(config({ enabled: false, auth_mode: "signature" }));
      api.putHttpTrigger.mockResolvedValue({ ...config(), secret: null });
      const { endpoint } = await mountEndpoint();

      await endpoint.turnOn("token");

      expect(api.putHttpTrigger).toHaveBeenCalledWith({
        org_identifier: "acme",
        id: "wf1",
        payload: { enabled: true, auth_mode: "signature" },
      });
      expect(endpoint.endpointExists.value).toBe(false);
      expect(endpoint.revealedSecret.value).toBeNull();
    });

    it("switching mode reveals the new secret and drops revealed rows of the old kind", async () => {
      api.revealHttpCredentialSecret.mockResolvedValue({ ...credential(), secret: ROW_VALUE });
      api.putHttpTrigger.mockResolvedValue({
        ...config({ auth_mode: "signature" }),
        secret: "whsec_NEW",
      });
      const { endpoint } = await mountEndpoint();
      await endpoint.revealCredential("c1");

      await endpoint.switchMode("signature");

      expect(api.putHttpTrigger).toHaveBeenCalledWith({
        org_identifier: "acme",
        id: "wf1",
        payload: { enabled: true, auth_mode: "signature" },
      });
      expect(endpoint.revealedSecret.value).toBe("whsec_NEW");
      expect(endpoint.revealKind.value).toBe("switched");
      expect(endpoint.revealedCredentials.value).toEqual({});
      expect(cachesHold("whsec_NEW")).toBe(false);
    });

    it("switching to the current mode does nothing", async () => {
      const { endpoint } = await mountEndpoint();

      await endpoint.switchMode("token");

      expect(api.putHttpTrigger).not.toHaveBeenCalled();
    });

    it("saving limits sends them with the current state", async () => {
      api.putHttpTrigger.mockResolvedValue({ ...config(), secret: null });
      const { endpoint } = await mountEndpoint();

      await endpoint.saveLimits({ max_body_bytes: 4096, rate_limit_per_minute: 10 });

      expect(api.putHttpTrigger).toHaveBeenCalledWith({
        org_identifier: "acme",
        id: "wf1",
        payload: {
          enabled: true,
          auth_mode: "token",
          max_body_bytes: 4096,
          rate_limit_per_minute: 10,
        },
      });
    });

    it("delete removes the endpoint and every value held in memory", async () => {
      api.revealHttpCredentialSecret.mockResolvedValue({ ...credential(), secret: ROW_VALUE });
      api.deleteHttpTrigger.mockResolvedValue(undefined);
      const { endpoint } = await mountEndpoint();
      await endpoint.revealCredential("c1");
      api.getHttpTrigger.mockResolvedValue(absent());

      await endpoint.deleteEndpoint();
      await flushPromises();

      expect(api.deleteHttpTrigger).toHaveBeenCalledWith({ org_identifier: "acme", id: "wf1" });
      expect(endpoint.revealedCredentials.value).toEqual({});
      expect(endpoint.status.value).toBe("not_configured");
    });
  });

  describe("rotate and revoke", () => {
    it("rotate reveals the new secret and keeps it out of the caches", async () => {
      api.rotateHttpCredential.mockResolvedValue({ ...credential({ id: "c2" }), secret: TOKEN });
      const { endpoint } = await mountEndpoint();

      await endpoint.rotate(86400);

      expect(api.rotateHttpCredential).toHaveBeenCalledWith({
        org_identifier: "acme",
        id: "wf1",
        overlap_seconds: 86400,
      });
      expect(endpoint.revealedSecret.value).toBe(TOKEN);
      expect(endpoint.revealKind.value).toBe("rotated");
      expect(cachesHold(TOKEN)).toBe(false);
    });

    it("rotate is blocked while a credential is retiring", async () => {
      api.getHttpTrigger.mockResolvedValue(
        config({
          credentials: [
            credential({ id: "c2" }),
            credential({ state: "retiring", expires_at: Date.now() * 1000 + HOUR_US }),
          ],
        }),
      );
      const { endpoint } = await mountEndpoint();

      expect(endpoint.rotateBlocked.value).toBe(true);
      expect(endpoint.canRotate.value).toBe(false);
      await endpoint.rotate(0);
      expect(api.rotateHttpCredential).not.toHaveBeenCalled();
    });

    it("a retiring credential past its expiry no longer blocks rotate and is not live", async () => {
      api.getHttpTrigger.mockResolvedValue(
        config({
          credentials: [
            credential({ id: "c2" }),
            credential({ state: "retiring", expires_at: Date.now() * 1000 - HOUR_US }),
          ],
        }),
      );
      const { endpoint } = await mountEndpoint();

      expect(endpoint.rotateBlocked.value).toBe(false);
      expect(endpoint.liveCredentials.value.map((c) => c.id)).toEqual(["c2"]);
    });

    it("rotate needs reveal permission", async () => {
      api.getHttpTrigger.mockResolvedValue(
        config({ permissions: { edit: true, test: true, reveal: false } }),
      );
      const { endpoint } = await mountEndpoint();

      expect(endpoint.canRotate.value).toBe(false);
    });

    it("revoke calls the route and forgets that row's value", async () => {
      api.revealHttpCredentialSecret.mockResolvedValue({ ...credential(), secret: ROW_VALUE });
      api.revokeHttpCredential.mockResolvedValue(undefined);
      const { endpoint } = await mountEndpoint();
      await endpoint.revealCredential("c1");

      await endpoint.revoke("c1");

      expect(api.revokeHttpCredential).toHaveBeenCalledWith({
        org_identifier: "acme",
        id: "wf1",
        credential_id: "c1",
      });
      expect(endpoint.revealedCredentials.value).toEqual({});
    });
  });

  describe("row Show / Copy", () => {
    beforeEach(() => {
      api.revealHttpCredentialSecret.mockResolvedValue({ ...credential(), secret: ROW_VALUE });
    });

    it("a revealed row value is not in the mutation cache", async () => {
      const { endpoint } = await mountEndpoint();

      await endpoint.revealCredential("c1");

      expect(api.revealHttpCredentialSecret).toHaveBeenCalledWith({
        org_identifier: "acme",
        id: "wf1",
        credential_id: "c1",
      });
      expect(endpoint.revealedCredentials.value).toEqual({ c1: ROW_VALUE });
      expect(cachesHold(ROW_VALUE)).toBe(false);
    });

    it("hide, refetch, org switch and unmount drop revealed values", async () => {
      const { endpoint, wrapper } = await mountEndpoint();

      await endpoint.revealCredential("c1");
      endpoint.hideCredential("c1");
      expect(endpoint.revealedCredentials.value).toEqual({});

      await endpoint.revealCredential("c1");
      await endpoint.refresh();
      await flushPromises();
      expect(endpoint.revealedCredentials.value).toEqual({});

      await endpoint.revealCredential("c1");
      store.state.selectedOrganization = { ...store.state.selectedOrganization, identifier: "b" };
      await nextTick();
      expect(endpoint.revealedCredentials.value).toEqual({});

      store.state.selectedOrganization = {
        ...store.state.selectedOrganization,
        identifier: "acme",
      };
      await flushPromises();
      await endpoint.revealCredential("c1");
      wrapper.unmount();
      expect(endpoint.revealedCredentials.value).toEqual({});
    });

    it("Done drops revealed row values too", async () => {
      const { endpoint } = await mountEndpoint();
      await endpoint.revealCredential("c1");

      endpoint.endReveal();

      expect(endpoint.revealedCredentials.value).toEqual({});
    });

    it("copy without show fetches, copies and keeps nothing", async () => {
      const { endpoint } = await mountEndpoint();

      await expect(endpoint.copyCredential("c1")).resolves.toBe(true);

      expect(api.revealHttpCredentialSecret).toHaveBeenCalledTimes(1);
      expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toBe(ROW_VALUE);
      expect(endpoint.revealedCredentials.value).toEqual({});
      expect(cachesHold(ROW_VALUE)).toBe(false);
    });

    it("copy of a shown value copies it without fetching again", async () => {
      const { endpoint } = await mountEndpoint();
      await endpoint.revealCredential("c1");

      await endpoint.copyCredential("c1");

      expect(api.revealHttpCredentialSecret).toHaveBeenCalledTimes(1);
      expect(vi.mocked(copyToClipboard).mock.calls[0][0]).toBe(ROW_VALUE);
    });

    it("a failed reveal records the row error and a 404 refetches the table", async () => {
      api.revealHttpCredentialSecret.mockRejectedValue({
        response: { status: 404, data: { message: "No live credential with this id" } },
      });
      const { endpoint } = await mountEndpoint();
      const reads = api.getHttpTrigger.mock.calls.length;

      await endpoint.revealCredential("c1");
      await flushPromises();

      expect(endpoint.revealError.value).toEqual({ c1: "No live credential with this id" });
      expect(endpoint.revealing.value).toBeNull();
      expect(api.getHttpTrigger.mock.calls.length).toBe(reads + 1);
    });

    it("a failure without a server message reads as an unknown error", async () => {
      api.revealHttpCredentialSecret.mockRejectedValue({ response: { status: 500, data: {} } });
      const { endpoint } = await mountEndpoint();

      await endpoint.revealCredential("c1");

      expect(endpoint.revealError.value).toEqual({ c1: "Unknown error" });
    });

    it("without reveal permission Show does not call the route", async () => {
      api.getHttpTrigger.mockResolvedValue(
        config({ permissions: { edit: true, test: true, reveal: false } }),
      );
      const { endpoint } = await mountEndpoint();

      await endpoint.revealCredential("c1");

      expect(api.revealHttpCredentialSecret).not.toHaveBeenCalled();
    });
  });

  describe("send test request", () => {
    it("dry-runs the public URL with the revealed token", async () => {
      api.getHttpTrigger.mockResolvedValueOnce(absent());
      api.putHttpTrigger.mockResolvedValue({ ...config(), secret: TOKEN });
      vi.mocked(dryRunHook).mockResolvedValue({
        status: 200,
        reason: null,
        input: null,
        bodyBytes: 2,
      });
      const { endpoint } = await mountEndpoint();
      await endpoint.turnOn();
      await flushPromises();

      await endpoint.sendTest("{}");

      expect(dryRunHook).toHaveBeenCalledWith({
        url: "https://o2.example.com/api/v2/default/workflows/hooks/t1",
        auth: { mode: "token", token: TOKEN },
        body: "{}",
        contentType: "application/json",
      });
    });

    it("signs with the revealed secret after a switch to signed requests", async () => {
      api.putHttpTrigger.mockResolvedValue({
        ...config({ auth_mode: "signature" }),
        secret: "whsec_NEW",
      });
      vi.mocked(dryRunHook).mockResolvedValue({
        status: 200,
        reason: null,
        input: null,
        bodyBytes: 2,
      });
      const { endpoint } = await mountEndpoint();
      await endpoint.switchMode("signature");

      await endpoint.sendTest("{}");

      expect(vi.mocked(dryRunHook).mock.calls[0][0].auth).toEqual({
        mode: "signature",
        secret: "whsec_NEW",
      });
    });

    it("without a revealed value it fetches the active credential and keeps nothing", async () => {
      api.revealHttpCredentialSecret.mockResolvedValue({ ...credential(), secret: ROW_VALUE });
      vi.mocked(dryRunHook).mockResolvedValue({
        status: 403,
        reason: "workflow_not_published",
        input: null,
        bodyBytes: 2,
      });
      const { endpoint } = await mountEndpoint();

      const result = await endpoint.sendTest("{}");

      expect(result.reason).toBe("workflow_not_published");
      expect(api.revealHttpCredentialSecret).toHaveBeenCalledWith({
        org_identifier: "acme",
        id: "wf1",
        credential_id: "c1",
      });
      expect(endpoint.revealedCredentials.value).toEqual({});
      expect(cachesHold(ROW_VALUE)).toBe(false);
    });
  });

  describe("run test", () => {
    it("Run test closes the panel and opens the Test dialog preset to HTTP request", async () => {
      const { endpoint } = await mountEndpoint();

      expect(endpoint.canRunTest.value).toBe(true);
      expect(endpoint.runTestHint.value).toBe("workflow.http.runTestHint");
      expect(endpoint.runTest()).toEqual({
        kind: "open_test",
        seed: buildHttpRequestSample({ trigger_id: "test" }),
      });
    });

    it("seeds the Test dialog with the latest HTTP run input when there is one", async () => {
      const latest = [{ meta: { trigger_source: "http" }, data: [{ id: 7 }] }];
      const { endpoint } = await mountEndpoint();

      expect(endpoint.runTest(latest)).toEqual({ kind: "open_test", seed: latest });
      expect(endpoint.runTest([])).toEqual({
        kind: "open_test",
        seed: buildHttpRequestSample({ trigger_id: "test" }),
      });
    });

    it("list context replaces Run test with Open the workflow", async () => {
      const { endpoint } = await mountEndpoint({ context: "list" });

      expect(endpoint.runTestHint.value).toBe("workflow.http.runTestHintList");
      expect(endpoint.runTest()).toEqual({
        kind: "open_workflow",
        hint: "workflow.http.runTestHintList",
      });
    });

    it("Run test needs an endpoint and edit and test permission", async () => {
      api.getHttpTrigger.mockResolvedValueOnce(absent());
      const off = await mountEndpoint();
      expect(off.endpoint.canRunTest.value).toBe(false);

      api.getHttpTrigger.mockResolvedValueOnce(
        config({ permissions: { edit: false, test: true, reveal: false } }),
      );
      const readOnly = await mountEndpoint({ id: "wf2" });
      expect(readOnly.endpoint.canRunTest.value).toBe(false);

      api.getHttpTrigger.mockResolvedValueOnce(
        config({ permissions: { edit: true, test: false, reveal: true } }),
      );
      const noTest = await mountEndpoint({ id: "wf3" });
      expect(noTest.endpoint.canRunTest.value).toBe(false);
    });

    it("both run test hints exist in en-US", async () => {
      const en = (await import("@/locales/languages/en-US.json")).default;
      expect(en.workflow.http.runTestHint).toBe("Opens Test with an HTTP request payload");
      expect(en.workflow.http.runTestHintList).toBe("Open the workflow to run a test");
    });
  });
});
