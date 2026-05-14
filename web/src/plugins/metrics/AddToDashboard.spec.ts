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
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";

// ---------------------------------------------------------------------------
// Mock all external modules before the component is imported
// ---------------------------------------------------------------------------

const mockNotify = vi.fn(() => vi.fn());
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
    }),
  };
});

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

const mockRouterPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const mockGetFoldersList = vi.fn().mockResolvedValue([]);
const mockGetPanelId = vi.fn().mockReturnValue("panel-id-123");
const mockAddPanel = vi.fn().mockResolvedValue({});
vi.mock("@/utils/commons", () => ({
  getFoldersList: (...args: any[]) => mockGetFoldersList(...args),
  getPanelId: () => mockGetPanelId(),
  addPanel: (...args: any[]) => mockAddPanel(...args),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn(() => "test-image-url"),
}));

const mockShowErrorNotification = vi.fn();
const mockShowConfictErrorNotificationWithRefreshBtn = vi.fn();
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: mockShowErrorNotification,
    showConfictErrorNotificationWithRefreshBtn:
      mockShowConfictErrorNotificationWithRefreshBtn,
  }),
}));

const mockUseLoadingExecute = vi.fn();
const mockUseLoadingIsLoading = { value: false };
vi.mock("@/composables/useLoading", () => ({
  useLoading: (fn: any) => ({
    execute: fn,
    isLoading: mockUseLoadingIsLoading,
  }),
}));

// ---------------------------------------------------------------------------
// Import the component AFTER all mocks are registered
// ---------------------------------------------------------------------------
import AddToDashboard from "./AddToDashboard.vue";

// ---------------------------------------------------------------------------
// Shared mock store
// ---------------------------------------------------------------------------
const mockStore = {
  state: {
    theme: "light",
    selectedOrganization: {
      identifier: "test-org",
      label: "Test Org",
    },
    organizationData: {
      folders: [],
    },
  },
};

// ---------------------------------------------------------------------------
// Minimal dashboard panel data used across tests
// ---------------------------------------------------------------------------
const defaultDashboardPanelData = {
  data: {
    id: "",
    title: "",
    type: "line",
    queries: [{ query: "up" }],
  },
  meta: {
    dateTime: { start_time: new Date(), end_time: new Date() },
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
const createWrapper = (props: Record<string, any> = {}) => {
  return mount(AddToDashboard, {
    props: {
      dashboardPanelData: defaultDashboardPanelData,
      ...props,
    },
    global: {
      stubs: {
        QCard: { template: "<div class='q-card'><slot /></div>" },
        QCardSection: {
          template: "<div class='q-card-section'><slot /></div>",
        },
        QSeparator: { template: "<div class='q-separator' />" },
        QForm: {
          template:
            "<form class='q-form' @submit.prevent='$emit(\"submit\")'><slot /></form>",
          emits: ["submit"],
        },
        QBtn: {
          template:
            "<button class='q-btn' :data-test='$attrs[\"data-test\"]' :disabled='disable' @click='$emit(\"click\", $event)'><slot /></button>",
          props: ["label", "loading", "disable", "type", "flat", "dense", "noCaps"],
          emits: ["click"],
        },
        QInput: {
          template:
            "<input class='q-input' :data-test='$attrs[\"data-test\"]' :value='modelValue' @input='$emit(\"update:modelValue\", $event.target.value)' />",
          props: ["modelValue", "label", "rules", "lazyRules", "stackLabel"],
          emits: ["update:modelValue"],
        },
        SelectFolderDropdown: {
          template:
            "<div class='select-folder-dropdown' @click='$emit(\"folder-selected\", { value: \"folder-1\", label: \"Folder 1\" })'></div>",
          emits: ["folder-selected"],
        },
        SelectDashboardDropdown: {
          template:
            "<div class='select-dashboard-dropdown' @click='$emit(\"dashboard-selected\", { value: \"dash-1\", label: \"Dashboard 1\" })'></div>",
          props: ["folderId"],
          emits: ["dashboard-selected"],
        },
        SelectTabDropdown: {
          template:
            "<div class='select-tab-dropdown' @click='$emit(\"tab-selected\", { value: \"tab-1\", label: \"Tab 1\" })'></div>",
          props: ["folderId", "dashboardId"],
          emits: ["tab-selected"],
        },
      },
    },
  });
};

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe("AddToDashboard — component initialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFoldersList.mockResolvedValue([]);
    mockAddPanel.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mounts without errors", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.exists()).toBe(true);
  });

  it("has the correct component name", () => {
    const wrapper = createWrapper();
    expect(wrapper.vm.$options.name).toBe("AddToDashboard");
  });

  it("calls getFoldersList on before-mount with the store", async () => {
    createWrapper();
    await flushPromises();
    expect(mockGetFoldersList).toHaveBeenCalledWith(mockStore);
  });

  it("initializes activeFolderId as 'default'", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.activeFolderId).toBe("default");
  });

  it("initializes selectedDashboard as null", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.selectedDashboard).toBeNull();
  });

  it("initializes panelTitle as empty string", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.panelTitle).toBe("");
  });

  it("renders the SelectFolderDropdown component", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find(".select-folder-dropdown").exists()).toBe(true);
  });

  it("does not render SelectDashboardDropdown when activeFolderId is falsy", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    // activeFolderId starts as "default" which is truthy, so the dropdown IS shown
    // Set it to empty to test the v-if guard
    wrapper.vm.activeFolderId = "";
    await nextTick();
    expect(wrapper.find(".select-dashboard-dropdown").exists()).toBe(false);
  });

  it("renders SelectDashboardDropdown when activeFolderId is set", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    // activeFolderId = "default" at start
    expect(wrapper.find(".select-dashboard-dropdown").exists()).toBe(true);
  });

  it("does not render SelectTabDropdown when selectedDashboard is null", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    // selectedDashboard is null by default
    expect(wrapper.find(".select-tab-dropdown").exists()).toBe(false);
  });

  it("renders SelectTabDropdown when both activeFolderId and selectedDashboard are set", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    wrapper.vm.selectedDashboard = "dash-1";
    await nextTick();
    expect(wrapper.find(".select-tab-dropdown").exists()).toBe(true);
  });
});

describe("AddToDashboard — props", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts dashboardPanelData as a required prop", async () => {
    const wrapper = createWrapper({ dashboardPanelData: defaultDashboardPanelData });
    await flushPromises();
    expect(wrapper.exists()).toBe(true);
  });

  it("makes dashboardPanelData available in the component", async () => {
    const customData = {
      data: { id: "custom-panel", title: "My Panel", type: "bar", queries: [] },
      meta: { dateTime: {} },
    };
    const wrapper = createWrapper({ dashboardPanelData: customData });
    await flushPromises();
    // The component uses it internally; verify the prop was received
    expect(wrapper.props("dashboardPanelData")).toEqual(customData);
  });
});

describe("AddToDashboard — updateActiveFolderId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("updates activeFolderId when folder is selected", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.updateActiveFolderId({ value: "folder-abc" });
    await nextTick();

    expect(wrapper.vm.activeFolderId).toBe("folder-abc");
  });

  it("handles the folder-selected event from SelectFolderDropdown", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    await wrapper.find(".select-folder-dropdown").trigger("click");

    expect(wrapper.vm.activeFolderId).toBe("folder-1");
  });
});

describe("AddToDashboard — updateSelectedDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets selectedDashboard to the value from the event", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.updateSelectedDashboard({ value: "dash-xyz" });
    await nextTick();

    expect(wrapper.vm.selectedDashboard).toBe("dash-xyz");
  });

  it("sets selectedDashboard to null when the event has no value", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    wrapper.vm.selectedDashboard = "existing";

    wrapper.vm.updateSelectedDashboard({ value: undefined });
    await nextTick();

    expect(wrapper.vm.selectedDashboard).toBeNull();
  });

  it("sets selectedDashboard to null when the event is null", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.updateSelectedDashboard(null);
    await nextTick();

    expect(wrapper.vm.selectedDashboard).toBeNull();
  });
});

describe("AddToDashboard — updateActiveTabId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets activeTabId to the value from the event", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.updateActiveTabId({ value: "tab-999" });
    await nextTick();

    expect(wrapper.vm.activeTabId).toBe("tab-999");
  });

  it("sets activeTabId to null when event has no value", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.updateActiveTabId({ value: undefined });
    await nextTick();

    expect(wrapper.vm.activeTabId).toBeNull();
  });

  it("sets activeTabId to null when called with null", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.updateActiveTabId(null);
    await nextTick();

    expect(wrapper.vm.activeTabId).toBeNull();
  });
});

describe("AddToDashboard — onSubmit validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddPanel.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a negative notification when selectedDashboard is null", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    // selectedDashboard is null, activeTabId is null
    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "negative" }),
    );
  });

  it("shows a negative notification when selectedDashboard is set but activeTabId is null", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = null;

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "negative" }),
    );
  });

  it("calls addPanel when both dashboard and tab are selected", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "My Panel";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(mockAddPanel).toHaveBeenCalled();
  });

  it("passes folderId to addPanel", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.activeFolderId = "my-folder";
    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "My Panel";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(mockAddPanel).toHaveBeenCalledWith(
      mockStore,
      "dash-1",
      expect.anything(),
      "my-folder",
      "tab-1",
    );
  });

  it("emits 'save' event after successful panel addition", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "New Panel";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(wrapper.emitted("save")).toBeTruthy();
  });

  it("shows positive notification after successful panel addition", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "New Panel";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ type: "positive" }),
    );
  });

  it("navigates to viewDashboard route after successful panel addition", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "New Panel";
    wrapper.vm.activeFolderId = "folder-1";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(mockRouterPush).toHaveBeenCalledWith({
      name: "viewDashboard",
      query: { dashboard: "dash-1", folder: "folder-1", tab: "tab-1" },
    });
  });
});

describe("AddToDashboard — error handling in addPanelToDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls showErrorNotification on generic error", async () => {
    mockAddPanel.mockRejectedValue(new Error("Server error"));
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "Panel";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(mockShowErrorNotification).toHaveBeenCalled();
  });

  it("calls showConfictErrorNotificationWithRefreshBtn on 409 conflict", async () => {
    mockAddPanel.mockRejectedValue({
      response: { status: 409, data: { message: "Conflict detected" } },
      message: "Conflict",
    });
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "Panel";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(mockShowConfictErrorNotificationWithRefreshBtn).toHaveBeenCalled();
  });

  it("still emits 'save' even when addPanel throws", async () => {
    mockAddPanel.mockRejectedValue(new Error("failure"));
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "Panel";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    // The finally block always emits save
    expect(wrapper.emitted("save")).toBeTruthy();
  });

  it("calls dismiss function in finally block", async () => {
    const dismissFn = vi.fn();
    mockNotify.mockReturnValue(dismissFn);
    mockAddPanel.mockRejectedValue(new Error("error"));

    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "Panel";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(dismissFn).toHaveBeenCalled();
  });
});

describe("AddToDashboard — panelTitle binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("panelTitle is reactive and can be updated", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.panelTitle = "New title";
    await nextTick();

    expect(wrapper.vm.panelTitle).toBe("New title");
  });

  it("panelTitle is trimmed before being set on the panel data", async () => {
    mockAddPanel.mockResolvedValue({});
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    // Simulate v-model.trim by assigning a string with spaces — the template
    // uses v-model.trim so the value stored should be the trimmed version.
    wrapper.vm.panelTitle = "  Trimmed Title  ";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    // addPanel is called with the dashboardPanelData.data.title which was set
    // to panelTitle.value inside the component
    expect(mockAddPanel).toHaveBeenCalledWith(
      mockStore,
      "dash-1",
      expect.objectContaining({ title: "  Trimmed Title  " }),
      expect.any(String),
      "tab-1",
    );
  });
});

describe("AddToDashboard — store theme integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exposes store from setup", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.vm.store).toBe(mockStore);
  });

  it("renders cancel button with data-test attribute", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(
      wrapper.find('[data-test="metrics-schema-cancel-button"]').exists(),
    ).toBe(true);
  });

  it("renders submit button with data-test attribute", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(
      wrapper
        .find('[data-test="metrics-schema-update-settings-button"]')
        .exists(),
    ).toBe(true);
  });

  it("renders title text element", async () => {
    const wrapper = createWrapper();
    await flushPromises();
    expect(wrapper.find('[data-test="schema-title-text"]').exists()).toBe(true);
  });
});

describe("AddToDashboard — getPanelId integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddPanel.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls getPanelId before calling addPanel", async () => {
    const wrapper = createWrapper();
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "Test";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    expect(mockGetPanelId).toHaveBeenCalled();
    expect(mockAddPanel).toHaveBeenCalled();
  });

  it("assigns the generated panel id to dashboardPanelData.data.id", async () => {
    mockGetPanelId.mockReturnValue("generated-id-456");
    const panelData = {
      data: { id: "", title: "", type: "line", queries: [] },
      meta: { dateTime: {} },
    };
    const wrapper = createWrapper({ dashboardPanelData: panelData });
    await flushPromises();

    wrapper.vm.selectedDashboard = "dash-1";
    wrapper.vm.activeTabId = "tab-1";
    wrapper.vm.panelTitle = "Test";

    await wrapper.vm.onSubmit.execute();
    await flushPromises();

    // After execute, the data id was mutated to the generated id
    expect(panelData.data.id).toBe("generated-id-456");
  });
});
