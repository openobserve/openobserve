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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import FunnelBreakdownControl from "./FunnelBreakdownControl.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
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
  props: ["open", "side"],
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
const SECTION = "rum-analytics-funnel-breakdown-section";
const ADD = "rum-analytics-funnel-add-breakdown-btn";
const CHIP = "rum-analytics-funnel-breakdown-chip";
const PICKER = "rum-analytics-funnel-field-picker";
const openPicker = async (w: VueWrapper) => {
  await w.find(dt(ADD)).trigger("click");
};
const openForStep = async (w: VueWrapper, k: number) => {
  (w.vm as unknown as { openForStep: (k: number) => void }).openForStep(k);
  await w.vm.$nextTick();
};
const row = (w: VueWrapper, id: string) => w.find(dt(`rum-analytics-funnel-field-picker-${id}`));
const lastDef = (w: VueWrapper) => (w.emitted("update:def") as [FunnelDef][]).at(-1)![0];
const removeBtn = (w: VueWrapper) => w.find(dt(CHIP)).find('button[aria-label="Remove breakdown"]');

describe("FunnelBreakdownControl, the rail's Breakdown section", () => {
  it("is a titled section with a caption and a +, with no chip and no toolbar select", () => {
    const w = mountControl();
    const section = w.find(dt(SECTION));
    expect(section.exists()).toBe(true);
    expect(section.text()).toContain("Breakdown");
    expect(
      section
        .find('[aria-label="Split every step by one field, such as browser or payment method"]')
        .exists(),
    ).toBe(true);
    expect(section.find(dt(ADD)).exists()).toBe(true);
    expect(w.find(dt("rum-analytics-funnel-breakdown-select")).exists()).toBe(false);
    expect(w.find(dt(CHIP)).exists()).toBe(false);
  });

  it("the + opens the picker beside the rail and asks for the step fields", async () => {
    const w = mountControl();
    await openPicker(w);
    expect(w.find(dt(PICKER)).exists()).toBe(true);
    expect(w.emitted("load-fields")).toHaveLength(1);
    expect(w.findComponent(popoverStub).props("side")).toBe("right");
  });

  it("bands fields: on these steps with step and values, key fields, user disabled, and all fields", async () => {
    const w = mountControl();
    await openPicker(w);
    const text = w.find(dt(PICKER)).text();
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
    expect(w.find(dt(PICKER)).exists()).toBe(false);
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

  it("a set breakdown is one chip; the + is greyed with One breakdown at a time", async () => {
    const w = mountControl({ def: { ...DEF, breakdown: "browser" } });
    expect(w.find(dt(CHIP)).text()).toContain("Browser");
    const add = w.find(dt(ADD));
    expect(add.attributes("disabled")).toBeDefined();
    expect(
      w.findAllComponents(OTooltip).some((c) => c.props("content") === "One breakdown at a time"),
    ).toBe(true);
    await add.trigger("click");
    expect(w.find(dt(PICKER)).exists()).toBe(false);
  });

  it("clicking the chip reopens the picker to change the field", async () => {
    const w = mountControl({ def: { ...DEF, breakdown: "browser" } });
    await w.find(dt(CHIP)).trigger("click");
    expect(w.find(dt(PICKER)).exists()).toBe(true);
    expect(w.emitted("load-fields")).toHaveLength(1);
    await row(w, `field-${PAY}`).trigger("click");
    expect(lastDef(w).breakdown).toEqual({ f: PAY });
  });

  it("keeps keyboard focus in the section after a pick and after a remove", async () => {
    const w: VueWrapper = mountControl({
      "onUpdate:def": (d: FunnelDef) => w.setProps({ def: d }),
    });
    await openPicker(w);
    await row(w, "dim-browser").trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(w.find(dt(CHIP)).element);
    await removeBtn(w).trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(w.find(dt(ADD)).element);
  });

  it("the chip's remove control clears the breakdown", async () => {
    const w = mountControl({ def: { ...DEF, breakdown: "browser" } });
    expect(removeBtn(w).exists()).toBe(true);
    await removeBtn(w).trigger("click");
    expect(lastDef(w).breakdown).toBeNull();
    expect(w.find(dt(PICKER)).exists()).toBe(false);
  });

  it("a field breakdown shows Value from under the chip, writing bs or going back to automatic", async () => {
    const w = mountControl({ def: { ...DEF, breakdown: { f: PAY } }, start: START });
    expect(w.find(dt(CHIP)).text()).toContain(PAY);
    const from = w.find(dt("rum-analytics-funnel-breakdown-from-step"));
    expect(from.text()).toBe("From step 2");
    expect(
      w.find(dt(CHIP)).element.compareDocumentPosition(from.element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

  it("a key-field breakdown has no Value from", () => {
    const w = mountControl({ def: { ...DEF, breakdown: "browser" } });
    expect(w.find(dt("rum-analytics-funnel-breakdown-from-step")).exists()).toBe(false);
  });

  it("opened for a step, lists only that step's fields and pins the pick to it", async () => {
    const w = mountControl();
    await openForStep(w, 3);
    const text = w.find(dt(PICKER)).text();
    expect(text).toContain("On step 3 (1)");
    expect(text).not.toContain("Key fields");
    expect(row(w, `field-${PAY}`).text()).toContain("card, upi, cod +1");
    await row(w, `field-${PAY}`).trigger("click");
    expect(lastDef(w).breakdown).toEqual({ f: PAY, s: 3 });
    await openPicker(w);
    expect(w.find(dt(PICKER)).text()).toContain("Key fields");
  });

  it("opened for a step the sample saw nothing on, says so", async () => {
    const w = mountControl();
    await openForStep(w, 1);
    expect(w.find(dt("rum-analytics-funnel-field-picker-note")).text()).toBe(
      "No fields seen on this step",
    );
  });

  it("says while the step fields are still being read", async () => {
    const w = mountControl({ sample: null, sampleState: "loading" });
    await openPicker(w);
    expect(w.find(dt("rum-analytics-funnel-field-picker-note")).text()).toBe(
      "Reading the fields on this funnel's steps…",
    );
  });
});
