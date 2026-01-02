// Copyright 2025 OpenObserve Inc.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { Quasar } from "quasar";
import GoogleWorkspace from "@/components/ingestion/security/GoogleWorkspace.vue";

vi.mock("@/composables/useIngestion", () => ({
  default: vi.fn(() => ({
    endpoint: "https://api.example.com/ingest",
    securityContent: "curl -X POST https://api.example.com/ingest -d '{\"stream\": \"[STREAM_NAME]\"}' ",
    securityDocURLs: { googleworkspace: "https://docs.example.com/googleworkspace" },
  })),
}));

describe("GoogleWorkspace.vue", () => {
  let store: any;
  beforeEach(() => {
    store = createStore({ state: { selectedOrganization: { identifier: "test-org" } } });
  });

  const mountComponent = () => {
    return mount(GoogleWorkspace, {
      global: {
        plugins: [store, Quasar],
        stubs: { CopyContent: { template: '<div data-test="copy-content-stub">{{ content }}</div>', props: ["content"] } },
      },
    });
  };

  it("should render the component", () => {
    expect(mountComponent().exists()).toBe(true);
  });

  it("should render CopyContent component", () => {
    expect(mountComponent().find('[data-test="copy-content-stub"]').exists()).toBe(true);
  });

  it("should render documentation link", () => {
    const wrapper = mountComponent();
    expect(wrapper.find("a").attributes("href")).toBe("https://docs.example.com/googleworkspace");
  });

  it("should replace [STREAM_NAME] with googleworkspace", () => {
    const wrapper = mountComponent();
    const copyContentStub = wrapper.find('[data-test="copy-content-stub"]');
    expect(copyContentStub.text()).toContain("googleworkspace");
    expect(copyContentStub.text()).not.toContain("[STREAM_NAME]");
  });
});
