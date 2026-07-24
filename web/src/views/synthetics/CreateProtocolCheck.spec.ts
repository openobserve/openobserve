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

// @vitest-environment jsdom
//
// Render tests for CreateProtocolCheck.vue — protocol check (HTTP/TCP/TLS/SSH)
// creation/editing page.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";

const $t = (key: string) => key;

const {
  mockServiceGetLocations,
  mockServiceCreate,
  mockServiceUpdate,
  mockServiceGet,
  mockRouterPush,
} = vi.hoisted(() => ({
  mockServiceGetLocations: vi.fn().mockResolvedValue({
    data: { locations: [] },
  }),
  mockServiceCreate: vi.fn().mockResolvedValue({ data: { id: "proto-check-1" } }),
  mockServiceUpdate: vi.fn().mockResolvedValue({}),
  mockServiceGet: vi.fn().mockResolvedValue({ data: {} }),
  mockRouterPush: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: $t })),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: {},
    query: {},
  }),
  useRouter: () => ({
    push: mockRouterPush,
    replace: vi.fn(),
  }),
  onBeforeRouteLeave: vi.fn(),
}));

vi.mock("@/services/synthetics", () => ({
  default: {
    getLocations: mockServiceGetLocations,
    create: mockServiceCreate,
    update: mockServiceUpdate,
    get: mockServiceGet,
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: {
    list: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

vi.mock("@/utils/synthetics/buildPayload", () => ({
  buildCreateProtocolCheckPayload: vi.fn((data: any) => data),
  defaultProtocolConfig: vi.fn(() => ({})),
  mapResponseToProtocolCheck: vi.fn((data: any) => data),
}));

import CreateProtocolCheck from "./CreateProtocolCheck.vue";

// ── Stubs ────────────────────────────────────────────────────────────────
const baseStubs = {
  OPageHeader: {
    template: '<div data-test="synthetics-header"><slot /></div>',
    props: ["title", "subtitle", "back"],
  },
  OButton: {
    template:
      '<button :data-test="$attrs[\'data-test\']" :disabled="disabled"><slot name="prefix" /><slot name="suffix" /><slot /></button>',
    props: ["variant", "size", "disabled", "loading", "class", "iconLeft"],
    inheritAttrs: true,
  },
  OIcon: {
    template: "<span />",
    props: ["name", "size", "class"],
  },
  ODialog: {
    template: '<div v-if="open" :data-test="$attrs[\'data-test\']"><slot /></div>',
    props: ["open", "size", "title", "primaryButtonLabel", "secondaryButtonLabel"],
    emits: ["click:primary", "click:secondary", "update:open"],
    inheritAttrs: true,
  },
  CheckConfigure: {
    template: '<div data-test="synthetics-check-configure"><slot name="type-config" /></div>',
    props: ["check", "checkType", "locations", "destinations", "folders", "class"],
  },
  CreateBrowserTestSkeleton: {
    template: '<div data-test="synthetics-loading-skeleton" />',
    props: ["rows"],
  },
  CheckHttpConfig: {
    template: '<div data-test="synthetics-http-config" />',
    props: ["check"],
  },
  CheckTcpConfig: {
    template: '<div data-test="synthetics-tcp-config" />',
    props: ["check"],
  },
  CheckTlsConfig: {
    template: '<div data-test="synthetics-tls-config" />',
    props: ["check"],
  },
  CheckSshConfig: {
    template: '<div data-test="synthetics-ssh-config" />',
    props: ["check"],
  },
};

function mountPage(checkType: "http" | "tcp" | "tls" | "ssh" = "http", editId?: string) {
  return mount(CreateProtocolCheck, {
    props: {
      checkType,
      editId,
    },
    global: {
      plugins: [store],
      stubs: baseStubs,
    },
  });
}

describe("CreateProtocolCheck", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceGetLocations.mockResolvedValue({
      data: { locations: [] },
    });
    mockServiceCreate.mockResolvedValue({ data: { id: "proto-check-1" } });
    mockServiceUpdate.mockResolvedValue({});
    mockServiceGet.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render the protocol check form with check type HTTP", async () => {
      wrapper = mountPage("http");
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-check-configure"]').exists()).toBe(true);
    });

    it("should render the cancel and save buttons in the footer", async () => {
      wrapper = mountPage("http");
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-create-cancel-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-create-save-btn"]').exists()).toBe(true);
    });
  });

  describe("type-specific config", () => {
    it("should render HTTP config when checkType is http", async () => {
      wrapper = mountPage("http");
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-http-config"]').exists()).toBe(true);
    });

    it("should render TCP config when checkType is tcp", async () => {
      wrapper = mountPage("tcp");
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-tcp-config"]').exists()).toBe(true);
    });

    it("should render TLS config when checkType is tls", async () => {
      wrapper = mountPage("tls");
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-tls-config"]').exists()).toBe(true);
    });

    it("should render SSH config when checkType is ssh", async () => {
      wrapper = mountPage("ssh");
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-ssh-config"]').exists()).toBe(true);
    });
  });

  describe("save functionality", () => {
    it("should call syntheticsService.create on save when not editing", async () => {
      wrapper = mountPage("http");
      await flushPromises();

      const saveBtn = wrapper.find('[data-test="synthetics-create-save-btn"]');
      await saveBtn.trigger("click");
      await flushPromises();

      expect(mockServiceCreate).toHaveBeenCalled();
    });

    it("should call syntheticsService.update on save when editing", async () => {
      wrapper = mountPage("http", "edit-id-123");
      await flushPromises();

      const saveBtn = wrapper.find('[data-test="synthetics-create-save-btn"]');
      await saveBtn.trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).toHaveBeenCalled();
      // The second argument should be the edit ID
      const callArgs = mockServiceUpdate.mock.calls[0];
      expect(callArgs[1]).toBe("edit-id-123");
    });
  });
});
