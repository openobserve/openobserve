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
  mockRouterReplace,
  mockToast,
  mockRecorderStopReplay,
  mockRecorderReplayPhase,
  mockDetectExtension,
  mockGetFoldersListByType,
  mockRoute,
} = vi.hoisted(() => ({
  mockServiceGetLocations: vi.fn().mockResolvedValue({
    data: { locations: [], browsers: [], devices: [] },
  }),
  mockServiceCreate: vi.fn().mockResolvedValue({ data: { id: "new-check-1" } }),
  mockServiceUpdate: vi.fn().mockResolvedValue({}),
  mockServiceGet: vi.fn().mockResolvedValue({ data: {} }),
  mockRouterPush: vi.fn(),
  mockRouterReplace: vi.fn(),
  mockToast: vi.fn(() => vi.fn()),
  // Shared so a test can assert the view delegates the stop instead of driving
  // the phase itself. The composable owns stopping → stopped.
  mockRecorderStopReplay: vi.fn().mockResolvedValue(undefined),
  mockRecorderReplayPhase: { value: "idle" },
  // Shared so tests can flip the warm extension probe (mount) and the Record
  // click probe — both go through recorder.detectExtension.
  mockDetectExtension: vi.fn().mockResolvedValue(false),
  mockGetFoldersListByType: vi.fn().mockResolvedValue([]),
  // Mutable so a test can drive `?folder=` — the preselected folder is read
  // from the route on mount.
  mockRoute: { params: {} as Record<string, string>, query: {} as Record<string, string> },
}));

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  onBeforeRouteLeave: vi.fn(),
}));

vi.mock("@/composables/useSyntheticsRecorder", () => ({
  default: () => ({
    detectExtension: mockDetectExtension,
    replayPhase: mockRecorderReplayPhase,
    stepResults: new Map(),
    activeStepId: { value: null },
    replayResult: { value: null },
    error: { value: null },
    replay: vi.fn().mockResolvedValue({}),
    stopReplay: mockRecorderStopReplay,
    stopReplayAndForget: vi.fn(),
    registerAutoDetect: vi.fn(),
    isReplaying: { value: false },
    // The capability handshake. Defaulting to "not supported" keeps these tests on the
    // pre-restore path, which is what they were written against — a mock that claimed
    // recordFrom would route Record through a replay none of them stub.
    hasCapability: () => false,
    extVersion: { value: null },
    capabilities: { value: null },
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
  getFoldersListByType: mockGetFoldersListByType,
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
    makeBrowserCheckGateSchema: (_t: any) =>
      z.object({
        // `.url()` so the query-restore tests can distinguish an invalid URL
        // from a merely empty one, like the real schema does.
        url: z.string().min(1, "URL is required").url("Invalid URL"),
        name: z.string().optional(),
      }),
    makeBrowserCheckSaveSchema: (_t: any) =>
      z
        .object({
          name: z.string().min(1, "Name is required"),
          url: z.string().optional(),
          locations: z.array(z.any()).optional(),
          journey: z.array(z.any()).optional(),
        })
        // Stands in for the real per-step rules: enough to emit an issue whose
        // path starts with `journey.`, which is the branch of `persist` under test.
        .superRefine((val: any, ctx: any) => {
          (val.journey ?? []).forEach((step: any, i: number) => {
            if (step?.needsFix) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["journey", i, "value"],
                message: "Step value is required",
              });
            }
          });
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
  // OStepper/OStep run in WIZARD mode in this view (no `expanded` prop), so only
  // the active step's panel is mounted. The previous stub rendered every panel
  // unconditionally, which kept `journeyRef` alive on the Configure step and hid
  // the create-mode bug where save-time journey issues reached nothing.
  OStepper: {
    template: '<div class="o-stepper-stub"><slot /></div>',
    props: ["modelValue", "navigable", "class"],
  },
  OStep: {
    template: '<div v-if="isActivePanel"><slot /></div>',
    props: ["name", "title", "icon", "done", "class"],
    computed: {
      isActivePanel(): boolean {
        const stepper = (this as any).$parent;
        const active = stepper?.modelValue;
        return active === undefined || active === (this as any).name;
      },
    },
  },
  BrowserJourney: {
    template: '<div data-test="synthetics-browser-journey" />',
    props: [
      "modelValue",
      "fieldIssues",
      "startUrl",
      "extensionReady",
      "autoRecord",
      "replayPhase",
      "stepResults",
      "activeStepId",
      "blockedReason",
      "blockedDetail",
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
      "foldersLoading",
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
    mockGetFoldersListByType.mockResolvedValue([]);
    // Re-primed here because clearAllMocks keeps implementations — a test that
    // resolves the probe true must not leak into the next one.
    mockDetectExtension.mockResolvedValue(false);
    mockRoute.query = {};
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("locations fetch failure", () => {
    it("should stay silent when the endpoint 403s (community build)", async () => {
      mockServiceGetLocations.mockRejectedValue({ response: { status: 403 } });
      wrapper = mountPage();
      await flushPromises();
      expect(mockToast).not.toHaveBeenCalled();
    });

    it("should toast on a real fetch failure", async () => {
      mockServiceGetLocations.mockRejectedValue({ response: { status: 500 } });
      wrapper = mountPage();
      await flushPromises();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });
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
        query: { org_identifier: "default", folder: "folder-1" },
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

    it("'Save & Exit' should navigate to the list exactly once", async () => {
      mockServiceUpdate.mockRejectedValue(notFound);
      wrapper = await mountValidEdit();

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      // persist() already navigated for the 404 case — onSaveAndExit must bail
      // out instead of pushing a second route on top of it. Both pushes are the
      // same `backTo` target now, so the count is what distinguishes them.
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetics",
        query: { org_identifier: "default", folder: "folder-1" },
      });
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
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetics",
        query: { org_identifier: "default", folder: "folder-1" },
      });
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
        query: { org_identifier: "default", folder: "folder-1" },
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
        query: { org_identifier: "default", folder: "default" },
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

  // Regression: in create mode the only Save button lives on the Configure step,
  // and OStepper is a wizard — so BrowserJourney is UNMOUNTED at the moment
  // `persist` runs. The view used to push issues into it via `journeyRef`, which
  // was null there, so `?.` swallowed the call and the author got the toast and
  // nothing else: no expanded rows, no highlighted fields. The issues are now
  // parent-owned state handed down as a prop, so they survive the remount.
  describe("create mode — journey validation errors reach the journey", () => {
    async function saveWithABrokenStep() {
      const w = await mountCreateAtConfigure();
      const journeyStep = { id: "s1", action: "type", name: "Fill", needsFix: true };
      // Seed the journey through the component the user would have used.
      w.findComponent('[data-test="synthetics-browser-journey"]');
      (w.vm as any).check.journey = [journeyStep];
      await flushPromises();

      await w.find('[data-test="synthetics-create-save-btn"]').trigger("click");
      await flushPromises();
      return w;
    }

    it("should not create the check", async () => {
      wrapper = await saveWithABrokenStep();

      expect(mockServiceCreate).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    });

    // The journey step must become the active one, or the expanded rows are on a
    // tab the author is not looking at.
    it("should switch back to the Journey step", async () => {
      wrapper = await saveWithABrokenStep();

      expect(wrapper.find('[data-test="synthetics-browser-journey"]').exists()).toBe(true);
    });

    // The assertion that would have caught the reported bug: the journey is
    // handed the issues, rather than them being dropped into a null ref.
    it("should hand the journey issues to BrowserJourney", async () => {
      wrapper = await saveWithABrokenStep();

      const journey = wrapper.findComponent('[data-test="synthetics-browser-journey"]');
      const issues = journey.props("fieldIssues") as { path: PropertyKey[] }[];

      expect(issues).toHaveLength(1);
      expect(issues[0].path.join(".")).toBe("journey.0.value");
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

  describe("stopping a replay", () => {
    beforeEach(() => {
      mockRecorderStopReplay.mockClear();
      mockRecorderReplayPhase.value = "idle";
    });

    // Regression: this used to set replayPhase to "stopped" itself, before the
    // extension had confirmed — claiming the run was over while it was still
    // winding down, and leaving the interrupted step showing as in progress.
    it("should delegate the stop to the recorder rather than driving the phase", async () => {
      mockRecorderReplayPhase.value = "running";
      wrapper = await mountValidEdit();

      const journey = wrapper.findComponent('[data-test="synthetics-browser-journey"]');
      expect(journey.exists()).toBe(true);
      journey.vm.$emit("stop-replay");
      await flushPromises();

      expect(mockRecorderStopReplay).toHaveBeenCalledTimes(1);
      // The view must not pre-empt the composable's stopping → stopped transition.
      expect(mockRecorderReplayPhase.value).toBe("running");
    });
  });

  // Regression: `?folder=` was copied into the check unvalidated. A bookmarked
  // link, a folder deleted since, or a link from another org left an id no
  // option could resolve — the select rendered the raw id, and `persist` sent it
  // back as `?folder=`, which the server treats as authoritative for both the
  // destination folder and the RBAC gate, so the save failed on a folder the
  // author never picked.
  describe("create mode — preselected folder from ?folder=", () => {
    const folders = [
      { folderId: "default", name: "default" },
      { folderId: "folder-1", name: "Critical Monitors" },
    ];

    /** The check as CheckConfigure currently sees it. */
    const configuredCheck = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-check-configure"]').props("check") as any;

    it("should keep a preselected folder that exists in this org", async () => {
      mockRoute.query = { folder: "folder-1" };
      mockGetFoldersListByType.mockResolvedValue(folders);

      wrapper = await mountCreateAtConfigure();

      expect(configuredCheck(wrapper).folder).toBe("folder-1");
      expect(
        wrapper.findComponent('[data-test="synthetics-check-configure"]').props("validationErrors"),
      ).not.toHaveProperty("folder");
    });

    it("should fall back to the default folder when the preselected id is not in this org", async () => {
      mockRoute.query = { folder: "folder-from-another-org" };
      mockGetFoldersListByType.mockResolvedValue(folders);

      wrapper = await mountCreateAtConfigure();

      expect(configuredCheck(wrapper).folder).toBe("default");
      const errors = wrapper
        .findComponent('[data-test="synthetics-check-configure"]')
        .props("validationErrors") as Record<string, string>;
      expect(errors.folder).toContain("folder-from-another-org");
    });

    it("should not discard the preselected folder when the folder list failed to load", async () => {
      mockRoute.query = { folder: "folder-1" };
      mockGetFoldersListByType.mockRejectedValue(new Error("boom"));

      wrapper = await mountCreateAtConfigure();

      // An empty list means "we don't know", not "that folder is gone".
      expect(configuredCheck(wrapper).folder).toBe("folder-1");
    });
  });

  // The extension setup flow's own guidance leads the author through a page
  // refresh, which remounts this view. The gate fields are mirrored into the
  // query on entering setup so the refresh restores them and returns to the
  // setup phase instead of restarting the wizard. The attestation checkboxes
  // deliberately do NOT survive — install re-verifies through live detection.
  describe("create mode — gate restore via query params", () => {
    const gateUrlInput = (w: VueWrapper) => w.find('[data-test="synthetics-create-url-input"]');
    const gateNameInput = (w: VueWrapper) => w.find('[data-test="synthetics-create-name-input"]');
    const onSetupPhase = (w: VueWrapper) =>
      w.find('[data-test="synthetics-setup-open-record-btn"]').exists();

    it("should mirror the trimmed gate fields into the query when Record enters setup", async () => {
      mockRoute.query = { folder: "folder-1" };
      wrapper = mountPage();
      await flushPromises();

      await gateUrlInput(wrapper).setValue("  https://example.com  ");
      await gateNameInput(wrapper).setValue("  My Check  ");
      await wrapper.find('[data-test="synthetics-create-record-btn"]').trigger("click");
      await flushPromises();

      expect(onSetupPhase(wrapper)).toBe(true);
      // Existing params (like ?folder=) survive the merge.
      expect(mockRouterReplace).toHaveBeenCalledWith({
        query: { folder: "folder-1", url: "https://example.com", name: "My Check", setup: "1" },
      });
    });

    it("should omit the name param when the name is blank", async () => {
      wrapper = mountPage();
      await flushPromises();

      await gateUrlInput(wrapper).setValue("https://example.com");
      await wrapper.find('[data-test="synthetics-create-record-btn"]').trigger("click");
      await flushPromises();

      expect(mockRouterReplace).toHaveBeenCalledWith({
        query: { url: "https://example.com", setup: "1" },
      });
    });

    it("should restore the gate and land in the setup phase on mount with a valid url and setup=1", async () => {
      mockRoute.query = { url: "https://example.com", name: "Restored Check", setup: "1" };

      wrapper = mountPage();
      await flushPromises();

      expect(onSetupPhase(wrapper)).toBe(true);
      // The gate was committed with the restored fields, not skipped over.
      expect((wrapper.vm as any).check.url).toBe("https://example.com");
      expect((wrapper.vm as any).check.name).toBe("Restored Check");
    });

    it("should stay on the gate when setup=1 but the url is invalid", async () => {
      mockRoute.query = { url: "not-a-url", setup: "1" };

      wrapper = mountPage();
      await flushPromises();

      expect(onSetupPhase(wrapper)).toBe(false);
      // The bad value is still prefilled for the author to correct.
      expect((gateUrlInput(wrapper).element as HTMLInputElement).value).toBe("not-a-url");
    });

    it("should prefill the gate without advancing when the setup flag is absent", async () => {
      mockRoute.query = { url: "https://example.com", name: "Restored Check" };

      wrapper = mountPage();
      await flushPromises();

      expect(onSetupPhase(wrapper)).toBe(false);
      expect((gateUrlInput(wrapper).element as HTMLInputElement).value).toBe("https://example.com");
      expect((gateNameInput(wrapper).element as HTMLInputElement).value).toBe("Restored Check");
    });
  });

  // A deep link carrying BOTH gate fields has nothing left to ask once the
  // warm probe confirms the extension — the gate commits itself and the wizard
  // jumps straight to the editor. The probe is the gatekeeper: attestations or
  // a lone url must never trigger the jump.
  describe("create mode — gate bypass on prefilled deep link", () => {
    const onGate = (w: VueWrapper) => w.find('[data-test="synthetics-create-url-input"]').exists();
    const onSetupPhase = (w: VueWrapper) =>
      w.find('[data-test="synthetics-setup-open-record-btn"]').exists();
    const journey = (w: VueWrapper) => w.find('[data-test="synthetics-browser-journey"]');

    it("should commit the gate and land in the editor when the probe confirms the extension", async () => {
      mockRoute.query = { url: "https://example.com", name: "Deep Link Check" };
      mockDetectExtension.mockResolvedValue(true);

      wrapper = mountPage();
      await flushPromises();

      expect(onGate(wrapper)).toBe(false);
      expect(onSetupPhase(wrapper)).toBe(false);
      expect(journey(wrapper).exists()).toBe(true);
      expect((wrapper.vm as any).check.url).toBe("https://example.com");
      expect((wrapper.vm as any).check.name).toBe("Deep Link Check");
      // The bypass opens the editor idle — recording stays a deliberate click.
      expect(
        wrapper.findComponent('[data-test="synthetics-browser-journey"]').props("autoRecord"),
      ).toBe(false);
    });

    it("should stay on the gate with prefilled fields when the probe finds no extension", async () => {
      mockRoute.query = { url: "https://example.com", name: "Deep Link Check" };
      mockDetectExtension.mockResolvedValue(false);

      wrapper = mountPage();
      await flushPromises();

      expect(onGate(wrapper)).toBe(true);
      expect(journey(wrapper).exists()).toBe(false);
      expect(
        (wrapper.find('[data-test="synthetics-create-url-input"]').element as HTMLInputElement)
          .value,
      ).toBe("https://example.com");
      expect(
        (wrapper.find('[data-test="synthetics-create-name-input"]').element as HTMLInputElement)
          .value,
      ).toBe("Deep Link Check");
    });

    it("should stay on the gate when only the url param is present", async () => {
      mockRoute.query = { url: "https://example.com" };
      mockDetectExtension.mockResolvedValue(true);

      wrapper = mountPage();
      await flushPromises();

      expect(onGate(wrapper)).toBe(true);
      expect(journey(wrapper).exists()).toBe(false);
    });

    it("should let setup=1 take precedence over the bypass", async () => {
      mockRoute.query = { url: "https://example.com", name: "Deep Link Check", setup: "1" };
      mockDetectExtension.mockResolvedValue(true);

      wrapper = mountPage();
      await flushPromises();

      expect(onSetupPhase(wrapper)).toBe(true);
      expect(journey(wrapper).exists()).toBe(false);
    });
  });

  // Toggling "Allow in Incognito" reloads the extension and orphans the tab's
  // bridge, so a connection proven before the toggle proves nothing after it.
  // Giving the incognito ack must trigger a FRESH probe, and the setup CTA must
  // follow that probe's result — never the stale connection state.
  describe("extension setup phase — re-verify on incognito ack", () => {
    /** Gate → Record with no extension lands on the full-page setup phase. */
    async function mountAtSetupPhase() {
      const w = mountPage();
      await flushPromises();
      await w.find('[data-test="synthetics-create-url-input"]').setValue("https://example.com");
      await w.find('[data-test="synthetics-create-record-btn"]').trigger("click");
      await flushPromises();
      return w;
    }

    // The real checklist renders here; the real OCheckbox's root is a <label>
    // (where data-test lands) wrapping a button that owns the toggle.
    async function ackChecklistTask(w: VueWrapper, task: "install" | "incognito") {
      await w.find(`[data-test="synthetics-setup-${task}-ack"] button`).trigger("click");
    }

    const ctaDisabled = (w: VueWrapper) =>
      w.find('[data-test="synthetics-setup-open-record-btn"]').attributes("disabled") !== undefined;

    it("should re-probe on the ack and enable the CTA only once the fresh probe passes", async () => {
      wrapper = await mountAtSetupPhase();
      const callsBefore = mockDetectExtension.mock.calls.length;
      let resolveProbe!: (installed: boolean) => void;
      mockDetectExtension.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolveProbe = resolve;
          }),
      );

      await ackChecklistTask(wrapper, "install");
      await ackChecklistTask(wrapper, "incognito");

      // The ack itself fired a fresh detection…
      expect(mockDetectExtension.mock.calls.length).toBe(callsBefore + 1);
      // …and the CTA waits for its verdict rather than trusting stale state.
      expect(ctaDisabled(wrapper)).toBe(true);

      resolveProbe(true);
      await flushPromises();

      expect(ctaDisabled(wrapper)).toBe(false);
    });

    it("should keep the CTA disabled when the fresh probe finds no bridge", async () => {
      wrapper = await mountAtSetupPhase();
      let resolveProbe!: (installed: boolean) => void;
      mockDetectExtension.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            resolveProbe = resolve;
          }),
      );

      await ackChecklistTask(wrapper, "install");
      await ackChecklistTask(wrapper, "incognito");
      resolveProbe(false);
      await flushPromises();

      expect(ctaDisabled(wrapper)).toBe(true);
    });
  });
});
