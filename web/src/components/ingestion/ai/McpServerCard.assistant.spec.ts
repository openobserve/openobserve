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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";

import { resetAssistantV2ForTests } from "@/composables/assistant/flags";
import i18n from "@/locales";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "true", isCloud: "false" } }));
vi.mock("@/composables/useMcpCredential", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/composables/useMcpCredential")>()),
  useMcpCredential: () => ({
    generate: vi.fn(),
    generating: ref(false),
    error: ref(""),
    credential: ref(null),
  }),
}));

import McpServerCard from "./McpServerCard.vue";

const blank = { template: "<div />" };

async function mountCard(ssoEnabled: boolean) {
  const router = createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", component: blank },
      { path: "/settings/assistant/:tab?", name: "assistantSettings", component: blank },
    ],
  });
  const w = mount(McpServerCard, {
    props: { subs: { url: "https://o2.example.com", org: "default", token: "t" } },
    global: {
      plugins: [
        i18n,
        router,
        createStore({
          state: {
            zoConfig: { sso_enabled: ssoEnabled },
            selectedOrganization: { identifier: "default" },
          },
        }),
      ],
      stubs: { OCodeBlock: { template: "<div />" } },
    },
  });
  // The client picker is the last tab strip; the auth picker only renders with SSO.
  const strips = w.findAllComponents({ name: "OTabs" });
  await strips[strips.length - 1].vm.$emit("update:modelValue", "cursor");
  await flushPromises();
  return w;
}

beforeEach(() => {
  window.__O2_ASSISTANT_V2__ = true;
  resetAssistantV2ForTests();
});

afterEach(() => {
  delete window.__O2_ASSISTANT_V2__;
  resetAssistantV2ForTests();
});

describe("McpServerCard with the assistant", () => {
  it("names the assistant and links to its toolsets", async () => {
    const w = await mountCard(false);
    expect(w.find('[data-test="mcp-server-assistant-parity"]').text()).toBe(
      "Your agent gets the same tools and permissions as O2 Assistant. Tools O2 Assistant itself can use are set up in Settings › O2 Assistant › Toolsets.",
    );
    expect(w.find('[data-test="mcp-server-assistant-toolsets-link"]').attributes("href")).toBe(
      "/settings/assistant/toolsets?org_identifier=default",
    );
  });

  it("puts Copy configuration first in token mode and discloses the token in the link", async () => {
    const w = await mountCard(false);
    expect(w.find('[data-test="ai-integrations-mcp-copy-config-btn"]').exists()).toBe(true);
    const install = w.find('[data-test="ai-integrations-mcp-install-btn"]');
    const note = w.find('[data-test="ai-integrations-mcp-deeplink-token-note"]');
    expect(note.text()).toBe("This link includes your access token.");
    expect(install.attributes("aria-describedby")).toBe(note.attributes("id"));
  });

  it("shows <your-token> in the snippet and says how to replace it in words", async () => {
    const w = await mountCard(false);
    const codes = w.findAll("[code]").map((block) => block.attributes("code") ?? "");
    expect(codes.some((code) => code.includes("Basic <your-token>"))).toBe(true);
    expect(codes.join("\n")).not.toContain("base64 of service-account-email");
    expect(w.find('[data-test="ai-integrations-mcp-token-placeholder-note"]').text()).toContain(
      "Replace <your-token> with the token you generate above",
    );
  });

  it("keeps the deep link primary with no disclosure in OAuth mode", async () => {
    const w = await mountCard(true);
    expect(w.find('[data-test="ai-integrations-mcp-copy-config-btn"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-integrations-mcp-deeplink-token-note"]').exists()).toBe(false);
    expect(w.find('[data-test="ai-integrations-mcp-install-btn"]').exists()).toBe(true);
  });
});
