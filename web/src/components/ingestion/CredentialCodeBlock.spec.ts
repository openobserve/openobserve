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
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import { copyToClipboard } from "@/utils/clipboard";
import CredentialCodeBlock from "./CredentialCodeBlock.vue";

vi.mock("@/utils/clipboard", () => ({ copyToClipboard: vi.fn(async () => true) }));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
const credentialApi = vi.hoisted(() => ({
  get_organization_passcode: vi.fn(),
  list_org_ingestion_tokens: vi.fn(),
}));
vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), { default: credentialApi });
});

const ORG = "acme-prod";
const EMAIL = "dev@acme.io";
const TOKEN = "org-token-value";
const SLUG = "curl";
const TEMPLATE = "curl -u [EMAIL]:[PASSCODE] https://api.example.com/api/acme-prod/default/_json";

const makeStore = () =>
  createStore({
    state: {
      userInfo: { email: EMAIL },
      selectedOrganization: { identifier: ORG },
      organizationData: {
        organizationPasscode: "",
        organizationPasscodeForbidden: false,
        orgTokens: [],
      },
    },
    mutations: {
      setOrganizationPasscode(state: any, payload: string) {
        state.organizationData.organizationPasscode = payload;
      },
      setOrganizationPasscodeUser() {},
      setOrganizationPasscodeForbidden(state: any, payload: boolean) {
        state.organizationData.organizationPasscodeForbidden = payload;
      },
      setOrgTokens(state: any, payload: unknown[]) {
        state.organizationData.orgTokens = payload;
      },
    },
    actions: {
      setOrganizationPasscode({ commit }, payload: string) {
        commit("setOrganizationPasscode", payload);
      },
      setOrganizationPasscodeUser({ commit }, payload: string) {
        commit("setOrganizationPasscodeUser", payload);
      },
      setOrganizationPasscodeForbidden({ commit }, payload: boolean) {
        commit("setOrganizationPasscodeForbidden", payload);
      },
      setOrgTokens({ commit }, payload: unknown[]) {
        commit("setOrgTokens", payload);
      },
    },
  });

let wrapper: VueWrapper;

const mountBlock = async (content = TEMPLATE) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/curl", name: "curl", component: { template: "<div />" } }],
  });
  await router.push("/curl");
  wrapper = mount(CredentialCodeBlock, {
    props: { content, slug: SLUG, lang: "bash" },
    global: { plugins: [i18n, makeStore(), router] },
  });
  await flushPromises();
  return wrapper;
};

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  }
};

const q = (id: string) => wrapper.find(`[data-test="${id}"]`);
const loading = () => q(`ingestion-${SLUG}-code-block-loading`);
const copyBtn = () => q(`ingestion-${SLUG}-code-block-copy-btn`);
const pre = () => q(`ingestion-${SLUG}-code-block-pre`);

beforeEach(() => {
  credentialApi.list_org_ingestion_tokens.mockResolvedValue({
    data: { data: [{ name: "default", token: TOKEN, enabled: true }] },
  });
  credentialApi.get_organization_passcode.mockResolvedValue({
    data: { data: { passcode: "user-passcode", user: EMAIL } },
  });
});

afterEach(() => {
  wrapper?.unmount();
  queryClient.clear();
  vi.clearAllMocks();
});

describe("CredentialCodeBlock — before the credential lands", () => {
  it("holds the block in its loading state, with nothing copyable", async () => {
    credentialApi.get_organization_passcode.mockReturnValue(new Promise(() => {}));
    await mountBlock();

    expect(loading().exists()).toBe(true);
    expect(copyBtn().exists()).toBe(false);
    expect(pre().exists()).toBe(false);
  });

  it("does not render a command with an empty password", async () => {
    credentialApi.get_organization_passcode.mockReturnValue(new Promise(() => {}));
    await mountBlock();

    expect(wrapper.text()).not.toContain(`${EMAIL}:`);
  });

  it("never gates a snippet that carries no credential", async () => {
    credentialApi.get_organization_passcode.mockReturnValue(new Promise(() => {}));
    await mountBlock("docker run openobserve/openobserve:latest");

    expect(loading().exists()).toBe(false);
    expect(copyBtn().exists()).toBe(true);
  });
});

describe("CredentialCodeBlock — once the credential lands", () => {
  it("copies the real token", async () => {
    await mountBlock();
    await settle();

    expect(loading().exists()).toBe(false);
    expect(copyBtn().exists()).toBe(true);

    await copyBtn().trigger("click");
    await flushPromises();

    expect(copyToClipboard).toHaveBeenCalledWith(
      `curl -u ${EMAIL}:${TOKEN} https://api.example.com/api/acme-prod/default/_json`,
      expect.anything(),
      expect.anything(),
    );
  });

  it("masks the token in the rendered command", async () => {
    await mountBlock();
    await settle();

    expect(pre().text()).not.toContain(TOKEN);
    expect(pre().text()).toContain(EMAIL);
  });

  it("refuses the block when the passcode read failed", async () => {
    credentialApi.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [] } });
    credentialApi.get_organization_passcode.mockRejectedValue({ response: { status: 500 } });
    await mountBlock();
    await settle();

    expect(q(`ingestion-${SLUG}-code-block-passcode-unavailable`).exists()).toBe(true);
    expect(copyBtn().exists()).toBe(false);
    expect(wrapper.text()).not.toContain(`${EMAIL}:`);
  });

  it("refuses the block when the org has no token to substitute", async () => {
    credentialApi.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [] } });
    credentialApi.get_organization_passcode.mockResolvedValue({ data: { data: {} } });
    await mountBlock();
    await settle();

    expect(q(`ingestion-${SLUG}-code-block-passcode-unavailable`).exists()).toBe(true);
    expect(copyBtn().exists()).toBe(false);
    expect(wrapper.text()).not.toContain(`${EMAIL}:`);
  });

  it("shows the forbidden banner instead of the block", async () => {
    credentialApi.list_org_ingestion_tokens.mockResolvedValue({ data: { data: [] } });
    credentialApi.get_organization_passcode.mockRejectedValue({ response: { status: 403 } });
    await mountBlock();
    await settle();

    expect(loading().exists()).toBe(false);
    expect(q(`ingestion-${SLUG}-code-block-passcode-forbidden`).exists()).toBe(true);
    expect(copyBtn().exists()).toBe(false);
  });
});
