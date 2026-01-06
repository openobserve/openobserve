// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createStore } from "vuex";
import { Quasar } from "quasar";
import Okta from "@/components/ingestion/security/Okta.vue";

// Mock useIngestion composable
vi.mock("@/composables/useIngestion", () => ({
  default: vi.fn(() => ({
    endpoint: "https://api.example.com/ingest",
    securityContent: "curl -X POST https://api.example.com/ingest -d '{\"stream\": \"[STREAM_NAME]\"}' ",
    securityDocURLs: {
      okta: "https://docs.example.com/okta",
      falco: "https://docs.example.com/falco",
      googleworkspace: "https://docs.example.com/googleworkspace",
      jumpcloud: "https://docs.example.com/jumpcloud",
      osquery: "https://docs.example.com/osquery",
      office365: "https://docs.example.com/office365",
      openvpn: "https://docs.example.com/openvpn",
    },
  })),
}));

describe("Okta.vue", () => {
  let store: any;

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
      },
    });
  });

  const mountComponent = () => {
    return mount(Okta, {
      global: {
        plugins: [store, Quasar],
        stubs: {
          CopyContent: {
            template: '<div data-test="copy-content-stub">{{ content }}</div>',
            props: ["content"],
          },
        },
      },
    });
  };

  describe("rendering", () => {
    it("should render the component", () => {
      const wrapper = mountComponent();

      expect(wrapper.exists()).toBe(true);
    });

    it("should render CopyContent component", () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-test="copy-content-stub"]').exists()).toBe(true);
    });

    it("should render documentation link", () => {
      const wrapper = mountComponent();

      const link = wrapper.find("a");
      expect(link.exists()).toBe(true);
      expect(link.attributes("href")).toBe("https://docs.example.com/okta");
      expect(link.attributes("target")).toBe("_blank");
    });

    it("should have correct link text", () => {
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain("Click");
      expect(wrapper.text()).toContain("here");
      expect(wrapper.text()).toContain("to check further documentation");
    });
  });

  describe("content processing", () => {
    it("should replace [STREAM_NAME] placeholder with okta", () => {
      const wrapper = mountComponent();
      const copyContentStub = wrapper.find('[data-test="copy-content-stub"]');

      expect(copyContentStub.text()).toContain("okta");
      expect(copyContentStub.text()).not.toContain("[STREAM_NAME]");
    });
  });

  describe("styling", () => {
    it("should apply padding class", () => {
      const wrapper = mountComponent();

      expect(wrapper.find(".q-pa-sm").exists()).toBe(true);
    });

    it("should have link styling", () => {
      const wrapper = mountComponent();

      const link = wrapper.find("a");
      expect(link.classes()).toContain("text-blue-500");
      expect(link.classes()).toContain("hover:text-blue-600");
      expect(link.attributes("style")).toContain("text-decoration: underline");
    });
  });
});
