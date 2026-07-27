// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.
//
// Behavior tests for ScorerFormPage after the OForm + Zod migration
// (online-evals-migration.md row 33). At least one test mounts the REAL <OForm>
// and proves the schema gates an empty submit + the conditional (llm_judge vs
// remote + auth) requireds, so an unwired `:schema` would be caught.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import ScorerFormPage from "./ScorerFormPage.vue";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import onlineEvalsService from "@/services/online-evals.service";
import i18n from "@/locales";

vi.mock("@/services/online-evals.service", () => ({
  default: {
    scorers: {
      create: vi.fn(),
      update: vi.fn(),
      test: vi.fn(),
      previewLlmJudgeOutputSchema: vi.fn(),
    },
  },
}));

const store = createStore({
  state: { theme: "light", selectedOrganization: { identifier: "test-org" } },
});

const providers = [{ id: "p1", name: "Provider 1", providerType: "openai" }];
const scoreConfigs = [{ id: "sc1", name: "faithfulness", dataType: "numeric" }];

function createWrapper(props: Record<string, any> = {}) {
  return mount(ScorerFormPage, {
    props: {
      orgId: "test-org",
      mode: "create",
      row: null,
      scorerType: "llm_judge",
      providers,
      scoreConfigs,
      scoreConfigVersions: {},
      isRefreshingProviders: false,
      ...props,
    },
    global: {
      plugins: [store, i18n],
      stubs: { ScorerTestPanel: true, "router-link": true },
    },
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

// Read the RENDERED value of every field-array input whose `name` matches the
// given indexed path (e.g. /^extraMetadataFields\[\d+\]\.name$/) — NOT
// `form.state.values`. We read the inner OInput's `model-value` (bound to
// `field.state.value`), so this proves the on-screen inputs stay aligned with the
// surviving rows, which is exactly what a stable-id `:key` bug would break (the
// form DATA stays correct while the INPUTS render shifted/blank).
function renderedRowValues(w: any, pattern: RegExp): unknown[] {
  return w
    .findAllComponents(OFormInput)
    .filter((c: any) => pattern.test(String(c.props("name") ?? "")))
    .map((c: any) => c.findComponent(OInput).props("modelValue"));
}

describe("ScorerFormPage", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (onlineEvalsService.scorers.create as any).mockResolvedValue({});
    (onlineEvalsService.scorers.update as any).mockResolvedValue({});
  });
  afterEach(() => wrapper?.unmount());

  it("renders the llm_judge form with the real OForm", () => {
    wrapper = createWrapper();
    expect(wrapper.findComponent({ name: "OForm" }).exists()).toBe(true);
    expect(wrapper.find('[data-test="scorer-form-name-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="scorer-form-provider-select"]').exists()).toBe(true);
  });

  it("keeps Save enabled and shows no errors before first submit (R3)", () => {
    wrapper = createWrapper();
    const save = wrapper.find('[data-test="scorer-form-save-btn"]');
    expect(save.attributes("disabled")).toBeUndefined();
    expect(oform(wrapper).form.state.isValid).toBe(true);
  });

  it("blocks submit and does NOT call the service when required fields are empty", async () => {
    wrapper = createWrapper();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.scorers.create).not.toHaveBeenCalled();
  });

  it("requires a provider for an llm_judge scorer", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "my-scorer");
    setField(wrapper, "producesScoreConfigId", "sc1");
    // providerId left blank → superRefine must fail.
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.scorers.create).not.toHaveBeenCalled();
  });

  it("creates an llm_judge scorer when the schema passes", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "my-scorer");
    setField(wrapper, "producesScoreConfigId", "sc1");
    setField(wrapper, "providerId", "p1");
    await submit(wrapper);

    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.scorers.create).toHaveBeenCalledTimes(1);
    const [org, payload] = (onlineEvalsService.scorers.create as any).mock.calls[0];
    expect(org).toBe("test-org");
    expect(payload.name).toBe("my-scorer");
    expect(payload.scorer.type).toBe("llm_judge");
    expect(payload.scorer.params.provider_id).toBe("p1");
    expect(wrapper.emitted("saved")).toBeTruthy();
  });

  it("creates a scorer with NO score config (optional — matches main + backend)", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "my-scorer");
    setField(wrapper, "providerId", "p1");
    // producesScoreConfigId left blank: a scorer with no score config is a valid
    // server-side entity and was creatable on main, so the schema must not
    // require it. The @submit handler maps the empty selection to `null`.
    await submit(wrapper);

    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.scorers.create).toHaveBeenCalledTimes(1);
    const [, payload] = (onlineEvalsService.scorers.create as any).mock.calls[0];
    expect(payload.scorer.producesScoreConfigId).toBeNull();
    expect(wrapper.emitted("saved")).toBeTruthy();
  });

  it("rejects duplicate extra-metadata field names", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "my-scorer");
    setField(wrapper, "producesScoreConfigId", "sc1");
    setField(wrapper, "providerId", "p1");
    setField(wrapper, "extraMetadataFields", [
      { name: "dup", type: "string", description: "" },
      { name: "dup", type: "number", description: "" },
    ]);
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.scorers.create).not.toHaveBeenCalled();
  });

  describe("remote scorer", () => {
    it("requires an endpoint URL", async () => {
      wrapper = createWrapper({ scorerType: "remote" });
      setField(wrapper, "name", "remote-scorer");
      setField(wrapper, "producesScoreConfigId", "sc1");
      // remoteEndpoint blank → invalid.
      await submit(wrapper);
      expect(oform(wrapper).form.state.isValid).toBe(false);
      expect(onlineEvalsService.scorers.create).not.toHaveBeenCalled();
    });

    it("requires the bearer token when auth type is bearer", async () => {
      wrapper = createWrapper({ scorerType: "remote" });
      setField(wrapper, "name", "remote-scorer");
      setField(wrapper, "producesScoreConfigId", "sc1");
      setField(wrapper, "remoteEndpoint", "https://api.example.com/score");
      setField(wrapper, "authType", "bearer");
      // token blank → invalid.
      await submit(wrapper);
      expect(oform(wrapper).form.state.isValid).toBe(false);
      expect(onlineEvalsService.scorers.create).not.toHaveBeenCalled();
    });

    it("rejects a negative timeout (≥0 rule)", async () => {
      wrapper = createWrapper({ scorerType: "remote" });
      setField(wrapper, "name", "remote-scorer");
      setField(wrapper, "producesScoreConfigId", "sc1");
      setField(wrapper, "remoteEndpoint", "https://api.example.com/score");
      setField(wrapper, "timeoutMs", -5);
      await submit(wrapper);
      expect(oform(wrapper).form.state.isValid).toBe(false);
      expect(onlineEvalsService.scorers.create).not.toHaveBeenCalled();
    });

    it("creates a remote scorer when endpoint + auth are provided", async () => {
      wrapper = createWrapper({ scorerType: "remote" });
      setField(wrapper, "name", "remote-scorer");
      setField(wrapper, "producesScoreConfigId", "sc1");
      setField(wrapper, "remoteEndpoint", "https://api.example.com/score");
      setField(wrapper, "authType", "bearer");
      setField(wrapper, "authBearerToken", "tok-123");
      await submit(wrapper);

      expect(oform(wrapper).form.state.isValid).toBe(true);
      expect(onlineEvalsService.scorers.create).toHaveBeenCalledTimes(1);
      const payload = (onlineEvalsService.scorers.create as any).mock.calls[0][1];
      expect(payload.scorer.type).toBe("remote");
      expect(payload.scorer.params.endpoint).toBe("https://api.example.com/score");
      expect(payload.scorer.params.auth).toEqual({ type: "bearer", token: "tok-123" });
    });

    // The auth-type select is `:clearable` precisely so a user can escape back to
    // "no auth": the options list has no "" entry (OSelect can't select ""), and
    // each real type makes its token fields required. Picking one by accident — or
    // wanting to remove auth on edit — must not be a dead end. This drives the ✕
    // to prove the prop is wired AND that clearing yields a valid, auth-free save.
    it("clears the auth type via the ✕ and saves with no auth in the payload", async () => {
      wrapper = createWrapper({ scorerType: "remote" });
      setField(wrapper, "name", "remote-scorer");
      setField(wrapper, "producesScoreConfigId", "sc1");
      setField(wrapper, "remoteEndpoint", "https://api.example.com/score");
      // Select bearer but leave the token blank — the trap state (invalid, and
      // no "" option to pick).
      setField(wrapper, "authType", "bearer");
      await flushPromises();

      // Only the auth-type select is clearable, so the ✕ is unique on the page.
      const clearBtn = wrapper.find('[aria-label="Clear selection"]');
      expect(clearBtn.exists()).toBe(true);
      await clearBtn.trigger("click");
      await flushPromises();

      await submit(wrapper);

      expect(oform(wrapper).form.state.isValid).toBe(true);
      expect(onlineEvalsService.scorers.create).toHaveBeenCalledTimes(1);
      const [, payload] = (onlineEvalsService.scorers.create as any).mock.calls[0];
      expect(payload.scorer.params.auth).toBeUndefined();
    });

    // The headline workflow: editing a scorer that ALREADY has auth and removing
    // it. Pre-migration this was the silent-drop path; now the ✕ is how you do it.
    // Proves the pre-filled auth is clearable and drops out of the update payload
    // (the update sends params built purely from the form — no server-side merge).
    it("edit: clearing pre-filled auth removes it from the update payload", async () => {
      const remoteAuthRow = {
        id: "scorer-1",
        entity_id: "scorer-1",
        name: "remote-scorer",
        version: 1,
        scorer_type: "remote",
        template: "Evaluate {{ input }} and {{ output }}.",
        produces_score_config_id: "sc1",
        params: {
          endpoint: "https://api.example.com/score",
          http_method: "POST",
          timeout_ms: 30000,
          auth: { type: "bearer", token: "existing-tok" },
        },
      };
      wrapper = createWrapper({ mode: "edit", scorerType: "remote", row: remoteAuthRow });
      await flushPromises();

      // Auth was read from the row as bearer, so the ✕ is available.
      expect(oform(wrapper).form.state.values.authType).toBe("bearer");
      const clearBtn = wrapper.find('[aria-label="Clear selection"]');
      expect(clearBtn.exists()).toBe(true);
      await clearBtn.trigger("click");
      await flushPromises();

      await submit(wrapper);

      expect(oform(wrapper).form.state.isValid).toBe(true);
      expect(onlineEvalsService.scorers.update).toHaveBeenCalledTimes(1);
      const [, , payload] = (onlineEvalsService.scorers.update as any).mock.calls[0];
      expect(payload.scorer.params.auth).toBeUndefined();
    });
  });

  // START-HERE ① non-negotiable gate — a field-array form must prove that
  // deleting a NON-last row leaves the RENDERED inputs (not just
  // `form.state.values`) aligned with the survivors in order. A stable-id `:key`
  // would reuse+reorder the row components on a mid-list delete and leave the
  // inputs shifted/blank; the index `:key` these arrays use keeps each position's
  // `name` binding fixed, so this passes.
  describe("field-array delete keeps rendered inputs aligned (START-HERE ①)", () => {
    const NAME_RE = /^extraMetadataFields\[\d+\]\.name$/;
    const HEADER_KEY_RE = /^customHeaders\[\d+\]\.key$/;

    it("deleting a NON-last extra-metadata row re-renders survivors in order", async () => {
      wrapper = createWrapper();
      setField(wrapper, "extraMetadataFields", [
        { name: "alpha", type: "string", description: "" },
        { name: "beta", type: "string", description: "" },
        { name: "gamma", type: "string", description: "" },
      ]);
      await flushPromises();
      expect(renderedRowValues(wrapper, NAME_RE)).toEqual(["alpha", "beta", "gamma"]);

      // Delete the MIDDLE row through the real remove button.
      await wrapper.find('[data-test="scorer-form-extra-field-remove-1"]').trigger("click");
      await flushPromises();

      // RENDERED inputs — must be the survivors in order, NOT shifted/blank.
      expect(renderedRowValues(wrapper, NAME_RE)).toEqual(["alpha", "gamma"]);
      expect(oform(wrapper).form.state.values.extraMetadataFields.map((f: any) => f.name)).toEqual([
        "alpha",
        "gamma",
      ]);
    });

    it("deleting a NON-last custom-header row re-renders survivors in order", async () => {
      wrapper = createWrapper({ scorerType: "remote" });
      setField(wrapper, "customHeaders", [
        { key: "h1", value: "v1" },
        { key: "h2", value: "v2" },
        { key: "h3", value: "v3" },
      ]);
      await flushPromises();
      expect(renderedRowValues(wrapper, HEADER_KEY_RE)).toEqual(["h1", "h2", "h3"]);

      await wrapper.find('[data-test="scorer-form-remote-header-remove-1"]').trigger("click");
      await flushPromises();

      expect(renderedRowValues(wrapper, HEADER_KEY_RE)).toEqual(["h1", "h3"]);
      expect(oform(wrapper).form.state.values.customHeaders.map((h: any) => h.key)).toEqual([
        "h1",
        "h3",
      ]);
    });
  });
});
