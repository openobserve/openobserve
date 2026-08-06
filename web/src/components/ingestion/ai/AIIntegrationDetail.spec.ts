// Copyright 2026 OpenObserve Inc.

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/composables/useIngestion", () => ({
  default: () => ({
    aiContent: "mock-ai-content",
    endpoint: { value: { url: "https://api.example.com" } },
  }),
}));

// Empty placement manifest → categories stay as defined in data.ts for these tests.
vi.mock("@/components/ingestion/ai/content/manifest", () => ({
  manifestIntegrations: [],
  manifestCategories: [],
}));

// Content is fetched at build time (no committed snapshot), so stub it here.
vi.mock("./content", () => ({
  getAICardRaw: (slug: string) => {
    if (slug === "langchain") return "# LangChain\n\nbody";
    if (slug === "openai")
      return "# OpenAI — Data Sources UI panel content\n\n## Card metadata\n\n| Field | Value |\n|---|---|\n| Display name | OpenAI |\n";
    return undefined;
  },
}));

import AIIntegrationDetail from "./AIIntegrationDetail.vue";
import store from "@/test/unit/helpers/store";

const CARD_STUB = {
  name: "AIIntegrationCard",
  template: '<div data-test="ai-integration-card-stub" />',
  props: ["content", "docUrl"],
};
const COPY_STUB = {
  name: "CopyContent",
  template: '<div data-test="ai-integration-detail-copy-content"><slot /></div>',
  props: ["content"],
};

describe("AIIntegrationDetail", () => {
  let wrapper: VueWrapper;

  const mountDetail = (
    props: { categorySlug: string; integrationSlug: string } = {
      categorySlug: "frameworks",
      integrationSlug: "agno",
    },
  ) =>
    mount(AIIntegrationDetail, {
      props,
      global: {
        plugins: [store],
        stubs: { AIIntegrationCard: CARD_STUB, CopyContent: COPY_STUB },
      },
    });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("legacy fallback (integration without rich content)", () => {
    beforeEach(() => {
      wrapper = mountDetail({
        categorySlug: "frameworks",
        integrationSlug: "agno",
      });
    });

    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the legacy CopyContent snippet", () => {
      expect(wrapper.find('[data-test="ai-integration-detail-copy-content"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="ai-integration-card-stub"]').exists()).toBe(false);
    });

    it("renders the documentation link", () => {
      const link = wrapper.find("a");
      expect(link.attributes("href")).toBe(
        "https://openobserve.ai/docs/integration/ai/frameworks/agno/",
      );
      expect(link.attributes("target")).toBe("_blank");
    });
  });

  describe("rich card (integration with bundled content)", () => {
    it("renders AIIntegrationCard for a direct-slug match (langchain)", () => {
      wrapper = mountDetail({
        categorySlug: "frameworks",
        integrationSlug: "langchain",
      });
      expect(wrapper.find('[data-test="ai-integration-card-stub"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="ai-integration-detail-copy-content"]').exists()).toBe(false);
    });

    it("resolves content via contentSlug alias (openai-python → openai)", () => {
      wrapper = mountDetail({
        categorySlug: "model-providers",
        integrationSlug: "openai-python",
      });
      const card = wrapper.findComponent(CARD_STUB);
      expect(card.exists()).toBe(true);
      expect(card.props("content")).toContain("OpenAI");
    });
  });

  describe("when integration is not found", () => {
    it("shows the select prompt", () => {
      wrapper = mountDetail({
        categorySlug: "nonexistent",
        integrationSlug: "nonexistent",
      });
      expect(wrapper.find("a").exists()).toBe(false);
      expect(wrapper.text()).toContain("Select an integration to view details.");
    });
  });
});
