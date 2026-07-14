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
import ModelPricingEditor from "./ModelPricingEditor.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import i18n from "@/locales";
import { makeModelPricingSchema } from "./ModelPricingEditor.schema";


// Service mocks
vi.mock("@/services/model_pricing", () => ({
  default: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

// Toast mock
const mockToastFn = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToastFn(...args),
}));

// Clipboard mock
const mockCopyToClipboard = vi.fn().mockResolvedValue(true);
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: any[]) => mockCopyToClipboard(...args),
}));

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
  props: ["variant", "size", "active", "disabled", "loading", "type"],
  emits: ["click"],
  // Mirror the real OButton default (type="button") so stubbed buttons inside
  // the <OForm> don't accidentally submit it on click.
  template: `
    <button
      data-test-stub="o-button"
      :data-variant="variant"
      :data-size="size"
      :data-active="String(active)"
      :type="type || 'button'"
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
  template: `<span data-test-stub="OIcon" :data-name="name"><slot /></span>`,
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

// ── Field-array test helpers: drive the real form (tiers/prices are now
//    form-owned; values are PER-MILLION rows). ──────────────────────────────
// OWNER pattern: the component creates the form via useOForm and exposes it as
// `form` (handed to <OForm :form="form">) — read it directly, not via a ref.
const getForm = (wrapper: any) => (wrapper.vm as any).form;
const row = (key: string, value: number) => ({ key, value });
const tier = (overrides: Record<string, any> = {}) => ({
  name: "Default",
  condition: null,
  prices: [] as any[],
  draftKey: "",
  draftValue: 0,
  ...overrides,
});
// Seed a valid form: name + pattern + a default tier with one non-zero price.
const fillValid = (wrapper: any, tiers?: any[]) => {
  const form = getForm(wrapper);
  form.setFieldValue("name", "GPT 4o");
  form.setFieldValue("match_pattern", "gpt-4o");
  form.setFieldValue("tiers", tiers ?? [tier({ prices: [row("input", 1)] })]);
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
    it("initializes the form with a single default tier (no prices, no condition)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      await nextTick();
      const tiers = (wrapper.vm as any).formTiers;
      expect(tiers).toHaveLength(1);
      expect(tiers[0].name).toBe("Default");
      expect(tiers[0].condition).toBeNull();
      expect(tiers[0].prices).toEqual([]);
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

  // The name/match_pattern rules moved from computed refs into the co-located
  // Zod schema; test the schema directly (messages resolve via the real i18n).
  describe("Schema validation: name", () => {
    const schema = makeModelPricingSchema(i18n.global.t as any);
    const nameIssue = (name: string) => {
      const res = schema.safeParse({ name, match_pattern: "gpt" });
      return res.success
        ? ""
        : res.error.issues.find((iss: any) => iss.path[0] === "name")?.message ?? "";
    };

    it("requires a model name", () => {
      expect(nameIssue("")).toBe("Model name is required");
    });

    it("rejects names over 256 chars", () => {
      expect(nameIssue("a".repeat(257))).toBe(
        "Model name must be 256 characters or fewer",
      );
    });

    it("accepts a valid name", () => {
      expect(nameIssue("Valid Name")).toBe("");
    });
  });

  describe("Schema validation: match_pattern", () => {
    const schema = makeModelPricingSchema(i18n.global.t as any);
    const patternIssue = (match_pattern: string) => {
      const res = schema.safeParse({ name: "X", match_pattern });
      return res.success
        ? ""
        : res.error.issues.find((iss: any) => iss.path[0] === "match_pattern")
            ?.message ?? "";
    };

    it("requires a match pattern", () => {
      expect(patternIssue("")).toBe("Match pattern is required");
    });

    it("rejects patterns over 512 chars", () => {
      expect(patternIssue("a".repeat(513))).toBe(
        "Match pattern must be 512 characters or fewer",
      );
    });

    it("reports an invalid regex with the parser error message", () => {
      expect(patternIssue("([")).toContain("Invalid regex:");
    });

    it("strips Rust-style inline flags before validating", () => {
      // (?i) is not valid in JS RegExp but the schema strips it
      expect(patternIssue("(?i)gpt-4")).toBe("");
    });

    it("accepts a valid pattern", () => {
      expect(patternIssue("gpt-.*")).toBe("");
    });
  });

  describe("Schema validation: price-row key", () => {
    const schema = makeModelPricingSchema(i18n.global.t as any);
    // Isolate the committed price-row key rule (path tiers[i].prices[j].key).
    const keyIssue = (key: string) => {
      const res = schema.safeParse({
        name: "X",
        match_pattern: "gpt",
        tiers: [
          { name: "Default", condition: null, prices: [{ key, value: 1 }] },
        ],
      });
      return res.success
        ? ""
        : res.error.issues.find(
            (iss: any) =>
              iss.path[0] === "tiers" &&
              iss.path[2] === "prices" &&
              iss.path[4] === "key",
          )?.message ?? "";
    };

    it("rejects a pure-integer price key", () => {
      expect(keyIssue("123")).toBe("Usage key cannot be a pure integer");
    });

    it("rejects a price key that contains spaces", () => {
      expect(keyIssue("input tokens")).toBe(
        "Usage key must not contain spaces",
      );
    });

    it("accepts a valid alphanumeric price key", () => {
      expect(keyIssue("input")).toBe("");
    });

    it("ignores an empty price key (blank/draft row)", () => {
      expect(keyIssue("")).toBe("");
    });
  });

  describe("Schema validation (real OForm)", () => {
    it("blocks submit and calls neither create nor update when name/pattern are empty", async () => {
      const wrapper = createWrapper();
      await flushPromises();

      const form = (wrapper.vm as any).form;
      await form.handleSubmit();
      await flushPromises();

      expect(form.state.isValid).toBe(false);
      expect(mockService.create).not.toHaveBeenCalled();
      expect(mockService.update).not.toHaveBeenCalled();
    });
  });

  describe("Tier management (field-array)", () => {
    it("addTier appends a conditional tier with a default condition", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).addTier();
      await nextTick();
      const tiers = (wrapper.vm as any).formTiers;
      expect(tiers).toHaveLength(2);
      expect(tiers[1].condition).toEqual({
        usage_key: "input",
        operator: "gt",
        value: 200000,
      });
    });

    it("removeTier removes the tier at the given index", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).addTier();
      await nextTick();
      (wrapper.vm as any).removeTier(1);
      await nextTick();
      expect((wrapper.vm as any).formTiers).toHaveLength(1);
    });

    it("hides the remove button on the only tier", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const outlineDestructive = wrapper
        .findAll('[data-test-stub="o-button"]')
        .filter((b) => b.attributes("data-variant") === "outline-destructive");
      // No tier remove buttons when only the default tier exists (and the default
      // tier starts with no price rows → no price-delete buttons either).
      expect(outlineDestructive.length).toBe(0);
    });
  });

  describe("Pricing template helpers (field-array)", () => {
    it("applyTemplate seeds the tier rows with template keys and zero defaults", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).applyTemplate(0, ["input", "output"]);
      await nextTick();
      const prices = (wrapper.vm as any).formTiers[0].prices;
      expect(prices.map((r: any) => r.key)).toEqual(["input", "output"]);
      expect(prices.every((r: any) => r.value === 0)).toBe(true);
    });

    it("applyTemplate preserves existing values for matching keys", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      getForm(wrapper).setFieldValue("tiers", [
        tier({ prices: [row("input", 0.5), row("foo", 1)] }),
      ]);
      await nextTick();
      (wrapper.vm as any).applyTemplate(0, ["input", "output"]);
      await nextTick();
      const prices = (wrapper.vm as any).formTiers[0].prices;
      expect(prices.map((r: any) => [r.key, r.value])).toEqual([
        ["input", 0.5],
        ["output", 0],
      ]);
    });

    it("clearTemplate removes the supplied keys from a tier", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      getForm(wrapper).setFieldValue("tiers", [
        tier({ prices: [row("input", 0.1), row("output", 0.2), row("foo", 0.3)] }),
      ]);
      await nextTick();
      (wrapper.vm as any).clearTemplate(0, ["input", "output"]);
      await nextTick();
      const prices = (wrapper.vm as any).formTiers[0].prices;
      expect(prices.map((r: any) => r.key)).toEqual(["foo"]);
    });

    it("isTemplateActive returns true when rows match the template keys exactly", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      getForm(wrapper).setFieldValue("tiers", [
        tier({ prices: [row("input", 0), row("output", 0)] }),
      ]);
      await nextTick();
      expect((wrapper.vm as any).isTemplateActive(0, ["input", "output"])).toBe(true);
    });

    it("isTemplateActive returns false when rows do not match the template", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      getForm(wrapper).setFieldValue("tiers", [tier({ prices: [row("input", 0)] })]);
      await nextTick();
      expect((wrapper.vm as any).isTemplateActive(0, ["input", "output"])).toBe(false);
    });
  });

  describe("Price entry helpers", () => {
    it("addPrice commits the draft row into the tier and clears the draft", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      getForm(wrapper).setFieldValue("tiers", [
        tier({ draftKey: "input", draftValue: 5 }),
      ]);
      await nextTick();
      (wrapper.vm as any).addPrice(0);
      await nextTick();
      const t = (wrapper.vm as any).formTiers[0];
      expect(t.prices.map((r: any) => [r.key, r.value])).toEqual([["input", 5]]);
      expect(t.draftKey).toBe("");
      expect(t.draftValue).toBe(0);
    });

    it("addPrice is a no-op when the draft key is empty", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      getForm(wrapper).setFieldValue("tiers", [
        tier({ draftKey: "  ", draftValue: 5 }),
      ]);
      await nextTick();
      (wrapper.vm as any).addPrice(0);
      await nextTick();
      expect((wrapper.vm as any).formTiers[0].prices).toHaveLength(0);
    });

    it("removePrice removes the row at the given index", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      getForm(wrapper).setFieldValue("tiers", [
        tier({ prices: [row("a", 1), row("b", 2)] }),
      ]);
      await nextTick();
      (wrapper.vm as any).removePrice(0, 0);
      await nextTick();
      const prices = (wrapper.vm as any).formTiers[0].prices;
      expect(prices.map((r: any) => r.key)).toEqual(["b"]);
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

  describe("previewEntries (field-array)", () => {
    it("appends a pending row when the draft has a key", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const t = tier({ prices: [row("input", 1)], draftKey: "output", draftValue: 2 });
      const preview = (wrapper.vm as any).previewEntries(t);
      expect(preview).toHaveLength(2);
      const pending = preview.find((p: any) => p.key === "output");
      expect(pending.pending).toBe(true);
    });

    it("does not duplicate when the draft key already exists in the rows", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const t = tier({ prices: [row("input", 1)], draftKey: "input", draftValue: 99 });
      const preview = (wrapper.vm as any).previewEntries(t);
      expect(preview).toHaveLength(1);
      expect(preview[0].key).toBe("input");
    });
  });

  describe("copyPattern", () => {
    it("writes the pattern to clipboard and sets copiedPattern", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      (wrapper.vm as any).copyPattern("gpt-4o");
      await flushPromises();
      expect(mockCopyToClipboard).toHaveBeenCalledWith("gpt-4o", { silent: true });
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
    it("does not call the API when name/pattern are invalid (schema-gated submit)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // both fields empty by default — invalid; submit through the real form.
      const form = getForm(wrapper);
      await form.handleSubmit();
      await flushPromises();
      expect(form.state.isValid).toBe(false);
      expect(mockService.create).not.toHaveBeenCalled();
      expect(mockService.update).not.toHaveBeenCalled();
    });

    it("warns when the default tier has no prices and aborts", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // valid name/pattern, but a default tier with NO price rows
      fillValid(wrapper, [tier({ prices: [] })]);
      await nextTick();
      await getForm(wrapper).handleSubmit();
      await flushPromises();
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Add at least one token price in the default tier.",
        }),
      );
      expect(mockService.create).not.toHaveBeenCalled();
    });

    it("warns when a draft row has a value but no key", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      fillValid(wrapper, [
        tier({ prices: [row("input", 1000)], draftKey: "", draftValue: 5 }),
      ]);
      await nextTick();
      await getForm(wrapper).handleSubmit();
      await flushPromises();
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: expect.stringContaining("has a price without a usage key"),
        }),
      );
      expect(mockService.create).not.toHaveBeenCalled();
    });

    it("blocks submit when a non-default tier's condition.usage_key is a pure integer (schema)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      fillValid(wrapper, [
        tier({ prices: [row("input", 1000)] }),
        tier({
          name: "Tier 2",
          condition: { usage_key: "42", operator: "gt", value: 1 },
          prices: [],
        }),
      ]);
      await nextTick();
      const form = getForm(wrapper);
      await form.handleSubmit();
      await flushPromises();
      expect(form.state.isValid).toBe(false);
      expect(mockService.create).not.toHaveBeenCalled();
    });
  });

  describe("save flow — success", () => {
    it("calls create when there is no model id and notifies success", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      fillValid(wrapper);
      await nextTick();
      await getForm(wrapper).handleSubmit();
      await flushPromises();
      expect(mockService.create).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({ name: "GPT 4o", match_pattern: "gpt-4o" }),
      );
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "success", message: "Model pricing saved" }),
      );
      expect(mockRouterPush).toHaveBeenCalled();
    });

    it("converts per-million rows back to a per-token price map", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // 1000 per-million → 0.001 per-token
      fillValid(wrapper, [tier({ prices: [row("input", 1000)] })]);
      await nextTick();
      await getForm(wrapper).handleSubmit();
      await flushPromises();
      const payload = mockService.create.mock.calls[0][1];
      expect(payload.tiers[0].prices.input).toBeCloseTo(0.001);
    });

    it("sends the exact API tier shape (keys + types) and leaks no draft/helper fields", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // A tier with a committed row AND a draft row: the draft must be committed
      // into `prices`, and the form-only draftKey/draftValue must NOT leak into
      // the payload (the {...value} regression ④b guards against).
      fillValid(wrapper, [
        tier({
          prices: [row("input", 1000)],
          draftKey: "output",
          draftValue: 2000,
        }),
      ]);
      await nextTick();
      await getForm(wrapper).handleSubmit();
      await flushPromises();

      expect(mockService.create).toHaveBeenCalledTimes(1);
      const payload = mockService.create.mock.calls[0][1];

      // top-level scalars — exact value + correct type
      expect(typeof payload.name).toBe("string");
      expect(payload.name).toBe("GPT 4o");
      expect(typeof payload.match_pattern).toBe("string");
      expect(payload.match_pattern).toBe("gpt-4o");
      expect(Array.isArray(payload.tiers)).toBe(true);

      // EXACT tier shape — only {condition, name, prices}; NO draftKey/draftValue leak
      const t0 = payload.tiers[0];
      expect(Object.keys(t0).sort()).toEqual(["condition", "name", "prices"]);
      expect(t0.condition).toBeNull(); // default (first) tier
      expect(typeof t0.name).toBe("string");

      // prices is a per-token MAP of numbers (committed row + committed draft)
      expect(Object.keys(t0.prices).sort()).toEqual(["input", "output"]);
      expect(typeof t0.prices.input).toBe("number");
      expect(typeof t0.prices.output).toBe("number");
      expect(t0.prices.input).toBeCloseTo(0.001); // 1000 per-million → per-token
      expect(t0.prices.output).toBeCloseTo(0.002); // 2000 per-million → per-token
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
      await getForm(wrapper).handleSubmit();
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
      // a stale condition on the default tier — should be nulled on save
      fillValid(wrapper, [
        tier({
          prices: [row("input", 1000)],
          condition: { usage_key: "x", operator: "gt", value: 0 },
        }),
      ]);
      await nextTick();
      await getForm(wrapper).handleSubmit();
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

    it("auto-commits a draft row before saving", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      fillValid(wrapper, [
        tier({ prices: [], draftKey: "input", draftValue: 1 }),
      ]);
      await nextTick();
      await getForm(wrapper).handleSubmit();
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
      fillValid(wrapper);
      await nextTick();
      await getForm(wrapper).handleSubmit();
      await flushPromises();
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "warning",
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
      fillValid(wrapper);
      await nextTick();
      await getForm(wrapper).handleSubmit();
      await flushPromises();
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: expect.stringContaining("server boom"),
        }),
      );
      // Loading is form-driven: after the awaited submit settles (even on
      // error), TanStack's isSubmitting resets — no manual `saving` flag.
      expect(getForm(wrapper).state.isSubmitting).toBe(false);
    });

    it("suppresses 403 error notification (handled globally)", async () => {
      mockService.create.mockRejectedValue({
        response: { status: 403, data: { message: "forbidden" } },
      });
      const wrapper = createWrapper();
      await flushPromises();
      fillValid(wrapper);
      await nextTick();
      await getForm(wrapper).handleSubmit();
      await flushPromises();
      const negativeCalls = mockToastFn.mock.calls.filter(
        ([arg]) => arg && arg.variant === "error",
      );
      expect(negativeCalls).toHaveLength(0);
    });
  });

  describe("Footer save button state", () => {
    it("stays enabled even when name/pattern are invalid (R3 — validation is schema-driven)", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      // Both fields empty (invalid) — the Save button is NOT disabled; the
      // schema blocks the actual submit instead.
      const saveBtn = wrapper.find('[data-test="model-pricing-editor-save-btn"]');
      expect(saveBtn.attributes("disabled")).toBeUndefined();
    });

    it("is enabled when name and pattern are valid", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      const form = (wrapper.vm as any).form;
      form.setFieldValue("name", "valid");
      form.setFieldValue("match_pattern", "gpt-.*");
      await nextTick();
      const saveBtn = wrapper.find('[data-test="model-pricing-editor-save-btn"]');
      expect(saveBtn.attributes("disabled")).toBeUndefined();
    });
  });

  describe("Edit-mode hydration", () => {
    it("hydrates the form from the service, converts prices to rows, and seeds tier conditions", async () => {
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
      await nextTick();

      // The loaded scalar values are seeded into the form.
      const form = getForm(wrapper);
      expect(form.state.values.name).toBe("Existing");
      expect(form.state.values.match_pattern).toBe("gpt-.*");

      // tiers converted to per-million ROW shape; condition defaulted on tier 2.
      const tiers = (wrapper.vm as any).formTiers;
      expect(tiers).toHaveLength(2);
      // 0.001 per-token → 1000 per-million
      expect(tiers[0].prices.map((r: any) => [r.key, r.value])).toEqual([
        ["input", 1000],
      ]);
      expect(tiers[0].condition).toBeNull();
      expect(tiers[1].condition).toEqual({ usage_key: "input", operator: "gt", value: 0 });
    });

    it("notifies and continues when get() rejects with non-403", async () => {
      mockService.get.mockRejectedValue({
        response: { status: 500, data: { message: "load fail" } },
      });
      createWrapper({ query: { id: "abc" } });
      await flushPromises();
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: expect.stringContaining("load fail"),
        }),
      );
    });
  });

  // Regression: deleting a non-last price row must not leave the OTHER rows'
  // rendered inputs showing stale/shifted values. The form DATA was always
  // correct (the preview read it fine); the bug was a v-for :key (stable id) vs
  // index-based field-name mismatch, so reused field components kept stale name
  // bindings on a middle delete.
  describe("Price row delete — rendered inputs stay in sync (field-array keying)", () => {
    // Read each price-KEY field's rendered value (the OInput model-value =
    // the bound field's value). If the field component is bound to the wrong
    // path after a delete, this surfaces it (form data alone would not).
    const renderedPriceKeys = (wrapper: any) =>
      wrapper
        .findAllComponents(OFormInput)
        .filter((c: any) => /\.prices\[\d+\]\.key$/.test(c.props("name") || ""))
        .map((c: any) => c.findComponent(OInput).props("modelValue"));

    it("removing the FIRST of four price rows leaves the other three inputs showing the correct keys", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      getForm(wrapper).setFieldValue("tiers", [
        tier({
          prices: [
            row("input", 1),
            row("output", 2),
            row("cache_read_input_tokens", 3),
            row("output_reasoning_tokens", 4),
          ],
        }),
      ]);
      await nextTick();
      await flushPromises();

      // sanity — all four rendered in order
      expect(renderedPriceKeys(wrapper)).toEqual([
        "input",
        "output",
        "cache_read_input_tokens",
        "output_reasoning_tokens",
      ]);

      (wrapper.vm as any).removePrice(0, 0); // delete "input"
      await nextTick();
      await flushPromises();

      // form data is correct (only "input" removed)
      expect(
        (wrapper.vm as any).formTiers[0].prices.map((p: any) => p.key),
      ).toEqual(["output", "cache_read_input_tokens", "output_reasoning_tokens"]);

      // the RENDERED inputs must match the data — not shifted, not blank
      expect(renderedPriceKeys(wrapper)).toEqual([
        "output",
        "cache_read_input_tokens",
        "output_reasoning_tokens",
      ]);
    });

    const renderedTierNames = (wrapper: any) =>
      wrapper
        .findAllComponents(OFormInput)
        .filter((c: any) => /^tiers\[\d+\]\.name$/.test(c.props("name") || ""))
        .map((c: any) => c.findComponent(OInput).props("modelValue"));

    it("removing a MIDDLE tier keeps the remaining tiers' name inputs correct", async () => {
      const wrapper = createWrapper();
      await flushPromises();
      getForm(wrapper).setFieldValue("tiers", [
        tier({ name: "Default", prices: [row("input", 1)] }),
        tier({
          name: "Tier B",
          condition: { usage_key: "input", operator: "gt", value: 100 },
        }),
        tier({
          name: "Tier C",
          condition: { usage_key: "input", operator: "gt", value: 200 },
        }),
      ]);
      await nextTick();
      await flushPromises();

      expect(renderedTierNames(wrapper)).toEqual(["Default", "Tier B", "Tier C"]);

      (wrapper.vm as any).removeTier(1); // delete "Tier B"
      await nextTick();
      await flushPromises();

      expect((wrapper.vm as any).formTiers.map((t: any) => t.name)).toEqual([
        "Default",
        "Tier C",
      ]);
      expect(renderedTierNames(wrapper)).toEqual(["Default", "Tier C"]);
    });

    it("edit-mode renders prices in the SAME order the API returns them (frontend does not reorder)", async () => {
      mockService.get.mockResolvedValue({
        data: {
          id: "m1",
          name: "GPT",
          match_pattern: "gpt-4o",
          enabled: true,
          tiers: [
            {
              name: "Default",
              condition: null,
              // API returns this exact key order
              prices: {
                input: 0.0000001,
                output: 0,
                cache_read_input_tokens: 0,
                output_reasoning_tokens: 0,
              },
            },
          ],
        },
      });
      const wrapper = createWrapper({ query: { id: "m1" } });
      await flushPromises();
      await nextTick();

      // modelToForm preserves the map's key order exactly — no sort, no reverse
      expect(
        (wrapper.vm as any).formTiers[0].prices.map((p: any) => p.key),
      ).toEqual([
        "input",
        "output",
        "cache_read_input_tokens",
        "output_reasoning_tokens",
      ]);
    });
  });
});
