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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { computed, h } from "vue";
import i18n from "@/locales";

// ---------------------------------------------------------------------------
// Component analysis
// ---------------------------------------------------------------------------
// Component: ErrorsFilterBar
// Path: src/components/rum/errorTracking/list/ErrorsFilterBar.vue
// Props:
//   status: "all" | "new" | "ongoing"
//   type: "all" | "unhandled" | "handled"
//   service: string  ("" = all services)
//   services: string[]
//   counts: { new, ongoing, unhandled, handled }
// Emits:
//   "update:status" (IssueStatusFilter)
//   "update:type" (IssueTypeFilter)
//   "update:service" (string)
// Slots: none
// Store deps: none
// Service deps: none
//
// Child components:
//   OToggleGroup + OToggleGroupItem — reka-ui backed, rendered as <button>s
//   OSelect — complex popover/virtualised component
//
// Testing strategy:
//   OToggleGroup/OToggleGroupItem and OSelect are stubbed with minimal
//   implementations that:
//     • Preserve all data-test attributes needed by the tests
//     • Expose the `model-value` and `options` props for inspection
//     • Emit `update:model-value` when their action elements are triggered
//   This keeps tests deterministic and free from reka-ui / JSDOM portal issues
//   while still exercising the component's wiring logic.
//
// Conditional states:
//   - counts included in chip text
//   - emit guard: `v && emit(...)` prevents emit when toggle deselected (null/falsy)
// ---------------------------------------------------------------------------

import ErrorsFilterBar from "./ErrorsFilterBar.vue";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/**
 * OToggleGroup stub — renders a wrapper div and forwards the update event
 * when a child OToggleGroupItem button is clicked.
 *
 * The real OToggleGroup emits `update:modelValue` via reka-ui's ToggleGroupRoot.
 * Our stub emits it directly when any descendant item triggers it via the
 * `requestToggle` custom event that OToggleGroupItem stub dispatches.
 */
const OToggleGroupStub = {
  name: "OToggleGroup",
  template: `
    <div
      :data-toggle-group-value="modelValue"
      @request-toggle="$emit('update:modelValue', $event.detail)"
    >
      <slot />
    </div>
  `,
  props: ["modelValue", "type", "label", "labelPosition"],
  emits: ["update:modelValue"],
};

/**
 * OToggleGroupItem stub — renders as a <button> with the data-test attribute
 * forwarded from $attrs. Clicking it dispatches a `request-toggle` event
 * that the parent OToggleGroup stub intercepts.
 */
const OToggleGroupItemStub = {
  name: "OToggleGroupItem",
  template: `
    <button
      v-bind="$attrs"
      type="button"
      @click="handleClick"
    ><slot /></button>
  `,
  props: ["value", "size"],
  inheritAttrs: false,
  setup(props: { value: string }, { attrs }: any) {
    function handleClick(e: MouseEvent) {
      const el = e.currentTarget as HTMLElement;
      el.dispatchEvent(
        new CustomEvent("request-toggle", {
          detail: props.value,
          bubbles: true,
        }),
      );
    }
    return { handleClick };
  },
};

/**
 * OSelect stub — renders a wrapper div with:
 *   - data-test attribute from $attrs
 *   - a hidden <select> element wired to emit update:modelValue
 *   - renders one <option> per entry in the options prop
 */
const OSelectStub = {
  name: "OSelect",
  template: `
    <div v-bind="nonDataTestAttrs">
      <select
        :data-test="dataTestAttr ? dataTestAttr + '-native' : undefined"
        :value="modelValue"
        @change="$emit('update:modelValue', $event.target.value)"
      >
        <option
          v-for="opt in normalizedOptions"
          :key="opt.value"
          :value="opt.value"
        >{{ opt.label }}</option>
      </select>
    </div>
  `,
  props: ["modelValue", "options", "size"],
  inheritAttrs: false,
  emits: ["update:modelValue"],
  setup(props: { options?: Array<{ label: string; value: string } | string> }, { attrs }: any) {
    const dataTestAttr = attrs["data-test"] as string | undefined;
    const { "data-test": _dt, ...nonDataTestAttrs } = attrs;
    // Expose data-test on the div too so findComponent selectors can find it
    if (dataTestAttr) {
      nonDataTestAttrs["data-test"] = dataTestAttr;
    }
    // computed so the option list tracks later `services` prop updates
    const normalizedOptions = computed(() =>
      (props.options ?? []).map((o: any) =>
        typeof o === "string"
          ? { label: o, value: o }
          : { label: o.label ?? String(o.value), value: String(o.value) },
      ),
    );
    return { dataTestAttr, nonDataTestAttrs, normalizedOptions };
  },
};

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------

const defaultCounts = { new: 3, ongoing: 7, unhandled: 12, handled: 5 };
const defaultServices = ["auth-service", "payment-service"];

function mountFilterBar(
  props: Record<string, unknown> = {},
): VueWrapper {
  return mount(ErrorsFilterBar, {
    props: {
      status: "all",
      type: "all",
      service: "",
      services: defaultServices,
      counts: defaultCounts,
      ...props,
    },
    global: {
      plugins: [i18n],
      stubs: {
        OToggleGroup: OToggleGroupStub,
        OToggleGroupItem: OToggleGroupItemStub,
        OSelect: OSelectStub,
      },
    },
  });
}

describe("ErrorsFilterBar", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    wrapper = mountFilterBar();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // rendering — root element
  // -------------------------------------------------------------------------

  describe("rendering", () => {
    it("renders the root filter bar element", () => {
      expect(wrapper.find('[data-test="rum-errors-filter-bar"]').exists()).toBe(
        true,
      );
    });

    it("renders the status toggle group with All, New, and Ongoing items", () => {
      expect(
        wrapper.find('[data-test="rum-errors-filter-status-all"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="rum-errors-filter-status-new"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="rum-errors-filter-status-ongoing"]')
          .exists(),
      ).toBe(true);
    });

    it("renders the type toggle group with All, Unhandled, and Handled items", () => {
      expect(
        wrapper.find('[data-test="rum-errors-filter-type-all"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="rum-errors-filter-type-unhandled"]')
          .exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="rum-errors-filter-type-handled"]').exists(),
      ).toBe(true);
    });

    it("renders the service select element", () => {
      expect(
        wrapper
          .find('[data-test="rum-errors-filter-service-select"]')
          .exists(),
      ).toBe(true);
    });

    it("renders a label element for the service select", () => {
      expect(wrapper.find('label[for="rum-errors-filter-service"]').exists()).toBe(
        true,
      );
    });

    it("service label contains 'Service' text", () => {
      expect(
        wrapper.find('label[for="rum-errors-filter-service"]').text(),
      ).toContain("Service");
    });
  });

  // -------------------------------------------------------------------------
  // count labels in toggle items
  // -------------------------------------------------------------------------

  describe("count labels in toggle items", () => {
    it("includes count 3 in the New status chip text", () => {
      expect(
        wrapper.find('[data-test="rum-errors-filter-status-new"]').text(),
      ).toContain("· 3");
    });

    it("includes count 7 in the Ongoing status chip text", () => {
      expect(
        wrapper.find('[data-test="rum-errors-filter-status-ongoing"]').text(),
      ).toContain("· 7");
    });

    it("includes count 12 in the Unhandled type chip text", () => {
      expect(
        wrapper.find('[data-test="rum-errors-filter-type-unhandled"]').text(),
      ).toContain("· 12");
    });

    it("includes count 5 in the Handled type chip text", () => {
      expect(
        wrapper.find('[data-test="rum-errors-filter-type-handled"]').text(),
      ).toContain("· 5");
    });

    it("updates New count chip when counts.new prop changes", async () => {
      await wrapper.setProps({
        counts: { ...defaultCounts, new: 99 },
      });

      expect(
        wrapper.find('[data-test="rum-errors-filter-status-new"]').text(),
      ).toContain("· 99");
    });

    it("New status item contains status label 'New' followed by count", () => {
      const text = wrapper
        .find('[data-test="rum-errors-filter-status-new"]')
        .text();

      expect(text).toContain("New");
      expect(text).toContain("3");
    });

    it("Ongoing status item contains status label 'Ongoing' followed by count", () => {
      const text = wrapper
        .find('[data-test="rum-errors-filter-status-ongoing"]')
        .text();

      expect(text).toContain("Ongoing");
      expect(text).toContain("7");
    });

    it("Unhandled type item contains type label 'Unhandled' followed by count", () => {
      const text = wrapper
        .find('[data-test="rum-errors-filter-type-unhandled"]')
        .text();

      expect(text).toContain("Unhandled");
      expect(text).toContain("12");
    });

    it("Handled type item contains type label 'Handled' followed by count", () => {
      const text = wrapper
        .find('[data-test="rum-errors-filter-type-handled"]').text();

      expect(text).toContain("Handled");
      expect(text).toContain("5");
    });
  });

  // -------------------------------------------------------------------------
  // status toggle interactions
  // -------------------------------------------------------------------------

  describe("status toggle interactions", () => {
    it("emits update:status with 'new' when the New item is clicked", async () => {
      await wrapper
        .find('[data-test="rum-errors-filter-status-new"]')
        .trigger("click");

      expect(wrapper.emitted("update:status")).toBeTruthy();
      expect(wrapper.emitted("update:status")![0]).toEqual(["new"]);
    });

    it("emits update:status with 'ongoing' when the Ongoing item is clicked", async () => {
      await wrapper
        .find('[data-test="rum-errors-filter-status-ongoing"]')
        .trigger("click");

      expect(wrapper.emitted("update:status")![0]).toEqual(["ongoing"]);
    });

    it("emits update:status with 'all' when the All status item is clicked", async () => {
      // Start with status='new' so clicking All changes it
      const w = mountFilterBar({ status: "new" });

      await w.find('[data-test="rum-errors-filter-status-all"]').trigger("click");

      expect(w.emitted("update:status")).toBeTruthy();
      expect(w.emitted("update:status")![0]).toEqual(["all"]);

      w.unmount();
    });

    it("does not emit update:status when the toggle emits a falsy value", async () => {
      // The component guard is: `(v: any) => v && emit('update:status', v)`
      // Simulate the OToggleGroup emitting null (Reka deselect behaviour)
      // by triggering the underlying toggle group stub with a null event.
      // We verify by checking the emitted events are absent after a null detail.
      const toggleGroup = wrapper.findComponent(OToggleGroupStub);
      // Emit from the stub as if Reka sent null/undefined
      await toggleGroup.vm.$emit("update:modelValue", null);

      expect(wrapper.emitted("update:status")).toBeFalsy();
    });

    it("does not emit update:status with an empty string when the toggle emits ''", async () => {
      const statusToggles = wrapper.findAllComponents(OToggleGroupStub);
      // First toggle group is status
      await statusToggles[0].vm.$emit("update:modelValue", "");

      expect(wrapper.emitted("update:status")).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // type toggle interactions
  // -------------------------------------------------------------------------

  describe("type toggle interactions", () => {
    it("emits update:type with 'unhandled' when the Unhandled item is clicked", async () => {
      await wrapper
        .find('[data-test="rum-errors-filter-type-unhandled"]')
        .trigger("click");

      expect(wrapper.emitted("update:type")).toBeTruthy();
      expect(wrapper.emitted("update:type")![0]).toEqual(["unhandled"]);
    });

    it("emits update:type with 'handled' when the Handled item is clicked", async () => {
      await wrapper
        .find('[data-test="rum-errors-filter-type-handled"]')
        .trigger("click");

      expect(wrapper.emitted("update:type")![0]).toEqual(["handled"]);
    });

    it("emits update:type with 'all' when the All type item is clicked", async () => {
      const w = mountFilterBar({ type: "handled" });

      await w
        .find('[data-test="rum-errors-filter-type-all"]')
        .trigger("click");

      expect(w.emitted("update:type")![0]).toEqual(["all"]);

      w.unmount();
    });

    it("does not emit update:type when the toggle emits a falsy value", async () => {
      const toggleGroups = wrapper.findAllComponents(OToggleGroupStub);
      // Second toggle group is type
      await toggleGroups[1].vm.$emit("update:modelValue", null);

      expect(wrapper.emitted("update:type")).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // service select
  // -------------------------------------------------------------------------

  describe("service select", () => {
    it("renders an 'All' option in the service select", () => {
      const select = wrapper.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );
      const options = select.findAll("option");

      expect(options[0].text()).toBe("All");
      // Sentinel value — OSelect treats "" as "no selection", so the All
      // option carries "__all__" internally; the component still emits "".
      expect((options[0].element as HTMLOptionElement).value).toBe("__all__");
    });

    it("renders one option per entry in the services prop", () => {
      const select = wrapper.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );
      const options = select.findAll("option");

      // 1 "All" option + 2 services
      expect(options).toHaveLength(3);
    });

    it("renders auth-service as an option in the select", () => {
      const select = wrapper.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );

      const texts = select.findAll("option").map((o) => o.text());
      expect(texts).toContain("auth-service");
    });

    it("renders payment-service as an option in the select", () => {
      const select = wrapper.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );

      const texts = select.findAll("option").map((o) => o.text());
      expect(texts).toContain("payment-service");
    });

    it("emits update:service with service name when a service is selected", async () => {
      const select = wrapper.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );

      await select.setValue("auth-service");

      expect(wrapper.emitted("update:service")).toBeTruthy();
      expect(wrapper.emitted("update:service")![0]).toEqual(["auth-service"]);
    });

    it("emits update:service with empty string when 'All' is selected", async () => {
      const w = mountFilterBar({ service: "auth-service" });

      const select = w.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );

      await select.setValue("");

      expect(w.emitted("update:service")![0]).toEqual([""]);

      w.unmount();
    });

    it("shows only All option when services array is empty", () => {
      const w = mountFilterBar({ services: [] });

      const select = w.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );
      const options = select.findAll("option");

      expect(options).toHaveLength(1);
      expect(options[0].text()).toBe("All");

      w.unmount();
    });

    it("renders a single service plus All when services has one entry", () => {
      const w = mountFilterBar({ services: ["my-service"] });

      const select = w.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );
      const options = select.findAll("option");

      expect(options).toHaveLength(2);

      w.unmount();
    });
  });

  // -------------------------------------------------------------------------
  // props reactivity
  // -------------------------------------------------------------------------

  describe("props reactivity", () => {
    it("updates the services list when services prop changes", async () => {
      await wrapper.setProps({ services: ["new-svc-a", "new-svc-b", "new-svc-c"] });

      const select = wrapper.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );
      const texts = select.findAll("option").map((o) => o.text());

      expect(texts).toContain("new-svc-a");
      expect(texts).toContain("new-svc-c");
      expect(select.findAll("option")).toHaveLength(4); // All + 3
    });

    it("updates Unhandled count label when counts.unhandled prop changes", async () => {
      await wrapper.setProps({
        counts: { ...defaultCounts, unhandled: 55 },
      });

      expect(
        wrapper.find('[data-test="rum-errors-filter-type-unhandled"]').text(),
      ).toContain("· 55");
    });
  });

  // -------------------------------------------------------------------------
  // edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("renders without crashing when all counts are zero", () => {
      const w = mountFilterBar({
        counts: { new: 0, ongoing: 0, unhandled: 0, handled: 0 },
      });

      expect(w.find('[data-test="rum-errors-filter-bar"]').exists()).toBe(true);
      expect(
        w.find('[data-test="rum-errors-filter-status-new"]').text(),
      ).toContain("· 0");

      w.unmount();
    });

    it("renders with a large count value without overflow", () => {
      const w = mountFilterBar({
        counts: { new: 10000, ongoing: 0, unhandled: 0, handled: 0 },
      });

      expect(
        w.find('[data-test="rum-errors-filter-status-new"]').text(),
      ).toContain("· 10000");

      w.unmount();
    });

    it("renders service names with special characters", () => {
      const w = mountFilterBar({
        services: ["api-gateway_v2", "web-app.prod"],
      });

      const select = w.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );
      const texts = select.findAll("option").map((o) => o.text());

      expect(texts).toContain("api-gateway_v2");
      expect(texts).toContain("web-app.prod");

      w.unmount();
    });

    it("handles unicode service names gracefully", () => {
      const w = mountFilterBar({ services: ["サービス-A", "сервис-B"] });

      const select = w.find(
        '[data-test="rum-errors-filter-service-select"] select',
      );
      const texts = select.findAll("option").map((o) => o.text());

      expect(texts).toContain("サービス-A");

      w.unmount();
    });

    it("All status chip text contains only 'All' without a count", () => {
      // The "All" status item has no count appended in the template
      const text = wrapper
        .find('[data-test="rum-errors-filter-status-all"]')
        .text();

      expect(text.trim()).toBe("All");
    });

    it("All type chip text contains only 'All' without a count", () => {
      const text = wrapper
        .find('[data-test="rum-errors-filter-type-all"]')
        .text();

      expect(text.trim()).toBe("All");
    });
  });

  // -------------------------------------------------------------------------
  // emitted events — no spurious fires
  // -------------------------------------------------------------------------

  describe("emitted events — no spurious fires", () => {
    it("does not emit any event on initial mount", () => {
      const freshWrapper = mountFilterBar();

      expect(freshWrapper.emitted("update:status")).toBeFalsy();
      expect(freshWrapper.emitted("update:type")).toBeFalsy();
      expect(freshWrapper.emitted("update:service")).toBeFalsy();

      freshWrapper.unmount();
    });

    it("emits only update:status and not update:type when a status item is clicked", async () => {
      await wrapper
        .find('[data-test="rum-errors-filter-status-new"]')
        .trigger("click");

      expect(wrapper.emitted("update:status")).toBeTruthy();
      expect(wrapper.emitted("update:type")).toBeFalsy();
    });

    it("emits only update:type and not update:status when a type item is clicked", async () => {
      await wrapper
        .find('[data-test="rum-errors-filter-type-handled"]')
        .trigger("click");

      expect(wrapper.emitted("update:type")).toBeTruthy();
      expect(wrapper.emitted("update:status")).toBeFalsy();
    });
  });
});
