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
import OForm from "@/lib/forms/Form/OForm.vue";
import FleetTokens from "./FleetTokens.vue";
import FleetRevokeTokenDialog from "./FleetRevokeTokenDialog.vue";
import { apiCollector } from "./fleet.fixtures";
import { purgeAllQueries, purgeOrgQueries, queryClient } from "@/composables/query/queryClient";
import { heldTokenSecret, secretsEpoch } from "./fleetTokenSecrets";

const { confirmMock, toastMock } = vi.hoisted(() => ({ confirmMock: vi.fn(), toastMock: vi.fn() }));

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

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
    revokeToken: vi.fn(),
    unenrollCollector: vi.fn(),
  },
}));

vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

const DAY = 86_400_000;

const token = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  name: "k8s-helm",
  prefix: "o2ft_Qm7x",
  created_at: Date.now() - DAY,
  expires_at: null,
  uses: 5,
  max_uses: 20,
  fleet: { id: "f1", name: "edge" },
  revoked: false,
  ...over,
});

const tokens = [
  token(),
  token({ id: "t2", name: "old-batch", expires_at: Date.now() - DAY, max_uses: null }),
  token({ id: "t3", name: "leaked", revoked: true }),
  token({ id: "t4", name: "full", uses: 20, max_uses: 20 }),
  token({ id: "t5", name: "other-fleet", fleet: { id: "default", name: "default" } }),
  token({ id: "t6", name: "soon", expires_at: Date.now() + 2 * DAY }),
];

const DrawerStub = {
  name: "ODrawer",
  props: ["open", "title", "subTitle"],
  emits: ["update:open"],
  template:
    '<div v-if="open" data-test="fleet-tokens-drawer"><h2>{{ title }}</h2><span>{{ subTitle }}</span><slot /></div>',
};

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/", name: "fleet", component: { template: "<div />" } }],
});

// OTable holds its skeleton for a minimum time after loading ends.
const settle = async () => {
  await flushPromises();
  await new Promise((r) => setTimeout(r, 100));
  await flushPromises();
};

async function mountTokens(fleetId = "f1") {
  const wrapper = mount(FleetTokens, {
    attachTo: document.body,
    props: { open: true, fleetId, fleetName: "edge" },
    global: { plugins: [i18n, router, store], stubs: { ODrawer: DrawerStub } },
  });
  await settle();
  return wrapper;
}

const form = (w: VueWrapper) => (w.findComponent(OForm).vm as any).form;

async function openCreate(w: VueWrapper) {
  await w.find('[data-test="fleet-tokens-create"]').trigger("click");
  await flushPromises();
}

async function fillAndSubmit(w: VueWrapper, values: Record<string, unknown>) {
  await openCreate(w);
  for (const [k, v] of Object.entries(values)) form(w).setFieldValue(k, v);
  await submitForm(w);
}

// The real form submits asynchronously, so wait for the attempt to settle before asserting.
async function submitForm(w: VueWrapper) {
  const f = form(w);
  const attempts = f.state.submissionAttempts;
  await w.find("form").trigger("submit");
  await vi.waitFor(() => {
    expect(f.state.submissionAttempts).toBeGreaterThan(attempts);
    expect(f.state.isSubmitting).toBe(false);
  });
  await flushPromises();
}

describe("FleetTokens", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(fleet.listTokens).mockResolvedValue({ data: { items: tokens } } as any);
    vi.mocked(fleet.listCollectors).mockResolvedValue({
      data: {
        total: 3,
        items: [
          apiCollector({ id: "c1", name: "web-01", token_id: "t1", status: "online" }),
          apiCollector({ id: "c2", name: "web-02", token_id: "t1", status: "offline" }),
          apiCollector({ id: "c3", name: "db-01", token_id: "t2", status: "online" }),
        ],
      },
    } as any);
    confirmMock.mockResolvedValue(true);
  });

  const revokeDialog = () => wrapper.findComponent(FleetRevokeTokenDialog);

  async function startRevoke(id = "t1") {
    await wrapper.find(`[data-test="fleet-tokens-revoke-${id}"]`).trigger("click");
    await flushPromises();
  }

  afterEach(() => {
    wrapper?.unmount();
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("lists only this fleet's tokens", async () => {
    wrapper = await mountTokens();
    expect(fleet.listTokens).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    const body = wrapper.find('[data-test="o2-table-body"]').text();
    expect(body).toContain("k8s-helm");
    expect(body).toContain("old-batch");
    expect(body).not.toContain("other-fleet");
    expect(wrapper.find("h2").text()).toBe("Tokens");
  });

  it("masks the token behind its prefix", async () => {
    wrapper = await mountTokens();
    const prefix = wrapper.find('[data-test="fleet-tokens-prefix-t1"]').text();
    expect(prefix.startsWith("o2ft_Qm7x")).toBe(true);
    expect(prefix.length).toBeGreaterThan("o2ft_Qm7x".length);
  });

  it("derives the state from revoked and expires_at", async () => {
    wrapper = await mountTokens();
    const state = (id: string) => wrapper.find(`[data-test="fleet-tokens-state-${id}"]`).text();
    expect(state("t1")).toBe("Active");
    expect(state("t2")).toBe("Expired");
    expect(state("t3")).toBe("Revoked");
    expect(state("t4")).toBe("Exhausted");
    expect(state("t6")).toBe("Expires soon");
    expect(wrapper.find('[data-test="fleet-tokens-expires-t6"]').classes()).toContain(
      "text-status-warning-text",
    );
    expect(wrapper.find('[data-test="fleet-tokens-expires-t1"]').exists()).toBe(false);
  });

  it("shows uses against the limit, or unlimited", async () => {
    wrapper = await mountTokens();
    expect(wrapper.find('[data-test="fleet-tokens-uses-t1"]').text()).toBe("5 of 20");
    expect(wrapper.find('[data-test="fleet-tokens-uses-t2"]').text()).toContain("unlimited");
  });

  it("says tokens work like API keys, in the list and the create form", async () => {
    wrapper = await mountTokens();
    const note = () => wrapper.find('[data-test="fleet-tokens-security-note"]');
    expect(note().text()).toBe(
      "Fleet tokens work like API keys. Anyone with a token can enroll collectors and send data to this organization, so keep tokens secret and revoke any that leak.",
    );
    await openCreate(wrapper);
    expect(wrapper.find('[data-test="fleet-token-form"]').exists()).toBe(true);
    expect(note().exists()).toBe(true);
  });

  it("has no labels column", async () => {
    wrapper = await mountTokens();
    expect(wrapper.text()).not.toContain("Labels");
  });

  it("filters by name case-insensitively", async () => {
    wrapper = await mountTokens();
    (wrapper.vm as any).search = "K8S";
    await settle();
    const body = wrapper.find('[data-test="o2-table-body"]').text();
    expect(body).toContain("k8s-helm");
    expect(body).not.toContain("old-batch");
  });

  it("shows the no-access state on a 403", async () => {
    vi.mocked(fleet.listTokens).mockRejectedValue({ response: { status: 403 } });
    wrapper = await mountTokens();
    expect(wrapper.text()).not.toContain("k8s-helm");
    expect(wrapper.findComponent({ name: "OTable" }).props("forbidden")).toBe(true);
  });

  it("refetches the tokens on refresh", async () => {
    wrapper = await mountTokens();
    expect(fleet.listTokens).toHaveBeenCalledTimes(1);
    await wrapper.find('[data-test="fleet-tokens-refresh"]').trigger("click");
    await settle();
    expect(fleet.listTokens).toHaveBeenCalledTimes(2);
  });

  it("shows enrollments and the collectors in use, split online and offline", async () => {
    wrapper = await mountTokens();
    expect(wrapper.find('[data-test="fleet-tokens-in-use-t1"]').text()).toBe("1 online, 1 offline");
    expect(wrapper.find('[data-test="fleet-tokens-in-use-t4"]').text()).toBe("—");
  });

  it("revokes from a dialog that lists the collectors using the token", async () => {
    vi.mocked(fleet.revokeToken).mockResolvedValue({ data: token({ revoked: true }) } as any);
    wrapper = await mountTokens();
    await startRevoke();
    expect(revokeDialog().props("open")).toBe(true);
    expect(
      revokeDialog()
        .props("affected")
        .map((c: { id: string }) => c.id),
    ).toEqual(["c1", "c2"]);
    expect(fleet.revokeToken).not.toHaveBeenCalled();
    revokeDialog().vm.$emit("confirm", revokeDialog().props("token"));
    await settle();
    expect(revokeDialog().props("open")).toBe(false);
    expect(fleet.revokeToken).toHaveBeenCalledWith(
      store.state.selectedOrganization.identifier,
      "t1",
    );
    expect(fleet.listTokens).toHaveBeenCalledTimes(2);
  });

  it("drops the shown value and the search when the fleet changes", async () => {
    vi.mocked(fleet.createToken).mockResolvedValue({
      data: { ...token({ id: "t9" }), token: "o2ft_shown" },
    } as any);
    wrapper = await mountTokens();
    (wrapper.vm as any).search = "k8s";
    await fillAndSubmit(wrapper, { name: "n" });
    expect(wrapper.find('[data-test="fleet-tokens-new-token"]').exists()).toBe(true);
    await wrapper.setProps({ fleetId: "default" });
    await settle();
    expect(wrapper.find('[data-test="fleet-tokens-new-token"]').exists()).toBe(false);
    expect((wrapper.vm as any).search).toBe("");
    expect(wrapper.find('[data-test="o2-table-body"]').text()).toContain("other-fleet");
  });

  it("shows the load error when a refresh fails and the cache holds only other fleets' tokens", async () => {
    vi.mocked(fleet.listTokens).mockResolvedValue({ data: { items: [tokens[4]] } } as any);
    wrapper = await mountTokens();
    expect(wrapper.find('[data-test="fleet-tokens-empty"]').exists()).toBe(true);
    vi.mocked(fleet.listTokens).mockRejectedValue(new Error("boom"));
    await wrapper.find('[data-test="fleet-tokens-refresh"]').trigger("click");
    await settle();
    expect(wrapper.find('[data-test="fleet-tokens-error"]').exists()).toBe(true);
  });

  it("does not revoke when the dialog is cancelled", async () => {
    wrapper = await mountTokens();
    await startRevoke();
    revokeDialog().vm.$emit("update:open", false);
    await settle();
    expect(revokeDialog().props("open")).toBe(false);
    expect(fleet.revokeToken).not.toHaveBeenCalled();
  });

  it("closes the shown plaintext when the org changes", async () => {
    const orgA = store.state.selectedOrganization;
    vi.mocked(fleet.createToken).mockResolvedValue({
      data: { ...token({ id: "t5" }), token: "o2ft_shown" },
    } as any);
    wrapper = await mountTokens();
    await fillAndSubmit(wrapper, { name: "n" });
    expect(wrapper.find('[data-test="fleet-tokens-new-token"]').exists()).toBe(true);
    store.commit("setSelectedOrganization", { ...orgA, identifier: "org-b" });
    await flushPromises();
    try {
      expect(wrapper.find('[data-test="fleet-tokens-new-token"]').exists()).toBe(false);
    } finally {
      store.commit("setSelectedOrganization", orgA);
    }
  });

  it("offers no revoke control on a token that is already revoked", async () => {
    wrapper = await mountTokens();
    expect(wrapper.find('[data-test="fleet-tokens-revoke-t3"]').exists()).toBe(false);
    for (const id of ["t1", "t2", "t4"]) {
      expect(wrapper.find(`[data-test="fleet-tokens-revoke-${id}"]`).exists()).toBe(true);
    }
  });

  it("still offers revoke for an expired token, whose collectors keep working", async () => {
    wrapper = await mountTokens();
    expect(
      wrapper.find('[data-test="fleet-tokens-revoke-t2"]').attributes("disabled"),
    ).toBeUndefined();
  });

  it("labels the icon-only revoke button for assistive tech", async () => {
    wrapper = await mountTokens();
    expect(wrapper.find('[data-test="fleet-tokens-revoke-t1"]').attributes("aria-label")).toBe(
      "Revoke",
    );
  });

  it("disables revoke while a revoke is in flight", async () => {
    vi.mocked(fleet.revokeToken).mockReturnValue(new Promise(() => {}) as any);
    wrapper = await mountTokens();
    await startRevoke();
    revokeDialog().vm.$emit("confirm", revokeDialog().props("token"));
    await flushPromises();
    expect(
      wrapper.find('[data-test="fleet-tokens-revoke-t2"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("shows the server's reason when a revoke is refused", async () => {
    vi.mocked(fleet.revokeToken).mockRejectedValue({
      response: {
        status: 403,
        data: { message: "Only organization administrators can manage enrollment" },
      },
    });
    wrapper = await mountTokens();
    await startRevoke();
    revokeDialog().vm.$emit("confirm", revokeDialog().props("token"));
    await settle();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "error",
        message: "Only organization administrators can manage enrollment",
      }),
    );
  });

  it("creates the token for this fleet, with no fleet or labels field", async () => {
    wrapper = await mountTokens();
    await openCreate(wrapper);
    expect(wrapper.find("h2").text()).toBe("New token");
    expect(wrapper.find('[data-test="fleet-token-form-fleet"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="fleet-token-form-labels"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o2-table-body"]').exists()).toBe(false);
  });

  it("goes back to the list without creating", async () => {
    wrapper = await mountTokens();
    await openCreate(wrapper);
    await wrapper.find('[data-test="fleet-tokens-back"]').trigger("click");
    await settle();
    expect(wrapper.find('[data-test="fleet-token-form"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o2-table-body"]').text()).toContain("k8s-helm");
    expect(fleet.createToken).not.toHaveBeenCalled();
  });

  it("creates a token from the form and shows the plaintext once", async () => {
    vi.mocked(fleet.createToken).mockResolvedValue({
      data: { ...token({ id: "t9", name: "edge" }), token: "o2ft_plaintext" },
    } as any);
    wrapper = await mountTokens();
    await fillAndSubmit(wrapper, { name: "  edge ", expiry: "30", maxUses: "10" });
    expect(fleet.createToken).toHaveBeenCalledWith(store.state.selectedOrganization.identifier, {
      name: "edge",
      expires_in_days: 30,
      max_uses: 10,
      fleet: "f1",
    });
    expect(wrapper.findComponent({ name: "OCodeBlock" }).props("code")).toBe("o2ft_plaintext");
    expect(heldTokenSecret(store.state.selectedOrganization.identifier, "t9")).toBe(
      "o2ft_plaintext",
    );
    expect(fleet.listTokens).toHaveBeenCalledTimes(2);
  });

  it("sends null for never-expiring and unlimited tokens", async () => {
    vi.mocked(fleet.createToken).mockResolvedValue({
      data: { ...token({ id: "t8" }), token: "o2ft_x" },
    } as any);
    wrapper = await mountTokens();
    await fillAndSubmit(wrapper, { name: "n", expiry: "never", maxUses: "" });
    expect(fleet.createToken).toHaveBeenCalledWith(expect.any(String), {
      name: "n",
      expires_in_days: null,
      max_uses: null,
      fleet: "f1",
    });
  });

  it.each([
    [{ name: "" }, "name"],
    [{ name: "n", maxUses: "0" }, "maxUses"],
    [{ name: "n", maxUses: "1.5" }, "maxUses"],
  ])("blocks an invalid form %j", async (values, field) => {
    wrapper = await mountTokens();
    await fillAndSubmit(wrapper, values);
    expect(fleet.createToken).not.toHaveBeenCalled();
    expect(form(wrapper).getFieldMeta(field).errors.length).toBeGreaterThan(0);
  });

  it.each([
    [409, "token name exists"],
    [400, "max_uses must be positive"],
    [403, "Unauthorized Access"],
  ])("shows the server's %s message and keeps the form filled", async (status, message) => {
    vi.mocked(fleet.createToken).mockRejectedValue({
      response: { status, data: { code: status, message } },
    });
    wrapper = await mountTokens();
    await fillAndSubmit(wrapper, { name: "dup" });
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "error", message }));
    expect(wrapper.findComponent({ name: "OCodeBlock" }).exists()).toBe(false);
    expect(form(wrapper).state.values.name).toBe("dup");
  });

  it("drops the plaintext from the mutation cache once it is held", async () => {
    vi.mocked(fleet.createToken).mockResolvedValue({
      data: { ...token({ id: "t7" }), token: "o2ft_cached" },
    } as any);
    wrapper = await mountTokens();
    await fillAndSubmit(wrapper, { name: "n" });
    await vi.waitFor(() =>
      expect(
        queryClient
          .getMutationCache()
          .getAll()
          .some((m: any) => m.state.data?.token),
      ).toBe(false),
    );
  });

  async function startPendingCreate() {
    let resolve!: (v: unknown) => void;
    vi.mocked(fleet.createToken).mockReturnValue(new Promise((r) => (resolve = r)) as any);
    wrapper = await mountTokens();
    await openCreate(wrapper);
    form(wrapper).setFieldValue("name", "n");
    await wrapper.find("form").trigger("submit");
    await vi.waitFor(() => expect(fleet.createToken).toHaveBeenCalled());
    return resolve;
  }

  it("does not hold a plaintext that arrives after an org switch", async () => {
    const orgA = store.state.selectedOrganization;
    const resolve = await startPendingCreate();
    const before = secretsEpoch();
    store.commit("setSelectedOrganization", { ...orgA, identifier: "org-b" });
    purgeOrgQueries(orgA.identifier, "org-b");
    await vi.waitFor(() => expect(secretsEpoch()).toBeGreaterThan(before));
    resolve({ data: { ...token({ id: "t6" }), token: "o2ft_a" } });
    await flushPromises();
    try {
      expect(heldTokenSecret(orgA.identifier, "t6")).toBeNull();
      expect(heldTokenSecret("org-b", "t6")).toBeNull();
      expect(wrapper.find('[data-test="fleet-tokens-new-token"]').exists()).toBe(false);
    } finally {
      store.commit("setSelectedOrganization", orgA);
    }
  });

  it("does not show a plaintext that arrives after the drawer closed", async () => {
    const resolve = await startPendingCreate();
    wrapper.findComponent(DrawerStub).vm.$emit("update:open", false);
    await wrapper.setProps({ open: false });
    resolve({ data: { ...token({ id: "t6" }), token: "o2ft_late" } });
    await flushPromises();
    expect((wrapper.vm as any).created).toBeNull();
    await wrapper.setProps({ open: true });
    await settle();
    expect(wrapper.find('[data-test="fleet-tokens-new-token"]').exists()).toBe(false);
  });

  it("does not hold a plaintext that arrives after a logout purge", async () => {
    const resolve = await startPendingCreate();
    const before = secretsEpoch();
    purgeAllQueries();
    await vi.waitFor(() => expect(secretsEpoch()).toBeGreaterThan(before));
    resolve({ data: { ...token({ id: "t8" }), token: "o2ft_late" } });
    await flushPromises();
    expect(heldTokenSecret(store.state.selectedOrganization.identifier, "t8")).toBeNull();
    expect(wrapper.find('[data-test="fleet-tokens-new-token"]').exists()).toBe(false);
  });

  it("offers revoke to everyone, leaving refusal to the server", async () => {
    wrapper = await mountTokens();
    const btn = wrapper.find('[data-test="fleet-tokens-revoke-t1"]');
    expect(btn.attributes("aria-disabled")).toBeUndefined();
    expect(btn.attributes("disabled")).toBeUndefined();
  });

  it("closes the revoke dialog when the org changes", async () => {
    const orgA = store.state.selectedOrganization;
    wrapper = await mountTokens();
    await startRevoke();
    store.commit("setSelectedOrganization", { ...orgA, identifier: "org-b" });
    await flushPromises();
    try {
      expect(revokeDialog().props("open")).toBe(false);
    } finally {
      store.commit("setSelectedOrganization", orgA);
    }
  });

  it("ends a successful create with Done back to the list, dropping the shown value", async () => {
    vi.mocked(fleet.createToken).mockResolvedValue({
      data: { ...token({ id: "t9" }), token: "o2ft_plaintext" },
    } as any);
    wrapper = await mountTokens();
    await fillAndSubmit(wrapper, { name: "edge" });
    expect(wrapper.find('[data-test="fleet-tokens-new-token"]').exists()).toBe(true);
    await wrapper.find('[data-test="fleet-tokens-done"]').trigger("click");
    await settle();
    expect(wrapper.find('[data-test="fleet-tokens-new-token"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o2-table-body"]').exists()).toBe(true);
  });

  it("drops the shown value when the drawer closes", async () => {
    vi.mocked(fleet.createToken).mockResolvedValue({
      data: { ...token({ id: "t9" }), token: "o2ft_plaintext" },
    } as any);
    wrapper = await mountTokens();
    await fillAndSubmit(wrapper, { name: "edge" });
    wrapper.findComponent(DrawerStub).vm.$emit("update:open", false);
    await flushPromises();
    expect(wrapper.emitted("update:open")?.at(-1)).toEqual([false]);
    expect((wrapper.vm as any).created).toBeNull();
  });

  it("labels the plaintext block in sentence case instead of an uppercased language tag", async () => {
    vi.mocked(fleet.createToken).mockResolvedValue({
      data: { ...token({ id: "t9" }), token: "o2ft_secretvalue" },
    } as any);
    wrapper = await mountTokens();
    await fillAndSubmit(wrapper, { name: "edge" });
    const block = wrapper.findComponent({ name: "OCodeBlock" });
    expect(block.props("chrome")).toBe("editor");
    expect(block.props("filename")).toBe("Enrollment token");
    expect(block.text()).not.toMatch(/plaintext/i);
  });

  it("closes the revoke dialog when the drawer's fleet changes", async () => {
    wrapper = await mountTokens();
    await startRevoke();
    await wrapper.setProps({ fleetId: "default" });
    await flushPromises();
    expect(revokeDialog().props("open")).toBe(false);
  });

  it("enables the destructive revoke only once the token's name is typed", async () => {
    wrapper = await mountTokens();
    await startRevoke();
    const dialog = revokeDialog().findComponent({ name: "ODialog" });
    expect(dialog.props("primaryButtonVariant")).toBe("destructive");
    expect(dialog.props("primaryButtonDisabled")).toBe(true);
    await revokeDialog()
      .findComponent({ name: "OInput" })
      .vm.$emit("update:modelValue", "k8s-helm");
    await flushPromises();
    expect(dialog.props("primaryButtonDisabled")).toBe(false);
  });
});
