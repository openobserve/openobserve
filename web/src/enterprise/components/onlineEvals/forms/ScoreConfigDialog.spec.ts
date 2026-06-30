// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.
//
// Behavior tests for ScoreConfigDialog after the OForm + Zod migration
// (online-evals-migration.md row 68). At least one test mounts the REAL <OForm>
// and proves the dataType-discriminated schema gates an empty/invalid submit
// (name required + numeric min<max), and that the save() guard blocks an empty
// categorical config with a toast (the tag-input has no inline error slot), so
// an unwired `:schema` would be caught. Also verifies the kept dirty affordance.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import ScoreConfigDialog from "./ScoreConfigDialog.vue";
import onlineEvalsService from "@/services/online-evals.service";
import { toast } from "@/lib/feedback/Toast/useToast";
import i18n from "@/locales";

vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

vi.mock("@/services/online-evals.service", () => ({
  default: {
    scoreConfigs: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const store = createStore({
  state: { theme: "light", selectedOrganization: { identifier: "test-org" } },
});

function createWrapper(props: Record<string, any> = {}) {
  return mount(ScoreConfigDialog, {
    props: { orgId: "test-org", mode: "create", row: null, ...props },
    global: { plugins: [store, i18n] },
  });
}

function oform(w: any) {
  return w.findComponent({ name: "OForm" }).vm as any;
}
function setField(w: any, name: string, value: unknown) {
  oform(w).form.setFieldValue(name, value);
}
async function submit(w: any) {
  await oform(w).form.handleSubmit();
  await flushPromises();
}

describe("ScoreConfigDialog", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (onlineEvalsService.scoreConfigs.create as any).mockResolvedValue({});
    (onlineEvalsService.scoreConfigs.update as any).mockResolvedValue({});
  });
  afterEach(() => wrapper?.unmount());

  it("mounts the real OForm with the name + data-type fields", () => {
    wrapper = createWrapper();
    expect(wrapper.findComponent({ name: "OForm" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="score-config-name-input"]').exists()).toBe(true);
  });

  it("keeps the create Save button enabled before first submit (R3)", () => {
    wrapper = createWrapper();
    const save = wrapper.find('[data-test="score-config-save-btn"]');
    expect(save.attributes("disabled")).toBeUndefined();
    expect(oform(wrapper).form.state.isValid).toBe(true);
  });

  it("blocks submit and does NOT call the service when the name is empty", async () => {
    wrapper = createWrapper();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.scoreConfigs.create).not.toHaveBeenCalled();
  });

  it("creates a numeric score config when the schema passes", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "faithfulness");
    // numeric defaults: min 0, max 1 → valid ordering.
    await submit(wrapper);

    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.scoreConfigs.create).toHaveBeenCalledTimes(1);
    const [org, payload] = (onlineEvalsService.scoreConfigs.create as any).mock.calls[0];
    expect(org).toBe("test-org");
    expect(payload.name).toBe("faithfulness");
    expect(payload.dataType).toBe("numeric");
    expect(payload.numericRange).toEqual({ min: 0, max: 1 });
  });

  it("rejects a numeric range where min >= max", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "faithfulness");
    setField(wrapper, "min", 5);
    setField(wrapper, "max", 1);
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.scoreConfigs.create).not.toHaveBeenCalled();
  });

  it("blocks an empty categorical config with a toast (guard, no save)", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "verdict");
    setField(wrapper, "dataType", "categorical");
    // categories empty → schema PASSES, but the save() guard toasts + blocks.
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.scoreConfigs.create).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error", message: "Add at least one category" }),
    );
  });

  it("creates a categorical config once categories are provided", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "verdict");
    setField(wrapper, "dataType", "categorical");
    setField(wrapper, "categories", ["good", "bad"]);
    await submit(wrapper);

    expect(oform(wrapper).form.state.isValid).toBe(true);
    const payload = (onlineEvalsService.scoreConfigs.create as any).mock.calls[0][1];
    expect(payload.dataType).toBe("categorical");
    expect(payload.categories).toEqual(["good", "bad"]);
    expect(payload.numericRange).toBeNull();
  });

  it("keeps the dirty affordance on edit (Save disabled until changed)", () => {
    wrapper = createWrapper({
      mode: "edit",
      row: {
        id: "sc1",
        entityId: "sc1",
        name: "faithfulness",
        version: 1,
        dataType: "numeric",
        numericRange: { min: 0, max: 1 },
      },
    });
    const save = wrapper.find('[data-test="score-config-save-btn"]');
    // Not dirty yet → disabled (a save-affordance, NOT a validation gate).
    expect(save.attributes("disabled")).toBeDefined();
  });

  // Regression: a number <input> emits a STRING (OInput only coerces with a
  // `.number` modifier, which OFormInput does not pass), and the @submit value is
  // TanStack's RAW store value — so the payload builders must coerce. These tests
  // drive the REAL inputs via `setValue` (NOT `setFieldValue`, which injects a
  // number and hides the bug) so the string actually flows through the form.
  describe("numeric values typed through the real inputs (string-coercion)", () => {
    it("sends a numeric numericRange (not null) when the range is typed", async () => {
      wrapper = createWrapper();
      setField(wrapper, "name", "faithfulness");
      await wrapper.find('[data-test="score-config-min-input"] input').setValue("0.2");
      await wrapper.find('[data-test="score-config-max-input"] input').setValue("0.9");
      await flushPromises();

      await submit(wrapper);

      expect(oform(wrapper).form.state.isValid).toBe(true);
      const payload = (onlineEvalsService.scoreConfigs.create as any).mock.calls[0][1];
      expect(payload.numericRange).toEqual({ min: 0.2, max: 0.9 });
      expect(typeof payload.numericRange.min).toBe("number");
      expect(typeof payload.numericRange.max).toBe("number");
    });

    it("sends a numeric healthy-threshold value (not a string) when typed", async () => {
      wrapper = createWrapper();
      setField(wrapper, "name", "faithfulness");
      // healthyDirection defaults to "gte" → type the gte threshold value.
      await wrapper.find('[data-test="score-config-gte-value-input"] input').setValue("0.7");
      await flushPromises();

      await submit(wrapper);

      expect(oform(wrapper).form.state.isValid).toBe(true);
      const payload = (onlineEvalsService.scoreConfigs.create as any).mock.calls[0][1];
      expect(payload.healthyThreshold).toEqual({ direction: "gte", value: 0.7 });
      expect(typeof payload.healthyThreshold.value).toBe("number");
    });
  });
});
