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
import Falco from "@/components/ingestion/security/Falco.vue";

// Mock useIngestion composable
vi.mock("@/composables/useIngestion", () => ({
  default: vi.fn(() => ({
    endpoint: "https://api.example.com/ingest",
    securityContent: "curl -X POST https://api.example.com/ingest -d '{\"stream\": \"[STREAM_NAME]\"}' ",
    securityDocURLs: {
      falco: "https://docs.example.com/falco",
    },
  })),
}));

describe("Falco.vue", () => {
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
    return mount(Falco, {
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

  it("should render the component", () => {
    const wrapper = mountComponent();
    expect(wrapper.exists()).toBe(true);
  });

  it("should render CopyContent component", () => {
    const wrapper = mountComponent();
    expect(wrapper.find('[data-test="copy-content-stub"]').exists()).toBe(true);
  });

  it("should render documentation link with correct href", () => {
    const wrapper = mountComponent();
    const link = wrapper.find("a");
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toBe("https://docs.example.com/falco");
  });

  it("should replace [STREAM_NAME] with falco", () => {
    const wrapper = mountComponent();
    const copyContentStub = wrapper.find('[data-test="copy-content-stub"]');
    expect(copyContentStub.text()).toContain("falco");
    expect(copyContentStub.text()).not.toContain("[STREAM_NAME]");
  });
});
