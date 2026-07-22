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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";

// ── Mocks (hoisted by Vitest) ──────────────────────────────────────────────

const mockPush = vi.fn();
const mockRouteQuery: Record<string, string | string[] | undefined> = {};
const mockRouteParams: Record<string, string | string[] | undefined> = {};

vi.mock("vue-router", () => ({
  useRoute: () => ({ query: mockRouteQuery, params: mockRouteParams }),
  useRouter: () => ({ push: mockPush }),
  RouterLink: { name: "RouterLinkStub", template: "<a><slot /></a>" },
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      timezone: "UTC",
      selectedOrganization: { identifier: "org-1" },
    },
  }),
}));

// syntheticsService mock — get() is called in edit mode
vi.mock("@/services/synthetics", () => ({
  default: {
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
    delete: vi.fn(),
    enable: vi.fn(),
    run: vi.fn(),
    getRuns: vi.fn(),
    getRun: vi.fn(),
    getLocations: vi.fn(),
  },
}));

// ── After mocks are hoisted, import the component ──────────────────────────

import CreateCheck from "./CreateCheck.vue";
import syntheticsService from "@/services/synthetics";

// Keep as any — we assert via `vi.mocked()`
const mockedService = syntheticsService as any;

// ── Mount factory ──────────────────────────────────────────────────────────

function makeWrapper() {
  return mount(CreateCheck, {
    global: {
      plugins: [i18n],
      stubs: {
        CreateBrowserTestSkeleton: {
          template: '<div data-test="create-browser-test-skeleton" />',
          props: ["rows"],
        },
        CreateBrowserTest: {
          template: '<div data-test="create-browser-test" />',
        },
        CreateProtocolCheck: {
          template:
            '<div data-test="create-protocol-check"><span data-test="protocol-check-type">{{ checkType }}</span><span data-test="protocol-edit-id">{{ editId }}</span></div>',
          props: ["checkType", "editId"],
        },
      },
    },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("CreateCheck", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset route state
    Object.keys(mockRouteQuery).forEach((k) => delete mockRouteQuery[k]);
    Object.keys(mockRouteParams).forEach((k) => delete mockRouteParams[k]);
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("create mode — browser type", () => {
    it("should render CreateBrowserTest when type=browser in route query", async () => {
      mockRouteQuery.type = "browser";
      wrapper = makeWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="create-browser-test"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="create-protocol-check"]').exists(),
      ).toBe(false);
      expect(
        wrapper.find('[data-test="create-browser-test-skeleton"]').exists(),
      ).toBe(false);
    });

    it("should default to CreateBrowserTest when no type query param is present", async () => {
      wrapper = makeWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="create-browser-test"]').exists(),
      ).toBe(true);
    });

    it("should default to CreateBrowserTest when type query param is an unknown value", async () => {
      mockRouteQuery.type = "unknown-check-type";
      wrapper = makeWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="create-browser-test"]').exists(),
      ).toBe(true);
    });
  });

  describe("create mode — protocol types", () => {
    it("should render CreateProtocolCheck when type=http in route query", async () => {
      mockRouteQuery.type = "http";
      wrapper = makeWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="create-protocol-check"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="protocol-check-type"]').text(),
      ).toBe("http");
    });

    it("should render CreateProtocolCheck when type=tcp in route query", async () => {
      mockRouteQuery.type = "tcp";
      wrapper = makeWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="create-protocol-check"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="protocol-check-type"]').text(),
      ).toBe("tcp");
    });

    it("should render CreateProtocolCheck when type=tls in route query", async () => {
      mockRouteQuery.type = "tls";
      wrapper = makeWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="create-protocol-check"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="protocol-check-type"]').text(),
      ).toBe("tls");
    });

    it("should render CreateProtocolCheck when type=ssh in route query", async () => {
      mockRouteQuery.type = "ssh";
      wrapper = makeWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="create-protocol-check"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="protocol-check-type"]').text(),
      ).toBe("ssh");
    });
  });

  describe("edit mode", () => {
    it("should show skeleton while resolving the type (before service responds)", () => {
      mockRouteParams.id = "mon-http-1";
      // Don't await — check the immediate render before the promise resolves
      wrapper = makeWrapper();

      expect(
        wrapper.find('[data-test="create-browser-test-skeleton"]').exists(),
      ).toBe(true);
    });

    it("should render CreateProtocolCheck after resolving edit monitor type from API", async () => {
      mockRouteParams.id = "mon-tcp-1";
      vi.mocked(mockedService.get).mockResolvedValueOnce({
        data: { type: "tcp", name: "TCP Monitor", id: "mon-tcp-1" },
      });

      wrapper = makeWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="create-protocol-check"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="protocol-check-type"]').text(),
      ).toBe("tcp");
      expect(
        wrapper.find('[data-test="protocol-edit-id"]').text(),
      ).toBe("mon-tcp-1");
      // Service was called with correct args
      expect(mockedService.get).toHaveBeenCalledWith("org-1", "mon-tcp-1");
    });

    it("should default to CreateBrowserTest when edit monitor has an unknown type", async () => {
      mockRouteParams.id = "mon-unknown-1";
      vi.mocked(mockedService.get).mockResolvedValueOnce({
        data: { type: "bizarre-type", name: "Unknown Monitor", id: "mon-unknown-1" },
      });

      wrapper = makeWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="create-browser-test"]').exists(),
      ).toBe(true);
    });

    it("should default to CreateBrowserTest when the API call fails", async () => {
      mockRouteParams.id = "mon-non-existent";
      vi.mocked(mockedService.get).mockRejectedValueOnce(new Error("Not found"));

      wrapper = makeWrapper();
      await flushPromises();

      // Falls back to browser on error
      expect(
        wrapper.find('[data-test="create-browser-test"]').exists(),
      ).toBe(true);
    });

    it("should pass edit-id to CreateProtocolCheck when resolving a protocol monitor", async () => {
      mockRouteParams.id = "proto-http-1";
      vi.mocked(mockedService.get).mockResolvedValueOnce({
        data: { type: "http", name: "HTTP Monitor", id: "proto-http-1" },
      });

      wrapper = makeWrapper();
      await flushPromises();

      expect(
        wrapper.find('[data-test="protocol-edit-id"]').text(),
      ).toBe("proto-http-1");
    });
  });
});
