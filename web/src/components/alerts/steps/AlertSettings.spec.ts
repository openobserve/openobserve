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

// Behavior spec for the AlertSettings step. The step is a DESCENDANT of the
// ONE AddAlert <OForm>: an ancestor form provides FORM_CONTEXT_KEY, the step's
// fields bind by nested `name=` into it, and the ancestor's composed schema
// (which reuses this step's exported rule fragments) gates the submit. The
// hosts below mirror that wiring with a schema composed from
// makeAlertSettingsShape / createAlertSettingsSchema.

import { describe, it, expect, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { createStore } from "vuex";
import { z } from "zod";
import i18n from "@/locales";
import AlertSettings from "./AlertSettings.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import {
  makeAlertSettingsShape,
  makeSilenceSchema,
  makePeriodSchema,
  createAlertSettingsSchema,
} from "./AlertSettings.schema";

// i18n-driven messages (real locale keys) — same `t` the component renders with.
const t = (key: string, named?: Record<string, unknown>): string =>
  (i18n.global.t as any)(key, named);
const DESTINATIONS_REQUIRED_MESSAGE = t("alerts.validation.destinationRequired");

// routeToCreateDestination uses vue-router — stub it so no router plugin is needed.
vi.mock("vue-router", () => ({
  useRouter: () => ({ resolve: () => ({ href: "" }) }),
}));

// AlertSettings self-fetches the workflow options on mount (enterprise/cloud
// only). Stub the service so the mount is deterministic and offline.
const listWorkflowsMock = vi.fn(async () => ({
  data: { list: [{ id: "wf-1", name: "Escalate to PagerDuty" }] },
}));
vi.mock("@/services/workflows", () => ({
  default: {
    listWorkflows: (...args: any[]) => listWorkflowsMock(...args),
  },
}));

function makeStore() {
  return createStore({
    state: {
      theme: "light",
      selectedOrganization: { identifier: "test-org" },
      zoConfig: { min_auto_refresh_interval: 60 },
    },
  });
}

function makeFormData(overrides: Record<string, any> = {}) {
  return {
    trigger_condition: {
      period: 10,
      silence: 10,
      frequency: 10,
      frequency_type: "minutes",
      cron: "",
      timezone: "",
      ...(overrides.trigger_condition || {}),
    },
    creates_incident: false,
    ...overrides,
  };
}

// ── DESCENDANT host (binds into an ancestor OForm — the app wiring) ─────────

// A parent form whose schema owns the SAME field paths the step binds to,
// composed from the exported schema shape (proving the fragments compose —
// AddAlert.schema.ts reuses the same fragments via createAlertSettingsSchema).
const parentSchema = z.object({ ...makeAlertSettingsShape(t) });

// A destinations rule the PRODUCT no longer has. Only the error CHROME is still
// product behaviour (see the [role=alert] regression below), so the spec has to
// supply its own rule to make an error exist at all.
const syntheticDestinationsRequiredSchema = z.object({
  ...makeAlertSettingsShape(t),
  destinations: z.array(z.string()).min(1, DESTINATIONS_REQUIRED_MESSAGE),
});

function makeDescendantHost(
  isRealTime = "true",
  defaultOverrides: Record<string, any> = {},
  hostSchema: z.ZodTypeAny = parentSchema,
) {
  return defineComponent({
    components: { OForm, AlertSettings },
    setup() {
      const schema = hostSchema;
      const defaultValues = {
        trigger_condition: { silence: 10, period: 10 },
        destinations: [] as string[],
        creates_incident: false,
        ...defaultOverrides,
      };
      const formData = makeFormData();
      // The step takes the SELECTED destinations as a prop, not off the form —
      // seed it from the same override the form defaults use.
      const selected = (defaultOverrides.destinations as string[]) ?? [];
      return { schema, defaultValues, formData, isRealTime, selected };
    },
    template: `
      <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
        <AlertSettings
          :form-data="formData"
          :is-real-time="isRealTime"
          :destinations="selected"
          :formatted-destinations="['dest-a','dest-b']"
        />
      </OForm>
    `,
  });
}

function mountDescendant(
  isRealTime = "true",
  defaultOverrides: Record<string, any> = {},
  hostSchema: z.ZodTypeAny = parentSchema,
) {
  return mount(makeDescendantHost(isRealTime, defaultOverrides, hostSchema), {
    global: { plugins: [makeStore(), i18n] },
  });
}

const hostForm = (host: any) => (host.findComponent({ name: "OForm" }).vm as any).form;

describe("AlertSettings — descendant (binds into ancestor OForm) mode", () => {
  it("does NOT render its own <OForm> — the fields bind into the parent", () => {
    const host = mountDescendant();
    // Exactly one OForm exists: the host's. The step rendered a plain wrapper.
    expect(host.findAllComponents({ name: "OForm" }).length).toBe(1);
    expect(host.findComponent(AlertSettings).exists()).toBe(true);
    // R3: no errors before the first submit.
    expect(host.text()).not.toContain(DESTINATIONS_REQUIRED_MESSAGE);
  });

  it("typing a step field updates the PARENT form's state", async () => {
    const host = mountDescendant("true");
    const parentForm = hostForm(host);

    await host.find('[data-test="alert-settings-silence-duration-input"] input').setValue("7");
    await flushPromises();

    expect(parentForm.state.values.trigger_condition.silence).toBe("7");
  });

  // REWRITTEN: this used to submit an empty-destinations form and read the
  // "destination required" message back out of the step. Destinations are
  // optional now, so it proves the same plumbing through the silence rule.
  it("the parent handleSubmit surfaces the step's field errors", async () => {
    const host = mountDescendant("true", { trigger_condition: { silence: "", period: 10 } });
    const parentForm = hostForm(host);

    await parentForm.handleSubmit();
    await flushPromises();
    await nextTick();

    expect(parentForm.state.isValid).toBe(false);
    expect(host.text()).toContain(t("alerts.validation.silenceNonNegative"));
  });

  it("submits with NO destinations — the alert simply notifies nobody", async () => {
    const host = mountDescendant("true");
    const parentForm = hostForm(host);

    await parentForm.handleSubmit();
    await flushPromises();
    await nextTick();

    expect(parentForm.state.isValid).toBe(true);
    expect(host.find('[data-test="alert-settings-destinations-error"]').exists()).toBe(false);
  });

  it("says so, non-blockingly, when nothing is targeted", async () => {
    const host = mountDescendant("true");
    const note = host.find('[data-test="alert-settings-destinations-note"]');

    expect(note.exists()).toBe(true);
    expect(note.text()).toBe(t("alerts.alertSettings.noDestinationNote"));
    // A note, not an error: it carries no [role=alert] for focusOnFirstError.
    expect(note.attributes("role")).toBeUndefined();
  });

  it("drops the note once a destination is chosen", () => {
    const host = mountDescendant("true", { destinations: ["dest-a"] });
    expect(host.find('[data-test="alert-settings-destinations-note"]').exists()).toBe(false);
  });

  // Regression (#13156): AlertTargetsSelect replaced the name=-bound destinations
  // select, so this error is hand-rendered — and it shipped WITHOUT role="alert".
  // AddAlert's focusOnFirstError finds the tab that owns an invalid field by
  // scanning [role="alert"] messages; without the marker, saving from the
  // Advanced tab with no destination toasted "fix the highlighted fields" but
  // never brought the Alert Rules tab forward. The cross-tab specs in
  // AddAlert.spec.ts seed a synthetic message (steps are stubbed there), so the
  // REAL markup's marker must be pinned here.
  // The rule that produced this error is gone, so the host supplies a synthetic
  // one — the error CHROME is what this pins, and it is still reachable from any
  // ancestor schema that reports on the `destinations` path.
  it("renders the destinations error as [role=alert] so focusOnFirstError can find its tab", async () => {
    const host = mountDescendant("true", {}, syntheticDestinationsRequiredSchema);
    await hostForm(host).handleSubmit();
    await flushPromises();
    await nextTick();

    const error = host.find('[data-test="alert-settings-destinations-error"]');
    expect(error.exists()).toBe(true);
    expect(error.attributes("role")).toBe("alert");
    expect(error.text()).toBe(DESTINATIONS_REQUIRED_MESSAGE);
  });

  it("passes submit when valid — string number input coerces via the schema", async () => {
    // Rewritten from the old standalone "emits silence/period as NUMBERS" test:
    // the schema's z.coerce accepts the raw STRING the input holds; the payload
    // coercion is owned by getAlertPayload (covered by AddAlert.spec.ts).
    const host = mountDescendant("true", { destinations: ["dest-a"] });
    const parentForm = hostForm(host);

    await host.find('[data-test="alert-settings-silence-duration-input"] input').setValue("5");
    await flushPromises();

    await parentForm.handleSubmit();
    await flushPromises();

    expect(parentForm.state.isValid).toBe(true);
    expect(parentForm.state.values.trigger_condition.silence).toBe("5");
  });

  it("blocks submit when silence is negative (schema ≥ 0)", async () => {
    const host = mountDescendant("true", { destinations: ["dest-a"] });
    const parentForm = hostForm(host);

    await host.find('[data-test="alert-settings-silence-duration-input"] input').setValue("-1");
    await flushPromises();

    await parentForm.handleSubmit();
    await flushPromises();

    expect(parentForm.state.isValid).toBe(false);
  });

  it("requires period >= 1 in scheduled mode (schema, not a * gate)", async () => {
    const host = mountDescendant("false", {
      destinations: ["dest-a"],
      trigger_condition: { silence: 10, period: 0 },
    });
    const parentForm = hostForm(host);

    await parentForm.handleSubmit();
    await flushPromises();
    await nextTick();

    expect(parentForm.state.isValid).toBe(false);
    expect(host.text()).toContain("Period should be greater than 0");
  });

  it("period change CASCADES: emits update:trigger with synced silence/frequency/cron", () => {
    // The pre-migration cross-step cascade (period drives frequency / cron /
    // timezone / silence). The ancestor AddAlert listens to @update:trigger and
    // writes the whole trigger_condition into the ONE form (setFieldValue), so
    // the visible silence field auto-fills.
    const host = mountDescendant("false");
    const step = host.findComponent(AlertSettings);

    (step.vm as any).handlePeriodChange("15");

    const events = step.emitted("update:trigger") as any[];
    expect(events).toBeTruthy();
    const trigger = events[events.length - 1][0];
    expect(trigger.period).toBe("15");
    expect(trigger.silence).toBe(15);
    expect(trigger.frequency).toBe(15);
    expect(typeof trigger.cron).toBe("string");
    expect(trigger.cron.length).toBeGreaterThan(0);
    expect(trigger.timezone).toBeTruthy();
  });

  it("period cleared: emits update:trigger without cascading", () => {
    const host = mountDescendant("false");
    const step = host.findComponent(AlertSettings);

    (step.vm as any).handlePeriodChange("");

    const events = step.emitted("update:trigger") as any[];
    expect(events).toBeTruthy();
    const trigger = events[events.length - 1][0];
    expect(trigger.period).toBe("");
    // No cascade on an empty/invalid period — silence keeps its prior value.
    expect(trigger.silence).toBe(10);
  });

  it("preserves every data-test (scheduled branch)", () => {
    const host = mountDescendant("false");
    for (const dt of [
      "alert-settings-period-input",
      "alert-settings-silence-duration-input",
      "alert-destinations-select",
      "alert-settings-refresh-destinations-btn",
      "create-destination-btn",
      "alert-creates-incident-toggle",
    ]) {
      expect(host.find(`[data-test="${dt}"]`).exists()).toBe(true);
    }
  });
});

// ── silence: blank must FAIL, but 0 must PASS ───────────────────────────────
// The rule is zero-safe (0 minutes of silence is legal), which is exactly why it
// cannot use `z.coerce.number()`: `Number("") === 0` would sail through
// `.min(0)`, save, and then `parseInt("")` in getAlertPayload yields NaN, which
// JSON-serialises to `null`. Pre-migration validate() rejected ""/null outright.
describe("AlertSettings.schema — silence blank-vs-zero (parseInt→null trap)", () => {
  const SILENCE_MESSAGE = t("alerts.validation.silenceNonNegative");
  const silence = makeSilenceSchema(t);

  const firstError = (result: any): string | undefined =>
    result.success ? undefined : result.error.issues[0]?.message;

  it.each([[""], [null], [undefined]])(
    "REJECTS blank silence (%o) with the exact pre-migration message",
    (value: any) => {
      const result = silence.safeParse(value);
      expect(result.success).toBe(false);
      expect(firstError(result)).toBe(SILENCE_MESSAGE);
    },
  );

  it("ACCEPTS silence 0 (zero cooldown is valid — must not be caught as blank)", () => {
    const result = silence.safeParse(0);
    expect(result.success).toBe(true);
    expect(result.data).toBe(0);
  });

  it("REJECTS a negative silence with the same message", () => {
    const result = silence.safeParse(-1);
    expect(result.success).toBe(false);
    expect(firstError(result)).toBe(SILENCE_MESSAGE);
  });

  it("ACCEPTS the STRING '5' from OFormInput and yields the NUMBER 5", () => {
    const result = silence.safeParse("5");
    expect(result.success).toBe(true);
    expect(result.data).toBe(5);
    expect(typeof result.data).toBe("number");
  });

  it("REJECTS a non-numeric silence", () => {
    expect(silence.safeParse("abc").success).toBe(false);
  });

  it("blocks a whole-form submit when silence is blank (composed rule)", () => {
    const schema = createAlertSettingsSchema(t, false);
    const result = schema.safeParse({
      trigger_condition: { silence: "", period: 10 },
      destinations: ["email"],
      creates_incident: false,
    });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((i: any) => i.message)).toContain(
      SILENCE_MESSAGE,
    );
  });
});

// Guard: the silence fix must NOT have changed period. Period keeps
// z.coerce.number().min(1) — "" coerces to 0 which already fails .min(1), so the
// blank case is accidentally but genuinely covered. Pinned so a future
// "consistency" refactor cannot silently loosen it.
describe("AlertSettings.schema — period rules unchanged by the silence fix", () => {
  const PERIOD_MESSAGE = t("alerts.validation.periodPositive");
  const period = makePeriodSchema(t);

  it.each([[""], [0], [-1]])("REJECTS period %o", (value: any) => {
    const result = period.safeParse(value);
    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.issues[0].message).toBe(PERIOD_MESSAGE);
  });

  it("ACCEPTS period 1 and the string '10'", () => {
    expect(period.safeParse(1).success).toBe(true);
    expect(period.safeParse("10").success).toBe(true);
  });

  it("leaves the realtime period branch unconstrained (deliberate — Rule ④)", () => {
    // Realtime does not render the period input, so it must not gain a min rule.
    const realtime = createAlertSettingsSchema(t, true);
    const result = realtime.safeParse({
      trigger_condition: { silence: 10, period: 0 },
      destinations: ["email"],
      creates_incident: false,
    });
    expect(result.success).toBe(true);
  });
});

// ── destinations / workflows are OPTIONAL ────────────────────────────────────
// INVERTED, not deleted. This block used to pin "destinations >= 1" (OSS) and
// "at least ONE of destinations | workflows" (enterprise/cloud). The backend now
// accepts an alert with no delivery target at all — it evaluates and records its
// firing history and notifies nobody — so the schema must not block the save.
// The cases below are the same matrix, with the outcomes flipped where the rule
// used to reject; the ACCEPTS cases are kept verbatim so the relaxation cannot
// quietly break a combination that already worked.
describe("AlertSettings.schema — destinations and workflows are optional", () => {
  const DEST_ONLY = t("alerts.validation.destinationRequired");
  const EITHER = t("alerts.destinationOrWorkflowRequired");
  const base = {
    trigger_condition: { silence: 10, period: 10 },
    creates_incident: false,
  };
  const messages = (r: any): string[] =>
    r.success ? [] : r.error.issues.map((i: any) => i.message);

  describe("OSS", () => {
    const schema = createAlertSettingsSchema(t, false);

    it("ACCEPTS empty destinations, with no requiredness message", () => {
      const r = schema.safeParse({ ...base, destinations: [] });
      expect(r.success).toBe(true);
      expect(messages(r)).not.toContain(DEST_ONLY);
    });

    it("ACCEPTS empty destinations even with a stray workflow value", () => {
      // OSS has no workflows feature; the stray value is neither required nor
      // rejected — nothing about delivery blocks the parse any more.
      const r = schema.safeParse({
        ...base,
        destinations: [],
        workflows: ["wf-1"],
      });
      expect(r.success).toBe(true);
    });

    it("ACCEPTS a destination", () => {
      expect(schema.safeParse({ ...base, destinations: ["email"] }).success).toBe(true);
    });

    it("still REJECTS a malformed destinations value", () => {
      // Optional is not "anything goes": the field is still a string array.
      expect(schema.safeParse({ ...base, destinations: "email" }).success).toBe(false);
    });
  });

  describe("enterprise/cloud", () => {
    const schema = createAlertSettingsSchema(t, false);

    it("ACCEPTS a destination and no workflow", () => {
      const r = schema.safeParse({
        ...base,
        destinations: ["email"],
        workflows: [],
      });
      expect(r.success).toBe(true);
    });

    it("ACCEPTS a workflow and NO destination", () => {
      const r = schema.safeParse({
        ...base,
        destinations: [],
        workflows: ["wf-1"],
      });
      expect(r.success).toBe(true);
    });

    it("ACCEPTS both", () => {
      const r = schema.safeParse({
        ...base,
        destinations: ["email"],
        workflows: ["wf-1"],
      });
      expect(r.success).toBe(true);
    });

    it("ACCEPTS neither, with no combined-requiredness message", () => {
      const r = schema.safeParse({ ...base, destinations: [], workflows: [] });
      expect(r.success).toBe(true);
      expect(messages(r)).not.toContain(EITHER);
    });

    it("ACCEPTS both keys being absent entirely", () => {
      expect(schema.safeParse({ ...base }).success).toBe(true);
    });
  });
});

// ── Workflows target wiring (enterprise/cloud) ───────────────────────────────
// The zod migration replaced the destinations control with a name=-bound
// OFormSelect; this branch replaces it again with AlertTargetsSelect, ONE control
// covering destinations + workflows. Because one control writes TWO form fields
// it cannot be name=-bound, so it is props-in / events-out and the ancestor
// AddAlert does the setFieldValue. These pin that wiring — it is exactly what the
// merge had to reconstruct on top of main's rewrite.
describe("AlertSettings — combined destinations + workflows target control", () => {
  const findTargets = (host: any) => host.findComponent({ name: "AlertTargetsSelect" });

  it("renders AlertTargetsSelect instead of a name=-bound destinations select", () => {
    const host = mountDescendant();
    expect(findTargets(host).exists()).toBe(true);
    // The old control is gone — if it came back, both would write `destinations`.
    expect(host.findAll('[data-test="alert-destinations-select"]').length).toBeGreaterThan(0);
  });

  it("keeps the original data-test hooks (e2e contract)", () => {
    const host = mountDescendant();
    expect(host.find('[data-test="alert-destinations-select"]').exists()).toBe(true);
    expect(host.find('[data-test="alert-settings-refresh-destinations-btn"]').exists()).toBe(true);
    expect(host.find('[data-test="create-destination-btn"]').exists()).toBe(true);
  });

  it("forwards the destinations + workflows props down to the control", () => {
    const host = mountDescendant();
    const targets = findTargets(host);
    expect(targets.props("destinations")).toEqual([]);
    expect(targets.props("workflows")).toEqual([]);
    expect(targets.props("destinationOptions")).toEqual(["dest-a", "dest-b"]);
  });

  it("re-emits the child's update:workflows so the ancestor can setFieldValue", async () => {
    const host = mountDescendant();
    const step = host.findComponent(AlertSettings);

    await findTargets(host).vm.$emit("update:workflows", ["wf-1"]);
    await nextTick();

    // The step does NOT write the form itself — it bubbles, matching how
    // destinations already worked (AddAlert owns the single write).
    expect(step.emitted("update:workflows")).toBeTruthy();
    expect(step.emitted("update:workflows")![0]).toEqual([["wf-1"]]);
  });

  it("re-emits update:destinations from the same control", async () => {
    const host = mountDescendant();
    const step = host.findComponent(AlertSettings);

    await findTargets(host).vm.$emit("update:destinations", ["dest-a"]);
    await nextTick();

    expect(step.emitted("update:destinations")![0]).toEqual([["dest-a"]]);
  });

  it("refresh reloads BOTH lists — bubbles refresh:destinations and refetches workflows", async () => {
    const host = mountDescendant();
    const step = host.findComponent(AlertSettings);
    listWorkflowsMock.mockClear();

    await findTargets(host).vm.$emit("refresh");
    await flushPromises();

    expect(step.emitted("refresh:destinations")).toBeTruthy();
    if (findTargets(host).props("workflowsEnabled") as boolean) {
      expect(listWorkflowsMock).toHaveBeenCalled();
    }
  });

  it("still renders a destinations validation error under the control", async () => {
    // The control is no longer an OForm* wrapper, so the schema error has no
    // renderer of its own — the step surfaces it via fieldError("destinations").
    // The product schema no longer produces one, so the host supplies the rule.
    const host = mountDescendant("true", {}, syntheticDestinationsRequiredSchema);
    const parentForm = hostForm(host);

    await parentForm.handleSubmit();
    await flushPromises();
    await nextTick();

    expect(host.text()).toContain(DESTINATIONS_REQUIRED_MESSAGE);
  });

  it("renders the non-blocking note under the control when nothing is targeted", () => {
    const host = mountDescendant("true");
    expect(host.find('[data-test="alert-settings-destinations-note"]').text()).toBe(
      t("alerts.alertSettings.noDestinationNote"),
    );
  });
});
