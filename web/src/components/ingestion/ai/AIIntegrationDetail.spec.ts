// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
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

const credentialMock = vi.hoisted(() => ({ ready: true }));
vi.mock("@/composables/useOrgCredential", async () => {
  const { computed } = await import("vue");
  return { useOrgCredential: () => ({ ready: computed(() => credentialMock.ready) }) };
});

const richMock = vi.hoisted(() => ({ on: false }));
vi.mock("./content/richCard/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content/richCard/registry")>();
  return {
    ...actual,
    getRichCardContent: (...args: Parameters<typeof actual.getRichCardContent>) =>
      richMock.on
        ? ({ provider: { name: "Agno" }, steps: [] } as any)
        : actual.getRichCardContent(...args),
  };
});

import { createMemoryHistory, createRouter } from "vue-router";
import AIIntegrationDetail from "./AIIntegrationDetail.vue";
import store from "@/test/unit/helpers/store";
import { INSTRUMENT_SKILL_URL } from "./codingAgentPrompt";

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: "/", component: { template: "<div />" } }],
});

const CARD_STUB = {
  name: "AIIntegrationCard",
  template: '<div data-test="ai-integration-card-stub" />',
  props: ["content", "docUrl"],
};
const COPY_STUB = {
  name: "CredentialCodeBlock",
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
        plugins: [store, router],
        stubs: { AIIntegrationCard: CARD_STUB, CredentialCodeBlock: COPY_STUB },
      },
    });

  beforeEach(async () => {
    await router.push({ path: "/", query: {} });
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

    it("renders the legacy CredentialCodeBlock snippet", () => {
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

  describe("setup tabs", () => {
    const agentTab = '[data-test="ai-integration-tab-coding-agent"]';
    const agentPanel = '[data-test="ai-coding-agent-setup"]';

    it("opens on the step-by-step card by default", () => {
      wrapper = mountDetail({ categorySlug: "frameworks", integrationSlug: "langchain" });
      expect(wrapper.find('[data-test="ai-integration-card-stub"]').exists()).toBe(true);
      expect(wrapper.find(agentPanel).exists()).toBe(false);
    });

    it("switches to the coding-agent prompt when its tab is clicked", async () => {
      wrapper = mountDetail({ categorySlug: "frameworks", integrationSlug: "langchain" });
      await wrapper.find(agentTab).trigger("mousedown", { button: 0 });
      await wrapper.find(agentTab).trigger("click");
      await flushPromises();
      expect(wrapper.find(agentPanel).exists()).toBe(true);
      expect(wrapper.find('[data-test="ai-integration-card-stub"]').exists()).toBe(false);
    });

    it("preselects the coding-agent tab from ?tab=agent and names the org and stream", async () => {
      await router.push({ path: "/", query: { tab: "agent" } });
      wrapper = mountDetail({ categorySlug: "frameworks", integrationSlug: "langchain" });
      await flushPromises();
      const prompt = wrapper.findComponent({ name: "OCodeBlock" }).props("code") as string;
      const org = store.state.selectedOrganization.identifier;
      expect(prompt).toContain(INSTRUMENT_SKILL_URL);
      expect(prompt).toContain(`org ${org}, stream default.`);
    });

    it("follows a later ?tab change on the same integration", async () => {
      wrapper = mountDetail({ categorySlug: "frameworks", integrationSlug: "langchain" });
      expect(wrapper.find(agentPanel).exists()).toBe(false);
      await router.push({ path: "/", query: { tab: "agent" } });
      await flushPromises();
      expect(wrapper.find(agentPanel).exists()).toBe(true);
    });
  });

  describe("rich card ingest token state", () => {
    const RENDERER_STUB = {
      name: "SetupCardRenderer",
      template: '<div data-test="renderer-stub" />',
      props: ["content", "subs", "tokenState", "logoUrl", "logoUrlDark"],
    };
    const mountRich = () =>
      mount(AIIntegrationDetail, {
        props: { categorySlug: "frameworks", integrationSlug: "agno" },
        global: {
          plugins: [store, router],
          stubs: { SetupCardRenderer: RENDERER_STUB, CodingAgentSetup: true },
        },
      });

    beforeEach(() => {
      richMock.on = true;
      credentialMock.ready = true;
      store.state.organizationData.organizationPasscode = "";
      store.state.organizationData.organizationPasscodeForbidden = false;
    });
    afterEach(() => {
      richMock.on = false;
    });

    it("is loading while the credential has not settled", () => {
      credentialMock.ready = false;
      wrapper = mountRich();
      expect(wrapper.findComponent(RENDERER_STUB).props("tokenState")).toBe("loading");
    });

    it("is unavailable when the read settled without a passcode", () => {
      wrapper = mountRich();
      expect(wrapper.findComponent(RENDERER_STUB).props("tokenState")).toBe("unavailable");
    });

    it("is ready once a passcode exists", () => {
      store.state.organizationData.organizationPasscode = "pass";
      wrapper = mountRich();
      expect(wrapper.findComponent(RENDERER_STUB).props("tokenState")).toBe("ready");
    });
  });
});
