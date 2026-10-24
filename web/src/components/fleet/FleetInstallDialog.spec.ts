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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import fleet from "@/services/fleet";
import FleetInstallDialog from "./FleetInstallDialog.vue";
import FleetInstallCommand from "./FleetInstallCommand.vue";
import { queryClient } from "@/composables/query/queryClient";
import { fleetKeys } from "@/services/fleet.querykeys";
import {
  clearHeldTokenSecrets,
  heldTokenSecret,
  holdTokenSecret,
  secretsEpoch,
} from "./fleetTokenSecrets";

vi.mock("@/aws-exports", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { default: { ...actual.default, isEnterprise: "false", isCloud: "false" } };
});

vi.mock("@/services/fleet", () => ({
  default: {
    listCollectors: vi.fn(),
    getCollector: vi.fn(),
    summary: vi.fn(),
    listTokens: vi.fn(),
    createToken: vi.fn(),
    listFleets: vi.fn(),
  },
}));

const apiFleet = (id: string, name: string, stable: [string, number] | null) => {
  const version = stable ? { config: stable[0], version: stable[1] } : null;
  return {
    id,
    name,
    state: {
      desired: version,
      stable: version,
      revision: null,
      collectors: 1,
      online: 1,
      at_desired: 1,
    },
  };
};

const DAY = 86_400_000;

const token = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  name: "k8s-helm",
  prefix: "o2ft_Qm7x",
  created_at: Date.now() - DAY,
  expires_at: null,
  uses: 0,
  max_uses: null,
  fleet: { id: "f1", name: "edge" },
  revoked: false,
  ...over,
});

const collector = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  name: "node-a",
  hostname: null,
  last_connected_from: null,
  status: "online",
  os: "linux",
  arch: "amd64",
  distribution: null,
  version: null,
  outdated: false,
  config: null,
  config_version: null,
  delivery: null,
  delivery_error: null,
  fleet: { id: "f1", name: "edge" },
  token_id: "t1",
  last_seen: Date.now(),
  enrolled_at: Date.now() - DAY,
  ...over,
});

const ODialogStub = {
  name: "ODialog",
  props: ["open", "title"],
  template: '<div v-if="open" data-test="fleet-install-dialog"><slot /></div>',
};

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/", name: "fleet", component: { template: "<div />" } }],
});

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(FleetInstallDialog, {
    props: { open: true, fleetId: "f1", ...props },
    global: {
      plugins: [i18n, router, store],
      stubs: { ODialog: ODialogStub, FleetCodeEditor: true },
    },
  });
}

const commandToken = (w: VueWrapper) => w.findComponent(FleetInstallCommand).props("token");
const tokenOptions = (w: VueWrapper) =>
  (w.findComponent('[data-test="fleet-install-dialog-token"]').props("options") as any[]).map(
    (o) => o.value,
  );

describe("FleetInstallDialog", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    clearHeldTokenSecrets();
    vi.mocked(fleet.summary).mockResolvedValue({ data: { target_version: "0.162.0" } } as any);
    vi.mocked(fleet.listTokens).mockResolvedValue({
      data: {
        items: [
          token(),
          token({ id: "t2", name: "old", expires_at: Date.now() - DAY }),
          token({ id: "t3", name: "leaked", revoked: true }),
          token({ id: "t4", name: "edge-2" }),
          token({ id: "t5", name: "full", uses: 3, max_uses: 3 }),
          token({ id: "t6", name: "elsewhere", fleet: { id: "default", name: "default" } }),
        ],
      },
    } as any);
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: { total: 1, items: [collector()] },
    } as any);
    vi.mocked(fleet.listFleets).mockResolvedValue({
      data: {
        items: [apiFleet("default", "default", null), apiFleet("f1", "edge", ["edge-config", 3])],
      },
    } as any);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("offers only this fleet's active tokens, not revoked, expired, exhausted or other fleets' ones", async () => {
    wrapper = mountDialog();
    await flushPromises();
    expect(tokenOptions(wrapper)).toEqual(["t1", "t4"]);
  });

  it("fills the command from a token's stored value", async () => {
    vi.mocked(fleet.listTokens).mockResolvedValue({
      data: { items: [token({ id: "t7", name: "stored", token: "o2ft_stored_value" })] },
    } as any);
    wrapper = mountDialog();
    await flushPromises();
    expect(commandToken(wrapper)).toBe("o2ft_stored_value");
    expect(wrapper.find('[data-test="fleet-install-dialog-placeholder-hint"]').exists()).toBe(
      false,
    );
  });

  it("uses a <TOKEN> placeholder when the token's value is no longer held", async () => {
    wrapper = mountDialog();
    await flushPromises();
    expect(commandToken(wrapper)).toBe("<TOKEN>");
    expect(wrapper.find('[data-test="fleet-install-dialog-placeholder-hint"]').exists()).toBe(true);
  });

  it("says tokens work like API keys and to keep credentials in ${env:VAR} references", async () => {
    wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-install-dialog-security-note"]').text()).toBe(
      "Fleet tokens work like API keys. Anyone with a token can enroll collectors and send data to this organization, so keep tokens secret and revoke any that leak. Use ${env:VAR} references for credentials in configurations, so secrets stay on the host.",
    );
  });

  it("embeds the plaintext of a token created in this session", async () => {
    holdTokenSecret(
      store.state.selectedOrganization.identifier,
      "t1",
      "o2ft_plaintext",
      secretsEpoch(),
    );
    wrapper = mountDialog();
    await flushPromises();
    expect(commandToken(wrapper)).toBe("o2ft_plaintext");
    expect(wrapper.find('[data-test="fleet-install-dialog-placeholder-hint"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="fleet-install-dialog-copy-once"]').exists()).toBe(false);
  });

  it("preselects the newest held token over the first active one", async () => {
    holdTokenSecret(store.state.selectedOrganization.identifier, "t4", "o2ft_edge", secretsEpoch());
    wrapper = mountDialog();
    await flushPromises();
    expect(commandToken(wrapper)).toBe("o2ft_edge");
  });

  it("does not count a collector already bound to the token when the dialog opened", async () => {
    wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-install-dialog-waiting"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-install-dialog-connected"]').exists()).toBe(false);
  });

  it("announces the waiting and connected states to screen readers", async () => {
    wrapper = mountDialog();
    await flushPromises();
    const live = wrapper.find('[data-test="fleet-install-dialog-status"]');
    expect(live.attributes("aria-live")).toBe("polite");
    expect(live.find('[data-test="fleet-install-dialog-waiting"]').exists()).toBe(true);
  });

  const pollWith = async (items: unknown[]) => {
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: { total: items.length, items },
    } as any);
    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();
  };

  it("polls until a new collector binds to the token, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wrapper = mountDialog();
    await flushPromises();
    const calls = vi.mocked(fleet.listCollectors).mock.calls.length;
    await pollWith([
      collector(),
      collector({ id: "c2", name: "other", token_id: "t4" }),
      collector({ id: "c3", name: "node-new" }),
    ]);
    expect(vi.mocked(fleet.listCollectors).mock.calls.length).toBeGreaterThan(calls);
    expect(wrapper.find('[data-test="fleet-install-dialog-connected"]').text()).toContain(
      "node-new",
    );
    const after = vi.mocked(fleet.listCollectors).mock.calls.length;
    await vi.advanceTimersByTimeAsync(15000);
    await flushPromises();
    expect(vi.mocked(fleet.listCollectors).mock.calls.length).toBe(after);
  });

  it("detects a collector that switches to the token although its enrolled_at is old", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: {
        total: 2,
        items: [collector(), collector({ id: "c7", name: "moved", token_id: "t4" })],
      },
    } as any);
    wrapper = mountDialog();
    await flushPromises();
    await pollWith([collector(), collector({ id: "c7", name: "moved", token_id: "t1" })]);
    expect(wrapper.find('[data-test="fleet-install-dialog-connected"]').text()).toContain("moved");
  });

  it("opens the new collector in this fleet's collectors from View collectors", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await router.push({ path: "/", query: { org_identifier: "acme", fleet: "f9" } });
    wrapper = mountDialog();
    await flushPromises();
    await pollWith([collector(), collector({ id: "c3", name: "node-new" })]);
    await wrapper.find('[data-test="fleet-install-dialog-view-collectors"]').trigger("click");
    await flushPromises();
    expect(wrapper.emitted("update:open")).toEqual([[false]]);
    expect(router.currentRoute.value.query).toEqual({
      org_identifier: "acme",
      tab: "fleets",
      fleet: "f1",
      collector: "c3",
    });
  });

  it("does not depend on the browser clock agreeing with the server", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wrapper = mountDialog();
    await flushPromises();
    await pollWith([
      collector(),
      collector({ id: "c8", name: "skewed", enrolled_at: Date.now() - 10 * 60_000 }),
    ]);
    expect(wrapper.find('[data-test="fleet-install-dialog-connected"]').text()).toContain("skewed");
  });

  it("takes a new snapshot when the selected token changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: { total: 2, items: [collector(), collector({ id: "c2", token_id: "t4" })] },
    } as any);
    wrapper = mountDialog();
    await flushPromises();
    (wrapper.vm as any).selectedId = "t4";
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-install-dialog-connected"]').exists()).toBe(false);
  });

  it("does not poll while no token is selected", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fleet.listTokens).mockResolvedValue({ data: { items: [] } } as any);
    wrapper = mountDialog();
    await flushPromises();
    const calls = vi.mocked(fleet.listCollectors).mock.calls.length;
    await vi.advanceTimersByTimeAsync(15000);
    await flushPromises();
    expect(vi.mocked(fleet.listCollectors).mock.calls.length).toBe(calls);
  });

  it("stops polling once closed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    wrapper = mountDialog();
    await flushPromises();
    await wrapper.setProps({ open: false });
    await flushPromises();
    const calls = vi.mocked(fleet.listCollectors).mock.calls.length;
    await vi.advanceTimersByTimeAsync(15000);
    await flushPromises();
    expect(vi.mocked(fleet.listCollectors).mock.calls.length).toBe(calls);
  });

  it("has no configuration select", async () => {
    wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-install-dialog-config"]').exists()).toBe(false);
    expect(wrapper.findComponent(FleetInstallCommand).props()).not.toHaveProperty("initialConfig");
  });

  it("says which fleet the token's collectors join and the stable version they run", async () => {
    wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-install-dialog-fleet"]').text()).toBe(
      "Collectors installed with this token join fleet edge and run edge-config v3.",
    );
  });

  it("says the fleet has no configuration yet when it has no stable version", async () => {
    wrapper = mountDialog({ fleetId: "default" });
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-install-dialog-fleet"]').text()).toBe(
      "Collectors installed with this token join fleet default, which has no configuration yet.",
    );
  });

  const org = () => store.state.selectedOrganization.identifier;

  it("takes its baseline from a fresh read, not a cached list", async () => {
    queryClient.setQueryData(fleetKeys.collectors(org()), [collector()]);
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: { total: 2, items: [collector(), collector({ id: "c3", name: "already-here" })] },
    } as any);
    wrapper = mountDialog();
    await flushPromises();
    expect(fleet.listCollectors).toHaveBeenCalled();
    expect(wrapper.find('[data-test="fleet-install-dialog-connected"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-install-dialog-waiting"]').exists()).toBe(true);
  });

  it("shows the command but not 'waiting' until the fresh read lands", async () => {
    vi.mocked(fleet.listCollectors).mockReturnValue(new Promise(() => {}) as any);
    wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.findComponent(FleetInstallCommand).exists()).toBe(true);
    expect(wrapper.find('[data-test="fleet-install-dialog-waiting"]').exists()).toBe(false);
  });

  it("offers to create a token for this fleet in place when it has none, and no command", async () => {
    wrapper = mountDialog({ fleetId: "empty" });
    await flushPromises();
    const state = wrapper.find('[data-test="fleet-install-dialog-no-token"]');
    expect(state.exists()).toBe(true);
    expect(state.find('[data-test="fleet-install-dialog-security-note"]').text()).toContain(
      "Use ${env:VAR} references",
    );
    expect(state.find('[data-test="fleet-token-form"]').exists()).toBe(true);
    expect(state.find('[data-test="fleet-token-form-fleet"]').exists()).toBe(false);
    expect(wrapper.findComponent(FleetInstallCommand).exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-install-dialog-waiting"]').exists()).toBe(false);
  });

  it("creates the fleet's token in place, then selects it with its value in the command", async () => {
    vi.mocked(fleet.createToken).mockResolvedValue({
      data: {
        ...token({ id: "t9", name: "new", fleet: { id: "empty", name: "empty" } }),
        token: "o2ft_fresh",
      },
    } as any);
    wrapper = mountDialog({ fleetId: "empty" });
    await flushPromises();
    vi.mocked(fleet.listTokens).mockResolvedValue({
      data: { items: [token({ id: "t9", name: "new", fleet: { id: "empty", name: "empty" } })] },
    } as any);
    const form = (wrapper.findComponent({ name: "OForm" }).vm as any).form;
    form.setFieldValue("name", "new");
    await wrapper.find("form").trigger("submit");
    await vi.waitFor(() => expect(fleet.createToken).toHaveBeenCalled());
    await vi.waitFor(async () => {
      await flushPromises();
      expect(wrapper.findComponent(FleetInstallCommand).exists()).toBe(true);
    });
    expect(vi.mocked(fleet.createToken).mock.calls[0][1]).toMatchObject({
      name: "new",
      fleet: "empty",
    });
    expect(tokenOptions(wrapper)).toEqual(["t9"]);
    expect(commandToken(wrapper)).toBe("o2ft_fresh");
    expect(wrapper.find('[data-test="fleet-install-dialog-token-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-install-dialog-copy-once"]').text()).toContain(
      "Collectors enroll with this token",
    );
  });

  it("keeps a create started for one fleet out of another fleet's dialog", async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(fleet.createToken).mockReturnValue(new Promise((r) => (resolve = r)) as any);
    wrapper = mountDialog({ fleetId: "empty" });
    await flushPromises();
    const form = (wrapper.findComponent({ name: "OForm" }).vm as any).form;
    form.setFieldValue("name", "new");
    await wrapper.find("form").trigger("submit");
    await vi.waitFor(() => expect(fleet.createToken).toHaveBeenCalled());
    await wrapper.setProps({ fleetId: "empty-2" });
    resolve({
      data: {
        ...token({ id: "t9", name: "new", fleet: { id: "empty", name: "empty" } }),
        token: "o2ft_fresh",
      },
    });
    await flushPromises();
    expect(vi.mocked(fleet.createToken).mock.calls[0][1]).toMatchObject({ fleet: "empty" });
    expect(wrapper.find('[data-test="fleet-install-dialog-token-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-install-dialog-no-token"]').exists()).toBe(true);
    expect(wrapper.findComponent(FleetInstallCommand).exists()).toBe(false);
    expect(heldTokenSecret(store.state.selectedOrganization.identifier, "t9")).toBe("o2ft_fresh");
  });

  it("shows the load error, not a spinner or a second form, when the read after a create fails", async () => {
    const fresh = token({ id: "t9", name: "new", fleet: { id: "empty", name: "empty" } });
    vi.mocked(fleet.createToken).mockResolvedValue({
      data: { ...fresh, token: "o2ft_fresh" },
    } as any);
    wrapper = mountDialog({ fleetId: "empty" });
    await flushPromises();
    vi.mocked(fleet.listTokens).mockRejectedValue({ response: { status: 500 } });
    const form = (wrapper.findComponent({ name: "OForm" }).vm as any).form;
    form.setFieldValue("name", "new");
    await wrapper.find("form").trigger("submit");
    await vi.waitFor(() => expect(fleet.createToken).toHaveBeenCalled());
    const error = '[data-test="fleet-install-dialog-tokens-error"]';
    await vi.waitFor(
      async () => {
        await flushPromises();
        expect(wrapper.find(error).exists()).toBe(true);
      },
      { timeout: 8000 },
    );
    expect(wrapper.find('[data-test="fleet-install-dialog-token-pending"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-token-form"]').exists()).toBe(false);
    vi.mocked(fleet.listTokens).mockResolvedValue({ data: { items: [fresh] } } as any);
    wrapper.find(error).findComponent({ name: "OEmptyState" }).vm.$emit("action", "retry");
    await vi.waitFor(async () => {
      await flushPromises();
      expect(commandToken(wrapper)).toBe("o2ft_fresh");
    });
  });

  it.each([
    [{ response: { status: 403 } }, "fleet-install-dialog-tokens-forbidden"],
    [{ response: { status: 500 } }, "fleet-install-dialog-tokens-error"],
  ])("shows the token list failure instead of a command (%j)", async (err, testId) => {
    vi.mocked(fleet.listTokens).mockRejectedValue(err);
    wrapper = mountDialog();
    await vi.waitFor(
      async () => {
        await flushPromises();
        expect(wrapper.find(`[data-test="${testId}"]`).exists()).toBe(true);
      },
      { timeout: 8000 },
    );
    expect(wrapper.findComponent(FleetInstallCommand).exists()).toBe(false);
  });

  it("stops polling and shows no-access when the collector list is forbidden", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(fleet.listCollectors).mockRejectedValue({ response: { status: 403 } });
    wrapper = mountDialog();
    await flushPromises();
    expect(wrapper.find('[data-test="fleet-install-dialog-collectors-forbidden"]').exists()).toBe(
      true,
    );
    const calls = vi.mocked(fleet.listCollectors).mock.calls.length;
    await vi.advanceTimersByTimeAsync(15000);
    await flushPromises();
    expect(vi.mocked(fleet.listCollectors).mock.calls.length).toBe(calls);
    expect(wrapper.find('[data-test="fleet-install-dialog-waiting"]').exists()).toBe(false);
  });

  it("offers everyone the way to create a token", async () => {
    wrapper = mountDialog({ fleetId: "empty" });
    await flushPromises();
    const state = wrapper.find('[data-test="fleet-install-dialog-no-token"]');
    expect(state.find('[data-test="fleet-token-form-submit"]').exists()).toBe(true);
    expect(state.text()).not.toContain("administrator");
  });

  it("refreshes the collectors list and summary when the collector connects and on close", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    try {
      wrapper = mountDialog();
      await flushPromises();
      expect(spy).not.toHaveBeenCalledWith({ queryKey: fleetKeys.collectors(org()) });
      await pollWith([collector(), collector({ id: "c3", name: "node-new" })]);
      expect(spy).toHaveBeenCalledWith({ queryKey: fleetKeys.collectors(org()) });
      expect(spy).toHaveBeenCalledWith({ queryKey: fleetKeys.summary(org()) });
      spy.mockClear();
      await wrapper.setProps({ open: false });
      await flushPromises();
      expect(spy).toHaveBeenCalledWith({ queryKey: fleetKeys.collectors(org()) });
      expect(spy).toHaveBeenCalledWith({ queryKey: fleetKeys.summary(org()) });
    } finally {
      spy.mockRestore();
    }
  });
});
