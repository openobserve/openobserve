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
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { queryClient } from "@/composables/query/queryClient";
import type { SecretBackend } from "@/services/secretBackends";

vi.mock("@/services/secretBackends", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    default: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      putCredential: vi.fn(),
      test: vi.fn(),
      identity: vi.fn(),
    },
  };
});

import secretBackends from "@/services/secretBackends";
import SecretBackendsTab from "./SecretBackendsTab.vue";
import SecretBackendDrawer from "./SecretBackendDrawer.vue";
import SecretBackendIdentity from "./SecretBackendIdentity.vue";
import {
  backendDefaults,
  backendStatus,
  buildBackendCredential,
  buildBackendRequest,
  buildBackendUpdate,
  makeBackendSchema,
  vaultMatchesCloud,
} from "./SecretBackend.schema";

const t = ((k: string) => k) as any;
const sel = (name: string) => `[data-test="${name}"]`;
const backend = (over: Partial<SecretBackend> = {}): SecretBackend => ({
  id: "b1",
  name: "aws-prod",
  kind: "aws_sm",
  description: "",
  config: { partition: "aws", region: "us-east-1", account: "511000000001" },
  path_prefixes: ["o2/prod/"],
  auth_mode: "static",
  cred_set: true,
  ready: true,
  secrets_count: 0,
  ttl_secs: 300,
  stale_max_secs: 3600,
  backend_rev: "rev-1",
  created_by: "priya@acme.io",
  created_at: Date.now() * 1000,
  updated_by: "priya@acme.io",
  updated_at: Date.now() * 1000,
  ...over,
});
// Server settings allowlist per kind (ENT secret_store/backends.rs validate_transport).
const SERVER_CONFIG_KEYS: Record<string, string[]> = {
  aws_sm: ["partition", "region", "account", "tenant_role_arn", "endpoint", "ca_bundle"],
  gcp_sm: ["project_id", "endpoint", "ca_bundle"],
  azure_kv: ["vault", "vault_url", "tenant_id", "client_id", "cloud", "endpoint", "ca_bundle"],
};
const global = {
  plugins: [i18n, store],
  stubs: { ODrawer: { template: "<div><slot /></div>" } },
};

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("backend form rules (X4, X9)", () => {
  it("needs a credential on a new backend, and keeps a saved one until replaced", () => {
    const value = { ...backendDefaults(backend()), name: "aws-prod" };
    expect(makeBackendSchema(t, "aws_sm", false).safeParse(value).success).toBe(false);
    expect(makeBackendSchema(t, "aws_sm", true).safeParse(value).success).toBe(true);
  });

  it("refuses a vault URL on another Azure cloud and a bad tenant", () => {
    expect(vaultMatchesCloud("https://acme.vault.usgovcloudapi.net", "public")).toBe(false);
    expect(vaultMatchesCloud("https://acme.vault.azure.net", "public")).toBe(true);
    expect(backendDefaults().cloud).toBe("public");
    const res = makeBackendSchema(t, "azure_kv", true).safeParse({
      ...backendDefaults(),
      name: "azure-corp",
      path_prefixes: ["o2-"],
      tenant_id: "not a tenant",
      client_id: "4f1c",
      vault_url: "https://acme.vault.usgovcloudapi.net",
    });
    const paths = res.success ? [] : res.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(["tenant_id", "vault_url"]);
  });

  it("builds a static request with the provider settings, never the credential", () => {
    const body = buildBackendRequest("gcp_sm", {
      ...backendDefaults(),
      name: " gcp-analytics ",
      project_id: "acme-analytics-prod",
      path_prefixes: ["o2-", " "],
      credential: '{"type":"service_account"}',
    });
    expect(body).toEqual({
      name: "gcp-analytics",
      kind: "gcp_sm",
      config: { project_id: "acme-analytics-prod" },
      path_prefixes: ["o2-"],
      auth_mode: "static",
    });
  });

  it("sends only settings the server accepts for each provider", () => {
    const v = {
      ...backendDefaults(),
      name: "b",
      path_prefixes: ["o2/"],
      region: "us-east-1",
      account: "511000000001",
      access_key_id: "AKIA4",
      project_id: "p",
      tenant_id: "acme.onmicrosoft.com",
      client_id: "c",
      vault_url: "https://acme.vault.azure.net",
    };
    for (const kind of ["aws_sm", "gcp_sm", "azure_kv"] as const) {
      const keys = Object.keys(buildBackendRequest(kind, v).config);
      expect(keys.filter((k) => !SERVER_CONFIG_KEYS[kind].includes(k))).toEqual([]);
    }
    expect(buildBackendRequest("aws_sm", v).config).toEqual({
      partition: "aws",
      region: "us-east-1",
      account: "511000000001",
    });
    expect(buildBackendRequest("azure_kv", v).config.cloud).toBe("public");
  });

  it("sends the AWS credential as the JSON key pair the server parses", () => {
    const v = { ...backendDefaults(), access_key_id: " AKIA4 ", credential: "wJalr-secret" };
    expect(JSON.parse(buildBackendCredential("aws_sm", v))).toEqual({
      access_key_id: "AKIA4",
      secret_access_key: "wJalr-secret",
    });
    expect(buildBackendCredential("gcp_sm", { ...v, credential: "{}" })).toBe("{}");
  });

  it("needs a 12-digit AWS account and an access key ID with a new secret key", () => {
    const value = {
      ...backendDefaults(),
      name: "aws-prod",
      path_prefixes: ["o2/"],
      region: "us-east-1",
      account: "5110",
      credential: "wJalr",
    };
    const res = makeBackendSchema(t, "aws_sm", false).safeParse(value);
    const paths = res.success ? [] : res.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(["account", "access_key_id"]);
  });

  it("builds an update without kind and with the row's backend_rev", () => {
    const row = backend({ config: { ...backend().config, tenant_role_arn: "arn:x" } });
    const body = buildBackendUpdate(
      "aws_sm",
      { ...backendDefaults(row), region: "eu-west-1" },
      row,
    );
    expect(body).toEqual({
      name: "aws-prod",
      config: {
        partition: "aws",
        region: "eu-west-1",
        account: "511000000001",
        tenant_role_arn: "arn:x",
      },
      path_prefixes: ["o2/prod/"],
      expected_backend_rev: "rev-1",
    });
  });

  it("shows Ready once a test passed, else Pending test", () => {
    expect(backendStatus(backend())).toBe("ready");
    expect(backendStatus(backend({ ready: false }))).toBe("pending");
  });
});

describe("Backends tab (X1, X5)", () => {
  it("offers AWS, GCP and Azure on the empty tab, and Vault as unavailable", async () => {
    vi.mocked(secretBackends.list).mockResolvedValue({ data: { items: [] } } as any);
    const w = mount(SecretBackendsTab, { global });
    await flushPromises();
    expect(w.find(sel("secret-backends-connect-aws_sm")).exists()).toBe(true);
    expect(w.find(sel("secret-backends-connect-gcp_sm")).exists()).toBe(true);
    expect(w.find(sel("secret-backends-connect-azure_kv")).exists()).toBe(true);
    expect(w.find(sel("secret-backends-connect-vault")).text()).toContain("later release");
  });

  it("lists backends with their sign-in and one status chip", async () => {
    vi.mocked(secretBackends.list).mockResolvedValue({
      data: {
        items: [backend(), backend({ id: "b2", name: "aws-sandbox", ready: false })],
      },
    } as any);
    const w = mount(SecretBackendsTab, { global });
    await flushPromises();
    expect(w.find(sel("secret-backends-row-aws-prod-status")).text()).toBe("Ready");
    expect(w.find(sel("secret-backends-row-aws-prod-auth")).text()).toBe("Static credential");
    expect(w.find(sel("secret-backends-row-aws-sandbox-status")).text()).toBe("Pending test");
  });
});

describe("Connect drawer (X2–X4)", () => {
  it("hides the identity selector and saves a new backend as static, then its credential", async () => {
    vi.mocked(secretBackends.create).mockResolvedValue({ data: { id: "b9" } } as any);
    vi.mocked(secretBackends.putCredential).mockResolvedValue({ data: {} } as any);
    const w = mount(SecretBackendDrawer, { props: { kind: "aws_sm" }, global });
    await flushPromises();
    expect(w.find(sel("secret-backend-static-badge")).exists()).toBe(true);
    expect(w.find("input[type='radio']").exists()).toBe(false);
    expect(w.find(sel("secret-backend-identity")).exists()).toBe(false);
    const form = (w.findComponent({ name: "OForm" }).vm as any).form;
    form.setFieldValue("name", "aws-prod");
    form.setFieldValue("region", "us-east-1");
    form.setFieldValue("account", "511000000001");
    form.setFieldValue("access_key_id", "AKIA4");
    form.setFieldValue("path_prefixes", ["o2/prod/"]);
    form.setFieldValue("credential", "wJalr-secret");
    await form.handleSubmit();
    await flushPromises();
    expect(secretBackends.create).toHaveBeenCalledWith("default", {
      name: "aws-prod",
      kind: "aws_sm",
      config: { partition: "aws", region: "us-east-1", account: "511000000001" },
      path_prefixes: ["o2/prod/"],
      auth_mode: "static",
    });
    const [, id, cred] = vi.mocked(secretBackends.putCredential).mock.calls[0];
    expect(id).toBe("b9");
    expect(JSON.parse(cred)).toEqual({ access_key_id: "AKIA4", secret_access_key: "wJalr-secret" });
    expect(w.find(sel("secret-backend-test")).exists()).toBe(true);
  });

  it("edits a backend with expected_backend_rev, then reads the fresh row back", async () => {
    vi.mocked(secretBackends.update).mockResolvedValue({ data: {} } as any);
    vi.mocked(secretBackends.list).mockResolvedValue({
      data: { items: [backend({ backend_rev: "rev-2", path_prefixes: ["o2/new/"] })] },
    } as any);
    const w = mount(SecretBackendDrawer, { props: { kind: "aws_sm", backend: backend() }, global });
    await flushPromises();
    const form = (w.findComponent({ name: "OForm" }).vm as any).form;
    form.setFieldValue("path_prefixes", ["o2/new/"]);
    await form.handleSubmit();
    await flushPromises();
    expect(secretBackends.update).toHaveBeenCalledWith("default", "b1", {
      name: "aws-prod",
      config: { partition: "aws", region: "us-east-1", account: "511000000001" },
      path_prefixes: ["o2/new/"],
      expected_backend_rev: "rev-1",
    });
    expect(secretBackends.putCredential).not.toHaveBeenCalled();
    form.setFieldValue("path_prefixes", ["o2/newer/"]);
    await form.handleSubmit();
    await flushPromises();
    expect(vi.mocked(secretBackends.update).mock.calls[1][2]).toMatchObject({
      expected_backend_rev: "rev-2",
    });
  });

  it("shows a saved credential as Set by who, with Replace and no value", async () => {
    const w = mount(SecretBackendDrawer, {
      props: { kind: "aws_sm", backend: backend() },
      global,
    });
    await flushPromises();
    const kept = w.find(sel("secret-backend-credential-value-kept"));
    expect(kept.text()).toMatch(/Set · updated .+ by priya@acme\.io/);
    expect(w.find(sel("secret-backend-credential-input")).exists()).toBe(false);
  });

  it("discards a cancelled credential replacement before saving", async () => {
    vi.mocked(secretBackends.update).mockResolvedValue({ data: {} });
    vi.mocked(secretBackends.list).mockResolvedValue({ data: { items: [backend()] } });
    const w = mount(SecretBackendDrawer, {
      props: { kind: "aws_sm", backend: backend() },
      global,
    });
    await flushPromises();
    await w.find(sel("secret-backend-credential-value-replace")).trigger("click");
    await flushPromises();
    await w.find(sel("secret-backend-access-key-id")).find("input").setValue("AKIA4");
    await w.find(sel("secret-backend-credential-input")).find("input").setValue("new-secret");
    await w.find(sel("secret-backend-credential-cancel")).trigger("click");
    await flushPromises();
    const form = w.findComponent({ name: "OForm" }).vm.form;
    expect(form.state.values.credential).toBe("");
    expect(form.state.values.access_key_id).toBe("");
    expect(w.find(sel("secret-backend-credential-value-kept")).exists()).toBe(true);
    await form.handleSubmit();
    await flushPromises();
    expect(secretBackends.update).toHaveBeenCalled();
    expect(secretBackends.putCredential).not.toHaveBeenCalled();
    await w.find(sel("secret-backend-credential-value-replace")).trigger("click");
    await flushPromises();
    expect(w.find(sel("secret-backend-credential-input")).find("input").element.value).toBe("");
    w.unmount();
  });

  it("runs Test connection and shows only the result code", async () => {
    vi.mocked(secretBackends.test).mockResolvedValue({
      data: { ok: false, class: "access_denied", code: "trust_policy_ignores_external_id" },
    } as any);
    const w = mount(SecretBackendDrawer, {
      props: { kind: "aws_sm", backend: backend() },
      global,
    });
    await flushPromises();
    await w.find(sel("secret-backend-test-locator")).find("input").setValue("o2/prod/pd");
    await w.find(sel("secret-backend-test-btn")).trigger("click");
    await flushPromises();
    expect(secretBackends.test).toHaveBeenCalledWith("default", "b1", "o2/prod/pd");
    const result = w.find(sel("secret-backend-test-result")).text();
    expect(result).toContain("Failed");
    expect(result).toContain("trust_policy_ignores_external_id");
  });
});

describe("Test connection locator (T24)", () => {
  it("never sends a test without a locator", async () => {
    const w = mount(SecretBackendDrawer, {
      props: { kind: "aws_sm", backend: backend() },
      global,
    });
    await flushPromises();
    await w.find(sel("secret-backend-test-locator")).find("input").setValue("   ");
    expect(w.find(sel("secret-backend-test-btn")).attributes("disabled")).toBeDefined();
    await (w.vm as any).$.setupState.runTest();
    await flushPromises();
    expect(secretBackends.test).not.toHaveBeenCalled();
  });
});

describe("Identity panel (X2)", () => {
  const identity = (next?: string) => ({
    provider: "aws",
    state: "active",
    principal: "arn:aws:iam::5110:role/o2/secret-store/o2sm-k3f7",
    org_tag: "k3f7q9d2",
    external_id_or_subject: "o2-mzq4h7c2xw9t3k6bn5d8rfey",
    incarnation: "x",
    next_principal: next ?? null,
    switch_ready: [],
  });

  it("shows both ARNs while a rotation is pending", async () => {
    vi.mocked(secretBackends.identity).mockResolvedValue({
      data: identity("arn:aws:iam::5110:role/o2/secret-store/o2sm-r8n2"),
    } as any);
    const w = mount(SecretBackendIdentity, {
      props: { backend: backend({ auth_mode: "mapped" }) },
      global,
    });
    await flushPromises();
    expect(w.find(sel("secret-backend-identity-current")).text()).toContain("o2sm-k3f7");
    expect(w.find(sel("secret-backend-identity-next")).text()).toContain("o2sm-r8n2");
    expect(w.find(sel("secret-backend-rotation-pending")).exists()).toBe(true);
  });

  it("shows one ARN after the switch", async () => {
    vi.mocked(secretBackends.identity).mockResolvedValue({ data: identity() } as any);
    const w = mount(SecretBackendIdentity, {
      props: { backend: backend({ auth_mode: "mapped" }) },
      global,
    });
    await flushPromises();
    expect(w.find(sel("secret-backend-identity-next")).exists()).toBe(false);
    expect(w.find(sel("secret-backend-rotation-pending")).exists()).toBe(false);
    expect(w.find(sel("secret-backend-external-id")).text()).toBe("o2-mzq4h7c2xw9t3k6bn5d8rfey");
  });
});
