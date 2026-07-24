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
// Render tests for PrivateLocationDetail.vue — private location detail page.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";

const $t = (key: string) => key;

// ── Mock functions hoisted so vi.mock factories can reference them ────────
const { mockServiceGetLocation, mockServiceGetAgentSetup, mockRouterPush } = vi.hoisted(() => ({
  mockServiceGetLocation: vi.fn().mockResolvedValue({
    data: {
      id: "loc-1",
      label: "US West Private",
      status: "online",
      live_agents: 2,
      agents_total: 3,
      monitors_count: 5,
      checks_per_min: 12,
      version: "1.2.3",
      pool: "default",
      last_seen_at: 1700000000000000,
      agents: [],
      checks: [],
    },
  }),
  mockServiceGetAgentSetup: vi.fn().mockResolvedValue({
    data: { install: "curl ...", token: "abc123" },
  }),
  mockRouterPush: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────
vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: $t })),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: { id: "loc-1" },
    query: {},
  }),
  useRouter: () => ({
    push: mockRouterPush,
    replace: vi.fn(),
  }),
}));

vi.mock("@/services/synthetics", () => ({
  default: {
    getLocation: mockServiceGetLocation,
    getAgentSetup: mockServiceGetAgentSetup,
  },
}));

vi.mock("@/utils/synthetics/format", () => ({
  formatTimeAgoUs: vi.fn(() => "2 hours ago"),
  formatIntervalSecs: vi.fn(() => "5m"),
}));

vi.mock("@/lib/core/Badge/badgeGroups", () => ({
  resolveBadge: vi.fn(() => ({ variant: "success", label: "Passed" })),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

import PrivateLocationDetail from "./PrivateLocationDetail.vue";

// ── Stubs ────────────────────────────────────────────────────────────────
const baseStubs = {
  OTable: {
    template: "<div :data-test=\"$attrs['data-test']\"><slot /></div>",
    props: [
      "data",
      "columns",
      "rowKey",
      "pagination",
      "pageSize",
      "showGlobalFilter",
      "emptyMessage",
    ],
    inheritAttrs: true,
  },
  OButton: {
    template: '<button :data-test="$attrs[\'data-test\']" :disabled="disabled"><slot /></button>',
    props: ["variant", "size", "iconLeft", "disabled", "loading", "title"],
    inheritAttrs: true,
  },
  OBadge: {
    template: '<span class="obadge-stub"><slot /></span>',
    props: ["variant", "size", "icon", "dot"],
  },
  OTag: {
    template: '<span class="otag-stub"><slot /></span>',
    props: ["size", "shape", "variant"],
  },
  OIcon: {
    template: "<span />",
    props: ["name", "size"],
  },
  OEmptyState: {
    template: '<div :data-test="$attrs[\'data-test\']"><slot name="actions" /></div>',
    props: ["preset", "size", "title"],
    inheritAttrs: true,
  },
  BetaBadge: {
    template: '<span data-test="beta-badge">BETA</span>',
  },
  AgentSetupDrawer: {
    template: '<div data-test="synthetics-private-location-agent-setup-drawer" />',
    props: [
      "open",
      "install",
      "locationName",
      "locationId",
      "agentName",
      "token",
      "org",
      "o2Url",
      "scriptUrl",
    ],
  },
};

function mountPage() {
  return mount(PrivateLocationDetail, {
    global: {
      plugins: [store],
      stubs: baseStubs,
    },
  });
}

describe("PrivateLocationDetail", () => {
  let wrapper: VueWrapper;

  const defaultDetail = {
    data: {
      id: "loc-1",
      label: "US West Private",
      status: "online",
      live_agents: 2,
      agents_total: 3,
      monitors_count: 5,
      checks_per_min: 12,
      version: "1.2.3",
      pool: "default",
      last_seen_at: 1700000000000000,
      agents: [],
      checks: [],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceGetLocation.mockResolvedValue(defaultDetail);
    mockServiceGetAgentSetup.mockResolvedValue({
      data: { install: "curl ...", token: "abc123" },
    });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render the page shell", () => {
      wrapper = mountPage();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the Beta badge in the page title", () => {
      wrapper = mountPage();
      expect(wrapper.find('[data-test="beta-badge"]').exists()).toBe(true);
    });

    it("should render the status badge when detail is loaded", async () => {
      wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find(".obadge-stub").exists()).toBe(true);
      expect(wrapper.find(".obadge-stub").text()).toBe("synthetics.privateLocations.status.online");
    });

    it("should render the copy setup command button", async () => {
      wrapper = mountPage();
      await flushPromises();

      expect(
        wrapper.find('[data-test="synthetics-private-location-detail-setup-btn"]').exists(),
      ).toBe(true);
    });

    it("should render the refresh button", async () => {
      wrapper = mountPage();
      await flushPromises();

      expect(
        wrapper.find('[data-test="synthetics-private-location-detail-refresh-btn"]').exists(),
      ).toBe(true);
    });
  });

  describe("data loading", () => {
    it("should call getLocation on mount with org identifier and route param id", async () => {
      wrapper = mountPage();
      await flushPromises();

      expect(mockServiceGetLocation).toHaveBeenCalledWith("default", "loc-1");
    });

    it("should render the detail summary strip after data loads", async () => {
      wrapper = mountPage();
      await flushPromises();

      expect(wrapper.text()).toContain("US West Private");
    });
  });

  describe("empty state", () => {
    it("should render OEmptyState when detail is null", async () => {
      mockServiceGetLocation.mockResolvedValue({ data: null });
      wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-private-location-detail-empty"]').exists()).toBe(
        true,
      );
    });
  });

  describe("setup drawer", () => {
    it("should open setup drawer and fetch agent setup when copy setup button is clicked", async () => {
      wrapper = mountPage();
      await flushPromises();

      const setupBtn = wrapper.find('[data-test="synthetics-private-location-detail-setup-btn"]');
      await setupBtn.trigger("click");
      await flushPromises();

      expect(mockServiceGetAgentSetup).toHaveBeenCalled();
    });
  });

  describe("navigation", () => {
    it("should navigate to monitor results when openMonitor is called", async () => {
      wrapper = mountPage();
      await flushPromises();

      (wrapper.vm as any).openMonitor({ id: "check-123", name: "Test Check" });
      expect(mockRouterPush).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "synthetic-monitor-results",
          params: { id: "check-123" },
        }),
      );
    });
  });
});
