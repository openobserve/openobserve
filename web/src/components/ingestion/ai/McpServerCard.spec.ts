// Copyright 2026 OpenObserve Inc.

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, afterEach, vi } from "vitest";
import { createStore } from "vuex";

// Non-enterprise: OAuth discovery is compiled out, so token mode is the default and
// the snippets under test are the Basic-auth ones.
vi.mock("@/aws-exports", () => ({
  default: { isEnterprise: "false", isCloud: "false" },
}));

import McpServerCard from "./McpServerCard.vue";

const COPY_STUB = {
  name: "CopyContent",
  template: '<div data-test="copy-stub">{{ content }}</div>',
  props: ["content", "displayContent"],
};

const makeStore = (zoConfig: Record<string, unknown>) =>
  createStore({
    state: {
      userInfo: { email: "poc@openobserve.ai" },
      organizationData: { organizationPasscode: "o2oi_orgingesttoken" },
      selectedOrganization: { identifier: "default" },
      zoConfig,
    },
  });

describe("McpServerCard", () => {
  let wrapper: VueWrapper;

  const mountCard = (zoConfig: Record<string, unknown> = { service_account_enabled: true }) =>
    mount(McpServerCard, {
      props: { subs: { url: "https://groupon.openobserve.ai", org: "default", token: "" } },
      global: { plugins: [makeStore(zoConfig)], stubs: { CopyContent: COPY_STUB } },
    });

  const snippets = () => wrapper.findAll('[data-test="copy-stub"]').map((c) => c.text());

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  it("never emits the org ingestion passcode placeholder into a snippet", () => {
    wrapper = mountCard();
    // [BASIC_PASSCODE] expands to base64(email:o2oi_…), which /mcp rejects.
    expect(wrapper.text()).not.toContain("BASIC_PASSCODE");
  });

  it("keeps the Authorization header name in the Claude Code snippet", () => {
    wrapper = mountCard();
    const snippet = snippets().find((c) => c.includes("claude mcp add"));
    expect(snippet).toBeTruthy();
    expect(snippet).toContain('--header "Authorization: Basic ');
  });

  it("offers credential generation when rbac is off but service accounts are on", () => {
    wrapper = mountCard({ rbac_enabled: false, service_account_enabled: true });
    expect(wrapper.find('[data-test="ai-integrations-mcp-generate-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="ai-integrations-mcp-credential-unavailable"]').exists()).toBe(
      false,
    );
  });

  it("explains the gap when service accounts are disabled", () => {
    wrapper = mountCard({ rbac_enabled: true, service_account_enabled: false });
    expect(wrapper.find('[data-test="ai-integrations-mcp-generate-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="ai-integrations-mcp-credential-unavailable"]').exists()).toBe(
      true,
    );
  });
});
