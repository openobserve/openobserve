// Copyright 2026 OpenObserve Inc.

import { mount, VueWrapper } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

installQuasar();

vi.mock("@/composables/useIngestion", () => ({
  default: () => ({ aiContent: "mock-ai-content" }),
}));

import AIIntegrationDetail from "./AIIntegrationDetail.vue";

describe("AIIntegrationDetail", () => {
  let wrapper: VueWrapper;

  const mountDetail = (
    props: { categorySlug: string; integrationSlug: string } = {
      categorySlug: "frameworks",
      integrationSlug: "agno",
    },
  ) => {
    return mount(AIIntegrationDetail, {
      props,
      global: {
        stubs: {
          CopyContent: {
            template:
              '<div data-test="ai-integration-detail-copy-content"><slot /></div>',
            props: ["content"],
          },
        },
      },
    });
  };

  beforeEach(() => {
    wrapper = mountDetail();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("initial render", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render copy content when integration found", () => {
      expect(
        wrapper
          .find('[data-test="ai-integration-detail-copy-content"]')
          .exists(),
      ).toBe(true);
    });

    it("should render documentation link", () => {
      const link = wrapper.find("a");
      expect(link.exists()).toBe(true);
      expect(link.attributes("href")).toBe(
        "https://openobserve.ai/docs/integration/ai/frameworks/agno/",
      );
      expect(link.attributes("target")).toBe("_blank");
    });
  });

  describe("when integration is not found", () => {
    it("should show select prompt for invalid category", () => {
      const emptyWrapper = mountDetail({
        categorySlug: "nonexistent",
        integrationSlug: "nonexistent",
      });

      expect(emptyWrapper.find("a").exists()).toBe(false);
      expect(emptyWrapper.text()).toContain(
        "Select an integration to view details.",
      );
      emptyWrapper.unmount();
    });
  });

  describe("display name", () => {
    it("should fall back to integrationSlug when integration not found", () => {
      const emptyWrapper = mountDetail({
        categorySlug: "frameworks",
        integrationSlug: "unknown-integration",
      });

      expect(emptyWrapper.vm.displayName).toBe("unknown-integration");
      emptyWrapper.unmount();
    });
  });

  describe("with different integrations", () => {
    it("should render correct doc URL for model provider", () => {
      const providerWrapper = mountDetail({
        categorySlug: "model-providers",
        integrationSlug: "openai-python",
      });

      const link = providerWrapper.find("a");
      expect(link.attributes("href")).toBe(
        "https://openobserve.ai/docs/integration/ai/providers/openai/",
      );
      providerWrapper.unmount();
    });

    it("should render correct doc URL for gateway", () => {
      const gatewayWrapper = mountDetail({
        categorySlug: "gateways",
        integrationSlug: "litellm-proxy",
      });

      const link = gatewayWrapper.find("a");
      expect(link.attributes("href")).toBe(
        "https://openobserve.ai/docs/integration/ai/gateways/litellm-proxy/",
      );
      gatewayWrapper.unmount();
    });
  });
});
