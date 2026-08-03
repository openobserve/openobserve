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

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
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

const ConfirmDialogStub = {
  template: '<div class="confirm-dialog-stub" />',
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

  it("should emit need-extension-setup when recording without a ready extension", async () => {
    wrapper = mountJourney({ extensionReady: false });

    await wrapper.find('[data-test="synthetics-journey-record-btn"]').trigger("click");

    expect(wrapper.emitted("need-extension-setup")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();
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
