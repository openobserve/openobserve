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
import SecretDrawer from "./SecretDrawer.vue";
import secrets, { type SecretDetail } from "@/services/secrets";
import { queryClient } from "@/composables/query/queryClient";
import { secretKeys } from "@/services/secrets.querykeys";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { fillField } from "@/test/unit/helpers/fillField";

vi.mock("@/services/secrets", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: {
      get: vi.fn(),
      putValue: vi.fn(),
      putSource: vi.fn(),
      inheritValue: vi.fn(),
      putPolicy: vi.fn(),
      usage: vi.fn(),
      restore: vi.fn(),
      purge: vi.fn(),
      remove: vi.fn(),
      rename: vi.fn(),
    },
  };
});

vi.mock("@/services/synthetics", () => ({ default: { listEnvironments: vi.fn() } }));
vi.mock("@/services/secretBackends", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, default: { list: vi.fn() } };
});
import syntheticsService from "@/services/synthetics";
import secretBackends from "@/services/secretBackends";

const NOW_US = Date.now() * 1000;
const detail = (over: Partial<SecretDetail> = {}): SecretDetail => ({
  id: "s1",
  name: "API_TOKEN",
  description: "Checkout API token",
  kind: "secret",
  state: "active",
  envs: [
    {
      env: "_org",
      state: "set",
      value_version: 3,
      updated_at: NOW_US,
      updated_by: "marco@acme.io",
    },
    {
      env: "prod",
      state: "set",
      value_version: 1,
      updated_at: NOW_US,
      updated_by: "marco@acme.io",
    },
    { env: "staging", state: "inherit", value_version: 0, updated_at: 0, updated_by: "" },
  ],
  allowed_consumers: [{ type: "synthetics_check" }],
  allowed_hosts: ["api.acme.io"],
  pin_mode: "hosts",
  private_locations: "off",
  policy_rev: "rev-1",
  usage_count: 0,
  rights: { see: true, use: true, manage: true, manage_access: true },
  ...over,
});

const mountDrawer = async (d: SecretDetail, initialTab?: "values" | "policy") => {
  vi.mocked(secrets.get).mockResolvedValue({ data: d } as any);
  vi.mocked(secrets.usage).mockResolvedValue({ data: { items: [] } } as any);
  const w = mount(SecretDrawer, {
    props: { secretId: d.id, initialTab },
    global: {
      plugins: [i18n, store, router],
      provide: { store },
      stubs: {
        ODrawer: { template: "<div><slot /></div>" },
        ODialog: { template: "<div />" },
        ODropdown: { template: "<div><slot name='trigger' /><slot /></div>" },
        ODropdownItem: { template: "<div @click=\"$emit('select')\"><slot /></div>" },
      },
    },
    attachTo: document.body,
  });
  await flushPromises();
  return w;
};

describe("SecretDrawer values (V37, V39)", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("gives every drawer tab a stable data-test", async () => {
    const w = await mountDrawer(detail());
    for (const tab of ["values", "policy", "access", "usage", "audit"]) {
      expect(
        w.find(`[data-test='secret-drawer-tabs'] [data-test='secret-drawer-tab-${tab}']`).exists(),
      ).toBe(true);
    }
    await w.find("[data-test='secret-drawer-tab-policy']").trigger("mousedown", { button: 0 });
    await flushPromises();
    expect(w.find("form[data-test='secret-policy-tab']").exists()).toBe(true);
    w.unmount();
  });

  it("shows write-only rows: set state, who and when, never a value", async () => {
    const w = await mountDrawer(detail());
    const org = w.find("[data-test='secret-value-row-_org-status']").text();
    expect(org).toMatch(/^Set · updated .+ by marco@acme\.io$/);
    expect(w.find("[data-test='secret-value-row-staging-status']").text()).toBe(
      "Uses the org value",
    );
    expect(w.find("[data-test='secret-value-row-_org-variable-value']").exists()).toBe(false);
    w.unmount();
  });

  it("has no reveal, eye or copy control anywhere", async () => {
    const w = await mountDrawer(detail());
    await w.find("[data-test='secret-value-row-_org-replace']").trigger("click");
    await flushPromises();
    // Strip template comments: the shared input documents its optional reveal toggle in one.
    const clone = w.element.cloneNode(true);
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const comments: Node[] = [];
    while (walker.nextNode()) {
      comments.push(walker.currentNode);
    }
    for (const comment of comments) {
      comment.parentNode?.removeChild(comment);
    }
    const html = (clone as Element).outerHTML.toLowerCase();
    expect(html.match(/[\s\S]{0,80}(reveal|show value|copy)[\s\S]{0,20}/)?.[0]).toBeUndefined();
    expect(w.findAll("[aria-pressed]").length).toBe(0);
    const input = w.find("[data-test='secret-value-row-_org-input'] input");
    expect(input.attributes("type")).toBe("password");
    expect((input.element as HTMLInputElement).value).toBe("");
    w.unmount();
  });

  it("replaces the org value through PUT values/_org", async () => {
    vi.mocked(secrets.putValue).mockResolvedValue({ data: {} } as any);
    const w = await mountDrawer(detail());
    await w.find("[data-test='secret-value-row-_org-replace']").trigger("click");
    await flushPromises();
    await fillField("secret-value-row-_org-input", "n3w-t0ken");
    await w.find("[data-test='secret-value-row-_org'] form").trigger("submit");
    await flushPromises();
    await vi.waitFor(() =>
      expect(secrets.putValue).toHaveBeenCalledWith("default", "s1", "_org", "n3w-t0ken"),
    );
    await flushPromises();
    expect(w.find("[data-test='secret-value-row-_org-input']").exists()).toBe(false);
    w.unmount();
  });

  it("lists the consumers that block a value write (variable_feeds_secret_consumer)", async () => {
    vi.mocked(secrets.putValue).mockRejectedValue({
      response: {
        status: 409,
        data: {
          code: "variable_feeds_secret_consumer",
          message: "variable_feeds_secret_consumer",
          usage: [
            {
              path: [
                {
                  consumer_type: "alert_destination",
                  consumer_id: "d1",
                  consumer_name: "pd-checkout",
                },
              ],
              field: "/headers/Authorization",
              status: "bound",
              token_name: "PD_KEY",
            },
          ],
        },
      },
    });
    const w = await mountDrawer(detail());
    await w.find("[data-test='secret-value-row-_org-replace']").trigger("click");
    await flushPromises();
    await fillField("secret-value-row-_org-input", "n3w-t0ken");
    await w.find("[data-test='secret-value-row-_org'] form").trigger("submit");
    await flushPromises();
    await vi.waitFor(() => expect(secrets.putValue).toHaveBeenCalled());
    await flushPromises();
    const card = w.find("[data-test='secret-save-refusal']");
    expect(card.text()).toContain("variable_feeds_secret_consumer");
    expect(w.find("[data-test='secret-save-refusal-usage']").text()).toContain(
      "pd-checkout · /headers/Authorization",
    );
    w.unmount();
  });

  it("adds an override for an environment that has no value yet (T39)", async () => {
    vi.mocked(syntheticsService.listEnvironments).mockResolvedValue({
      data: [
        { id: "g", name: "global", is_global: true },
        { id: "e1", name: "prod", is_global: false },
        { id: "e2", name: "staging", is_global: false },
        { id: "e3", name: "qa", is_global: false },
      ],
    } as any);
    vi.mocked(secrets.putValue).mockResolvedValue({ data: {} } as any);
    const w: any = await mountDrawer(detail());
    const tab = w.findComponent({ name: "SecretValuesTab" });
    expect(tab.vm.$.setupState.missingEnvs).toEqual(["qa"]);
    tab.vm.$.setupState.addingEnv = "qa";
    await flushPromises();
    await fillField("secret-value-row-qa-input", "qa-t0ken");
    await w.find("[data-test='secret-value-row-qa'] form").trigger("submit");
    await vi.waitFor(() =>
      expect(secrets.putValue).toHaveBeenCalledWith("default", "s1", "qa", "qa-t0ken"),
    );
    w.unmount();
  });

  it("points a value at an external backend instead of typing it (T39)", async () => {
    vi.mocked(secretBackends.list).mockResolvedValue({
      data: { items: [{ id: "b1", name: "aws-prod", kind: "aws_sm", ready: true }] },
    } as any);
    vi.mocked(secrets.putSource).mockResolvedValue({ data: {} } as any);
    const w = await mountDrawer(detail());
    await w.find("[data-test='secret-value-row-_org-replace']").trigger("click");
    await flushPromises();
    const row = w.findComponent({ name: "SecretValueRow" });
    const form = (row.findComponent({ name: "OForm" }).vm as any).form;
    form.setFieldValue("source", "external");
    await flushPromises();
    expect(w.find("[data-test='secret-value-row-_org-input']").exists()).toBe(false);
    expect(w.find("[data-test='secret-source-locator']").exists()).toBe(true);
    form.setFieldValue("backend_id", "b1");
    form.setFieldValue("locator", "o2/prod/pd");
    await form.handleSubmit();
    await flushPromises();
    expect(secrets.putSource).toHaveBeenCalledWith("default", "s1", "_org", {
      backend_id: "b1",
      locator: "o2/prod/pd",
      version_selector: "latest",
    });
    expect(secrets.putValue).not.toHaveBeenCalled();
    w.unmount();
  });

  it("keeps no submitted value in the mutation cache after the save", async () => {
    vi.mocked(secrets.putValue).mockResolvedValue({ data: {} } as any);
    const w = await mountDrawer(detail());
    await w.find("[data-test='secret-value-row-_org-replace']").trigger("click");
    await flushPromises();
    await fillField("secret-value-row-_org-input", "n3w-t0ken");
    await w.find("[data-test='secret-value-row-_org'] form").trigger("submit");
    await vi.waitFor(() => expect(secrets.putValue).toHaveBeenCalled());
    await flushPromises();
    await new Promise((r) => setTimeout(r, 0));
    const cached = queryClient
      .getMutationCache()
      .getAll()
      .map((m) => m.state);
    expect(JSON.stringify(cached)).not.toContain("n3w-t0ken");
    w.unmount();
  });

  it("shows a variable's value, which is not write-only", async () => {
    const w = await mountDrawer(detail({ kind: "variable", value: "https://shop.acme.io" }));
    expect(w.find("[data-test='secret-value-row-_org-variable-value']").text()).toBe(
      "https://shop.acme.io",
    );
    w.unmount();
  });
});

describe("SecretDrawer policy (V38, R17 reason gating)", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  const submit = async (w: any) => {
    await w.find("form[data-test='secret-policy-tab']").trigger("submit");
    await flushPromises();
  };

  it("selects a pin mode through its stable radio selector", async () => {
    const w: any = await mountDrawer(detail(), "policy");
    const form = w.findComponent({ name: "SecretPolicyTab" }).vm.form;
    const any = w.find("[data-test='secret-policy-pin-mode'] [data-test-value='any']");
    expect(any.attributes("data-test")).toBe("secret-policy-pin-mode-any");
    expect(w.find("[data-test='secret-policy-pin-mode-hosts']").exists()).toBe(true);
    await any.trigger("click");
    await flushPromises();
    expect(form.state.values.pin_mode).toBe("any");
    w.unmount();
  });

  it("keeps session hosts after saving Allow any host and refreshing the policy revision", async () => {
    vi.mocked(secrets.putPolicy).mockResolvedValue({ data: { now_failing: [] } });
    const w = await mountDrawer(detail(), "policy");
    const form = w.findComponent({ name: "SecretPolicyTab" }).vm.form;
    form.setFieldValue("hosts", ["new.example.com"]);
    form.setFieldValue("pin_mode", "any");
    form.setFieldValue("pin_override_reason", "Hosts vary by customer");
    await submit(w);
    await vi.waitFor(() => expect(secrets.putPolicy).toHaveBeenCalledTimes(2));
    expect(vi.mocked(secrets.putPolicy).mock.calls[1][2]).toMatchObject({
      pin_mode: "any",
      allowed_hosts: [],
    });
    queryClient.setQueryData(
      secretKeys.detail("default", "s1"),
      detail({
        policy_rev: "rev-2",
        pin_mode: "any",
        allowed_hosts: [],
        pin_override_reason: "Hosts vary by customer",
      }),
    );
    await flushPromises();
    const refreshed = w.findComponent({ name: "SecretPolicyTab" }).vm.form;
    refreshed.setFieldValue("pin_mode", "hosts");
    await flushPromises();
    expect(refreshed.state.values.hosts).toEqual(["new.example.com"]);
    await submit(w);
    await vi.waitFor(() => expect(secrets.putPolicy).toHaveBeenCalledTimes(4));
    expect(vi.mocked(secrets.putPolicy).mock.calls[3][2]).toMatchObject({
      allowed_hosts: ["new.example.com"],
      expected_policy_rev: "rev-2",
    });
    w.unmount();
  });

  it("leaves hosts empty when an any-host policy has no host context", async () => {
    const w = await mountDrawer(detail({ pin_mode: "any", allowed_hosts: [] }), "policy");
    const form = w.findComponent({ name: "SecretPolicyTab" }).vm.form;
    form.setFieldValue("pin_mode", "hosts");
    await flushPromises();
    expect(form.state.values.hosts).toEqual([]);
    w.unmount();
  });

  it("shows the manage-access hint only when the caller lacks manage access", async () => {
    const allowed = await mountDrawer(detail(), "policy");
    expect(allowed.text()).not.toContain("Needs manage access");
    allowed.unmount();
    queryClient.clear();
    const denied = await mountDrawer(
      detail({
        rights: {
          see: true,
          use: true,
          manage: true,
          manage_access: false,
        },
      }),
      "policy",
    );
    expect(denied.text()).toContain("Needs manage access");
    denied.unmount();
  });

  it("does not save Allow any host without a reason", async () => {
    const w: any = await mountDrawer(detail(), "policy");
    const form = w.findComponent({ name: "SecretPolicyTab" }).vm.form;
    form.setFieldValue("pin_mode", "any");
    await flushPromises();
    expect(w.find("[data-test='secret-policy-any-host-warning']").exists()).toBe(true);
    await submit(w);
    await vi.waitFor(() => expect(w.text()).toContain("Give a reason"));
    expect(secrets.putPolicy).not.toHaveBeenCalled();
    w.unmount();
  });

  it("does not save private locations without a reason", async () => {
    const w: any = await mountDrawer(detail(), "policy");
    const form = w.findComponent({ name: "SecretPolicyTab" }).vm.form;
    form.setFieldValue("private_locations", true);
    await submit(w);
    await vi.waitFor(() => expect(w.text()).toContain("Give a reason"));
    expect(secrets.putPolicy).not.toHaveBeenCalled();
    w.unmount();
  });

  it("dry-runs first, warns about failing consumers, then saves on the second click", async () => {
    vi.mocked(secrets.putPolicy).mockImplementation(
      async (_o, _i, _b, dryRun) =>
        ({
          data: dryRun
            ? {
                now_failing: [
                  {
                    consumer_type: "synthetics_check",
                    consumer_id: "c1",
                    consumer_name: "checkout-flow",
                    code: "pin_mismatch",
                  },
                ],
              }
            : { policy_rev: "rev-2", now_failing: [], effective: true },
        }) as any,
    );
    const w: any = await mountDrawer(detail(), "policy");
    const form = w.findComponent({ name: "SecretPolicyTab" }).vm.form;
    form.setFieldValue("pin_mode", "any");
    form.setFieldValue("pin_override_reason", "per-customer hosts");
    await submit(w);
    await vi.waitFor(() => expect(secrets.putPolicy).toHaveBeenCalledTimes(1));
    await flushPromises();
    expect(vi.mocked(secrets.putPolicy).mock.calls[0][3]).toBe(true);
    expect(w.find("[data-test='secret-policy-now-failing']").text()).toContain("checkout-flow");
    await submit(w);
    await vi.waitFor(() => expect(secrets.putPolicy).toHaveBeenCalledTimes(2));
    const [, , body, dryRun] = vi.mocked(secrets.putPolicy).mock.calls[1];
    expect(dryRun).toBeFalsy();
    expect(body).toMatchObject({
      pin_mode: "any",
      pin_override_reason: "per-customer hosts",
      expected_policy_rev: "rev-1",
    });
    w.unmount();
  });
});

describe("SecretDrawer lifecycle (L8)", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("offers restore and purge on a deleted secret, and no rename or delete", async () => {
    vi.mocked(secrets.restore).mockResolvedValue({ data: {} } as any);
    const w = await mountDrawer(detail({ state: "deleted", usage_count: 2 }));
    expect(w.find("[data-test='secret-drawer-deleted-banner']").text()).toContain(
      "2 consumers are failing",
    );
    expect(w.find("[data-test='secret-drawer-more']").exists()).toBe(false);
    await w.find("[data-test='secret-drawer-restore']").trigger("click");
    await flushPromises();
    expect(secrets.restore).toHaveBeenCalledWith("default", "s1");
    w.unmount();
  });
});

describe("SecretDrawer rights", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("hides value, lifecycle and policy actions from a use-only caller", async () => {
    const rights = { see: true, use: true, manage: false, manage_access: false };
    const w = await mountDrawer(detail({ rights }));
    expect(w.find("[data-test='secret-value-row-_org-status']").exists()).toBe(true);
    expect(w.find("[data-test='secret-value-row-_org-replace']").exists()).toBe(false);
    expect(w.find("[data-test='secret-value-row-prod-remove-override']").exists()).toBe(false);
    expect(w.find("[data-test='secret-drawer-more']").exists()).toBe(false);
    w.unmount();
    const p = await mountDrawer(detail({ rights }), "policy");
    expect(p.find("[data-test='secret-policy-save']").exists()).toBe(false);
    p.unmount();
  });

  it("shows the policy read-only without manage access", async () => {
    const rights = { see: true, use: true, manage: true, manage_access: false };
    const w = await mountDrawer(detail({ rights }), "policy");
    const disabled = (sel: string) =>
      w.find(`[data-test='${sel}']`).find("input, button").attributes("disabled");
    expect(disabled("secret-policy-type-synthetics_check-enabled")).toBeDefined();
    expect(
      w.find("[data-test='secret-policy-pin-mode'] button").attributes("disabled"),
    ).toBeDefined();
    expect(
      w.find("[data-test='secret-policy-private-locations'] button").attributes("disabled"),
    ).toBeDefined();
    const hosts = w.find("[data-test='secret-policy-hosts']");
    expect(hosts.find("[data-test='tag-input-field']").attributes("disabled")).toBeDefined();
    expect(hosts.find("[data-test='tag-chip-0'] button").exists()).toBe(false);
    w.unmount();
    queryClient.clear();
    const full = await mountDrawer(detail(), "policy");
    const hostsFull = full.find("[data-test='secret-policy-hosts']");
    expect(hostsFull.find("[data-test='tag-input-field']").attributes("disabled")).toBeUndefined();
    expect(hostsFull.find("[data-test='tag-chip-0'] button").exists()).toBe(true);
    full.unmount();
  });

  it("offers no value writes on a deleted secret", async () => {
    vi.mocked(syntheticsService.listEnvironments).mockResolvedValue({
      data: [{ name: "dev" }],
    } as any);
    const w = await mountDrawer(detail({ state: "deleted" }));
    expect(w.find("[data-test='secret-value-row-_org-status']").exists()).toBe(true);
    expect(w.find("[data-test='secret-value-row-_org-replace']").exists()).toBe(false);
    expect(w.find("[data-test='secret-value-row-prod-remove-override']").exists()).toBe(false);
    expect(w.find("[data-test='secret-values-add-override']").exists()).toBe(false);
    w.unmount();
  });

  it("lets a manage holder restore but only a manage-access holder purge", async () => {
    const w = await mountDrawer(
      detail({
        state: "deleted",
        rights: { see: true, use: true, manage: true, manage_access: false },
      }),
    );
    expect(w.find("[data-test='secret-drawer-restore']").exists()).toBe(true);
    expect(w.find("[data-test='secret-drawer-purge']").exists()).toBe(false);
    w.unmount();
  });
});
