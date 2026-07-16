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
// Render tests for SyntheticMonitoring.vue — the main synthetics list page.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";

const $t = (key: string) => key;

// ── Mock functions hoisted so vi.mock factories can reference them ────────
const {
  mockServiceList,
  mockServiceEnable,
  mockServiceDelete,
  mockServiceBulkDelete,
  mockServiceRun,
  mockServiceGet,
  mockServiceCreate,
  mockServiceGetLocations,
  mockRouterPush,
} = vi.hoisted(() => ({
  mockServiceList: vi.fn().mockResolvedValue({ data: { monitors: [] } }),
  mockServiceEnable: vi.fn().mockResolvedValue({}),
  mockServiceDelete: vi.fn().mockResolvedValue({}),
  mockServiceBulkDelete: vi.fn().mockResolvedValue({}),
  mockServiceRun: vi.fn().mockResolvedValue({}),
  mockServiceGet: vi.fn().mockResolvedValue({ data: {} }),
  mockServiceCreate: vi.fn().mockResolvedValue({ data: { id: "new-1" } }),
  mockServiceGetLocations: vi.fn().mockResolvedValue({ data: { locations: [] } }),
  mockRouterPush: vi.fn(),
}));

// ── Module mocks ─────────────────────────────────────────────────────────
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
}));

vi.mock("@/services/synthetics", () => ({
  default: {
    listByFolderId: mockServiceList,
    list: mockServiceList,
    get: mockServiceGet,
    create: mockServiceCreate,
    enable: mockServiceEnable,
    delete: mockServiceDelete,
    bulkDelete: mockServiceBulkDelete,
    run: mockServiceRun,
    getLocations: mockServiceGetLocations,
  },
}));

vi.mock("@/utils/commons", () => ({
  getFoldersListByType: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

vi.mock("@/utils/synthetics/buildPayload", () => ({
  mapResponseToBrowserCheck: vi.fn((data: any) => data),
  buildCreateBrowserTestPayload: vi.fn((data: any) => data),
}));

import SyntheticMonitoring from "./SyntheticMonitoring.vue";

// ── Test helpers ─────────────────────────────────────────────────────────

/** Standard set of stubs for child components used across all mounts. */
const baseStubs = {
  FolderList: {
    template: '<div data-test="synthetic-monitoring-folder-list" />',
  },
  MonitorTable: {
    template: '<div data-test="synthetic-monitoring-monitors-table" />',
    props: [
      "mode",
      "data",
      "loading",
      "selectedIds",
      "showFolderColumn",
      "toggleLoadingMap",
      "triggerLoadingMap",
      "bulkActionLoading",
      "footerTitle",
      "emptyMessage",
    ],
  },
  MoveAcrossFolders: {
    template: '<div data-test="synthetic-monitoring-move-dialog" />',
    props: ["type", "moduleId", "activeFolderId", "open"],
  },
  ODropdown: {
    template:
      '<div><div data-test="odropdown-trigger"><slot name="trigger" /></div><div v-if="true"><slot /></div></div>',
    props: ["align"],
  },
  ODropdownItem: {
    template: '<div data-test="odropdown-item"><slot /></div>',
    props: ["iconLeft", "dataTest"],
  },
  OIcon: {
    template: '<span />',
    props: ["name", "size", "class"],
  },
  ODialog: {
    template: '<div v-if="open"><slot /></div>',
    props: [
      "open",
      "size",
      "title",
      "primaryButtonLabel",
      "secondaryButtonLabel",
      "primaryButtonDisabled",
      "primaryButtonVariant",
    ],
    emits: ["click:primary", "click:secondary", "update:open"],
  },
  OButton: {
    template:
      '<button :data-test="$attrs[\'data-test\']"><slot name="icon-left" /><slot name="icon-right" /><slot /></button>',
    props: ["variant", "size", "class", "loading", "title", "iconLeft"],
    inheritAttrs: true,
  },
  OSelect: {
    template: '<select :data-test="$attrs[\'data-test\']" />',
    props: ["modelValue", "options", "size"],
  },
  OInput: {
    template: '<input :data-test="$attrs[\'data-test\']" />',
    props: ["modelValue", "placeholder", "label", "error", "errorMessage"],
  },
  OToggleGroup: {
    template: '<div><slot /></div>',
    props: ["modelValue"],
  },
  OToggleGroupItem: {
    template:
      '<button :data-test="$attrs[\'data-test\']"><slot /></button>',
    props: ["value", "size", "iconLeft"],
    inheritAttrs: true,
  },

};

function mountPage() {
  return mount(SyntheticMonitoring, {
    global: {
      plugins: [store],
      stubs: baseStubs,
    },
  });
}

describe("SyntheticMonitoring", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceList.mockResolvedValue({ data: { monitors: [] } });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render the page shell with the new check dropdown", () => {
      wrapper = mountPage();
      expect(wrapper.exists()).toBe(true);
      expect(
        wrapper.find('[data-test="synthetic-monitoring-new-check-dropdown"]').exists(),
      ).toBe(true);
    });

    it("should render the sidebar folder list", () => {
      wrapper = mountPage();
      expect(
        wrapper.find('[data-test="synthetic-monitoring-folder-list"]').exists(),
      ).toBe(true);
    });

    it("should render the MonitorTable", () => {
      wrapper = mountPage();
      expect(
        wrapper.find('[data-test="synthetic-monitoring-monitors-table"]').exists(),
      ).toBe(true);
    });
  });

  describe("service calls on mount", () => {
    it("should call listByFolderId when initialised", async () => {
      wrapper = mountPage();
      await flushPromises();
      expect(mockServiceList).toHaveBeenCalled();
    });
  });
});
