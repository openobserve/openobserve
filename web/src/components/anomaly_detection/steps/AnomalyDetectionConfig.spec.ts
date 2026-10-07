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

// Spec for AnomalyDetectionConfig (the "Detection Config" step of the anomaly
// wizard) —
// the real <OForm> the migration introduced: per-mode required validation, the
// two §4-restored rules (training_window_days ≥1, detection_function required —
// each only where its control renders), z.coerce.number typing + write-back
// egress, the custom_sql bare-Monaco bridge with submission-gated errors (R3),
// the filters[] field-array keying (rendered-inputs delete test), and the
// exposed validate() surface the parent (useAlertForm) still calls to gate
// Next/Save. The data-preview chart lives in AnomalyDataPreview.spec.ts.
//
// The step OWNS its <OForm> (Rule ③ useOForm owner) and returns `form` from
// setup(), so the TanStack form is reachable as `(wrapper.vm as any).form`.
// Submits are awaited deterministically via `await form.handleSubmit()`.

import { describe, expect, it, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import OFormSelect from "@/lib/forms/Select/OFormSelect.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import { firstFieldError } from "@/lib/forms/Form/fieldError";
import streamService from "@/services/stream";

// vi.mock must be hoisted — declared before component import
vi.mock("@/services/stream", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      schema: vi.fn().mockResolvedValue({ data: { schema: [] } }),
    },
  });
});

// The stored-value lookup the field-value resolver ends at. Stubbed so the
// resolver tests can assert the composite key it was asked for without an
// IndexedDB in jsdom. useSuggestions imports nothing else from this module.
// vi.hoisted, because vi.mock is lifted above ordinary declarations.
const { getFieldValuesForSuggestion } = vi.hoisted(() => ({
  getFieldValuesForSuggestion: vi.fn(async () => ["ERROR", "INFO"]),
}));
vi.mock("@/composables/fieldValueStore", () => ({ getFieldValuesForSuggestion }));

vi.mock("@/components/QueryEditor.vue", () => ({
  default: {
    template: '<div data-test="query-editor" />',
    props: ["query", "editorId", "language", "readOnly", "showAutoComplete", "hideNlToggle"],
  },
}));

import AnomalyDetectionConfig from "./AnomalyDetectionConfig.vue";
import {
  anomalyDetectionConfigDefaults,
  anomalyBandGrouping,
  anomalyBandWidthPrefill,
  anomalyExpectedGroupingKey,
  anomalyNoticeBadgeKeys,
  anomalyWindowShareErrors,
  lookBackWindowFloorSeconds,
} from "./AnomalyDetectionConfig.schema";
import enLocale from "@/locales/languages/en-US.json";
import { anomalyBandPayload, defaultAnomalyConfig } from "@/composables/useAlertForm";

// ---------------------------------------------------------------------------
// Mount factory — keeps stubs and global plugins in one place
// ---------------------------------------------------------------------------
function buildConfig(configOverrides: Record<string, unknown> = {}) {
  return {
    query_mode: "filters",
    stream_name: "my_stream",
    stream_type: "logs",
    histogram_interval_value: 5,
    histogram_interval_unit: "m",
    detection_function: "count",
    detection_function_field: "",
    filters: [] as Array<{ field: string; operator: string; value: string }>,
    custom_sql: "",
    // Above the schedule+histogram floor (1h + 5m) so unrelated tests stay floor-clean.
    detection_window_value: 2,
    detection_window_unit: "h",
    training_window_days: 7,
    threshold: 97,
    ...configOverrides,
  };
}

const mountOptions = {
  global: {
    plugins: [store, i18n],
    stubs: {
      QueryEditor: true,
    },
  },
};

function mountConfig(
  configOverrides: Record<string, unknown> = {},
  extraProps: Record<string, unknown> = {},
) {
  return mount(AnomalyDetectionConfig, {
    ...mountOptions,
    props: { config: buildConfig(configOverrides), ...extraProps },
  });
}

/** Like mountConfig but also returns the config object (the write-back egress
 * target — mutated in place by the form → props.config watch). */
function mountReturning(configOverrides: Record<string, unknown> = {}) {
  const config = buildConfig(configOverrides);
  const wrapper = mount(AnomalyDetectionConfig, {
    ...mountOptions,
    props: { config },
  });
  return { wrapper, config };
}

// The TanStack form the step owns (returned from setup()).
const getForm = (w: VueWrapper): any => (w.vm as any).form;

// First error message routed to a field (schema issue objects → .message).
const fieldError = (w: VueWrapper, name: string): string | undefined =>
  firstFieldError(getForm(w).getFieldMeta(name)?.errors);

// Rendered values of the filters[i].field selects, in render order.
const renderedFilterFields = (w: VueWrapper): unknown[] =>
  w
    .findAllComponents(OFormSelect)
    .filter((c: any) => /^filters\[\d+\]\.field$/.test(c.props("name") || ""))
    .map((c: any) => c.findComponent(OSelect).props("modelValue"));

// The sensitivity tiers, in render order: Auto, then Conservative, Balanced, Aggressive (band width in σ).
const SENSITIVITY_TIERS = ["auto", 4, 3, 2.5];

// data-state of each tier button. A missing button reads as undefined so a
// "no tier is active" assertion cannot pass just because nothing rendered.
const tierStates = (w: VueWrapper): Array<string | undefined> =>
  SENSITIVITY_TIERS.map((value) => {
    const button = w.find(`[data-test="anomaly-sensitivity-tier-${value}"]`);
    return button.exists() ? button.attributes("data-state") : undefined;
  });

// The level <input> (data-test lands on the OInput wrapper div).
const levelInput = (w: VueWrapper) => w.find('[data-test="anomaly-sensitivity-level"] input');

// Pinned so the range message is proven to be the translated one, not zod's raw default.
const RANGE_MESSAGE = "Enter a band width from 1 to 10.";

const sensitivityHintText = (w: VueWrapper): string | undefined => {
  const hint = w.find('[data-test="anomaly-sensitivity-hint"]');
  return hint.exists() ? hint.text() : undefined;
};

// A valid custom SQL query (aliases time_bucket, NOT the timestamp column).
const VALID_CUSTOM_SQL =
  "SELECT histogram(_timestamp, '5m') AS time_bucket, count(*) AS value FROM \"events\" GROUP BY time_bucket ORDER BY time_bucket";

// ===========================================================================
describe("AnomalyDetectionConfig", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // =========================================================================
  // =========================================================================
  // OForm behavior — the real <OForm> the migration introduced
  // =========================================================================
  describe("OForm — a fully valid form passes and does not block", () => {
    it("filters mode: valid config → isValid true, validate() true", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(true);
      await expect((wrapper.vm as any).validate()).resolves.toBe(true);
    });

    it("custom_sql mode: valid SQL → isValid true", async () => {
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: VALID_CUSTOM_SQL,
      });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(true);
    });
  });

  describe("OForm — per-mode empty-required blocks submit (errors only post-submit)", () => {
    it("filters mode: empty numeric interval → coerced to 0, blocked, error post-submit", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      // pre-submit: submit-then-change timing → no errors surfaced yet
      expect(form.state.submissionAttempts).toBe(0);
      expect((form.getFieldMeta("detection_window_value")?.errors ?? []).length).toBe(0);

      form.setFieldValue("detection_window_value", ""); // OFormInput emits ""
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false); // "" → coerce 0 → min(1) fails
      expect(fieldError(wrapper, "detection_window_value")).toBe("Field is required!");
      // validate() (the exposed surface) blocks Next/Save
      await expect((wrapper.vm as any).validate()).resolves.toBe(false);
    });

    it("custom_sql mode: empty SQL → blocked, and NOTHING renders pre-submit (R3)", async () => {
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "",
        custom_sql: "",
      });
      await flushPromises();
      const form = getForm(wrapper);

      // R3: before the first submit the bare-Monaco error gate is closed
      expect((wrapper.vm as any).showSqlErrors).toBe(false);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect((wrapper.vm as any).showSqlErrors).toBe(true);
    });
  });

  // =========================================================================
  // §4 RESTORE 1 — training_window_days ≥ 1 ("Minimum 1 day").
  // Always-rendered control → the rule applies in BOTH query modes (its
  // applicable scope), so it is an unconditional base-field rule, NOT
  // mode-gated. Prove it fires in both modes.
  // =========================================================================
  describe("§4 restore — training_window_days ≥ 1 (Minimum 1 day)", () => {
    it("filters mode: value < 1 → 'Minimum 1 day' + blocked", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("training_window_days", 0);
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "training_window_days")).toBe("Minimum 1 day");
      await expect((wrapper.vm as any).validate()).resolves.toBe(false);
    });

    it("custom_sql mode: value < 1 → still blocked (rule is unconditional)", async () => {
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: VALID_CUSTOM_SQL,
      });
      await flushPromises();
      const form = getForm(wrapper);

      // sanity: everything else valid → the ONLY failing rule is training window
      form.setFieldValue("training_window_days", 0);
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "training_window_days")).toBe("Minimum 1 day");
    });

    it("string '0' from the number input is coerced (z.coerce.number) and rejected", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("training_window_days", "0"); // input emits a string
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "training_window_days")).toBe("Minimum 1 day");
    });

    it("a valid training window (≥1) does not block", async () => {
      wrapper = mountConfig({ training_window_days: 14 });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(true);
    });
  });

  // =========================================================================
  // §4 RESTORE 2 — detection_function required, ONLY in filters mode (the
  // control does not render in custom_sql mode). Prove it fires in filters
  // mode and does NOT fire in custom_sql mode.
  // =========================================================================
  describe("§4 restore — detection_function required (filters mode only)", () => {
    it("filters mode: empty detection_function → 'Detection function is required' + blocked", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("detection_function", "");
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "detection_function")).toBe("Detection function is required");
      await expect((wrapper.vm as any).validate()).resolves.toBe(false);
    });

    it("custom_sql mode: empty detection_function does NOT block (rule is mode-gated)", async () => {
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: VALID_CUSTOM_SQL,
      });
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("detection_function", "");
      await form.handleSubmit();
      await nextTick();

      // detection_function is not a control in custom_sql mode → its required
      // rule must not fire; the form is otherwise valid.
      expect(form.state.isValid).toBe(true);
    });

    it("filters mode: non-count function requires detection_function_field", async () => {
      wrapper = mountConfig({
        detection_function: "avg",
        detection_function_field: "",
      });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "detection_function_field")).toBe("Field is required");
    });

    it("filters mode: count function does NOT require detection_function_field", async () => {
      wrapper = mountConfig({
        detection_function: "count",
        detection_function_field: "",
      });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(true);
    });
  });

  // =========================================================================
  // custom_sql bare-Monaco bridge — value bridged into the schema via
  // setFieldValue; timestamp-alias ban; submission-gated bare error divs (R3).
  // =========================================================================
  describe("custom_sql — bridged value, timestamp-alias ban, R3-gated error divs", () => {
    it("bridges the editor value into the form (onCustomSqlChange → setFieldValue)", async () => {
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: "",
      });
      await flushPromises();
      const form = getForm(wrapper);

      (wrapper.vm as any).onCustomSqlChange(VALID_CUSTOM_SQL);
      await nextTick();

      expect(form.state.values.custom_sql).toBe(VALID_CUSTOM_SQL);
      await form.handleSubmit();
      await nextTick();
      expect(form.state.isValid).toBe(true);
    });

    it("timestamp-column used as an alias is blocked, and its error div is R3-gated", async () => {
      const badSql =
        "SELECT histogram(_timestamp, '5m') AS _timestamp, count(*) AS value FROM \"events\" GROUP BY 1 ORDER BY 1";
      wrapper = mountConfig({
        query_mode: "custom_sql",
        stream_name: "events",
        custom_sql: badSql,
      });
      await flushPromises();
      const form = getForm(wrapper);

      // R3: pre-submit the alias error div (a bare, data-test-selectable div)
      // must NOT render even though the SQL is already invalid.
      expect(wrapper.find('[data-test="anomaly-custom-sql-timestamp-alias-error"]').exists()).toBe(
        false,
      );

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      // post-submit the gate opens and the div renders
      expect(wrapper.find('[data-test="anomaly-custom-sql-timestamp-alias-error"]').exists()).toBe(
        true,
      );
    });

    it("detection-window error div (kept data-test) is submission-gated", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const form = getForm(wrapper);
      form.setFieldValue("detection_window_value", 0);
      await nextTick();

      // pre-submit: no error div
      expect(wrapper.find('[data-test="anomaly-detection-window-error"]').exists()).toBe(false);

      await form.handleSubmit();
      await nextTick();

      expect(wrapper.find('[data-test="anomaly-detection-window-error"]').exists()).toBe(true);
    });
  });

  // =========================================================================
  // Payload / egress typing (Rule ④ b) — numeric fields come out of OFormInput
  // as strings → z.coerce.number(); the write-back watch re-coerces so
  // props.config (which the parent's saveAnomalyDetection payload reads) keeps
  // NUMBER types.
  // =========================================================================
  describe("egress — write-back to props.config keeps number types", () => {
    it("string numeric input is written back to props.config as a number", async () => {
      const { wrapper: w, config } = mountReturning();
      wrapper = w;
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("training_window_days", "10"); // string, as OFormInput emits
      form.setFieldValue("histogram_interval_value", "20");
      await flushPromises();
      await nextTick();

      expect(config.training_window_days).toBe(10);
      expect(typeof config.training_window_days).toBe("number");
      expect(config.histogram_interval_value).toBe(20);
      expect(typeof config.histogram_interval_value).toBe("number");
    });

    it("band_width is written back as a number", async () => {
      const config = defaultAnomalyConfig();
      wrapper = mount(AnomalyDetectionConfig, { ...mountOptions, props: { config } });
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("band_width", 4);
      await flushPromises();
      await nextTick();

      expect(config.band_width).toBe(4);
      expect(typeof config.band_width).toBe("number");
      expect("threshold_min" in config).toBe(false);
    });

    it("query_mode is mirrored to props.config (egress, not into-form mirror)", async () => {
      const { wrapper: w, config } = mountReturning();
      wrapper = w;
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("query_mode", "custom_sql");
      await flushPromises();
      await nextTick();

      expect(config.query_mode).toBe("custom_sql");
    });
  });

  // jsdom lays nothing out, so the sliding pill never measures; data-state is the assertable selection.
  describe("sensitivity — tier toggle + level input on band_width", () => {
    it("offers Auto, then maps Conservative, Balanced and Aggressive to 4, 3 and 2.5", async () => {
      wrapper = mountConfig();
      await flushPromises();

      expect(
        SENSITIVITY_TIERS.map((value) =>
          wrapper.find(`[data-test="anomaly-sensitivity-tier-${value}"]`).text(),
        ),
      ).toEqual([
        i18n.global.t("alerts.anomaly.sensitivityAuto"),
        i18n.global.t("alerts.anomaly.sensitivityConservative"),
        i18n.global.t("alerts.anomaly.sensitivityBalanced"),
        i18n.global.t("alerts.anomaly.sensitivityAggressive"),
      ]);
    });

    it("a new config defaults to Auto, with no band width", async () => {
      wrapper = mountConfig();
      await flushPromises();

      expect(getForm(wrapper).state.values.band_width).toBeNull();
      expect(tierStates(wrapper)).toEqual(["on", "off", "off", "off"]);
      expect(sensitivityHintText(wrapper)).toBeUndefined();
    });

    it("names the trained k beside Auto once the config carries one", async () => {
      wrapper = mountConfig({ band_width: null, band_k: 3.4567 });
      await flushPromises();

      expect(wrapper.find('[data-test="anomaly-sensitivity-tier-auto"]').text()).toBe(
        i18n.global.t("alerts.anomaly.sensitivityAutoTrained", { k: 3.46 }),
      );
      expect(getForm(wrapper).state.values.band_width).toBeNull();
    });

    it("clicking Auto clears an override and writes null back", async () => {
      const { wrapper: w, config } = mountReturning({ band_width: 4 });
      wrapper = w;
      await flushPromises();

      await wrapper.find('[data-test="anomaly-sensitivity-tier-auto"]').trigger("click");
      await flushPromises();
      await nextTick();

      expect(getForm(wrapper).state.values.band_width).toBeNull();
      expect((config as any).band_width).toBeNull();
      expect(tierStates(wrapper)).toEqual(["on", "off", "off", "off"]);
    });

    it("clicking a tier sets band_width and writes it back to props.config", async () => {
      const { wrapper: w, config } = mountReturning();
      wrapper = w;
      await flushPromises();

      await wrapper.find('[data-test="anomaly-sensitivity-tier-2.5"]').trigger("click");
      await flushPromises();
      await nextTick();

      expect(getForm(wrapper).state.values.band_width).toBe(2.5);
      expect((config as any).band_width).toBe(2.5);
    });

    it("a non-tier level lights no tier and still states the band", async () => {
      wrapper = mountConfig({ band_width: 3.5 });
      await flushPromises();

      expect(tierStates(wrapper)).toEqual(["off", "off", "off", "off"]);
      expect((levelInput(wrapper).element as HTMLInputElement).value).toBe("3.5");
      expect(sensitivityHintText(wrapper)).toBe(
        i18n.global.t("alerts.anomaly.bandWidthHint", { k: 3.5 }),
      );
    });

    it("typing a tier value lights that tier up, as a number", async () => {
      wrapper = mountConfig({ band_width: 3.5 });
      await flushPromises();

      await levelInput(wrapper).setValue("4");
      await flushPromises();
      await nextTick();

      expect(getForm(wrapper).state.values.band_width).toBe(4);
      expect(tierStates(wrapper)).toEqual(["off", "on", "off", "off"]);
    });

    it.each([0.5, 10.5, 0])("rejects %s with the band-width range message", async (bad) => {
      wrapper = mountConfig({ band_width: 3 });
      await flushPromises();
      const form = getForm(wrapper);
      form.setFieldValue("band_width", bad);
      await flushPromises();

      await form.handleSubmit();
      await flushPromises();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "band_width")).toBe(RANGE_MESSAGE);
      // Two OForm* wrappers on one field, but only the step's own message renders.
      expect(wrapper.text().split(RANGE_MESSAGE).length - 1).toBe(1);
      expect(wrapper.find('[data-test="anomaly-sensitivity-error"]').attributes("role")).toBe(
        "alert",
      );
      expect(wrapper.find('[data-test="anomaly-sensitivity-hint"]').exists()).toBe(false);
    });

    it.each([1, 10, 3.25])("accepts %s", async (ok) => {
      wrapper = mountConfig({ band_width: ok });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(true);
    });

    // Saving must never pin k: both an Auto create and an untouched Auto edit send null.
    it.each([
      ["a new alert left on Auto", {}],
      [
        "an untouched edit of an Auto alert",
        { band_width: anomalyBandWidthPrefill({ band_width: null, band_k: 3.4 }), band_k: 3.4 },
      ],
    ])("%s saves band_width null", async (_label, stored) => {
      const { wrapper: w, config } = mountReturning({ ...defaultAnomalyConfig(), ...stored });
      wrapper = w;
      await flushPromises();

      await expect((wrapper.vm as any).validate()).resolves.toBe(true);
      await flushPromises();
      expect(anomalyBandPayload(config, false).band_width).toBeNull();
    });

    it("clearing the level is Auto: null goes back and validation passes", async () => {
      const { wrapper: w, config } = mountReturning({ band_width: 4 });
      wrapper = w;
      await flushPromises();

      await levelInput(wrapper).setValue("");
      await flushPromises();
      await nextTick();

      expect((config as any).band_width).toBeNull();
      expect(tierStates(wrapper)).toEqual(["on", "off", "off", "off"]);
      await expect((wrapper.vm as any).validate()).resolves.toBe(true);
    });

    it("never writes the percentile threshold, which the server still keeps", async () => {
      const { wrapper: w, config } = mountReturning({ threshold: 97 });
      wrapper = w;
      await flushPromises();

      await wrapper.find('[data-test="anomaly-sensitivity-tier-4"]').trigger("click");
      await flushPromises();
      await nextTick();

      expect(config.threshold).toBe(97);
      expect(getForm(wrapper).state.values).not.toHaveProperty("threshold");
    });

    it("tier labels re-resolve when the locale changes", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const before = wrapper.find('[data-test="anomaly-sensitivity-tier-4"]').text();

      const previous = i18n.global.locale.value;
      try {
        i18n.global.locale.value = "de-DE";
        await nextTick();
        expect(wrapper.find('[data-test="anomaly-sensitivity-tier-4"]').text()).toBe(
          i18n.global.t("alerts.anomaly.sensitivityConservative"),
        );
      } finally {
        i18n.global.locale.value = previous;
        await nextTick();
      }

      expect(wrapper.find('[data-test="anomaly-sensitivity-tier-4"]').text()).toBe(before);
    });

    it("keeps the toggle bar and the level box on one centred row", async () => {
      wrapper = mountConfig();
      await flushPromises();

      let row: HTMLElement | null = wrapper.find('[data-test="anomaly-sensitivity-level"]')
        .element as HTMLElement;
      while (row && !row.querySelector('[data-test="anomaly-sensitivity-tier"]')) {
        row = row.parentElement;
      }
      expect(row).not.toBeNull();
      expect(row?.className).toContain("items-center");
    });
  });

  // Wire contract: `alert_budget_per_day` set = budget mode, which the server rejects band_width beside.
  describe("sensitivity — budget mode", () => {
    it("a config with no budget renders the band controls only", async () => {
      wrapper = mountConfig();
      await flushPromises();

      expect(wrapper.find('[data-test="anomaly-sensitivity-level"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="anomaly-budget-count"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="anomaly-budget-tiers"]').exists()).toBe(false);
    });

    it("a stored budget replaces the band control with the budget control", async () => {
      wrapper = mountConfig({ alert_budget_per_day: 2 });
      await flushPromises();

      expect(wrapper.find('[data-test="anomaly-budget-count"] input').exists()).toBe(true);
      expect(wrapper.find('[data-test="anomaly-sensitivity-level"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="anomaly-sensitivity-tier-3"]').exists()).toBe(false);
      expect(
        (wrapper.find('[data-test="anomaly-budget-count"] input').element as HTMLInputElement)
          .value,
      ).toBe("2");
    });

    it("a sub-daily budget is surfaced as alerts per week", async () => {
      wrapper = mountConfig({ alert_budget_per_day: 1 / 7 });
      await flushPromises();
      const form = getForm(wrapper);

      expect(form.state.values.budget_count).toBe(1);
      expect(form.state.values.budget_period).toBe("week");
    });

    it("the budget tiers map to 1/week, 1/day and 4/day", async () => {
      wrapper = mountConfig({ alert_budget_per_day: 2 });
      await flushPromises();
      const form = getForm(wrapper);

      await wrapper.find('[data-test="anomaly-budget-tier-1_week"]').trigger("click");
      await flushPromises();
      expect(form.state.values.budget_count).toBe(1);
      expect(form.state.values.budget_period).toBe("week");

      await wrapper.find('[data-test="anomaly-budget-tier-4_day"]').trigger("click");
      await flushPromises();
      expect(form.state.values.budget_count).toBe(4);
      expect(form.state.values.budget_period).toBe("day");
    });

    it("writes the budget back as a per-day number and touches neither threshold nor band width", async () => {
      const { wrapper: w, config } = mountReturning({
        alert_budget_per_day: 2,
        threshold: 96.4,
        band_width: null,
      });
      wrapper = w;
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("budget_count", 3);
      form.setFieldValue("budget_period", "week");
      await flushPromises();
      await nextTick();

      expect(config.alert_budget_per_day).toBeCloseTo(3 / 7, 10);
      expect(config.threshold).toBe(96.4);
      expect((config as any).band_width).toBeNull();
    });

    // The reverse switch (band -> budget) already worked; this pins the direction
    // that silently kept the stale budget and blanked the band width on reopen.
    it("switching sensitivity_mode to band clears the stored budget", async () => {
      const { wrapper: w, config } = mountReturning({ alert_budget_per_day: 2 });
      wrapper = w;
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("sensitivity_mode", "band");
      form.setFieldValue("band_width", 5);
      await flushPromises();
      await nextTick();

      expect((config as any).band_width).toBe(5);
      expect(config.alert_budget_per_day).toBeUndefined();
    });

    it("an invalid count blocks submit and does not clobber the stored budget", async () => {
      const { wrapper: w, config } = mountReturning({ alert_budget_per_day: 2 });
      wrapper = w;
      await flushPromises();
      const form = getForm(wrapper);

      form.setFieldValue("budget_count", 0);
      await flushPromises();
      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(false);
      expect(fieldError(wrapper, "budget_count")).toBe("Enter a number greater than 0");
      // Writing undefined here would silently flip the config to band mode.
      expect(config.alert_budget_per_day).toBe(2);
    });

    it("a budget-mode submit is not judged on the hidden band width", async () => {
      wrapper = mountConfig({ alert_budget_per_day: 1, band_width: null });
      await flushPromises();
      const form = getForm(wrapper);

      await form.handleSubmit();
      await nextTick();

      expect(form.state.isValid).toBe(true);
    });

    it("budget-mode hint states the ceiling, never a ranking or a promise of importance", async () => {
      wrapper = mountConfig({ alert_budget_per_day: 2 });
      await flushPromises();

      const hint = sensitivityHintText(wrapper);
      expect(hint).toBeDefined();
      expect(hint).toContain("2");
      expect(hint).toContain("per day");
      for (const claim of ["most important", "most unusual", "highest", "top", "rank"]) {
        expect(hint!.toLowerCase()).not.toContain(claim);
      }
    });

    it("switching the period to week switches the hint", async () => {
      wrapper = mountConfig({ alert_budget_per_day: 2 });
      await flushPromises();
      getForm(wrapper).setFieldValue("budget_period", "week");
      await flushPromises();
      await nextTick();

      expect(sensitivityHintText(wrapper)).toContain("per week");
    });
  });

  describe("training window — days suffix and one hint line", () => {
    const floorHint = (w: VueWrapper) => w.find('[data-test="anomaly-training-window-floor-hint"]');

    it.each([7, 28])("%s days states the 21-day training floor", async (days) => {
      wrapper = mountConfig({ training_window_days: days });
      await flushPromises();
      expect(floorHint(wrapper).text()).toBe(
        i18n.global.t("alerts.anomaly.trainingWindowFloorHint", { days: 21 }),
      );
    });

    it("shows days as the input's own unit and keeps the grouping out of the form", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const field = wrapper.find('[data-test="anomaly-training-window"]');
      expect(field.text()).toContain(i18n.global.t("alerts.anomaly.daysUnit"));
      expect(wrapper.text()).not.toContain(
        i18n.global.t("alerts.anomaly.bandGroupingWeekendHourIfData"),
      );
    });

    it("defaults a new config to 28 days", () => {
      expect(anomalyDetectionConfigDefaults(undefined).training_window_days).toBe(28);
    });
  });

  describe("sensitivity — the removed slider and the relocated chart", () => {
    it("no longer declares a threshold_range form field or renders the slider", async () => {
      wrapper = mountConfig();
      await flushPromises();

      expect(getForm(wrapper).state.values).not.toHaveProperty("threshold_range");
      expect(wrapper.find('[data-test="anomaly-threshold-range"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="anomaly-threshold-range-label"]').exists()).toBe(false);
    });

    // The chart moved to AnomalyDataPreview in the right-hand Preview card; this
    // step now shows the generated SQL in its place.
    it("shows the SQL preview row and no data-preview chart", async () => {
      wrapper = mountConfig();
      await flushPromises();

      expect(wrapper.find('[data-test="anomaly-sql-preview"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="anomaly-data-preview-load-btn"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="anomaly-data-preview-empty"]').exists()).toBe(false);
    });

    // In custom_sql mode the user's own editor is on this form already, so a
    // read-only copy of the same query below it is noise.
    it("hides the SQL preview row in custom_sql mode", async () => {
      wrapper = mountConfig({ query_mode: "custom_sql", custom_sql: VALID_CUSTOM_SQL });
      await flushPromises();

      expect(wrapper.find('[data-test="anomaly-sql-preview"]').exists()).toBe(false);
    });

    it("renders the previewSql prop the parent passes down", async () => {
      const sql = 'SELECT 1 AS value FROM "my_stream"';
      wrapper = mount(AnomalyDetectionConfig, {
        ...mountOptions,
        props: { config: buildConfig(), previewSql: sql },
      });
      await flushPromises();

      expect(wrapper.find('[data-test="anomaly-sql-preview"]').attributes("query")).toBe(sql);
    });

    it("labels the preview row and drops the score-range framing", async () => {
      wrapper = mountConfig();
      await flushPromises();

      expect(wrapper.text()).toContain("SQL Preview");
      expect(wrapper.text()).not.toContain("Anomaly Score Range");
    });

    // "Auto (trained k = 6)" plus three presets cannot fit a 390px row, so narrow screens get a menu.
    it("collapses the tier group to a dropdown on narrow screens", async () => {
      wrapper = mountConfig();
      await flushPromises();
      const group = wrapper
        .findAllComponents(OToggleGroup)
        .find((c) => c.vm.$attrs["data-test"] === "anomaly-sensitivity-tier");
      expect(group?.props("mobileDropdown")).toBe(true);
    });

    it("gives the tier group an accessible name", async () => {
      wrapper = mountConfig();
      await flushPromises();

      // The row's "Sensitivity" text is a plain div bound to neither control,
      // so aria-label is the group's only accessible name.
      const group = wrapper.find('[data-test="anomaly-sensitivity-tier"]');
      expect(group.exists()).toBe(true);
      expect(group.attributes("aria-label")).toBe("Sensitivity");
    });

    it("exposes no mark-line or series-max machinery", async () => {
      wrapper = mountConfig();
      await flushPromises();

      // Only symbols actually exposed today are asserted — `updateMarkLines` was
      // never in the setup() return, so asserting it would pass either way.
      expect((wrapper.vm as any).onSeriesDataUpdate).toBeUndefined();
      expect((wrapper.vm as any).previewHasData).toBeUndefined();
    });
  });

  // =========================================================================
  // filters[] field-array (Rule ① — indexed names + :key=index). The
  // non-negotiable gate: delete a NON-last row and assert the RENDERED inputs
  // (each OFormSelect→OSelect model-value), not just form.state.values.
  // =========================================================================
  describe("filters[] field-array — rendered inputs stay in sync on non-last delete", () => {
    it("removing the MIDDLE of three filter rows leaves the rendered field selects correct", async () => {
      wrapper = mountConfig({
        filters: [
          { field: "alpha", operator: "=", value: "1" },
          { field: "beta", operator: "=", value: "2" },
          { field: "gamma", operator: "=", value: "3" },
        ],
      });
      await flushPromises();
      await nextTick();

      // sanity — all three rendered in order
      expect(renderedFilterFields(wrapper)).toEqual(["alpha", "beta", "gamma"]);

      (wrapper.vm as any).removeFilter(1); // delete "beta" (non-last)
      await nextTick();
      await flushPromises();

      // form DATA is correct
      expect(getForm(wrapper).state.values.filters.map((f: any) => f.field)).toEqual([
        "alpha",
        "gamma",
      ]);

      // the RENDERED inputs must match — not shifted, not blank (:key=index)
      expect(renderedFilterFields(wrapper)).toEqual(["alpha", "gamma"]);
    });

    it("addFilter / removeFilter mutate the form array (single source of truth)", async () => {
      wrapper = mountConfig({ filters: [] });
      await flushPromises();
      const form = getForm(wrapper);

      (wrapper.vm as any).addFilter();
      (wrapper.vm as any).addFilter();
      await nextTick();
      expect(form.state.values.filters.length).toBe(2);

      (wrapper.vm as any).removeFilter(0);
      await nextTick();
      expect(form.state.values.filters.length).toBe(1);
    });
  });

  // =========================================================================
  // Exposed validate() — the surface the parent (useAlertForm) still calls to
  // gate Next/Save. Driven by form.handleSubmit() (flips submissionAttempts),
  // NEVER TanStack formRef.validate().
  // =========================================================================
  describe("exposed validate() — parent hand-off surface", () => {
    it("returns false for an invalid form and flips the submission gate", async () => {
      wrapper = mountConfig({ detection_function: "" });
      await flushPromises();

      expect((wrapper.vm as any).showSqlErrors).toBe(false);
      const ok = await (wrapper.vm as any).validate();
      await nextTick();

      expect(ok).toBe(false);
      expect((wrapper.vm as any).showSqlErrors).toBe(true); // submissionAttempts > 0
    });

    it("returns true for a valid form", async () => {
      wrapper = mountConfig();
      await flushPromises();

      const ok = await (wrapper.vm as any).validate();
      expect(ok).toBe(true);
    });
  });

  // =========================================================================
  // Editor autocomplete wiring. Both halves shipped broken: loadStreamFields
  // cleared the field keywords on failure but never SET them on success, and
  // the stream context the value resolver keys on was never populated at all.
  // Neither was visible from the outside — the editor still opened, just with
  // nothing stream-specific in it.
  // =========================================================================
  describe("SQL editor autocomplete", () => {
    it("feeds the selected stream's fields to the editor", async () => {
      (streamService.schema as any).mockResolvedValueOnce({
        data: {
          schema: [
            { name: "level", type: "Utf8" },
            { name: "code", type: "Int64" },
          ],
        },
      });
      wrapper = mountConfig();
      await flushPromises();

      const labels = ((wrapper.vm as any).effectiveKeywords ?? []).map((k: any) => k.label);
      expect(labels).toContain("level");
      expect(labels).toContain("code");
    });

    it("resolves field values under the selected stream's key", async () => {
      wrapper = mountConfig({ stream_name: "my_stream", stream_type: "logs" });
      await flushPromises();

      const values = await (wrapper.vm as any).resolveFieldValues("level");

      expect(getFieldValuesForSuggestion).toHaveBeenCalledWith(
        {
          org: store.state.selectedOrganization.identifier,
          streamType: "logs",
          streamName: "my_stream",
        },
        "level",
      );
      expect(values).toEqual(["ERROR", "INFO"]);
    });
  });

  // §4.3/§4.6: floor = Check Every + one Detection Resolution, computed locally — no settle margin.
  describe("look back window floor (schedule + histogram)", () => {
    const submitted = async (
      overrides: Record<string, unknown>,
      extraProps: Record<string, unknown> = {},
    ): Promise<VueWrapper> => {
      const w = mountConfig(overrides, extraProps);
      await flushPromises();
      await getForm(w).handleSubmit();
      await nextTick();
      return w;
    };

    it("is Check Every plus one Detection Resolution", () => {
      expect(lookBackWindowFloorSeconds(1, "h", 5, "m")).toBe(3900);
      expect(lookBackWindowFloorSeconds(5, "m", 5, "m")).toBe(600);
      expect(lookBackWindowFloorSeconds(90, "s", 30, "s")).toBe(120);
      expect(lookBackWindowFloorSeconds(1, "d", 1, "h")).toBe(90000);
    });

    it("is absent when either governing value is not a positive s/m/h/d interval", () => {
      expect(lookBackWindowFloorSeconds(0, "m", 5, "m")).toBeNull();
      expect(lookBackWindowFloorSeconds(5, "x", 5, "m")).toBeNull();
      expect(lookBackWindowFloorSeconds(5, "m", Number.NaN, "m")).toBeNull();
    });

    it("rejects the live broken shape: 5m window on a 5m schedule and 5m buckets", async () => {
      wrapper = await submitted({
        schedule_interval_value: 5,
        schedule_interval_unit: "m",
        histogram_interval_value: 5,
        histogram_interval_unit: "m",
        detection_window_value: 5,
        detection_window_unit: "m",
      });

      expect(fieldError(wrapper, "detection_window_value")).toContain("10m");
      expect(getForm(wrapper).state.isValid).toBe(false);
    });

    it("accepts exactly the floor and refuses one bucket under it", async () => {
      const shape = {
        schedule_interval_value: 5,
        schedule_interval_unit: "m",
        histogram_interval_value: 5,
        histogram_interval_unit: "m",
        detection_window_unit: "m",
      };
      wrapper = await submitted({ ...shape, detection_window_value: 10 });
      expect(fieldError(wrapper, "detection_window_value")).toBeUndefined();
      wrapper.unmount();

      wrapper = await submitted({ ...shape, detection_window_value: 9 });
      expect(fieldError(wrapper, "detection_window_value")).toBeDefined();
    });

    it("states the minimum and the recommendation at the field in one line", async () => {
      wrapper = mountConfig();
      await flushPromises();

      const hint = wrapper.find('[data-test="anomaly-detection-window-hint"]');
      expect(hint.exists()).toBe(true);
      expect(hint.text()).toContain("1h 5m");
      // Twice the floor plus the 10-minute absence allowance.
      expect(hint.text()).toContain("2h 20m");
    });
  });

  // D4/N11: suppression by value vs the fetched triple, never touched-flags; bytes are pinned in the payload spec.
  describe("client grandfathering of legacy rows (D4/N11/N12)", () => {
    // A stored below-floor row: window 10m against a 1h schedule + 5m buckets (floor 1h 5m).
    const storedBelowFloor = () => ({
      histogram: { raw: "5m", value: 5, unit: "m", parsed: true },
      schedule: { raw: "1h", value: 1, unit: "h", parsed: true },
      window: { raw: 600, value: 10, unit: "m", parsed: true },
    });
    // The form state the stored triple seeds (schedule 1h is the mount default).
    const matchingConfig = {
      histogram_interval_value: 5,
      histogram_interval_unit: "m",
      detection_window_value: 10,
      detection_window_unit: "m",
    };

    const mountStored = async (stored: Record<string, unknown>) => {
      const w = mountConfig(matchingConfig, { storedIntervals: stored });
      await flushPromises();
      return w;
    };

    it("an untouched below-floor triple passes: a description-only edit saves", async () => {
      wrapper = await mountStored(storedBelowFloor());
      await getForm(wrapper).handleSubmit();
      await nextTick();

      expect(fieldError(wrapper, "detection_window_value")).toBeUndefined();
      expect(getForm(wrapper).state.isValid).toBe(true);
    });

    it("a below-floor window EDIT is rejected", async () => {
      wrapper = await mountStored(storedBelowFloor());
      getForm(wrapper).setFieldValue("detection_window_value", 20);
      await getForm(wrapper).handleSubmit();
      await nextTick();

      expect(fieldError(wrapper, "detection_window_value")).toContain("1h 5m");
    });

    it("edit-and-revert is clean again (value comparison, not touched-flags)", async () => {
      wrapper = await mountStored(storedBelowFloor());
      const form = getForm(wrapper);
      form.setFieldValue("detection_window_value", 20);
      await form.handleSubmit();
      await nextTick();
      expect(fieldError(wrapper, "detection_window_value")).toBeDefined();

      form.setFieldValue("detection_window_value", 10);
      await form.handleSubmit();
      await nextTick();
      expect(fieldError(wrapper, "detection_window_value")).toBeUndefined();
      expect(form.state.isValid).toBe(true);
    });

    it("unparsable stored values: no floor, no warning -- but W>0 still enforced (N12)", async () => {
      const stored = storedBelowFloor();
      stored.schedule = { raw: "1x", value: 1, unit: "h", parsed: false };
      wrapper = await mountStored(stored);
      const form = getForm(wrapper);

      // The window edit cannot be floored against an unparsable schedule.
      form.setFieldValue("detection_window_value", 6);
      await form.handleSubmit();
      await nextTick();
      expect(fieldError(wrapper, "detection_window_value")).toBeUndefined();
      expect(wrapper.find('[data-test="anomaly-detection-window-legacy-warning"]').exists()).toBe(
        false,
      );

      // N12: tolerance never waives W > 0.
      form.setFieldValue("detection_window_value", 0);
      await form.handleSubmit();
      await nextTick();
      expect(fieldError(wrapper, "detection_window_value")).toBe("Field is required!");
    });

    it("warns on a grandfathered below-floor row, stating the correctly parsed minimum", async () => {
      wrapper = await mountStored(storedBelowFloor());

      const warning = wrapper.find('[data-test="anomaly-detection-window-legacy-warning"]');
      expect(warning.exists()).toBe(true);
      expect(warning.text()).toContain("1h 5m");
    });

    it("clears the legacy warning once the triple is edited", async () => {
      wrapper = await mountStored(storedBelowFloor());
      getForm(wrapper).setFieldValue("detection_window_value", 70);
      await nextTick();

      expect(wrapper.find('[data-test="anomaly-detection-window-legacy-warning"]').exists()).toBe(
        false,
      );
    });
  });
});

describe("anomalyNoticeBadgeKeys", () => {
  const enText = (key: string) =>
    key.split(".").reduce<any>((node, part) => node?.[part], enLocale);

  it.each(["window_floor", "window_skip", "retrain"])(
    "maps %s to a label and tooltip that exist in en-US",
    (noticeClass) => {
      const keys = anomalyNoticeBadgeKeys(noticeClass);
      expect(keys).not.toBeNull();
      expect(typeof enText(keys!.labelKey)).toBe("string");
      for (const key of keys!.tooltipKeys) expect(typeof enText(key)).toBe("string");
    },
  );

  it.each([null, undefined, "", "some_future_class", "hybrid_fallback", 42])(
    "shows no badge for an unknown class (%s)",
    (noticeClass) => {
      expect(anomalyNoticeBadgeKeys(noticeClass)).toBeNull();
    },
  );
});

// Mirrors the server's window-share rules: buckets >= 1 within 24h, 0 < recover <= fire <= 100.
describe("anomalyWindowShareErrors", () => {
  const errors = (cfg: Record<string, unknown>) => anomalyWindowShareErrors(cfg);
  const clean = { buckets: null, fire: null, recover: null };

  it("accepts the defaults and blank inputs", () => {
    expect(errors({ alert_window_buckets: 1, alert_window_fire_pct: 100 })).toEqual(clean);
    expect(errors({})).toEqual(clean);
    expect(
      errors({ alert_window_buckets: "", alert_window_fire_pct: "", alert_window_recover_pct: "" }),
    ).toEqual(clean);
  });

  it("accepts 4 of 5 at 80% with recovery below 60%", () => {
    expect(
      errors({ alert_window_buckets: 5, alert_window_fire_pct: 80, alert_window_recover_pct: 60 }),
    ).toEqual(clean);
  });

  it.each([0, 2.5, -1])("rejects %s buckets", (n) => {
    expect(errors({ alert_window_buckets: n }).buckets).toBe("alerts.anomaly.windowBucketsRange");
  });

  it.each([0, -5, 100.1])("rejects a fire share of %s", (n) => {
    expect(errors({ alert_window_fire_pct: n }).fire).toBe("alerts.anomaly.windowFireRange");
  });

  it("rejects a window longer than 24h of buckets", () => {
    const at = (buckets: number, value: number, unit: string) =>
      errors({
        alert_window_buckets: buckets,
        histogram_interval_value: value,
        histogram_interval_unit: unit,
      }).buckets;
    expect(at(288, 5, "m")).toBeNull();
    expect(at(24, 1, "h")).toBeNull();
    expect(at(25, 1, "h")).toBe("alerts.anomaly.windowBucketsSpan");
    expect(at(289, 5, "m")).toBe("alerts.anomaly.windowBucketsSpan");
    // No fixed bucket cap: 1-minute buckets fill a day at 1440.
    expect(at(720, 1, "m")).toBeNull();
    expect(at(1440, 1, "m")).toBeNull();
    expect(at(1441, 1, "m")).toBe("alerts.anomaly.windowBucketsSpan");
    expect(at(2, 1, "d")).toBe("alerts.anomaly.windowBucketsSpan");
    // One bucket looks back nowhere, so even a 13-day resolution stays valid, as when blank.
    expect(at(1, 13, "d")).toBeNull();
    // An unparsable resolution leaves the span to the server.
    expect(at(100, 0, "x")).toBeNull();
  });

  it("rejects a recover share above fire, or of zero", () => {
    expect(errors({ alert_window_fire_pct: 50, alert_window_recover_pct: 60 }).recover).toBe(
      "alerts.anomaly.windowRecoverRange",
    );
    expect(errors({ alert_window_recover_pct: 0 }).recover).toBe(
      "alerts.anomaly.windowRecoverRange",
    );
    // A blank fire share is 100, so recover may go up to it.
    expect(errors({ alert_window_recover_pct: 100 }).recover).toBeNull();
  });
});

// Mirrors absence.rs slot_resolution_for: (span + 1h) / cycle >= 3, and an hourly-or-finer bucket.
describe("anomalyBandGrouping", () => {
  it.each([60, 300, 3600])("groups %ss buckets by weekday/weekend × hour", (interval) => {
    expect(anomalyBandGrouping(interval)).toBe("weekend_hour");
  });

  it("is global for any bucket coarser than 1h", () => {
    expect(anomalyBandGrouping(3601)).toBe("global");
    expect(anomalyBandGrouping(86400)).toBe("global");
  });

  it("assumes weekday/weekend × hour while the interval is not yet valid", () => {
    expect(anomalyBandGrouping(null)).toBe("weekend_hour");
  });

  // The trainer picks from the data the stream returns: under 3 days global.
  it("labels weekday/weekend × hour with its data condition, and global as it is", () => {
    expect(anomalyExpectedGroupingKey(300)).toBe("alerts.anomaly.bandGroupingWeekendHourIfData");
    const label = String(i18n.global.t("alerts.anomaly.bandGroupingWeekendHourIfData"));
    for (const outcome of ["weekday/weekend × hour of day", "3+ days", "global"])
      expect(label).toContain(outcome);
    expect(anomalyExpectedGroupingKey(7200)).toBe("alerts.anomaly.bandGroupingGlobal");
  });
});

// Edit prefill: an untouched save must keep the band the alert already runs on.
describe("anomalyBandWidthPrefill", () => {
  it("keeps a stored band width", () => {
    expect(anomalyBandWidthPrefill({ band_width: 3.5, band_k: 4.2 })).toBe(3.5);
  });

  // Prefilling the trained k would turn an untouched save into a pinned override.
  it.each([3.2667, 3, null])(
    "is Auto without a stored band width, whatever the trained k (%s)",
    (bandK) => {
      expect(anomalyBandWidthPrefill({ band_width: null, band_k: bandK })).toBeNull();
    },
  );

  it("is Auto for a config with no band fields at all", () => {
    expect(anomalyBandWidthPrefill({})).toBeNull();
  });

  it("leaves a budget-mode alert without one, which the server rejects beside a budget", () => {
    expect(anomalyBandWidthPrefill({ alert_budget_per_day: 2, band_k: 4 })).toBeNull();
  });
});
