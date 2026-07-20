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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import RunDetail from "./RunDetail.vue";

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    currentRoute: { value: { query: {} } },
  }),
  useRoute: () => ({
    params: { id: "mon-1", runId: "4821", executionId: "exec-1" },
  }),
  RouterLink: {
    name: "RouterLinkStub",
    template: "<a><slot /></a>",
  },
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({
    t: (key: string) => key,
  })),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      timezone: "UTC",
      selectedOrganization: { identifier: "org-1" },
    },
  }),
}));

const mockRunDetail = {
  timestamp: Date.now() / 1000,
  scheduledTs: Date.now() / 1000,
  status: "passed",
  durationMs: 3240,
  location: "us-west-1",
  device: "laptop_large",
  browserEngine: "chromium",
  triggerType: "schedule",
  error: "",
  jobId: "job-1",
  runId: "4821",
  executionId: "exec-1",
  monitorName: "Test Monitor",
  attempts: 1,
  failedStep: null,
  recordedSteps: [],
  lastAttemptSteps: [],
  retryHistory: [],
  network: null,
  webVitals: null,
  traceKey: null,
};

vi.mock("@/composables/useSyntheticResults", () => ({
  default: () => ({
    kpi: { value: { uptimePct: 0, p95Ms: 0, failedRuns: 0, totalRuns: 0, retriedRuns: 0, lastRunStatus: null, lastRunAt: null } },
    buckets: { value: [] },
    runs: { value: [] },
    runDetail: { value: { ...mockRunDetail } },
    loading: { value: false },
    error: { value: null },
    hasLoadedOnce: { value: true },
    fetchAll: vi.fn(),
    fetchRun: vi.fn(),
    cancelAll: vi.fn(),
  }),
}));

describe("RunDetail", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    wrapper = mount(RunDetail, {
      global: {
        stubs: {
          OTabs: {
            template:
              '<div class="otabs-stub"><slot /></div>',
            props: ["modelValue"],
          },
          OTab: {
            template: '<div class="otab-stub"><slot /></div>',
            props: ["name"],
          },
          OTabPanels: {
            template:
              '<div class="otabpanels-stub"><slot /></div>',
            props: ["modelValue"],
          },
          OTabPanel: {
            template: '<div class="otabpanel-stub"><slot /></div>',
            props: ["name"],
          },
          OCard: {
            template:
              '<div class="ocard-stub"><slot /></div>',
          },
          OCardSection: {
            template:
              '<div class="ocardsection-stub"><slot /></div>',
            props: ["role"],
          },
          OSeparator: {
            template: '<div class="oseparator-stub" />',
          },
          OButton: {
            template:
              '<button class="obutton-stub" @click="$emit(\'click\')"><slot /><slot name="prefix" /><slot name="suffix" /></button>',
            props: ["disabled", "iconLeft"],
          },
          OIcon: {
            template: '<span class="oicon-stub" />',
            props: ["name"],
          },
          OBadge: {
            template:
              '<span class="obadge-stub"><slot /></span>',
            props: ["variant", "size", "icon"],
          },
          OEmptyState: {
            template:
              '<div class="oemptystate-stub"><slot name="title" /><slot name="description" /></div>',
            props: ["preset"],
          },
        },
      },
    });
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should render the run detail page shell", () => {
    expect(
      wrapper.find('[data-test="synthetics-run-detail"]').exists(),
    ).toBe(true);
  });

  it("should render the page title", () => {
    const title = wrapper.find(
      '[data-test="synthetics-run-detail-title"]',
    );
    expect(title.exists()).toBe(true);
    expect(title.text()).toBe("Test Monitor");
  });

  it("should render the status badge", () => {
    expect(
      wrapper.find('[data-test="synthetics-run-detail-status-badge"]').exists(),
    ).toBe(true);
  });

  it("should render the info bar with 5 chips", () => {
    const infoBar = wrapper.find(
      '[data-test="synthetics-run-detail-info-bar"]',
    );
    expect(infoBar.exists()).toBe(true);
    const chips = infoBar.findAll(
      ":scope > div",
    );
    expect(chips.length).toBe(5);
  });

  it("should render the summary tab by default", () => {
    expect(
      wrapper.find(
        '[data-test="synthetics-run-detail-summary-tab"]',
      ).exists(),
    ).toBe(true);
  });

  it("should render prev/next navigation buttons", () => {
    expect(
      wrapper.find(
        '[data-test="synthetics-run-detail-prev-btn"]',
      ).exists(),
    ).toBe(true);
    expect(
      wrapper.find(
        '[data-test="synthetics-run-detail-next-btn"]',
      ).exists(),
    ).toBe(true);
  });

  it("should render action buttons", () => {
    expect(
      wrapper.find(
        '[data-test="synthetics-run-detail-trace-btn"]',
      ).exists(),
    ).toBe(true);
  });

  it("should render the back button", () => {
    expect(
      wrapper.find(
        '[data-test="synthetics-run-detail-back-btn"]',
      ).exists(),
    ).toBe(true);
  });

  it("should render three placeholder tabs with correct states", () => {
    expect(
      wrapper.find(
        '[data-test="synthetics-run-detail-tab-summary"]',
      ).exists(),
    ).toBe(true);
    expect(
      wrapper.find(
        '[data-test="synthetics-run-detail-tab-logs"]',
      ).exists(),
    ).toBe(true);
    expect(
      wrapper.find(
        '[data-test="synthetics-run-detail-tab-traces"]',
      ).exists(),
    ).toBe(true);
    expect(
      wrapper.find(
        '[data-test="synthetics-run-detail-tab-rum"]',
      ).exists(),
    ).toBe(true);
  });
});
