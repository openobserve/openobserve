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
import { flushPromises, mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import type { SyntheticLocationAgent } from "@/types/synthetics";

vi.mock("@/services/synthetics", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: {
      ...actual.default,
      listAgentTokens: vi.fn(),
      viewAgentToken: vi.fn(),
      createAgentToken: vi.fn(),
    },
  };
});

vi.mock("@/services/users", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { ...actual.default, orgUsers: vi.fn() } };
});

import AgentSetupDrawer from "./AgentSetupDrawer.vue";
import users from "@/services/users";

// Native login leaves `currentuser.role` empty, so the role comes from the org's user list.
const asRole = (role: string) =>
  vi.mocked(users.orgUsers).mockResolvedValue({
    data: { data: [{ email: "example@gmail.com", role }] },
  } as any);
import syntheticsService from "@/services/synthetics";

const agent = (over: Partial<SyntheticLocationAgent>): SyntheticLocationAgent => ({
  id: "a1",
  name: "agent-eu-1",
  version: "2.1.0",
  last_seen_at: 0,
  created_at: 0,
  live: true,
  runner_contract: 1,
  ...over,
});

const mountDrawer = (agents: SyntheticLocationAgent[] = []) =>
  mount(AgentSetupDrawer, {
    props: {
      open: true,
      scriptUrl: "https://example.test/install.sh",
      o2Url: "https://acme.openobserve.ai",
      org: "default",
      locationId: "loc1",
      agents,
      minRunnerVersion: "2.0.0",
      leaseDeadlineUs: Date.UTC(2026, 11, 3, 12) * 1000,
    },
    global: {
      plugins: [i18n, store],
      stubs: { ODrawer: { template: "<div><slot /></div>" } },
    },
  });

describe("AgentSetupDrawer (J14, S1, S2)", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    store.state.currentuser.role = "";
    vi.mocked(syntheticsService.listAgentTokens).mockResolvedValue({
      data: { tokens: [{ name: "agent-token eu-1", enabled: true }] },
    } as any);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells a folder editor to ask an org admin, and never lists tokens", async () => {
    asRole("editor");
    const w = mountDrawer();
    await flushPromises();
    expect(w.find("[data-test='synthetics-agent-setup-ask-admin']").text()).toContain(
      "Ask an org admin for an agent token",
    );
    expect(w.find("[data-test='synthetics-agent-setup-token-insert']").exists()).toBe(false);
    expect(syntheticsService.listAgentTokens).not.toHaveBeenCalled();
    expect(w.find("[data-test='synthetics-agent-setup-install-cmd']").text()).toContain(
      "<o2syn-token>",
    );
  });

  it("lets an org admin insert a token for 30 seconds", async () => {
    asRole("admin");
    vi.mocked(syntheticsService.viewAgentToken).mockResolvedValue({
      data: { token: "o2syn_abc" },
    } as any);
    const w: any = mountDrawer();
    await flushPromises();
    expect(w.find("[data-test='synthetics-agent-setup-ask-admin']").exists()).toBe(false);
    vi.useFakeTimers();
    w.vm.$.setupState.tokenToInsert = "agent-token eu-1";
    await flushPromises();
    await w.find("[data-test='synthetics-agent-setup-insert-token']").trigger("click");
    await flushPromises();
    expect(syntheticsService.viewAgentToken).toHaveBeenCalledWith("default", "agent-token eu-1");
    expect(w.find("[data-test='synthetics-agent-setup-install-cmd']").text()).toContain(
      "o2syn_abc",
    );
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(w.find("[data-test='synthetics-agent-setup-install-cmd']").text()).not.toContain(
      "o2syn_abc",
    );
  });

  it("drops the viewed token from the mutation cache when it expires or the drawer closes", async () => {
    asRole("admin");
    vi.mocked(syntheticsService.viewAgentToken).mockResolvedValue({
      data: { token: "o2syn_abc" },
    } as any);
    const cached = () =>
      JSON.stringify(
        queryClient
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      );
    const w: any = mountDrawer();
    await flushPromises();
    vi.useFakeTimers();
    w.vm.$.setupState.tokenToInsert = "agent-token eu-1";
    await flushPromises();
    await w.find("[data-test='synthetics-agent-setup-insert-token']").trigger("click");
    await flushPromises();
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    vi.advanceTimersByTime(1);
    expect(cached()).not.toContain("o2syn_abc");

    await w.find("[data-test='synthetics-agent-setup-insert-token']").trigger("click");
    await flushPromises();
    await w.setProps({ open: false });
    await flushPromises();
    vi.advanceTimersByTime(1);
    expect(cached()).not.toContain("o2syn_abc");
    expect(w.vm.$.setupState.effectiveToken ?? "").not.toContain("o2syn_abc");
  });

  it("lists the tokens from the list route's {tokens} body", async () => {
    asRole("admin");
    const w: any = mountDrawer();
    await flushPromises();
    expect(w.vm.$.setupState.tokenOptions).toEqual([
      { label: "agent-token eu-1", value: "agent-token eu-1" },
    ]);
  });

  it("New token creates a token and fills the command for 30 seconds", async () => {
    asRole("admin");
    vi.mocked(syntheticsService.createAgentToken).mockResolvedValue({
      data: { name: "loc1-202611231530", token: "o2syn_new" },
    } as any);
    const w = mountDrawer();
    await flushPromises();
    vi.useFakeTimers();
    await w.find("[data-test='synthetics-agent-setup-new-token']").trigger("click");
    await flushPromises();
    expect(vi.mocked(syntheticsService.createAgentToken).mock.calls[0][1]).toMatch(/^loc1-\d{12}$/);
    const cmd = () => w.find("[data-test='synthetics-agent-setup-install-cmd']").text();
    expect(cmd()).toContain("o2syn_new");
    vi.advanceTimersByTime(30_000);
    await flushPromises();
    expect(cmd()).not.toContain("o2syn_new");
  });

  it("marks agents on pre-cutover tokens Rotate required", async () => {
    asRole("admin");
    const w = mountDrawer([
      agent({ token_name: "agent-token eu-1", token_pre_cutover: true }),
      agent({ id: "a2", name: "agent-us-2", token_pre_cutover: false }),
    ]);
    await flushPromises();
    const box = w.find("[data-test='synthetics-agent-setup-rotate-required']");
    expect(box.text()).toContain("agent-eu-1 · agent-token eu-1");
    expect(box.text()).toContain("Rotate required");
    expect(box.text()).not.toContain("agent-us-2");
  });

  it("lists old runners that will break (U6 banner)", async () => {
    asRole("editor");
    const w = mountDrawer([
      agent({ name: "private-eu-1", version: "1.8.2", runner_contract: 0 }),
      agent({ id: "a2", name: "private-us-2" }),
    ]);
    await flushPromises();
    const notice = w.find("[data-test='synthetics-old-runner-notice']").text();
    expect(notice).toContain("private-eu-1 (1.8.2) lacks runner_contract=1");
    expect(notice).toContain("Upgrade to 2.0.0 or later");
    expect(notice).toContain("by Dec 3, 2026");
    expect(notice).not.toContain("private-us-2");
  });

  it("hides the runner notice when setup has no enforced version", async () => {
    asRole("editor");
    const w = mountDrawer([agent({ runner_contract: 0 })]);
    await w.setProps({ minRunnerVersion: undefined });
    await flushPromises();
    expect(w.find("[data-test='synthetics-old-runner-notice']").exists()).toBe(false);
  });
});
