// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.
//
// Behavior tests for ScoreConfigDialog after the OForm + Zod migration
// (online-evals-migration.md row 68). At least one test mounts the REAL <OForm>
// and proves the schema gates an empty/invalid submit (name required + the
// create-only slug pattern), while — matching origin/main pre-migration — a
// min≥max numeric range and an empty categorical config both still save
// (`categories: null`), so an unwired `:schema` would be caught. Also verifies
// the kept dirty affordance.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import ScoreConfigDialog from "./ScoreConfigDialog.vue";
import onlineEvalsService from "@/services/online-evals.service";
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

async function createWrapper(props: Record<string, any> = {}) {
  const wrapper = mount(ScoreConfigDialog, {
    props: { orgId: "test-org", mode: "create", row: null, ...props },
    global: { plugins: [store, i18n] },
  });
  // ODrawer (reka-ui Dialog) mounts its body slot in a portal asynchronously —
  // flush so the nested <OForm> + fields are present before the assertions.
  await flushPromises();
  return wrapper;
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
// ODrawer (reka-ui) teleports its body + footer to <body>, so DOM lookups go
// through `document` (wrapper.find only sees the wrapper's own subtree).
function domFind(sel: string) {
  return document.querySelector(sel);
}
async function typeNumber(testId: string, value: string) {
  const el = document.querySelector(`[data-test="${testId}"] input`) as HTMLInputElement | null;
  if (!el) throw new Error(`input not found: ${testId}`);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
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

  it("mounts the real OForm with the name + data-type fields", async () => {
    wrapper = await createWrapper();
    expect(wrapper.findComponent({ name: "OForm" }).exists()).toBe(true);
    expect(Boolean(domFind('[data-test="score-config-name-input"]'))).toBe(true);
  });

  it("keeps the create Save button enabled before first submit (R3)", async () => {
    wrapper = await createWrapper();
    expect(domFind('[data-test="o-drawer-primary-btn"]')?.hasAttribute("disabled")).toBe(false);
    expect(oform(wrapper).form.state.isValid).toBe(true);
  });

  it("blocks submit and does NOT call the service when the name is empty", async () => {
    wrapper = await createWrapper();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.scoreConfigs.create).not.toHaveBeenCalled();
  });

  it("blocks submit when the name has invalid characters (must be a lowercase slug)", async () => {
    wrapper = await createWrapper();
    // e.g. "<test>" — not a lowercase-letters/numbers/underscores identifier.
    setField(wrapper, "name", "<test>");
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.scoreConfigs.create).not.toHaveBeenCalled();
  });

  it("does NOT enforce the name pattern in edit mode (name is immutable)", async () => {
    wrapper = await createWrapper({
      mode: "edit",
      row: {
        id: "sc1",
        entityId: "sc1",
        // A legacy name that predates the slug rule must stay editable.
        name: "Legacy Name",
        version: 1,
        dataType: "numeric",
        numericRange: { min: 0, max: 1 },
      },
    });
    setField(wrapper, "description", "updated");
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.scoreConfigs.update).toHaveBeenCalledTimes(1);
  });

  it("creates a numeric score config when the schema passes", async () => {
    wrapper = await createWrapper();
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

  it("allows a numeric range where min >= max (no ordering rule — pre-migration parity)", async () => {
    wrapper = await createWrapper();
    setField(wrapper, "name", "faithfulness");
    setField(wrapper, "min", 5);
    setField(wrapper, "max", 1);
    // main never validated min<max, so this saves as-is.
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.scoreConfigs.create).toHaveBeenCalledTimes(1);
    const payload = (onlineEvalsService.scoreConfigs.create as any).mock.calls[0][1];
    expect(payload.numericRange).toEqual({ min: 5, max: 1 });
  });

  it("blocks submit when min or max is cleared (a blank number is not allowed)", async () => {
    wrapper = await createWrapper();
    setField(wrapper, "name", "faithfulness");
    // Clear the real min input → stored value becomes "" (not 0).
    await typeNumber("score-config-min-input", "");
    await flushPromises();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.scoreConfigs.create).not.toHaveBeenCalled();

    // Now clear max instead (min valid) → still blocked.
    await typeNumber("score-config-min-input", "0");
    await typeNumber("score-config-max-input", "");
    await flushPromises();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.scoreConfigs.create).not.toHaveBeenCalled();
  });

  it("does NOT block a categorical save after min/max were cleared on numeric (min/max are numeric-only)", async () => {
    // Regression: min/max are required only for the numeric data type. Clearing
    // min on numeric leaves "" in the store; switching to categorical hides the
    // inputs but the stale "" persists. If the requirement weren't gated on
    // dataType, Save would be blocked by an error on an invisible field.
    wrapper = await createWrapper();
    setField(wrapper, "name", "verdict");
    await typeNumber("score-config-min-input", "");
    await flushPromises();
    // Now switch away from numeric — the min/max inputs unmount.
    setField(wrapper, "dataType", "categorical");
    await flushPromises();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.scoreConfigs.create).toHaveBeenCalledTimes(1);
    const payload = (onlineEvalsService.scoreConfigs.create as any).mock.calls[0][1];
    expect(payload.dataType).toBe("categorical");
    // Numeric range is dropped for non-numeric types.
    expect(payload.numericRange).toBeNull();
  });

  it("allows an empty categorical config (no ≥1-category guard — pre-migration parity)", async () => {
    wrapper = await createWrapper();
    setField(wrapper, "name", "verdict");
    setField(wrapper, "dataType", "categorical");
    // categories empty → pre-migration sent `categories: null` and saved fine.
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.scoreConfigs.create).toHaveBeenCalledTimes(1);
    const payload = (onlineEvalsService.scoreConfigs.create as any).mock.calls[0][1];
    expect(payload.dataType).toBe("categorical");
    expect(payload.categories).toBeNull();
  });

  it("creates a categorical config once categories are provided", async () => {
    wrapper = await createWrapper();
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

  it("keeps the dirty affordance on edit (Save disabled until changed)", async () => {
    wrapper = await createWrapper({
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
    expect(domFind('[data-test="o-drawer-primary-btn"]')?.hasAttribute("disabled")).toBe(true);
  });

  // Regression: a number <input> emits a STRING (OInput only coerces with a
  // `.number` modifier, which OFormInput does not pass), and the @submit value is
  // TanStack's RAW store value — so the payload builders must coerce. These tests
  // drive the REAL inputs via `setValue` (NOT `setFieldValue`, which injects a
  // number and hides the bug) so the string actually flows through the form.
  describe("numeric values typed through the real inputs (string-coercion)", () => {
    it("sends a numeric numericRange (not null) when the range is typed", async () => {
      wrapper = await createWrapper();
      setField(wrapper, "name", "faithfulness");
      await typeNumber("score-config-min-input", "0.2");
      await typeNumber("score-config-max-input", "0.9");
      await flushPromises();

      await submit(wrapper);

      expect(oform(wrapper).form.state.isValid).toBe(true);
      const payload = (onlineEvalsService.scoreConfigs.create as any).mock.calls[0][1];
      expect(payload.numericRange).toEqual({ min: 0.2, max: 0.9 });
      expect(typeof payload.numericRange.min).toBe("number");
      expect(typeof payload.numericRange.max).toBe("number");
    });

    it("sends a numeric healthy-threshold value (not a string) when typed", async () => {
      wrapper = await createWrapper();
      setField(wrapper, "name", "faithfulness");
      // healthyDirection defaults to "gte" → type the gte threshold value.
      await typeNumber("score-config-gte-value-input", "0.7");
      await flushPromises();

      await submit(wrapper);

      expect(oform(wrapper).form.state.isValid).toBe(true);
      const payload = (onlineEvalsService.scoreConfigs.create as any).mock.calls[0][1];
      expect(payload.healthyThreshold).toEqual({ direction: "gte", value: 0.7 });
      expect(typeof payload.healthyThreshold.value).toBe("number");
    });
  });
});
