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
// Render tests for CreateBrowserTest.vue — browser test creation/editing page.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const {
  mockServiceGetLocations,
  mockServiceCreate,
  mockServiceUpdate,
  mockServiceGet,
  mockRouterPush,
  mockToast,
} = vi.hoisted(() => ({
  mockServiceGetLocations: vi.fn().mockResolvedValue({
    data: { locations: [], browsers: [], devices: [] },
  }),
  mockServiceCreate: vi.fn().mockResolvedValue({ data: { id: "new-check-1" } }),
  mockServiceUpdate: vi.fn().mockResolvedValue({}),
  mockServiceGet: vi.fn().mockResolvedValue({ data: {} }),
  mockRouterPush: vi.fn(),
  mockToast: vi.fn(() => vi.fn()),
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

vi.mock("@/composables/useSyntheticsRecorder", () => ({
  default: () => ({
    detectExtension: vi.fn().mockResolvedValue(false),
    replayPhase: { value: "idle" },
    stepResults: new Map(),
    activeStepId: { value: null },
    replayResult: { value: null },
    error: { value: null },
    replay: vi.fn().mockResolvedValue({}),
    stopReplay: vi.fn().mockResolvedValue({}),
    stopReplayAndForget: vi.fn(),
    registerAutoDetect: vi.fn(),
    isReplaying: { value: false },
  }),
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
  toast: mockToast,
}));

vi.mock("@/utils/synthetics/buildPayload", () => ({
  buildCreateBrowserTestPayload: vi.fn((data: any) => data),
  mapResponseToBrowserCheck: vi.fn((data: any) => data),
}));

vi.mock("@/utils/synthetics/mapRecordedStep", () => ({
  journeyToWireSteps: vi.fn(() => []),
}));

vi.mock("@/components/synthetics/CreateBrowserTest.schema", () => {
  const { z } = require("zod");
  return {
    makeBrowserCheckGateSchema: (t: any) =>
      z.object({
        url: z.string().min(1, "URL is required"),
        name: z.string().optional(),
      }),
    makeBrowserCheckSaveSchema: (t: any) =>
      z.object({
        name: z.string().min(1, "Name is required"),
        url: z.string().optional(),
        locations: z.array(z.any()).optional(),
        journey: z.array(z.any()).optional(),
      }),
  };
});

import CreateBrowserTest from "./CreateBrowserTest.vue";

// ── Stubs ────────────────────────────────────────────────────────────────
const baseStubs = {
  OPageHeader: {
    template: '<div data-test="synthetics-header"><slot name="title" /><slot /></div>',
    props: ["title", "subtitle", "back"],
  },
  OButton: {
    // Slot names mirror the real OButton (icon-left / default / icon-right).
    template:
      '<button :data-test="$attrs[\'data-test\']" :disabled="disabled"><slot name="icon-left" /><slot /><slot name="icon-right" /></button>',
    props: ["variant", "size", "disabled", "loading", "class", "iconLeft"],
    inheritAttrs: true,
  },
  OInput: {
    template:
      '<input :data-test="$attrs[\'data-test\']" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @blur="$emit(\'blur\')" />',
    props: ["modelValue", "placeholder", "error", "errorMessage", "id", "label"],
    emits: ["update:modelValue", "blur"],
  },
  OIcon: {
    template: "<span />",
    props: ["name", "size", "class", "ariaHidden"],
  },
  OSwitch: {
    template: '<input type="checkbox" :data-test="$attrs[\'data-test\']" :disabled="disabled" />',
    props: ["modelValue", "label", "disabled"],
    inheritAttrs: true,
  },
  ODialog: {
    template: '<div v-if="open" :data-test="$attrs[\'data-test\']"><slot /></div>',
    props: [
      "open",
      "size",
      "title",
      "primaryButtonLabel",
      "secondaryButtonLabel",
      "primaryButtonVariant",
    ],
    emits: ["click:primary", "click:secondary", "update:open"],
    inheritAttrs: true,
  },
  OStepper: {
    template: "<div><slot /></div>",
    props: ["modelValue", "navigable", "class"],
  },
  OStep: {
    template: '<div v-if="$parent.$parent || true"><slot /></div>',
    props: ["name", "title", "icon", "done", "class"],
  },
  BrowserJourney: {
    template: '<div data-test="synthetics-browser-journey" />',
    props: [
      "modelValue",
      "startUrl",
      "extensionReady",
      "autoRecord",
      "replayPhase",
      "stepResults",
      "activeStepId",
      "blockedReason",
      "class",
    ],
  },
  CheckConfigure: {
    template: '<div data-test="synthetics-check-configure" />',
    props: [
      "check",
      "checkType",
      "locations",
      "browsers",
      "devices",
      "destinations",
      "folders",
      "validationErrors",
      "class",
    ],
  },
  CreateBrowserTestSkeleton: {
    template: '<div data-test="synthetics-loading-skeleton" />',
    props: ["rows"],
  },
  OEmptyState: {
    template: '<div :data-test="$attrs[\'data-test\']"><slot name="actions" /></div>',
    props: ["preset", "size"],
    inheritAttrs: true,
  },
  EmptyBrowserCheck: {
    template: "<div />",
    props: ["width"],
  },
  Teleport: {
    template: "<div><slot /></div>",
  },
  BetaBadge: {
    template: '<span data-test="beta-badge">BETA</span>',
  },
};

// ── Missing component stubs required by OPageLayout ──────────────────────
const pageLayoutStubs = {
  OPageLayout: {
    template: '<div><slot name="title" /><slot /></div>',
    props: ["title", "subtitle", "back", "class", "bleed"],
  },
};

function mountPage(props: Record<string, unknown> = {}) {
  return mount(CreateBrowserTest, {
    global: {
      plugins: [i18n, store],
      stubs: { ...baseStubs, ...pageLayoutStubs },
    },
    props,
  });
}

/** Mount in edit mode with a loaded check that passes the save schema. */
async function mountValidEdit() {
  mockServiceGet.mockResolvedValue({
    data: {
      name: "Test Check",
      url: "https://example.com",
      folder: "folder-1",
      journey: [],
    },
  });
  const w = mountPage({ editId: "check-123" });
  await flushPromises();
  return w;
}

/**
 * Mount in create mode and walk the gate → Journey → Configure flow so the
 * step 2 footer (with the primary save button) is rendered.
 */
async function mountCreateAtConfigure(name = "Brand New Check") {
  const w = mountPage();
  await flushPromises();

  await w.find('[data-test="synthetics-create-url-input"]').setValue("https://example.com");
  await w.find('[data-test="synthetics-create-name-input"]').setValue(name);
  await w.find('[data-test="synthetics-create-build-btn"]').trigger("click");
  await flushPromises();

  await w.find('[data-test="synthetics-create-continue-btn"]').trigger("click");
  await flushPromises();
  return w;
}

describe("CreateBrowserTest", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockServiceGetLocations.mockResolvedValue({
      data: { locations: [], browsers: [], devices: [] },
    });
    mockServiceCreate.mockResolvedValue({ data: { id: "new-check-1" } });
    mockServiceUpdate.mockResolvedValue({});
    mockServiceGet.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("initial render", () => {
    it("should render the gate phase with URL and name inputs", async () => {
      wrapper = mountPage();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-create-url-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-create-name-input"]').exists()).toBe(true);
    });

    it("should render Record journey and Build manually buttons", async () => {
      wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-create-record-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-create-build-btn"]').exists()).toBe(true);
    });

    it("should disable action buttons when URL is empty", async () => {
      wrapper = mountPage();
      await flushPromises();

      const recordBtn = wrapper.find('[data-test="synthetics-create-record-btn"]');
      const buildBtn = wrapper.find('[data-test="synthetics-create-build-btn"]');
      expect(recordBtn.attributes("disabled")).toBeDefined();
      expect(buildBtn.attributes("disabled")).toBeDefined();
    });

    it("should render the Beta badge in the page title", async () => {
      wrapper = mountPage();
      await flushPromises();

      expect(wrapper.find('[data-test="beta-badge"]').exists()).toBe(true);
    });
  });

  describe("extension setup phase", () => {
    it("should enter extension setup phase when Record is clicked without extension installed", async () => {
      wrapper = mountPage();
      await flushPromises();

      // Type a URL to enable the button
      const urlInput = wrapper.find('[data-test="synthetics-create-url-input"]');
      await urlInput.setValue("https://example.com");

      // Click Record journey
      const recordBtn = wrapper.find('[data-test="synthetics-create-record-btn"]');
      // Button should now be enabled (URL is valid)
      expect(recordBtn.attributes("disabled")).toBeUndefined();

      await recordBtn.trigger("click");
      await flushPromises();

      // Now we should be on the extension setup phase - check for the Open & Record button
      expect(wrapper.find('[data-test="synthetics-setup-open-record-btn"]').exists()).toBe(true);
    });
  });

  describe("edit mode", () => {
    it("should call syntheticsService.get when editId prop is provided", async () => {
      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();

      expect(mockServiceGet).toHaveBeenCalledWith("default", "check-123", "");
    });

    it("should NOT call syntheticsService.get when editId prop is not provided", async () => {
      wrapper = mountPage();
      await flushPromises();

      expect(mockServiceGet).not.toHaveBeenCalled();
    });

    it("should render 'Save & Continue' and 'Save & Exit' in the Journey footer when editId is set", async () => {
      mockServiceGet.mockResolvedValue({
        data: { name: "Test Check", url: "https://example.com", journey: [] },
      });

      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();

      expect(wrapper.find('[data-test="synthetics-create-save-continue-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-create-save-exit-btn"]').exists()).toBe(true);
      // The plain (non-saving) Continue button is create-mode only
      expect(wrapper.find('[data-test="synthetics-create-continue-btn"]').exists()).toBe(false);
    });

    it("should render only Cancel + Continue in the Journey footer when editId is not set", async () => {
      wrapper = mountPage();
      await flushPromises();

      // Navigate to editor phase via Build Manually
      const urlInput = wrapper.find('[data-test="synthetics-create-url-input"]');
      await urlInput.setValue("https://example.com");

      const buildBtn = wrapper.find('[data-test="synthetics-create-build-btn"]');
      await buildBtn.trigger("click");
      await flushPromises();

      // We are now in the editor phase on step 1 — verify footer buttons
      expect(wrapper.find('[data-test="synthetics-create-continue-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-create-cancel-btn"]').exists()).toBe(true);
      // Neither save action appears without an editId — there is nothing to update yet
      expect(wrapper.find('[data-test="synthetics-create-save-continue-btn"]').exists()).toBe(
        false,
      );
      expect(wrapper.find('[data-test="synthetics-create-save-exit-btn"]').exists()).toBe(false);
    });
  });

  describe("edit mode — Journey footer save actions", () => {
    it("'Save & Exit' should update the check and navigate back to the list", async () => {
      wrapper = await mountValidEdit();

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).toHaveBeenCalledTimes(1);
      expect(mockServiceUpdate).toHaveBeenCalledWith(
        "default",
        "check-123",
        expect.anything(),
        "folder-1",
      );
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetics",
        query: { folder: "folder-1" },
      });
    });

    it("'Save & Continue' should update the check and advance to Configure without navigating", async () => {
      wrapper = await mountValidEdit();

      await wrapper.find('[data-test="synthetics-create-save-continue-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).not.toHaveBeenCalled();
      // Step 2 footer is now rendered — Go Back only exists on the Configure step
      expect(wrapper.find('[data-test="synthetics-create-back-to-journey-btn"]').exists()).toBe(
        true,
      );
    });

    it("should not navigate when the update request fails", async () => {
      mockServiceUpdate.mockRejectedValue({ response: { status: 500, data: {} } });
      wrapper = await mountValidEdit();

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });

    it("should not navigate when validation fails", async () => {
      mockServiceGet.mockResolvedValue({
        data: { name: "", url: "https://example.com", journey: [] },
      });
      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).not.toHaveBeenCalled();
      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });

  describe("edit mode — check deleted while editing (404)", () => {
    const notFound = { response: { status: 404, data: {} } };

    it("'Save & Exit' should navigate to the list once, without a folder query", async () => {
      mockServiceUpdate.mockRejectedValue(notFound);
      wrapper = await mountValidEdit();

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      // persist() already navigated for the 404 case — onSaveAndExit must bail
      // out instead of pushing a second, folder-scoped route on top of it.
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith({ name: "synthetics" });
    });

    it("'Save & Exit' should warn (not error) when the check no longer exists", async () => {
      mockServiceUpdate.mockRejectedValue(notFound);
      wrapper = await mountValidEdit();

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
      expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });

    it("'Save & Continue' should not advance to Configure", async () => {
      mockServiceUpdate.mockRejectedValue(notFound);
      wrapper = await mountValidEdit();

      await wrapper.find('[data-test="synthetics-create-save-continue-btn"]').trigger("click");
      await flushPromises();

      // Still on the Journey step: Go Back only exists on Configure.
      expect(wrapper.find('[data-test="synthetics-create-back-to-journey-btn"]').exists()).toBe(
        false,
      );
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith({ name: "synthetics" });
    });

    it("should clear the saving state after the 404 early return", async () => {
      mockServiceUpdate.mockRejectedValue(notFound);
      wrapper = await mountValidEdit();

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(
        wrapper.findComponent('[data-test="synthetics-create-save-exit-btn"]').props("loading"),
      ).toBe(false);
    });
  });

  describe("saving state", () => {
    it("should mark the save buttons as loading while the request is in flight", async () => {
      let resolveUpdate: (value: unknown) => void = () => {};
      mockServiceUpdate.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveUpdate = resolve;
          }),
      );
      wrapper = await mountValidEdit();

      const saveExitBtn = () =>
        wrapper.findComponent('[data-test="synthetics-create-save-exit-btn"]');
      expect(saveExitBtn().props("loading")).toBe(false);

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await nextTick();
      expect(saveExitBtn().props("loading")).toBe(true);

      resolveUpdate({});
      await flushPromises();
      expect(saveExitBtn().props("loading")).toBe(false);
    });
  });

  describe("Configure footer save action", () => {
    it("should update and navigate back to the list in edit mode", async () => {
      wrapper = await mountValidEdit();

      // The only way to reach Configure in edit mode is Save & Continue.
      await wrapper.find('[data-test="synthetics-create-save-continue-btn"]').trigger("click");
      await flushPromises();
      mockServiceUpdate.mockClear();
      mockRouterPush.mockClear();

      await wrapper.find('[data-test="synthetics-create-save-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetics",
        query: { folder: "folder-1" },
      });
    });

    it("should create (not update) and navigate back to the list in create mode", async () => {
      wrapper = await mountCreateAtConfigure();

      await wrapper.find('[data-test="synthetics-create-save-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).not.toHaveBeenCalled();
      expect(mockServiceCreate).toHaveBeenCalledTimes(1);
      expect(mockServiceCreate).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({ name: "Brand New Check" }),
        "default",
      );
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetics",
        query: { folder: "default" },
      });
    });

    it("should not create or navigate when the check has no name", async () => {
      wrapper = await mountCreateAtConfigure("");

      await wrapper.find('[data-test="synthetics-create-save-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceCreate).not.toHaveBeenCalled();
      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });
  });

  describe("create mode — Continue to Configure", () => {
    it("should advance to Configure without persisting anything", async () => {
      wrapper = await mountCreateAtConfigure();

      // Configure-only footer buttons are rendered…
      expect(wrapper.find('[data-test="synthetics-create-back-to-journey-btn"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="synthetics-create-save-btn"]').exists()).toBe(true);
      // …and the Journey-step Continue button is gone.
      expect(wrapper.find('[data-test="synthetics-create-continue-btn"]').exists()).toBe(false);
      // Continue is pure navigation — nothing is written until the user saves.
      expect(mockServiceCreate).not.toHaveBeenCalled();
      expect(mockServiceUpdate).not.toHaveBeenCalled();
      expect(mockRouterPush).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    it("should show error toast when saving with an empty name", async () => {
      // Mount in edit mode so the Journey footer save button is rendered.
      // The save schema requires name to be non-empty — the check starts
      // with an empty name, so the first save attempt must fail validation.
      mockServiceGet.mockResolvedValue({
        data: { name: "", url: "https://example.com", journey: [] },
      });

      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();

      const saveBtn = wrapper.find('[data-test="synthetics-create-save-exit-btn"]');
      expect(saveBtn.exists()).toBe(true);

      await saveBtn.trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
        }),
      );
    });

    it("should NOT call create or update services when validation fails", async () => {
      mockServiceGet.mockResolvedValue({
        data: { name: "", url: "https://example.com", journey: [] },
      });

      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();

      const saveBtn = wrapper.find('[data-test="synthetics-create-save-exit-btn"]');
      await saveBtn.trigger("click");
      await flushPromises();

      // Validation should fail before any API call
      expect(mockServiceCreate).not.toHaveBeenCalled();
      expect(mockServiceUpdate).not.toHaveBeenCalled();
    });
  });
});
