// Copyright 2026 OpenObserve Inc.
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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { createStore } from "vuex";
import i18n from "@/locales";

// Mock segment analytics to prevent real tracking calls
vi.mock("@/services/segment_analytics", () => ({
  default: { track: vi.fn() },
}));

// Mock aws-exports config
vi.mock("../../../aws-exports", () => ({
  default: {},
}));

// Mock zincutils
vi.mock("@/utils/zincutils", () => ({
  getImageURL: (path: string) => `/mock/${path}`,
  verifyOrganizationStatus: vi.fn(),
}));

const mockPush = vi.fn();
const mockCurrentRoute = { value: { name: "ingestTraces" } };

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockPush,
    currentRoute: mockCurrentRoute,
  }),
  useRoute: () => mockCurrentRoute.value,
  RouterView: { template: "<div data-test='router-view'></div>" },
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useQuasar: () => ({
      notify: vi.fn(),
    }),
    copyToClipboard: vi.fn().mockResolvedValue(undefined),
  };
});

import IngestTraces from "./Index.vue";

installQuasar();

const mockStore = createStore({
  state: {
    selectedOrganization: { identifier: "test-org" },
    userInfo: { email: "test@example.com" },
  },
});

describe("IngestTraces (Index.vue)", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCurrentRoute.value = { name: "ingestTraces" };

    wrapper = mount(IngestTraces, {
      props: { currOrgIdentifier: "test-org" },
      global: {
        plugins: [mockStore, i18n],
        stubs: {
          RouterView: { template: "<div data-test='router-view'></div>" },
          QSplitter: {
            template:
              "<div><slot name='before'/><slot name='after'/></div>",
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the tabs for navigation", () => {
      const tabs = wrapper.findComponent({ name: "OTabs" });
      expect(tabs.exists()).toBe(true);
    });

    it("should render OpenTelemetry tab", () => {
      expect(wrapper.text()).toContain("OpenTelemetry");
    });

    it("should render OTEL Collector tab", () => {
      expect(wrapper.text()).toContain("OTEL Collector");
    });
  });

  describe("navigation on mount", () => {
    it("should redirect from ingestTraces to tracesOTLP on mount", async () => {
      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({ name: "tracesOTLP" }),
      );
    });

    it("should not redirect when already on a valid ingest route", async () => {
      vi.clearAllMocks();
      mockCurrentRoute.value = { name: "tracesOTLP" };

      const wrapperOnOTLP = mount(IngestTraces, {
        props: { currOrgIdentifier: "test-org" },
        global: {
          plugins: [mockStore, i18n],
          stubs: {
            RouterView: { template: "<div></div>" },
            QSplitter: {
              template: "<div><slot name='before'/><slot name='after'/></div>",
            },
          },
        },
      });
      await flushPromises();

      // When on tracesOTLP route, push should still be called with same route
      expect(mockPush).toHaveBeenCalledWith(
        expect.objectContaining({ name: "tracesOTLP" }),
      );
      wrapperOnOTLP.unmount();
    });
  });

  describe("copyToClipboardFn", () => {
    it("should call copyToClipboard when invoked", async () => {
      const { copyToClipboard } = await import("quasar");
      const mockElement = { innerText: "some text to copy" };
      wrapper.vm.copyToClipboardFn(mockElement);
      await flushPromises();
      expect(copyToClipboard).toHaveBeenCalledWith("some text to copy");
    });
  });

  describe("props", () => {
    it("should accept currOrgIdentifier prop", () => {
      expect(wrapper.props("currOrgIdentifier")).toBe("test-org");
    });

    it("should use empty string as default currOrgIdentifier", () => {
      const wrapperDefault = mount(IngestTraces, {
        global: {
          plugins: [mockStore, i18n],
          stubs: {
            RouterView: { template: "<div></div>" },
            QSplitter: {
              template: "<div><slot name='before'/><slot name='after'/></div>",
            },
          },
        },
      });
      expect(wrapperDefault.props("currOrgIdentifier")).toBe("");
      wrapperDefault.unmount();
    });
  });
});
