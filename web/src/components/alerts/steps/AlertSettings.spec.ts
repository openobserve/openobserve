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

import { describe, it, expect, vi, afterEach } from "vitest";
import { mount, flushPromises, type VueWrapper } from "@vue/test-utils";
import { defineComponent, inject, nextTick, ref, type Ref } from "vue";
import { createStore } from "vuex";
import { z } from "zod";
import i18n from "@/locales";
import config from "@/aws-exports";
import AlertSettings from "./AlertSettings.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { AlertSettingId } from "@/components/alerts/alertSettingTiers";
import type { AlertSuggestionId } from "@/components/alerts/alertSuggestions";
import {
  ALERT_SETTING_TIERS_KEY,
  useAlertSettingTiers,
} from "@/composables/alerts/useAlertSettingTiers";
import { ALERT_SUGGESTIONS_KEY } from "@/composables/alerts/useAlertSuggestions";
import { durationWords, everyWords, joinList } from "@/utils/alerts/alertCopy";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import {
  makeAlertSettingsShape,
  makeSilenceSchema,
  makePeriodSchema,
  createAlertSettingsSchema,
} from "./AlertSettings.schema";

// i18n-driven messages (real locale keys) — same `t` the component renders with.
const t = (key: string, named?: Record<string, unknown>): string =>
  (i18n.global.t as any)(key, named);
const SILENCE_REQUIRED_MESSAGE = t("alerts.validation.silenceNonNegative");
const NO_DESTINATION_NOTE = t("alerts.alertSettings.noDestinationNote");

// routeToCreateDestination uses vue-router — stub it so no router plugin is needed.
vi.mock("vue-router", () => ({
  useRouter: () => ({ resolve: () => ({ href: "" }) }),
}));

// AlertSettings self-fetches the workflow options on mount (enterprise/cloud
// only). Stub the service so the mount is deterministic and offline.
const listWorkflowsMock = vi.fn(async () => ({
  data: { list: [{ id: "wf-1", name: "Escalate to PagerDuty" }] },
}));
vi.mock("@/services/workflows", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      listWorkflows: (...args: any[]) => listWorkflowsMock(...args),
    },
  });
});

function makeStore(zoConfig: Record<string, any> = {}) {
  return createStore({
    state: {
      theme: "light",
      selectedOrganization: { identifier: "test-org" },
      zoConfig: { min_auto_refresh_interval: 60, ...zoConfig },
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
  formDataOverrides: Record<string, any> = {},
  destinations: string[] = [],
  validateOn: "submit" | "leave" = "submit",
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
      const formData = makeFormData(formDataOverrides);
      return { schema, defaultValues, formData, isRealTime, destinations, validateOn };
    },
    template: `
      <OForm :validate-on="validateOn" :schema="schema" :default-values="defaultValues" @submit="() => {}">
        <AlertSettings
          :form-data="formData"
          :is-real-time="isRealTime"
          :destinations="destinations"
          :formatted-destinations="['dest-a','dest-b']"
        />
      </OForm>
    `,
  });
}

function mountDescendant(
  isRealTime = "true",
  defaultOverrides: Record<string, any> = {},
  formDataOverrides: Record<string, any> = {},
) {
  return mount(makeDescendantHost(isRealTime, defaultOverrides, formDataOverrides), {
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
    expect(host.find('[role="alert"]').exists()).toBe(false);
  });

  it("typing a step field updates the PARENT form's state", async () => {
    const host = mountDescendant("true");
    const parentForm = hostForm(host);

    await host.find('[data-test="alert-settings-silence-duration-input"] input').setValue("7");
    await flushPromises();

    expect(parentForm.state.values.trigger_condition.silence).toBe(7);
  });

  it("the parent handleSubmit surfaces the step's field errors", async () => {
    const host = mountDescendant("true", { trigger_condition: { silence: "", period: 10 } });
    const parentForm = hostForm(host);

    await parentForm.handleSubmit();
    await flushPromises();
    await nextTick();

    expect(parentForm.state.isValid).toBe(false);
    // The silence rule (from the composed shape) renders in the step's field.
    expect(host.text()).toContain(SILENCE_REQUIRED_MESSAGE);
  });

  it("submits with no destination and says no destination is notified", async () => {
    const host = mountDescendant("true");
    const parentForm = hostForm(host);

    await parentForm.handleSubmit();
    await flushPromises();
    await nextTick();

    expect(parentForm.state.isValid).toBe(true);
    expect(host.find('[data-test="alert-settings-destinations-error"]').exists()).toBe(false);
    expect(host.find('[data-test="alert-settings-destinations-note"]').text()).toContain(
      NO_DESTINATION_NOTE,
    );
  });

  it.each([
    ["an on-call team is set", "sre", false],
    ["the on-call team is blank", "  ", true],
  ])("shows the no-destination note only when needed: %s", (_case, team, shown) => {
    // On-call teams only page in enterprise and cloud builds.
    const isEnterprise = config.isEnterprise;
    config.isEnterprise = "true";
    try {
      const host = mountDescendant("true", {}, { oncall_team: team });
      expect(host.find('[data-test="alert-settings-destinations-note"]').exists()).toBe(shown);
    } finally {
      config.isEnterprise = isEnterprise;
    }
  });

  it("passes submit when valid — the remind row stores a number", async () => {
    const host = mountDescendant("true", { destinations: ["dest-a"] });
    const parentForm = hostForm(host);

    await host.find('[data-test="alert-settings-silence-duration-input"] input').setValue("5");
    await flushPromises();

    await parentForm.handleSubmit();
    await flushPromises();

    expect(parentForm.state.isValid).toBe(true);
    expect(parentForm.state.values.trigger_condition.silence).toBe(5);
  });

  it.each([
    ["look-back", "alert-settings-period-input", "alert-settings-period-error", "0", "5"],
    ["remind", "alert-settings-silence-duration-input", "alert-settings-silence-error", "-1", "5"],
    [
      "must last",
      "alert-settings-pending-period-input",
      "alert-settings-pending-period-error",
      "-1",
      "2",
    ],
    [
      "keep firing",
      "alert-settings-keep-firing-for-input",
      "alert-settings-keep-firing-error",
      "-1",
      "5",
    ],
  ])(
    "the %s field shows its error once left, then clears when fixed",
    async (_, inputId, errorId, bad, good) => {
      const host = mount(makeDescendantHost("false", {}, {}, [], "leave"), {
        global: { plugins: [makeStore(), i18n] },
      });
      const input = () => host.find(`[data-test="${inputId}"] input`);
      const error = () => host.find(`[data-test="${errorId}"]`);
      await input().setValue(bad);
      await new Promise((resolve) => setTimeout(resolve, 350));
      await flushPromises();
      expect(error().exists()).toBe(false);
      await input().trigger("blur");
      await vi.waitFor(() => expect(error().exists()).toBe(true));
      await input().setValue(good);
      await vi.waitFor(() => expect(error().exists()).toBe(false), { timeout: 1500 });
    },
  );

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
    expect(host.text()).toContain("Look back must be at least 1 minute.");
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

  describe("period cascade keeps user-set Check every / Quiet after alerting", () => {
    type TriggerValues = Record<string, unknown>;
    interface LiveForm {
      useStore: <T>(
        selector: (state: { values: { trigger_condition: TriggerValues } }) => T,
      ) => Ref<T>;
      setFieldValue: (name: string, value: unknown) => void;
      state: { values: { trigger_condition: TriggerValues } };
    }

    // Wires the step like AddAlert: formData is the live form read-view and update:trigger writes back into the form.
    const LiveStep = defineComponent({
      components: { AlertSettings },
      setup() {
        const form = inject(FORM_CONTEXT_KEY) as LiveForm;
        const formData = form.useStore((state) => state.values);
        const onTrigger = (trigger: TriggerValues) =>
          form.setFieldValue("trigger_condition", trigger);
        return { formData, onTrigger };
      },
      template: `
        <AlertSettings
          :form-data="formData"
          is-real-time="false"
          :destinations="[]"
          :formatted-destinations="[]"
          @update:trigger="onTrigger"
        />
      `,
    });

    const defaults = { period: 10, frequency: 10, silence: 10, frequency_type: "minutes" };

    const mountLive = (trigger: TriggerValues = defaults, minAutoRefreshInterval = 60) =>
      mount(
        defineComponent({
          components: { OForm, LiveStep },
          setup: () => ({
            schema: parentSchema,
            defaultValues: { trigger_condition: { ...trigger }, destinations: [] },
          }),
          template: `
            <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
              <LiveStep />
            </OForm>
          `,
        }),
        {
          global: {
            plugins: [makeStore({ min_auto_refresh_interval: minAutoRefreshInterval }), i18n],
          },
        },
      );

    const liveForm = (host: VueWrapper) =>
      (host.findComponent({ name: "OForm" }).vm as unknown as { form: LiveForm }).form;

    // Loads values after mount, the way an edit fetch, prefill or JSON editor re-seeds the form.
    const loadTrigger = async (host: VueWrapper, trigger: TriggerValues) => {
      liveForm(host).setFieldValue("trigger_condition", { ...trigger });
      await flushPromises();
    };

    const typePeriod = async (host: VueWrapper, value: string) => {
      await host.find('[data-test="alert-settings-period-input"] input').setValue(value);
      // The period input debounces its update by 300ms.
      await new Promise((resolve) => setTimeout(resolve, 350));
      await flushPromises();
      return liveForm(host).state.values.trigger_condition;
    };

    const saved = { period: 15, frequency: 5, silence: 30, frequency_type: "minutes" };

    it("editing a saved alert (5/15/30) loaded after mount: changing only the period keeps frequency and silence", async () => {
      const host = mountLive();
      await loadTrigger(host, saved);

      const trigger = await typePeriod(host, "20");

      expect(trigger).toMatchObject({ period: "20", frequency: 5, silence: 30 });
    });

    it("keeps a hand-written cron schedule when only the period changes", async () => {
      const host = mountLive();
      await loadTrigger(host, {
        ...saved,
        frequency_type: "cron",
        cron: "0 9 * * *",
        timezone: "UTC",
      });

      const trigger = await typePeriod(host, "20");

      expect(trigger.period).toBe("20");
      expect(trigger.cron).toBe("0 9 * * *");
    });

    it("new alert defaults (10/10/10): frequency and silence follow the period, across keystrokes", async () => {
      const host = mountLive();

      await typePeriod(host, "3");
      const trigger = await typePeriod(host, "30");

      expect(trigger).toMatchObject({ frequency: 30, silence: 30 });
    });

    it("a default frequency raised to the refresh floor still follows the period", async () => {
      const host = mountLive({ ...defaults, frequency: 30 }, 1800);

      const trigger = await typePeriod(host, "60");

      expect(trigger).toMatchObject({ frequency: 60, silence: 60 });
    });

    it("Check every set first (5), then period 20: frequency stays 5, default silence follows", async () => {
      const host = mountLive();
      liveForm(host).setFieldValue("trigger_condition.frequency", 5);

      const trigger = await typePeriod(host, "20");

      expect(trigger).toMatchObject({ frequency: 5, silence: 20 });
    });

    it("Quiet after alerting changed by the user stops following later period edits", async () => {
      const host = mountLive();

      await typePeriod(host, "20");
      liveForm(host).setFieldValue("trigger_condition.silence", 45);
      const trigger = await typePeriod(host, "25");

      expect(trigger).toMatchObject({ frequency: 25, silence: 45 });
    });

    it("a form mounted without a period still links frequency and silence to the first one typed", async () => {
      const host = mountLive({ frequency: 10, silence: 10, frequency_type: "minutes" });

      const trigger = await typePeriod(host, "20");

      expect(trigger).toMatchObject({ frequency: 20, silence: 20 });
    });

    const note = (host: VueWrapper, dataTest: string) => host.find(`[data-test="${dataTest}"]`);
    const click = async (host: VueWrapper, dataTest: string) => {
      await note(host, `${dataTest}-action`).trigger("click");
      await flushPromises();
      return liveForm(host).state.values.trigger_condition;
    };
    const follows = (minutes: number) =>
      t("alerts.form.link.follows", { duration: durationWords(minutes, i18n.global.t as any) });
    const alsoSet = (fields: string[], minutes: number) =>
      t("alerts.form.link.alsoSet", {
        fields: joinList(fields.map((key) => t(key))),
        duration: durationWords(minutes, i18n.global.t as any),
      });

    it("a look-back edit that moves linked settings says so, and Undo puts them back", async () => {
      const host = mountLive();
      expect(note(host, "alert-settings-silence-link-text").text()).toBe(follows(10));

      await typePeriod(host, "5");
      expect(note(host, "alert-settings-check-every-link-text").text()).toBe(
        alsoSet(["alerts.queryConfig.checkEvery", "alerts.form.remind.label"], 5),
      );
      expect(note(host, "alert-settings-silence-link-text").text()).toBe(follows(5));

      const trigger = await click(host, "alert-settings-check-every-link");
      expect(trigger).toMatchObject({ period: "5", frequency: 10, silence: 10 });
      expect(note(host, "alert-settings-silence-link").text()).toBe(t("alerts.form.link.relink"));
    });

    it("Unlink keeps Notify at most every through look-back edits; Follow Look back re-links it", async () => {
      const host = mountLive();
      await click(host, "alert-settings-silence-link");

      const trigger = await typePeriod(host, "20");
      expect(trigger).toMatchObject({ frequency: 20, silence: 10 });
      expect(note(host, "alert-settings-check-every-link-text").text()).toBe(
        alsoSet(["alerts.queryConfig.checkEvery"], 20),
      );

      expect(await click(host, "alert-settings-silence-link")).toMatchObject({ silence: 20 });
    });

    it("a form re-seeded without remount re-links fields that match its new period", async () => {
      const host = mountLive();
      await typePeriod(host, "20");
      await loadTrigger(host, {
        period: 15,
        frequency: 15,
        silence: 15,
        frequency_type: "minutes",
      });

      const trigger = await typePeriod(host, "40");

      expect(trigger).toMatchObject({ frequency: 40, silence: 40 });
    });
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

  it("hides the period in Forecast mode, whose query reads its own history window", async () => {
    const host = mountDescendant("false", {
      _ui: { forecast: { U: "up", T: 1, direction: "rises", W: "2d", H: 7 } },
    });
    expect(host.find('[data-test="alert-settings-period-input"]').exists()).toBe(false);
    hostForm(host).setFieldValue("_ui.forecast", null);
    await flushPromises();
    expect(host.find('[data-test="alert-settings-period-input"]').exists()).toBe(true);
  });

  it("marks the look-back as required, as before", () => {
    expect(mountDescendant("false").text()).toContain(
      `${t("alerts.form.schedule.lookingAtRow")} *`,
    );
  });

  it("preserves every data-test (scheduled branch)", () => {
    const host = mountDescendant("false");
    for (const dt of [
      "alert-settings-period-input",
      "alert-settings-silence-duration-input",
      "alert-destinations-select",
      "alert-settings-refresh-destinations-btn",
      "create-destination-btn",
    ]) {
      expect(host.find(`[data-test="${dt}"]`).exists()).toBe(true);
    }
  });
});

// ── Creates Incident: enterprise/cloud + incidents_enabled only ─────────────
// Incidents is an enterprise feature: the OSS backend always reports
// `incidents_enabled: false`, and the enterprise one only correlates when it
// is on. The toggle follows the same gate as the Incidents menu.
// A recovery closes what a firing delivered, so with nowhere to send there is nothing to recover.
describe("AlertSettings — Notify on recovery with nowhere to send", () => {
  const SWITCH = '[data-test="alert-notify-on-recovery-toggle-btn"]';
  const mountScheduled = (recoveryOn: boolean, destinations: string[] = []) =>
    mount(
      makeDescendantHost(
        "false",
        { notify_on_recovery: recoveryOn },
        { notify_on_recovery: recoveryOn },
        destinations,
      ),
      { global: { plugins: [makeStore(), i18n] } },
    );
  const recoveryFieldShown = (host: any) =>
    host
      .findAllComponents({ name: "AlertDestinationsField" })
      .some(
        (field: any) => field.props("label") === t("alerts.alertSettings.recoveryDestinations"),
      );

  it("cannot be turned on without a destination", () => {
    expect(mountScheduled(false).find(SWITCH).attributes("disabled")).toBeDefined();
  });

  // Left on from before, it must stay switchable so the user can clear it.
  it("can still be turned off, but hides what it would send", () => {
    const host = mountScheduled(true);
    expect(host.find(SWITCH).attributes("disabled")).toBeUndefined();
    expect(host.find('[data-test^="alert-notify-on-recovery-plan-"]').exists()).toBe(false);
    expect(recoveryFieldShown(host)).toBe(false);
  });

  it("works as before once a destination is picked", () => {
    const host = mountScheduled(true, ["dest-a"]);
    expect(host.find(SWITCH).attributes("disabled")).toBeUndefined();
    expect(host.find('[data-test="alert-notify-on-recovery-plan-dest-a"]').exists()).toBe(true);
    expect(recoveryFieldShown(host)).toBe(true);
  });
});

// Jira keeps one ticket per alert, so its recovery is a comment there, not a new message.
describe("AlertSettings — Notify on recovery summary for Jira", () => {
  const destinationObjects = [
    { name: "ops-jira", type: "http", destination_type_name: "jira" },
    { name: "ops-slack", type: "http", destination_type_name: "slack" },
  ];
  const mountPlan = (destinations: string[], recoveryDestinations: string[] = []) =>
    mount(
      defineComponent({
        components: { OForm, AlertSettings },
        setup: () => ({
          schema: parentSchema,
          defaultValues: { trigger_condition: { silence: 10, period: 10 }, destinations },
          formData: makeFormData({ notify_on_recovery: true }),
          destinations,
          destinationObjects,
          recoveryDestinations,
        }),
        template: `
          <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
            <AlertSettings
              :form-data="formData"
              is-real-time="false"
              :destinations="destinations"
              :destination-objects="destinationObjects"
              :recovery-destinations="recoveryDestinations"
            />
          </OForm>
        `,
      }),
      { global: { plugins: [makeStore(), i18n] } },
    );
  const planText = (destinations: string[], recoveryDestinations: string[] = []) =>
    mountPlan(destinations, recoveryDestinations)
      .findAll('[data-test^="alert-notify-on-recovery-plan-"]')
      .map((row) => row.text());
  const comment = t("alerts.alertSettings.recoveryJiraComment");
  const message = t("alerts.alertSettings.recoveryChatMessage");

  it("says a Jira destination comments on the open ticket", () => {
    expect(comment).toBe("comment on the open ticket");
    expect(planText(["ops-jira", "ops-slack"])).toEqual([
      `ops-jira — ${comment}`,
      `ops-slack — ${message}`,
    ]);
  });

  it("says the same when the recovery is redirected to Jira", () => {
    expect(planText(["ops-slack"], ["ops-jira"])).toEqual([`ops-jira — ${comment}`]);
  });

  it("shows the template hint only when a destination renders the template", () => {
    const hint = '[data-test="alert-notify-on-recovery-hint"]';
    expect(mountPlan(["ops-jira"]).find(hint).exists()).toBe(false);
    expect(mountPlan(["ops-slack"], ["ops-jira"]).find(hint).exists()).toBe(false);
    expect(mountPlan(["ops-jira", "ops-slack"]).find(hint).exists()).toBe(true);
  });
});

describe("AlertSettings — Creates Incident toggle visibility", () => {
  const original = { isEnterprise: config.isEnterprise, isCloud: config.isCloud };
  afterEach(() => {
    config.isEnterprise = original.isEnterprise;
    config.isCloud = original.isCloud;
  });

  it.each([
    ["hidden in OSS with the flag off", "false", "false", false, false],
    ["hidden in OSS even with the flag on", "false", "false", true, false],
    ["hidden in enterprise with Incidents disabled", "true", "false", false, false],
    ["hidden in enterprise before /config loads", "true", "false", undefined, false],
    ["shown in enterprise with Incidents enabled", "true", "false", true, true],
    ["shown in cloud with Incidents enabled", "false", "true", true, true],
  ])("%s", (_label, isEnterprise, isCloud, incidentsEnabled, visible) => {
    config.isEnterprise = isEnterprise;
    config.isCloud = isCloud;
    const host = mount(makeDescendantHost("false"), {
      global: { plugins: [makeStore({ incidents_enabled: incidentsEnabled }), i18n] },
    });
    expect(host.find('[data-test="alert-creates-incident-toggle"]').exists()).toBe(visible);
  });

  it("appears once /config reports incidents enabled", async () => {
    config.isEnterprise = "true";
    const store = makeStore();
    const host = mount(makeDescendantHost("true"), { global: { plugins: [store, i18n] } });
    expect(host.find('[data-test="alert-creates-incident-toggle"]').exists()).toBe(false);

    store.state.zoConfig.incidents_enabled = true;
    await nextTick();
    expect(host.find('[data-test="alert-creates-incident-toggle"]').exists()).toBe(true);
  });
});

describe("AlertSettings — incident title preview", () => {
  const original = config.isEnterprise;
  afterEach(() => {
    config.isEnterprise = original;
  });

  it("fills alert fields and keeps row placeholders as chips", async () => {
    config.isEnterprise = "true";
    const host = mount(
      defineComponent({
        components: { OForm, AlertSettings },
        setup: () => ({
          schema: parentSchema,
          defaultValues: {
            trigger_condition: { silence: 10, period: 10 },
            destinations: [] as string[],
            creates_incident: true,
          },
          formData: makeFormData({
            creates_incident: true,
            name: "HighErrors",
            incident_title_template: "{alert_name}: {service} on {host}",
          }),
        }),
        template: `
          <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
            <AlertSettings :form-data="formData" is-real-time="false" :destinations="[]" />
          </OForm>
        `,
      }),
      { global: { plugins: [makeStore({ incidents_enabled: true }), i18n] } },
    );
    await host.find('[data-test="add-alert-incident-title-row-change"]').trigger("click");
    expect(host.find('[data-test="alert-incident-title-preview"]').text()).toContain(
      "HighErrors: {service} on {host}",
    );
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

// ── Destinations are optional: the field notes that no destination is notified instead of erroring ──
describe("AlertSettings.schema — destinations are optional", () => {
  const schema = createAlertSettingsSchema(t, false);
  const base = {
    trigger_condition: { silence: 10, period: 10 },
    creates_incident: false,
  };

  it.each([
    ["no destination and no workflow", { destinations: [], workflows: [] }],
    ["both keys absent", {}],
    ["a destination", { destinations: ["email"] }],
    ["a workflow and no destination", { destinations: [], workflows: ["wf-1"] }],
  ])("ACCEPTS %s", (_case, targets) => {
    expect(schema.safeParse({ ...base, ...targets }).success).toBe(true);
  });

  it("still REJECTS a destination list that is not an array", () => {
    expect(schema.safeParse({ ...base, destinations: "email" }).success).toBe(false);
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

  it("describes each destination to the picker from the org's destination objects", () => {
    const host = mount(
      defineComponent({
        components: { OForm, AlertSettings },
        setup: () => ({ schema: parentSchema, formData: makeFormData() }),
        template: `
          <OForm :schema="schema" :default-values="{ trigger_condition: { silence: 10, period: 10 } }">
            <AlertSettings :form-data="formData" is-real-time="false" :formatted-destinations="['ops']"
              :destination-objects="[{ name: 'ops', type: 'http', url: 'https://hooks.example.com/x' }]" />
          </OForm>
        `,
      }),
      { global: { plugins: [makeStore(), i18n] } },
    );
    expect(findTargets(host).props("describe")).toEqual({
      ops: { type: t("components.badge.destinationType.webhook"), target: "hooks.example.com" },
    });
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

  it("shows the no-destination note under the control before any submit", () => {
    const host = mountDescendant("true");
    expect(host.text()).toContain(NO_DESTINATION_NOTE);
  });
});

// ── Sectioned editor: tiers, sentence rows and units (phase 1) ───────────────
describe("AlertSettings — notify and timing in their sections", () => {
  const original = { isEnterprise: config.isEnterprise };
  afterEach(() => {
    config.isEnterprise = original.isEnterprise;
    document.body.innerHTML = "";
  });

  const SLOTS = ["settingsNotify", "settingsNotifyMore", "settingsSchedule", "settingsHold"];
  function mountSectioned(
    isRealTime: string,
    defaults: Record<string, any> = {},
    opts: { reveal?: AlertSettingId[]; showAll?: boolean; destinations?: string[] } = {},
  ) {
    const targets = Object.fromEntries(
      SLOTS.map((slot) => [slot, document.body.appendChild(document.createElement("div"))]),
    );
    const tiers = useAlertSettingTiers({
      available: () => true,
      isSet: () => false,
      showAll: ref(opts.showAll ?? false),
    });
    (opts.reveal ?? []).forEach(tiers.reveal);
    const applied: Partial<Record<AlertSuggestionId, () => void>> = {};
    const suggestions = {
      current: () => null,
      add: vi.fn(),
      notNow: vi.fn(),
      onApply: (id: AlertSuggestionId, handler: () => void) => {
        applied[id] = handler;
        return () => {};
      },
    };
    const host = mount(
      defineComponent({
        components: { OForm, AlertSettings },
        setup: () => ({
          schema: parentSchema,
          defaultValues: {
            trigger_condition: { silence: 10, period: 10, frequency: 5, frequency_type: "minutes" },
            destinations: opts.destinations ?? [],
            creates_incident: false,
            ...defaults,
          },
          targets,
          isRealTime,
          destinations: opts.destinations ?? [],
        }),
        template: `
          <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
            <AlertSettings :form-data="defaultValues" :is-real-time="isRealTime"
              :destinations="destinations" :section-targets="targets" />
          </OForm>
        `,
      }),
      {
        attachTo: document.body,
        global: {
          plugins: [makeStore({ incidents_enabled: true }), i18n],
          provide: {
            [ALERT_SETTING_TIERS_KEY as symbol]: tiers,
            [ALERT_SUGGESTIONS_KEY as symbol]: suggestions,
          },
        },
      },
    );
    const values = () => hostForm(host).state.values;
    const inSlot = (slot: string, dataTest: string) =>
      !!targets[slot].querySelector(`[data-test="${dataTest}"]`);
    return { host, tiers, applied, values, inSlot, targets };
  }
  const unitSelect = (host: VueWrapper, dataTest: string) =>
    host.findAllComponents(OSelect).find((s) => s.attributes("data-test") === dataTest)!;
  const amountInput = (host: VueWrapper, dataTest: string) =>
    host.findAllComponents(OInput).find((i) => i.attributes("data-test") === dataTest)!;

  it.each(["false", "true", "composite"])(
    "Remind at most every is in Who to tell (is_real_time %s)",
    (kind) => {
      const { inSlot } = mountSectioned(kind);
      expect(inSlot("settingsNotify", "alert-settings-silence-duration-input")).toBe(true);
      expect(inSlot("settingsSchedule", "alert-settings-silence-duration-input")).toBe(false);
    },
  );

  it.each([
    [90, "90", "min"],
    [240, "4", "h"],
  ])(
    "an untouched remind row shows silence %d as %s %s and writes nothing",
    (silence, amount, unit) => {
      const { host, values } = mountSectioned("true", {
        trigger_condition: { silence, period: 10, frequency: 5 },
      });
      expect(amountInput(host, "alert-settings-silence-duration-input").props("modelValue")).toBe(
        Number(amount),
      );
      expect(unitSelect(host, "alert-settings-silence-unit-select").props("modelValue")).toBe(unit);
      expect(values().trigger_condition.silence).toBe(silence);
      expect(host.findComponent(AlertSettings).emitted("update:trigger")).toBeUndefined();
    },
  );

  it("4 h saves silence 240", async () => {
    const { host, values } = mountSectioned("true");
    await unitSelect(host, "alert-settings-silence-unit-select").vm.$emit("update:modelValue", "h");
    await amountInput(host, "alert-settings-silence-duration-input").vm.$emit(
      "update:modelValue",
      "4",
    );
    expect(values().trigger_condition.silence).toBe(240);
  });

  it("keep firing 90 s shows 90 seconds and 2 min saves 120", async () => {
    const { host, values } = mountSectioned(
      "false",
      { keep_firing_for: 90 },
      { reveal: ["keepFiring"] },
    );
    const input = () => amountInput(host, "alert-settings-keep-firing-for-input");
    const unit = () => unitSelect(host, "alert-settings-keep-firing-unit-select");
    expect([input().props("modelValue"), unit().props("modelValue")]).toEqual([90, "seconds"]);
    await unit().vm.$emit("update:modelValue", "min");
    expect(values().keep_firing_for).toBe(90);
    await input().vm.$emit("update:modelValue", "2");
    expect(values().keep_firing_for).toBe(120);
  });

  it.each([
    ["alert-settings-pending-period-input", "pending_period_sec"],
    ["alert-settings-keep-firing-for-input", "keep_firing_for"],
  ])("with Show all on, an unset %s reads Off and writes nothing", (dataTest, field) => {
    const unset = { pending_period_sec: 0, keep_firing_for: 0, _ui: { pendingPeriod: 0 } };
    const { host, values } = mountSectioned("false", unset, { showAll: true });
    const input = amountInput(host, dataTest);
    expect([input.props("modelValue"), input.props("placeholder")]).toEqual(["", t("common.off")]);
    expect(values()[field]).toBe(0);
    host.unmount();
  });

  it("an incident reads as a sentence with its title row", async () => {
    config.isEnterprise = "true";
    const { host, values, inSlot } = mountSectioned(
      "false",
      { creates_incident: true },
      {
        reveal: ["createsIncident"],
      },
    );
    expect(inSlot("settingsNotifyMore", "add-alert-incident-row")).toBe(true);
    expect(inSlot("settingsNotifyMore", "add-alert-incident-title-row")).toBe(true);
    expect(inSlot("settingsNotifyMore", "alert-creates-incident-toggle")).toBe(false);

    (document.querySelector('[data-test="add-alert-incident-row-remove"]') as HTMLElement).click();
    await flushPromises();
    expect(values().creates_incident).toBe(false);
    expect(inSlot("settingsNotifyMore", "add-alert-incident-title-row")).toBe(false);
    expect(inSlot("settingsNotifyMore", "add-alert-incident-row")).toBe(false);
    host.unmount();
  });

  it("recovery fields stay hidden while recovery is off, even with Show all", () => {
    const { inSlot } = mountSectioned(
      "false",
      { notify_on_recovery: false },
      {
        showAll: true,
        destinations: ["dest-a"],
      },
    );
    expect(inSlot("settingsNotifyMore", "alert-notify-on-recovery-toggle")).toBe(true);
    expect(inSlot("settingsNotifyMore", "alert-notify-on-recovery-plan-dest-a")).toBe(false);
    expect(document.body.textContent).not.toContain(t("alerts.alertSettings.recoveryDestinations"));
  });

  it("the recovery, keep-firing and Must last suggestions apply their values", () => {
    const { applied, values } = mountSectioned("false");
    applied.recovery!();
    applied.keepFiring!();
    applied.holdFor!();
    expect(values().notify_on_recovery).toBe(true);
    expect(values().keep_firing_for).toBe(600);
    expect(values().pending_period_sec).toBe(10);
  });

  it.each([
    ["holdFor", "pending_period_sec", {}, 5],
    ["keepFiring", "keep_firing_for", {}, 300],
    ["holdFor", "pending_period_sec", { pending_period_sec: 7, _ui: { pendingPeriod: 7 } }, 7],
  ] as const)("an added %s row starts at one check, never 0", async (id, field, set, expected) => {
    const { tiers, values } = mountSectioned("false", set);
    tiers.reveal(id);
    await flushPromises();
    expect(values()[field]).toBe(expected);
  });

  it("Must last shows as a sentence once set and Remove clears it", async () => {
    const { tiers, values, inSlot } = mountSectioned(
      "false",
      {
        pending_period_sec: 10,
        _ui: { pendingPeriod: 10 },
      },
      { reveal: ["holdFor"] },
    );
    expect(inSlot("settingsHold", "add-alert-hold-for-row")).toBe(true);

    (document.querySelector('[data-test="add-alert-hold-for-row-remove"]') as HTMLElement).click();
    await flushPromises();
    expect(values().pending_period_sec).toBe(0);
    expect(inSlot("settingsHold", "add-alert-hold-for-row")).toBe(false);
    expect(tiers.view("condition").more.map((d) => d.id)).toContain("holdFor");
  });

  it.each([
    [10, 10, "alerts.guard.mustLastOneCheck"],
    [10, 5, "alerts.guard.mustLastOneCheck"],
    [10, 15, "alerts.validation.pendingPeriodNotMultiple"],
    [1, 10, null],
  ])("checks every %i min with Must last %i min warns %s", (frequency, pending, key) => {
    const { targets } = mountSectioned(
      "false",
      {
        trigger_condition: { silence: 10, period: 10, frequency, frequency_type: "minutes" },
        pending_period_sec: pending,
        _ui: { pendingPeriod: pending },
      },
      { reveal: ["holdFor"] },
    );
    const warning = targets.settingsHold.querySelector(
      '[data-test="alert-settings-pending-period-warning"]',
    );
    const every = everyWords(frequency, i18n.global.t as any);
    expect(warning?.textContent?.trim() ?? null).toBe(key && t(key, { every, minutes: frequency }));
  });

  it.each([
    ["true", "alerts.form.remind.realtimeHelp"],
    ["false", "alerts.form.remind.help"],
  ])("Notify at most every explains itself for is_real_time %s", (kind, key) => {
    const { targets } = mountSectioned(kind);
    expect(targets.settingsNotify.textContent).toContain(t(key));
  });

  it("composite Must last lives in the condition section", () => {
    const { inSlot } = mountSectioned("composite", {}, { reveal: ["holdFor"] });
    expect(inSlot("settingsHold", "add-alert-hold-for-row")).toBe(true);
    expect(inSlot("settingsSchedule", "alert-settings-pending-period-input")).toBe(false);
  });

  it.each([
    ["minutes", false],
    ["cron", true],
  ])("the look-back sits beside Check every, or in its own row with cron (%s)", (type, row) => {
    const { inSlot, targets } = mountSectioned("false", {
      trigger_condition: {
        silence: 10,
        period: 60,
        frequency: 5,
        frequency_type: type,
        cron: "0 9 * * 1-5",
      },
    });
    expect(inSlot("settingsSchedule", "alert-settings-period-input")).toBe(true);
    expect(inSlot("settingsSchedule", "alert-settings-period-row")).toBe(row);
    expect(
      targets.settingsSchedule.textContent?.includes(
        t("alerts.form.schedule.cron", { period: 60 }),
      ),
    ).toBe(row);
  });
});
