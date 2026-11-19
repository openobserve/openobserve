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

import { flushPromises, mount } from "@vue/test-utils";
import { computed, defineComponent, h, provide, reactive, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { set } from "lodash-es";
import AlertIntentStart from "@/components/alerts/AlertIntentStart.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import { FORM_CONTEXT_KEY } from "@/lib/forms/Form/OForm.types";
import type { IntentFill } from "@/utils/alerts/alertIntents";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

const SERIES = ["a", "b", "c", "d"].map((host) => ({ __name__: "m", host }));

vi.mock("@/services/alert_preview.queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  promqlDaySeriesQuery: (_org: string, metric: string) => ({
    queryKey: ["spec-series", metric],
    queryFn: async () => SERIES,
  }),
}));
vi.mock("@/services/alerts.queries", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  firingAlertsQuery: () => ({ queryKey: ["spec-alerts"], queryFn: async () => ({ list: [] }) }),
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

// Stands in for AddAlert: it writes what a chip fills into the form and folds step 1 away and back.
const mountStep = () => {
  const values = reactive<Record<string, unknown>>({});
  const form = { useStore: <R>(pick: (s: any) => R) => computed(() => pick({ values })) };
  const shown = ref(true);
  const active = ref<string | null>(null);
  const applied = ref(false);
  const fills: IntentFill[] = [];
  const Host = defineComponent({
    setup() {
      provide(FORM_CONTEXT_KEY, form as never);
      return () =>
        shown.value
          ? h(AlertIntentStart, {
              streamType: "metrics",
              streamName: "m",
              columns: [{ value: "host" }, { value: "value" }],
              metricStreams: [{ name: "m", metrics_meta: { metric_type: "gauge" } }],
              periodMinutes: 10,
              anomalyAvailable: false,
              showLibrary: false,
              active: active.value,
              applied: applied.value,
              onApply: ({ fill }: { fill: IntentFill }) => {
                fills.push(fill);
                Object.entries(fill.values).forEach(([path, v]) => set(values, path, v));
                active.value = fill.intent;
                applied.value = true;
              },
              onPending: ({ intent }: { intent: string }) => {
                active.value = intent;
                applied.value = false;
              },
            })
          : null;
    },
  });
  const wrapper = mount(Host, { global: { provide: { store }, plugins: [i18n] } });
  const select = (id: string) =>
    wrapper
      .findAllComponents(OSelect)
      .find((c) => c.vm.$attrs["data-test"] === `add-alert-intent-slot-${id}`)!;
  const toggleStep = async () => {
    shown.value = false;
    await flushPromises();
    shown.value = true;
    await flushPromises();
  };
  return { wrapper, select, toggleStep, fills, values };
};

describe("AlertIntentStart", () => {
  it("opens a starter as one alert, and keeps the user's picks when the step folds away and back", async () => {
    const { wrapper, select, toggleStep, fills, values } = mountStep();
    await flushPromises();
    await wrapper.find('[data-test="add-alert-intent-metricAbove"]').trigger("click");
    await flushPromises();
    expect(fills.at(-1)?.values["query_condition.aggregation"]).toMatchObject({
      group_by: [],
      multi_alert: false,
    });
    select("agg").vm.$emit("update:modelValue", "p95");
    select("group").vm.$emit("update:modelValue", ["host"]);
    await flushPromises();
    expect(fills.at(-1)?.values["query_condition.aggregation"]).toMatchObject({
      group_by: ["host"],
      multi_alert: true,
    });
    await toggleStep();
    expect(select("agg").props("modelValue")).toBe("p95");
    expect(select("group").props("modelValue")).toEqual(["host"]);
    set(values, "query_condition.aggregation.group_by", ["host", "dc"]);
    await flushPromises();
    expect(select("group").props("modelValue")).toEqual(["host", "dc"]);
    const applied = fills.length;
    await wrapper.find('[data-test="add-alert-intent-metricAbove"]').trigger("click");
    await flushPromises();
    expect(fills.length).toBe(applied);
    await wrapper.find('[data-test="add-alert-intent-ratio"]').trigger("click");
    await flushPromises();
    select("label").vm.$emit("update:modelValue", "host");
    await flushPromises();
    await toggleStep();
    expect(select("label").props("modelValue")).toBe("host");
  });
});
