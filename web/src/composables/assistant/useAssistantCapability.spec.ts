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

import type { AssistantCapabilitiesResponse } from "@/services/assistant";

import type { Tri } from "./assistantStore.types";
import {
  createAssistantCapability,
  type AssistantCapabilityHandle,
  type AssistantServerConfig,
  type CapabilityDeps,
} from "./useAssistantCapability";

const CONFIG: AssistantServerConfig = {
  aiEnabled: true,
  rbacEnabled: true,
  persistence: true,
  publicLinks: true,
  publicMaxExpiryDays: 30,
  rcaEnabled: false,
};

interface Setup {
  config?: AssistantServerConfig | null;
  edition?: { isEnterprise: boolean; isCloud: boolean };
  role?: string | null;
  isOrgAdmin?: boolean;
  probe?: Tri | (() => Promise<Tri>);
  b06?: AssistantCapabilitiesResponse | null;
  identity?: boolean;
}

const handles: AssistantCapabilityHandle[] = [];

afterEach(() => {
  handles.splice(0).forEach((h) => h.dispose());
  sessionStorage.clear();
});

function setup(options: Setup = {}) {
  const config = ref<AssistantServerConfig | null>(
    options.config === undefined ? { ...CONFIG } : options.config,
  );
  const edition = ref(options.edition ?? { isEnterprise: true, isCloud: false });
  const role = ref<string | null>(options.role === undefined ? "admin" : options.role);
  const isOrgAdmin = ref<boolean | undefined>(options.isOrgAdmin);
  const b06 = { current: options.b06 ?? null };
  const listeners: ((data: AssistantCapabilitiesResponse | null) => void)[] = [];
  const probe = vi.fn((_org: string) => {
    const answer = options.probe ?? "yes";
    return typeof answer === "function" ? answer() : Promise.resolve(answer);
  });
  const deps: CapabilityDeps = {
    getConfig: () => config.value,
    getEdition: () => edition.value,
    getRole: () => role.value,
    isOrgAdmin: () => isOrgAdmin.value,
    probe,
    watchCapabilities: vi.fn((_org, onResult) => {
      listeners.push(onResult);
      queueMicrotask(() => onResult(b06.current));
      return () => listeners.splice(listeners.indexOf(onResult), 1);
    }),
    invalidateCapabilities: vi.fn(),
    storage: () => sessionStorage,
  };
  const handle = createAssistantCapability(deps);
  handles.push(handle);
  if (options.identity !== false) handle.setIdentity({ userOrgKey: "k1", org: "org1" });
  const emitB06 = (data: AssistantCapabilitiesResponse | null) => listeners.forEach((l) => l(data));
  return { handle, deps, probe, config, role, isOrgAdmin, emitB06 };
}

const cap = (handle: AssistantCapabilityHandle) => handle.capability.value;

describe("gate order (10 §5)", () => {
  it("stays loading until /config resolves and the user+org is known", async () => {
    const { handle, config } = setup({ config: null });
    await flushPromises();
    expect(handle.gate.value).toBe("loading");
    config.value = { ...CONFIG };
    await flushPromises();
    expect(handle.gate.value).toBe("available");
    expect(setup({ identity: false }).handle.gate.value).toBe("loading");
  });

  it("is not_entitled on OSS (G0) and never asks B-06 there", async () => {
    const { handle, deps } = setup({ edition: { isEnterprise: false, isCloud: false } });
    await flushPromises();
    expect(handle.gate.value).toBe("not_entitled");
    expect(cap(handle).edition).toBe("oss");
    expect(deps.watchCapabilities).not.toHaveBeenCalled();
  });

  it("is entitled on Cloud and enterprise", async () => {
    const cloud = setup({ edition: { isEnterprise: false, isCloud: true } });
    await flushPromises();
    expect(cloud.handle.gate.value).toBe("available");
    expect(cap(cloud.handle).edition).toBe("cloud");
  });

  it("is not_configured when ai_enabled is off (G1)", async () => {
    const { handle, probe } = setup({ config: { ...CONFIG, aiEnabled: false }, role: "viewer" });
    await flushPromises();
    expect(handle.gate.value).toBe("not_configured");
    expect(probe).not.toHaveBeenCalled();
  });

  it("is unhealthy after an agent_unavailable and available again after an admitted turn", async () => {
    const { handle } = setup();
    await flushPromises();
    handle.noteAgentUnavailable();
    expect(handle.gate.value).toBe("unhealthy");
    expect(cap(handle).health).toBe("down");
    expect(handle.assistantCanChat.value).toBe(true);
    handle.noteAdmitted();
    expect(handle.gate.value).toBe("available");
    expect(cap(handle).health).toBe("ok");
  });

  it("is no_permission once canChat is no (G2), with the chord predicate off", async () => {
    const { handle } = setup();
    await flushPromises();
    handle.noteForbidden();
    expect(handle.gate.value).toBe("no_permission");
    expect(handle.assistantCanChat.value).toBe(false);
  });

  it("names local-only (G5) and no-share (G3) as reasons under available", async () => {
    const local = setup({ config: { ...CONFIG, persistence: false } });
    const noShare = setup({ isOrgAdmin: false, role: "editor" });
    await flushPromises();
    expect(cap(local.handle)).toMatchObject({ gate: "available", reasonCode: "local_only" });
    expect(cap(noShare.handle)).toMatchObject({ canShare: "no", reasonCode: "no_share" });
  });

  it("allows the chord only on available and unhealthy", async () => {
    const oss = setup({ edition: { isEnterprise: false, isCloud: false } });
    const off = setup({ config: { ...CONFIG, aiEnabled: false } });
    const loading = setup({ config: null });
    const ok = setup();
    await flushPromises();
    expect(oss.handle.assistantCanChat.value).toBe(false);
    expect(off.handle.assistantCanChat.value).toBe(false);
    expect(loading.handle.assistantCanChat.value).toBe(false);
    expect(ok.handle.assistantCanChat.value).toBe(true);
  });
});

describe("access without B-06 (00 §9)", () => {
  it("says yes from config with RBAC off and never probes", async () => {
    const { handle, probe } = setup({ config: { ...CONFIG, rbacEnabled: false }, role: "viewer" });
    await flushPromises();
    expect(cap(handle)).toMatchObject({ canChat: "yes", canShare: "yes", source: "config" });
    expect(probe).not.toHaveBeenCalled();
  });

  it.each(["admin", "root", "editor", "Admin"])(
    "presumes %s can chat without a probe",
    async (role) => {
      const { handle, probe } = setup({ role });
      await flushPromises();
      expect(cap(handle)).toMatchObject({ canChat: "yes", source: "heuristic" });
      expect(probe).not.toHaveBeenCalled();
    },
  );

  it.each(["viewer", "user", "sre-oncall", null])(
    "probes once for role %s and renders available with the notice meanwhile",
    async (role) => {
      let answer!: (t: Tri) => void;
      const { handle, probe } = setup({ role, probe: () => new Promise((r) => (answer = r)) });
      await flushPromises();
      expect(probe).toHaveBeenCalledTimes(1);
      expect(probe).toHaveBeenCalledWith("org1");
      expect(cap(handle)).toMatchObject({ gate: "available", canChat: "unknown" });
      expect(handle.unknownNotice.value).toBe(true);
      answer("yes");
      await flushPromises();
      expect(cap(handle)).toMatchObject({ canChat: "yes", source: "probe" });
      expect(handle.unknownNotice.value).toBe(false);
    },
  );

  it("locks on a probe 403 with source probe", async () => {
    const { handle } = setup({ role: "viewer", probe: "no" });
    await flushPromises();
    expect(cap(handle)).toMatchObject({ gate: "no_permission", canChat: "no", source: "probe" });
  });

  it("stays unknown with the notice, never locked, when the probe cannot settle", async () => {
    const { handle } = setup({ role: "viewer", probe: "unknown" });
    await flushPromises();
    expect(cap(handle)).toMatchObject({ gate: "available", canChat: "unknown" });
    expect(handle.unknownNotice.value).toBe(true);
  });

  it("lets the first real send settle an unknown", async () => {
    const admitted = setup({ role: "viewer", probe: "unknown" });
    const refused = setup({ role: "user", probe: "unknown" });
    await flushPromises();
    admitted.handle.noteAdmitted();
    refused.handle.noteForbidden();
    expect(cap(admitted.handle).canChat).toBe("yes");
    expect(cap(refused.handle)).toMatchObject({ canChat: "no", gate: "no_permission" });
  });

  it("probes once per user+org per browser session", async () => {
    const first = setup({ role: "viewer", probe: "yes" });
    await flushPromises();
    expect(first.probe).toHaveBeenCalledTimes(1);
    const reload = setup({ role: "viewer", probe: "no" });
    await flushPromises();
    expect(reload.probe).not.toHaveBeenCalled();
    expect(cap(reload.handle)).toMatchObject({ canChat: "yes", source: "probe" });
  });

  it("flips a heuristic yes to no on a 403 and keeps it for the session", async () => {
    const { handle } = setup({ role: "editor" });
    await flushPromises();
    handle.noteForbidden();
    expect(cap(handle)).toMatchObject({ canChat: "no", source: "cached_403" });
    const reload = setup({ role: "editor" });
    await flushPromises();
    expect(cap(reload.handle)).toMatchObject({ canChat: "no", source: "cached_403" });
    expect(sessionStorage.getItem("o2.assistant.denied:k1")).toContain("no");
  });
});

describe("B-06 capabilities", () => {
  it("overrides the heuristic and the cached denial", async () => {
    const admin = setup({ b06: { can_chat: false, can_share: false } });
    await flushPromises();
    expect(cap(admin.handle)).toMatchObject({
      canChat: "no",
      canShare: "no",
      source: "capabilities",
    });
    admin.handle.noteForbidden();
    const viewer = setup({ role: "viewer", b06: { can_chat: true, retention_days: 7 } });
    await flushPromises();
    expect(cap(viewer.handle)).toMatchObject({
      canChat: "yes",
      source: "capabilities",
      retentionDays: 7,
    });
    expect(viewer.probe).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("o2.assistant.denied:k1")).toBeNull();
  });

  it("keeps the last good values when a later read fails", async () => {
    const { handle, emitB06 } = setup({ role: "viewer", b06: { can_chat: true } });
    await flushPromises();
    emitB06(null);
    expect(cap(handle)).toMatchObject({ canChat: "yes", source: "capabilities" });
  });

  it("reads health from B-06", async () => {
    const { handle } = setup({ b06: { can_chat: true, health: { status: "down" } } });
    await flushPromises();
    expect(handle.gate.value).toBe("unhealthy");
  });

  it("probes only after B-06 answered absent", async () => {
    const { probe, emitB06, deps } = setup({ role: "viewer" });
    expect(probe).not.toHaveBeenCalled();
    await flushPromises();
    expect(deps.watchCapabilities).toHaveBeenCalledWith("org1", expect.any(Function));
    emitB06(null);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("org switch", () => {
  it("recomputes from scratch: the old org's denial is not applied", async () => {
    const { handle, deps } = setup({ role: "editor" });
    await flushPromises();
    handle.noteForbidden();
    handle.setIdentity({ userOrgKey: "k2", org: "org2" });
    await flushPromises();
    expect(cap(handle)).toMatchObject({ canChat: "yes", source: "heuristic" });
    expect(deps.invalidateCapabilities).toHaveBeenLastCalledWith("org2");
    handle.setIdentity({ userOrgKey: "k1", org: "org1" });
    await flushPromises();
    expect(cap(handle).canChat).toBe("no");
  });

  it("drops a probe answer that arrives after the switch", async () => {
    let answer!: (t: Tri) => void;
    const { handle } = setup({ role: "viewer", probe: () => new Promise((r) => (answer = r)) });
    await flushPromises();
    handle.setIdentity({ userOrgKey: "k2", org: "org2" });
    answer("no");
    await flushPromises();
    expect(sessionStorage.getItem("o2.assistant.denied:k2")).toBeNull();
    expect(sessionStorage.getItem("o2.assistant.denied:k1")).toBeNull();
  });
});
