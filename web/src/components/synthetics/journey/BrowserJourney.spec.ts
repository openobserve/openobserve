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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import type { BrowserStep } from "@/types/synthetics";
import type { ChildJourney, ExpansionMap } from "@/utils/synthetics/expandJourney";

// `t` still returns the bare key — every existing assertion compares against one.
// It is a spy as well so the interpolation params can be asserted, which is the
// only place the step NUMBERS in a message are observable.
const mockT = vi.fn((key: string, ..._args: unknown[]) => key);
vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: mockT }),
}));

// Validation raises toasts, so the call has to be observable. The real
// implementation is a no-op in jsdom, which is why nothing needed this before.
const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

// Mocked so `ensureChildLoaded`'s `org.value` read (via useStore) resolves
// instead of throwing when no Vuex plugin is installed on the test wrapper.
vi.mock("vuex", async () => {
  const actual = await vi.importActual<typeof import("vuex")>("vuex");
  return {
    ...actual,
    useStore: () => ({ state: { selectedOrganization: { identifier: "default" } } }),
  };
});

const mockSyntheticsGet = vi.fn();
vi.mock("@/services/synthetics", () => ({
  default: { get: (...args: unknown[]) => mockSyntheticsGet(...args) },
}));

import BrowserJourney from "./BrowserJourney.vue";

// Stubs emit native-component click so parent @click handlers fire.
const OButtonStub = {
  template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
};
const OIconStub = { template: "<i />" };
const OBadgeStub = { template: "<span><slot /></span>" };
const OInputStub = {
  props: ["modelValue"],
  emits: ["update:modelValue"],
  template:
    '<input v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};
const OSelectStub = {
  props: ["modelValue", "options", "label", "error", "errorMessage"],
  template: '<select v-bind="$attrs" />',
};
const OCheckboxStub = {
  props: ["modelValue", "size"],
  template: '<input type="checkbox" v-bind="$attrs" />',
};
const OTooltipStub = {
  props: ["content"],
  template: "<div />",
};
const JourneyStepsStub = {
  props: ["data", "mode", "selectedIds", "expandedIds"],
  template:
    '<div class="journey-steps-stub" :data-test-multi="$attrs[\'data-test\']"><div v-for="item in data" :key="item.id" class="step-row">{{ item.name }}</div></div>',
};

// Stub that renders the expansion slot so inline-editor interactions (selector,
// value, timeout inputs) can be tested through the DOM.
const JourneyStepsStubWithExpansion = {
  props: ["data", "mode", "selectedIds", "expandedIds", "selectionEnabled", "locked", "readonly"],
  template: `
    <div class="journey-steps-stub" :data-test-multi="$attrs['data-test']">
      <div v-for="item in data" :key="item.id" class="step-row">
        {{ item.name }}
        <slot name="expansion" :row="item" />
      </div>
    </div>`,
};

// Stub that surfaces each row's status-dot state in the DOM, so the dot logic can be
// asserted without pulling in the real OTable.
const JourneyStepsStubWithDots = {
  props: ["data", "mode", "selectedIds", "expandedIds", "dotStateFn"],
  template: `
    <div class="journey-steps-stub">
      <div
        v-for="item in data"
        :key="item.id"
        class="step-row"
        :data-step-id="item.id"
        :data-dot-state="dotStateFn ? dotStateFn(item) : ''"
      >{{ item.name }}</div>
    </div>`,
};

const ConfirmDialogStub = {
  template: '<div class="confirm-dialog-stub" />',
};

// Surfaces open/action in the DOM so the record/replay gating can be asserted
// without pulling in the real ODialog.
const ExtensionSetupDialogStub = {
  props: ["open", "connected", "action"],
  emits: ["update:open", "continue", "verify"],
  template: '<div v-if="open" class="extension-setup-dialog-stub" :data-action="action" />',
};

const STUBS = {
  OButton: OButtonStub,
  OIcon: OIconStub,
  OBadge: OBadgeStub,
  OInput: OInputStub,
  OSelect: OSelectStub,
  OCheckbox: OCheckboxStub,
  OTooltip: OTooltipStub,
  JourneySteps: JourneyStepsStub,
  ConfirmDialog: ConfirmDialogStub,
  ExtensionSetupDialog: ExtensionSetupDialogStub,
};

// ── Bridge transport helpers ──────────────────────────────────────────────

let postMessageSpy: ReturnType<typeof vi.fn>;

function getLastCommandNonce(): string | null {
  const calls = postMessageSpy.mock.calls;
  for (let i = calls.length - 1; i >= 0; i--) {
    const data = calls[i]?.[0];
    if (data?.msg?.type === "synthetics-command") return data.nonce as string;
  }
  return null;
}

function respondToLastCommand(msg: unknown) {
  const nonce = getLastCommandNonce();
  if (!nonce) throw new Error("No pending command nonce to respond to");
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: { ch: "oo-bridge", dir: "to-page", nonce, msg },
    }),
  );
}

function emitStreamEvent(payload: Record<string, unknown>) {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: window,
      data: {
        ch: "oo-bridge",
        dir: "to-page",
        msg: { type: "synthetics-recorder", recordingId: "rec_1", payload },
      },
    }),
  );
}

async function settleProbeDelay() {
  await vi.advanceTimersByTimeAsync(500);
}

// ── Mount helper ──────────────────────────────────────────────────────────

function mountJourney(props: Record<string, unknown> = {}) {
  return mount(BrowserJourney, {
    props: { modelValue: [], ...props },
    global: { stubs: STUBS },
  }) as VueWrapper;
}

describe("BrowserJourney recording", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    postMessageSpy = vi.fn();
    vi.spyOn(window, "postMessage").mockImplementation(postMessageSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should open the extension setup dialog when recording without a ready extension", async () => {
    wrapper = mountJourney({ extensionReady: false });

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger("click");

    const dialog = wrapper.find(".extension-setup-dialog-stub");
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("data-action")).toBe("record");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  it("should open the extension setup dialog instead of replaying without a ready extension", async () => {
    wrapper = mountJourney({
      extensionReady: false,
      replayPhase: "idle",
      modelValue: [{ id: "s1", action: "navigate", name: "Open app", value: "https://app.test" }],
    });

    await wrapper.find('[data-test="synthetics-journey-replay-btn"]').trigger("click");

    const dialog = wrapper.find(".extension-setup-dialog-stub");
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("data-action")).toBe("replay");
    expect(wrapper.emitted("replay")).toBeFalsy();
  });

  it("should emit replay from the setup dialog's continue", async () => {
    wrapper = mountJourney({
      extensionReady: false,
      replayPhase: "idle",
      modelValue: [{ id: "s1", action: "navigate", name: "Open app", value: "https://app.test" }],
    });
    await wrapper.find('[data-test="synthetics-journey-replay-btn"]').trigger("click");

    await wrapper.findComponent(ExtensionSetupDialogStub).vm.$emit("continue");

    expect(wrapper.emitted("replay")).toBeTruthy();
  });

  // The parent owns the connection state, so the dialog's re-verify request
  // (incognito toggle reloads the extension → stale bridge) is forwarded up.
  it("should forward the setup dialog's verify as verify-extension", async () => {
    wrapper = mountJourney({ extensionReady: false });

    await wrapper.findComponent(ExtensionSetupDialogStub).vm.$emit("verify");

    expect(wrapper.emitted("verify-extension")).toHaveLength(1);
  });

  it("should start recording and render streamed live steps", async () => {
    wrapper = mountJourney({ extensionReady: true, startUrl: "https://app.test/login" });

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger("click");

    // The composable sends a probe then waits 500ms before sending the command.
    await settleProbeDelay();
    respondToLastCommand({ success: true });
    await flushPromises();

    // PostMessage should have been called (probe + command)
    expect(postMessageSpy).toHaveBeenCalled();
    // Stop button should be visible now that isRecording is true
    expect(wrapper.find('[data-test="synthetics-journey-stop-btn"]').exists()).toBe(true);
    // Cancel is a labelled toolbar button, so it carries a leading icon like its siblings.
    const cancel = wrapper.find('[data-test="synthetics-journey-cancel-btn"]');
    expect(cancel.attributes("icon-left")).toBe("close");
    expect(cancel.attributes("variant")).toBe("outline");
    expect(wrapper.findAll('[class~="w-24!"]')).toHaveLength(0);

    // Stream steps via the bridge
    emitStreamEvent({
      method: "setActions",
      browserSteps: [{ id: "s1", action: "click", name: "Click login", selector: "#login" }],
    });
    await flushPromises();

    expect(wrapper.findAll(".step-row")).toHaveLength(1);
    expect(wrapper.find(".step-row").text()).toBe("Click login");
  });

  it("should merge recorded steps into the journey on stop", async () => {
    wrapper = mountJourney({ modelValue: [], extensionReady: true });

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger("click");

    await settleProbeDelay();
    respondToLastCommand({ success: true });
    await flushPromises();

    // Steps stream in live over the bridge, then Stop merges them.
    emitStreamEvent({
      method: "setActions",
      browserSteps: [{ id: "s1", action: "navigate", url: "https://app.test" }],
    });
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger("click");
    respondToLastCommand({ success: true });
    await flushPromises();

    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    const finalSteps = emitted![emitted!.length - 1][0] as any[];
    expect(finalSteps).toHaveLength(1);
    expect(finalSteps[0].action).toBe("navigate");
    expect(finalSteps[0].value).toBe("https://app.test");
  });

  it("should auto-start recording on mount when autoRecord is set", async () => {
    wrapper = mountJourney({
      extensionReady: true,
      autoRecord: true,
      startUrl: "https://app.test",
    });

    await settleProbeDelay();
    respondToLastCommand({ success: true });
    await flushPromises();

    expect(postMessageSpy).toHaveBeenCalled();
    expect(wrapper.find('[data-test="synthetics-journey-stop-btn"]').exists()).toBe(true);
  });

  // The v1 counterpart of this test — editing the bare `selector` input and
  // asserting it reached `wire.selector` — was deleted with the v1 authoring path.
  // The mechanism it guarded (an edit must land in `wire`, or journeyToWireSteps
  // discards it at replay time) is covered by the navigate-URL test below.

  // Regression: this view used to inline its own, thinner copy of the step
  // editor. It rendered no locator bundle, no settle block, no assertion editor
  // and no optional/always-run checkboxes, so which fields an author could see
  // depended on whether they were recording or editing a saved check.
  it("should render the full step editor, not a reduced copy of it", async () => {
    const step = {
      id: "s1",
      action: "click",
      name: "Sign in",
      locator: { candidates: [{ kind: "test_attribute", value: '[data-test="sign-in"]' }] },
      settle: {
        navigation: { url_pattern: "**/web/**" },
        responses: [{ url_pattern: "**/auth/login", method: "POST", required: false }],
        budget_ms: 5000,
      },
      wire: { id: "w1", action: "click" },
    };

    wrapper = mount(BrowserJourney, {
      props: { modelValue: [step] },
      global: { stubs: { ...STUBS, JourneySteps: JourneyStepsStubWithExpansion } },
    });

    // The editor keeps its tuning fields behind one `Advanced` collapsible (SE-5),
    // and OCollapsible unmounts collapsed content — so open it before asserting. The
    // point of this test is that no field is MISSING, not that all of them are
    // visible at once.
    const advanced = wrapper.find('[data-test="synthetics-journey-step-group-advanced"] button');
    expect(advanced.exists()).toBe(true);
    if (advanced.attributes("data-state") !== "open") await advanced.trigger("click");

    for (const dt of [
      "synthetics-journey-step-editor",
      "synthetics-journey-step-group-does",
      "synthetics-journey-step-group-advanced",
      "synthetics-journey-step-locator",
      "synthetics-journey-step-settle",
      "synthetics-journey-step-settle-required-0",
      "synthetics-journey-step-settle-budget-input",
      "synthetics-journey-step-optional-checkbox",
      "synthetics-journey-step-always-run-checkbox",
      "synthetics-journey-step-timeout-input",
    ]) {
      expect(wrapper.find(`[data-test="${dt}"]`).exists(), dt).toBe(true);
    }
  });

  it("should route an edited navigate URL to wire.url so replay uses it", async () => {
    const step = {
      id: "s1",
      action: "navigate",
      name: "Open page",
      value: "https://old.test",
      wire: { id: "w1", action: "navigate", url: "https://old.test" },
    };

    wrapper = mount(BrowserJourney, {
      props: { modelValue: [step] },
      global: { stubs: { ...STUBS, JourneySteps: JourneyStepsStubWithExpansion } },
    });

    await wrapper
      .find('[data-test="synthetics-journey-step-value-input"]')
      .setValue("https://new.test");

    const emitted = wrapper.emitted("update:modelValue")!;
    const next = emitted[emitted.length - 1][0] as any[];
    expect(next[0].value).toBe("https://new.test");
    expect(next[0].wire.url).toBe("https://new.test");
  });

  it("should emit clear-results when modelValue becomes empty", async () => {
    wrapper = mountJourney({
      modelValue: [{ id: "s1", action: "click", name: "Step 1" }],
    });

    // Clearing all steps should trigger the length watcher to emit clear-results
    // so the replay pass/fail banner does not persist.
    await wrapper.setProps({ modelValue: [] });

    expect(wrapper.emitted("clear-results")).toBeTruthy();
  });
});

describe("BrowserJourney step validation", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  function validate(modelValue: unknown[]): boolean {
    wrapper = mountJourney({ modelValue });
    return (wrapper.vm as any).validateStepSelectors();
  }

  // The version-1 channel. Only the locator bundle reaches the wire now, so a
  // step whose element lives in `selector` alone would be posted target-less.
  it("should fail a step whose only target is a version-1 selector", () => {
    expect(
      validate([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "click", selector: "#login" },
      ]),
    ).toBe(false);
  });

  // Regression: a v2 step identifies its element with a locator bundle and has
  // no `selector` at all. Requiring `selector` blocked Save & Continue on every
  // recorded journey the moment it was reopened for editing.
  it("should pass a v2 step that identifies its element by locator", () => {
    expect(
      validate([
        { id: "1", action: "navigate", value: "https://app.test" },
        {
          id: "2",
          action: "click",
          locator: {
            candidates: [{ kind: "test_attribute", value: 'internal:testid=[data-test="login"]' }],
          },
        },
      ]),
    ).toBe(true);
  });

  it("should pass a step whose only target is a locator the author wrote", () => {
    expect(
      validate([
        { id: "1", action: "navigate", value: "https://app.test" },
        {
          id: "2",
          action: "click",
          locator: {
            candidates: [{ kind: "css", value: "#login", origin: "authored" }],
            author_ordered: true,
          },
        },
      ]),
    ).toBe(true);
  });

  it("should pass a page-level assertion, which targets no element", () => {
    expect(
      validate([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "assert", assertion: { kind: "url_matches", expected: "/home" } },
      ]),
    ).toBe(true);
  });

  it("should fail a step that identifies no element at all", () => {
    expect(
      validate([
        { id: "1", action: "navigate", value: "https://app.test" },
        { id: "2", action: "click" },
      ]),
    ).toBe(false);
  });

  it("should fail when the first step does not navigate", () => {
    expect(validate([{ id: "1", action: "click", selector: "#login" }])).toBe(false);
  });

  // The expanded journey starts with the child's own navigate, which is why the save
  // schema and the server already accept this; the client rule has to agree.
  it("accepts a subtest as the first step, like the save schema does", async () => {
    mockToast.mockClear();
    expect(
      validate([
        { id: "s1", action: "subtest", name: "Login", subtest: { id: "child-1" } },
        {
          id: "s2",
          action: "click",
          name: "Sign in",
          locator: { candidates: [{ kind: "css", value: "#login" }] },
        },
      ]),
    ).toBe(true);
    await wrapper.vm.$nextTick();
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "synthetics.validation.firstStepMustNavigate" }),
    );
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    // No first-step error means nothing auto-expands row 0.
    expect(wrapper.findComponent(JourneyStepsStub).props("expandedIds")).not.toContain("s1");
  });

  // The case above is not isolated: that step names no element either, so it
  // fails the target rule too and would keep failing with the first-step rule
  // deleted. This one carries a valid locator, so only the first-step rule can
  // reject it.
  it("should fail a first step that does not navigate even when it names its element", () => {
    expect(
      validate([
        {
          id: "1",
          action: "click",
          locator: { candidates: [{ kind: "css", value: "#login" }] },
        },
      ]),
    ).toBe(false);
  });
});

// ── validateStepSelectors side effects ────────────────────────────────────
// The cases above assert only the boolean. Auto-expand has been in this file
// since the first commit and had no test at all, so it was free to stop covering
// new rules unnoticed — which is exactly what happened. The toast is asserted
// here too because `persist` now suppresses it.
describe("BrowserJourney validateStepSelectors side effects", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    mockToast.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  function expandedIds(): string[] {
    return wrapper.findComponent(JourneyStepsStub).props("expandedIds") as string[];
  }

  const NAV = { id: "s1", action: "navigate", name: "Open", value: "https://app.test" };

  it("should expand a step that names no element", async () => {
    wrapper = mountJourney({ modelValue: [NAV, { id: "s2", action: "click", name: "Sign in" }] });

    (wrapper.vm as any).validateStepSelectors();
    await wrapper.vm.$nextTick();

    expect(expandedIds()).toContain("s2");
  });

  it("should expand the first step when it does not navigate", async () => {
    wrapper = mountJourney({
      modelValue: [
        {
          id: "s1",
          action: "click",
          name: "Sign in",
          locator: { candidates: [{ kind: "css", value: "#a" }] },
        },
      ],
    });

    (wrapper.vm as any).validateStepSelectors();
    await wrapper.vm.$nextTick();

    expect(expandedIds()).toContain("s1");
  });

  // A filtered-out row is not rendered, so expanding it puts nothing on screen.
  it("should clear an active filter so the errored step is rendered", async () => {
    wrapper = mountJourney({ modelValue: [NAV, { id: "s2", action: "click", name: "Sign in" }] });
    await wrapper
      .find('[data-test="synthetics-journey-filter-input"]')
      .setValue("nothing-matches-this");

    (wrapper.vm as any).validateStepSelectors();
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(JourneyStepsStub).props("data")).toHaveLength(2);
  });

  it("should raise an error toast by default", () => {
    wrapper = mountJourney({ modelValue: [NAV, { id: "s2", action: "click", name: "Sign in" }] });

    (wrapper.vm as any).validateStepSelectors();

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });
});

// ── Schema-issue auto-expand ──────────────────────────────────────────────
// `validateJourneySteps` knows two rules (first-step-navigate, missing target).
// Every OTHER save-blocking rule lives in the zod schema and reaches this
// component only through `setStepFieldErrors`, which recorded the message but
// never opened the row — so "fix the highlighted fields" pointed at a collapsed
// row with no highlight on it.
describe("BrowserJourney fieldIssues auto-expand", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  function expandedIds(): string[] {
    return wrapper.findComponent(JourneyStepsStub).props("expandedIds") as string[];
  }

  const JOURNEY = [
    { id: "s1", action: "navigate", name: "Open", value: "https://app.test" },
    { id: "s2", action: "type", name: "", locator: { candidates: [{ kind: "css", value: "#u" }] } },
    {
      id: "s3",
      action: "assert",
      name: "Check",
      assertion: { kind: "element_text", expected: "" },
      locator: { candidates: [{ kind: "css", value: "#h" }] },
    },
  ];

  // The imperative push cannot work in create mode: OStepper is a wizard, so this
  // component is unmounted whenever the Journey step is not the active one — and
  // create mode's only Save button lives on the Configure step. `journeyRef` is
  // null there, so both calls were swallowed by `?.` and the toast fired alone.
  // Switching tabs first does not help either: the ref is still null in that tick,
  // and a freshly mounted child starts with an empty error map. So the issues must
  // arrive as a PROP the child applies on mount, not as a method call.
  it("should apply issues supplied as a prop at mount time", async () => {
    wrapper = mountJourney({
      modelValue: JOURNEY,
      fieldIssues: [{ path: ["journey", 1, "value"], message: "Text to type is required" }],
    });
    await wrapper.vm.$nextTick();

    expect(expandedIds()).toContain("s2");
  });

  it("should apply issues supplied as a prop after mount", async () => {
    wrapper = mountJourney({ modelValue: JOURNEY, fieldIssues: [] });

    await wrapper.setProps({
      fieldIssues: [
        { path: ["journey", 2, "assertion", "expected"], message: "Expected value is required" },
      ],
    });

    expect(expandedIds()).toContain("s3");
  });

  it("should clear applied issues when the prop empties on a successful save", async () => {
    const StubWithStatusColor = {
      props: ["data", "mode", "selectedIds", "expandedIds", "getRowStatusColor"],
      template: `<div class="journey-steps-stub">
        <div v-for="item in data" :key="item.id" class="step-row"
             :data-status-color="getRowStatusColor ? getRowStatusColor(item) : ''" />
      </div>`,
    };
    wrapper = mount(BrowserJourney, {
      props: {
        modelValue: JOURNEY,
        fieldIssues: [{ path: ["journey", 1, "value"], message: "Text to type is required" }],
      },
      global: { stubs: { ...STUBS, JourneySteps: StubWithStatusColor } },
    }) as VueWrapper;
    await wrapper.vm.$nextTick();
    // Guard: without this the assertion below passes on a component that never
    // recorded the error in the first place.
    expect(wrapper.findAll(".step-row")[1].attributes("data-status-color")).toBe(
      "var(--color-status-error-text)",
    );

    await wrapper.setProps({ fieldIssues: [] });

    expect(wrapper.findAll(".step-row")[1].attributes("data-status-color")).toBeFalsy();
  });

  it("should expand a step whose only error is a blank name", async () => {
    wrapper = mountJourney({
      modelValue: JOURNEY,
      fieldIssues: [{ path: ["journey", 1, "name"], message: "Step name is required" }],
    });
    await wrapper.vm.$nextTick();
    expect(expandedIds()).toContain("s2");
  });

  it("should expand a step whose only error is a missing value", async () => {
    wrapper = mountJourney({
      modelValue: JOURNEY,
      fieldIssues: [{ path: ["journey", 1, "value"], message: "Text to type is required" }],
    });
    await wrapper.vm.$nextTick();
    expect(expandedIds()).toContain("s2");
  });

  it("should expand a step whose only error is a missing assertion expectation", async () => {
    wrapper = mountJourney({
      modelValue: JOURNEY,
      fieldIssues: [
        { path: ["journey", 2, "assertion", "expected"], message: "Expected value is required" },
      ],
    });
    await wrapper.vm.$nextTick();
    expect(expandedIds()).toContain("s3");
  });

  // Steps are opened in journey order, so the reveal scroll lands on the first
  // error the author would reach rather than on whichever issue zod emitted first.
  it("should expand every errored step, in journey order", async () => {
    wrapper = mountJourney({
      modelValue: JOURNEY,
      fieldIssues: [
        { path: ["journey", 2, "assertion", "expected"], message: "Expected value is required" },
        { path: ["journey", 1, "name"], message: "Step name is required" },
      ],
    });
    await wrapper.vm.$nextTick();
    expect(expandedIds()).toEqual(["s2", "s3"]);
  });

  // A field error that outlives the edit fixing it keeps re-opening a row that
  // is already correct — the editor emits no per-field event for these three,
  // so the cleared field is derived from the replacement step.
  it("should clear a value error once the author edits that value", async () => {
    const StubWithBoth = {
      props: ["data", "mode", "selectedIds", "expandedIds", "getRowStatusColor"],
      template: `<div class="journey-steps-stub">
        <div v-for="item in data" :key="item.id" class="step-row"
             :data-status-color="getRowStatusColor ? getRowStatusColor(item) : ''">
          <slot name="expansion" :row="item" />
        </div>
      </div>`,
    };
    wrapper = mount(BrowserJourney, {
      props: {
        modelValue: JOURNEY,
        fieldIssues: [{ path: ["journey", 1, "value"], message: "Text to type is required" }],
      },
      global: { stubs: { ...STUBS, JourneySteps: StubWithBoth } },
    }) as VueWrapper;
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll(".step-row")[1].attributes("data-status-color")).toBe(
      "var(--color-status-error-text)",
    );

    // navigate (s1) and type (s2) both render a value input; s2's is the second.
    const valueInputs = wrapper.findAll('[data-test="synthetics-journey-step-value-input"]');
    await valueInputs[1].setValue("hello");

    expect(wrapper.findAll(".step-row")[1].attributes("data-status-color")).toBeFalsy();
  });

  it("should mark a step carrying only a schema error as errored in the row status color", () => {
    const StubWithStatusColor = {
      props: ["data", "mode", "selectedIds", "expandedIds", "getRowStatusColor"],
      template: `<div class="journey-steps-stub">
        <div v-for="item in data" :key="item.id" class="step-row"
             :data-status-color="getRowStatusColor ? getRowStatusColor(item) : ''" />
      </div>`,
    };
    wrapper = mount(BrowserJourney, {
      props: {
        modelValue: JOURNEY,
        fieldIssues: [{ path: ["journey", 1, "value"], message: "Text to type is required" }],
      },
      global: { stubs: { ...STUBS, JourneySteps: StubWithStatusColor } },
    }) as VueWrapper;

    return wrapper.vm.$nextTick().then(() => {
      const rows = wrapper.findAll(".step-row");
      expect(rows[1].attributes("data-status-color")).toBe("var(--color-status-error-text)");
    });
  });
});

// ── Step creation ─────────────────────────────────────────────────────────
// A created step must carry no timeout. Absence means "use the runner's
// per-category default" (spec P1.1.1-P1.1.3); a stamped value freezes at 30000
// while recorded steps follow the default, and fires the below-default warning
// as soon as the author picks navigate or assert (default 60000) without ever
// having touched the field.
describe("BrowserJourney step creation", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  function lastEmittedSteps(w: VueWrapper): any[] {
    const emitted = w.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    return emitted![emitted!.length - 1][0] as any[];
  }

  it("should create a step with no timeout via Add Step", async () => {
    wrapper = mountJourney({ modelValue: [] });
    await wrapper.find('[data-test="synthetics-journey-add-step-btn"]').trigger("click");

    const steps = lastEmittedSteps(wrapper);
    expect(steps).toHaveLength(1);
    expect(steps[0].timeout).toBeUndefined();
  });

  it("should create a step with no timeout via insert below", async () => {
    const existing = {
      id: "s1",
      action: "navigate",
      name: "Open app",
      value: "https://app.test",
    };
    wrapper = mountJourney({ modelValue: [existing] });

    // Drive the row action through the event contract JourneySteps emits,
    // rather than reaching into the component's internals.
    wrapper.findComponent(JourneyStepsStub).vm.$emit("insert-below", existing);
    await flushPromises();

    const steps = lastEmittedSteps(wrapper);
    expect(steps).toHaveLength(2);
    expect(steps[1].timeout).toBeUndefined();
  });
});

// A created step is a version-2 step: its identity is the locator bundle, never a
// bare `selector`. Seeding the bundle empty is what makes the editor render the
// Locator block from the start, and what keeps isV2Journey true once the author
// supplies a locator (SE-18).
describe("BrowserJourney step creation is version 2", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  it("should seed an empty locator bundle and write no v1 selector fields", async () => {
    wrapper = mountJourney({ modelValue: [] });
    await wrapper.find('[data-test="synthetics-journey-add-step-btn"]').trigger("click");

    const emitted = wrapper.emitted("update:modelValue")!;
    const steps = emitted[emitted.length - 1][0] as any[];
    expect(steps[0].locator).toEqual({ candidates: [] });
    expect(steps[0].selector).toBeUndefined();
    expect(steps[0].selectorType).toBeUndefined();
  });
});

// "Add Step" appended a blank row to the end of the list and gave no other
// signal. On a 20-step journey that row was below the fold and collapsed, and
// with a filter active it was not rendered at all — so the button read as doing
// nothing. The new step always needs the author (it has no locator yet), so it
// is revealed the same way this component already reveals a step with a
// validation error or a failed replay: expand it, scroll to it.
describe("BrowserJourney reveals a newly created step", () => {
  let wrapper: VueWrapper;
  let scrollSpy: ReturnType<typeof vi.fn>;
  let originalScrollIntoView: any;

  beforeEach(() => {
    // jsdom does not implement scrollIntoView — install a spy.
    scrollSpy = vi.fn();
    originalScrollIntoView = (Element.prototype as any).scrollIntoView;
    (Element.prototype as any).scrollIntoView = scrollSpy;
  });

  afterEach(() => {
    (Element.prototype as any).scrollIntoView = originalScrollIntoView;
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  /**
   * Mount with real v-model semantics: the parent writes the emitted value
   * straight back to the prop, synchronously.
   *
   * revealStep depends on that. It looks for the new step's DOM on the next
   * tick, so a harness that only applies the emit afterwards would never have
   * the row rendered in time — and the test would be measuring the harness.
   */
  function mountWithModel(initial: any[], withExpansion = false) {
    const w = mount(BrowserJourney, {
      props: {
        modelValue: initial,
        "onUpdate:modelValue": (steps: any[]) => w.setProps({ modelValue: steps }),
      },
      global: {
        stubs: withExpansion
          ? { ...STUBS, JourneySteps: JourneyStepsStubWithExpansion }
          : { ...STUBS },
      },
    }) as VueWrapper;
    return w;
  }

  /** The journey as the parent now holds it, after the component's emit. */
  function currentSteps(w: VueWrapper): any[] {
    return (w.props() as Record<string, unknown>).modelValue as any[];
  }

  function expandedIds(w: VueWrapper): string[] {
    return w.findComponent(JourneyStepsStub).props("expandedIds") as string[];
  }

  it("should expand the step Add Step just created", async () => {
    wrapper = mountWithModel([{ id: "s1", action: "navigate", name: "Open app" }]);
    await wrapper.find('[data-test="synthetics-journey-add-step-btn"]').trigger("click");
    await flushPromises();

    const steps = currentSteps(wrapper);
    expect(steps).toHaveLength(2);
    expect(expandedIds(wrapper)).toContain(steps[1].id);
  });

  it("should scroll the new step into view", async () => {
    // Needs the stub that renders the expansion slot: the scroll anchor lives
    // inside it, which is also why revealStep expands before it scrolls.
    wrapper = mountWithModel([{ id: "s1", action: "navigate", name: "Open app" }], true);
    await wrapper.find('[data-test="synthetics-journey-add-step-btn"]').trigger("click");
    await flushPromises();

    const steps = currentSteps(wrapper);
    expect(
      wrapper.find(`[data-test="synthetics-journey-step-anchor-${steps[1].id}"]`).exists(),
    ).toBe(true);
    expect(scrollSpy).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
  });

  it("should expand a step created by insert-below, not only appended ones", async () => {
    const existing = { id: "s1", action: "navigate", name: "Open app" };
    wrapper = mountWithModel([existing]);
    wrapper.findComponent(JourneyStepsStub).vm.$emit("insert-below", existing);
    await flushPromises();

    const steps = currentSteps(wrapper);
    expect(steps).toHaveLength(2);
    expect(expandedIds(wrapper)).toContain(steps[1].id);
  });

  /**
   * A blank step matches no filter query, so appending one while a filter is
   * active put it somewhere the author could not see — the case where the
   * button most looked broken.
   */
  it("should clear an active filter so the new step is visible", async () => {
    wrapper = mountWithModel([{ id: "s1", action: "click", name: "Login button" }]);
    const filter = wrapper.find('[data-test="synthetics-journey-filter-input"]');
    await filter.setValue("login");
    expect((filter.element as HTMLInputElement).value).toBe("login");

    await wrapper.find('[data-test="synthetics-journey-add-step-btn"]').trigger("click");
    await flushPromises();

    expect(
      (wrapper.find('[data-test="synthetics-journey-filter-input"]').element as HTMLInputElement)
        .value,
    ).toBe("");
  });

  it("should keep steps already expanded expanded", async () => {
    const existing = { id: "s1", action: "navigate", name: "Open app" };
    wrapper = mountWithModel([existing]);
    wrapper.findComponent(JourneyStepsStub).vm.$emit("update:expanded-ids", ["s1"]);
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-add-step-btn"]').trigger("click");
    await flushPromises();

    const steps = currentSteps(wrapper);
    expect(expandedIds(wrapper)).toContain("s1");
    expect(expandedIds(wrapper)).toContain(steps[1].id);
  });
});

// Phase 5 / SE-4. The evidence existed and was discarded: JourneySteps declares a
// getReplayResult prop "for error cards" and never rendered one, and BrowserJourney
// never passed it. A failed replay showed a red dot and a one-line banner only.
describe("BrowserJourney per-step failure evidence", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  const journey = [
    { id: "s1", action: "navigate", name: "Open app", value: "https://app.test" },
    {
      id: "s2",
      action: "click",
      name: "Sign in",
      locator: { candidates: [{ kind: "css", value: "#go" }] },
    },
  ];

  function mountFailed() {
    const stepResults = new Map([
      [
        "s2",
        {
          stepId: "s2",
          stepName: "Sign in",
          passed: false,
          durationMs: 30000,
          error: "Timeout 30000ms exceeded.",
          fidelity: { level: "reduced", notes: ["primary locator only"] },
        },
      ],
    ]);
    return mount(BrowserJourney, {
      props: { modelValue: journey, replayPhase: "failed", stepResults },
      global: { stubs: { ...STUBS, JourneySteps: JourneyStepsStubWithExpansion } },
    }) as VueWrapper;
  }

  it("should render the error card against the step that failed", () => {
    wrapper = mountFailed();
    const cards = wrapper.findAll('[data-test="synthetics-journey-step-error-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].text()).toContain("Timeout 30000ms exceeded");
  });

  it("should surface the player's fidelity notes (X-8.2)", () => {
    wrapper = mountFailed();
    expect(wrapper.find('[data-test="synthetics-journey-step-fidelity"]').text()).toContain(
      "primary locator only",
    );
  });

  it("should not render a card for a step that passed", () => {
    const stepResults = new Map([
      ["s1", { stepId: "s1", stepName: "Open app", passed: true, durationMs: 900 }],
    ]);
    wrapper = mount(BrowserJourney, {
      props: { modelValue: journey, replayPhase: "passed", stepResults },
      global: { stubs: { ...STUBS, JourneySteps: JourneyStepsStubWithExpansion } },
    }) as VueWrapper;
    expect(wrapper.find('[data-test="synthetics-journey-step-error-card"]').exists()).toBe(false);
  });

  it("should not render a card when no replay has run", () => {
    wrapper = mount(BrowserJourney, {
      props: { modelValue: journey },
      global: { stubs: { ...STUBS, JourneyStepsStubWithExpansion } },
    }) as VueWrapper;
    expect(wrapper.find('[data-test="synthetics-journey-step-error-card"]').exists()).toBe(false);
  });

  // The old button emitted a full journey replay from inside a per-step card. A
  // single step is not independently runnable, so the honest unit is the prefix.
  it("should emit replay-up-to with the failed step's position", async () => {
    wrapper = mountFailed();
    await wrapper.find('[data-test="synthetics-journey-error-retry-btn"]').trigger("click");
    // OButtonStub both $emits "click" and lets the native event through (it declares
    // no `emits`), so one press registers twice. The payload is the contract here.
    const emitted = wrapper.emitted("replay-up-to")!;
    expect(emitted.length).toBeGreaterThan(0);
    for (const call of emitted) expect(call).toEqual([2]);
  });
});

// Real JourneySteps (and its real OTable) rather than a fake stub: the dot and
// progress hooks these tests assert on are rendered by JourneySteps itself, and a
// hand-written stub could echo back whatever id/index convention the test expects
// without ever exercising the real one. BrowserJourneyStepEditor IS stubbed —
// mounting it for real for a `subtest` row pulls in SubtestPicker, which fetches
// the check list on mount against the real (unmocked) syntheticsService.
const BrowserJourneyStepEditorStub = { template: '<div class="step-editor-stub" />' };
const { JourneySteps: _droppedJourneyStepsStub, ...STUBS_WITH_REAL_JOURNEY_STEPS } = STUBS;

function mountWithRealSteps(props: Record<string, unknown> = {}) {
  return mount(BrowserJourney, {
    props: { modelValue: [], ...props },
    global: {
      stubs: {
        ...STUBS_WITH_REAL_JOURNEY_STEPS,
        BrowserJourneyStepEditor: BrowserJourneyStepEditorStub,
      },
    },
  }) as VueWrapper;
}

/** Every real JourneySteps in the tree — the parent list first, a reference row's preview second. */
function journeyLists(w: VueWrapper) {
  return w.findAllComponents({ name: "JourneySteps" }) as VueWrapper<any>[];
}

describe("BrowserJourney with a subtest reference", () => {
  let w: VueWrapper;

  beforeEach(() => {
    mockT.mockClear();
  });

  afterEach(() => {
    w?.unmount();
  });

  const journey: BrowserStep[] = [
    { id: "s1", action: "navigate", name: "Open", value: "https://example.com" },
    {
      id: "s2",
      action: "subtest",
      name: "Log in (shared)",
      subtest: { id: "login-test", name: "Login" },
    },
    {
      id: "s3",
      action: "click",
      name: "Logs",
      locator: { candidates: [{ kind: "css", value: "#logs" }] },
    },
  ];
  const map: ExpansionMap = new Map([
    ["s2_c1", { authoredStepId: "s2", childIndex: 0, childStepName: "Open login", childCount: 3 }],
    ["s2_c2", { authoredStepId: "s2", childIndex: 1, childStepName: "fill email", childCount: 3 }],
    ["s2_c3", { authoredStepId: "s2", childIndex: 2, childStepName: "submit", childCount: 3 }],
  ]);

  it("pins the error card to the reference row, names the child step that failed, and re-runs to the authored position", async () => {
    const stepResults = new Map([
      ["s1", { stepId: "s1", stepName: "Open", passed: true, durationMs: 400 }],
      ["s2_c1", { stepId: "s2_c1", stepName: "Open login", passed: true, durationMs: 380 }],
      [
        "s2_c2",
        {
          stepId: "s2_c2",
          stepName: "fill email",
          passed: false,
          durationMs: 3200,
          error: "timeout",
        },
      ],
    ]);
    w = mountWithRealSteps({
      modelValue: journey,
      replayPhase: "failed",
      stepResults,
      expansionMap: map,
    });
    await nextTick();
    // The §5.6 failure string is shared with the banner, so the two never disagree about the child.
    const cards = w.findAll('[data-test="synthetics-journey-step-error-card"]');
    expect(cards).toHaveLength(1);
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.failedAt", {
      number: "2.2",
      child: "Login",
      step: "fill email",
    });
    expect(cards[0].find('[data-test="synthetics-journey-step-error-name"]').text()).toBe(
      "synthetics.journey.subtest.failedAt",
    );
    const banner = w.find('[data-test="synthetics-journey-failed-banner"]');
    expect(banner.text()).toContain("synthetics.journey.subtest.failedAt");
    expect(banner.text()).not.toContain("2. fill email");
    // The dot hook is index-based and 0-based, so the reference row — authored
    // position 2 — is index 1.
    expect(w.find('[data-test="synthetics-journey-step-dot-1"]').exists()).toBe(true);
    // The retry button on that card re-runs to the REFERENCE row's authored
    // position (2), never to a composed child index the author never wrote.
    await w.find('[data-test="synthetics-journey-error-retry-btn"]').trigger("click");
    const emitted = w.emitted("replay-up-to")!;
    expect(emitted.length).toBeGreaterThan(0);
    for (const call of emitted) expect(call).toEqual([2]);
  });

  it("reports child progress on the collapsed reference row while it runs", async () => {
    const stepResults = new Map([
      ["s2_c1", { stepId: "s2_c1", stepName: "Open login", passed: true, durationMs: 380 }],
    ]);
    w = mountWithRealSteps({
      modelValue: journey,
      replayPhase: "running",
      stepResults,
      activeStepId: "s2_c2",
      expansionMap: map,
    });
    await nextTick();
    // On the row itself, not in the expansion: nothing auto-expands during `running`.
    const progress = w.find('[data-test="synthetics-journey-subtest-progress-1"]');
    expect(progress.exists()).toBe(true);
    expect(progress.text()).toContain("1/3");
    // The active child ("s2_c2") is a composed id — the reference row's OWN dot
    // must read "active", which only happens if it is translated back to "s2"
    // before being compared against the row's id.
    const dot = w.find('[data-test="synthetics-journey-step-dot-1"]');
    expect(dot.exists()).toBe(true);
    expect(dot.classes().join(" ")).toContain("badge-primary-soft-bg");
  });

  // ── Phase C — replay inside a child ─────────────────────────────────────
  // Named differently from `subtest.name` so the cache is proven to win the child-name lookup.
  const loginChild: ChildJourney = {
    id: "login-test",
    name: "Login (shared)",
    folderId: "shared",
    steps: [
      { id: "c1", action: "navigate", name: "Open login", value: "https://example.com/login" },
      {
        id: "c2",
        action: "type",
        name: "fill email",
        value: "{{USER}}",
        locator: { candidates: [{ kind: "css", value: "#email" }] },
      },
      {
        id: "c3",
        action: "click",
        name: "submit",
        locator: { candidates: [{ kind: "css", value: "#go" }] },
      },
    ],
  };
  const cacheWithLogin = () => new Map<string, ChildJourney>([["login-test", loginChild]]);
  const pass = (stepId: string, stepName: string) =>
    [stepId, { stepId, stepName, passed: true, durationMs: 100 }] as const;
  const failedInChild = () =>
    new Map<string, any>([
      pass("s1", "Open"),
      pass("s2_c1", "Open login"),
      [
        "s2_c2",
        {
          stepId: "s2_c2",
          stepName: "fill email",
          passed: false,
          durationMs: 3200,
          error: "timeout",
        },
      ],
    ]);
  const previewDot = (w: VueWrapper, n: string) =>
    w.find(`[data-test="synthetics-journey-preview-step-${n}"]`);

  it("offers Open on the card only for a folded child result and emits open-child with the child", async () => {
    w = mountWithRealSteps({
      modelValue: journey,
      replayPhase: "failed",
      stepResults: failedInChild(),
      expansionMap: map,
      childrenCache: cacheWithLogin(),
    });
    await nextTick();
    const open = w.find('[data-test="synthetics-journey-error-open-child-btn"]');
    expect(open.exists()).toBe(true);
    // Read off the card itself: the preview's Open button in the same row calls `t` the same way.
    expect(open.text()).toContain("synthetics.journey.subtest.openChild");
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.openChild", {
      name: "Login (shared)",
    });
    // The cached name outranks the reference's display cache in the failure string too.
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.failedAt", {
      number: "2.2",
      child: "Login (shared)",
      step: "fill email",
    });
    await open.trigger("click");
    const emitted = w.emitted("open-child")!;
    expect(emitted.length).toBeGreaterThan(0);
    for (const call of emitted) {
      expect(call[0]).toMatchObject({ id: "login-test", name: "Login (shared)" });
    }
    w.unmount();

    // The same card on an ordinary step names no child, so there is nothing to open.
    w = mountWithRealSteps({
      modelValue: journey,
      replayPhase: "failed",
      stepResults: new Map([
        ["s1", { stepId: "s1", stepName: "Open", passed: false, durationMs: 100, error: "boom" }],
      ]),
      childrenCache: cacheWithLogin(),
    });
    await nextTick();
    expect(w.find('[data-test="synthetics-journey-step-error-card"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-journey-error-open-child-btn"]').exists()).toBe(false);
  });

  it("lights preview rows: pass before the failure, fail on it, skip with Not run after it", async () => {
    w = mountWithRealSteps({
      modelValue: journey,
      replayPhase: "failed",
      stepResults: failedInChild(),
      expansionMap: map,
      childrenCache: cacheWithLogin(),
    });
    await nextTick();
    await flushPromises();
    // `failed` is not locked, so the collapsed-row counter has already yielded.
    expect(w.find('[data-test="synthetics-journey-subtest-progress-1"]').exists()).toBe(false);
    // The failed watcher opened the reference row, so its preview is on screen.
    expect(previewDot(w, "2.1").exists()).toBe(true);
    expect(previewDot(w, "2.1").attributes("data-dot-state")).toBe("pass");
    expect(previewDot(w, "2.2").attributes("data-dot-state")).toBe("fail");
    expect(previewDot(w, "2.3").attributes("data-dot-state")).toBe("skip");
    const skippedRow = previewDot(w, "2.3").element.closest("tr")!;
    expect(skippedRow.textContent).toContain("synthetics.journey.subtest.notRun");
    expect(previewDot(w, "2.1").element.closest("tr")!.textContent).not.toContain(
      "synthetics.journey.subtest.notRun",
    );
  });

  it("shows the active child as active and later children as pending while running", async () => {
    w = mountWithRealSteps({
      modelValue: journey,
      replayPhase: "running",
      stepResults: new Map([pass("s1", "Open"), pass("s2_c1", "Open login")]),
      activeStepId: "s2_c2",
      expansionMap: map,
      childrenCache: cacheWithLogin(),
    });
    await nextTick();
    // Nothing auto-expands while running, so the author opens the row.
    await w.find('[data-test="o2-table-expand-1"]').trigger("click");
    await flushPromises();
    expect(previewDot(w, "2.1").exists()).toBe(true);
    expect(previewDot(w, "2.1").attributes("data-dot-state")).toBe("pass");
    expect(previewDot(w, "2.2").attributes("data-dot-state")).toBe("active");
    expect(previewDot(w, "2.3").attributes("data-dot-state")).toBe("pending");

    // Stopping is still live: nothing has been skipped yet, so no child reads "Not run".
    await w.setProps({ replayPhase: "stopping", activeStepId: null });
    await flushPromises();
    expect(previewDot(w, "2.1").attributes("data-dot-state")).toBe("pass");
    expect(previewDot(w, "2.2").attributes("data-dot-state")).toBe("pending");
    expect(previewDot(w, "2.3").attributes("data-dot-state")).toBe("pending");
    expect(w.find('[data-test="synthetics-journey-subtest-preview"]').text()).not.toContain(
      "synthetics.journey.subtest.notRun",
    );
  });

  it("hides the child progress counter after the run and shows the steps badge instead", async () => {
    w = mountWithRealSteps({
      modelValue: journey,
      replayPhase: "passed",
      stepResults: new Map([
        pass("s1", "Open"),
        pass("s2_c1", "Open login"),
        pass("s2_c2", "fill email"),
        pass("s2_c3", "submit"),
        pass("s3", "Logs"),
      ]),
      expansionMap: map,
      childrenCache: cacheWithLogin(),
    });
    await nextTick();
    expect(w.find('[data-test="synthetics-journey-subtest-progress-1"]').exists()).toBe(false);
    const badge = w.find('[data-test="synthetics-journey-step-badge-1"]');
    expect(badge.exists()).toBe(true);
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.stepsBadge", { count: 3 });
  });

  // C6: executed total = authored non-reference rows + expansionMap.size (2 + 3), never 3.
  it("counts executed steps in the running banner", async () => {
    w = mountWithRealSteps({
      modelValue: journey,
      replayPhase: "running",
      stepResults: new Map([pass("s1", "Open"), pass("s2_c1", "Open login")]),
      activeStepId: "s2_c2",
      expansionMap: map,
    });
    await nextTick();
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.replayProgress", {
      current: 2,
      total: 5,
    });
    w.unmount();

    // Two references: 3 own + 3 + 3 = 9, which `length + size - 1` (10) gets wrong.
    const twoRefs: BrowserStep[] = [
      journey[0],
      journey[1],
      { id: "s4", action: "subtest", name: "Log in again", subtest: { id: "login-test" } },
      journey[2],
      { id: "s5", action: "assert", name: "Landed", value: "1" },
    ];
    const twoRefsMap: ExpansionMap = new Map([
      ...map,
      ...(["c1", "c2", "c3"] as const).map(
        (c, i) =>
          [
            `s4_${c}`,
            { authoredStepId: "s4", childIndex: i, childStepName: c, childCount: 3 },
          ] as const,
      ),
    ]);
    mockT.mockClear();
    w = mountWithRealSteps({
      modelValue: twoRefs,
      replayPhase: "running",
      stepResults: new Map([pass("s1", "Open")]),
      activeStepId: "s2_c1",
      expansionMap: twoRefsMap,
    });
    await nextTick();
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.replayProgress", {
      current: 1,
      total: 9,
    });
  });

  it("counts executed steps in the passed banner", async () => {
    w = mountWithRealSteps({
      modelValue: journey,
      replayPhase: "passed",
      stepResults: new Map([
        pass("s1", "Open"),
        pass("s2_c1", "Open login"),
        pass("s2_c2", "fill email"),
        pass("s2_c3", "submit"),
        pass("s3", "Logs"),
      ]),
      expansionMap: map,
    });
    await nextTick();
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.replayPassed", { count: 5 });
  });

  it("keeps authored totals in the failed banner", async () => {
    w = mountWithRealSteps({
      modelValue: journey,
      replayPhase: "failed",
      stepResults: failedInChild(),
      expansionMap: map,
    });
    await nextTick();
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.replayFailed", { failed: 2, total: 3 });
  });
});

// ── Reference row preview (Phase A) ─────────────────────────────────────────
// Ruled order is fields → environment note → preview.
describe("BrowserJourney reference row preview", () => {
  let w: VueWrapper;

  const journey: BrowserStep[] = [
    { id: "s1", action: "navigate", name: "Open", value: "https://example.com" },
    {
      id: "s2",
      action: "subtest",
      name: "Log in (shared)",
      subtest: { id: "login-test", name: "Login" },
    },
    {
      id: "s3",
      action: "click",
      name: "Logs",
      locator: { candidates: [{ kind: "css", value: "#logs" }] },
    },
  ];
  const loginChild: ChildJourney = {
    id: "login-test",
    name: "Login",
    folderId: "shared",
    steps: [
      { id: "c1", action: "navigate", name: "Open login", value: "https://example.com/login" },
      {
        id: "c2",
        action: "type",
        name: "fill email",
        value: "{{USER}}",
        locator: { candidates: [{ kind: "css", value: "#email" }] },
      },
      {
        id: "c3",
        action: "click",
        name: "submit",
        locator: { candidates: [{ kind: "css", value: "#go" }] },
      },
      { id: "c4", action: "click", name: "legacy click", selector: "#v1" },
    ],
  };
  const cacheWithLogin = () => new Map<string, ChildJourney>([["login-test", loginChild]]);

  /** `a` comes before `b` in document order. */
  const precedes = (a: Node, b: Node) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  async function expandReferenceRow(wrapper: VueWrapper) {
    await wrapper.find('[data-test="o2-table-expand-1"]').trigger("click");
    await flushPromises();
  }

  beforeEach(() => {
    mockT.mockClear();
    mockSyntheticsGet.mockReset();
  });

  afterEach(() => {
    w?.unmount();
  });

  it("renders the step editor before the environment note and the preview", async () => {
    w = mountWithRealSteps({ modelValue: journey, childrenCache: cacheWithLogin() });
    await expandReferenceRow(w);

    const editor = w.find(".step-editor-stub");
    const env = w.find('[data-test="synthetics-journey-subtest-ignored-env"]');
    const previewBlock = w.find('[data-test="synthetics-journey-subtest-preview"]');
    const previewList = journeyLists(w)[1];
    expect(editor.exists()).toBe(true);
    expect(env.exists()).toBe(true);
    expect(previewBlock.exists()).toBe(true);
    expect(previewList, "no nested preview list rendered").toBeDefined();

    expect(precedes(editor.element, previewBlock.element), "preview block before the editor").toBe(
      true,
    );
    expect(precedes(editor.element, env.element), "environment note before the editor").toBe(true);
    expect(
      precedes(env.element, previewList.element),
      "preview list before the environment note",
    ).toBe(true);
  });

  it("passes the child's steps to a preview-mode JourneySteps with the reference row's number as prefix", async () => {
    w = mountWithRealSteps({ modelValue: journey, childrenCache: cacheWithLogin() });
    await expandReferenceRow(w);

    const lists = journeyLists(w);
    expect(lists).toHaveLength(2);
    const preview = lists[1];
    expect(preview.props("mode")).toBe("preview");
    expect(preview.props("numberPrefix")).toBe("2");
    const rows = preview.props("data") as Array<{ id: string; detail: string }>;
    expect(rows).toHaveLength(4);
    // URL for navigate, typed text for type, then the v1 selector, then the locator — never blank.
    expect(rows.map((r) => r.detail)).toEqual([
      "https://example.com/login",
      "{{USER}}",
      "#go",
      "#v1",
    ]);
    // At rest no replay is active, so no row is lit and none reads "Not run".
    const first = w.find('[data-test="synthetics-journey-preview-step-2.1"]');
    expect(first.exists()).toBe(true);
    expect(first.attributes("data-dot-state")).toBeUndefined();
    expect(w.find('[data-test="synthetics-journey-subtest-preview"]').text()).not.toContain(
      "synthetics.journey.subtest.notRun",
    );
    w.unmount();

    // The prefix is the reference row's own number, wherever it sits.
    w = mountWithRealSteps({
      modelValue: [journey[0], journey[2], journey[1]],
      childrenCache: cacheWithLogin(),
    });
    await w.find('[data-test="o2-table-expand-2"]').trigger("click");
    await flushPromises();
    expect(journeyLists(w)[1].props("numberPrefix")).toBe("3");
    expect(w.find('[data-test="synthetics-journey-preview-step-3.1"]').exists()).toBe(true);
  });

  it("shows the previewLabel, the bare child count and an Open button naming the child", async () => {
    w = mountWithRealSteps({ modelValue: journey, childrenCache: cacheWithLogin() });
    await expandReferenceRow(w);

    const block = w.find('[data-test="synthetics-journey-subtest-preview"]');
    expect(block.text()).toContain("synthetics.journey.subtest.previewLabel");
    expect(block.find('[data-test="synthetics-journey-subtest-count"]').text()).toBe("4");
    const open = block.find('[data-test="synthetics-journey-subtest-open-child"]');
    expect(open.exists()).toBe(true);
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.openChild", { name: "Login" });
  });

  it("emits open-child with the cached child (id, folderId) when Open is clicked", async () => {
    w = mountWithRealSteps({ modelValue: journey, childrenCache: cacheWithLogin() });
    await expandReferenceRow(w);

    const open = w.find('[data-test="synthetics-journey-subtest-open-child"]');
    expect(open.exists()).toBe(true);
    await open.trigger("click");
    const emitted = w.emitted("open-child")!;
    expect(emitted?.length).toBeGreaterThan(0);
    for (const call of emitted) {
      expect(call[0]).toMatchObject({ id: "login-test", folderId: "shared" });
    }
  });

  it("shows the N steps badge on the collapsed reference row and none on ordinary rows", async () => {
    w = mountWithRealSteps({ modelValue: journey, childrenCache: cacheWithLogin() });
    await flushPromises();

    const badge = w.find('[data-test="synthetics-journey-step-badge-1"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("synthetics.journey.subtest.stepsBadge");
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.stepsBadge", { count: 4 });
    expect(w.find('[data-test="synthetics-journey-step-badge-0"]').exists()).toBe(false);
    expect(w.find('[data-test="synthetics-journey-step-badge-2"]').exists()).toBe(false);
    // Nothing is expanded, so the badge is what says how heavy the reference is.
    expect(w.find('[data-test="synthetics-journey-subtest-preview"]').exists()).toBe(false);
    w.unmount();

    // Neither loaded nor refused: there is no count to show yet.
    w = mountWithRealSteps({ modelValue: journey, childrenCache: new Map() });
    await flushPromises();
    expect(w.find('[data-test="synthetics-journey-step-badge-1"]').exists()).toBe(false);
  });

  it("marks a refused child with the no access badge without expanding the row", async () => {
    w = mountWithRealSteps({
      modelValue: journey,
      childrenCache: new Map(),
      refusedChildIds: new Set(["login-test"]),
    });
    await flushPromises();

    const badge = w.find('[data-test="synthetics-journey-step-badge-1"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("synthetics.journey.subtest.noAccessBadge");
    // The stub forwards unknown props as attributes, so the variant is readable here.
    expect(badge.attributes("variant")).toBe("error");
    expect(w.find('[data-test="synthetics-journey-subtest-preview"]').exists()).toBe(false);
    expect(mockSyntheticsGet).not.toHaveBeenCalled();
  });

  it("does not fetch a child the host already reported as refused when the row expands", async () => {
    w = mountWithRealSteps({
      modelValue: journey,
      childrenCache: new Map(),
      refusedChildIds: new Set(["login-test"]),
    });
    await flushPromises();

    // The declared `expand` emit is the only path into ensureChildLoaded; the UI never fires it.
    journeyLists(w)[0].vm.$emit("expand", journey[1]);
    await flushPromises();

    expect(w.find('[data-test="synthetics-journey-subtest-refused"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-journey-subtest-loading"]').exists()).toBe(false);
    expect(mockSyntheticsGet).not.toHaveBeenCalled();
  });

  it("shows the remedy line under the refused alert and keeps the fields visible", async () => {
    w = mountWithRealSteps({
      modelValue: journey,
      childrenCache: new Map(),
      refusedChildIds: new Set(["login-test"]),
    });
    await expandReferenceRow(w);

    const refused = w.find('[data-test="synthetics-journey-subtest-refused"]');
    expect(refused.exists()).toBe(true);
    expect(refused.text()).toContain("synthetics.journey.subtest.noAccess");
    const remedy = refused.find('[data-test="synthetics-journey-subtest-refused-remedy"]');
    expect(remedy.exists()).toBe(true);
    expect(remedy.text()).toBe("synthetics.journey.subtest.noAccessRemedy");
    // The author can still replace or remove the reference.
    expect(w.find(".step-editor-stub").exists()).toBe(true);
    expect(w.find('[data-test="synthetics-journey-subtest-loading"]').exists()).toBe(false);
  });

  it("stores the child's folder_id from the GET response in the shared cache", async () => {
    mockSyntheticsGet.mockResolvedValue({
      data: {
        name: "Login",
        folder_id: "shared",
        config: { steps: [{ id: "w1", action: "navigate", url: "https://example.com/login" }] },
      },
    });
    const cache = new Map<string, ChildJourney>();
    w = mountWithRealSteps({ modelValue: journey, childrenCache: cache });
    await flushPromises();

    // The declared `expand` emit is the only path into ensureChildLoaded; the UI never fires it.
    journeyLists(w)[0].vm.$emit("expand", journey[1]);
    await flushPromises();

    expect(mockSyntheticsGet).toHaveBeenCalledTimes(1);
    expect(cache.get("login-test")).toMatchObject({
      id: "login-test",
      name: "Login",
      folderId: "shared",
    });
  });
});

// ── Undefined placeholders (Phase B) ────────────────────────────────────────
// A child reading a name the parent lacks fails at resolve time; naming it here moves that to the pick.
describe("BrowserJourney undefined placeholders", () => {
  let w: VueWrapper;

  const journey: BrowserStep[] = [
    { id: "s1", action: "navigate", name: "Open", value: "https://example.com" },
    {
      id: "s2",
      action: "subtest",
      name: "Log in (shared)",
      subtest: { id: "login-test", name: "Login" },
    },
  ];
  const loginChild: ChildJourney = {
    id: "login-test",
    name: "Login",
    folderId: "shared",
    steps: [
      { id: "c1", action: "navigate", name: "Open login", value: "https://example.com/login" },
      { id: "c2", action: "type", name: "fill email", value: "{{USER}}" },
      { id: "c3", action: "type", name: "fill password", value: "{{ PASSWORD }}" },
      { id: "c4", action: "assert", name: "landed", value: "{{TOKEN}}" },
    ],
  };

  function mountExpanded(variableNames: string[]) {
    return mountWithRealSteps({
      modelValue: journey,
      childrenCache: new Map([["login-test", loginChild]]),
      variableNames,
      variablesPanelOpen: false,
    });
  }

  beforeEach(() => {
    mockT.mockClear();
  });

  afterEach(() => {
    w?.unmount();
  });

  it("names the child's undefined placeholders under the fields and offers the Variables toggle", async () => {
    w = mountExpanded([]);
    await w.find('[data-test="o2-table-expand-1"]').trigger("click");
    await flushPromises();

    const line = w.find('[data-test="synthetics-journey-subtest-undefined-variable"]');
    expect(line.exists()).toBe(true);
    // One line for all missing names, sorted; the assert step's `{{TOKEN}}` is not scanned.
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.undefinedVariable", {
      name: "Login",
      variable: "PASSWORD, USER",
    });
    // Under the fields and above the environment note — the third impact line.
    const editor = w.find(".step-editor-stub");
    const env = w.find('[data-test="synthetics-journey-subtest-ignored-env"]');
    expect(
      editor.element.compareDocumentPosition(line.element) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the placeholder line is not under the fields",
    ).toBeTruthy();
    expect(
      line.element.compareDocumentPosition(env.element) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the placeholder line is not above the environment note",
    ).toBeTruthy();

    const action = line.find('[data-test="synthetics-journey-subtest-add-variable"]');
    expect(action.exists()).toBe(true);
    expect(action.text()).toBe("synthetics.journey.subtest.undefinedVariableAction");
    await action.trigger("click");
    expect(w.emitted("toggle-variables-panel")?.length).toBeGreaterThan(0);
  });

  it("renders no placeholder line when the parent defines every name", async () => {
    w = mountExpanded(["USER", "PASSWORD"]);
    await w.find('[data-test="o2-table-expand-1"]').trigger("click");
    await flushPromises();

    expect(w.find('[data-test="synthetics-journey-subtest-preview"]').exists()).toBe(true);
    expect(w.find('[data-test="synthetics-journey-subtest-undefined-variable"]').exists()).toBe(
      false,
    );
    expect(mockT).not.toHaveBeenCalledWith(
      "synthetics.journey.subtest.undefinedVariable",
      expect.anything(),
    );
  });
});

// ── Step cap (Phase D) ──────────────────────────────────────────────────────
// Refused before any request and decomposed per §5.4 — an undecomposed count is unactionable.
describe("BrowserJourney step cap", () => {
  let w: VueWrapper;

  const CAP_NOTICE = '[data-test="synthetics-journey-cap-notice"]';
  const EXECUTED_BADGE = '[data-test="synthetics-journey-executed-badge"]';

  const journey: BrowserStep[] = [
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
  const plainJourney: BrowserStep[] = [journey[0], journey[3], journey[4]];
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
  // Inserted b before a so Map iteration order is not the journey order the notice must follow.
  const cache = () =>
    new Map<string, ChildJourney>([
      ["b", childOf("b", "Add items to cart", 17)],
      ["a", childOf("a", "Login (shared)", 31)],
    ]);

  const capCalls = (key: string) =>
    mockT.mock.calls.filter(([k]) => k === `synthetics.journey.subtest.${key}`);

  beforeEach(() => {
    mockT.mockClear();
  });

  afterEach(() => {
    w?.unmount();
  });

  it("renders no notice at or under the limit, and none when the count is unknown", async () => {
    w = mountWithRealSteps({ modelValue: journey, childrenCache: cache(), ownStepCount: 50 });
    await flushPromises();
    expect(w.find(CAP_NOTICE).exists()).toBe(false);
    expect(capCalls("capTitle")).toHaveLength(0);
    w.unmount();

    // A child that cannot be loaded leaves the count unknown; the server backstop applies.
    w = mountWithRealSteps({
      modelValue: journey,
      childrenCache: cache(),
      ownStepCount: undefined,
    });
    await flushPromises();
    expect(w.find(CAP_NOTICE).exists()).toBe(false);
  });

  it("renders the decomposed notice over the limit — own count, one entry per reference in journey order, remedy", async () => {
    w = mountWithRealSteps({ modelValue: journey, childrenCache: cache(), ownStepCount: 51 });
    await flushPromises();

    const notice = w.find(CAP_NOTICE);
    expect(notice.exists()).toBe(true);
    expect(notice.attributes("role")).toBe("alert");
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.capTitle", {
      total: 51,
      limit: 50,
    });
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.capOwn", { count: 3 });
    // Deduped: a re-render calls `t()` again, and only the set and order of entries matter.
    const childParams = [...new Set(capCalls("capChild").map(([, p]) => JSON.stringify(p)))].map(
      (p) => JSON.parse(p),
    );
    expect(childParams).toEqual([
      { count: 31, name: "Login (shared)" },
      { count: 17, name: "Add items to cart" },
    ]);
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.capRemedy");
    expect(
      notice
        .find('[data-test="synthetics-journey-cap-breakdown"]')
        .text()
        .replace(/\s+/g, " ")
        .trim(),
    ).toBe(
      "synthetics.journey.subtest.capOwn · synthetics.journey.subtest.capChild · synthetics.journey.subtest.capChild.",
    );
    expect(notice.text()).toContain("synthetics.journey.subtest.capRemedy");
    expect(notice.find("button").exists()).toBe(false);
  });

  it("does not tint any row while over the cap", async () => {
    w = mountWithRealSteps({ modelValue: journey, childrenCache: cache(), ownStepCount: 51 });
    await flushPromises();

    expect(w.find(CAP_NOTICE).exists()).toBe(true);
    expect(w.findAll('[data-status-bar="true"]')).toHaveLength(0);
  });

  it("shows the executed badge only when the journey holds a reference, in the error variant past the limit", async () => {
    w = mountWithRealSteps({ modelValue: plainJourney, childrenCache: cache(), ownStepCount: 3 });
    await flushPromises();
    expect(w.find(EXECUTED_BADGE).exists()).toBe(false);
    w.unmount();

    // A reference with an unknown count has no number to show.
    w = mountWithRealSteps({
      modelValue: journey,
      childrenCache: cache(),
      ownStepCount: undefined,
    });
    await flushPromises();
    expect(w.find(EXECUTED_BADGE).exists()).toBe(false);
    w.unmount();

    w = mountWithRealSteps({ modelValue: journey, childrenCache: cache(), ownStepCount: 48 });
    await flushPromises();
    let badge = w.find(EXECUTED_BADGE);
    expect(badge.exists()).toBe(true);
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.executedBadge", { count: 48 });
    expect(badge.attributes("variant")).toBe("default");
    w.unmount();

    w = mountWithRealSteps({ modelValue: journey, childrenCache: cache(), ownStepCount: 51 });
    await flushPromises();
    badge = w.find(EXECUTED_BADGE);
    expect(badge.exists()).toBe(true);
    expect(mockT).toHaveBeenCalledWith("synthetics.journey.subtest.executedBadge", { count: 51 });
    expect(badge.attributes("variant")).toBe("error");
  });

  it("exposes revealCapNotice which scrolls the notice into view", async () => {
    w = mountWithRealSteps({ modelValue: journey, childrenCache: cache(), ownStepCount: 51 });
    await flushPromises();

    const notice = w.find(CAP_NOTICE);
    expect(notice.exists()).toBe(true);
    const scrollIntoView = vi.fn();
    (notice.element as HTMLElement).scrollIntoView = scrollIntoView;

    (w.vm as any).revealCapNotice();
    await nextTick();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
  });
});

// ── Stopping a replay ───────────────────────────────────────────────────────
describe("BrowserJourney — stopping a replay", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  const journey = [
    { id: "s1", action: "navigate", name: "Open app", value: "https://app.test" },
    {
      id: "s2",
      action: "click",
      name: "Sign in",
      locator: { candidates: [{ kind: "css", value: "#go" }] },
    },
  ];

  function mountWithDots(props: Record<string, unknown>) {
    return mount(BrowserJourney, {
      props: { modelValue: journey, ...props },
      global: { stubs: { ...STUBS, JourneySteps: JourneyStepsStubWithDots } },
    }) as VueWrapper;
  }

  function dotStateOf(w: VueWrapper, stepId: string) {
    return w.find(`[data-step-id="${stepId}"]`).attributes("data-dot-state");
  }

  it("should show the running step as active while the replay is running", () => {
    wrapper = mountWithDots({ replayPhase: "running", activeStepId: "s2" });
    expect(dotStateOf(wrapper, "s2")).toBe("active");
  });

  // Regression: the step a replay was interrupted on never reports a result, so
  // activeStepId stays pointing at it. Rendering that as "active" left the journey
  // with a step spinning forever after Stop.
  it("should not leave a step in progress once the replay has stopped", () => {
    wrapper = mountWithDots({ replayPhase: "stopped", activeStepId: "s2" });
    expect(dotStateOf(wrapper, "s2")).toBe("pending");
  });

  it("should not show a step as active while the stop is being confirmed", () => {
    wrapper = mountWithDots({ replayPhase: "stopping", activeStepId: "s2" });
    expect(dotStateOf(wrapper, "s2")).toBe("pending");
  });

  it("should keep results already reported before the stop", () => {
    const stepResults = new Map([
      ["s1", { stepId: "s1", stepName: "Open app", passed: true, durationMs: 900 }],
    ]);
    wrapper = mountWithDots({ replayPhase: "stopped", activeStepId: "s2", stepResults });
    expect(dotStateOf(wrapper, "s1")).toBe("pass");
    expect(dotStateOf(wrapper, "s2")).toBe("pending");
  });

  it("should replace Stop with a disabled, loading button while stopping", () => {
    wrapper = mountWithDots({ replayPhase: "stopping" });

    // The live Stop is gone, so a second press cannot queue another stopReplay…
    expect(wrapper.find('[data-test="synthetics-journey-stop-replay-btn"]').exists()).toBe(false);
    const stopping = wrapper.find('[data-test="synthetics-journey-stopping-replay-btn"]');
    expect(stopping.exists()).toBe(true);
    // …and Re-run must not appear until the replay has actually stopped.
    expect(wrapper.find('[data-test="synthetics-journey-replay-btn"]').exists()).toBe(false);
  });

  it("should announce that it is stopping rather than claiming the replay stopped", () => {
    wrapper = mountWithDots({ replayPhase: "stopping" });
    expect(wrapper.find('[data-test="synthetics-journey-stopping-banner"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="synthetics-journey-stopped-banner"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="synthetics-journey-replay-banner"]').exists()).toBe(false);
  });

  it("should offer Re-run once the replay has stopped", () => {
    wrapper = mountWithDots({ replayPhase: "stopped" });
    expect(wrapper.find('[data-test="synthetics-journey-stopping-replay-btn"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="synthetics-journey-stopped-banner"]').exists()).toBe(true);
  });

  it("should keep the journey locked against edits while stopping", () => {
    // The player may still be unwinding, so editing a step would race it.
    wrapper = mountWithDots({ replayPhase: "stopping" });
    expect(wrapper.find('[data-test="synthetics-journey-add-step-btn"]').exists()).toBe(false);
  });
});

// An incognito-classified failure — replay preflight (blocked-reason prop) or a
// recording-start refusal (recorder.error) — means "Allow in Incognito" is off.
// The setup dialog's incognito task IS the walkthrough, so the view reopens it
// (revoking the attestation the failure just disproved) instead of a wall of text.
describe("BrowserJourney — incognito preflight failure", () => {
  let wrapper: VueWrapper;
  let revokeSpy: ReturnType<typeof vi.fn>;

  // The extension's actual refusal message — classification keys on "incognito".
  const INCOGNITO_RECORD_ERROR =
    'Recording needs incognito access. Open chrome://extensions, find "OpenObserve Synthetics Recorder", and turn on "Allow in incognito" — recordings always run in a separate incognito window.';

  // The template ref resolves to this stub, so revokeIncognitoAck must exist on
  // its instance for the watcher's call to be observable (options-API methods
  // are exposed on the vm).
  const RevokableSetupDialogStub = {
    props: ["open", "connected", "action"],
    emits: ["update:open", "continue"],
    methods: {
      revokeIncognitoAck() {
        revokeSpy();
      },
    },
    template: '<div v-if="open" class="extension-setup-dialog-stub" :data-action="action" />',
  };

  // The shared OButtonStub leaves `onClick` in $attrs (no declared emits), so a
  // click fires the handler twice — declaring the emit keeps it to one, which
  // the exactly-once assertions below depend on.
  const SingleEmitButtonStub = {
    emits: ["click"],
    template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
  };

  function mountBlockable(props: Record<string, unknown> = {}) {
    return mount(BrowserJourney, {
      props: { modelValue: [], ...props },
      global: {
        stubs: {
          ...STUBS,
          OButton: SingleEmitButtonStub,
          ExtensionSetupDialog: RevokableSetupDialogStub,
        },
      },
    }) as VueWrapper;
  }

  /** Drive a recording-start refusal through the real bridge transport. */
  async function failRecordingWith(w: VueWrapper, message: string) {
    await w.find('[data-test="synthetics-journey-record-btn"]').trigger("click");
    await settleProbeDelay();
    respondToLastCommand({ success: false, error: message });
    await flushPromises();
  }

  beforeEach(() => {
    revokeSpy = vi.fn();
    postMessageSpy = vi.fn();
    vi.spyOn(window, "postMessage").mockImplementation(postMessageSpy);
    vi.useFakeTimers();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("should revoke the attestation and open the setup dialog on replay when blocked", async () => {
    wrapper = mountBlockable({ blockedReason: null });
    expect(wrapper.find(".extension-setup-dialog-stub").exists()).toBe(false);

    await wrapper.setProps({ blockedReason: "incognito" });

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    const dialog = wrapper.find(".extension-setup-dialog-stub");
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("data-action")).toBe("replay");
  });

  it("should not touch the dialog for other blocked reasons", async () => {
    wrapper = mountBlockable({ blockedReason: null });

    await wrapper.setProps({ blockedReason: "in-progress" });

    expect(revokeSpy).not.toHaveBeenCalled();
    expect(wrapper.find(".extension-setup-dialog-stub").exists()).toBe(false);
  });

  it("should reopen the setup dialog from the warning card's setup button", async () => {
    wrapper = mountBlockable({ blockedReason: "incognito" });

    await wrapper.find('[data-test="synthetics-journey-incognito-setup-btn"]').trigger("click");

    const dialog = wrapper.find(".extension-setup-dialog-stub");
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("data-action")).toBe("replay");
  });

  it("should emit replay from the warning card's Retry", async () => {
    wrapper = mountBlockable({ blockedReason: "incognito" });

    await wrapper.find('[data-test="synthetics-journey-incognito-retry-btn"]').trigger("click");

    expect(wrapper.emitted("replay")).toHaveLength(1);
  });

  it("should emit clear-results from the warning card's Dismiss", async () => {
    wrapper = mountBlockable({ blockedReason: "incognito" });

    await wrapper.find('[data-test="synthetics-journey-incognito-dismiss-btn"]').trigger("click");

    expect(wrapper.emitted("clear-results")).toHaveLength(1);
    expect(wrapper.emitted("replay")).toBeFalsy();
  });

  it("should treat an incognito recording refusal like the replay preflight", async () => {
    wrapper = mountBlockable({ extensionReady: true });

    await failRecordingWith(wrapper, INCOGNITO_RECORD_ERROR);

    expect(revokeSpy).toHaveBeenCalledTimes(1);
    const dialog = wrapper.find(".extension-setup-dialog-stub");
    expect(dialog.exists()).toBe(true);
    expect(dialog.attributes("data-action")).toBe("record");
    expect(wrapper.find('[data-test="synthetics-journey-incognito-warning"]').exists()).toBe(true);
    // The card and dialog replace the raw banner for the one cause with a fix.
    expect(wrapper.find('[data-test="synthetics-journey-record-error"]').exists()).toBe(false);
  });

  it("should keep the raw banner for recording errors that are not incognito", async () => {
    wrapper = mountBlockable({ extensionReady: true });

    await failRecordingWith(wrapper, "Failed to start recording.");

    expect(wrapper.find('[data-test="synthetics-journey-record-error"]').exists()).toBe(true);
    expect(revokeSpy).not.toHaveBeenCalled();
    expect(wrapper.find(".extension-setup-dialog-stub").exists()).toBe(false);
    expect(wrapper.find('[data-test="synthetics-journey-incognito-warning"]').exists()).toBe(false);
  });

  it("should restart the recording (not replay) from Retry when recording was refused", async () => {
    wrapper = mountBlockable({ extensionReady: true });
    await failRecordingWith(wrapper, INCOGNITO_RECORD_ERROR);
    postMessageSpy.mockClear();

    await wrapper.find('[data-test="synthetics-journey-incognito-retry-btn"]').trigger("click");

    // startRecording opens with a synchronous bridge probe — its signature.
    expect(
      postMessageSpy.mock.calls.some((c) => (c[0] as { ch?: string })?.ch === "oo-bridge-probe"),
    ).toBe(true);
    expect(wrapper.emitted("replay")).toBeFalsy();
  });

  it("should clear the recorder error (not results) from Dismiss when recording was refused", async () => {
    wrapper = mountBlockable({ extensionReady: true });
    await failRecordingWith(wrapper, INCOGNITO_RECORD_ERROR);

    await wrapper.find('[data-test="synthetics-journey-incognito-dismiss-btn"]').trigger("click");

    expect(wrapper.emitted("clear-results")).toBeFalsy();
    // Error gone: the card collapses and the raw banner does not take its place.
    expect(wrapper.find('[data-test="synthetics-journey-incognito-warning"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="synthetics-journey-record-error"]').exists()).toBe(false);
  });
});

// ── Journey suggestions ───────────────────────────────────────────────────
// The always-on advisory cards are gone; what is left is a derivation handed to
// one collapsed surface, and a single action coming back.

const JourneySuggestionsStub = {
  props: ["suggestions"],
  emits: ["action"],
  template: `
    <div
      class="journey-suggestions-stub"
      :data-count="suggestions.length"
      :data-ids="suggestions.map((s) => s.id).join(',')"
    >
      <button class="suggestion-action" @click="$emit('action', 'add-assertion')" />
    </div>`,
};

describe("BrowserJourney suggestions", () => {
  let wrapper: VueWrapper;

  const CLICK_STEP = { id: "s1", action: "click", name: "Sign In" };
  const NAV_STEP = { id: "s0", action: "navigate", name: "Open app", value: "https://app.test" };

  function mountWithSuggestions(props: Record<string, unknown> = {}) {
    return mount(BrowserJourney, {
      props: { modelValue: [NAV_STEP, CLICK_STEP], ...props },
      global: { stubs: { ...STUBS, JourneySuggestions: JourneySuggestionsStub } },
    }) as VueWrapper;
  }

  const suggestionIds = (w: VueWrapper) =>
    (w.find(".journey-suggestions-stub").attributes("data-ids") ?? "").split(",").filter(Boolean);

  beforeEach(() => {
    postMessageSpy = vi.fn();
    vi.spyOn(window, "postMessage").mockImplementation(postMessageSpy);
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  it("no longer renders the always-on advisory cards", () => {
    wrapper = mountWithSuggestions();

    expect(wrapper.find('[data-test="synthetics-journey-zero-assertion-notice"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="synthetics-journey-testid-misconfigured"]').exists()).toBe(
      false,
    );
  });

  it("hands the derived suggestions to the collapsed surface", () => {
    wrapper = mountWithSuggestions();

    expect(suggestionIds(wrapper)).toContain("zero-assertion");
  });

  it("offers nothing on a journey the author cannot change", () => {
    wrapper = mountWithSuggestions({ readonly: true });

    expect(wrapper.find(".journey-suggestions-stub").exists()).toBe(false);
  });

  it("appends the offered assertion to the tail, leaving the recording untouched", async () => {
    wrapper = mountWithSuggestions();

    await wrapper.find(".suggestion-action").trigger("click");

    const emitted = wrapper.emitted("update:modelValue")?.[0]?.[0] as Array<
      Record<string, unknown>
    >;
    expect(emitted).toHaveLength(3);
    // Order and identity of what was recorded survive the insertion.
    expect(emitted.slice(0, 2).map((s) => s.id)).toEqual(["s0", "s1"]);
    expect(emitted[0]).toEqual(NAV_STEP);
    expect(emitted[1]).toEqual(CLICK_STEP);
    expect(emitted[2]).toMatchObject({
      action: "assert",
      assertion: { kind: "element_visible" },
    });
    expect(emitted[2].id).toBeTruthy();
  });

  it("drops the suggestion once the parent commits the new step", async () => {
    wrapper = mountWithSuggestions();
    await wrapper.find(".suggestion-action").trigger("click");

    const emitted = wrapper.emitted("update:modelValue")?.[0]?.[0];
    await wrapper.setProps({ modelValue: emitted });

    expect(suggestionIds(wrapper)).not.toContain("zero-assertion");
  });
});

// ── Variables panel toggle ────────────────────────────────────────────────
describe("BrowserJourney variables panel toggle", () => {
  let wrapper: VueWrapper;

  const TOGGLE = '[data-test="synthetics-journey-toggle-variables-btn"]';

  // The shared OIconStub swallows `name`; this one surfaces it so the chevron
  // direction can be asserted from the DOM (same shape as JourneySteps.spec.ts).
  const OIconWithNameStub = {
    props: ["name"],
    template: '<i :data-icon-name="name" />',
  };
  const OTooltipWithContentStub = {
    props: ["content"],
    template: '<div :data-tooltip="content" />',
  };

  function mountToolbar(props: Record<string, unknown> = {}) {
    return mount(BrowserJourney, {
      props: { modelValue: [], ...props },
      global: {
        stubs: { ...STUBS, OIcon: OIconWithNameStub, OTooltip: OTooltipWithContentStub },
      },
    }) as VueWrapper;
  }

  const chevronOf = (w: VueWrapper) =>
    w.find(`${TOGGLE} [data-icon-name]`).attributes("data-icon-name");

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  it("should render the toggle as the icon-only panel-collapse button", () => {
    wrapper = mountToolbar({ variablesPanelOpen: false });

    const toggle = wrapper.find(TOGGLE);
    expect(toggle.attributes("variant")).toBe("panel-collapse");
    expect(toggle.attributes("size")).toBe("icon-toolbar");
    expect(toggle.text()).toBe("");
  });

  // vue-i18n is mocked to return the key, so the key IS the rendered tooltip here.
  it("should offer the collapse tooltip while the panel is open", () => {
    wrapper = mountToolbar({ variablesPanelOpen: true });

    expect(wrapper.find(`${TOGGLE} [data-tooltip]`).attributes("data-tooltip")).toBe(
      "synthetics.variablesPanel.collapsePanel",
    );
  });

  it("should offer the open tooltip while the panel is closed", () => {
    wrapper = mountToolbar({ variablesPanelOpen: false });

    expect(wrapper.find(`${TOGGLE} [data-tooltip]`).attributes("data-tooltip")).toBe(
      "synthetics.variablesPanel.openPanel",
    );
  });

  it("should size the action area to its content instead of a fixed width", () => {
    wrapper = mountToolbar({ variablesPanelOpen: false });

    expect(wrapper.findAll(".w-110")).toHaveLength(0);
    expect(wrapper.findAll('[class~="w-24!"]')).toHaveLength(0);
  });

  // The host owns the panel; without that prop there is meant to be no panel to
  // toggle. Skipped because the guard cannot work as written, and this predates
  // the label change: `variablesPanelOpen?: boolean` is a Boolean-typed prop, so
  // Vue's boolean casting resolves an omitted value to `false`, never
  // `undefined` — verified by reading $props on a mount with the prop omitted.
  // `v-if="variablesPanelOpen !== undefined"` is therefore always true and the
  // toggle renders for every host. Un-skip once the component distinguishes
  // "no panel" some other way (e.g. `variablesPanelOpen?: boolean | undefined`
  // declared with an explicit `default: undefined`, or a separate flag prop).
  it.skip("should not render the toggle when the host provides no variables panel", () => {
    wrapper = mountToolbar();

    expect(wrapper.find(TOGGLE).exists()).toBe(false);
  });

  it("should render the toggle when the host provides a closed variables panel", () => {
    wrapper = mountToolbar({ variablesPanelOpen: false });

    expect(wrapper.find(TOGGLE).exists()).toBe(true);
  });

  it("should emit toggle-variables-panel when pressed", async () => {
    wrapper = mountToolbar({ variablesPanelOpen: false });

    await wrapper.find(TOGGLE).trigger("click");

    // OButtonStub both $emits "click" and lets the native event through (it
    // declares no `emits`), so one press registers twice. That it fires at all,
    // with no payload, is the contract.
    const emitted = wrapper.emitted("toggle-variables-panel")!;
    expect(emitted.length).toBeGreaterThan(0);
    for (const call of emitted) expect(call).toEqual([]);
  });

  it("should point the chevron right — collapse — while the panel is open", () => {
    wrapper = mountToolbar({ variablesPanelOpen: true });

    expect(chevronOf(wrapper)).toBe("keyboard-double-arrow-right");
  });

  it("should point the chevron left — open — while the panel is closed", () => {
    wrapper = mountToolbar({ variablesPanelOpen: false });

    expect(chevronOf(wrapper)).toBe("keyboard-double-arrow-left");
  });
});

// ── Restore-then-record and insertion (P2 / P3 / P4) ────────────────────────
//
// The three phases share one mechanism: an ANCHOR decides both what gets replayed to
// restore state (everything before it) and where the recorded steps land. Record at the
// end and inserting at step N are the same operation with a different anchor, which is
// why they are tested together — a regression in one is a regression in both.
//
// See docs/synthetics/record-from-step-design.md §7.4-§7.6.
describe("BrowserJourney restore-then-record", () => {
  let wrapper: VueWrapper;

  const journey = [
    { id: "s1", action: "navigate", name: "Open app", value: "https://app.test/" },
    { id: "s2", action: "click", name: "Sign in", selector: "#login" },
    { id: "s3", action: "click", name: "Open cart", selector: "#cart" },
  ] as any[];

  beforeEach(() => {
    postMessageSpy = vi.fn();
    vi.spyOn(window, "postMessage").mockImplementation(postMessageSpy);
    vi.useFakeTimers();
    // Declared at module scope, so it carries calls in from earlier describes.
    mockToast.mockClear();
    mockT.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** The command the composable last put on the bridge. */
  function lastCommand(): any {
    const calls = postMessageSpy.mock.calls;
    for (let i = calls.length - 1; i >= 0; i--) {
      const data = calls[i]?.[0];
      if (data?.msg?.type === "synthetics-command") return data.msg.command;
    }
    return null;
  }

  async function clickRecord() {
    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger("click");
    await settleProbeDelay();
  }

  // P2. The whole point of the phase: appending to a non-empty journey must first put
  // the browser where the last step left it, or the capture is taken against the start
  // URL and every recorded locator belongs to the wrong screen.
  it("should restore the journey before recording when steps already exist", async () => {
    wrapper = mountJourney({ modelValue: journey, extensionReady: true, canRecordFrom: true });

    await clickRecord();

    expect(lastCommand()?.action).toBe("startRecordingFrom");
    expect(lastCommand()?.prefixSteps).toHaveLength(3);
  });

  // An empty journey has nothing to restore, so it must stay on the cheap path — no
  // replay, no incognito round trip before the author can act.
  it("should record from scratch when the journey is empty", async () => {
    wrapper = mountJourney({ modelValue: [], extensionReady: true, canRecordFrom: true });

    await clickRecord();

    expect(lastCommand()?.action).toBe("startRecording");
  });

  // Graceful degradation: an extension that predates the command must still be able to
  // record. Sending startRecordingFrom to it would be refused and the button would do
  // nothing, which is worse than the old, imperfect behaviour.
  it("should fall back to plain recording when the extension cannot restore", async () => {
    wrapper = mountJourney({ modelValue: journey, extensionReady: true, canRecordFrom: false });

    await clickRecord();

    expect(lastCommand()?.action).toBe("startRecording");
  });

  // The fallback records on a browser that knows nothing about the prefix, so those
  // steps cannot be filed where a restore would have put them. The row action is
  // disabled without the capability, which is what the author sees; this is the
  // guarantee behind it, so a future caller cannot reintroduce the mid-journey splice.
  it("should append, not insert, when an anchored record falls back to plain recording", async () => {
    wrapper = mountJourney({ modelValue: journey, extensionReady: true, canRecordFrom: false });

    await wrapper.findComponent(".journey-steps-stub").vm.$emit("record-before", journey[2]);
    await settleProbeDelay();

    expect(lastCommand()?.action).toBe("startRecording");

    respondToLastCommand({ success: true });
    await flushPromises();
    emitStreamEvent({
      method: "setActions",
      actions: [],
      sources: [],
      browserSteps: [{ id: "n1", action: "click", selector: "#consent", name: "Accept cookies" }],
    });
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger("click");
    respondToLastCommand({ success: true });
    await flushPromises();

    const emitted = wrapper.emitted("update:modelValue");
    const next = emitted![emitted!.length - 1][0] as any[];
    expect(next).toHaveLength(4);
    expect(next[0].id).toBe("s1");
    expect(next[1].id).toBe("s2");
    expect(next[2].id).toBe("s3");
    expect(next[3].name).toBe("Accept cookies");
  });

  // P2 commit. Anchored at the end, the recorded steps land after everything.
  it("should append recorded steps when the anchor is the end of the journey", async () => {
    wrapper = mountJourney({ modelValue: journey, extensionReady: true, canRecordFrom: true });
    await clickRecord();
    respondToLastCommand({ success: true });
    await flushPromises();

    emitStreamEvent({
      method: "recordingStarted",
      tabId: 1,
      url: "https://app.test/cart",
      mode: "insert",
      baselineStepCount: 0,
    });
    emitStreamEvent({
      method: "setActions",
      actions: [],
      sources: [],
      browserSteps: [{ id: "n1", action: "click", selector: "#checkout", name: "Checkout" }],
    });
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger("click");
    respondToLastCommand({ success: true });
    await flushPromises();

    const emitted = wrapper.emitted("update:modelValue");
    const next = emitted![emitted!.length - 1][0] as any[];
    expect(next.map((s) => s.id)).toEqual(["s1", "s2", "s3", expect.any(String)]);
  });

  // P3 commit — the same machinery, anchored mid-journey. The recorded step must land
  // BEFORE the anchor, and the anchor keeps its identity while shifting down.
  it("should insert recorded steps before the anchor step", async () => {
    wrapper = mountJourney({ modelValue: journey, extensionReady: true, canRecordFrom: true });

    await wrapper.findComponent(".journey-steps-stub").vm.$emit("record-before", journey[2]);
    await settleProbeDelay();

    // Only the steps BEFORE the anchor are replayed: the anchor has not happened yet.
    expect(lastCommand()?.action).toBe("startRecordingFrom");
    expect(lastCommand()?.prefixSteps).toHaveLength(2);

    respondToLastCommand({ success: true });
    await flushPromises();
    emitStreamEvent({
      method: "recordingStarted",
      tabId: 1,
      url: "https://app.test/",
      mode: "insert",
      baselineStepCount: 0,
    });
    emitStreamEvent({
      method: "setActions",
      actions: [],
      sources: [],
      browserSteps: [{ id: "n1", action: "click", selector: "#consent", name: "Accept cookies" }],
    });
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger("click");
    respondToLastCommand({ success: true });
    await flushPromises();

    const emitted = wrapper.emitted("update:modelValue");
    const next = emitted![emitted!.length - 1][0] as any[];
    expect(next).toHaveLength(4);
    expect(next[0].id).toBe("s1");
    expect(next[1].id).toBe("s2");
    expect(next[2].name).toBe("Accept cookies");
    expect(next[3].id).toBe("s3");
  });

  // ── "N steps added — steps X–Y" ─────────────────────────────────────────────
  //
  // The only feedback a finished recording gives. The author spent it in the
  // extension's incognito window, so the steps land in a table they were not
  // looking at — nothing flashes, scrolls or marks the rows. See
  // docs/synthetics/recorded-steps-toast.md.

  /** The interpolation params the added-steps message was last built with. */
  function addedToastParams(): Record<string, unknown> | undefined {
    const calls = mockT.mock.calls as unknown as unknown[][];
    const call = [...calls].reverse().find((c) => c[0] === "synthetics.journey.recordedStepsAdded");
    return call?.[1] as Record<string, unknown> | undefined;
  }

  /** Feed `names` in as captured steps on an already-started recording. */
  function captureSteps(names: string[]) {
    emitStreamEvent({
      method: "recordingStarted",
      tabId: 1,
      url: "https://app.test/cart",
      mode: "insert",
      baselineStepCount: 0,
    });
    emitStreamEvent({
      method: "setActions",
      actions: [],
      sources: [],
      browserSteps: names.map((name, i) => ({
        id: `n${i + 1}`,
        action: "click",
        selector: `#${i}`,
        name,
      })),
    });
  }

  // Appended at the end of a 3-step journey, two recorded steps become 4 and 5.
  it("should announce the numbers an appended recording takes", async () => {
    wrapper = mountJourney({ modelValue: journey, extensionReady: true, canRecordFrom: true });
    await clickRecord();
    respondToLastCommand({ success: true });
    await flushPromises();
    captureSteps(["Checkout", "Pay"]);
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger("click");
    respondToLastCommand({ success: true });
    await flushPromises();

    expect(mockToast).toHaveBeenCalledWith({
      variant: "success",
      message: "synthetics.journey.recordedStepsAdded",
    });
    expect(addedToastParams()).toEqual({ count: 2, first: 4, last: 5 });
  });

  // Anchored before step 3, a single recorded step IS step 3 — the number the
  // anchor held a moment ago, which is why the message names the new range and
  // not the anchor.
  it("should announce the numbers an anchored recording takes", async () => {
    wrapper = mountJourney({ modelValue: journey, extensionReady: true, canRecordFrom: true });
    await wrapper.findComponent(".journey-steps-stub").vm.$emit("record-before", journey[2]);
    await settleProbeDelay();
    respondToLastCommand({ success: true });
    await flushPromises();
    captureSteps(["Accept cookies"]);
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger("click");
    respondToLastCommand({ success: true });
    await flushPromises();

    expect(addedToastParams()).toEqual({ count: 1, first: 3, last: 3 });
  });

  // The extension window being closed commits through the same path as the Stop
  // button. Hung off the button instead, this recording would have been silent.
  it("should announce steps committed by an external stop", async () => {
    wrapper = mountJourney({ modelValue: journey, extensionReady: true, canRecordFrom: true });
    await clickRecord();
    respondToLastCommand({ success: true });
    await flushPromises();
    captureSteps(["Checkout"]);
    await flushPromises();

    emitStreamEvent({ method: "recordingStopped" });
    await flushPromises();

    expect(addedToastParams()).toEqual({ count: 1, first: 4, last: 4 });
  });

  // Nothing was captured, so nothing was added. A message claiming otherwise —
  // or a "0 steps added" — is worse than the silence.
  it("should stay silent when a recording captured nothing", async () => {
    wrapper = mountJourney({ modelValue: journey, extensionReady: true, canRecordFrom: true });
    await clickRecord();
    respondToLastCommand({ success: true });
    await flushPromises();
    // The session is live — the author just never acted in it.
    captureSteps([]);
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger("click");
    respondToLastCommand({ success: true });
    await flushPromises();

    expect(mockToast).not.toHaveBeenCalled();
  });

  // C1 regression: restoring a prefix that contains a subtest reference caches the
  // child's steps into the SAME Map `CreateBrowserTest.vue` writes through
  // `mapWireSteps` — the mapped UI model, not the raw stored wire steps merely cast.
  // Two writers hitting the one Map with different shapes is what corrupted replay: a
  // stored `fill` step falls through `buildWireFromStep`'s missing `case "fill"` and
  // replays as a click, and a stored `navigate` loses its target (`url` vs `value`).
  it("caches a restored subtest child's steps through mapWireSteps, not a raw cast of the stored wire", async () => {
    mockSyntheticsGet.mockResolvedValue({
      data: {
        name: "Login",
        config: {
          steps: [
            { id: "w1", action: "navigate", url: "https://example.com/login" },
            { id: "w2", action: "fill", value: "user@example.com" },
          ],
        },
      },
    });
    const cache = new Map();
    const journeyWithSubtest = [
      ...journey,
      { id: "s4", action: "subtest", name: "Log in (shared)", subtest: { id: "login-test" } },
    ] as any[];
    wrapper = mountJourney({
      modelValue: journeyWithSubtest,
      extensionReady: true,
      canRecordFrom: true,
      childrenCache: cache,
    });

    await clickRecord();

    const child = cache.get("login-test");
    expect(child).toBeDefined();
    // A raw cast would leave action "fill" (an invalid StepAction) and no `value`
    // (the wire step used `url`) on the navigate step — exactly what the corrupted
    // cache used to hand to `journeyToWireSteps` on replay.
    expect(child.steps.map((s: BrowserStep) => s.action)).toEqual(["navigate", "type"]);
    expect(child.steps[0].value).toBe("https://example.com/login");
  });
});

// ── When a restore does not reach the recording point ──────────────────────
//
// A restore ends early for two quite different reasons, and the surface has to
// tell them apart. Closing the recorder window is how an author walks away from
// a restore — reported as "step 9 failed" it blames the journey for a deliberate
// act, and leaves a banner nobody can act on next to a marker that never lifts.

// Surfaces the marker and the lock in the DOM, so the anchor's lifetime can be
// asserted without the real table.
const JourneyStepsStubWithAnchor = {
  props: ["data", "anchorId", "locked", "disableRowReorder", "selectionEnabled"],
  template: `
    <div
      class="journey-steps-stub"
      :data-anchor="anchorId ?? ''"
      :data-locked="String(!!locked)"
      :data-drag-locked="String(!!(disableRowReorder && disableRowReorder()))"
      :data-selectable="String(!!selectionEnabled)"
    >
      <div v-for="item in data" :key="item.id" class="step-row">{{ item.name }}</div>
    </div>`,
};

describe("BrowserJourney — a restore that never reached the recording point", () => {
  let wrapper: VueWrapper;

  const journey = [
    { id: "s1", action: "navigate", name: "Open app", value: "https://app.test/" },
    { id: "s2", action: "click", name: "Sign in", selector: "#login" },
    { id: "s3", action: "click", name: "Open cart", selector: "#cart" },
  ] as any[];

  const WINDOW_CLOSED = {
    method: "prefixFailed",
    stepId: "s2",
    error: "crxRecorder.runActions: Target page, context or browser has been closed",
    structuredError: { message: "…", name: "TargetClosedError" },
  };

  const STEP_FAILED = {
    method: "prefixFailed",
    stepId: "s2",
    error: "locator.click: Timeout 30000ms exceeded",
    structuredError: { message: "…", name: "TimeoutError" },
  };

  function mountAnchored(props: Record<string, unknown> = {}) {
    return mount(BrowserJourney, {
      props: {
        modelValue: journey,
        extensionReady: true,
        canRecordFrom: true,
        canRecordFromFailure: true,
        ...props,
      },
      global: { stubs: { ...STUBS, JourneySteps: JourneyStepsStubWithAnchor } },
    }) as VueWrapper;
  }

  /** The command the composable last put on the bridge. */
  function lastCommand(): any {
    const calls = postMessageSpy.mock.calls;
    for (let i = calls.length - 1; i >= 0; i--) {
      const data = calls[i]?.[0];
      if (data?.msg?.type === "synthetics-command") return data.msg.command;
    }
    return null;
  }

  /** Anchor on step 3 and get as far as the prefix replaying. */
  async function startAnchoredRestore(w: VueWrapper) {
    await w.findComponent(".journey-steps-stub").vm.$emit("record-before", journey[2]);
    await settleProbeDelay();
  }

  /** Answer the start command the way the extension does after a prefix failure. */
  async function failWith(payload: Record<string, unknown>) {
    emitStreamEvent(payload);
    respondToLastCommand({ success: false, error: payload.error });
    await flushPromises();
  }

  beforeEach(() => {
    postMessageSpy = vi.fn();
    vi.spyOn(window, "postMessage").mockImplementation(postMessageSpy);
    vi.useFakeTimers();
    mockToast.mockClear();
    mockT.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // The screenshot this work started from: a warning banner blaming a step, a raw
  // Playwright string under it, and a marker still sitting on the anchor.
  it("should say the recording was cancelled when the window was closed", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);

    await failWith(WINDOW_CLOSED);

    expect(mockToast).toHaveBeenCalledWith({
      variant: "info",
      message: "synthetics.journey.restoreCancelledWindowClosed",
    });
    expect(wrapper.find('[data-test="synthetics-journey-prefix-failed"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="synthetics-journey-record-error"]').exists()).toBe(false);
  });

  /**
   * The marker is a promise about where the next steps land. Left up after the
   * session died it becomes a lie — and the toolbar's Record reads the same anchor,
   * so the next recording would splice itself into the middle of the journey with
   * nothing on screen saying so.
   */
  it("should lift the recording marker when the window was closed", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    expect(wrapper.find(".journey-steps-stub").attributes("data-anchor")).toBe("s3");

    await failWith(WINDOW_CLOSED);

    expect(wrapper.find(".journey-steps-stub").attributes("data-anchor")).toBe("");
  });

  // Nothing was captured, so nothing may be committed — a cancel that quietly
  // added steps would be worse than the banner it replaces.
  it("should commit nothing when the window was closed", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);

    await failWith(WINDOW_CLOSED);

    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  /**
   * The contract with the extension build that names the cause itself.
   *
   * It watched the window go away, so its word beats anything read out of an
   * exception — and it is the only side that can tell a closed window from a step
   * that could not run, since both reach the player as the same rejected action.
   */
  it("should take the extension's word for it when the extension names the cause", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);

    // No TargetClosedError, nothing in the text to go on — only the reason.
    await failWith({
      method: "prefixFailed",
      stepId: "s2",
      error: "crxRecorder.runActions: Stopped",
      reason: "window-closed",
    });

    expect(mockToast).toHaveBeenCalledWith({
      variant: "info",
      message: "synthetics.journey.restoreCancelledWindowClosed",
    });
    expect(wrapper.find('[data-test="synthetics-journey-prefix-failed"]').exists()).toBe(false);
  });

  // ── A step that genuinely failed ─────────────────────────────────────────
  //
  // This one keeps its banner: something in the journey is broken and the author
  // has to decide what to do about it. What it gains is the two ways out design
  // §7.2 specified and the template never grew.

  it("should keep the banner when a step genuinely failed", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);

    await failWith(STEP_FAILED);

    expect(wrapper.find('[data-test="synthetics-journey-prefix-failed"]').exists()).toBe(true);
    // A banner and a toast for one event is the stacking this work exists to stop.
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("should not repeat the failure as a raw error banner underneath", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);

    await failWith(STEP_FAILED);

    expect(wrapper.find('[data-test="synthetics-journey-record-error"]').exists()).toBe(false);
  });

  /**
   * The browser is still sitting where step 2 stopped, so recording can start there
   * without replaying anything again (design §7.6). The anchor moves to the failing
   * step, which is where those steps will land.
   */
  it("should record from where the failing step stopped", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    await failWith(STEP_FAILED);

    await wrapper
      .find('[data-test="synthetics-journey-prefix-failed-record-btn"]')
      .trigger("click");
    await flushPromises();

    expect(lastCommand()?.action).toBe("recordFromHere");
    expect(wrapper.find(".journey-steps-stub").attributes("data-anchor")).toBe("s2");
    expect(wrapper.find('[data-test="synthetics-journey-prefix-failed"]').exists()).toBe(false);
  });

  // The recovery is only worth anything if what it captures lands where the marker
  // says it will — before the step that could not run.
  it("should insert the recovered steps before the step that failed", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    await failWith(STEP_FAILED);

    await wrapper
      .find('[data-test="synthetics-journey-prefix-failed-record-btn"]')
      .trigger("click");
    respondToLastCommand({ success: true });
    await flushPromises();
    emitStreamEvent({
      method: "recordingStarted",
      tabId: 1,
      url: "https://app.test/",
      mode: "insert",
      baselineStepCount: 0,
    });
    emitStreamEvent({
      method: "setActions",
      actions: [],
      sources: [],
      browserSteps: [{ id: "n1", action: "click", selector: "#consent", name: "Accept cookies" }],
    });
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger("click");
    respondToLastCommand({ success: true });
    await flushPromises();

    const emitted = wrapper.emitted("update:modelValue");
    const next = emitted![emitted!.length - 1][0] as any[];
    expect(next.map((s) => s.name)).toEqual(["Open app", "Accept cookies", "Sign in", "Open cart"]);
  });

  // Cancel is the other half: the author reads the error and goes back to editing.
  // It must leave nothing behind — no banner, no marker for a dead session.
  it("should clear the failure and the marker from Cancel", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    await failWith(STEP_FAILED);

    await wrapper
      .find('[data-test="synthetics-journey-prefix-failed-cancel-btn"]')
      .trigger("click");

    expect(wrapper.find('[data-test="synthetics-journey-prefix-failed"]').exists()).toBe(false);
    expect(wrapper.find(".journey-steps-stub").attributes("data-anchor")).toBe("");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
  });

  /**
   * Recording before step 1 would leave the journey starting with something other
   * than a navigate, which `validateJourneySteps` rejects — the same guardrail the
   * row button carries. Cancel is still offered; there is simply nowhere to record.
   */
  it("should not offer to record before the first step", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);

    await failWith({ ...STEP_FAILED, stepId: "s1" });

    expect(wrapper.find('[data-test="synthetics-journey-prefix-failed"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="synthetics-journey-prefix-failed-record-btn"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="synthetics-journey-prefix-failed-cancel-btn"]').exists()).toBe(
      true,
    );
  });

  // An extension that cannot record on an open session would answer the command
  // with a refusal, so the button must not be there to press.
  it("should not offer the recovery to an extension that cannot do it", async () => {
    wrapper = mountAnchored({ canRecordFromFailure: false });
    await startAnchoredRestore(wrapper);

    await failWith(STEP_FAILED);

    expect(wrapper.find('[data-test="synthetics-journey-prefix-failed-record-btn"]').exists()).toBe(
      false,
    );
  });

  // ── The toolbar's Record means the end of the journey ────────────────────
  //
  // The anchor is one piece of state read by both record affordances, so an anchor
  // outliving its session turns the next plain Record into a silent mid-journey
  // insert. Nothing on screen would say so.

  it("should record at the end even after an anchored session left a marker", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    await failWith(STEP_FAILED);

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger("click");
    await settleProbeDelay();
    respondToLastCommand({ success: true });
    await flushPromises();
    emitStreamEvent({
      method: "recordingStarted",
      tabId: 1,
      url: "https://app.test/",
      mode: "insert",
      baselineStepCount: 0,
    });
    emitStreamEvent({
      method: "setActions",
      actions: [],
      sources: [],
      browserSteps: [{ id: "n1", action: "click", selector: "#pay", name: "Pay" }],
    });
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-stop-btn"]').trigger("click");
    respondToLastCommand({ success: true });
    await flushPromises();

    const emitted = wrapper.emitted("update:modelValue");
    const next = emitted![emitted!.length - 1][0] as any[];
    expect(next.map((s) => s.name)).toEqual(["Open app", "Sign in", "Open cart", "Pay"]);
  });

  // ── While the restore is running ─────────────────────────────────────────

  /**
   * The reason authors close the window: it was the only way out. A restore can run
   * for a minute a step, and until there was a Cancel the recorder window was the
   * only thing on screen that would end it.
   */
  it("should offer a way out while the restore is still running", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    respondToLastCommand({ success: true });
    await flushPromises();

    expect(wrapper.find('[data-test="synthetics-journey-restoring-banner"]').exists()).toBe(true);
    await wrapper.find('[data-test="synthetics-journey-restore-cancel-btn"]').trigger("click");

    expect(lastCommand()?.action).toBe("stopReplay");
    expect(wrapper.find('[data-test="synthetics-journey-restoring-banner"]').exists()).toBe(false);
    expect(wrapper.find(".journey-steps-stub").attributes("data-anchor")).toBe("");
  });

  /** The interpolation params the restore banner was last built with. */
  function restoringBannerParams(): Record<string, unknown> | undefined {
    const calls = mockT.mock.calls as unknown as unknown[][];
    const call = [...calls].reverse().find((c) => c[0] === "synthetics.journey.restoringState");
    return call?.[1] as Record<string, unknown> | undefined;
  }

  /**
   * The banner is the only account of a restore the author gets — the work itself
   * happens in a window they are watching instead of this one. Frozen at "step 0 of
   * N" it reads as a restore that has hung, while the recorder window is visibly
   * progressing.
   */
  it("should count the restore's progress in the banner", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    expect(restoringBannerParams()).toEqual({ done: 0, total: 2 });

    emitStreamEvent({ method: "stepReplayResult", stepId: "s1", passed: true, duration_ms: 10 });
    await flushPromises();

    expect(restoringBannerParams()).toEqual({ done: 1, total: 2 });
  });

  /**
   * The reported bug. Cancel is pressed while the start command is still outstanding
   * — the only state it can be pressed in — and the session teardown force-resolves
   * that command, so its continuation reports "Failed to start recording." against
   * the button the author pressed to stop things.
   */
  it("should not claim a failure when the author cancels the restore", async () => {
    wrapper = mountAnchored();
    // Deliberately unanswered: the extension replies only when the prefix finishes.
    await startAnchoredRestore(wrapper);

    await wrapper.find('[data-test="synthetics-journey-restore-cancel-btn"]').trigger("click");
    await flushPromises();

    expect(wrapper.find('[data-test="synthetics-journey-record-error"]').exists()).toBe(false);
  });

  /**
   * A cancel O2 asked for comes back as a `prefixFailed`, because stopping the
   * player makes the in-flight action throw. Rendering that would replace the
   * banner the author just dismissed with a worse one.
   */
  it("should stay quiet when the extension reports the cancel it was asked for", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    respondToLastCommand({ success: true });
    await flushPromises();

    await wrapper.find('[data-test="synthetics-journey-restore-cancel-btn"]').trigger("click");
    emitStreamEvent({ method: "prefixFailed", stepId: "s2", error: "Stopped" });
    await flushPromises();

    expect(wrapper.find('[data-test="synthetics-journey-prefix-failed"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="synthetics-journey-record-error"]').exists()).toBe(false);
    expect(mockToast).not.toHaveBeenCalled();
  });

  /**
   * Delete must be unavailable while anything is running, by whichever route the
   * table is on screen. The lock is what disables it (JourneySteps disables every row
   * action on `locked`), so these pin the lock itself for each state — a replay, a
   * restore, and a recording, which swaps in the live-capture table entirely.
   */
  it("should lock the step rows while a replay runs", async () => {
    wrapper = mountAnchored({ replayPhase: "running" });

    expect(wrapper.find(".journey-steps-stub").attributes("data-locked")).toBe("true");
  });

  it("should lock the step rows while a recording runs", async () => {
    wrapper = mountAnchored({ modelValue: [] });
    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger("click");
    await settleProbeDelay();
    respondToLastCommand({ success: true });
    await flushPromises();
    emitStreamEvent({ method: "recordingStarted", tabId: 1, url: "https://app.test/" });
    emitStreamEvent({
      method: "setActions",
      actions: [],
      sources: [],
      browserSteps: [{ id: "n1", action: "click", selector: "#a", name: "Click" }],
    });
    await flushPromises();

    // The live-capture table is a different instance of the same component, and it is
    // locked outright — the journey being captured is not editable mid-capture.
    expect(wrapper.find(".journey-steps-stub").attributes("data-locked")).toBe("true");
  });

  /**
   * Design §7.6's hazard: a second anchor started while a session is live. The row
   * actions already have a lock — the restore simply was not part of it, because it
   * runs on this component's own recorder rather than the parent's replay.
   */
  it("should lock the step rows while the restore runs", async () => {
    wrapper = mountAnchored();
    expect(wrapper.find(".journey-steps-stub").attributes("data-locked")).toBe("false");

    await startAnchoredRestore(wrapper);
    respondToLastCommand({ success: true });
    await flushPromises();

    expect(wrapper.find(".journey-steps-stub").attributes("data-locked")).toBe("true");
  });

  /**
   * Reordering mid-restore edits the journey the restore is anchored in: the prefix
   * being replayed is `slice(0, insertAt)` of a list that just changed underneath it,
   * so the steps that land are spliced against an index that no longer means what it
   * did when the restore started.
   */
  it("should not let rows be dragged while the restore runs", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    respondToLastCommand({ success: true });
    await flushPromises();

    expect(wrapper.find(".journey-steps-stub").attributes("data-drag-locked")).toBe("true");
  });

  /**
   * A restore is the journey running. Adding a step to it mid-flight edits the list
   * the restore is anchored in — the same reason the rows are locked — and starting a
   * replay would ask for a second session while this one holds the incognito slot.
   *
   * Disabled rather than hidden, so the toolbar keeps its shape and the author can see
   * what will be available again when the restore ends.
   */
  /**
   * The row's own Delete is disabled by the lock, but it is not the only way to
   * delete: ticking rows hands the parent a bulk Delete in its sticky footer, and
   * that path had no restore guard at all. Deleting mid-restore edits the very list
   * the restore is anchored in — `insertAt` then points somewhere else by the time
   * the capture is spliced.
   *
   * Recording and a running replay were already excluded here; only the restore was
   * missed, because it runs on this component's own recorder rather than the
   * parent's replay phase.
   */
  it("should not allow steps to be selected for deletion while the restore runs", async () => {
    wrapper = mountAnchored();
    expect(wrapper.find(".journey-steps-stub").attributes("data-selectable")).toBe("true");

    await startAnchoredRestore(wrapper);
    respondToLastCommand({ success: true });
    await flushPromises();

    expect(wrapper.find(".journey-steps-stub").attributes("data-selectable")).toBe("false");
  });

  it("should not offer Add Step while the restore runs", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    respondToLastCommand({ success: true });
    await flushPromises();

    const addStep = wrapper.find('[data-test="synthetics-journey-add-step-btn"]');
    expect(addStep.exists(), "Add Step disappeared instead of being disabled").toBe(true);
    expect(addStep.attributes("disabled")).toBeDefined();
  });

  it("should not offer Replay while the restore runs", async () => {
    wrapper = mountAnchored({ replayPhase: "idle" });
    await startAnchoredRestore(wrapper);
    respondToLastCommand({ success: true });
    await flushPromises();

    const replay = wrapper.find('[data-test="synthetics-journey-replay-btn"]');
    expect(replay.exists(), "Replay disappeared instead of being disabled").toBe(true);
    expect(replay.attributes("disabled")).toBeDefined();
  });

  /**
   * The same button, reached through its other branch: a previous replay that has
   * finished leaves the toolbar showing Re-run, which had no disabled binding at all.
   */
  it("should not offer Re-run while the restore runs", async () => {
    wrapper = mountAnchored({ replayPhase: "passed" });
    await startAnchoredRestore(wrapper);
    respondToLastCommand({ success: true });
    await flushPromises();

    expect(
      wrapper.find('[data-test="synthetics-journey-replay-btn"]').attributes("disabled"),
    ).toBeDefined();
  });

  it("should not offer Record while the restore runs", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    respondToLastCommand({ success: true });
    await flushPromises();

    expect(
      wrapper.find('[data-test="synthetics-journey-record-btn"]').attributes("disabled"),
    ).toBeDefined();
  });

  /**
   * Navigating away used to leave the restore running in a window nothing was
   * listening to. The route guard asks this component to stop what it is doing;
   * a restore is one of the things it is doing.
   */
  it("should stop a running restore when the route guard asks", async () => {
    wrapper = mountAnchored();
    await startAnchoredRestore(wrapper);
    respondToLastCommand({ success: true });
    await flushPromises();

    expect((wrapper.vm as any).stopActiveReplay()).toBe(true);
    expect(lastCommand()?.action).toBe("stopReplay");
  });
});
