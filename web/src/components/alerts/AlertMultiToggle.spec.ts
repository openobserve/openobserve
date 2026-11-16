// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Behaviour spec for the Simple/Multi choice (alerts_2.md M-9).
//
// The component serves TWO alert families that store the opt-in in different
// places and split into different units: an aggregation alert into GROUPS (one
// row of a GROUP BY, flag inside `aggregation`), a PromQL alert into SERIES
// (flag on `query_condition.promql_multi_alert`, because a PromQL alert has no
// aggregation at all). Almost every test here is about not conflating the two.

import { describe, it, expect } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent } from "vue";
import { z } from "zod";
import AlertMultiToggle from "./AlertMultiToggle.vue";
import OForm from "@/lib/forms/Form/OForm.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const globalCfg = { global: { plugins: [i18n, store] } };

/** The toggle binds by `name=` into an ancestor OForm, as it does in AddAlert. */
function host(props: Record<string, any>, defaults: Record<string, any> = {}) {
  return defineComponent({
    components: { OForm, AlertMultiToggle },
    setup() {
      return {
        schema: z.looseObject({}),
        defaultValues: {
          query_condition: {
            aggregation: { multi_alert: false },
            promql_multi_alert: false,
          },
          ...defaults,
        },
        props,
      };
    },
    template: `
      <OForm :schema="schema" :default-values="defaultValues" @submit="() => {}">
        <AlertMultiToggle v-bind="props" />
      </OForm>
    `,
  });
}

function mountToggle(props: Record<string, any>, defaults?: Record<string, any>) {
  return mount(host(props, defaults), globalCfg);
}

/**
 * The `data-test-value` of the option currently selected ("true" / "false").
 *
 * Asserted through the rendered selection state rather than a prop, because a
 * prop only shows what was passed in — this shows what the control actually
 * read out of the form field it is bound to.
 */
function selectedValue(w: ReturnType<typeof mountToggle>): string | undefined {
  const checked = w
    .findAll("[data-test-value]")
    .filter((el) => el.attributes("data-state") === "checked");
  expect(checked).toHaveLength(1);
  return checked[0].attributes("data-test-value");
}

describe("AlertMultiToggle", () => {
  describe("which field it writes", () => {
    it("defaults to the aggregation flag, so existing call sites are unchanged", () => {
      const w = mountToggle({ enabled: false });
      const group = w.findComponent({ name: "OFormOptionGroup" });
      expect(group.props("name")).toBe("query_condition.aggregation.multi_alert");
    });

    it("writes the PromQL flag when asked to", () => {
      const w = mountToggle({
        enabled: false,
        name: "query_condition.promql_multi_alert",
        unit: "series",
      });
      const group = w.findComponent({ name: "OFormOptionGroup" });
      expect(group.props("name")).toBe("query_condition.promql_multi_alert");
    });

    // The two flags are independent storage, and the backend accessor makes
    // the same distinction. A PromQL alert whose aggregation flag happens to
    // be set must still render as simple — asserted on the SELECTED VALUE, not
    // just the bound name, because a name alone proves nothing about what the
    // control read.
    it("reads its own flag, not the other family's", async () => {
      const w = mountToggle(
        { enabled: false, name: "query_condition.promql_multi_alert", unit: "series" },
        { query_condition: { aggregation: { multi_alert: true }, promql_multi_alert: false } },
      );
      await flushPromises();
      // Simple stays selected even though the AGGREGATION flag is true.
      expect(selectedValue(w)).toBe("false");
    });

    it("renders the per-series option as selected when its own flag is on", async () => {
      const w = mountToggle(
        { enabled: true, name: "query_condition.promql_multi_alert", unit: "series" },
        { query_condition: { aggregation: { multi_alert: false }, promql_multi_alert: true } },
      );
      await flushPromises();
      expect(selectedValue(w)).toBe("true");
    });
  });

  describe("what it calls one unit of fan-out", () => {
    it("says 'group' by default", () => {
      const w = mountToggle({ enabled: true });
      const labels = w
        .findComponent({ name: "OFormOptionGroup" })
        .props("options")
        .map((o: any) => o.label);
      expect(labels).toContain(i18n.global.t("alerts.multiAlert.perGroup"));
      expect(labels).not.toContain(i18n.global.t("alerts.multiAlert.perSeries"));
    });

    // Not cosmetic: telling a PromQL user their alert splits "per group"
    // invites them to hunt for a Group By field the PromQL tab does not have.
    it("says 'series' for PromQL", () => {
      const w = mountToggle({ enabled: true, unit: "series" });
      const labels = w
        .findComponent({ name: "OFormOptionGroup" })
        .props("options")
        .map((o: any) => o.label);
      expect(labels).toContain(i18n.global.t("alerts.multiAlert.perSeries"));
      expect(labels).not.toContain(i18n.global.t("alerts.multiAlert.perGroup"));
    });

    it("describes the ON state in the matching unit", () => {
      const group = mountToggle({ enabled: true, unit: "group" });
      expect(group.text()).toContain(i18n.global.t("alerts.multiAlert.perGroupDescription"));

      const series = mountToggle({ enabled: true, unit: "series" });
      expect(series.text()).toContain(i18n.global.t("alerts.multiAlert.perSeriesDescription"));
    });

    it("describes the OFF state the same way for both, since simple is simple", () => {
      for (const unit of ["group", "series"] as const) {
        const w = mountToggle({ enabled: false, unit });
        expect(w.text()).toContain(i18n.global.t("alerts.multiAlert.simpleDescription"));
      }
    });
  });

  describe("the payload it produces", () => {
    // The control changed from a switch to a radio pair, but the stored value
    // is still the same boolean the API expects.
    it("offers booleans, not strings", () => {
      const w = mountToggle({ enabled: false });
      const values = w
        .findComponent({ name: "OFormOptionGroup" })
        .props("options")
        .map((o: any) => o.value);
      expect(values).toEqual([false, true]);
    });

    it("always renders BOTH options, so neither state can look ambiguous", () => {
      // The reason this is a radio pair and not a switch: OSwitch's OFF state
      // reads as already-enabled, and this control decides how many alerts the
      // monitor becomes.
      const w = mountToggle({ enabled: false });
      expect(w.findComponent({ name: "OFormOptionGroup" }).props("options")).toHaveLength(2);
    });
  });

  describe("change notification", () => {
    it("emits so the parent can normalise the M-10 count gate", async () => {
      const w = mountToggle({ enabled: false });
      const toggle = w.findComponent(AlertMultiToggle);
      await w.findComponent({ name: "OFormOptionGroup" }).vm.$emit("update:model-value", true);
      expect(toggle.emitted("change")).toBeTruthy();
      expect(toggle.emitted("change")![0]).toEqual([true]);
    });

    it("emits on the way back to simple too", async () => {
      const w = mountToggle({ enabled: true });
      const toggle = w.findComponent(AlertMultiToggle);
      await w.findComponent({ name: "OFormOptionGroup" }).vm.$emit("update:model-value", false);
      expect(toggle.emitted("change")![0]).toEqual([false]);
    });
  });
});
