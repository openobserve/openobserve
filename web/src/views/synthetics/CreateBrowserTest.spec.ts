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
  mockServiceListEnvironments,
  mockServiceListGlobalVariables,
  mockServiceDelete,
  mockServiceReferencedBy,
  mockServiceCreateEnvironmentVariable,
  mockServiceUpdateEnvironmentVariable,
  mockServiceCreateGlobalVariable,
  mockServiceUpdateGlobalVariable,
  mockRouterPush,
  mockRouterReplace,
  mockToast,
  mockRecorderStopReplay,
  mockRecorderReplay,
  mockRecorderReplayPhase,
  mockDetectExtension,
  mockJourneyToWireSteps,
  mockGetFoldersListByType,
  mockRoute,
  mockOnBeforeRouteUpdate,
  mockBreakpoint,
} = vi.hoisted(() => ({
  mockServiceGetLocations: vi.fn().mockResolvedValue({
    data: { locations: [], browsers: [], devices: [] },
  }),
  mockServiceCreate: vi.fn().mockResolvedValue({ data: { id: "new-check-1" } }),
  mockServiceUpdate: vi.fn().mockResolvedValue({}),
  mockServiceGet: vi.fn().mockResolvedValue({ data: {} }),
  // The shared tiers replay resolves against; empty unless a case fills them.
  mockServiceListEnvironments: vi.fn().mockResolvedValue({ data: [] }),
  mockServiceListGlobalVariables: vi.fn().mockResolvedValue({ data: [] }),
  // Only reached by the extract flow's compensation after a failed splice.
  mockServiceDelete: vi.fn().mockResolvedValue({}),
  // Only reached when the loaded check carries an `id`; nothing references it by default.
  mockServiceReferencedBy: vi.fn().mockResolvedValue({
    data: { references: [], hidden_reference_count: 0 },
  }),
  mockServiceCreateEnvironmentVariable: vi.fn().mockResolvedValue({ data: {} }),
  mockServiceUpdateEnvironmentVariable: vi.fn().mockResolvedValue({ data: {} }),
  mockServiceCreateGlobalVariable: vi.fn().mockResolvedValue({ data: {} }),
  mockServiceUpdateGlobalVariable: vi.fn().mockResolvedValue({ data: {} }),
  mockRouterPush: vi.fn(),
  mockRouterReplace: vi.fn(),
  mockToast: vi.fn(() => vi.fn()),
  // Shared so a test can assert the view delegates the stop instead of driving
  // the phase itself. The composable owns stopping → stopped.
  mockRecorderStopReplay: vi.fn().mockResolvedValue(undefined),
  // Shared so a replay case can read the url and variables the view resolved.
  mockRecorderReplay: vi.fn().mockResolvedValue({}),
  mockRecorderReplayPhase: { value: "idle" },
  // Shared so tests can flip the warm extension probe (mount) and the Record
  // click probe — both go through recorder.detectExtension.
  mockDetectExtension: vi.fn().mockResolvedValue(false),
  mockGetFoldersListByType: vi.fn().mockResolvedValue([]),
  // Empty by default, so runReplay returns before it touches the recorder.
  mockJourneyToWireSteps: vi.fn(() => [] as unknown[]),
  // Mutable so a test can drive `?folder=` — the preselected folder is read
  // from the route on mount.
  mockRoute: { params: {} as Record<string, string>, query: {} as Record<string, string> },
  // Captures the guard the view registers for a same-record navigation (parent → child id).
  mockOnBeforeRouteUpdate: vi.fn(),
  // Read once per mount; a case sets it before mounting to lay the page out as a phone.
  mockBreakpoint: { mobile: false },
}));

vi.mock("@/composables/useBreakpoint", async () => {
  const { computed } = await import("vue");
  return {
    default: () => ({
      isMobile: computed(() => mockBreakpoint.mobile),
      isTablet: computed(() => false),
      isDesktop: computed(() => !mockBreakpoint.mobile),
      mdUp: computed(() => !mockBreakpoint.mobile),
      lgUp: computed(() => !mockBreakpoint.mobile),
    }),
  };
});

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({
    push: mockRouterPush,
    replace: mockRouterReplace,
  }),
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: mockOnBeforeRouteUpdate,
}));

vi.mock("@/composables/useSyntheticsRecorder", () => ({
  default: () => ({
    detectExtension: mockDetectExtension,
    replayPhase: mockRecorderReplayPhase,
    stepResults: new Map(),
    activeStepId: { value: null },
    replayResult: { value: null },
    error: { value: null },
    replay: mockRecorderReplay,
    stopReplay: mockRecorderStopReplay,
    stopReplayAndForget: vi.fn(),
    registerAutoDetect: vi.fn(),
    cleanup: vi.fn(),
    isReplaying: { value: false },
    // The capability handshake. Defaulting to "not supported" keeps these tests on the
    // pre-restore path, which is what they were written against — a mock that claimed
    // recordFrom would route Record through a replay none of them stub.
    hasCapability: () => false,
    extVersion: { value: null },
    capabilities: { value: null },
  }),
}));

vi.mock("@/services/synthetics", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      getLocations: mockServiceGetLocations,
      create: mockServiceCreate,
      update: mockServiceUpdate,
      get: mockServiceGet,
      delete: mockServiceDelete,
      listEnvironments: mockServiceListEnvironments,
      listGlobalVariables: mockServiceListGlobalVariables,
      referencedBy: mockServiceReferencedBy,
      createEnvironmentVariable: mockServiceCreateEnvironmentVariable,
      updateEnvironmentVariable: mockServiceUpdateEnvironmentVariable,
      createGlobalVariable: mockServiceCreateGlobalVariable,
      updateGlobalVariable: mockServiceUpdateGlobalVariable,
    },
  });
});

vi.mock("@/services/alert_destination", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn().mockResolvedValue({ data: [] }),
    },
  });
});

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
  journeyToWireSteps: mockJourneyToWireSteps,
  // Identity: a readable child's steps only need to reach the cache, not be remapped.
  mapWireSteps: vi.fn((steps: any[]) => steps),
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
import OSplitter from "@/lib/core/Splitter/OSplitter.vue";
import { syntheticsEditRoute } from "@/utils/synthetics/routes";
import { mapResponseToBrowserCheck } from "@/utils/synthetics/buildPayload";
import type { BrowserStep } from "@/types/synthetics";
import type { ChildJourney } from "@/utils/synthetics/expandJourney";
import { VARIABLES_SPLITTER_LIMITS } from "@/composables/synthetics/useCheckWizardUi";
import destinationService from "@/services/alert_destination";
import { queryClient } from "@/composables/query/queryClient";
import { syntheticsKeys } from "@/services/synthetics.querykeys";

// Exposed by the real BrowserJourney; the host calls it after a refused save.
const mockRevealCapNotice = vi.fn();
// Exposed by the real BrowserJourney; the host calls it once the child is created.
const mockReplaceRangeWithSubtest = vi.fn();
// Exposed by the real BrowserJourney; the host's "Replay anyway" goes through it.
const mockReplayUpTo = vi.fn();
// Exposed by the real BrowserJourney; the host's "Save & re-run" goes through it.
const mockRequestReplay = vi.fn();
// Every open/close of the missing-value dialog stub, so a test can see that one closed before the next opened.
const missingDialogLog: string[] = [];

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
    // Renders the host's slots, so the view-owned toolbar parts can be found.
    template:
      '<div data-test="synthetics-browser-journey"><slot name="start-pill" :locked="false" /><slot name="replay-menu" :disabled="false" /></div>',
    props: [
      "modelValue",
      "fieldIssues",
      "startUrl",
      "startUrlTemplate",
      "replayEnvironmentLabel",
      "secretNames",
      "usesTypedSecrets",
      "typedSecretReport",
      "extensionReady",
      "autoRecord",
      "replayPhase",
      "stepResults",
      "activeStepId",
      "blockedReason",
      "blockedDetail",
      "variablesPanelOpen",
      "refusedChildIds",
      "journeyBudgetMs",
      "definedNames",
      "variables",
      "ownStepCount",
      "class",
    ],
    // Exposed by the real BrowserJourney as a computed; a plain field here so a test can flip it.
    data: () => ({ filterActive: false }),
    methods: {
      revealCapNotice: mockRevealCapNotice,
      replaceRangeWithSubtest: (...args: unknown[]) => mockReplaceRangeWithSubtest(...args),
      replayUpTo: (...args: unknown[]) => mockReplayUpTo(...args),
      requestReplay: (...args: unknown[]) => mockRequestReplay(...args),
    },
  },
  JourneyStartPill: {
    name: "JourneyStartPill",
    template: '<div data-test="synthetics-journey-start-pill-stub" />',
    props: ["url", "environments", "selectedIds", "checkVariables", "globals", "disabled"],
    emits: ["update:url", "update:selected-ids"],
  },
  ReplayEnvironmentMenu: {
    name: "ReplayEnvironmentMenu",
    template: '<div data-test="synthetics-journey-replay-menu-stub" />',
    props: ["options", "selectedId", "disabled", "secretsNeeded", "secretsEntered", "secretFailed"],
    emits: ["update:selected-id", "edit-secrets"],
  },
  ReplaySecretsDialog: {
    name: "ReplaySecretsDialog",
    template: '<div data-test="synthetics-replay-secrets-dialog-stub" :data-open="open" />',
    props: ["open", "mode", "environmentName", "secrets", "failedAtStep", "onSubmit"],
    emits: ["update:open", "forget"],
  },
  JourneyUsedByPopover: {
    name: "JourneyUsedByPopover",
    template: '<div data-test="synthetics-journey-used-by-stub" />',
    props: ["references", "hidden", "folders", "orgIdentifier"],
  },
  MissingValueDialog: {
    name: "MissingValueDialog",
    template: '<div data-test="synthetics-missing-value-dialog-stub" :data-open="open" />',
    props: [
      "open",
      "name",
      "environmentName",
      "isGlobal",
      "steps",
      "sharedByChecks",
      "canReplayAnyway",
      "existingKind",
      "onSubmit",
    ],
    emits: ["update:open", "replay-anyway"],
    computed: {
      state(): string {
        return (this as any).open ? (this as any).name : "closed";
      },
    },
    watch: {
      state(value: string) {
        missingDialogLog.push(value);
      },
    },
    mounted() {
      missingDialogLog.push((this as any).state);
    },
    unmounted() {
      missingDialogLog.push("closed");
    },
  },
  // Renders nothing of its own: the host's orchestration is driven through the `onSubmit` prop.
  ExtractSubtestDialog: {
    template: '<div data-test="synthetics-extract-dialog-stub" :data-open="open" />',
    props: [
      "open",
      "range",
      "anchor",
      "authoredCount",
      "executedCount",
      "parentName",
      "parentStartingUrl",
      "defaultFolder",
      "folders",
      "needsSchedule",
      "parentLocations",
      "parentSchedule",
      "locationOptions",
      "variables",
      "onSubmit",
    ],
    emits: ["update:open"],
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
      "targetHint",
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
    template:
      '<div><slot name="title" /><div data-test="page-actions"><slot name="actions" /></div><slot /></div>',
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

// Shared-variable rows and environments as the list endpoints return them.
const variable = (
  name: string,
  value?: string,
  kind: "plain" | "secret" = "plain",
  extra: Record<string, unknown> = {},
) => ({
  id: name,
  name,
  kind,
  value,
  has_value: true,
  description: "",
  example: "",
  tags: [],
  used_by_checks: 0,
  created_at: 0,
  updated_at: 0,
  ...extra,
});
const environment = (id: string, variables: unknown[], is_global = false, checks_count = 0) => ({
  id,
  name: id,
  description: "",
  is_global,
  created_at: 0,
  updated_at: 0,
  checks_count,
  variables,
});
/** Global, prod and stg; stg is shared by 3 checks and holds a stored PASSWORD secret. */
const orgEnvironments = (stgExtra: unknown[] = []) => [
  environment("global", [], true),
  environment("prod", [variable("BASE_URL", "https://prod.test")]),
  environment(
    "stg",
    [
      variable("BASE_URL", "https://stg.test"),
      variable("PASSWORD", undefined, "secret"),
      ...stgExtra,
    ],
    false,
    3,
  ),
];
const unsetApiKeySecret = variable("API_KEY", undefined, "secret", {
  id: "var-api",
  has_value: false,
  description: "Partner key",
  example: "pk_test",
  tags: ["billing"],
});
const typeStep = (id: string, value: string): BrowserStep => ({
  id,
  action: "type",
  name: `Fill ${id}`,
  value,
  locator: { candidates: [{ kind: "css", value: `#${id}` }] },
});
const toWire = (steps: BrowserStep[]) =>
  steps.map((s) => ({ id: s.id, action: s.action, value: s.value }));

/** Whether leaving this editor for another test would stop and ask to discard. */
function leaveAsks() {
  const guard = mockOnBeforeRouteUpdate.mock.calls[0][0] as (
    to: unknown,
    from: unknown,
    next: (arg?: unknown) => void,
  ) => void;
  const next = vi.fn();
  guard(
    { fullPath: "/web/synthetics/edit/other", params: { id: "other" }, query: {} },
    { fullPath: "/web/synthetics/edit/check-123", params: { id: "check-123" }, query: {} },
    next,
  );
  return next.mock.calls[0]?.[0] === false;
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
    mockServiceDelete.mockResolvedValue({});
    mockServiceReferencedBy.mockResolvedValue({
      data: { references: [], hidden_reference_count: 0 },
    });
    mockReplaceRangeWithSubtest.mockReset();
    mockReplayUpTo.mockReset();
    mockRequestReplay.mockReset();
    mockBreakpoint.mobile = false;
    missingDialogLog.length = 0;
    mockServiceCreateEnvironmentVariable.mockResolvedValue({ data: {} });
    mockServiceUpdateEnvironmentVariable.mockResolvedValue({ data: {} });
    mockServiceCreateGlobalVariable.mockResolvedValue({ data: {} });
    mockServiceUpdateGlobalVariable.mockResolvedValue({ data: {} });
    mockServiceListGlobalVariables.mockResolvedValue({ data: [] });
    mockRecorderReplay.mockResolvedValue({});
    mockGetFoldersListByType.mockResolvedValue([]);
    // Re-primed here because clearAllMocks keeps implementations — a test that
    // resolves the probe true must not leak into the next one.
    mockDetectExtension.mockResolvedValue(false);
    mockServiceListEnvironments.mockResolvedValue({ data: [] });
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

    it("should show a placeholder example under the Starting URL", async () => {
      wrapper = mountPage();
      await flushPromises();

      const hint = wrapper.find('[data-test="synthetics-create-url-hint"]').text();
      expect(hint).toContain("{{variables}}");
      expect(hint).toContain("{{BASE_URL}}");
      expect(hint).not.toContain("{{baseUrl}}");
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

  describe("edit mode — subtest references", () => {
    const journeyStub = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-browser-journey"]') as VueWrapper<any>;
    const subtestStep: BrowserStep = {
      id: "s2",
      action: "subtest",
      name: "Log in (shared)",
      subtest: { id: "login-test", name: "Login" },
    };
    const loadedCheck = (extra: Record<string, unknown> = {}) => ({
      name: "Test Check",
      url: "https://example.com",
      folder: "folder-1",
      journey: [],
      ...extra,
    });

    it("navigates to the child's edit route with its folder when the journey emits open-child", async () => {
      wrapper = await mountValidEdit();
      const child: ChildJourney = {
        id: "login-test",
        name: "Login",
        folderId: "shared",
        steps: [],
      };

      journeyStub(wrapper).vm.$emit("open-child", child);
      await flushPromises();

      expect(mockRouterPush).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith(
        syntheticsEditRoute({ orgIdentifier: "default", folderId: "shared" }, "login-test"),
      );
    });

    it("asks before leaving a dirty parent when the route only changes its id", async () => {
      wrapper = await mountValidEdit();
      expect(mockOnBeforeRouteUpdate).toHaveBeenCalledTimes(1);
      const guard = mockOnBeforeRouteUpdate.mock.calls[0][0] as (
        to: unknown,
        from: unknown,
        next: (arg?: unknown) => void,
      ) => void;
      const from = { fullPath: "/web/synthetics/edit/parent", params: { id: "parent" }, query: {} };
      const toChild = {
        fullPath: "/web/synthetics/edit/child",
        params: { id: "child" },
        query: {},
      };
      const toSameId = {
        fullPath: "/web/synthetics/edit/parent?setup=1",
        params: { id: "parent" },
        query: { ...from.query, setup: "1" },
      };
      const dialog = () => wrapper.find('[data-test="synthetics-create-unsaved-dialog"]');

      // Clean: nothing to lose, so the navigation goes straight through.
      const nextClean = vi.fn();
      guard(toChild, from, nextClean);
      await nextTick();
      expect(nextClean).toHaveBeenCalledTimes(1);
      expect(nextClean).toHaveBeenCalledWith();
      expect(dialog().exists()).toBe(false);

      (wrapper.vm as any).check.journey = [
        { id: "s1", action: "navigate", name: "Open", value: "https://example.com" },
      ];
      await flushPromises();

      // Dirty but the id is unchanged (query-only, e.g. the setup mirror): still the same editor.
      const nextSameId = vi.fn();
      guard(toSameId, from, nextSameId);
      await nextTick();
      expect(nextSameId).toHaveBeenCalledTimes(1);
      expect(nextSameId).toHaveBeenCalledWith();
      expect(dialog().exists()).toBe(false);

      // Dirty and a different id: same guard as onBeforeRouteLeave — cancel and ask.
      const nextDirty = vi.fn();
      guard(toChild, from, nextDirty);
      await nextTick();
      expect(nextDirty).toHaveBeenCalledTimes(1);
      expect(nextDirty).toHaveBeenCalledWith(false);
      expect(dialog().exists()).toBe(true);
    });

    it("records a 403'd child in refusedChildIds and passes the set to the journey", async () => {
      const readableStep: BrowserStep = {
        id: "s3",
        action: "subtest",
        name: "Shared setup",
        subtest: { id: "shared-child", name: "Setup" },
      };
      const childFor = (status: number) => async (_org: string, id: string) => {
        if (id === "check-123") {
          return { data: loadedCheck({ journey: [subtestStep, readableStep] }) };
        }
        if (id === "shared-child") {
          return { data: { name: "Setup", folder_id: "shared", config: { steps: [] } } };
        }
        throw { response: { status } };
      };
      mockServiceGet.mockImplementation(childFor(403));
      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();

      // The host's prefetch is the one request; the journey must not issue a second.
      expect(mockServiceGet).toHaveBeenCalledWith("default", "login-test");
      const refused = journeyStub(wrapper).props("refusedChildIds") as Set<string>;
      expect(refused).toBeInstanceOf(Set);
      expect([...refused]).toEqual(["login-test"]);
      // The readable sibling lands in the shared cache with its folder (the host construction site).
      const cache = (wrapper.vm as any).childrenCache as Map<string, ChildJourney>;
      expect(cache.get("shared-child")).toMatchObject({
        id: "shared-child",
        name: "Setup",
        folderId: "shared",
      });

      // Access granted since: re-adding the reference refetches, and the refusal is cleared.
      mockServiceGet.mockImplementation(async (_org: string, id: string) =>
        id === "login-test"
          ? { data: { name: "Login", folder_id: "shared", config: { steps: [] } } }
          : childFor(403)(_org, id),
      );
      (wrapper.vm as any).check.journey = [readableStep];
      await flushPromises();
      (wrapper.vm as any).check.journey = [subtestStep, readableStep];
      await flushPromises();
      expect(cache.get("login-test")).toMatchObject({ id: "login-test", folderId: "shared" });
      const cleared = journeyStub(wrapper).props("refusedChildIds") as Set<string>;
      expect(cleared.has("login-test")).toBe(false);
      wrapper.unmount();

      // Only a 403 is a refusal; any other failure leaves the set alone.
      mockServiceGet.mockImplementation(childFor(500));
      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();
      const unrefused = journeyStub(wrapper).props("refusedChildIds") as Set<string>;
      expect(unrefused).toBeInstanceOf(Set);
      expect(unrefused.size).toBe(0);
    });

    it("passes config.journey_budget_ms from the loaded check to the journey", async () => {
      mockServiceGet.mockResolvedValue({
        data: loadedCheck({ config: { journey_budget_ms: 120_000 } }),
      });
      // The real mapper drops `config`, so only a read from the GET response can pass.
      vi.mocked(mapResponseToBrowserCheck).mockImplementationOnce(
        ({ config: _config, ...rest }: any) => rest,
      );
      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();

      expect(journeyStub(wrapper).props("journeyBudgetMs")).toBe(120_000);
    });

    it("passes the check's variable and secret names to the journey", async () => {
      mockServiceGet.mockResolvedValue({
        data: loadedCheck({
          variables: [
            { name: " USER ", value: "alice" },
            { name: "PASSWORD", value: "", secure: true },
          ],
          secrets: [{ name: "API_KEY", value: "k" }],
        }),
      });
      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();

      expect(journeyStub(wrapper).props("definedNames")).toEqual(["USER", "PASSWORD", "API_KEY"]);
    });
  });

  describe("extract to subtest", () => {
    const OPEN_BTN = '[data-test="synthetics-extract-open-btn"]';
    const REASON = '[data-test="synthetics-extract-reason"]';
    const journeyStub = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-browser-journey"]') as VueWrapper<any>;
    const dialogStub = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-extract-dialog-stub"]') as VueWrapper<any>;
    // Tolerates a dialog that is not rendered at all while closed.
    const dialogOpen = (w: VueWrapper) =>
      dialogStub(w).exists() && dialogStub(w).props("open") === true;
    const submit = (w: VueWrapper, values: Record<string, unknown>) =>
      (dialogStub(w).props("onSubmit") as (v: unknown) => Promise<void>)(values);

    const journey: BrowserStep[] = [
      { id: "s1", action: "navigate", name: "Open shop", value: "https://shop.test" },
      { id: "s2", action: "navigate", name: "Open login", value: "https://shop.test/login" },
      {
        id: "s3",
        action: "type",
        name: "Email",
        value: "{{USER}}",
        locator: { candidates: [{ kind: "css", value: "#email" }] },
      },
      {
        id: "s4",
        action: "click",
        name: "Cart",
        locator: { candidates: [{ kind: "css", value: "#cart" }] },
      },
    ];
    const values = { name: "Checkout — Open login", folder: "folder-2" };

    /** Edit mode with a saved, eligible journey; the mapper is identity, so `journey` is the model. */
    async function mountEdit(overrides: Record<string, unknown> = {}) {
      mockServiceGet.mockResolvedValue({
        data: {
          id: "check-123",
          name: "Checkout",
          url: "https://shop.test",
          folder: "folder-1",
          locations: ["us-east"],
          schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
          notifications: { destinations: [] },
          journey,
          variables: [{ name: "USER", value: "alice" }],
          ...overrides,
        },
      });
      const w = mountPage({ editId: "check-123" });
      await flushPromises();
      return w;
    }

    const monitorListInvalidations = () =>
      vi
        .mocked(queryClient.invalidateQueries)
        .mock.calls.filter(
          ([filters]) =>
            JSON.stringify(filters?.queryKey) ===
            JSON.stringify(syntheticsKeys.monitorsAll("default")),
        ).length;

    beforeEach(() => {
      vi.spyOn(queryClient, "invalidateQueries");
    });

    afterEach(() => {
      vi.mocked(queryClient.invalidateQueries).mockRestore();
    });

    async function selectRange(w: VueWrapper, ids: string[]) {
      journeyStub(w).vm.$emit("selection-changed", { count: ids.length, isRecording: false, ids });
      await flushPromises();
    }

    async function openDialog(w: VueWrapper, ids = ["s2", "s3"]) {
      await selectRange(w, ids);
      await w.find(OPEN_BTN).trigger("click");
      await flushPromises();
      expect(dialogStub(w).props("open")).toBe(true);
    }

    it("hides the button when composition is disabled", async () => {
      store.state.zoConfig.synthetics_subtests_enabled = false;
      try {
        wrapper = await mountEdit();
        await selectRange(wrapper, ["s2", "s3"]);

        expect(wrapper.find('[data-test="synthetics-journey-delete-selected-btn"]').exists()).toBe(
          true,
        );
        expect(wrapper.find(OPEN_BTN).exists()).toBe(false);
        expect(wrapper.find(REASON).exists()).toBe(false);
      } finally {
        store.state.zoConfig.synthetics_subtests_enabled = true;
      }
    });

    it("marks the button aria-disabled and says why for an ineligible selection", async () => {
      wrapper = await mountEdit();
      await selectRange(wrapper, ["s2", "s4"]);

      const btn = wrapper.find(OPEN_BTN);
      expect(btn.attributes("aria-disabled")).toBe("true");
      expect(btn.attributes("disabled")).toBeUndefined();
      expect(wrapper.find(REASON).text()).toContain("Select steps that are next to each other");

      await btn.trigger("click");
      await flushPromises();
      expect(dialogOpen(wrapper)).toBe(false);

      // The reason follows the journey's filter state for a gapped selection.
      (journeyStub(wrapper).vm as { filterActive: boolean }).filterActive = true;
      await selectRange(wrapper, ["s2", "s4"]);
      expect(wrapper.find(REASON).text()).toContain("clear the filter to see the full list");
      wrapper.unmount();

      // An otherwise eligible range is refused while this test is used elsewhere.
      mockServiceReferencedBy.mockResolvedValue({
        data: { references: [{ id: "other", name: "Other" }], hidden_reference_count: 1 },
      });
      wrapper = await mountEdit();
      await selectRange(wrapper, ["s2", "s3"]);
      expect(wrapper.find(OPEN_BTN).attributes("aria-disabled")).toBe("true");
      expect(wrapper.find(REASON).text()).toContain(
        "This test is used as a subtest by other tests and cannot hold one",
      );
      wrapper.unmount();

      // …and while the lookup is still in flight, until it resolves.
      let resolveLookup!: (value: unknown) => void;
      mockServiceReferencedBy.mockReturnValue(
        new Promise((resolve) => {
          resolveLookup = resolve;
        }),
      );
      wrapper = await mountEdit();
      await selectRange(wrapper, ["s2", "s3"]);
      expect(wrapper.find(OPEN_BTN).attributes("aria-disabled")).toBe("true");
      expect(wrapper.find(REASON).text()).toContain("Checking where this test is used");
      resolveLookup({ data: { references: [], hidden_reference_count: 0 } });
      await flushPromises();
      expect(wrapper.find(REASON).exists()).toBe(false);
      expect(wrapper.find(OPEN_BTN).attributes("aria-disabled")).toBe("false");
    });

    it("offers a retry when the referenced-by lookup failed", async () => {
      mockServiceReferencedBy.mockRejectedValue(new Error("network down"));
      wrapper = await mountEdit();
      await selectRange(wrapper, ["s2", "s3"]);

      expect(wrapper.find(OPEN_BTN).attributes("aria-disabled")).toBe("true");
      const reason = wrapper.find(REASON);
      expect(reason.text()).toContain("Could not check where this test is used");
      const retry = reason.findAll("button").find((b) => b.text() === "Retry");
      expect(retry).toBeDefined();

      mockServiceReferencedBy.mockResolvedValue({
        data: { references: [], hidden_reference_count: 0 },
      });
      await retry!.trigger("click");
      await flushPromises();

      expect(mockServiceReferencedBy).toHaveBeenCalledTimes(2);
      expect(wrapper.find(REASON).exists()).toBe(false);
      expect(wrapper.find(OPEN_BTN).attributes("aria-disabled")).toBe("false");
    });

    it("opens the dialog for an eligible selection", async () => {
      wrapper = await mountEdit();
      // A cached child outside the range makes the executed count differ from the authored one.
      ((wrapper.vm as any).childrenCache as Map<string, ChildJourney>).set("c", {
        id: "c",
        name: "Cleanup",
        folderId: "shared",
        steps: Array.from({ length: 3 }, (_, i) => ({
          id: `c-${i + 1}`,
          action: "click" as const,
          name: `cleanup ${i + 1}`,
          locator: { candidates: [{ kind: "css" as const, value: `#c${i + 1}` }] },
        })),
      });
      (wrapper.vm as any).check.journey = [
        ...journey,
        { id: "s5", action: "subtest", name: "Cleanup", subtest: { id: "c", name: "Cleanup" } },
      ];
      await flushPromises();
      await selectRange(wrapper, ["s2", "s3"]);

      expect(wrapper.find(OPEN_BTN).attributes("aria-disabled")).toBe("false");
      expect(wrapper.find(REASON).exists()).toBe(false);
      expect(dialogOpen(wrapper)).toBe(false);

      await wrapper.find(OPEN_BTN).trigger("click");
      await flushPromises();

      const dialog = dialogStub(wrapper);
      expect(dialog.props("open")).toBe(true);
      expect(dialog.props("anchor")).toBe(1);
      expect((dialog.props("range") as BrowserStep[]).map((s) => s.id)).toEqual(["s2", "s3"]);
      expect(dialog.props("parentName")).toBe("Checkout");
      expect(dialog.props("defaultFolder")).toBe("folder-1");
      expect(dialog.props("needsSchedule")).toBe(false);
      expect(dialog.props("parentLocations")).toEqual(["us-east"]);
      expect(dialog.props("authoredCount")).toBe(5);
      expect(dialog.props("executedCount")).toBe(7);
      expect(dialog.props("variables")).toEqual({ copied: ["USER"], toDefine: [] });
    });

    it("creates the child once, paused, in the chosen folder", async () => {
      // A parent without locations: the dialog supplies locations and schedule, and they must win.
      wrapper = await mountEdit({ locations: [] });
      await openDialog(wrapper);
      expect(dialogStub(wrapper).props("needsSchedule")).toBe(true);

      const schedule = { type: "interval", intervalValue: 15, intervalUnit: "minutes" };
      await submit(wrapper, { ...values, locations: ["eu-west"], schedule });
      await flushPromises();

      expect(mockServiceCreate).toHaveBeenCalledTimes(1);
      expect(monitorListInvalidations()).toBe(1);
      // The payload builder is identity here, so the child check itself is what is posted.
      expect(mockServiceCreate).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({
          name: "Checkout — Open login",
          enabled: false,
          folder: "folder-2",
          url: "https://shop.test/login",
          locations: ["eu-west"],
          schedule: expect.objectContaining(schedule),
        }),
        "folder-2",
      );
      expect(mockServiceUpdate).not.toHaveBeenCalled();
    });

    it("seeds the children cache and splices the reference on success", async () => {
      wrapper = await mountEdit();
      // Loading already dirtied the form (length watcher); reset so the splice has to dirty it itself.
      (wrapper.vm as any).isDirty = false;
      // One step: the length does not change, so no watcher fires on the host's behalf.
      await openDialog(wrapper, ["s2"]);

      await submit(wrapper, values);
      await flushPromises();

      const cache = (wrapper.vm as any).childrenCache as Map<string, ChildJourney>;
      expect(cache.get("new-check-1")).toMatchObject({
        id: "new-check-1",
        name: "Checkout — Open login",
        folderId: "folder-2",
      });
      expect(cache.get("new-check-1")?.steps.map((s) => s.action)).toEqual(["navigate"]);
      expect(mockReplaceRangeWithSubtest).toHaveBeenCalledTimes(1);
      expect(mockReplaceRangeWithSubtest).toHaveBeenCalledWith(
        { anchor: 1, count: 1 },
        { id: "new-check-1", name: "Checkout — Open login" },
      );
      expect((wrapper.vm as any).isDirty).toBe(true);
      expect(dialogOpen(wrapper)).toBe(false);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: 'Created "Checkout — Open login". Save this test to keep the reference.',
        }),
      );
    });

    it("leaves the model untouched and the dialog open when create fails", async () => {
      mockGetFoldersListByType.mockResolvedValue([{ folderId: "folder-2", name: "Shared" }]);
      mockServiceCreate.mockRejectedValue({
        response: { status: 500, data: { message: "quota exceeded" } },
      });
      wrapper = await mountEdit();
      await openDialog(wrapper);
      // The identity mapper aliases `journey` into the model, so compare against a copy.
      const before = journey.map((step) => ({ ...step }));

      await expect(submit(wrapper, values)).rejects.toThrow("quota exceeded");
      await flushPromises();

      expect((wrapper.vm as any).check.journey).toHaveLength(4);
      expect((wrapper.vm as any).check.journey).toEqual(before);
      expect(mockReplaceRangeWithSubtest).not.toHaveBeenCalled();
      expect(mockServiceDelete).not.toHaveBeenCalled();
      expect(((wrapper.vm as any).childrenCache as Map<string, ChildJourney>).size).toBe(0);
      expect(dialogStub(wrapper).props("open")).toBe(true);

      // A 403 is named after the folder the author cannot create in.
      mockServiceCreate.mockRejectedValue({ response: { status: 403 } });
      await expect(submit(wrapper, values)).rejects.toThrow(
        'You can\'t create tests in "Shared". Choose another folder.',
      );
      await flushPromises();
      expect((wrapper.vm as any).check.journey).toEqual(before);
      expect(dialogStub(wrapper).props("open")).toBe(true);
    });

    it("deletes the created child when the splice throws", async () => {
      mockReplaceRangeWithSubtest.mockImplementation(() => {
        throw new Error("splice failed");
      });
      // The compensation itself fails too, which is the one case the author must be told about.
      mockServiceDelete.mockRejectedValue(new Error("gone"));
      wrapper = await mountEdit();
      await openDialog(wrapper);

      await expect(submit(wrapper, values)).rejects.toThrow("splice failed");
      await flushPromises();

      expect(mockServiceCreate).toHaveBeenCalledTimes(1);
      expect(mockServiceDelete).toHaveBeenCalledTimes(1);
      expect(mockServiceDelete).toHaveBeenCalledWith("default", "new-check-1", "folder-2");
      // One from the create mutation, one after the rollback delete.
      expect(monitorListInvalidations()).toBe(2);
      expect(dialogStub(wrapper).props("open")).toBe(true);
      expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message:
            'Created "Checkout — Open login" but could not update this journey. Open the new test or delete it.',
        }),
      );
    });

    it("shows Used by N tests in the page header, not the footer", async () => {
      const references = [{ id: "p1", name: "One", folder_id: "f1" }];
      mockServiceReferencedBy.mockResolvedValue({
        data: { references, hidden_reference_count: 2 },
      });
      wrapper = await mountEdit();

      const usedBy = wrapper
        .find('[data-test="page-actions"]')
        .findComponent('[data-test="synthetics-journey-used-by-stub"]') as VueWrapper<any>;
      expect(usedBy.exists()).toBe(true);
      expect(usedBy.props("references")).toEqual(references);
      expect(usedBy.props("hidden")).toBe(2);
      expect(usedBy.props("orgIdentifier")).toBe("default");
      expect(wrapper.find('[data-test="synthetics-used-by-indicator"]').exists()).toBe(false);
    });

    it("no Used by button when nothing uses the test, and in create mode", async () => {
      wrapper = await mountEdit();
      expect(wrapper.find('[data-test="synthetics-journey-used-by-stub"]').exists()).toBe(false);
      wrapper.unmount();

      wrapper = mountPage();
      await flushPromises();
      expect(wrapper.find('[data-test="synthetics-journey-used-by-stub"]').exists()).toBe(false);
    });

    it("asks nothing on a save that adds no placeholder", async () => {
      wrapper = await mountEdit();
      mockServiceReferencedBy.mockClear();

      const afterPersist = vi.fn().mockResolvedValue(undefined);
      await (wrapper.vm as any).checkUsageThenSave(afterPersist);

      expect(mockServiceReferencedBy).not.toHaveBeenCalled();
      expect((wrapper.vm as any).usedByInfo).toBeNull();
      expect(afterPersist).toHaveBeenCalledTimes(1);
    });

    it("confirms only when a parent fails to define the newly added placeholder", async () => {
      wrapper = await mountEdit();
      (wrapper.vm as any).check.journey[2].value = "{{USER}} {{PROMO}}";
      await flushPromises();

      // Every parent defines it, so the save goes through unannounced.
      mockServiceReferencedBy.mockResolvedValue({
        data: {
          references: [{ id: "p1", name: "One", undefined_placeholders: [] }],
          hidden_reference_count: 1,
        },
      });
      const afterPersist = vi.fn().mockResolvedValue(undefined);
      await (wrapper.vm as any).checkUsageThenSave(afterPersist);

      // Only the name this edit adds is sent; {{USER}} was already in the saved journey.
      expect(mockServiceReferencedBy).toHaveBeenCalledWith("default", "check-123", ["PROMO"]);
      expect((wrapper.vm as any).usedByInfo).toBeNull();
      expect(afterPersist).toHaveBeenCalledTimes(1);

      mockServiceReferencedBy.mockResolvedValue({
        data: {
          references: [{ id: "p1", name: "One", undefined_placeholders: ["PROMO"] }],
          hidden_reference_count: 1,
        },
      });
      const blocked = vi.fn().mockResolvedValue(undefined);
      await (wrapper.vm as any).checkUsageThenSave(blocked);

      expect(blocked).not.toHaveBeenCalled();
      expect((wrapper.vm as any).usedByInfo.references).toHaveLength(1);
      expect((wrapper.vm as any).usedByInfo.names).toEqual(["PROMO"]);
      expect((wrapper.vm as any).usedByInfo.hidden).toBe(1);
    });

    it("looks up referenced-by on load in edit mode and not in create mode", async () => {
      // The response id differs from the route id on purpose: the route id is the one to use.
      wrapper = await mountEdit({ id: "stale-id" });
      expect(mockServiceReferencedBy).toHaveBeenCalledTimes(1);
      expect(mockServiceReferencedBy).toHaveBeenCalledWith("default", "check-123");
      wrapper.unmount();

      mockServiceReferencedBy.mockClear();
      wrapper = mountPage();
      await flushPromises();
      expect(mockServiceReferencedBy).not.toHaveBeenCalled();
    });
  });

  describe("edit mode — unsaved changes", () => {
    const DOT = '[data-test="synthetics-journey-unsaved-indicator"]';
    const saved = [typeStep("s1", "hello"), typeStep("s2", "world")];
    const journeyStub = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-browser-journey"]') as VueWrapper<any>;

    async function mountSaved() {
      mockGetFoldersListByType.mockResolvedValue([{ folderId: "folder-1", name: "Checkout" }]);
      mockServiceGet.mockResolvedValue({
        data: {
          name: "Checkout",
          url: "https://shop.test",
          folder: "folder-1",
          environments: [],
          journey: saved.map((step) => ({ ...step })),
        },
      });
      const w = mountPage({ editId: "check-123" });
      await flushPromises();
      return w;
    }

    async function setJourney(w: VueWrapper, journey: BrowserStep[]) {
      journeyStub(w).vm.$emit("update:modelValue", journey);
      await flushPromises();
    }

    const renamed = () => [{ ...saved[0], name: "Renamed" }, { ...saved[1] }];

    it("no unsaved dot right after an edit-mode load", async () => {
      wrapper = await mountSaved();

      expect(wrapper.find(DOT).exists()).toBe(false);
      expect(leaveAsks()).toBe(false);
    });

    it("no unsaved dot after the folder fallback", async () => {
      mockGetFoldersListByType.mockResolvedValue([{ folderId: "folder-1", name: "Checkout" }]);
      mockServiceGet.mockResolvedValue({
        data: {
          name: "Checkout",
          url: "https://shop.test",
          folder: "gone",
          environments: [],
          journey: saved.map((step) => ({ ...step })),
        },
      });
      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();

      expect(wrapper.find(DOT).exists()).toBe(false);
      expect(leaveAsks()).toBe(false);
    });

    it("the unsaved dot shows after renaming a step", async () => {
      wrapper = await mountSaved();

      await setJourney(wrapper, renamed());

      expect(wrapper.find(DOT).exists()).toBe(true);
      expect(wrapper.find(DOT).text()).toContain("Unsaved changes");
    });

    it("the unsaved dot disappears when an edit is undone", async () => {
      wrapper = await mountSaved();
      await setJourney(wrapper, renamed());
      expect(wrapper.find(DOT).exists()).toBe(true);

      await setJourney(
        wrapper,
        saved.map((step) => ({ ...step })),
      );

      expect(wrapper.find(DOT).exists()).toBe(false);
    });

    it("the unsaved dot shows after changing environments in the pill", async () => {
      wrapper = await mountSaved();

      (
        wrapper.findComponent('[data-test="synthetics-journey-start-pill-stub"]') as VueWrapper<any>
      ).vm.$emit("update:selected-ids", ["prod"]);
      await flushPromises();

      expect(wrapper.find(DOT).exists()).toBe(true);
    });

    it("the unsaved dot shows after changing the scheduled start", async () => {
      wrapper = await mountSaved();
      const vm = wrapper.vm as any;

      vm.check = { ...vm.check, schedule: { ...vm.check.schedule, startTime: "10:30" } };
      await flushPromises();

      expect(wrapper.find(DOT).exists()).toBe(true);
    });

    it("the unsaved dot clears after Save & Continue", async () => {
      wrapper = await mountSaved();
      await setJourney(wrapper, renamed());
      expect(wrapper.find(DOT).exists()).toBe(true);

      await wrapper.find('[data-test="synthetics-create-save-continue-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).toHaveBeenCalledTimes(1);
      expect(wrapper.find(DOT).exists()).toBe(false);
      expect(leaveAsks()).toBe(false);
    });

    it("leaving after only a step rename asks to discard", async () => {
      wrapper = await mountSaved();
      expect(leaveAsks()).toBe(false);

      await setJourney(wrapper, renamed());

      expect(leaveAsks()).toBe(true);
      await nextTick();
      expect(wrapper.find('[data-test="synthetics-create-unsaved-dialog"]').exists()).toBe(true);
    });
  });

  describe("phone layout", () => {
    const subtitle = (w: VueWrapper) =>
      w.findComponent(pageLayoutStubs.OPageLayout).props("subtitle") as string;

    async function mountUsedBy(hidden: number) {
      mockGetFoldersListByType.mockResolvedValue([{ folderId: "folder-1", name: "Checkout" }]);
      mockServiceReferencedBy.mockResolvedValue({
        data: {
          references: [{ id: "p1", name: "One", folder_id: "f1" }],
          hidden_reference_count: hidden,
        },
      });
      return mountValidEdit();
    }

    it("on a phone the used-by count moves into the subtitle", async () => {
      wrapper = await mountUsedBy(0);
      expect(subtitle(wrapper)).toBe("Checkout");
      wrapper.unmount();

      mockBreakpoint.mobile = true;
      wrapper = await mountUsedBy(0);
      expect(subtitle(wrapper)).toBe("Checkout · used by 1 test");
      wrapper.unmount();

      wrapper = await mountUsedBy(2);
      expect(subtitle(wrapper)).toBe("Checkout · used by 3 tests");
    });
  });

  // The host already computes the executed count, so Save refuses before any request is sent.
  describe("edit mode — executed step cap", () => {
    const CAP_TOAST = "Too many executed steps — see the notice above the steps.";
    const executedCount = (w: VueWrapper) =>
      (w.findComponent('[data-test="synthetics-browser-journey"]') as VueWrapper<any>).props(
        "ownStepCount",
      );

    const childOf = (id: string, name: string, count: number): ChildJourney => ({
      id,
      name,
      folderId: "shared",
      steps: Array.from({ length: count }, (_, i) => ({
        id: `${id}-${i + 1}`,
        action: "click" as const,
        name: `step ${i + 1}`,
        locator: { candidates: [{ kind: "css" as const, value: `#s${i + 1}` }] },
      })),
    });
    const composedJourney: BrowserStep[] = [
      { id: "s1", action: "navigate", name: "Open shop", value: "https://shop.example.com" },
      {
        id: "s2",
        action: "subtest",
        name: "Login (shared)",
        subtest: { id: "a", name: "Login (shared)" },
      },
      {
        id: "s3",
        action: "subtest",
        name: "Add items",
        subtest: { id: "b", name: "Add items to cart" },
      },
      {
        id: "s4",
        action: "click",
        name: "Cart",
        locator: { candidates: [{ kind: "css", value: "#cart" }] },
      },
      { id: "s5", action: "assert", name: "Cart has items", value: "1" },
    ];

    /** Edit mode with a saved id (so the usage lookup would run), children cached, then the journey. */
    async function mountComposed(bSteps: number) {
      mockServiceGet.mockResolvedValue({
        data: {
          id: "check-123",
          name: "Test Check",
          url: "https://example.com",
          folder: "folder-1",
          journey: [],
        },
      });
      const w = mountPage({ editId: "check-123" });
      await flushPromises();
      seedComposition(w, bSteps);
      await flushPromises();
      return w;
    }

    function seedComposition(w: VueWrapper, bSteps: number) {
      const cache = (w.vm as any).childrenCache as Map<string, ChildJourney>;
      cache.set("a", childOf("a", "Login (shared)", 31));
      cache.set("b", childOf("b", "Add items to cart", bSteps));
      (w.vm as any).check.journey = composedJourney;
    }

    it("refuses Save & Exit before any request when the executed count is over 50", async () => {
      wrapper = await mountComposed(17);
      // Precondition: the seeded composition really is 3 + 31 + 17 executed steps.
      expect(executedCount(wrapper)).toBe(51);

      // The load-time extract-eligibility lookup is not the save-time usage check.
      mockServiceReferencedBy.mockClear();
      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceReferencedBy).not.toHaveBeenCalled();
      expect(mockServiceUpdate).not.toHaveBeenCalled();
      expect(mockServiceCreate).not.toHaveBeenCalled();
      expect(mockRouterPush).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: CAP_TOAST }),
      );
      // Already on the Journey step, so the mounted journey is asked to scroll to the notice.
      expect(mockRevealCapNotice).toHaveBeenCalledTimes(1);
    });

    it("switches to the Journey step so the notice is on screen", async () => {
      wrapper = await mountComposed(16);
      await wrapper.find('[data-test="synthetics-create-save-continue-btn"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="synthetics-create-save-btn"]').exists()).toBe(true);
      mockServiceUpdate.mockClear();
      mockServiceReferencedBy.mockClear();
      mockToast.mockClear();

      (wrapper.vm as any).childrenCache.set("b", childOf("b", "Add items to cart", 17));
      await flushPromises();
      await wrapper.find('[data-test="synthetics-create-save-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).not.toHaveBeenCalled();
      expect(mockServiceReferencedBy).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="synthetics-browser-journey"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="synthetics-create-save-btn"]').exists()).toBe(false);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: CAP_TOAST }),
      );
    });

    it("saves normally at exactly 50 executed steps", async () => {
      wrapper = await mountComposed(16);
      expect(executedCount(wrapper)).toBe(50);

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "synthetics",
        query: { org_identifier: "default", folder: "folder-1" },
      });
      expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ message: CAP_TOAST }));
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

  // The variables panel is journey-only and now starts COLLAPSED: the journey is
  // the point of this step, and the labelled toolbar button brings the panel in
  // when it is wanted. While collapsed the splitter must hand the whole width to
  // the journey, so nothing is left behind an invisible drag handle.
  describe("Journey step — variables panel", () => {
    const journeyStub = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-browser-journey"]');
    const panel = (w: VueWrapper) => w.find('[data-test="synthetics-check-variables-panel"]');
    const splitter = (w: VueWrapper) => w.findComponent(OSplitter);

    /** The journey toolbar's toggle button, as the view receives it. */
    async function toggleFromToolbar(w: VueWrapper) {
      journeyStub(w).vm.$emit("toggle-variables-panel");
      await flushPromises();
    }

    it("should not render the variables panel on first mount", async () => {
      wrapper = await mountValidEdit();

      expect(wrapper.find('[data-test="synthetics-browser-journey"]').exists()).toBe(true);
      expect(panel(wrapper).exists()).toBe(false);
    });

    it("should give the journey the full width while the panel is collapsed", async () => {
      wrapper = await mountValidEdit();

      expect(splitter(wrapper).props("modelValue")).toBe(100);
      expect(splitter(wrapper).props("limits")).toEqual([100, 100]);
      expect(splitter(wrapper).props("separator")).toBe(false);
      expect(splitter(wrapper).props("disable")).toBe(true);
    });

    // BrowserJourney renders its toolbar toggle only when this prop is not
    // `undefined`, so it must arrive as an explicit `false` — leaving it off
    // would collapse the panel AND remove the only control that reopens it.
    it("should tell BrowserJourney the panel is closed rather than omitting the prop", async () => {
      wrapper = await mountValidEdit();

      expect(journeyStub(wrapper).props("variablesPanelOpen")).toBe(false);
    });

    it("should reveal the panel when the journey toolbar toggles it", async () => {
      wrapper = await mountValidEdit();

      await toggleFromToolbar(wrapper);

      expect(panel(wrapper).exists()).toBe(true);
      expect(journeyStub(wrapper).props("variablesPanelOpen")).toBe(true);
      // The split becomes draggable again, between the shared limits.
      expect(splitter(wrapper).props("limits")).toEqual(VARIABLES_SPLITTER_LIMITS);
      expect(splitter(wrapper).props("separator")).toBe(true);
      expect(splitter(wrapper).props("disable")).toBe(false);
    });

    it("should hide the panel again on a second toggle", async () => {
      wrapper = await mountValidEdit();

      await toggleFromToolbar(wrapper);
      await toggleFromToolbar(wrapper);

      expect(panel(wrapper).exists()).toBe(false);
      expect(journeyStub(wrapper).props("variablesPanelOpen")).toBe(false);
      expect(splitter(wrapper).props("modelValue")).toBe(100);
    });
  });

  describe("Journey step — replay", () => {
    const journeyStub = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-browser-journey"]') as VueWrapper<any>;
    const missingDialog = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-missing-value-dialog-stub"]') as VueWrapper<any>;
    const missingDialogOpen = (w: VueWrapper) =>
      missingDialog(w).exists() && missingDialog(w).props("open") === true;
    const submitMissing = (w: VueWrapper, values: { value: string; secret: boolean }) =>
      (missingDialog(w).props("onSubmit") as (v: unknown) => Promise<void>)(values);
    const replayMenu = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-journey-replay-menu-stub"]') as VueWrapper<any>;
    async function chooseReplayEnvironment(w: VueWrapper, id: string) {
      replayMenu(w).vm.$emit("update:selected-id", id);
      await flushPromises();
    }
    const secretsDialog = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-replay-secrets-dialog-stub"]') as VueWrapper<any>;
    const secretsDialogOpen = (w: VueWrapper) =>
      secretsDialog(w).exists() && secretsDialog(w).props("open") === true;
    const qaEnvironments = () => [
      ...orgEnvironments(),
      environment("qa", [
        variable("BASE_URL", "https://qa.test"),
        variable("PASSWORD", undefined, "secret"),
      ]),
    ];
    /** Replays once so the secrets dialog asks, and answers it. */
    async function typeSecret(w: VueWrapper, values: Record<string, string>) {
      await replayJourney(w);
      expect(secretsDialogOpen(w)).toBe(true);
      await (secretsDialog(w).props("onSubmit") as (v: unknown) => Promise<void> | void)(values);
      await flushPromises();
    }
    const replayedVariables = (call = 0) =>
      mockRecorderReplay.mock.calls[call]?.[2] as { name: string; value: string }[];
    const errorToasts = () =>
      mockToast.mock.calls.filter(
        (call) => (call as unknown as [{ variant?: string }])[0]?.variant === "error",
      );

    /** Mounts an edit of a templated check pinned to `environments`, with the org's three tiers loaded. */
    async function mountTemplatedCheck(
      environments: string[],
      extra: Record<string, unknown> = {},
      envs: unknown[] = orgEnvironments(),
    ) {
      mockServiceListEnvironments.mockResolvedValue({ data: envs });
      return mountLoadedCheck(environments, extra);
    }

    /** Same check, leaving the environment list to the case. */
    async function mountLoadedCheck(environments: string[], extra: Record<string, unknown> = {}) {
      mockServiceGet.mockResolvedValue({
        data: { name: "Login", url: "{{BASE_URL}}/login", environments, journey: [], ...extra },
      });
      const w = mountPage({ editId: "check-123" });
      await flushPromises();
      return w;
    }

    async function replay(w: VueWrapper, steps: unknown[]) {
      mockJourneyToWireSteps.mockReturnValue(steps);
      journeyStub(w).vm.$emit("replay");
      await flushPromises();
    }

    /** Replays the loaded journey; the wire mapper keeps each step's id, action and value. */
    async function replayJourney(w: VueWrapper) {
      journeyStub(w).vm.$emit("replay");
      await flushPromises();
    }

    beforeEach(() => {
      mockRecorderReplay.mockClear();
      mockJourneyToWireSteps.mockImplementation(((steps: BrowserStep[]) => toWire(steps)) as any);
    });

    afterEach(() => {
      mockJourneyToWireSteps.mockImplementation(() => []);
    });

    it("should replay against the check's first pinned environment", async () => {
      wrapper = await mountTemplatedCheck(["stg"]);

      await replay(wrapper, [{ action: "navigate", url: "{{BASE_URL}}/login" }]);

      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      const [, url, variables] = mockRecorderReplay.mock.calls[0];
      expect(url).toBe("https://stg.test/login");
      expect(variables).toContainEqual({ name: "BASE_URL", value: "https://stg.test" });
    });

    it("replays with Global values only when the check pins no environment", async () => {
      mockServiceListGlobalVariables.mockResolvedValue({
        data: [variable("BASE_URL", "https://global.test")],
      });
      wrapper = await mountTemplatedCheck([]);

      await replay(wrapper, [{ action: "navigate", url: "{{BASE_URL}}/login" }]);

      expect(mockRecorderReplay.mock.calls[0]?.[1]).toBe("https://global.test/login");
    });

    it("replays in the environment chosen on the Replay menu", async () => {
      wrapper = await mountTemplatedCheck(["prod"]);
      expect(replayMenu(wrapper).props("selectedId")).toBe("prod");

      await chooseReplayEnvironment(wrapper, "stg");
      await replay(wrapper, [{ action: "navigate", url: "{{BASE_URL}}/login" }]);

      expect(replayMenu(wrapper).props("selectedId")).toBe("stg");
      expect(mockRecorderReplay.mock.calls[0]?.[1]).toBe("https://stg.test/login");
    });

    it("choosing a replay environment does not change the saved test", async () => {
      wrapper = await mountTemplatedCheck(["prod"]);

      await chooseReplayEnvironment(wrapper, "stg");

      expect(leaveAsks()).toBe(false);
      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();
      expect(mockServiceUpdate).toHaveBeenCalledTimes(1);
      expect(mockServiceUpdate.mock.calls[0][2]).toMatchObject({ environments: ["prod"] });
    });

    it("records with the replay environment's values", async () => {
      wrapper = await mountTemplatedCheck(["prod"]);

      await chooseReplayEnvironment(wrapper, "stg");

      expect(journeyStub(wrapper).props("variables")).toContainEqual({
        name: "BASE_URL",
        value: "https://stg.test",
      });
      expect(journeyStub(wrapper).props("startUrl")).toBe("https://stg.test/login");
      expect(journeyStub(wrapper).props("replayEnvironmentLabel")).toBe("stg");
    });

    it("can replay in an environment that is not in the test", async () => {
      wrapper = await mountTemplatedCheck(["prod"]);
      const options = replayMenu(wrapper).props("options") as { id: string; inTest: boolean }[];
      expect(options.find((o) => o.id === "stg")).toMatchObject({ inTest: false });

      await chooseReplayEnvironment(wrapper, "stg");
      await replay(wrapper, [{ action: "navigate", url: "{{BASE_URL}}/login" }]);

      expect(mockRecorderReplay.mock.calls[0]?.[1]).toBe("https://stg.test/login");
    });

    it("an unpinned test can replay in a named environment", async () => {
      wrapper = await mountTemplatedCheck([]);

      await chooseReplayEnvironment(wrapper, "prod");
      await replay(wrapper, [{ action: "navigate", url: "{{BASE_URL}}/login" }]);

      expect(mockRecorderReplay.mock.calls[0]?.[1]).toBe("https://prod.test/login");
    });

    it("drops a Global choice once the test pins a readable environment", async () => {
      wrapper = await mountTemplatedCheck([]);
      await chooseReplayEnvironment(wrapper, "");
      expect(replayMenu(wrapper).props("selectedId")).toBe("");

      (
        wrapper.findComponent('[data-test="synthetics-journey-start-pill-stub"]') as VueWrapper<any>
      ).vm.$emit("update:selected-ids", ["prod"]);
      await flushPromises();
      await replay(wrapper, [{ action: "navigate", url: "{{BASE_URL}}/login" }]);

      expect(replayMenu(wrapper).props("selectedId")).toBe("prod");
      expect(mockRecorderReplay.mock.calls[0]?.[1]).toBe("https://prod.test/login");
    });

    it("falls back to the default when the chosen environment disappears", async () => {
      wrapper = await mountTemplatedCheck(["prod"]);
      await chooseReplayEnvironment(wrapper, "stg");
      // A promotion from the variables panel is one of the host's shared-list refreshes.
      journeyStub(wrapper).vm.$emit("toggle-variables-panel");
      await flushPromises();
      wrapper.findComponent({ name: "CheckVariablesPanel" }).vm.$emit("promoted", "OTHER");
      await flushPromises();
      expect(replayMenu(wrapper).props("selectedId")).toBe("stg");

      mockServiceListEnvironments.mockResolvedValue({
        data: orgEnvironments().filter((env) => env.id !== "stg"),
      });
      wrapper.findComponent({ name: "CheckVariablesPanel" }).vm.$emit("promoted", "OTHER");
      await flushPromises();
      await replay(wrapper, [{ action: "navigate", url: "{{BASE_URL}}/login" }]);

      expect(replayMenu(wrapper).props("selectedId")).toBe("prod");
      expect(mockRecorderReplay.mock.calls[0]?.[1]).toBe("https://prod.test/login");
    });

    it("opens the missing-value dialog instead of replaying when a variable has no value", async () => {
      wrapper = await mountTemplatedCheck(["stg"], { journey: [typeStep("s1", "{{API_KEY}}")] });

      await replayJourney(wrapper);

      expect(missingDialogOpen(wrapper)).toBe(true);
      expect(missingDialog(wrapper).props("name")).toBe("API_KEY");
      expect(missingDialog(wrapper).props("environmentName")).toBe("stg");
      expect(missingDialog(wrapper).props("isGlobal")).toBe(false);
      expect(missingDialog(wrapper).props("steps")).toEqual([1]);
      expect(missingDialog(wrapper).props("sharedByChecks")).toBe(3);
      expect(missingDialog(wrapper).props("existingKind")).toBeNull();
      expect(mockRecorderReplay).not.toHaveBeenCalled();
    });

    it("saves the typed value into the replay environment and replays", async () => {
      wrapper = await mountTemplatedCheck(["stg"], { journey: [typeStep("s1", "{{API_KEY}}")] });
      await replayJourney(wrapper);
      mockServiceListEnvironments.mockClear();
      mockServiceListEnvironments.mockResolvedValue({
        data: orgEnvironments([variable("API_KEY", "k")]),
      });

      await submitMissing(wrapper, { value: "k", secret: false });
      await flushPromises();

      expect(mockServiceCreateEnvironmentVariable).toHaveBeenCalledWith("default", "stg", {
        name: "API_KEY",
        value: "k",
        kind: "plain",
      });
      expect(mockServiceListEnvironments).toHaveBeenCalled();
      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      expect(replayedVariables()).toContainEqual({ name: "API_KEY", value: "k" });
      expect(missingDialogOpen(wrapper)).toBe(false);
    });

    it("updates an existing row with its description, example and tags, and without a kind", async () => {
      wrapper = await mountTemplatedCheck(
        ["stg"],
        { journey: [typeStep("s1", "{{API_KEY}}")] },
        orgEnvironments([unsetApiKeySecret]),
      );
      await replayJourney(wrapper);

      await submitMissing(wrapper, { value: "k", secret: true });
      await flushPromises();

      expect(mockServiceCreateEnvironmentVariable).not.toHaveBeenCalled();
      expect(mockServiceUpdateEnvironmentVariable).toHaveBeenCalledTimes(1);
      const [org, env, id, body] = mockServiceUpdateEnvironmentVariable.mock.calls[0];
      expect([org, env, id]).toEqual(["default", "stg", "var-api"]);
      expect(body).toStrictEqual({
        name: "API_KEY",
        value: "k",
        description: "Partner key",
        example: "pk_test",
        tags: ["billing"],
      });
    });

    it("locks Store as a secret to the existing row's kind", async () => {
      wrapper = await mountTemplatedCheck(
        ["stg"],
        { journey: [typeStep("s1", "{{API_KEY}}")] },
        orgEnvironments([unsetApiKeySecret]),
      );

      await replayJourney(wrapper);

      expect(missingDialogOpen(wrapper)).toBe(true);
      expect(missingDialog(wrapper).props("existingKind")).toBe("secret");
    });

    it("replays a value stored as a secret without asking for it again", async () => {
      wrapper = await mountTemplatedCheck(["stg"], { journey: [typeStep("s1", "{{API_KEY}}")] });
      await replayJourney(wrapper);
      mockServiceListEnvironments.mockResolvedValue({
        data: orgEnvironments([variable("API_KEY", undefined, "secret")]),
      });

      await submitMissing(wrapper, { value: "k", secret: true });
      await flushPromises();

      expect(mockServiceCreateEnvironmentVariable).toHaveBeenCalledWith("default", "stg", {
        name: "API_KEY",
        value: "k",
        kind: "secret",
      });
      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      expect(replayedVariables()).toContainEqual({ name: "API_KEY", value: "k" });
      expect(errorToasts()).toHaveLength(0);
      expect(secretsDialogOpen(wrapper)).toBe(false);

      mockRecorderReplay.mockClear();
      await replayJourney(wrapper);

      expect(secretsDialogOpen(wrapper)).toBe(false);
      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      expect(replayedVariables()).toContainEqual({ name: "API_KEY", value: "k" });
    });

    it("writes to the environment the replay was started in, even if the selector changes while the dialog is open", async () => {
      wrapper = await mountTemplatedCheck(["stg", "prod"], {
        journey: [typeStep("s1", "{{API_KEY}}")],
      });
      await replayJourney(wrapper);
      expect(missingDialogOpen(wrapper)).toBe(true);

      await chooseReplayEnvironment(wrapper, "prod");
      await submitMissing(wrapper, { value: "k", secret: false });
      await flushPromises();

      expect(mockServiceCreateEnvironmentVariable).toHaveBeenCalledTimes(1);
      expect(mockServiceCreateEnvironmentVariable.mock.calls[0][1]).toBe("stg");
      expect(mockRecorderReplay.mock.calls[0]?.[1]).toBe("https://stg.test/login");
    });

    it("asks for the next missing name only after the first dialog closes", async () => {
      wrapper = await mountTemplatedCheck(["stg"], {
        journey: [typeStep("s1", "{{API_KEY}}"), typeStep("s2", "{{TOKEN}}")],
      });
      await replayJourney(wrapper);
      expect(missingDialog(wrapper).props("name")).toBe("API_KEY");
      mockServiceListEnvironments.mockResolvedValue({
        data: orgEnvironments([variable("API_KEY", "k")]),
      });

      await submitMissing(wrapper, { value: "k", secret: false });
      await flushPromises();

      expect(missingDialogOpen(wrapper)).toBe(true);
      expect(missingDialog(wrapper).props("name")).toBe("TOKEN");
      const changes = missingDialogLog.filter((v, i, all) => i === 0 || v !== all[i - 1]);
      expect(changes.slice(changes.indexOf("API_KEY"))).toEqual(["API_KEY", "closed", "TOKEN"]);
      const open = wrapper
        .findAllComponents('[data-test="synthetics-missing-value-dialog-stub"]')
        .filter((d) => (d as VueWrapper<any>).props("open") === true);
      expect(open).toHaveLength(1);
      expect(mockRecorderReplay).not.toHaveBeenCalled();
    });

    it("keeps the dialog open and shows the server message when saving fails", async () => {
      const failure = { response: { status: 403, data: { message: "You cannot edit stg" } } };
      mockServiceCreateEnvironmentVariable.mockRejectedValue(failure);
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        wrapper = await mountTemplatedCheck(["stg"], {
          journey: [typeStep("s1", "{{API_KEY}}")],
        });
        await replayJourney(wrapper);

        await submitMissing(wrapper, { value: "k", secret: false }).catch(() => undefined);
        await flushPromises();

        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({ variant: "error", message: "You cannot edit stg" }),
        );
        expect(missingDialogOpen(wrapper)).toBe(true);
        expect(mockRecorderReplay).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
      } finally {
        consoleError.mockRestore();
      }
    });

    it("Replay anyway replays up to the step before the first use", async () => {
      wrapper = await mountTemplatedCheck(["stg"], {
        journey: [typeStep("s1", "a"), typeStep("s2", "b"), typeStep("s3", "{{API_KEY}}")],
      });
      await replayJourney(wrapper);
      expect(missingDialog(wrapper).props("steps")).toEqual([3]);
      expect(missingDialog(wrapper).props("canReplayAnyway")).toBe(true);

      missingDialog(wrapper).vm.$emit("replay-anyway");
      await flushPromises();

      expect(mockReplayUpTo).toHaveBeenCalledTimes(1);
      expect(mockReplayUpTo).toHaveBeenCalledWith(2);
      expect(missingDialogOpen(wrapper)).toBe(false);
    });

    it("Replay anyway replays in the environment the replay was started in", async () => {
      wrapper = await mountTemplatedCheck(["stg", "prod"], {
        journey: [typeStep("s1", "a"), typeStep("s2", "b"), typeStep("s3", "{{API_KEY}}")],
      });
      await replayJourney(wrapper);
      expect(missingDialogOpen(wrapper)).toBe(true);

      await chooseReplayEnvironment(wrapper, "prod");
      missingDialog(wrapper).vm.$emit("replay-anyway");
      await flushPromises();
      expect(mockReplayUpTo).toHaveBeenCalledWith(2);
      journeyStub(wrapper).vm.$emit("replay-up-to", 2);
      await flushPromises();

      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      expect(mockRecorderReplay.mock.calls[0]?.[1]).toBe("https://stg.test/login");
    });

    it("a Replay anyway that stops early does not pin the next replay to its environment", async () => {
      wrapper = await mountTemplatedCheck(["stg", "prod"], {
        journey: [typeStep("s1", "a"), typeStep("s2", "b"), typeStep("s3", "{{API_KEY}}")],
      });
      await replayJourney(wrapper);
      await chooseReplayEnvironment(wrapper, "prod");
      missingDialog(wrapper).vm.$emit("replay-anyway");
      await flushPromises();
      mockJourneyToWireSteps.mockReturnValueOnce([]);
      journeyStub(wrapper).vm.$emit("replay-up-to", 2);
      await flushPromises();
      expect(mockRecorderReplay).not.toHaveBeenCalled();

      journeyStub(wrapper).vm.$emit("replay-up-to", 2);
      await flushPromises();

      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      expect(mockRecorderReplay.mock.calls[0]?.[1]).toBe("https://prod.test/login");
    });

    it("replays a prefix that does not use the missing name without asking for it", async () => {
      wrapper = await mountTemplatedCheck(["stg"], {
        journey: [typeStep("s1", "a"), typeStep("s2", "b"), typeStep("s3", "{{API_KEY}}")],
      });

      journeyStub(wrapper).vm.$emit("replay-up-to", 2);
      await flushPromises();

      expect(missingDialogOpen(wrapper)).toBe(false);
      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
    });

    it("offers no Replay anyway when the Starting URL needs the value", async () => {
      wrapper = await mountTemplatedCheck(["stg"], {
        url: "{{API_KEY}}/login",
        journey: [typeStep("s1", "a"), typeStep("s2", "b")],
      });

      await replayJourney(wrapper);

      expect(missingDialogOpen(wrapper)).toBe(true);
      expect(missingDialog(wrapper).props("steps")).toContain(0);
      expect(missingDialog(wrapper).props("canReplayAnyway")).toBe(false);
    });

    it("waits for the shared lists before deciding a value is missing", async () => {
      let resolveEnvironments!: (value: unknown) => void;
      mockServiceListEnvironments.mockReturnValue(
        new Promise((resolve) => {
          resolveEnvironments = resolve;
        }),
      );
      wrapper = await mountLoadedCheck(["stg"], { journey: [typeStep("s1", "{{API_KEY}}")] });

      await replayJourney(wrapper);

      expect(missingDialogOpen(wrapper)).toBe(false);
      expect(mockRecorderReplay).not.toHaveBeenCalled();

      resolveEnvironments({ data: orgEnvironments([variable("API_KEY", "k")]) });
      await flushPromises();

      expect(missingDialogOpen(wrapper)).toBe(false);
      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      expect(replayedVariables()).toContainEqual({ name: "API_KEY", value: "k" });
    });

    it("replays as today, without the missing-value dialog, when the environment list is refused", async () => {
      mockServiceListEnvironments.mockRejectedValue({ response: { status: 403 } });
      wrapper = await mountLoadedCheck(["stg"], { journey: [typeStep("s1", "{{API_KEY}}")] });

      await replayJourney(wrapper);

      expect(missingDialogOpen(wrapper)).toBe(false);
      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
    });

    it("shows an error when the extension refuses the replay command", async () => {
      mockRecorderReplay.mockRejectedValue(new Error("The extension refused the replay"));
      wrapper = await mountTemplatedCheck(["stg"], { journey: [typeStep("s1", "hello")] });

      await replayJourney(wrapper);

      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "The extension refused the replay",
        }),
      );
    });

    it("shows an error when a subtest cannot be loaded for replay", async () => {
      const subtestStep: BrowserStep = {
        id: "s1",
        action: "subtest",
        name: "Log in (shared)",
        subtest: { id: "login-test", name: "Login" },
      };
      mockServiceListEnvironments.mockResolvedValue({ data: orgEnvironments() });
      mockServiceGet.mockImplementation(async (_org: string, id: string) => {
        if (id === "check-123") {
          return {
            data: {
              name: "Login",
              url: "{{BASE_URL}}/login",
              environments: ["stg"],
              journey: [subtestStep],
            },
          };
        }
        throw new Error("child unavailable");
      });
      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();
      mockToast.mockClear();

      await replayJourney(wrapper);

      expect(errorToasts()).toHaveLength(1);
      expect(mockRecorderReplay).not.toHaveBeenCalled();
    });

    it("reports a name used inside a subtest under the reference row's number", async () => {
      const subtestStep: BrowserStep = {
        id: "s2",
        action: "subtest",
        name: "Authorize (shared)",
        subtest: { id: "auth-test", name: "Authorize" },
      };
      mockServiceListEnvironments.mockResolvedValue({ data: orgEnvironments() });
      mockServiceGet.mockImplementation(async (_org: string, id: string) => {
        if (id === "check-123") {
          return {
            data: {
              name: "Login",
              url: "{{BASE_URL}}/login",
              environments: ["stg"],
              journey: [typeStep("s1", "a"), subtestStep],
            },
          };
        }
        return {
          data: {
            name: "Authorize",
            config: { steps: [typeStep("c1", "b"), typeStep("c2", "{{API_KEY}}")] },
          },
        };
      });
      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();

      await replayJourney(wrapper);

      expect(missingDialogOpen(wrapper)).toBe(true);
      expect(missingDialog(wrapper).props("steps")).toEqual([2]);
      expect(missingDialog(wrapper).props("canReplayAnyway")).toBe(true);
      expect(mockRecorderReplay).not.toHaveBeenCalled();
    });

    it("saves a missing value into Global when the check pins no environment", async () => {
      mockServiceListGlobalVariables.mockResolvedValue({
        data: [variable("BASE_URL", "https://global.test")],
      });
      wrapper = await mountTemplatedCheck([], { journey: [typeStep("s1", "{{API_KEY}}")] });
      await replayJourney(wrapper);

      expect(missingDialogOpen(wrapper)).toBe(true);
      expect(missingDialog(wrapper).props("isGlobal")).toBe(true);
      expect(missingDialog(wrapper).props("environmentName")).toBe("Global");

      await submitMissing(wrapper, { value: "k", secret: false });
      await flushPromises();

      expect(mockServiceCreateGlobalVariable).toHaveBeenCalledWith("default", {
        name: "API_KEY",
        value: "k",
        kind: "plain",
      });
      expect(mockServiceCreateEnvironmentVariable).not.toHaveBeenCalled();
    });

    it("asks for a stored secret before the first replay, then replays with the typed value", async () => {
      wrapper = await mountTemplatedCheck(["stg"], { journey: [typeStep("s1", "{{PASSWORD}}")] });

      await replayJourney(wrapper);

      expect(secretsDialogOpen(wrapper)).toBe(true);
      expect(secretsDialog(wrapper).props("mode")).toBe("ask");
      expect(secretsDialog(wrapper).props("environmentName")).toBe("stg");
      expect(secretsDialog(wrapper).props("secrets")).toEqual([
        expect.objectContaining({ name: "PASSWORD", steps: [1] }),
      ]);
      expect(mockRecorderReplay).not.toHaveBeenCalled();

      await (secretsDialog(wrapper).props("onSubmit") as (v: unknown) => Promise<void> | void)({
        PASSWORD: "p",
      });
      await flushPromises();

      expect(secretsDialogOpen(wrapper)).toBe(false);
      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      expect(replayedVariables()).toContainEqual({ name: "PASSWORD", value: "p" });
    });

    it("does not ask again in the same session", async () => {
      wrapper = await mountTemplatedCheck(["stg"], { journey: [typeStep("s1", "{{PASSWORD}}")] });
      await typeSecret(wrapper, { PASSWORD: "p" });
      mockRecorderReplay.mockClear();

      await replayJourney(wrapper);

      expect(secretsDialogOpen(wrapper)).toBe(false);
      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      expect(replayedVariables()).toContainEqual({ name: "PASSWORD", value: "p" });
    });

    it("asks again in another environment", async () => {
      wrapper = await mountTemplatedCheck(
        ["stg"],
        { journey: [typeStep("s1", "{{PASSWORD}}")] },
        qaEnvironments(),
      );
      await typeSecret(wrapper, { PASSWORD: "p" });
      mockRecorderReplay.mockClear();

      await chooseReplayEnvironment(wrapper, "qa");
      await replayJourney(wrapper);

      expect(secretsDialogOpen(wrapper)).toBe(true);
      expect(secretsDialog(wrapper).props("environmentName")).toBe("qa");
      expect(mockRecorderReplay).not.toHaveBeenCalled();
    });

    it("forgets a typed secret on Forget value", async () => {
      wrapper = await mountTemplatedCheck(["stg"], { journey: [typeStep("s1", "{{PASSWORD}}")] });
      await typeSecret(wrapper, { PASSWORD: "p" });

      replayMenu(wrapper).vm.$emit("edit-secrets");
      await flushPromises();
      expect(secretsDialogOpen(wrapper)).toBe(true);
      expect(secretsDialog(wrapper).props("mode")).toBe("change");
      secretsDialog(wrapper).vm.$emit("forget", ["PASSWORD"]);
      await flushPromises();
      mockRecorderReplay.mockClear();
      await replayJourney(wrapper);

      expect(secretsDialogOpen(wrapper)).toBe(true);
      expect(secretsDialog(wrapper).props("mode")).toBe("ask");
      expect(mockRecorderReplay).not.toHaveBeenCalled();
    });

    it("Save & re-run replays in the environment the secrets were typed for", async () => {
      wrapper = await mountTemplatedCheck(
        ["stg"],
        { journey: [typeStep("s1", "{{PASSWORD}}")] },
        qaEnvironments(),
      );
      await typeSecret(wrapper, { PASSWORD: "p" });
      mockRecorderReplay.mockClear();

      replayMenu(wrapper).vm.$emit("edit-secrets");
      await flushPromises();
      await chooseReplayEnvironment(wrapper, "qa");
      await (secretsDialog(wrapper).props("onSubmit") as (v: unknown) => Promise<void> | void)({
        PASSWORD: "p2",
      });
      await flushPromises();
      expect(mockRequestReplay).toHaveBeenCalledTimes(1);
      expect(mockRequestReplay).toHaveBeenCalledWith();
      journeyStub(wrapper).vm.$emit("replay");
      await flushPromises();

      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      expect(mockRecorderReplay.mock.calls[0]?.[1]).toBe("https://stg.test/login");
      expect(replayedVariables()).toContainEqual({ name: "PASSWORD", value: "p2" });
    });

    it("typed secrets are gone after the editor remounts", async () => {
      wrapper = await mountTemplatedCheck(["stg"], { journey: [typeStep("s1", "{{PASSWORD}}")] });
      await typeSecret(wrapper, { PASSWORD: "p" });
      wrapper.unmount();
      mockRecorderReplay.mockClear();

      wrapper = await mountTemplatedCheck(["stg"], { journey: [typeStep("s1", "{{PASSWORD}}")] });
      await replayJourney(wrapper);

      expect(secretsDialogOpen(wrapper)).toBe(true);
      expect(mockRecorderReplay).not.toHaveBeenCalled();
    });

    it("a missing value is asked before a secret, in a second dialog after the first closes", async () => {
      wrapper = await mountTemplatedCheck(["stg"], {
        journey: [typeStep("s1", "{{PASSWORD}}"), typeStep("s2", "{{API_KEY}}")],
      });
      await replayJourney(wrapper);
      expect(missingDialogOpen(wrapper)).toBe(true);
      expect(secretsDialogOpen(wrapper)).toBe(false);
      mockServiceListEnvironments.mockResolvedValue({
        data: orgEnvironments([variable("API_KEY", "k")]),
      });

      await submitMissing(wrapper, { value: "k", secret: false });
      await flushPromises();

      expect(missingDialogOpen(wrapper)).toBe(false);
      expect(missingDialogLog.at(-1)).toBe("closed");
      expect(secretsDialogOpen(wrapper)).toBe(true);
      expect(secretsDialog(wrapper).props("secrets")).toEqual([
        expect.objectContaining({ name: "PASSWORD" }),
      ]);
      expect(mockRecorderReplay).not.toHaveBeenCalled();
    });

    it("a check-level secure variable replays without a prompt", async () => {
      wrapper = await mountTemplatedCheck(["stg"], {
        journey: [typeStep("s1", "{{PASSWORD}}")],
        variables: [{ name: "PASSWORD", value: "s3cret", secure: true }],
      });

      await replayJourney(wrapper);

      expect(secretsDialogOpen(wrapper)).toBe(false);
      expect(missingDialogOpen(wrapper)).toBe(false);
      expect(mockRecorderReplay).toHaveBeenCalledTimes(1);
      expect(replayedVariables()).toContainEqual(
        expect.objectContaining({ name: "PASSWORD", value: "s3cret" }),
      );
    });

    it("recording receives a typed secret", async () => {
      wrapper = await mountTemplatedCheck(["stg"], { journey: [typeStep("s1", "{{PASSWORD}}")] });
      expect([...(journeyStub(wrapper).props("secretNames") ?? [])]).toContain("PASSWORD");

      await typeSecret(wrapper, { PASSWORD: "p" });

      expect(journeyStub(wrapper).props("variables")).toContainEqual({
        name: "PASSWORD",
        value: "p",
      });
      expect([...(journeyStub(wrapper).props("secretNames") ?? [])]).not.toContain("PASSWORD");
    });

    it("the Replay key shows only when a needed secret is typed for the current environment", async () => {
      wrapper = await mountTemplatedCheck(
        ["stg"],
        { journey: [typeStep("s1", "{{PASSWORD}}")] },
        qaEnvironments(),
      );
      expect(journeyStub(wrapper).props("usesTypedSecrets")).toBe(false);

      await typeSecret(wrapper, { PASSWORD: "p" });
      expect(journeyStub(wrapper).props("usesTypedSecrets")).toBe(true);

      await chooseReplayEnvironment(wrapper, "qa");
      expect(journeyStub(wrapper).props("usesTypedSecrets")).toBe(false);
    });

    it("should hand the journey the resolved starting URL for recording", async () => {
      wrapper = await mountTemplatedCheck(["stg"]);

      expect(journeyStub(wrapper).props("startUrl")).toBe("https://stg.test/login");
    });
  });

  // Regression: `?folder=` was copied into the check unvalidated. A bookmarked
  // link, a folder deleted since, or a link from another org left an id no
  // option could resolve — the select rendered the raw id, and `persist` sent it
  // back as `?folder=`, which the server treats as authoritative for both the
  // destination folder and the RBAC gate, so the save failed on a folder the
  // author never picked.
  describe("destinations refresh", () => {
    // A destination made in another tab never expires this tab's cache, so only a forced read shows it.
    it("should re-read the destinations from the server when the picker asks for a refresh", async () => {
      wrapper = await mountCreateAtConfigure();
      expect(destinationService.list).toHaveBeenCalledTimes(1);

      wrapper
        .findComponent('[data-test="synthetics-check-configure"]')
        .vm.$emit("refresh:destinations");
      await flushPromises();

      expect(destinationService.list).toHaveBeenCalledTimes(2);
    });
  });

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
  // `check.url` is one value with two views: Configure's field and the journey's row 0.
  describe("Starting URL opens the run", () => {
    const journeyStub = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-browser-journey"]') as VueWrapper<any>;
    const configureStub = (w: VueWrapper) => w.findComponent(baseStubs.CheckConfigure);
    const pill = (w: VueWrapper) =>
      w.findComponent('[data-test="synthetics-journey-start-pill-stub"]') as VueWrapper<any>;
    const HINT = "Not opened — the first Step navigates.";
    const click: BrowserStep = {
      id: "s1",
      action: "click",
      name: "Sign in",
      locator: { candidates: [{ kind: "css", value: "#login" }] },
    };
    const nav = (url: string): BrowserStep => ({
      id: "n1",
      action: "navigate",
      name: "Open",
      value: url,
    });

    async function mountEditWith(extra: Record<string, unknown>) {
      mockServiceGet.mockResolvedValue({
        data: {
          name: "Test Check",
          url: "https://example.com/start",
          folder: "folder-1",
          journey: [],
          ...extra,
        },
      });
      const w = mountPage({ editId: "check-123" });
      await flushPromises();
      return w;
    }

    /** Edit mode: Save & Continue is the only way onto Configure. */
    async function goToConfigure(w: VueWrapper) {
      await w.find('[data-test="synthetics-create-save-continue-btn"]').trigger("click");
      await flushPromises();
    }

    it("passes the replay environment's values to the journey for recording", async () => {
      mockServiceListEnvironments.mockResolvedValue({ data: orgEnvironments() });
      wrapper = await mountEditWith({
        environments: ["stg"],
        variables: [{ name: "USER", value: "alice" }],
      });

      const variables = journeyStub(wrapper).props("variables");
      expect(variables).toContainEqual({ name: "BASE_URL", value: "https://stg.test" });
      expect(variables).toContainEqual({ name: "USER", value: "alice" });
    });

    it("tells Configure the Starting URL is not opened when the first Step navigates", async () => {
      wrapper = await mountEditWith({ journey: [nav("https://example.com/login"), click] });
      await goToConfigure(wrapper);

      expect(configureStub(wrapper).props("targetHint")).toBe(HINT);
    });

    it("gives Configure no hint when the first Step is not a navigate", async () => {
      wrapper = await mountEditWith({ journey: [click] });
      await goToConfigure(wrapper);

      expect(configureStub(wrapper).props("targetHint")).toBeFalsy();
    });

    // The skip rule reads the EXPANDED first step, so a leading Subtest's child decides.
    it("reads the hint through a leading Subtest whose child starts with a navigate", async () => {
      const subtestStep: BrowserStep = {
        id: "s1",
        action: "subtest",
        name: "Log in (shared)",
        subtest: { id: "login-test", name: "Login" },
      };
      mockServiceGet.mockImplementation(async (_org: string, id: string) => {
        if (id === "login-test") {
          return {
            data: {
              name: "Login",
              folder_id: "shared",
              config: {
                steps: [
                  {
                    id: "c1",
                    action: "navigate",
                    name: "Open login",
                    value: "https://example.com/login",
                  },
                ],
              },
            },
          };
        }
        return {
          data: {
            name: "Test Check",
            url: "https://example.com/start",
            folder: "folder-1",
            journey: [subtestStep, click],
          },
        };
      });
      wrapper = mountPage({ editId: "check-123" });
      await flushPromises();
      await goToConfigure(wrapper);

      expect(configureStub(wrapper).props("targetHint")).toBe(HINT);
    });

    it("an Apply in the Starting URL popover updates the check's URL and marks it unsaved", async () => {
      wrapper = await mountEditWith({});
      expect(leaveAsks()).toBe(false);

      pill(wrapper).vm.$emit("update:url", "{{BASE_URL}}/x");
      await flushPromises();

      expect(pill(wrapper).props("url")).toBe("{{BASE_URL}}/x");
      expect(leaveAsks()).toBe(true);
      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();
      expect(mockServiceUpdate).toHaveBeenCalledWith(
        "default",
        "check-123",
        expect.objectContaining({ url: "{{BASE_URL}}/x" }),
        "folder-1",
      );
    });

    it("choosing environments in the pill saves them with the test", async () => {
      mockServiceListEnvironments.mockResolvedValue({ data: orgEnvironments() });
      wrapper = await mountEditWith({ environments: ["prod"] });
      expect(pill(wrapper).props("selectedIds")).toEqual(["prod"]);

      pill(wrapper).vm.$emit("update:selected-ids", ["prod", "stg"]);
      await flushPromises();
      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(mockServiceUpdate).toHaveBeenCalledWith(
        "default",
        "check-123",
        expect.objectContaining({ environments: ["prod", "stg"] }),
        "folder-1",
      );
    });

    it("Configure shows the environments chosen on the Journey step", async () => {
      mockServiceListEnvironments.mockResolvedValue({ data: orgEnvironments() });
      wrapper = await mountEditWith({ environments: [] });

      pill(wrapper).vm.$emit("update:selected-ids", ["stg"]);
      await flushPromises();
      await goToConfigure(wrapper);

      expect(
        (configureStub(wrapper).props("check") as { environments?: string[] }).environments,
      ).toEqual(["stg"]);
    });

    it("warns, and still saves, when no navigate shares the Starting URL's host", async () => {
      wrapper = await mountEditWith({ journey: [click, nav("https://other.test/login")] });

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        variant: "warning",
        message: "This test opens example.com, but its steps navigate to other.test.",
      });
      expect(mockServiceUpdate).toHaveBeenCalledTimes(1);
      expect(mockRouterPush).toHaveBeenCalledTimes(1);
    });

    it("does not warn when a navigate shares the Starting URL's host", async () => {
      wrapper = await mountEditWith({
        journey: [click, nav("https://other.test/x"), nav("https://example.com/y")],
      });

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
      expect(mockServiceUpdate).toHaveBeenCalledTimes(1);
    });

    it("does not warn when nothing in the journey navigates", async () => {
      wrapper = await mountEditWith({ journey: [click] });

      await wrapper.find('[data-test="synthetics-create-save-exit-btn"]').trigger("click");
      await flushPromises();

      expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
      expect(mockServiceUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
