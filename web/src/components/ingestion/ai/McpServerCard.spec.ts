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

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref } from "vue";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import i18n from "@/locales";
import { b64EncodeStandard } from "@/utils/zincutils";
import type { McpCredential } from "@/composables/useMcpCredential";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

const mcp = vi.hoisted(() => ({
  generate: vi.fn(),
  generating: false,
  error: "",
  credential: null as McpCredential | null,
}));

vi.mock("@/composables/useMcpCredential", async () => {
  const actual = await vi.importActual<typeof import("@/composables/useMcpCredential")>(
    "@/composables/useMcpCredential",
  );
  return {
    ...actual,
    useMcpCredential: () => ({
      generate: mcp.generate,
      generating: ref(mcp.generating),
      error: ref(mcp.error),
      credential: ref(mcp.credential),
    }),
  };
});

import McpServerCard from "./McpServerCard.vue";
import { MCP_READONLY_ROLE } from "@/composables/useMcpCredential";

const COPY_STUB = {
  name: "CopyContent",
  template: '<div data-test="mcp-copy">{{ content }}</div>',
  props: ["content"],
};

const CREDENTIAL: McpCredential = {
  email: "mcp-abc.default@sa.internal",
  token: "tok_123",
  role: MCP_READONLY_ROLE,
  scope: "readonly",
};

const mountCard = (zoConfig: Record<string, unknown> = {}) =>
  mount(McpServerCard, {
    props: { subs: { url: "https://o2.example.com", org: "default", token: "t" } },
    global: {
      plugins: [
        i18n,
        createStore({ state: { zoConfig: { sso_enabled: false, ...zoConfig } } }),
        createRouter({
          history: createWebHistory(),
          routes: [{ path: "/", component: { template: "<div />" } }],
        }),
      ],
      stubs: { CopyContent: COPY_STUB },
    },
  });

describe("McpServerCard", () => {
  beforeEach(() => {
    mcp.generate.mockClear();
    mcp.generating = false;
    mcp.error = "";
    mcp.credential = null;
  });

  describe("auth mode", () => {
    it("offers OAuth and defaults to it when SSO is enabled", () => {
      const wrapper = mountCard({ sso_enabled: true });

      expect(wrapper.find('[data-test="ai-integrations-mcp-auth-oauth"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="ai-integrations-mcp-credential"]').exists()).toBe(false);
    });

    // OAuth discovery 404s with Dex off, so offering the tab would strand the user in SSO login.
    it("hides OAuth and forces token mode when SSO is disabled", () => {
      const wrapper = mountCard({ sso_enabled: false });

      expect(wrapper.find('[data-test="ai-integrations-mcp-auth-oauth"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="ai-integrations-mcp-credential"]').exists()).toBe(true);
    });
  });

  describe("credential", () => {
    it("does not mint anything until Generate is clicked", () => {
      const wrapper = mountCard();

      expect(mcp.generate).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="ai-integrations-mcp-generate-btn"]').exists()).toBe(true);
    });

    it("does not mint one while OAuth mode is active", () => {
      const wrapper = mountCard({ sso_enabled: true });

      expect(mcp.generate).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="ai-integrations-mcp-generate-btn"]').exists()).toBe(false);
    });

    it("mints once per click", async () => {
      const wrapper = mountCard();

      await wrapper.find('[data-test="ai-integrations-mcp-generate-btn"]').trigger("click");

      expect(mcp.generate).toHaveBeenCalledTimes(1);
    });

    // The server decides what it can do; a client-side gate would hide the reason.
    it("offers Generate even with rbac and service accounts disabled", () => {
      const wrapper = mountCard({ rbac_enabled: false, service_account_enabled: false });

      expect(wrapper.find('[data-test="ai-integrations-mcp-generate-btn"]').exists()).toBe(true);
    });

    it("shows the failure and keeps the button when minting is rejected", () => {
      mcp.error = "Service Accounts Not Enabled";
      const wrapper = mountCard();

      expect(wrapper.find('[data-test="ai-integrations-mcp-credential-error"]').text()).toBe(
        "Service Accounts Not Enabled",
      );
      expect(wrapper.find('[data-test="ai-integrations-mcp-generate-btn"]').exists()).toBe(true);
    });

    it("shows progress on the button rather than swapping the panel", () => {
      mcp.generating = true;
      const wrapper = mountCard();

      expect(wrapper.find('[data-test="ai-integrations-mcp-credential-creating"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="ai-integrations-mcp-generate-btn"]').exists()).toBe(true);
    });

    it("injects the minted token into the client snippet", () => {
      mcp.credential = CREDENTIAL;
      const wrapper = mountCard();
      const expected = `Basic ${b64EncodeStandard(`${CREDENTIAL.email}:${CREDENTIAL.token}`)}`;

      expect(wrapper.text()).toContain(expected);
      expect(wrapper.text()).not.toContain("[BASIC_PASSCODE]");
    });

    // CopyContent expands [BASIC_PASSCODE] on screen, so it would print a real credential.
    it("shows a placeholder header, not a credential, before generating", () => {
      const wrapper = mountCard();

      expect(wrapper.text()).toContain("Basic <base64 of service-account-email:token>");
      expect(wrapper.text()).not.toContain("[BASIC_PASSCODE]");
    });
  });

  describe("credential scope", () => {
    it("names the shared role when the account was scoped read-only", () => {
      mcp.credential = CREDENTIAL;
      const wrapper = mountCard();

      expect(wrapper.find('[data-test="ai-integrations-mcp-readonly-note"]').text()).toContain(
        MCP_READONLY_ROLE,
      );
      expect(wrapper.find('[data-test="ai-integrations-mcp-readonly-warn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="ai-integrations-mcp-security"]').exists()).toBe(false);
    });

    it("warns when the account ended up with no role", () => {
      mcp.credential = { ...CREDENTIAL, role: null, scope: "unscoped" };
      const wrapper = mountCard();

      expect(wrapper.find('[data-test="ai-integrations-mcp-readonly-warn"]').text()).toContain(
        MCP_READONLY_ROLE,
      );
    });

    // RBAC off is the expected OSS outcome, not a failure — no warning styling.
    it("explains the unscoped token when RBAC is off", () => {
      mcp.credential = { ...CREDENTIAL, role: null, scope: "rbacDisabled" };
      const wrapper = mountCard();

      expect(wrapper.find('[data-test="ai-integrations-mcp-rbac-note"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="ai-integrations-mcp-readonly-warn"]').exists()).toBe(false);
    });
  });
});
