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

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));

const mcp = vi.hoisted(() => ({ generate: vi.fn(), canGenerate: true }));

vi.mock("@/composables/useMcpCredential", () => ({
  useMcpCredential: () => ({
    generate: mcp.generate,
    generating: ref(false),
    error: ref(""),
    credential: ref(null),
    canGenerate: () => mcp.canGenerate,
  }),
}));

import McpServerCard from "./McpServerCard.vue";

const COPY_STUB = {
  name: "CopyContent",
  template: '<div data-test="mcp-copy"><slot /></div>',
  props: ["content"],
};

const mountCard = (ssoEnabled: boolean) =>
  mount(McpServerCard, {
    props: { subs: { url: "https://o2.example.com", org: "default", token: "t" } },
    global: {
      plugins: [
        i18n,
        createStore({ state: { zoConfig: { sso_enabled: ssoEnabled } } }),
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
    mcp.canGenerate = true;
  });

  describe("auth mode", () => {
    it("offers OAuth and defaults to it when SSO is enabled", () => {
      const wrapper = mountCard(true);

      expect(wrapper.find('[data-test="ai-integrations-mcp-auth-oauth"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="ai-integrations-mcp-credential"]').exists()).toBe(false);
    });

    // OAuth discovery 404s with Dex off, so offering the tab would strand the user in SSO login.
    it("hides OAuth and forces token mode when SSO is disabled", () => {
      const wrapper = mountCard(false);

      expect(wrapper.find('[data-test="ai-integrations-mcp-auth-oauth"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="ai-integrations-mcp-credential"]').exists()).toBe(true);
    });
  });

  describe("credential", () => {
    it("mints a read-only credential on entering token mode", () => {
      mountCard(false);

      expect(mcp.generate).toHaveBeenCalledTimes(1);
    });

    it("does not mint one while OAuth mode is active", () => {
      mountCard(true);

      expect(mcp.generate).not.toHaveBeenCalled();
    });

    it("leaves the snippets on the user's own passcode when minting is unavailable", () => {
      mcp.canGenerate = false;
      const wrapper = mountCard(false);

      expect(mcp.generate).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="ai-integrations-mcp-security"]').exists()).toBe(true);
    });

    it("no longer offers a generate button", () => {
      const wrapper = mountCard(false);

      expect(wrapper.find('[data-test="ai-integrations-mcp-generate-btn"]').exists()).toBe(false);
    });
  });
});
