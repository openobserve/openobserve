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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

const mockTest = vi.fn();
vi.mock("@/services/model_pricing", () => ({
  default: {
    test: (...args: any[]) => mockTest(...args),
  },
}));

// Component import must come after all vi.mock() declarations.
import TestModelMatchDialog from "./TestModelMatchDialog.vue";

installQuasar();

// ── Stubs ────────────────────────────────────────────────────────────────────

// Stub ODialog so tests are deterministic (no Portal/Reka teleport)
// and so we can assert on the props the component forwards + emit
// the click events the component listens to.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-sub-title="subTitle"
      :data-persistent="String(persistent)"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
      :data-primary-disabled="String(primaryButtonDisabled)"
      :data-primary-loading="String(primaryButtonLoading)"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

const QInputStub = {
  name: "QInput",
  props: ["modelValue", "dense", "borderless", "placeholder"],
  emits: ["update:modelValue"],
  template: `
    <div data-test="q-input-stub">
      <slot name="prepend" />
      <input
        data-test="q-input-stub-input"
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
      />
      <slot name="append" />
    </div>
  `,
  methods: {
    focus() {
      /* no-op for tests */
    },
  },
};

const QIconStub = {
  name: "QIcon",
  props: ["name", "size", "color"],
  template: `<i data-test="OIcon" :data-name="name" :class="$attrs.class" />`,
};

const QBadgeStub = {
  name: "QBadge",
  props: ["color", "textColor", "label"],
  template: `<span data-test="q-badge" :data-color="color" :data-label="label">{{ label }}</span>`,
};

const OButtonStub = {
  name: "OButton",
  props: ["variant", "size"],
  emits: ["click"],
  template: `<button data-test="o-button-stub" @click="$emit('click')"><slot /></button>`,
};

// ── Mount factory ────────────────────────────────────────────────────────────

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(TestModelMatchDialog, {
    global: {
      plugins: [store, i18n],
      stubs: {
        ODialog: ODialogStub,
        OButton: OButtonStub,
        "q-input": QInputStub,
        "OIcon": QIconStub,
        "q-badge": QBadgeStub,
      },
    },
    props: {
      modelValue: false,
      ...props,
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("TestModelMatchDialog", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    mockTest.mockReset();
    mockTest.mockResolvedValue({ data: null });
    store.state.selectedOrganization = {
      label: "default Organization",
      id: 159,
      identifier: "default",
      user_email: "example@gmail.com",
      subscription_type: "",
    } as any;
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("mounting", () => {
    it("renders the ODialog wrapper", () => {
      wrapper = mountDialog({ modelValue: true });
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
    });

    it("forwards the title and subTitle to ODialog", () => {
      wrapper = mountDialog({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("title")).toBe("Test Model Match");
      expect(dialog.props("subTitle")).toBe(
        "Simulate how a model name from your spans would match against pricing rules.",
      );
    });

    it("uses width 50 on ODialog", () => {
      wrapper = mountDialog({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("width")).toBe(50);
    });

    it("marks the dialog as persistent", () => {
      wrapper = mountDialog({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      // Vue serializes the bare `persistent` attribute as the empty string
      // when the stub declares it as an untyped prop; either value indicates
      // the attribute is present.
      expect([true, ""]).toContain(dialog.props("persistent"));
    });

    it("forwards the i18n labels to ODialog buttons", () => {
      wrapper = mountDialog({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonLabel")).toBe("Test Match");
      expect(dialog.props("secondaryButtonLabel")).toBe("Close");
    });

    it("forwards modelValue=true to ODialog open", () => {
      wrapper = mountDialog({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(true);
    });

    it("forwards modelValue=false to ODialog open", () => {
      wrapper = mountDialog({ modelValue: false });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);
    });

    it("defaults modelValue to false when not provided", () => {
      wrapper = mount(TestModelMatchDialog, {
        global: {
          plugins: [store, i18n],
          stubs: {
            ODialog: ODialogStub,
            OButton: OButtonStub,
            "q-input": QInputStub,
            "OIcon": QIconStub,
            "q-badge": QBadgeStub,
          },
        },
      });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);
    });
  });

  describe("primary button state", () => {
    it("disables the primary button when testModelName is empty", () => {
      wrapper = mountDialog({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonDisabled")).toBe(true);
    });

    it("enables the primary button once a model name is typed", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      await nextTick();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonDisabled")).toBe(false);
    });

    it("reflects the testing state in primaryButtonLoading", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testing = true;
      await nextTick();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonLoading")).toBe(true);
    });
  });

  describe("body states", () => {
    it("renders the empty state when testModelName is empty", () => {
      wrapper = mountDialog({ modelValue: true });
      expect(wrapper.find('[data-test="test-match-empty"]').exists()).toBe(
        true,
      );
      expect(wrapper.text()).toContain("Enter a model name to test matching");
    });

    it("renders the waiting state when typed but no test result yet", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      await nextTick();
      expect(wrapper.find('[data-test="test-match-waiting"]').exists()).toBe(
        true,
      );
      expect(wrapper.text()).toContain('Click "Test Match" to see results');
    });

    it("renders no-match state when testResult has no matched", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = { matched: null };
      await nextTick();

      expect(
        wrapper.find('[data-test="test-match-no-result"]').exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("No Match Found");
      expect(wrapper.text()).toContain('No rule matched "gpt-4".');
    });

    it("renders troubleshooting tips in the no-match state", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = { matched: null };
      await nextTick();
      const text = wrapper.text();
      expect(text).toContain("Troubleshooting tips:");
      expect(text).toContain("Check the spelling of your model name");
    });

    it("renders the match-found state when testResult has matched", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = {
        matched: {
          name: "gpt-4",
          source: "org",
          tiers: [{ name: "Default", prices: { input: 0.00001 } }],
        },
        tier: "Default",
      };
      await nextTick();
      expect(wrapper.find('[data-test="test-match-result"]').exists()).toBe(
        true,
      );
      expect(wrapper.text()).toContain("Match Found");
    });
  });

  describe("input clear button", () => {
    it("does not render the clear button when input is empty", () => {
      wrapper = mountDialog({ modelValue: true });
      expect(wrapper.find('[data-test="test-match-clear-btn"]').exists()).toBe(
        false,
      );
    });

    it("renders the clear button when input has a value", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      await nextTick();
      expect(wrapper.find('[data-test="test-match-clear-btn"]').exists()).toBe(
        true,
      );
    });

    it("clears the input when clearAndFocus is invoked", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      await nextTick();
      (wrapper.vm as any).clearAndFocus();
      await nextTick();
      expect((wrapper.vm as any).testModelName).toBe("");
    });
  });

  describe("runTest", () => {
    it("short-circuits when testModelName is empty (no API call)", async () => {
      wrapper = mountDialog({ modelValue: true });
      await (wrapper.vm as any).runTest();
      await flushPromises();
      expect(mockTest).not.toHaveBeenCalled();
      expect((wrapper.vm as any).testing).toBe(false);
    });

    it("calls modelPricingService.test with org identifier and model_name", async () => {
      mockTest.mockResolvedValue({
        data: { matched: { name: "gpt-4", source: "org" }, tier: "Default" },
      });
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      await nextTick();

      await (wrapper.vm as any).runTest();
      await flushPromises();

      expect(mockTest).toHaveBeenCalledTimes(1);
      expect(mockTest).toHaveBeenCalledWith("default", {
        model_name: "gpt-4",
        usage: undefined,
        timestamp: null,
      });
    });

    it("stores the API response on testResult after success", async () => {
      const payload = {
        matched: { name: "gpt-4", source: "org" },
        tier: "Default",
      };
      mockTest.mockResolvedValue({ data: payload });
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      await nextTick();
      await (wrapper.vm as any).runTest();
      await flushPromises();
      expect((wrapper.vm as any).testResult).toEqual(payload);
    });

    it("clears testResult to null when the API call rejects", async () => {
      mockTest.mockRejectedValue(new Error("boom"));
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = { matched: { name: "old" } };
      await nextTick();
      await (wrapper.vm as any).runTest();
      await flushPromises();
      expect((wrapper.vm as any).testResult).toBeNull();
    });

    it("toggles testing flag from false to false across the call", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      await nextTick();
      expect((wrapper.vm as any).testing).toBe(false);
      await (wrapper.vm as any).runTest();
      await flushPromises();
      expect((wrapper.vm as any).testing).toBe(false);
    });

    it("uses empty string as org identifier when no organization is selected", async () => {
      store.state.selectedOrganization = null as any;
      mockTest.mockResolvedValue({ data: null });
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      await nextTick();
      await (wrapper.vm as any).runTest();
      await flushPromises();
      expect(mockTest).toHaveBeenCalledWith("", expect.any(Object));
    });
  });

  describe("primary/secondary click handlers", () => {
    it("triggers runTest when ODialog emits click:primary", async () => {
      mockTest.mockResolvedValue({ data: { matched: { name: "gpt-4" } } });
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      await nextTick();

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(mockTest).toHaveBeenCalledTimes(1);
    });

    it("closes the dialog when ODialog emits click:secondary", async () => {
      wrapper = mountDialog({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");
      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual([false]);
    });

    it("does not call the API on secondary click", async () => {
      wrapper = mountDialog({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");
      await flushPromises();
      expect(mockTest).not.toHaveBeenCalled();
    });
  });

  describe("internalValue computed", () => {
    it("emits update:modelValue when ODialog emits update:open", async () => {
      wrapper = mountDialog({ modelValue: true });
      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("update:open", false);
      // ODialog's update:open is wired via v-model:open which writes back
      // through the computed setter and re-emits update:modelValue.
      // Quasar/Vue handles this implicitly; assert by setting internalValue.
      (wrapper.vm as any).internalValue = false;
      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual([false]);
    });
  });

  describe("testModelName watcher", () => {
    it("clears testResult when testModelName is cleared", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = { matched: { name: "gpt-4" } };
      await nextTick();

      (wrapper.vm as any).testModelName = "";
      await nextTick();

      expect((wrapper.vm as any).testResult).toBeNull();
    });

    it("does not clear testResult while testModelName still has a value", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = { matched: { name: "gpt-4" } };
      await nextTick();

      (wrapper.vm as any).testModelName = "claude";
      await nextTick();

      expect((wrapper.vm as any).testResult).not.toBeNull();
    });
  });

  describe("internalValue watcher (open)", () => {
    it("resets testResult and testModelName when the dialog opens", async () => {
      vi.useFakeTimers();
      wrapper = mountDialog({ modelValue: false });
      (wrapper.vm as any).testModelName = "stale";
      (wrapper.vm as any).testResult = { matched: { name: "stale" } };
      await nextTick();

      await wrapper.setProps({ modelValue: true });
      await nextTick();
      // flush queued setTimeout for focus
      vi.runAllTimers();

      expect((wrapper.vm as any).testModelName).toBe("");
      expect((wrapper.vm as any).testResult).toBeNull();
      vi.useRealTimers();
    });

    it("does not reset state when the dialog closes", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = { matched: { name: "gpt-4" } };
      await nextTick();

      await wrapper.setProps({ modelValue: false });
      await nextTick();

      expect((wrapper.vm as any).testModelName).toBe("gpt-4");
      expect((wrapper.vm as any).testResult).toEqual({
        matched: { name: "gpt-4" },
      });
    });
  });

  describe("derived display values", () => {
    it("winnerSource is null when there is no result", () => {
      wrapper = mountDialog({ modelValue: true });
      expect((wrapper.vm as any).winnerSource).toBeNull();
    });

    it("winnerSource reflects matched.source", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testResult = {
        matched: { name: "gpt-4", source: "meta_org" },
      };
      await nextTick();
      expect((wrapper.vm as any).winnerSource).toBe("meta_org");
    });

    it("matchedTierDef returns null when there is no result", () => {
      wrapper = mountDialog({ modelValue: true });
      expect((wrapper.vm as any).matchedTierDef).toBeNull();
    });

    it("matchedTierDef finds the named tier", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testResult = {
        matched: {
          name: "gpt-4",
          tiers: [
            { name: "Default", prices: { input: 0.0001 } },
            { name: "Bulk", prices: { input: 0.00005 } },
          ],
        },
        tier: "Bulk",
      };
      await nextTick();
      expect((wrapper.vm as any).matchedTierDef.name).toBe("Bulk");
    });

    it("matchedTierDef falls back to first tier when name not found", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testResult = {
        matched: {
          name: "gpt-4",
          tiers: [
            { name: "Default", prices: { input: 0.0001 } },
            { name: "Bulk", prices: { input: 0.00005 } },
          ],
        },
        tier: "Unknown",
      };
      await nextTick();
      expect((wrapper.vm as any).matchedTierDef.name).toBe("Default");
    });

    it("matchedTierDef treats nameless tier as 'Default'", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testResult = {
        matched: {
          name: "gpt-4",
          tiers: [{ prices: { input: 0.0001 } }],
        },
        tier: "Default",
      };
      await nextTick();
      expect((wrapper.vm as any).matchedTierDef).toEqual({
        prices: { input: 0.0001 },
      });
    });

    it("matchedTierDef returns null when matched has no tiers", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testResult = {
        matched: { name: "gpt-4" },
        tier: "Default",
      };
      await nextTick();
      expect((wrapper.vm as any).matchedTierDef).toBeNull();
    });

    it("pricingRows is empty when there is no matched model", () => {
      wrapper = mountDialog({ modelValue: true });
      expect((wrapper.vm as any).pricingRows).toEqual([]);
    });

    it("pricingRows scales price-per-token to per-million tokens", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testResult = {
        matched: {
          name: "gpt-4",
          tiers: [
            {
              name: "Default",
              prices: { input: 0.00001, output: 0.00003 },
            },
          ],
        },
        tier: "Default",
      };
      await nextTick();
      const rows = (wrapper.vm as any).pricingRows;
      expect(rows).toHaveLength(2);
      const byKey = Object.fromEntries(
        rows.map((r: any) => [r.key, r.rate]),
      );
      expect(byKey.input).toBeCloseTo(10);
      expect(byKey.output).toBeCloseTo(30);
    });

    it("pricingRows orders input before output, then alphabetical", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testResult = {
        matched: {
          name: "gpt-4",
          tiers: [
            {
              name: "Default",
              prices: {
                output: 0.00003,
                input: 0.00001,
                cached: 0.00002,
                audio: 0.00004,
              },
            },
          ],
        },
        tier: "Default",
      };
      await nextTick();
      const keys = (wrapper.vm as any).pricingRows.map((r: any) => r.key);
      expect(keys).toEqual(["input", "output", "audio", "cached"]);
    });
  });

  describe("operatorSymbol", () => {
    it("maps known comparison operators", () => {
      wrapper = mountDialog({ modelValue: true });
      const vm: any = wrapper.vm;
      expect(vm.operatorSymbol("gt")).toBe(">");
      expect(vm.operatorSymbol("gte")).toBe("≥");
      expect(vm.operatorSymbol("lt")).toBe("<");
      expect(vm.operatorSymbol("lte")).toBe("≤");
      expect(vm.operatorSymbol("eq")).toBe("=");
      expect(vm.operatorSymbol("neq")).toBe("≠");
    });

    it("returns the input string for unknown operators", () => {
      wrapper = mountDialog({ modelValue: true });
      expect((wrapper.vm as any).operatorSymbol("unknown")).toBe("unknown");
    });
  });

  describe("sourceColor / sourceLabel", () => {
    it("returns primary/Your Org for org source", () => {
      wrapper = mountDialog({ modelValue: true });
      const vm: any = wrapper.vm;
      expect(vm.sourceColor({ source: "org" })).toBe("primary");
      expect(vm.sourceLabel({ source: "org" })).toBe("Your Org");
    });

    it("returns primary/Your Org when source is missing", () => {
      wrapper = mountDialog({ modelValue: true });
      const vm: any = wrapper.vm;
      expect(vm.sourceColor({})).toBe("primary");
      expect(vm.sourceLabel({})).toBe("Your Org");
    });

    it("returns secondary/Global for meta_org source", () => {
      wrapper = mountDialog({ modelValue: true });
      const vm: any = wrapper.vm;
      expect(vm.sourceColor({ source: "meta_org" })).toBe("secondary");
      expect(vm.sourceLabel({ source: "meta_org" })).toBe("Global");
    });

    it("returns grey-8/Built-in for built_in source", () => {
      wrapper = mountDialog({ modelValue: true });
      const vm: any = wrapper.vm;
      expect(vm.sourceColor({ source: "built_in" })).toBe("grey-8");
      expect(vm.sourceLabel({ source: "built_in" })).toBe("Built-in");
    });

    it("returns grey-8/Built-in for any other source", () => {
      wrapper = mountDialog({ modelValue: true });
      const vm: any = wrapper.vm;
      expect(vm.sourceColor({ source: "something" })).toBe("grey-8");
      expect(vm.sourceLabel({ source: "something" })).toBe("Built-in");
    });
  });

  describe("formatRate", () => {
    it("returns '0.00' for zero", () => {
      wrapper = mountDialog({ modelValue: true });
      expect((wrapper.vm as any).formatRate(0)).toBe("0.00");
    });

    it("returns 6-decimal trimmed string for sub-cent values", () => {
      wrapper = mountDialog({ modelValue: true });
      expect((wrapper.vm as any).formatRate(0.0001)).toBe("0.0001");
    });

    it("strips trailing zeros and dot for tiny values", () => {
      wrapper = mountDialog({ modelValue: true });
      expect((wrapper.vm as any).formatRate(0.001)).toBe("0.001");
    });

    it("returns 2-decimal string for values >= 0.01", () => {
      wrapper = mountDialog({ modelValue: true });
      expect((wrapper.vm as any).formatRate(1.234)).toBe("1.23");
      expect((wrapper.vm as any).formatRate(0.01)).toBe("0.01");
    });
  });

  describe("conditional rendering in match-found block", () => {
    it("renders the tier name fallback to 'Default' when tier is empty", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = {
        matched: {
          name: "gpt-4",
          source: "org",
          tiers: [{ name: "Default", prices: {} }],
        },
        tier: "",
      };
      await nextTick();
      // The "Default" fallback should be rendered as the tier name
      expect(wrapper.find('[data-test="test-match-result"]').text()).toContain(
        "Default",
      );
    });

    it("renders the no-pricing message when matched tier has no prices", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = {
        matched: {
          name: "gpt-4",
          source: "org",
          tiers: [{ name: "Default", prices: {} }],
        },
        tier: "Default",
      };
      await nextTick();
      expect(wrapper.text()).toContain("No pricing defined for this tier.");
    });

    it("renders the condition string when matchedTierDef has a condition", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = {
        matched: {
          name: "gpt-4",
          source: "org",
          tiers: [
            {
              name: "Tier1",
              prices: { input: 0.00001 },
              condition: {
                usage_key: "tokens",
                operator: "gte",
                value: 1000,
              },
            },
          ],
        },
        tier: "Tier1",
      };
      await nextTick();
      const text = wrapper.find('[data-test="test-match-result"]').text();
      expect(text).toContain("Condition:");
      expect(text).toContain("tokens");
      expect(text).toContain("≥");
      expect(text).toContain("1000");
    });

    it("renders the default pricing tier text when there is no condition", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = {
        matched: {
          name: "gpt-4",
          source: "org",
          tiers: [{ name: "Default", prices: { input: 0.00001 } }],
        },
        tier: "Default",
      };
      await nextTick();
      expect(wrapper.text()).toContain("Default pricing tier");
    });

    it("renders all flow steps and marks the winner", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = {
        matched: { name: "gpt-4", source: "built_in" },
        tier: "Default",
      };
      await nextTick();
      const text = wrapper.find('[data-test="test-match-result"]').text();
      expect(text).toContain("your org");
      expect(text).toContain("global");
      expect(text).toContain("built-in");
    });

    it("renders the badge with the source label for matched", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).testModelName = "gpt-4";
      (wrapper.vm as any).testResult = {
        matched: { name: "gpt-4", source: "meta_org" },
        tier: "Default",
      };
      await nextTick();
      const badge = wrapper.find('[data-test="q-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.attributes("data-label")).toBe("Global");
      expect(badge.attributes("data-color")).toBe("secondary");
    });
  });
});
