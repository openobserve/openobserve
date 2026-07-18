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

function makeDescendantHost(
  isRealTime = "true",
  defaultOverrides: Record<string, any> = {},
) {
  return defineComponent({
    components: { OForm, AlertSettings },
    setup() {
      const schema = parentSchema;
      const defaultValues = {
        trigger_condition: { silence: 10, period: 10 },
        destinations: [] as string[],
        creates_incident: false,
        ...defaultOverrides,
      };
      const formData = makeFormData();
      return { schema, defaultValues, formData, isRealTime };
    },
    template: `
      <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
        <AlertSettings
          :form-data="formData"
          :is-real-time="isRealTime"
          :destinations="[]"
          :formatted-destinations="['dest-a','dest-b']"
        />
      </OForm>
    `,
  });
}

function mountDescendant(
  isRealTime = "true",
  defaultOverrides: Record<string, any> = {},
) {
  return mount(makeDescendantHost(isRealTime, defaultOverrides), {
    global: { plugins: [makeStore(), i18n] },
  });
}

const hostForm = (host: any) =>
  (host.findComponent({ name: "OForm" }).vm as any).form;

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

    await host
      .find('[data-test="alert-settings-silence-duration-input"] input')
      .setValue("7");
    await flushPromises();

    expect(parentForm.state.values.trigger_condition.silence).toBe("7");
  });

  it("the parent handleSubmit surfaces the step's field errors", async () => {
    const host = mountDescendant("true");
    const parentForm = hostForm(host);

    await parentForm.handleSubmit();
    await flushPromises();
    await nextTick();

    expect(parentForm.state.isValid).toBe(false);
    // The destinations rule (from the composed shape) renders in the step's field.
    expect(host.text()).toContain(DESTINATIONS_REQUIRED_MESSAGE);
  });

  it("passes submit when valid — string number input coerces via the schema", async () => {
    // Rewritten from the old standalone "emits silence/period as NUMBERS" test:
    // the schema's z.coerce accepts the raw STRING the input holds; the payload
    // coercion is owned by getAlertPayload (covered by AddAlert.spec.ts).
    const host = mountDescendant("true", { destinations: ["dest-a"] });
    const parentForm = hostForm(host);

    await host
      .find('[data-test="alert-settings-silence-duration-input"] input')
      .setValue("5");
    await flushPromises();

    await parentForm.handleSubmit();
    await flushPromises();

    expect(parentForm.state.isValid).toBe(true);
    expect(parentForm.state.values.trigger_condition.silence).toBe("5");
  });

  it("blocks submit when silence is negative (schema ≥ 0)", async () => {
    const host = mountDescendant("true", { destinations: ["dest-a"] });
    const parentForm = hostForm(host);

    await host
      .find('[data-test="alert-settings-silence-duration-input"] input')
      .setValue("-1");
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
    expect(
      result.success ? [] : result.error.issues.map((i: any) => i.message),
    ).toContain(SILENCE_MESSAGE);
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
    expect(result.success ? "" : result.error.issues[0].message).toBe(
      PERIOD_MESSAGE,
    );
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
