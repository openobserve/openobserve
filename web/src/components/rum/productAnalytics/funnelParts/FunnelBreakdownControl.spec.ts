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

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import FunnelBreakdownControl from "./FunnelBreakdownControl.vue";
import type { BreakdownStart } from "@/utils/rum/productAnalyticsModel";
import type { FieldSample } from "@/utils/rum/funnelFields";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";

const PAY = "context_payment_method";
const DEF: FunnelDef = {
  steps: [
    { kind: "c", key: "product_viewed" },
    { kind: "c", key: "payment_info_submitted" },
    { kind: "c", key: "order_completed" },
  ],
  unit: "sessions",
  window: "session",
  breakdown: null,
};
const SAMPLE: FieldSample = {
  fields: [{ field: PAY, steps: [2, 3], top: ["card", "upi", "cod"], more: 1, many: false }],
};
const START: BreakdownStart = {
  step: 2,
  pinned: false,
  anyStep: false,
  covered: 36,
  reached: 36,
  auto: 2,
};
const popoverStub = {
  props: ["open"],
  emits: ["update:open"],
  template:
    '<div><div @click="$emit(\'update:open\', !open)"><slot name="trigger" /></div><slot v-if="open" /></div>',
};
const dt = (id: string) => `[data-test="${id}"]`;

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

const mountControl = (props: Record<string, unknown> = {}) => {
  wrapper = mount(FunnelBreakdownControl, {
    props: {
      def: DEF,
      dims: [{ dim: "browser", label: "Browser" }],
      fields: ["geo_info_country", "usr_id", PAY, "context_plan"],
      sample: SAMPLE,
      sampleState: "ok",
      start: null,
      stepNames: ["product_viewed", "payment_info_submitted", "order_completed"],
      ...props,
    },
    global: {
      stubs: {
        OPopover: popoverStub,
        ODropdown: { template: '<div><slot name="trigger" /><slot /></div>' },
        ODropdownItem: {
          emits: ["select"],
          template: "<button @click=\"$emit('select')\"><slot /></button>",
        },
      },
    },
    attachTo: document.body,
  });
  return wrapper;
};
const openPicker = async (w: VueWrapper) => {
  await w.find(dt("rum-analytics-funnel-breakdown-select")).trigger("click");
};
const row = (w: VueWrapper, id: string) => w.find(dt(`rum-analytics-funnel-field-picker-${id}`));
const lastDef = (w: VueWrapper) => (w.emitted("update:def") as [FunnelDef][]).at(-1)![0];

describe("FunnelBreakdownControl", () => {
  it("reads Breakdown: None and asks for the step fields when the picker opens", async () => {
    const w = mountControl();
    expect(w.find(dt("rum-analytics-funnel-breakdown-select")).text()).toMatch(
      /^Breakdown:\s*None$/,
    );
    await openPicker(w);
    expect(w.emitted("load-fields")).toHaveLength(1);
  });

  it("bands fields: on these steps with step and values, key fields, user disabled, and all fields", async () => {
    const w = mountControl();
    await openPicker(w);
    const text = w.find(dt("rum-analytics-funnel-field-picker")).text();
    expect(text).toContain("On these steps (1)");
    expect(text).toContain("Key fields (1)");
    expect(text).toContain("User (1)");
    expect(text).toContain("All fields (1)");
    expect(row(w, `field-${PAY}`).text()).toContain("Step 2 · card, upi, cod +1");
    expect(row(w, "field-context_plan").exists()).toBe(true);
    expect(row(w, "field-geo_info_country").exists()).toBe(false);
  });

  it("search narrows the list; picking an attribute writes an automatic breakdown and closes", async () => {
    const w = mountControl();
    await openPicker(w);
    await w.find(`${dt("o-field-list-search")} input`).setValue("pay");
    expect(row(w, "dim-browser").exists()).toBe(false);
    await row(w, `field-${PAY}`).trigger("click");
    expect(lastDef(w).breakdown).toEqual({ f: PAY });
    expect(w.find(dt("rum-analytics-funnel-field-picker")).exists()).toBe(false);
  });

  it("picking a key field keeps today's built-in breakdown", async () => {
    const w = mountControl();
    await openPicker(w);
    await row(w, "dim-browser").trigger("click");
    expect(lastDef(w).breakdown).toBe("browser");
  });

  it("a user field is shown but cannot be picked", async () => {
    const w = mountControl();
    await openPicker(w);
    await row(w, "field-usr_id").trigger("click");
    expect(w.emitted("update:def")).toBeUndefined();
  });

  it("after a pick shows the field and From step k, whose menu writes bs or goes back to automatic", async () => {
    const w = mountControl({ def: { ...DEF, breakdown: { f: PAY } }, start: START });
    expect(w.find(dt("rum-analytics-funnel-breakdown-select")).text()).toMatch(
      new RegExp(`^Breakdown:\\s*${PAY}$`),
    );
    expect(w.find(dt("rum-analytics-funnel-breakdown-from-step")).text()).toBe("From step 2");
    expect(w.find(dt("rum-analytics-funnel-breakdown-from-auto")).text()).toBe(
      "Automatic (step 2)",
    );
    expect(w.find(dt("rum-analytics-funnel-breakdown-from-3")).text()).toBe(
      "Step 3 · order_completed",
    );
    await w.find(dt("rum-analytics-funnel-breakdown-from-3")).trigger("click");
    expect(lastDef(w).breakdown).toEqual({ f: PAY, s: 3 });
    await w.setProps({ def: { ...DEF, breakdown: { f: PAY, s: 3 } } });
    await w.find(dt("rum-analytics-funnel-breakdown-from-auto")).trigger("click");
    expect(lastDef(w).breakdown).toEqual({ f: PAY });
  });

  it("from any step names the share that carries a value", () => {
    const w = mountControl({
      def: { ...DEF, breakdown: { f: PAY } },
      start: { step: 1, pinned: false, anyStep: true, covered: 12, reached: 100, auto: null },
    });
    expect(w.find(dt("rum-analytics-funnel-breakdown-from-step")).text()).toBe(
      "From any step · 12.0% set",
    );
  });

  it("a built-in breakdown has no From step menu, and the clear removes any breakdown", async () => {
    const w = mountControl({ def: { ...DEF, breakdown: "browser" } });
    expect(w.find(dt("rum-analytics-funnel-breakdown-select")).text()).toMatch(
      /^Breakdown:\s*Browser$/,
    );
    expect(w.find(dt("rum-analytics-funnel-breakdown-from-step")).exists()).toBe(false);
    await w.find(dt("rum-analytics-funnel-breakdown-clear")).trigger("click");
    expect(lastDef(w).breakdown).toBeNull();
  });

  it("says while the step fields are still being read", async () => {
    const w = mountControl({ sample: null, sampleState: "loading" });
    await openPicker(w);
    expect(w.find(dt("rum-analytics-funnel-field-picker-note")).text()).toBe(
      "Reading the fields on this funnel's steps…",
    );
  });
});
