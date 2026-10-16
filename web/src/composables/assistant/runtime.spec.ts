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

import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { queryClient } from "@/composables/query/queryClient";
import assistantService from "@/services/assistant";
import { computeUserOrgKey } from "@/utils/userOrgKey";

import * as storeModule from "./assistantStore";
import { assistantStore, openAssistant, useAssistantCapability } from "./index";
import { pushRecall, readRecall } from "./prefs";
import { getAssistantRuntime, resetAssistantRuntimeForTests } from "./runtime";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

vi.mock("@/services/assistant", () => ({
  default: {
    capabilities: vi.fn().mockResolvedValue(null),
    probeChatAccess: vi.fn().mockResolvedValue("no"),
    testCapabilities: vi.fn(),
  },
}));

const createStore = vi.spyOn(storeModule, "createAssistantStore");

const CONFIG = {
  aiEnabled: true,
  rbacEnabled: true,
  persistence: true,
  publicLinks: false,
  publicMaxExpiryDays: 30,
  rcaEnabled: false,
};

afterEach(() => {
  resetAssistantRuntimeForTests();
  queryClient.clear();
  sessionStorage.clear();
  localStorage.clear();
  vi.clearAllMocks();
});

const context = (role: string, org = ref("org1")) => ({
  getOrg: () => ({ identifier: org.value, name: org.value }),
  getUser: () => ({ email: "dev@example.com", role }),
  getConfig: () => CONFIG,
  isOrgAdmin: () => undefined,
  router: {
    currentRoute: ref({ name: "logs", meta: {} }),
    push: vi.fn().mockResolvedValue(undefined),
  } as never,
});

describe("assistant runtime", () => {
  it("constructs nothing on import and builds once on first access", () => {
    expect(createStore).not.toHaveBeenCalled();
    expect(assistantStore.state.ready).toBe(false);
    expect(assistantStore.state.capability.gate).toBe("loading");
    void assistantStore.headerLight;
    expect(createStore).toHaveBeenCalledTimes(1);
  });

  it("resolves the gate from the wired getters and lets a door open", async () => {
    assistantStore.init(context("admin"));
    await flushPromises();
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    expect(useAssistantCapability().value).toMatchObject({
      gate: "available",
      canChat: "yes",
      source: "heuristic",
    });
    expect(assistantService.capabilities).toHaveBeenCalledWith("org1");
    expect(assistantService.probeChatAccess).not.toHaveBeenCalled();
    const result = await openAssistant({
      entryKind: "header_button",
      entryVerb: "ask",
      objectKind: "none",
      intent: "open",
    });
    expect(result).toMatchObject({ ok: true, container: "sidebar" });
    expect(assistantStore.state.shell.placement.kind).toBe("sidebar");
  });

  it("probes a viewer once after B-06 answers absent and locks on a 403", async () => {
    assistantStore.init(context("viewer"));
    await vi.waitFor(() => expect(assistantService.probeChatAccess).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(assistantStore.state.capability.gate).toBe("no_permission"));
    expect(assistantStore.state.capability.source).toBe("probe");
  });

  it("recomputes on an org switch with a new user+org key", async () => {
    const org = ref("org1");
    assistantStore.init(context("editor", org));
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    const first = assistantStore.state.userOrgKey;
    getAssistantRuntime().capability.noteForbidden();
    expect(assistantStore.state.capability.gate).toBe("no_permission");
    org.value = "org2";
    await vi.waitFor(() => expect(assistantStore.state.userOrgKey).not.toBe(first));
    await vi.waitFor(() => expect(assistantStore.state.capability.gate).toBe("available"));
  });

  it("stamps the telemetry envelope from the runtime", async () => {
    assistantStore.init(context("sre-oncall"));
    await vi.waitFor(() => expect(assistantStore.state.capability.gate).toBe("no_permission"));
    expect(assistantStore.state.ready).toBe(false);
    const getters = assistantStore.telemetryContext("abc123");
    expect(getters.getGate()).toBe(assistantStore.state.capability.gate);
    expect(getters.getRole()).toBe("custom");
    expect(getters.getOrg()).toBe("org1");
    expect(getters.getEdition()).toBe("ee");
    expect(getters.getRoute()).toBe("logs");
    expect(getters.getContainer()).toBe("home");
    expect(getters.uiVersion).toBe("abc123");
  });

  it("writes a debounced draft at once when the page is left", async () => {
    assistantStore.init(context("admin"));
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    const sid = assistantStore.createSession({
      origin: { entryKind: "header_button", objectKind: "none", container: "sidebar" },
    });
    assistantStore.setDraft(sid, { text: "half typed" });
    const key = `o2.assistant.draft:${assistantStore.state.userOrgKey}:${sid}`;
    expect(sessionStorage.getItem(key)).toBeNull();
    window.dispatchEvent(new Event("pagehide"));
    expect(sessionStorage.getItem(key)).toContain("half typed");
  });

  it("drops the recall of every org of the user on sign-out", async () => {
    assistantStore.init({ ...context("admin"), getOrganizations: () => ["org1", "org2"] });
    await vi.waitFor(() => expect(assistantStore.state.ready).toBe(true));
    const other = await computeUserOrgKey("dev@example.com", "org2");
    pushRecall(other, { text: "token=abc", chips: [], at: 1 });
    await assistantStore.onSignOut();
    expect(readRecall(other)).toEqual([]);
  });
});
