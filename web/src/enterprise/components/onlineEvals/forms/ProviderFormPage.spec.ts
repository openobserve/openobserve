// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.
//
// Behavior tests for ProviderFormPage after the OForm + Zod migration
// (online-evals-migration.md row 67). At least one test mounts the REAL <OForm>
// and proves the schema actually gates an empty submit — so an unwired `:schema`
// (the AddToDashboard/AddRegexPattern class of bug) would be caught.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import { nextTick } from "vue";
import ProviderFormPage from "./ProviderFormPage.vue";
import onlineEvalsService from "@/services/online-evals.service";
import i18n from "@/locales";

vi.mock("@/services/online-evals.service", () => ({
  default: {
    providers: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

const store = createStore({
  state: { theme: "light", selectedOrganization: { identifier: "test-org" } },
});

function createWrapper(props: Record<string, any> = {}) {
  return mount(ProviderFormPage, {
    props: {
      orgId: "test-org",
      mode: "create",
      row: null,
      ...props,
    },
    global: { plugins: [store, i18n] },
  });
}

// Reach the real OForm instance (exposes `form` + `isSubmitting`).
function oform(w: any) {
  return w.findComponent({ name: "OForm" }).vm as any;
}

// Set a form field on the real form, then submit through the form so the schema
// runs and the awaited @submit handler resolves deterministically.
function setField(w: any, name: string, value: unknown) {
  oform(w).form.setFieldValue(name, value);
}
async function submit(w: any) {
  await oform(w).form.handleSubmit();
  await flushPromises();
}

describe("ProviderFormPage", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    (onlineEvalsService.providers.create as any).mockResolvedValue({});
    (onlineEvalsService.providers.update as any).mockResolvedValue({});
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders the create form with all fields", () => {
    wrapper = createWrapper();
    expect(wrapper.find('[data-test="provider-form-name-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="provider-form-type-select"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="provider-form-endpoint-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="provider-form-default-model-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="provider-form-api-key-input"]').exists()).toBe(true);
  });

  it("keeps the Save button enabled and shows no errors before the first submit (R3)", () => {
    wrapper = createWrapper();
    const save = wrapper.find('[data-test="provider-form-save-btn"]');
    expect(save.attributes("disabled")).toBeUndefined();
    expect(oform(wrapper).form.state.isValid).toBe(true);
    // No error markers rendered before submit.
    expect(wrapper.find('[data-test="provider-form-name-input-error"]').exists()).toBe(false);
  });

  it("blocks submit and does NOT call the service when required fields are empty", async () => {
    wrapper = createWrapper();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);
    expect(onlineEvalsService.providers.create).not.toHaveBeenCalled();
  });

  it("allows create WITHOUT an API key (keyless self-hosted providers)", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "Local Ollama");
    setField(wrapper, "providerType", "ollama");
    setField(wrapper, "defaultModel", "llama3");
    // apiKey left blank → still valid client-side (matches main, which never
    // enforced it). Self-hosted providers (Ollama/vLLM) run keyless; the
    // per-type requirement for cloud providers is owned by the backend.
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.providers.create).toHaveBeenCalledTimes(1);
    expect(onlineEvalsService.providers.create).toHaveBeenCalledWith(
      "test-org",
      expect.objectContaining({ authConfig: { api_key: "" } }),
    );
  });

  it("creates a provider with the EXACT payload and emits saved when the schema passes", async () => {
    wrapper = createWrapper();
    setField(wrapper, "name", "  Prod OpenAI  ");
    setField(wrapper, "defaultModel", "gpt-4o-mini");
    setField(wrapper, "availableModels", "gpt-4o-mini, gpt-4.1");
    // Padded on purpose: the API key must be trimmed at save (parity with the
    // pre-migration `v-model.trim`), exactly like name/endpoint/defaultModel.
    setField(wrapper, "apiKey", "  sk-secret\n");
    await submit(wrapper);

    expect(oform(wrapper).form.state.isValid).toBe(true);
    expect(onlineEvalsService.providers.create).toHaveBeenCalledTimes(1);
    // EXACT payload (not objectContaining): asserts keys AND value types, so a
    // leaked schema-only `.optional()` field, a renamed/extra key, or a type
    // drift would be caught.
    expect(onlineEvalsService.providers.create).toHaveBeenCalledWith("test-org", {
      name: "Prod OpenAI", // trimmed at save
      providerType: "openai", // schema default
      endpoint: null, // blank endpoint → `"".trim() || null`
      defaultModel: "gpt-4o-mini",
      availableModels: ["gpt-4o-mini", "gpt-4.1"], // split + per-item trimmed
      authConfig: { api_key: "sk-secret" }, // trimmed
      isDefault: false,
    });
    expect(wrapper.emitted("saved")).toBeTruthy();
  });

  it("clears a required error on change after the first submit", async () => {
    wrapper = createWrapper();
    await submit(wrapper);
    expect(oform(wrapper).form.state.isValid).toBe(false);

    setField(wrapper, "name", "Prod OpenAI");
    setField(wrapper, "defaultModel", "gpt-4o-mini");
    setField(wrapper, "apiKey", "sk-secret");
    await nextTick();
    await flushPromises();
    expect(oform(wrapper).form.state.isValid).toBe(true);
  });

  describe("edit mode", () => {
    const row: any = {
      id: "prov-1",
      name: "Existing",
      provider_type: "anthropic",
      endpoint: "https://api.anthropic.com",
      default_model: "claude-3",
      available_models: ["claude-3", "claude-3-haiku"],
    };

    it("prefills the form from the record and locks name/type", () => {
      wrapper = createWrapper({ mode: "edit", row });
      expect(oform(wrapper).form.state.values.name).toBe("Existing");
      expect(oform(wrapper).form.state.values.providerType).toBe("anthropic");
      expect(oform(wrapper).form.state.values.defaultModel).toBe("claude-3");
      // apiKey is write-only → never seeded.
      expect(oform(wrapper).form.state.values.apiKey).toBe("");
    });

    it("saves on edit WITHOUT an API key (apiKey write-only on edit) using the EXACT payload", async () => {
      wrapper = createWrapper({ mode: "edit", row });
      await submit(wrapper);
      expect(oform(wrapper).form.state.isValid).toBe(true);
      expect(onlineEvalsService.providers.update).toHaveBeenCalledTimes(1);
      // EXACT payload: a blank apiKey must send `api_key: ""` (backend keeps the
      // stored secret) — the key is present, not omitted — and no field leaks.
      expect(onlineEvalsService.providers.update).toHaveBeenCalledWith("test-org", "prov-1", {
        name: "Existing", // locked on edit
        providerType: "anthropic",
        endpoint: "https://api.anthropic.com",
        defaultModel: "claude-3",
        availableModels: ["claude-3", "claude-3-haiku"],
        authConfig: { api_key: "" },
        isDefault: false,
      });
    });
  });
});
