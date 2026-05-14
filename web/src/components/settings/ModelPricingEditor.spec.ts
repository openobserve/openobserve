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

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import ModelPricingEditor from "./ModelPricingEditor.vue";
import i18n from "@/locales";

installQuasar({ plugins: [Notify] });

// Service mocks
vi.mock("@/services/model_pricing", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

// useQuasar mock
const mockNotify = vi.fn();
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({ notify: mockNotify }),
  };
});

// Router mocks — useRouter/useRoute consumed by the component
const mockRouterPush = vi.fn();
let mockRouteQuery: Record<string, any> = {};
vi.mock("vue-router", async () => {
  const actual = await vi.importActual<any>("vue-router");
  return {
    ...actual,
    useRouter: () => ({ push: mockRouterPush }),
    useRoute: () => ({ query: mockRouteQuery }),
  };
});

import modelPricingService from "@/services/model_pricing";

const mockService = modelPricingService as any;

// Vuex store mock
const mockStore = {
  state: {
    theme: "light",
    selectedOrganization: { identifier: "test-org" },
  },
};

// In-house ODialog stub — exposes props + emits the events the component listens to
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
      data-test-stub="o-dialog"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-sub-title="subTitle"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test-stub="o-dialog-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test-stub="o-dialog-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

// OButton stub — keeps clicks working and the slot content rendered
const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "active", "disabled", "loading"],
  emits: ["click"],
  template: `
    <button
      data-test-stub="o-button"
      :data-variant="variant"
      :data-size="size"
      :data-active="String(active)"
      :disabled="disabled || loading"
      @click="$emit('click', $event)"
    >
      <slot name="icon-left" />
      <slot />
    </button>
  `,
};

const QInputStub = {
  name: "QInput",
  props: [
    "modelValue",
    "type",
    "min",
    "label",
    "placeholder",
    "error",
    "errorMessage",
    "dense",
    "borderless",
    "step",
  ],
  emits: ["update:modelValue", "blur"],
  template: `
    <input
      data-test-stub="q-input"
      :data-test="$attrs['data-test']"
      :data-error="String(error)"
      :data-error-message="errorMessage"
      :value="modelValue"
      :type="type"
      :placeholder="placeholder"
      @input="$emit('update:modelValue', type === 'number' ? Number($event.target.value) : $event.target.value)"
      @blur="$emit('blur', $event)"
    />
  `,
};

const QSelectStub = {
  name: "QSelect",
  props: ["modelValue", "options", "displayValue"],
  emits: ["update:modelValue"],
  template: `<div data-test-stub="q-select" :data-display="displayValue"></div>`,
};

const QIconStub = {
  name: "QIcon",
  props: ["name", "size"],
  template: `<span data-test-stub="q-icon" :data-name="name"><slot /></span>`,
};

const QTooltipStub = {
  name: "QTooltip",
  template: `<span data-test-stub="q-tooltip"><slot /></span>`,
};

const QPageStub = {
  name: "QPage",
  template: `<div data-test-stub="q-page"><slot /></div>`,
};

const createWrapper = (overrides: { query?: Record<string, any> } = {}) => {
  mockRouteQuery = overrides.query || {};
  return mount(ModelPricingEditor, {
    global: {
      plugins: [i18n],
      mocks: {
        $store: mockStore,
      },
      provide: {
        store: mockStore,
      },
      stubs: {
        QPage: QPageStub,
        QInput: QInputStub,
        QSelect: QSelectStub,
        QIcon: QIconStub,
        QTooltip: QTooltipStub,
        ODialog: ODialogStub,
        OButton: OButtonStub,
      },
    },
  });
};

describe("ModelPricingEditor.vue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockService.list.mockResolvedValue({ data: [] });
    mockService.get.mockResolvedValue({ data: null });
    mockService.create.mockResolvedValue({ data: { id: "new-id" } });
    mockService.update.mockResolvedValue({ data: { id: "existing-id" } });
    // reset store theme defaults
    mockStore.state.theme = "light";
    mockStore.state.selectedOrganization = { identifier: "test-org" };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Mounting", () => {
    it("mounts successfully", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the New title when not in edit mode", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const title = wrapper.find('[data-test="model-pricing-editor-title"]');
      expect(title.text()).toBe("New Model Pricing");
    });

    it("renders the Edit title when route has id and not duplicate", async () => {
      mockService.get.mockResolvedValue({
        data: {
          id: "abc",
          name: "Existing",
          match_pattern: "gpt-.*",
          enabled: true,
          tiers: [{ name: "Default", condition: null, prices: { input: 0.001 } }],
        },
      });
      const wrapper = createWrapper({ query: { id: "abc" } });
      await flushPromises();
      const title = wrapper.find('[data-test="model-pricing-editor-title"]');
      expect(title.text()).toBe("Edit Model Pricing");
    });

    it("shows New title (and clears id) when route is duplicate", async () => {
      mockService.get.mockResolvedValue({
        data: {
          id: "abc",
          name: "Existing",
          match_pattern: "gpt-.*",
          enabled: true,
          tiers: [{ name: "Default", condition: null, prices: { input: 0.001 } }],
        },
      });
      const wrapper = createWrapper({ query: { id: "abc", duplicate: "true" } });
      await flushPromises();
      const title = wrapper.find('[data-test="model-pricing-editor-title"]');
      expect(title.text()).toBe("New Model Pricing");
      expect((wrapper.vm as any).model.id).toBeNull();
      expect((wrapper.vm as any).model.name).toContain("(Copy)");
    });
  });

  describe("Initial state", () => {
    it("initializes the model with a single default tier", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.model.tiers).toHaveLength(1);
      expect(vm.model.tiers[0].name).toBe("Default");
      expect(vm.model.tiers[0].condition).toBeNull();
      expect(vm.addState).toHaveLength(1);
    });

    it("loads existing models on mount for shadow-conflict detection", async () => {
      mockService.list.mockResolvedValue({
        data: [
          { id: "1", source: "org", org_id: "test-org", enabled: true, match_pattern: "gpt-.*" },
          { id: "2", source: "global", org_id: "test-org", enabled: true, match_pattern: "claude" },
        ],
      });
      const wrapper = createWrapper();
      await flushPromises();
      // global source is filtered out
      expect((wrapper.vm as any).existingModels).toHaveLength(1);
      expect((wrapper.vm as any).existingModels[0].id).toBe("1");
    });

    it("handles list service rejection gracefully", async () => {
      mockService.list.mockRejectedValue(new Error("boom"));
      const wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).existingModels).toEqual([]);
    });
  });

  describe("Validation: nameError computed", () => {
    it("requires a model name", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).nameError).toBe("Model name is required");
    });

    it("rejects names over 256 chars", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "a".repeat(257);
      await nextTick();
      expect((wrapper.vm as any).nameError).toBe("Model name must be 256 characters or fewer");
    });

    it("clears name error for a valid name", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "Valid Name";
      await nextTick();
      expect((wrapper.vm as any).nameError).toBe("");
    });
  });

  describe("Validation: regexError computed", () => {
    it("requires a match pattern", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).regexError).toBe("Match pattern is required");
    });

    it("rejects patterns over 512 chars", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.match_pattern = "a".repeat(513);
      await nextTick();
      expect((wrapper.vm as any).regexError).toBe("Match pattern must be 512 characters or fewer");
    });

    it("reports an invalid regex with the parser error message", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.match_pattern = "([";
      await nextTick();
      expect((wrapper.vm as any).regexError).toContain("Invalid regex:");
    });

    it("strips Rust-style inline flags before validating", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // (?i) is not valid in JS RegExp but the component strips it
      (wrapper.vm as any).model.match_pattern = "(?i)gpt-4";
      await nextTick();
      expect((wrapper.vm as any).regexError).toBe("");
    });

    it("clears the error for valid patterns", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.match_pattern = "gpt-.*";
      await nextTick();
      expect((wrapper.vm as any).regexError).toBe("");
    });
  });

  describe("Tier management", () => {
    it("addTier appends a conditional tier with default condition", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).addTier();
      const vm = wrapper.vm as any;
      expect(vm.model.tiers).toHaveLength(2);
      expect(vm.model.tiers[1].condition).toEqual({
        usage_key: "input",
        operator: "gt",
        value: 200000,
      });
      expect(vm.addState).toHaveLength(2);
    });

    it("removeTier removes the tier at the given index", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).addTier();
      (wrapper.vm as any).removeTier(1);
      expect((wrapper.vm as any).model.tiers).toHaveLength(1);
      expect((wrapper.vm as any).addState).toHaveLength(1);
    });

    it("hides the remove button on the only tier (just one tier rendered)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const outlineDestructive = wrapper
        .findAll('[data-test-stub="o-button"]')
        .filter((b) => b.attributes("data-variant") === "outline-destructive");
      // No tier remove buttons when only the default tier exists (only price-row delete buttons would have this variant — empty prices means no rows)
      expect(outlineDestructive.length).toBe(0);
    });
  });

  describe("Pricing template helpers", () => {
    it("applyTemplate seeds the tier with template keys and zero defaults", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier = (wrapper.vm as any).model.tiers[0];
      (wrapper.vm as any).applyTemplate(tier, ["input", "output"]);
      expect(tier.prices).toEqual({ input: 0, output: 0 });
    });

    it("applyTemplate preserves existing values for matching keys", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier = (wrapper.vm as any).model.tiers[0];
      tier.prices = { input: 0.5, foo: 1 };
      (wrapper.vm as any).applyTemplate(tier, ["input", "output"]);
      expect(tier.prices).toEqual({ input: 0.5, output: 0 });
    });

    it("clearTemplate removes the supplied keys from a tier", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier = (wrapper.vm as any).model.tiers[0];
      tier.prices = { input: 0.1, output: 0.2, foo: 0.3 };
      (wrapper.vm as any).clearTemplate(tier, ["input", "output"]);
      expect(tier.prices).toEqual({ foo: 0.3 });
    });

    it("isTemplateActive returns true when prices match the template keys exactly", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier = { prices: { input: 0, output: 0 } };
      expect((wrapper.vm as any).isTemplateActive(tier, ["input", "output"])).toBe(true);
    });

    it("isTemplateActive returns false when prices do not match the template", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier = { prices: { input: 0 } };
      expect((wrapper.vm as any).isTemplateActive(tier, ["input", "output"])).toBe(false);
      const tier2 = { prices: { input: 0, output: 0, foo: 0 } };
      expect((wrapper.vm as any).isTemplateActive(tier2, ["input", "output"])).toBe(false);
    });
  });

  describe("Price entry helpers", () => {
    it("updatePrice and deletePrice mutate tier.prices", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier: any = { prices: { input: 1 } };
      (wrapper.vm as any).updatePrice(tier, "output", 2);
      expect(tier.prices).toEqual({ input: 1, output: 2 });
      (wrapper.vm as any).deletePrice(tier, "input");
      expect(tier.prices).toEqual({ output: 2 });
    });

    it("toPerMillion / fromPerMillion are inverses for non-zero", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).toPerMillion(0.000001)).toBe(1);
      expect((wrapper.vm as any).fromPerMillion(1)).toBeCloseTo(0.000001);
      expect((wrapper.vm as any).toPerMillion(0)).toBe(0);
      expect((wrapper.vm as any).fromPerMillion(0)).toBe(0);
    });

    it("formatPreviewCost returns '0' for zero cost", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      expect((wrapper.vm as any).formatPreviewCost(0, 1000)).toBe("0");
    });

    it("formatPreviewCost uses exponential for very small numbers", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const out = (wrapper.vm as any).formatPreviewCost(0.000000001, 1);
      expect(out).toMatch(/e-/i);
    });

    it("formatPreviewCost trims trailing zeros", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const out = (wrapper.vm as any).formatPreviewCost(0.001, 1000);
      // 0.001 * 1000 = 1 -> trimmed
      expect(out).toBe("1");
    });
  });

  describe("addPrice", () => {
    it("returns true and is a no-op when the key is empty", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier: any = { prices: {} };
      (wrapper.vm as any).addState[0] = { key: "  ", value: 5 };
      const result = (wrapper.vm as any).addPrice(tier, 0);
      expect(result).toBe(true);
      expect(tier.prices).toEqual({});
    });

    it("rejects keys that are pure integers and notifies", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier: any = { prices: {} };
      (wrapper.vm as any).addState[0] = { key: "123", value: 1 };
      const result = (wrapper.vm as any).addPrice(tier, 0);
      expect(result).toBe(false);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative", message: "Usage key cannot be a pure integer" }),
      );
    });

    it("rejects keys containing spaces and notifies", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier: any = { prices: {} };
      (wrapper.vm as any).addState[0] = { key: "input tokens", value: 1 };
      const result = (wrapper.vm as any).addPrice(tier, 0);
      expect(result).toBe(false);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative", message: "Usage key must not contain spaces" }),
      );
    });

    it("commits the pending entry and resets addState", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier: any = { prices: {} };
      (wrapper.vm as any).addState[0] = { key: "input", value: 1 }; // 1 per million
      const result = (wrapper.vm as any).addPrice(tier, 0);
      expect(result).toBe(true);
      expect(tier.prices.input).toBeCloseTo(0.000001);
      expect((wrapper.vm as any).addState[0]).toEqual({ key: "", value: 0 });
    });
  });

  describe("renamePriceByIndex", () => {
    it("renames the key at the same position preserving order and value", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier: any = { prices: { a: 1, b: 2, c: 3 } };
      (wrapper.vm as any).renamePriceByIndex(tier, 1, "B");
      expect(Object.keys(tier.prices)).toEqual(["a", "B", "c"]);
      expect(tier.prices.B).toBe(2);
    });

    it("is a no-op when newKey equals oldKey", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier: any = { prices: { a: 1 } };
      (wrapper.vm as any).renamePriceByIndex(tier, 0, "a");
      expect(tier.prices).toEqual({ a: 1 });
    });

    it("notifies and aborts when the new key fails validation", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier: any = { prices: { a: 1 } };
      (wrapper.vm as any).renamePriceByIndex(tier, 0, "1");
      expect(tier.prices).toEqual({ a: 1 });
      expect(mockNotify).toHaveBeenCalled();
    });

    it("ignores out-of-range indices", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier: any = { prices: { a: 1 } };
      (wrapper.vm as any).renamePriceByIndex(tier, 5, "x");
      expect(tier.prices).toEqual({ a: 1 });
    });
  });

  describe("priceEntries + previewEntries", () => {
    it("priceEntries returns stable IDs per index", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier: any = { prices: { a: 1, b: 2 } };
      const first = (wrapper.vm as any).priceEntries(tier);
      const second = (wrapper.vm as any).priceEntries(tier);
      expect(first[0].stableId).toBe(second[0].stableId);
      expect(first[1].stableId).toBe(second[1].stableId);
    });

    it("previewEntries appends a pending row when addState has a key", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier = (wrapper.vm as any).model.tiers[0];
      tier.prices = { input: 0.000001 };
      (wrapper.vm as any).addState[0] = { key: "output", value: 2 };
      const preview = (wrapper.vm as any).previewEntries(tier, 0);
      expect(preview).toHaveLength(2);
      const pending = preview.find((p: any) => p.key === "output");
      expect(pending.stableId).toBe(-1);
    });

    it("previewEntries does not duplicate when pending key already exists", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const tier = (wrapper.vm as any).model.tiers[0];
      tier.prices = { input: 0.000001 };
      (wrapper.vm as any).addState[0] = { key: "input", value: 99 };
      const preview = (wrapper.vm as any).previewEntries(tier, 0);
      expect(preview).toHaveLength(1);
      expect(preview[0].key).toBe("input");
    });
  });

  describe("copyPattern", () => {
    it("writes the pattern to clipboard and sets copiedPattern", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).copyPattern("gpt-4o");
      expect(writeText).toHaveBeenCalledWith("gpt-4o");
      expect((wrapper.vm as any).copiedPattern).toBe("gpt-4o");
    });
  });

  describe("Pattern examples ODialog", () => {
    it("renders an ODialog stub for the examples dialog", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const dialogs = wrapper.findAll('[data-test-stub="o-dialog"]');
      expect(dialogs.length).toBeGreaterThanOrEqual(1);
    });

    it("forwards title, subTitle and size='sm' to ODialog", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("size")).toBe("sm");
      expect(dialog.props("title")).toBe("Match Pattern Examples");
      expect(dialog.props("subTitle")).toBe("Common regex patterns used for popular models");
    });

    it("binds open prop from showExamples state", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(false);
      (wrapper.vm as any).showExamples = true;
      await nextTick();
      expect(dialog.props("open")).toBe(true);
    });
  });

  describe("goBack", () => {
    it("pushes to the modelPricing route with the org identifier", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).goBack();
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "modelPricing",
        query: { org_identifier: "test-org" },
      });
    });

    it("uses an empty org identifier when selectedOrganization is null", async () => {
      mockStore.state.selectedOrganization = null as any;
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).goBack();
      expect(mockRouterPush).toHaveBeenCalledWith({
        name: "modelPricing",
        query: { org_identifier: "" },
      });
    });

    it("the back button calls goBack on click", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const backBtn = wrapper.find('[data-test="model-pricing-editor-back-btn"]');
      await backBtn.trigger("click");
      expect(mockRouterPush).toHaveBeenCalled();
    });
  });

  describe("save flow — validation guards", () => {
    it("does not call the API when name/regex are invalid", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // both fields empty by default — invalid
      await (wrapper.vm as any).save();
      expect(mockService.create).not.toHaveBeenCalled();
      expect(mockService.update).not.toHaveBeenCalled();
      // touched flags are flipped so errors render
      expect((wrapper.vm as any).nameTouched).toBe(true);
      expect((wrapper.vm as any).patternTouched).toBe(true);
    });

    it("warns when default tier has no prices and aborts", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "M";
      (wrapper.vm as any).model.match_pattern = "gpt";
      await (wrapper.vm as any).save();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Add at least one token price in the default tier.",
        }),
      );
      expect(mockService.create).not.toHaveBeenCalled();
    });

    it("warns when a pending row has a value but no key", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "M";
      (wrapper.vm as any).model.match_pattern = "gpt";
      (wrapper.vm as any).model.tiers[0].prices = { input: 0.001 };
      (wrapper.vm as any).addState[0] = { key: "", value: 5 };
      await (wrapper.vm as any).save();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: expect.stringContaining("has a price without a usage key"),
        }),
      );
      expect(mockService.create).not.toHaveBeenCalled();
    });

    it("rejects a non-default tier whose condition.usage_key is a pure integer", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "M";
      (wrapper.vm as any).model.match_pattern = "gpt";
      (wrapper.vm as any).model.tiers[0].prices = { input: 0.001 };
      (wrapper.vm as any).addTier();
      (wrapper.vm as any).model.tiers[1].condition.usage_key = "42";
      await (wrapper.vm as any).save();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: expect.stringContaining("Usage key cannot be a plain number"),
        }),
      );
      expect(mockService.create).not.toHaveBeenCalled();
    });
  });

  describe("save flow — success", () => {
    it("calls create when there is no model id and notifies success", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "GPT 4o";
      (wrapper.vm as any).model.match_pattern = "gpt-4o";
      (wrapper.vm as any).model.tiers[0].prices = { input: 0.001 };
      await (wrapper.vm as any).save();
      await flushPromises();
      expect(mockService.create).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ name: "GPT 4o", match_pattern: "gpt-4o" }),
      );
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "positive", message: "Model pricing saved" }),
      );
      expect(mockRouterPush).toHaveBeenCalled();
    });

    it("calls update when the model has an id", async () => {
      mockService.get.mockResolvedValue({
        data: {
          id: "abc",
          name: "Existing",
          match_pattern: "gpt-.*",
          enabled: true,
          tiers: [{ name: "Default", condition: null, prices: { input: 0.001 } }],
        },
      });
      const wrapper = createWrapper({ query: { id: "abc" } });
      await flushPromises();
      await (wrapper.vm as any).save();
      await flushPromises();
      expect(mockService.update).toHaveBeenCalledWith(
        "test-org",
        "abc",
        expect.objectContaining({ id: "abc" }),
      );
    });

    it("clears the condition on the default tier before saving", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "M";
      (wrapper.vm as any).model.match_pattern = "gpt";
      (wrapper.vm as any).model.tiers[0].prices = { input: 0.001 };
      // simulate a stale condition on the default tier
      (wrapper.vm as any).model.tiers[0].condition = { usage_key: "x", operator: "gt", value: 0 };
      await (wrapper.vm as any).save();
      await flushPromises();
      expect(mockService.create).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          tiers: expect.arrayContaining([
            expect.objectContaining({ name: "Default", condition: null }),
          ]),
        }),
      );
    });

    it("auto-commits a pending row before saving", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "M";
      (wrapper.vm as any).model.match_pattern = "gpt";
      (wrapper.vm as any).addState[0] = { key: "input", value: 1 };
      await (wrapper.vm as any).save();
      await flushPromises();
      expect(mockService.create).toHaveBeenCalled();
      const payload = mockService.create.mock.calls[0][1];
      expect(payload.tiers[0].prices).toHaveProperty("input");
    });

    it("shows the shadow warning when a higher-priority duplicate exists", async () => {
      mockService.list.mockResolvedValue({
        data: [
          {
            id: "other",
            name: "Higher Priority",
            source: "org",
            org_id: "test-org",
            enabled: true,
            match_pattern: "gpt-4o",
            sort_order: -1,
          },
        ],
      });
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "Mine";
      (wrapper.vm as any).model.match_pattern = "gpt-4o";
      (wrapper.vm as any).model.tiers[0].prices = { input: 0.001 };
      await (wrapper.vm as any).save();
      await flushPromises();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "warning",
          message: expect.stringContaining("Higher Priority"),
        }),
      );
    });
  });

  describe("save flow — errors", () => {
    it("notifies on save failure (non-403)", async () => {
      mockService.create.mockRejectedValue({
        response: { status: 500, data: { message: "server boom" } },
      });
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "M";
      (wrapper.vm as any).model.match_pattern = "gpt";
      (wrapper.vm as any).model.tiers[0].prices = { input: 0.001 };
      await (wrapper.vm as any).save();
      await flushPromises();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: expect.stringContaining("server boom"),
        }),
      );
      expect((wrapper.vm as any).saving).toBe(false);
    });

    it("suppresses 403 error notification (handled globally)", async () => {
      mockService.create.mockRejectedValue({
        response: { status: 403, data: { message: "forbidden" } },
      });
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "M";
      (wrapper.vm as any).model.match_pattern = "gpt";
      (wrapper.vm as any).model.tiers[0].prices = { input: 0.001 };
      await (wrapper.vm as any).save();
      await flushPromises();
      const negativeCalls = mockNotify.mock.calls.filter(
        ([arg]) => arg && arg.type === "negative",
      );
      expect(negativeCalls).toHaveLength(0);
    });
  });

  describe("Footer save button state", () => {
    it("is disabled when name or regex error is present", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const saveBtn = wrapper.find('[data-test="model-pricing-editor-save-btn"]');
      expect(saveBtn.attributes("disabled")).toBeDefined();
    });

    it("is enabled when name and pattern are valid", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).model.name = "valid";
      (wrapper.vm as any).model.match_pattern = "gpt-.*";
      await nextTick();
      const saveBtn = wrapper.find('[data-test="model-pricing-editor-save-btn"]');
      expect(saveBtn.attributes("disabled")).toBeUndefined();
    });
  });

  describe("Edit-mode hydration", () => {
    it("hydrates the model from the service and seeds tier conditions", async () => {
      mockService.get.mockResolvedValue({
        data: {
          id: "abc",
          name: "Existing",
          match_pattern: "gpt-.*",
          enabled: true,
          tiers: [
            { name: "Default", condition: null, prices: { input: 0.001 } },
            // missing condition — should be defaulted
            { name: "Tier 2", prices: {} },
          ],
        },
      });
      const wrapper = createWrapper({ query: { id: "abc" } });
      await flushPromises();
      const tiers = (wrapper.vm as any).model.tiers;
      expect(tiers).toHaveLength(2);
      expect(tiers[1].condition).toEqual({ usage_key: "input", operator: "gt", value: 0 });
      expect((wrapper.vm as any).nameTouched).toBe(true);
      expect((wrapper.vm as any).patternTouched).toBe(true);
    });

    it("notifies and continues when get() rejects with non-403", async () => {
      mockService.get.mockRejectedValue({
        response: { status: 500, data: { message: "load fail" } },
      });
      createWrapper({ query: { id: "abc" } });
      await flushPromises();
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: expect.stringContaining("load fail"),
        }),
      );
    });
  });
});
